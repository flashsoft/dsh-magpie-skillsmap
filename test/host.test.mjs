import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  apply,
  createFeedbackStore,
  createIndexReader,
  createPreStepHandler,
  scanTokens,
  stripFrontmatter,
} from '../lib/index.js'

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'magpie-skillmap-'))
  const skillDir = path.join(root, 'demo-skill')
  await mkdir(skillDir, { recursive: true })
  const skillPath = path.join(skillDir, 'SKILL.md')
  await writeFile(
    skillPath,
    '---\nname: demo-skill\ndescription: demo skill\n---\n\nDo the demo thing.\n',
  )
  const indexPath = path.join(root, 'index.json')
  await writeFile(
    indexPath,
    JSON.stringify({
      libraryRoot: root,
      scenes: [{ id: 'ui', zh: '界面', family: '做设计', when: '做界面时' }],
      skills: [{ dir: 'demo-skill', name: 'demo-skill', scene: 'ui', gist: '演示时', path: skillPath }],
    }),
  )
  return { root, indexPath, skillPath }
}

test('scanTokens reads $kebab and /kebab tokens from user text only', () => {
  const names = scanTokens([
    {
      source: { kind: 'user' },
      content: [{ type: 'text', text: '整理一下 $demo-skill 和 /other-thing $demo-skill /ignored-command' }],
    },
    { source: { kind: 'skill-catalog' }, content: [{ type: 'text', text: '$hidden /hidden-too' }] },
  ])
  assert.deepEqual(names, ['demo-skill', 'other-thing', 'ignored-command'])
})

test('stripFrontmatter keeps the body', () => {
  assert.equal(stripFrontmatter('---\nname: x\n---\n\nbody\n'), '\nbody\n')
})

test('pre-step injects <skill_content> for a known $name', async () => {
  const { indexPath } = await fixture()
  const handler = createPreStepHandler(createIndexReader(indexPath))
  const result = await handler(
    {
      messages: [
        { source: { kind: 'user' }, content: [{ type: 'text', text: 'do it $demo-skill' }] },
      ],
      signal: new AbortController().signal,
    },
    async () => ({ kind: 'enter', messages: [] }),
  )
  assert.equal(result.messages.length, 1)
  const text = result.messages[0].content[0].text
  assert.match(text, /<skill_content name="demo-skill">/)
  assert.match(text, /Do the demo thing/)
  assert.equal(result.messages[0].source.kind, 'skill-invocation')
})

test('unknown $name leaves the decision untouched', async () => {
  const { indexPath } = await fixture()
  const handler = createPreStepHandler(createIndexReader(indexPath))
  const decision = { kind: 'enter', messages: [] }
  const result = await handler(
    {
      messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text: 'do $nope' }] }],
      signal: new AbortController().signal,
    },
    async () => decision,
  )
  assert.equal(result, decision)
})

test('feedback store persists usage, favorites, and timestamps', async () => {
  const { indexPath } = await fixture()
  const store = createFeedbackStore(indexPath)
  const usage = await store.recordUsage(['demo-skill', 'demo-skill'])
  assert.equal(usage[0].usageCount, 1)
  assert.ok(usage[0].lastUsedAt)
  const favored = await store.setFavorite('demo-skill', true)
  assert.equal(favored.favorite, true)
  assert.ok(favored.favoritedAt)
  const saved = JSON.parse(await readFile(indexPath, 'utf8'))
  assert.equal(saved.skills[0].usageCount, 1)
  assert.equal(saved.skills[0].favorite, true)
  assert.ok(saved.skills[0].lastUsedAt)
  assert.ok(saved.skills[0].favoritedAt)
  const reset = await store.resetUsage('demo-skill')
  assert.equal(reset.usageCount, 0)
  assert.equal(reset.lastUsedAt, undefined)
  const afterReset = JSON.parse(await readFile(indexPath, 'utf8'))
  assert.equal(afterReset.skills[0].usageCount, 0)
  assert.equal(afterReset.skills[0].lastUsedAt, undefined)
})

test('pre-step counts usage and preserves downstream decision fields', async () => {
  const { indexPath } = await fixture()
  const store = createFeedbackStore(indexPath)
  const handler = createPreStepHandler(createIndexReader(indexPath), store)
  const native = { source: { kind: 'skill-invocation', name: 'demo-skill' }, content: [] }
  const result = await handler(
    {
      messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text: 'do $demo-skill' }] }],
      signal: new AbortController().signal,
    },
    async () => ({ kind: 'enter', messages: [native], startsRequestSeries: true }),
  )
  assert.equal(result.messages.length, 1)
  assert.equal(result.startsRequestSeries, true)
  const saved = JSON.parse(await readFile(indexPath, 'utf8'))
  assert.equal(saved.skills[0].usageCount, 1)
})

test('pre-step leaves /name to a native catalog even without a downstream native message', async () => {
  const { indexPath } = await fixture()
  const handler = createPreStepHandler(createIndexReader(indexPath), createFeedbackStore(indexPath), {
    get: async (name) => ({ name, content: 'native' }),
  })
  const decision = { kind: 'enter', messages: [] }
  const result = await handler(
    {
      messages: [{ source: { kind: 'user' }, content: [{ type: 'text', text: 'do /demo-skill' }] }],
      signal: new AbortController().signal,
    },
    async () => decision,
  )
  assert.equal(result, decision)
  const saved = JSON.parse(await readFile(indexPath, 'utf8'))
  assert.equal(saved.skills[0].usageCount ?? 0, 0)
  assert.equal(saved.skills[0].lastUsedAt, undefined)
})

test('apply registers the pre-step listener and the index route', async () => {
  const { indexPath } = await fixture()
  const listeners = {}
  const runtimeSkills = []
  let route
  const ctx = {
    on: (event, fn) => {
      listeners[event] = fn
    },
    get: (name) =>
      name === 'skills'
        ? {
            register: (skill) => {
              runtimeSkills.push(skill)
              return () => {}
            },
          }
        : undefined,
    effect: (fn) => fn(),
    webServer: {
      register: (value) => {
        route = value
        return () => {}
      },
    },
  }
  apply(ctx, { indexPath, libraryJsonPath: path.join(path.dirname(indexPath), 'missing-library.json') })
  assert.equal(typeof listeners['agent/pre-step'], 'function')
  assert.equal(route.path, '/api/magpie-skillmap')
  assert.equal(runtimeSkills.length, 1)
  assert.equal(runtimeSkills[0].name, 'magpie-skill-organizer')
  assert.equal(runtimeSkills[0].provider, 'magpie-skillmap')
  assert.match(runtimeSkills[0].content, /你是增量分类器/)
  assert.match(runtimeSkills[0].content, /DeepSeek Harness Web GUI URL/)
  assert.match(runtimeSkills[0].content, /sceneIds/)
  assert.match(runtimeSkills[0].content, /唯一技能总数/)
  assert.match(runtimeSkills[0].content, /assign/)
  assert.doesNotMatch(runtimeSkills[0].content, /dsh-app:\/\/app\/api/)

  const chunks = []
  const res = {
    writeHead(status) {
      this.status = status
    },
    end(body) {
      chunks.push(body)
    },
  }
  await route.handler({ url: '/api/magpie-skillmap/index.json' }, res)
  assert.equal(res.status, 200)
  assert.match(chunks[0], /demo-skill/)

  const feedbackChunks = []
  const feedbackRes = {
    writeHead(status) {
      this.status = status
    },
    end(body) {
      feedbackChunks.push(body)
    },
  }
  await route.handler(
    {
      url: '/api/magpie-skillmap/feedback',
      method: 'POST',
      async *[Symbol.asyncIterator]() {
        yield JSON.stringify({ name: 'demo-skill', favorite: true })
      },
    },
    feedbackRes,
  )
  assert.equal(feedbackRes.status, 200)
  assert.match(feedbackChunks[0], /"favorite":true/)
  const saved = JSON.parse(await readFile(indexPath, 'utf8'))
  assert.equal(saved.skills[0].favorite, true)

  const scanChunks = []
  const scanRes = {
    writeHead(status) {
      this.status = status
    },
    end(body) {
      scanChunks.push(body)
    },
  }
  await route.handler({ url: '/api/magpie-skillmap/organize/scan', method: 'GET' }, scanRes)
  assert.equal(scanRes.status, 200)
  const scan = JSON.parse(scanChunks[0])
  assert.equal(scan.diff.counts.descChanged, 1)

  const organizeChunks = []
  const organizeRes = {
    writeHead(status) {
      this.status = status
    },
    end(body) {
      organizeChunks.push(body)
    },
  }
  await route.handler(
    {
      url: '/api/magpie-skillmap/organize/apply',
      method: 'POST',
      async *[Symbol.asyncIterator]() {
        yield JSON.stringify({ classify: [{ dir: 'demo-skill', scene: 'ui', gist: '演示时' }] })
      },
    },
    organizeRes,
  )
  assert.equal(organizeRes.status, 200)
  const organized = JSON.parse(organizeChunks[0])
  assert.equal(organized.ok, true)
  assert.equal(organized.verification.counts.pending, 0)
  const afterOrganize = JSON.parse(await readFile(indexPath, 'utf8'))
  assert.equal(afterOrganize.skills[0].favorite, true)
  assert.ok(afterOrganize.skills[0].descHash)

  const resetChunks = []
  const resetRes = {
    writeHead(status) {
      this.status = status
    },
    end(body) {
      resetChunks.push(body)
    },
  }
  await route.handler(
    {
      url: '/api/magpie-skillmap/feedback',
      method: 'POST',
      async *[Symbol.asyncIterator]() {
        yield JSON.stringify({ name: 'demo-skill', resetUsage: true })
      },
    },
    resetRes,
  )
  assert.equal(resetRes.status, 200)
  const reset = JSON.parse(resetChunks[0])
  assert.equal(reset.skill.usageCount, 0)
  assert.equal(reset.skill.lastUsedAt, undefined)
})

test('missing index file still serves taxonomy and scan instead of HTTP 400', async () => {
  const { root, indexPath } = await fixture()
  await rm(indexPath)
  let route
  const ctx = {
    on: () => {},
    effect: (fn) => fn(),
    webServer: {
      register: (value) => {
        route = value
        return () => {}
      },
    },
  }
  apply(ctx, {
    indexPath,
    libraryPath: root,
    libraryJsonPath: path.join(root, 'missing-library.json'),
  })
  async function request(url) {
    const chunks = []
    const res = {
      writeHead(status) {
        this.status = status
      },
      end(body) {
        chunks.push(body)
      },
    }
    await route.handler({ url, method: 'GET' }, res)
    return { status: res.status, body: JSON.parse(chunks[0]) }
  }
  const indexResponse = await request('/api/magpie-skillmap/index.json')
  assert.equal(indexResponse.status, 200)
  assert.equal(indexResponse.body.scenes.length, 29)
  assert.equal(indexResponse.body.skills.length, 0)
  const scanResponse = await request('/api/magpie-skillmap/organize/scan')
  assert.equal(scanResponse.status, 200)
  assert.equal(scanResponse.body.diff.counts.new, 1)
})
