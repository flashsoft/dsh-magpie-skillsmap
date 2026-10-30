// Incremental skill-index engine bundled with the plugin.
// No external skill installation is required. Semantic decisions are supplied
// by the caller; this module only scans, validates, and applies those decisions.
import { createHash } from 'node:crypto'
import { copyFile, mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { createEmptyIndex } from './taxonomy.js'

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const HAN = /\p{Script=Han}/gu

export function normalizeName(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export async function sha256File(file) {
  const buffer = await readFile(file)
  return createHash('sha256').update(buffer).digest('hex')
}

export function sha256Text(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export function parseFrontmatter(text) {
  if (!text.startsWith('---')) return {}
  const end = text.indexOf('\n---', 3)
  if (end === -1) return {}
  const block = text.slice(3, end)
  const fields = {}
  let key = null
  let parts = []
  const flush = () => {
    if (key !== null) {
      let value = parts.map((part) => part.trim()).filter(Boolean).join(' ').trim()
      value = value.replace(/^["']|["']$/g, '')
      fields[key] = value
    }
    key = null
    parts = []
  }
  for (const raw of block.split('\n')) {
    const line = raw.replace(/\s+$/, '')
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (match && !/^[ \t]/.test(raw)) {
      flush()
      key = match[1]
      const value = match[2].trim()
      if (value && !['>-', '>', '|', '|-'].includes(value)) parts = [value]
      continue
    }
    if (key !== null) parts.push(line)
  }
  flush()
  return fields
}

export async function readSkill(file) {
  const text = await readFile(file, 'utf8')
  const fields = parseFrontmatter(text)
  const desc = String(fields.description || '').replace(/\s+/g, ' ').trim()
  return {
    path: file,
    sha256: await sha256File(file),
    desc,
    descHash: sha256Text(desc),
  }
}

export async function loadIndex(indexPath, { allowMissing = false, libraryRoot } = {}) {
  let index
  try {
    index = JSON.parse(await readFile(indexPath, 'utf8'))
  } catch (error) {
    if (error?.code !== 'ENOENT' || !allowMissing) throw error
    index = createEmptyIndex(libraryRoot)
  }
  if (!Array.isArray(index.skills)) throw new Error(`${indexPath}: missing skills[]`)
  if (!Array.isArray(index.scenes)) throw new Error(`${indexPath}: missing scenes[]`)
  index.skills = index.skills.map((skill) => ({ ...skill, sceneIds: skillSceneIds(skill) }))
  return index
}

export async function atomicWriteJson(indexPath, data) {
  const directory = path.dirname(path.resolve(indexPath)) || '.'
  await mkdir(directory, { recursive: true })
  const tmp = path.join(directory, `.skills-index-${process.pid}-${Date.now()}.json`)
  try {
    const handle = await open(tmp, 'w')
    try {
      await handle.writeFile(`${JSON.stringify(data, null, 1)}\n`, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(tmp, indexPath)
  } finally {
    if (existsSync(tmp)) await unlink(tmp).catch(() => {})
  }
}

export async function backupIndex(indexPath) {
  if (!existsSync(indexPath)) return null
  const backup = `${indexPath}.bak`
  await copyFile(indexPath, backup)
  return backup
}

export function nowIso(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const hours = pad(Math.floor(Math.abs(offset) / 60))
  const minutes = pad(Math.abs(offset) % 60)
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${hours}:${minutes}`
  )
}

export async function currentSkills(library) {
  const entries = await readdir(library, { withFileTypes: true }).catch((error) => {
    if (error?.code === 'ENOENT') throw new Error(`library root not found: ${library}`)
    throw error
  })
  const result = {}
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    const file = path.join(library, entry.name, 'SKILL.md')
    if (!existsSync(file)) continue
    const info = await readSkill(file)
    result[entry.name] = { dir: entry.name, name: normalizeName(entry.name), path: file, ...info }
  }
  return result
}

export async function scanIndex(index, libraryOverride) {
  const library = libraryOverride || index.libraryRoot
  if (!library) throw new Error('no library root configured')
  const found = await currentSkills(library)
  const indexed = new Map(index.skills.map((skill) => [skill.dir, skill]))
  const added = []
  const changed = []
  const descChanged = []
  for (const [directory, skill] of Object.entries(found)) {
    const old = indexed.get(directory)
    if (!old) {
      added.push(skill)
      continue
    }
    if (skill.sha256 !== old.sha256) changed.push({ ...skill, scene: old.scene, gist: old.gist })
    if (skill.descHash !== old.descHash) {
      descChanged.push({ ...skill, scene: old.scene, gist: old.gist, prevDesc: old.desc || '' })
    }
  }
  const removed = [...indexed.values()].filter((skill) => !found[skill.dir])
  const byHash = new Map()
  for (const skill of removed) {
    const key = skill.sha256 || ''
    if (!byHash.has(key)) byHash.set(key, [])
    byHash.get(key).push(skill)
  }
  const renames = []
  for (const skill of added) {
    const candidates = byHash.get(skill.sha256)
    if (candidates?.length > 0) {
      // Consume each old entry once, matching applyDecisions one-to-one.
      const old = candidates.shift()
      renames.push({ dir: skill.dir, name: skill.name, from: old.dir, scene: old.scene, gist: old.gist })
    }
  }
  return {
    library,
    counts: {
      new: added.length,
      changed: changed.length,
      descChanged: descChanged.length,
      removed: removed.length,
      unchanged: Object.keys(found).length - added.length - changed.length,
      pending: added.length + descChanged.length,
    },
    new: added,
    changed,
    descChanged,
    removed,
    renames,
  }
}

export function skillSceneIds(skill) {
  if (Array.isArray(skill?.sceneIds) && skill.sceneIds.length > 0) return skill.sceneIds
  return skill?.scene ? [skill.scene] : []
}

function sceneAssignment(item, legalScenes, label, errors) {
  const scene = item.scene
  const ids = item.sceneIds === undefined ? [scene] : item.sceneIds
  if (!legalScenes.has(scene)) errors.push(`${label}: unknown primary scene ${JSON.stringify(scene)}`)
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 3) {
    errors.push(`${label}: sceneIds must contain 1-3 scenes`)
    return { scene, sceneIds: Array.isArray(ids) ? ids : [scene] }
  }
  if (new Set(ids).size !== ids.length) errors.push(`${label}: duplicate sceneIds`)
  if (!ids.includes(scene)) errors.push(`${label}: sceneIds must include primary scene ${scene}`)
  for (const id of ids) {
    if (!legalScenes.has(id)) errors.push(`${label}: unknown scene ${JSON.stringify(id)}`)
  }
  return { scene, sceneIds: [...ids] }
}

export function validGist(gist) {
  if (typeof gist !== 'string' || !gist.trim()) return false
  if ([...gist].length > 40) return false
  return (gist.match(HAN) || []).length <= 18
}

export async function validateIndex(index, checkFiles = true) {
  const errors = []
  const warnings = []
  const sceneIds = index.scenes.map((scene) => scene.id)
  for (const scene of index.scenes) {
    for (const field of ['id', 'zh', 'family', 'when']) {
      if (!scene[field]) errors.push(`scene missing ${field}: ${JSON.stringify(scene.id)}`)
    }
  }
  if (sceneIds.length !== new Set(sceneIds).size) errors.push('duplicate scene ids')
  const legalScenes = new Set(sceneIds)
  const names = new Map()
  for (const skill of index.skills) {
    const label = skill.dir || skill.name || '?'
    if (!KEBAB.test(skill.name || '')) errors.push(`${label}: invalid name ${JSON.stringify(skill.name)}`)
    if (names.has(skill.name)) errors.push(`${label}: duplicate name ${JSON.stringify(skill.name)}`)
    names.set(skill.name, label)
    sceneAssignment(skill, legalScenes, label, errors)
    if (!validGist(skill.gist || '')) errors.push(`${label}: invalid gist ${JSON.stringify(skill.gist)}`)
    if (checkFiles) {
      if (!skill.path || !existsSync(skill.path)) errors.push(`${label}: SKILL.md not found: ${skill.path}`)
      else if (skill.sha256 && (await sha256File(skill.path)) !== skill.sha256) {
        warnings.push(`${label}: sha256 is stale`)
      }
    }
  }
  for (const extra of index.extras || []) {
    const label = extra.name || '?'
    sceneAssignment(extra, legalScenes, `extra ${label}`, errors)
    if (!validGist(extra.gist || '')) errors.push(`extra ${label}: invalid gist`)
    if (checkFiles && extra.path && !existsSync(extra.path)) errors.push(`extra ${label}: SKILL.md not found`)
  }
  return { ok: errors.length === 0, errors, warnings }
}

async function loadSources(file) {
  if (!file) return new Map()
  try {
    const data = JSON.parse(await readFile(file, 'utf8'))
    const sources = new Map()
    for (const skill of data.skills || []) {
      const repo = skill?.source?.repo || ''
      sources.set(skill.name, repo || '本地安装')
    }
    return sources
  } catch {
    return new Map()
  }
}

function indexingError(errors, statusCode = 400) {
  const error = new Error(Array.isArray(errors) ? errors.join('\n') : String(errors))
  error.errors = Array.isArray(errors) ? errors : [String(errors)]
  error.statusCode = statusCode
  return error
}

/** Apply only new/description-changed decisions to an in-memory index. */
export async function applyDecisions({
  index,
  decisions = {},
  library,
  libraryJson,
  allowMassRemoval = false,
}) {
  for (const skill of index.skills) skill.sceneIds = skillSceneIds(skill)
  const found = await currentSkills(library || index.libraryRoot)
  const indexed = new Map(index.skills.map((skill) => [skill.dir, skill]))
  const sceneIds = new Set(index.scenes.map((scene) => scene.id))
  const sources = await loadSources(libraryJson)
  const classify = new Map()
  const errors = []

  for (const item of decisions.classify || []) {
    const directory = item.dir
    const skill = found[directory]
    const old = indexed.get(directory)
    if (!skill) {
      errors.push(`decision for unknown dir: ${JSON.stringify(directory)}`)
      continue
    }
    if (old && old.descHash === skill.descHash) {
      errors.push(`decision for unchanged skill is not allowed: ${directory}`)
      continue
    }
    const assignment = sceneAssignment(item, sceneIds, directory, errors)
    if (!validGist(item.gist || '')) errors.push(`${directory}: invalid gist ${JSON.stringify(item.gist)}`)
    classify.set(directory, { ...assignment, gist: item.gist })
  }

  const assign = new Map()
  for (const item of decisions.assign || []) {
    const directory = item.dir
    const skill = found[directory]
    const old = indexed.get(directory)
    if (!skill || !old) {
      errors.push(`assign for unknown existing dir: ${JSON.stringify(directory)}`)
      continue
    }
    if (old.descHash !== skill.descHash) {
      errors.push(`description-changed skill requires classify, not assign: ${directory}`)
      continue
    }
    if (classify.has(directory)) {
      errors.push(`skill cannot have both classify and assign: ${directory}`)
      continue
    }
    const assignment = sceneAssignment(item, sceneIds, directory, errors)
    assign.set(directory, assignment)
  }

  const removed = [...indexed.values()].filter((skill) => !found[skill.dir])
  const removedByHash = new Map()
  for (const skill of removed) {
    const key = skill.sha256 || ''
    if (!removedByHash.has(key)) removedByHash.set(key, [])
    removedByHash.get(key).push(skill)
  }
  const removalLimit = Math.max(5, Math.floor(indexed.size * 0.15))
  if (removed.length > removalLimit && !allowMassRemoval) {
    throw indexingError(
      `refusing to remove ${removed.length} of ${indexed.size} skills; confirm the library root first`,
      409,
    )
  }

  const pending = []
  const added = []
  const refreshed = []
  const reclassified = []
  const assigned = []
  const carried = []
  const consumedRemoved = new Set()
  const nextSkills = []
  for (const [directory, skill] of Object.entries(found)) {
    const old = indexed.get(directory)
    const decision = classify.get(directory)
    if (!old) {
      if (decision) {
        nextSkills.push({
          dir: directory,
          name: skill.name,
          scene: decision.scene,
          sceneIds: decision.sceneIds,
          gist: decision.gist,
          source: sources.get(directory) || '本地安装',
          path: skill.path,
          sha256: skill.sha256,
          descHash: skill.descHash,
          desc: skill.desc.slice(0, 300),
          classifiedAt: nowIso(),
        })
        added.push(directory)
        continue
      }
      const candidates = removedByHash.get(skill.sha256) || []
      if (candidates.length > 0) {
        const previous = candidates.shift()
        consumedRemoved.add(previous.dir)
        nextSkills.push({
          ...previous,
          dir: directory,
          name: skill.name,
          path: skill.path,
          sha256: skill.sha256,
          descHash: skill.descHash,
          desc: skill.desc.slice(0, 300),
        })
        carried.push(`${previous.dir} -> ${directory}`)
        continue
      }
      errors.push(`unclassified new skill: ${directory}`)
      continue
    }
    if (decision) {
      nextSkills.push({
        ...old,
        name: skill.name,
        scene: decision.scene,
        sceneIds: decision.sceneIds,
        gist: decision.gist,
        source: sources.get(directory) || old.source || '本地安装',
        path: skill.path,
        sha256: skill.sha256,
        descHash: skill.descHash,
        desc: skill.desc.slice(0, 300),
        classifiedAt: nowIso(),
      })
      reclassified.push(directory)
      continue
    }
    const assignment = assign.get(directory)
    if (assignment) {
      const currentScenes = skillSceneIds(old)
      const changed =
        old.scene !== assignment.scene ||
        currentScenes.length !== assignment.sceneIds.length ||
        currentScenes.some((id, index) => id !== assignment.sceneIds[index])
      if (changed) {
        nextSkills.push({
          ...old,
          name: skill.name,
          scene: assignment.scene,
          sceneIds: assignment.sceneIds,
          source: sources.get(directory) || old.source || '本地安装',
          path: skill.path,
          sha256: skill.sha256,
          descHash: skill.descHash,
          desc: skill.desc.slice(0, 300),
          classifiedAt: nowIso(),
        })
        assigned.push(directory)
        continue
      }
    }
    if (skill.descHash !== old.descHash) {
      nextSkills.push(old)
      pending.push(directory)
      continue
    }
    const refreshedEntry = {
      ...old,
      name: skill.name,
      source: sources.get(directory) || old.source || '本地安装',
      path: skill.path,
      sha256: skill.sha256,
      desc: skill.desc.slice(0, 300),
    }
    nextSkills.push(refreshedEntry)
    if (refreshedEntry.sha256 !== old.sha256) refreshed.push(directory)
  }
  if (errors.length > 0) throw indexingError(errors)

  const dropped = removed.filter((skill) => !consumedRemoved.has(skill.dir)).map((skill) => skill.dir)
  const noop =
    added.length +
      reclassified.length +
      assigned.length +
      refreshed.length +
      carried.length +
      dropped.length ===
      0 && pending.length === 0
  if (!noop) {
    index.schemaVersion = 2
    index.skills = nextSkills.sort((a, b) => a.name.localeCompare(b.name))
    index.updatedAt = nowIso()
  }
  const validation = await validateIndex(index)
  if (!validation.ok) throw indexingError(validation.errors)
  return {
    noop,
    added,
    reclassified,
    assigned,
    refreshed,
    renamed: carried,
    dropped,
    pending,
    counts: { skills: index.skills.length, scenes: index.scenes.length },
    validation,
  }
}
