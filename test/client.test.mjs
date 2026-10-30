import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const index = {
  scenes: [
    { id: 'ui', zh: '界面与视觉设计', family: '做设计', when: '做界面时' },
    { id: 'refactor', zh: '重构与迁移', family: '写代码', when: '整理代码时' },
  ],
  skills: [
    {
      name: 'frontend-design',
      scene: 'ui',
      gist: '设计页面视觉',
      source: 'anthropics/skills',
      usageCount: 2,
      lastUsedAt: '2026-10-29T01:00:00.000Z',
    },
    {
      name: 'behavior-preserving-refactor',
      scene: 'refactor',
      gist: '整理存量代码',
      source: '本地安装',
      usageCount: 1,
      lastUsedAt: '2026-10-29T02:00:00.000Z',
    },
    { name: 'lower-priority', scene: 'refactor', gist: '排序靠后', usageCount: 5 },
  ],
}

async function loadBundle() {
  const code = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  let factory
  const calls = []
  const sandbox = {
    window: { __ModuleLoader__: { load: (entry) => (factory = entry.factory) } },
    document: { baseURI: 'http://localhost/' },
    fetch: async (url, options) => {
      calls.push({ url: String(url), options })
      if (options?.method === 'POST') {
        const body = JSON.parse(options.body)
        return { ok: true, json: async () => ({ ok: true, skill: body }) }
      }
      return { ok: true, json: async () => index }
    },
    URL,
    console,
  }
  vm.runInNewContext(code, sandbox)
  assert.equal(typeof factory, 'function')
  const exports = factory((id) => {
    if (id === 'react') return React
    throw new Error(`unexpected require: ${id}`)
  })
  exports.__calls = calls
  return exports
}

test('client bundle registers /skillsmap, keeps the toolbar trigger mounted, and separates its overlay', async () => {
  const exports = await loadBundle()
  let command
  let inputSource
  const slots = {}
  const ctx = {
    effect: (fn) => fn(),
    get: (name) =>
      name === 'inputTriggers'
        ? { registerSource: (value) => ((inputSource = value), () => {}) }
        : undefined,
    commandUi: { register: (value) => ((command = value), () => {}) },
    slots: {
      inject: (name, cb) => cb(),
      register: (spec, component) => ((slots[spec.name] = { spec, component }), () => {}),
    },
    sessions: { scope: () => ({}) },
    conversation: { input: { for: () => ({ setDraft: () => {}, state: { getSnapshot: () => ({ draft: '' }) } }) } },
  }
  exports.apply(ctx)
  assert.equal(command.name, 'skillsmap')
  assert.equal(typeof command.description, 'function')
  assert.equal(command.description(), '按场景选择 magpie 技能，选中后把 /name 插入草稿')
  assert.equal(inputSource.trigger, '/')
  assert.equal((await inputSource.candidates({}, { query: '' })).length, 0)
  inputSource.warm()
  await exports.__test.loadIndex()
  assert.deepEqual(inputSource.lexicon(), ['frontend-design', 'behavior-preserving-refactor', 'lower-priority'])
  const options = await command.ui.options()
  assert.equal(options.length, 2)
  assert.equal(options[0].label, '做设计 · 界面与视觉设计')

  command.ui.onSelect({ id: 'refactor' })
  const snapshot = exports.__test.store.getSnapshot()
  assert.equal(snapshot.open, true)
  assert.equal(snapshot.scene, 'refactor')

  assert.equal(slots['conversation.input.left'].spec.id, 'magpie-skillmap')
  assert.equal(slots['conversation.input.overlay'].spec.id, 'magpie-skillmap')
  assert.equal(slots['conversation.input.overlay'].component, exports.__test.SkillOverlay)

  const toolbarHtml = renderToStaticMarkup(
    React.createElement(slots['conversation.input.left'].component),
  )
  assert.match(toolbarHtml, /技能集/)
  assert.match(toolbarHtml, /magpie-skillmap-trigger/)
  assert.match(toolbarHtml, /magpie-skillmap-trigger:hover/)
  assert.match(toolbarHtml, /--dsw-alias-interactive-bg-hover/)
  assert.doesNotMatch(toolbarHtml, /正在加载技能索引|Magpie skills/)
})

test('Modal renders scenes and skills', async () => {
  const exports = await loadBundle()
  const html = renderToStaticMarkup(
    React.createElement(exports.__test.Modal, {
      index,
      initialScene: 'ui',
      inputApi: { state: { getSnapshot: () => ({ draft: '' }) }, setDraft: () => {} },
      onClose: () => {},
    }),
  )
  assert.match(html, /界面与视觉设计/)
  assert.match(html, /frontend-design/)
  assert.match(html, /anthropics\/skills/)
  assert.match(html, /href="https:\/\/github.com\/anthropics\/skills"/)
  assert.match(html, /使用 2 次/)
  assert.match(html, /插入技能/)
  assert.match(html, /整理索引/)
  assert.doesNotMatch(html, /按场景/)
  assert.match(html, /\.magpie-skillmap-rail-item:hover/)
  assert.match(html, /\.magpie-skillmap-row:hover/)
})

test('insertPicked appends /name tokens to the draft and tracks the caret', async () => {
  const exports = await loadBundle()
  let draft
  let tracked
  exports.__test.insertPicked(
    {
      setDraft: (next) => (draft = next),
      track: (next, caret) => (tracked = { next, caret }),
      state: { getSnapshot: () => ({ draft: '' }) },
    },
    null,
    new Set(['frontend-design', 'behavior-preserving-refactor']),
    '帮我做这个',
  )
  assert.equal(draft, '帮我做这个 /frontend-design /behavior-preserving-refactor ')
  assert.deepEqual(tracked, { next: draft, caret: draft.length })
})

test('SkillName is plain text while SkillSource owns the repository link', async () => {
  const exports = await loadBundle()
  const skill = index.skills[0]
  const nameHtml = renderToStaticMarkup(React.createElement(exports.__test.SkillName, { skill }))
  assert.doesNotMatch(nameHtml, /<a\s/)
  const sourceHtml = renderToStaticMarkup(React.createElement(exports.__test.SkillSource, { skill }))
  assert.match(sourceHtml, /magpie-skillmap-repo-link/)
  assert.match(sourceHtml, /href="https:\/\/github.com\/anthropics\/skills"/)
  const modalHtml = renderToStaticMarkup(React.createElement(exports.__test.Modal, { index, onClose: () => {} }))
  assert.match(modalHtml, /magpie-skillmap-repo-link:hover/)
})

test('SkillMeta hides reset at zero and clears usage above zero', async () => {
  const exports = await loadBundle()
  const zero = renderToStaticMarkup(
    React.createElement(exports.__test.SkillMeta, {
      skill: { name: 'demo', usageCount: 0 },
      onUsageReset: () => {},
    }),
  )
  const used = renderToStaticMarkup(
    React.createElement(exports.__test.SkillMeta, {
      skill: { name: 'demo', usageCount: 3 },
      onUsageReset: () => {},
    }),
  )
  assert.doesNotMatch(zero, /magpie-skillmap-usage-reset|加入最常用|>+<\/button>/)
  assert.match(used, /使用 3 次/)
  assert.match(used, /aria-label="清零使用次数 demo"/)
  assert.match(used, />−<\/button>/)
})

test('multi-scene skills appear in every scene but remain one favorite/entity', async () => {
  const exports = await loadBundle()
  assert.equal(exports.__test.skillSceneIds({ scene: 'ui' }).join(','), 'ui')
  const multiIndex = {
    scenes: index.scenes,
    skills: [
      {
        name: 'multi-scene',
        scene: 'ui',
        sceneIds: ['ui', 'refactor'],
        gist: '跨场景导航时',
        usageCount: 2,
      },
    ],
  }
  const ui = renderToStaticMarkup(
    React.createElement(exports.__test.Modal, { index: multiIndex, initialScene: 'ui', onClose: () => {} }),
  )
  const refactor = renderToStaticMarkup(
    React.createElement(exports.__test.Modal, {
      index: multiIndex,
      initialScene: 'refactor',
      onClose: () => {},
    }),
  )
  assert.match(ui, /multi-scene/)
  assert.match(refactor, /multi-scene/)
  assert.match(refactor, /重构与迁移（1）/)
  const favorites = renderToStaticMarkup(
    React.createElement(exports.__test.Modal, { index: multiIndex, initialScene: 'favorites', onClose: () => {} }),
  )
  assert.equal((favorites.match(/aria-label="清零使用次数 multi-scene"/g) || []).length, 1)
})

test('selectScene clears the current search query', async () => {
  const exports = await loadBundle()
  let scene
  let query = 'as'
  exports.__test.selectScene((value) => (scene = value), (value) => (query = value), 'ui')
  assert.equal(scene, 'ui')
  assert.equal(query, '')
})

test('Modal opens 最常用的 with used skills sorted by usage count', async () => {
  const exports = await loadBundle()
  const like = renderToStaticMarkup(
    React.createElement(exports.__test.Modal, { index, onClose: () => {} }),
  )
  assert.match(like, /最常用的/)
  assert.doesNotMatch(like, /最近使用/)
  assert.ok(like.indexOf('lower-priority') < like.indexOf('frontend-design'))
  assert.ok(like.indexOf('frontend-design') < like.indexOf('behavior-preserving-refactor'))
  assert.equal(like.split('aria-label="清零使用次数 behavior-preserving-refactor"').length - 1, 1)

  const rated = renderToStaticMarkup(
    React.createElement(exports.__test.Modal, { index, initialScene: 'refactor', onClose: () => {} }),
  )
  assert.ok(rated.indexOf('lower-priority') < rated.indexOf('behavior-preserving-refactor'))
})

test('resetSkillUsage posts reset action and updates the index', async () => {
  const exports = await loadBundle()
  const next = await exports.__test.resetSkillUsage(index, 'frontend-design')
  assert.equal(next.skills[0].resetUsage, true)
  const call = exports.__calls.find((entry) => entry.options?.method === 'POST')
  assert.deepEqual(JSON.parse(call.options.body), { name: 'frontend-design', resetUsage: true })
})

test('organize action inserts a compact native skill reference and tracks the caret', async () => {
  const exports = await loadBundle()
  let draft
  let tracked
  exports.__test.insertOrganizeSkill(
    {
      setDraft: (next) => (draft = next),
      track: (next, caret) => (tracked = { next, caret }),
    },
    null,
    '保留我的前文',
  )
  assert.equal(draft, '保留我的前文 /magpie-skill-organizer 整理 ')
  assert.equal(draft.includes('请整理 Magpie 技能索引'), false)
  assert.deepEqual(tracked, { next: draft, caret: draft.length })
})
