// Host half of dsh-magpie-skillsmap (demo).
//
// Serve the picker index, persist feedback in that same index, and expand
// `$skill-name` or `/skill-name` markers into <skill_content> instructions.
// Magpie library skills stay in the custom picker; only the built-in organizer
// is registered as a native runtime skill for compact composer invocation.
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { renderSkillContent } from '@deepseek-ai/dsh-skill'
import {
  applyDecisions,
  atomicWriteJson,
  backupIndex,
  loadIndex,
  scanIndex,
  validateIndex,
} from './indexer.js'
import { ORGANIZER_SKILL_CONTENT, ORGANIZER_SKILL_NAME } from './organizer-prompt.js'

export const name = 'magpie-skillsmap'
export const inject = ['webServer', 'skills']

const DEFAULT_INDEX = path.join(os.homedir(), '.dsh/dsh-magpie-skillmap/skills.json')
const TOKEN = /(^|\s)([\$/])([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g
const DEFAULT_LIBRARY_JSON = path.join(os.homedir(), '.config/magpie/library.json')
const DEFAULT_LIBRARY_ROOT = path.join(os.homedir(), '.config/magpie/library/skills')

/** `$kebab-name` and `/kebab-name` tokens from direct user messages only. */
export function scanTokenEntries(messages) {
  const entries = []
  for (const message of messages) {
    if (message?.source?.kind !== 'user') continue
    for (const block of message.content ?? []) {
      if (block?.type !== 'text') continue
      for (const match of block.text.matchAll(TOKEN)) {
        const entry = { name: match[3], trigger: match[2] }
        if (!entries.some((item) => item.name === entry.name && item.trigger === entry.trigger)) {
          entries.push(entry)
        }
      }
    }
  }
  return entries
}

export function scanTokens(messages) {
  return [...new Set(scanTokenEntries(messages).map((entry) => entry.name))]
}

/** Drop a leading YAML frontmatter block, if any. */
export function stripFrontmatter(text) {
  return text.replace(/^---\n[\s\S]*?\n---\n?/, '')
}

/** mtime/inode-cached reader for the atomically replaced index JSON. */
export function createIndexReader(indexPath, { libraryRoot = DEFAULT_LIBRARY_ROOT } = {}) {
  let cached = null
  let cachedStat = null
  return {
    indexPath,
    async read() {
      let info
      try {
        info = await stat(indexPath)
      } catch (error) {
        if (error?.code === 'ENOENT') return loadIndex(indexPath, { allowMissing: true, libraryRoot })
        throw error
      }
      if (
        cached === null ||
        cachedStat.mtimeMs !== info.mtimeMs ||
        cachedStat.ino !== info.ino ||
        cachedStat.size !== info.size
      ) {
        cached = await loadIndex(indexPath, { allowMissing: true, libraryRoot })
        cachedStat = info
      }
      return cached
    },
  }
}

/** One process-local queue for feedback and organizer writes. */
export function createIndexUpdater(indexPath, { libraryRoot = DEFAULT_LIBRARY_ROOT } = {}) {
  let queue = Promise.resolve()
  return function update(mutate) {
    const run = queue.then(async () => {
      const index = await loadIndex(indexPath, { allowMissing: true, libraryRoot })
      const result = await mutate(index)
      if (result === undefined) return undefined
      await atomicWriteJson(indexPath, index)
      return result
    })
    queue = run.then(() => undefined, () => undefined)
    return run
  }
}

function feedbackOf(entry) {
  return {
    name: entry.name,
    usageCount: entry.usageCount ?? 0,
    favorite: entry.favorite === true,
    favoritedAt: entry.favoritedAt,
    lastUsedAt: entry.lastUsedAt,
  }
}

/** Serialized, atomic feedback updates against the original index file. */
export function createFeedbackStore(indexPath, update = createIndexUpdater(indexPath)) {
  return {
    async recordUsage(names) {
      const unique = [...new Set(names)]
      if (unique.length === 0) return []
      return update((index) => {
        const updated = []
        for (const entry of index.skills ?? []) {
          if (!unique.includes(entry.name)) continue
          entry.usageCount = (entry.usageCount ?? 0) + 1
          entry.lastUsedAt = new Date().toISOString()
          updated.push(feedbackOf(entry))
        }
        return updated
      })
    },
    async setFavorite(name, favorite) {
      if (typeof favorite !== 'boolean') throw new Error('favorite must be a boolean')
      return update((index) => {
        const entry = (index.skills ?? []).find((skill) => skill.name === name)
        if (entry === undefined) {
          const error = new Error(`unknown skill: ${name}`)
          error.statusCode = 404
          throw error
        }
        entry.favorite = favorite
        if (favorite) entry.favoritedAt = new Date().toISOString()
        else delete entry.favoritedAt
        return feedbackOf(entry)
      })
    },
    async resetUsage(name) {
      return update((index) => {
        const entry = (index.skills ?? []).find((skill) => skill.name === name)
        if (entry === undefined) {
          const error = new Error(`unknown skill: ${name}`)
          error.statusCode = 404
          throw error
        }
        entry.usageCount = 0
        delete entry.lastUsedAt
        return feedbackOf(entry)
      })
    },
  }
}

/** Built-in incremental organizer; decisions come from the dialog, not a skill. */
export function createOrganizer(indexPath, update, config = {}) {
  const libraryJson = config.libraryJsonPath || DEFAULT_LIBRARY_JSON
  const libraryRoot = config.libraryPath || DEFAULT_LIBRARY_ROOT
  return {
    async scan() {
      const index = await loadIndex(indexPath, { allowMissing: true, libraryRoot })
      return scanIndex(index, config.libraryPath)
    },
    async validate() {
      return validateIndex(await loadIndex(indexPath, { allowMissing: true, libraryRoot }))
    },
    async apply(decisions = {}) {
      let report
      await update(async (index) => {
        report = await applyDecisions({
          index,
          decisions,
          library: config.libraryPath,
          libraryJson,
          allowMassRemoval: decisions.allowMassRemoval === true,
        })
        if (report.noop) return undefined
        report.backup = await backupIndex(indexPath)
        return report
      })
      let verification
      try {
        verification = await this.scan()
      } catch (error) {
        // The atomic write already succeeded. Return that fact distinctly so
        // the client does not send stale decisions back for a second write.
        verification = { ok: false, error: String(error?.message || error) }
      }
      return { ok: true, report, verification }
    },
  }
}

/** Build the agent/pre-step listener that injects selected skills. */
export function createPreStepHandler(reader, feedback, nativeSkills) {
  return async function magpiePreStep({ messages, signal }, next) {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    const entries = scanTokenEntries(messages)
    if (entries.length === 0) return decision
    const names = [...new Set(entries.map((entry) => entry.name))]
    signal?.throwIfAborted?.()

    const index = await reader.read()
    const byName = new Map((index.skills ?? []).map((skill) => [skill.name, skill]))
    const known = names.filter((skillName) => byName.has(skillName))
    const alreadyInjected = new Set(
      decision.messages
        .filter((message) => message?.source?.kind === 'skill-invocation')
        .map((message) => message.source.name),
    )
    const injected = []
    const usedNames = new Set([...alreadyInjected].filter((skillName) => known.includes(skillName)))
    for (const skillName of known) {
      if (alreadyInjected.has(skillName)) continue
      if (nativeSkills !== undefined && entries.some((entry) => entry.name === skillName && entry.trigger === '/')) {
        try {
          if (await nativeSkills.get(skillName, {}) !== undefined) continue
        } catch {}
      }
      const entry = byName.get(skillName)
      const raw = await readFile(entry.path, 'utf8')
      injected.push(
        createUserMessage({
          content: [
            {
              type: 'text',
              text: renderSkillContent({
                name: entry.name,
                provider: 'magpie',
                resourceBase: { kind: 'directory', path: path.dirname(entry.path) },
                content: stripFrontmatter(raw),
              }),
            },
          ],
          source: { kind: 'skill-invocation', name: entry.name, form: 'instructions' },
        }),
      )
      usedNames.add(skillName)
    }
    if (feedback !== undefined && usedNames.size > 0) {
      try {
        await feedback.recordUsage([...usedNames])
      } catch (error) {
        console.error('[magpie-skillmap] failed to record usage:', error)
      }
    }
    if (injected.length === 0) return decision
    return { ...decision, messages: [...decision.messages, ...injected] }
  }
}

async function readJsonBody(req) {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > 1024 * 1024) throw new Error('request body too large')
  }
  return JSON.parse(body || '{}')
}

function sendJson(res, status, value) {
  res.writeHead?.(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end?.(JSON.stringify(value))
}

export function apply(ctx, config = {}) {
  const indexPath = config.indexPath || DEFAULT_INDEX
  const libraryRoot = config.libraryPath || DEFAULT_LIBRARY_ROOT
  const reader = createIndexReader(indexPath, { libraryRoot })
  const update = createIndexUpdater(indexPath, { libraryRoot })
  const feedback = createFeedbackStore(indexPath, update)
  const organizer = createOrganizer(indexPath, update, config)
  const nativeSkills = ctx.skills || ctx.get?.('skills')
  if (nativeSkills?.register !== undefined) {
    ctx.effect(
      () =>
        nativeSkills.register({
          name: ORGANIZER_SKILL_NAME,
          description: '增量整理 Magpie 技能索引：扫描变化，由 AI 分类并通过插件校验写回。',
          source: 'runtime',
          provider: 'magpie-skillmap',
          invocation: { modelInvocable: true, userInvocable: true },
          content: ORGANIZER_SKILL_CONTENT,
        }),
      'magpie-skillsmap: embedded organizer skill',
    )
  }

  ctx.on('agent/pre-step', createPreStepHandler(reader, feedback, nativeSkills))

  if (ctx.webServer?.register !== undefined) {
    ctx.effect(
      () =>
        ctx.webServer.register({
          kind: 'prefix',
          path: '/api/magpie-skillmap',
          handler: async (req, res) => {
            const pathname = new URL(req.url, 'http://localhost').pathname
            try {
              if (pathname === '/api/magpie-skillmap/index.json' && req.method !== 'POST') {
                sendJson(res, 200, await reader.read())
                return
              }
              if (pathname === '/api/magpie-skillmap/feedback' && req.method === 'POST') {
                const body = await readJsonBody(req)
                const skill =
                  body.resetUsage === true
                    ? await feedback.resetUsage(body.name)
                    : await feedback.setFavorite(body.name, body.favorite)
                sendJson(res, 200, { ok: true, skill })
                return
              }
              if (pathname === '/api/magpie-skillmap/organize/scan' && req.method === 'GET') {
                sendJson(res, 200, { ok: true, diff: await organizer.scan() })
                return
              }
              if (pathname === '/api/magpie-skillmap/organize/validate' && req.method === 'POST') {
                sendJson(res, 200, { ok: true, report: await organizer.validate() })
                return
              }
              if (pathname === '/api/magpie-skillmap/organize/apply' && req.method === 'POST') {
                const body = await readJsonBody(req)
                sendJson(res, 200, await organizer.apply(body))
                return
              }
              sendJson(res, 404, { ok: false, error: 'not found' })
            } catch (error) {
              sendJson(res, error.statusCode ?? 400, {
                ok: false,
                error: String(error?.message || error),
                errors: error.errors,
              })
            }
          },
        }),
      'magpie-skillsmap: index, feedback, and organizer routes',
    )
  }
}
