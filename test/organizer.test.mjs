import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  createFeedbackStore,
  createIndexReader,
  createIndexUpdater,
  createOrganizer,
} from '../lib/index.js'
import { applyDecisions, nowIso, readSkill, scanIndex } from '../lib/indexer.js'
import { SCENES } from '../lib/taxonomy.js'

async function writeSkill(library, name, description = 'demo description', body = 'Demo body.') {
  const directory = path.join(library, name)
  await mkdir(directory, { recursive: true })
  const file = path.join(directory, 'SKILL.md')
  await writeFile(file, `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`)
  return file
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'magpie-organizer-'))
  const library = path.join(root, 'library')
  await mkdir(library)
  const skillPath = await writeSkill(library, 'existing')
  const info = await readSkill(skillPath)
  const indexPath = path.join(root, 'skills.json')
  const index = {
    schemaVersion: 1,
    taxonomyVersion: 1,
    updatedAt: '2026-01-01T00:00:00+08:00',
    libraryRoot: library,
    scenes: [
      { id: 'ui', zh: '界面', family: '做设计', when: '做界面时' },
      { id: 'agent', zh: '工具链', family: '写代码', when: '造工具时' },
    ],
    skills: [
      {
        dir: 'existing',
        name: 'existing',
        scene: 'ui',
        gist: '做演示时',
        source: '本地安装',
        path: skillPath,
        sha256: info.sha256,
        descHash: info.descHash,
        desc: info.desc,
      },
    ],
    extras: [],
  }
  await writeFile(indexPath, JSON.stringify(index))
  return { root, library, indexPath, skillPath }
}

test('nowIso preserves timezone minutes', () => {
  const date = new Date('2026-10-29T15:56:49Z')
  date.getTimezoneOffset = () => -480
  assert.ok(nowIso(date).endsWith('+08:00'))
  date.getTimezoneOffset = () => -330
  assert.ok(nowIso(date).endsWith('+05:30'))
  date.getTimezoneOffset = () => 0
  assert.ok(nowIso(date).endsWith('+00:00'))
})

test('missing index initializes built-in taxonomy and supports first write', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'magpie-empty-index-'))
  const library = path.join(root, 'library')
  await mkdir(library)
  await writeSkill(library, 'new-tool', 'new tool description')
  const indexPath = path.join(root, 'nested', 'skills.json')
  const reader = createIndexReader(indexPath, { libraryRoot: library })
  const initial = await reader.read()
  assert.equal(initial.skills.length, 0)
  assert.equal(initial.scenes.length, 29)
  const update = createIndexUpdater(indexPath, { libraryRoot: library })
  const organizer = createOrganizer(indexPath, update, {
    libraryPath: library,
    libraryJsonPath: path.join(root, 'missing-library.json'),
  })
  const diff = await organizer.scan()
  assert.equal(diff.counts.new, 1)
  const result = await organizer.apply({
    classify: [
      { dir: 'new-tool', scene: 'agent', sceneIds: ['agent', 'ui'], gist: '验证空索引时' },
    ],
  })
  assert.equal(result.ok, true)
  assert.equal(result.verification.counts.pending, 0)
  const saved = JSON.parse(await readFile(indexPath, 'utf8'))
  assert.deepEqual(saved.scenes, SCENES)
  assert.equal(saved.schemaVersion, 2)
  assert.equal(saved.skills.length, 1)
  assert.equal(saved.skills[0].scene, 'agent')
  assert.deepEqual(saved.skills[0].sceneIds, ['agent', 'ui'])
  assert.equal(saved.libraryRoot, library)
  assert.equal(result.report.backup, null)
  await rm(root, { recursive: true, force: true })
})

test('scan reports only incremental new and body changes', async () => {
  const { root, library, indexPath, skillPath } = await fixture()
  const index = JSON.parse(await readFile(indexPath, 'utf8'))
  assert.equal((await scanIndex(index)).counts.unchanged, 1)
  await writeSkill(library, 'new-tool', 'new tool description')
  await writeFile(skillPath, '---\nname: existing\ndescription: demo description\n---\n\nChanged body only.\n')
  const diff = await scanIndex(index)
  assert.equal(diff.counts.new, 1)
  assert.equal(diff.counts.changed, 1)
  assert.equal(diff.counts.descChanged, 0)
  assert.equal(diff.counts.pending, 1)
  assert.equal(diff.library, library)
  assert.equal(diff.new[0].dir, 'new-tool')
  assert.equal(diff.changed[0].dir, 'existing')
  await rm(root, { recursive: true, force: true })
})

test('organizer applies decisions and shares its write queue with feedback', async () => {
  const { root, library, indexPath } = await fixture()
  await writeSkill(library, 'new-tool', 'new tool description')
  const update = createIndexUpdater(indexPath)
  const organizer = createOrganizer(indexPath, update, {
    libraryJsonPath: path.join(root, 'missing-library.json'),
  })
  const feedback = createFeedbackStore(indexPath, update)
  const [result] = await Promise.all([
    organizer.apply({ classify: [{ dir: 'new-tool', scene: 'agent', gist: '整理工具时' }] }),
    feedback.setFavorite('existing', true),
  ])
  assert.equal(result.ok, true)
  assert.deepEqual(result.report.added, ['new-tool'])
  assert.equal(result.verification.counts.pending, 0)
  const saved = JSON.parse(await readFile(indexPath, 'utf8'))
  const added = saved.skills.find((skill) => skill.name === 'new-tool')
  const existing = saved.skills.find((skill) => skill.name === 'existing')
  assert.equal(added.scene, 'agent')
  assert.equal(added.gist, '整理工具时')
  assert.equal(existing.favorite, true)
  assert.ok(existsSync(`${indexPath}.bak`))
  await rm(root, { recursive: true, force: true })
})

test('unchanged skills cannot be reclassified through organizer decisions', async () => {
  const { root, indexPath } = await fixture()
  const update = createIndexUpdater(indexPath)
  const organizer = createOrganizer(indexPath, update)
  await assert.rejects(
    organizer.apply({ classify: [{ dir: 'existing', scene: 'agent', gist: '乱改分类时' }] }),
    /unchanged skill/,
  )
  const saved = JSON.parse(await readFile(indexPath, 'utf8'))
  assert.equal(saved.skills[0].scene, 'ui')
  assert.equal(saved.skills[0].gist, '做演示时')
  await rm(root, { recursive: true, force: true })
})

test('assign updates navigation scenes without changing skill identity or hashes', async () => {
  const { root, indexPath } = await fixture()
  const before = JSON.parse(await readFile(indexPath, 'utf8')).skills[0]
  const organizer = createOrganizer(indexPath, createIndexUpdater(indexPath))
  const result = await organizer.apply({
    assign: [{ dir: 'existing', scene: 'ui', sceneIds: ['ui', 'agent'] }],
  })
  assert.deepEqual(result.report.assigned, ['existing'])
  assert.equal(result.verification.counts.unchanged, 1)
  const saved = JSON.parse(await readFile(indexPath, 'utf8'))
  assert.equal(saved.schemaVersion, 2)
  assert.deepEqual(saved.skills[0].sceneIds, ['ui', 'agent'])
  assert.equal(saved.skills[0].sha256, before.sha256)
  assert.equal(saved.skills[0].descHash, before.descHash)
  assert.equal(saved.skills[0].usageCount, before.usageCount)
  await rm(root, { recursive: true, force: true })
})

test('assign rejects new skills and duplicate scenes', async () => {
  const { root, library, indexPath } = await fixture()
  await writeSkill(library, 'new-tool', 'new tool description')
  const organizer = createOrganizer(indexPath, createIndexUpdater(indexPath))
  await assert.rejects(
    organizer.apply({
      assign: [{ dir: 'new-tool', scene: 'agent', sceneIds: ['agent'] }],
    }),
    /unknown existing dir/,
  )
  await assert.rejects(
    organizer.apply({
      assign: [{ dir: 'existing', scene: 'ui', sceneIds: ['ui', 'ui'] }],
    }),
    /duplicate sceneIds/,
  )
  await rm(root, { recursive: true, force: true })
})

test('no-op organization does not write or create a backup', async () => {
  const { root, indexPath } = await fixture()
  const before = await readFile(indexPath, 'utf8')
  const organizer = createOrganizer(indexPath, createIndexUpdater(indexPath))
  const result = await organizer.apply({ classify: [] })
  assert.equal(result.report.noop, true)
  assert.equal(result.verification.counts.pending, 0)
  assert.equal(await readFile(indexPath, 'utf8'), before)
  assert.equal(existsSync(`${indexPath}.bak`), false)
  await rm(root, { recursive: true, force: true })
})

test('post-write rescan failure is reported without hiding the successful write', async () => {
  const { root, library, indexPath } = await fixture()
  await writeSkill(library, 'new-tool', 'new tool description')
  const organizer = createOrganizer(indexPath, createIndexUpdater(indexPath))
  organizer.scan = async () => {
    throw new Error('library temporarily unavailable')
  }
  const result = await organizer.apply({
    classify: [{ dir: 'new-tool', scene: 'agent', gist: '整理工具时' }],
  })
  assert.equal(result.ok, true)
  assert.equal(result.verification.ok, false)
  assert.match(result.verification.error, /temporarily unavailable/)
  const saved = JSON.parse(await readFile(indexPath, 'utf8'))
  assert.ok(saved.skills.some((skill) => skill.name === 'new-tool'))
  await rm(root, { recursive: true, force: true })
})

test('one old hash is consumed by only one automatic rename', async () => {
  const { root, library, indexPath, skillPath } = await fixture()
  const index = JSON.parse(await readFile(indexPath, 'utf8'))
  const original = await readFile(skillPath, 'utf8')
  await rm(skillPath)
  for (const name of ['clone-a', 'clone-b']) {
    const directory = path.join(library, name)
    await mkdir(directory, { recursive: true })
    await writeFile(path.join(directory, 'SKILL.md'), original)
  }
  const diff = await scanIndex(index)
  assert.equal(diff.renames.length, 1)
  assert.equal(diff.new.length, 2)
  const renameDirs = new Set(diff.renames.map((item) => item.dir))
  const manual = diff.new.filter((item) => !renameDirs.has(item.dir))
  assert.equal(manual.length, 1)
  const result = await applyDecisions({
    index,
    decisions: {
      classify: manual.map((item) => ({ dir: item.dir, scene: 'agent', gist: '整理工具时' })),
    },
  })
  assert.equal(result.renamed.length, 1)
  assert.deepEqual(result.added, [manual[0].dir])
  assert.equal(index.skills.length, 2)
  await rm(root, { recursive: true, force: true })
})

test('mass removal guard fires before writing an empty map', async () => {
  const { root, library } = await fixture()
  const skills = Array.from({ length: 6 }, (_, i) => ({
    dir: `missing-${i}`,
    name: `missing-${i}`,
    scene: 'ui',
    gist: '演示时',
    path: path.join(library, `missing-${i}`, 'SKILL.md'),
  }))
  const index = {
    libraryRoot: library,
    scenes: [{ id: 'ui', zh: '界面', family: '做设计', when: '做界面时' }],
    skills,
  }
  await assert.rejects(applyDecisions({ index, decisions: { classify: [] } }), /refusing to remove 6/)
  assert.equal(index.skills.length, 6)
  await rm(root, { recursive: true, force: true })
})
