window.__ModuleLoader__.load({
  id: 'dsh-skillsmap',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    const React = require('react')
    const h = React.createElement

    const NS = 'magpie-skillmap'
    const inject = ['commandUi', 'slots', 'sessions', 'conversation']

    // ---- shared open state -------------------------------------------------
    let state = { open: false, scene: null }
    const listeners = new Set()
    const store = {
      getSnapshot: () => state,
      subscribe(fn) {
        listeners.add(fn)
        return () => listeners.delete(fn)
      },
      set(next) {
        state = { ...state, ...next }
        for (const fn of [...listeners]) fn()
      },
      open(scene) {
        store.set({ open: true, scene: scene ?? null })
      },
      close() {
        store.set({ open: false, scene: null })
      },
    }

    // ---- index fetch -------------------------------------------------------
    let indexPromise = null
    let indexCache = null
    const lexiconListeners = new Set()
    function loadIndex() {
      if (indexPromise === null) {
        const url = new URL('api/magpie-skillmap/index.json', document.baseURI)
        indexPromise = fetch(url)
          .then((response) => {
            if (!response.ok) throw new Error(`index ${response.status}`)
            return response.json()
          })
          .then((value) => {
            indexCache = value
            for (const listener of [...lexiconListeners]) listener()
            return value
          })
          .catch((error) => {
            indexPromise = null
            throw error
          })
      }
      return indexPromise
    }

    function skillSceneIds(skill) {
      return Array.isArray(skill?.sceneIds) && skill.sceneIds.length > 0 ? skill.sceneIds : [skill?.scene]
    }

    function insertOrganizeSkill(inputApi, inputActions, draft) {
      const next = `${(draft || '').trimEnd()} /magpie-skill-organizer 整理 `.trimStart()
      if (inputApi?.setDraft) inputApi.setDraft(next)
      else if (inputActions?.setDraft) inputActions.setDraft(next)
      if (inputApi?.track) inputApi.track(next, next.length)
      else if (inputActions?.track) inputActions.track(next, next.length)
    }

    // ---- styles ------------------------------------------------------------
    const backdrop = {
      position: 'fixed',
      inset: 0,
      zIndex: 9999,
      background: 'rgba(0,0,0,.45)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    }
    const panel = {
      width: 'min(920px, 94vw)',
      height: 'min(640px, 86vh)',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--dsw-alias-bg-base, #1f1f1f)',
      color: 'var(--dsw-alias-label-primary, #eee)',
      border: '1px solid var(--dsw-alias-border-l2, #444)',
      borderRadius: 14,
      overflow: 'hidden',
      boxShadow: '0 24px 80px rgba(0,0,0,.5)',
    }
    const header = {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '12px 16px',
      borderBottom: '1px solid var(--dsw-alias-border-l2, #444)',
    }
    const body = { display: 'flex', flex: 1, minHeight: 0 }
    const rail = {
      width: 230,
      flex: 'none',
      overflowY: 'auto',
      padding: '8px 0',
      borderRight: '1px solid var(--dsw-alias-border-l2, #444)',
    }
    const railFamily = {
      padding: '10px 14px 4px',
      fontSize: 11,
      letterSpacing: '.06em',
      color: 'var(--dsw-alias-label-caption, #888)',
    }
    const railItem = (active) => ({
      display: 'block',
      width: '100%',
      textAlign: 'left',
      padding: '7px 14px',
      border: 0,
      cursor: 'pointer',
      background: active ? 'var(--dsw-alias-interactive-bg-hover, #333)' : 'transparent',
      color: 'inherit',
      fontSize: 13,
    })
    const main = { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }
    const search = {
      margin: '10px 14px 6px',
      padding: '7px 10px',
      borderRadius: 8,
      border: '1px solid var(--dsw-alias-border-l2, #444)',
      background: 'var(--dsw-alias-bg-layer-1, #262626)',
      color: 'inherit',
      fontSize: 13,
      outline: 'none',
    }
    const list = { flex: 1, overflowY: 'auto', padding: '4px 8px 12px' }
    const rowStyle = (picked) => ({
      display: 'grid',
      gridTemplateColumns: '24px minmax(0, 1fr) auto',
      columnGap: 12,
      rowGap: 4,
      alignItems: 'start',
      padding: '8px 12px',
      borderRadius: 8,
      cursor: 'pointer',
      background: picked ? 'var(--dsw-alias-interactive-bg-hover, #333)' : 'transparent',
    })
    const nameStyle = { fontSize: 14, lineHeight: '20px', fontWeight: 600 }
    const gistStyle = { fontSize: 12, lineHeight: '16px', color: 'var(--dsw-alias-label-tertiary, #aaa)' }
    const actionStyle = {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: 8,
      whiteSpace: 'nowrap',
      fontSize: 11,
      color: 'var(--dsw-alias-label-tertiary, #aaa)',
    }
    const sourceStyle = {
      justifySelf: 'end',
      maxWidth: 300,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      fontSize: 11,
      color: 'var(--dsw-alias-label-tertiary, #aaa)',
    }
    const repoStyle = { color: 'inherit', textDecoration: 'none' }
    const resetButton = (active) => ({
      padding: '1px 6px',
      border: '1px solid var(--dsw-alias-border-l2, #555)',
      borderRadius: 6,
      background: active ? 'var(--dsw-alias-interactive-bg-hover, #333)' : 'transparent',
      color: 'inherit',
      cursor: 'pointer',
      fontSize: 12,
    })
    const footer = {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '10px 16px',
      borderTop: '1px solid var(--dsw-alias-border-l2, #444)',
    }
    const button = (primary) => ({
      marginLeft: primary ? 'auto' : 0,
      padding: '6px 14px',
      borderRadius: 999,
      border: '1px solid var(--dsw-alias-border-l2, #555)',
      cursor: 'pointer',
      background: primary ? 'var(--dsw-alias-button-info-fill, #3b82f6)' : 'transparent',
      color: primary ? '#fff' : 'inherit',
      fontSize: 13,
    })
    const triggerButton = {
      height: 28,
      padding: '0 10px',
      borderRadius: 8,
      border: 'none',
      cursor: 'pointer',
      background: 'transparent',
      color: 'inherit',
      fontSize: 13,
    }
    const triggerHoverCss = `
      .magpie-skillmap-trigger {
        transition: background-color .12s ease, color .12s ease;
      }
      .magpie-skillmap-trigger:hover {
        background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06)) !important;
      }
      .magpie-skillmap-trigger:active {
        background: var(--dsw-alias-interactive-bg-active, rgba(0,0,0,.09)) !important;
      }
      .magpie-skillmap-trigger:focus-visible {
        outline: 2px solid var(--dsw-alias-focus-border, #3b82f6);
        outline-offset: 1px;
      }
    `

    const hoverCss = `
      .magpie-skillmap-gist { grid-column: 2; }
      .magpie-skillmap-source { grid-column: 3; }
      .magpie-skillmap-rail-item:hover,
      .magpie-skillmap-row:hover {
        background: var(--dsw-alias-bg-layer-1, #f4f7fb);
        box-shadow: inset 3px 0 0 var(--dsw-alias-button-info-fill, #3b82f6), inset 0 0 0 1px var(--dsw-alias-border-l1, #c7d2e2);
      }
      .magpie-skillmap-rail-item:focus-visible,
      .magpie-skillmap-row:focus-visible {
        outline: 2px solid var(--dsw-alias-focus-border, #3b82f6);
        outline-offset: -2px;
      }
      .magpie-skillmap-repo-link:hover {
        color: var(--dsw-alias-link-primary, #3b82f6);
        text-decoration: underline;
      }
      @media (max-width: 720px) {
        .magpie-skillmap-row {
          grid-template-columns: 24px minmax(0, 1fr);
        }
        .magpie-skillmap-actions,
        .magpie-skillmap-gist,
        .magpie-skillmap-source {
          grid-column: 2;
          justify-self: start;
        }
      }
    `

    // ---- insertion ---------------------------------------------------------
    function insertPicked(inputApi, inputActions, picked, draft) {
      const names = [...picked]
      if (names.length === 0) return
      const tokens = names.map((name) => `/${name}`).join(' ')
      const next = `${(draft || '').trimEnd()} ${tokens} `.trimStart()
      if (inputApi?.setDraft) inputApi.setDraft(next)
      else if (inputActions?.setDraft) inputActions.setDraft(next)
      if (inputApi?.track) inputApi.track(next, next.length)
      else if (inputActions?.track) inputActions.track(next, next.length)
    }

    function repositoryUrl(skill) {
      const source = skill.source || ''
      if (/^https?:\/\//.test(source)) return source
      if (/^[\w.-]+\/[\w.-]+$/.test(source)) return `https://github.com/${source}`
      return null
    }

    function SkillName({ skill }) {
      return h('div', { style: nameStyle }, skill.name)
    }

    function SkillSource({ skill }) {
      const url = repositoryUrl(skill)
      const source = skill.source || '本地安装'
      return h(
        'div',
        { className: 'magpie-skillmap-source', style: sourceStyle },
        url
          ? h(
              'a',
              {
                className: 'magpie-skillmap-repo-link',
                href: url,
                target: '_blank',
                rel: 'noreferrer',
                style: repoStyle,
                onClick: (event) => event.stopPropagation(),
              },
              source,
            )
          : h('span', null, source),
      )
    }

    function SkillMeta({ skill, onUsageReset }) {
      return h(
        'div',
        { className: 'magpie-skillmap-actions', style: actionStyle },
        h('span', { style: { fontVariantNumeric: 'tabular-nums' } }, `使用 ${skill.usageCount ?? 0} 次`),
        (skill.usageCount ?? 0) > 0
          ? h(
              'button',
              {
                type: 'button',
                className: 'magpie-skillmap-usage-reset',
                style: { ...resetButton(true), fontSize: 16, lineHeight: 1 },
                title: '清零使用次数并移出最常用',
                'aria-label': `清零使用次数 ${skill.name}`,
                onClick: (event) => {
                  event.stopPropagation()
                  onUsageReset(skill.name)
                },
              },
              '−',
            )
          : null,
      )
    }

    // ---- picker ------------------------------------------------------------
    function selectScene(setScene, setQuery, id) {
      setScene(id)
      setQuery('')
    }

    function Modal({ index, initialScene, inputApi, inputActions, onUsageReset = () => {}, onClose }) {
      const scenes = index.scenes || []
      const [scene, setScene] = React.useState(initialScene || 'favorites')
      const [query, setQuery] = React.useState('')
      const [picked, setPicked] = React.useState(() => new Set())
      const searchRef = React.useRef(null)
      const chooseScene = (id) => selectScene(setScene, setQuery, id)
      React.useEffect(() => {
        searchRef.current?.focus()
      }, [])

      const families = []
      for (const item of scenes) {
        let group = families.find((entry) => entry.name === item.family)
        if (group === undefined) {
          group = { name: item.family, scenes: [] }
          families.push(group)
        }
        group.scenes.push(item)
      }

      const byUsage = (a, b) =>
        (b.usageCount ?? 0) - (a.usageCount ?? 0) ||
        String(b.lastUsedAt ?? '').localeCompare(String(a.lastUsedAt ?? '')) ||
        a.name.localeCompare(b.name)
      const usedSkills = (index.skills || []).filter((skill) => (skill.usageCount ?? 0) > 0).sort(byUsage)
      const q = query.trim().toLowerCase()
      const visible = q
        ? (index.skills || [])
            .filter((skill) =>
              `${skill.name} ${skill.gist || ''} ${skill.scene} ${skillSceneIds(skill).join(' ')}`
                .toLowerCase()
                .includes(q),
            )
            .sort(byUsage)
        : scene === 'favorites'
          ? usedSkills
          : (index.skills || []).filter((skill) => skillSceneIds(skill).includes(scene)).sort(byUsage)
      const likeCount = usedSkills.length

      const toggle = (name) => {
        const next = new Set(picked)
        if (next.has(name)) next.delete(name)
        else next.add(name)
        setPicked(next)
      }

      const confirm = () => {
        let draft = ''
        try {
          draft = inputApi?.state?.getSnapshot?.()?.draft ?? ''
        } catch {}
        insertPicked(inputApi, inputActions, picked, draft)
        onClose()
      }

      const confirmOrganize = () => {
        let draft = ''
        try {
          draft = inputApi?.state?.getSnapshot?.()?.draft ?? ''
        } catch {}
        insertOrganizeSkill(inputApi, inputActions, draft)
        onClose()
      }

      const current = scenes.find((item) => item.id === scene)
      const currentLabel = scene === 'favorites' ? '最常用的' : current ? `${current.family} · ${current.zh}` : '选择场景'

      return h(
        'div',
        { style: backdrop, onMouseDown: (event) => event.target === event.currentTarget && onClose() },
        h('style', null, hoverCss),
        h(
          'div',
          { style: panel, role: 'dialog', 'aria-label': 'Magpie skills' },
          h(
            'div',
            { style: header },
            h('strong', { style: { fontSize: 15 } }, '技能地图'),
            h(
              'span',
              { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary, #aaa)' } },
              currentLabel,
            ),
            h('button', { type: 'button', style: { ...triggerButton, marginLeft: 'auto' }, onClick: onClose }, '关闭'),
          ),
          h(
            'div',
            { style: body },
            h(
              'div',
              { style: rail },
              h(
                'button',
                {
                  type: 'button',
                  className: 'magpie-skillmap-rail-item',
                  style: railItem(scene === 'favorites'),
                  onClick: () => chooseScene('favorites'),
                },
                `最常用的（${likeCount}）`,
              ),
              families.map((family) =>
                h(
                  React.Fragment,
                  { key: family.name },
                  h('div', { style: railFamily }, family.name),
                  family.scenes.map((item) =>
                    h(
                      'button',
                      {
                        key: item.id,
                        type: 'button',
                        className: 'magpie-skillmap-rail-item',
                        style: railItem(item.id === scene),
                        onClick: () => chooseScene(item.id),
                      },
                      `${item.zh}（${(index.skills || []).filter((s) => skillSceneIds(s).includes(item.id)).length}）`,
                    ),
                  ),
                ),
              ),
            ),
            h(
              'div',
              { style: main },
              h('input', {
                ref: searchRef,
                style: search,
                placeholder: '搜索技能名或一句话…',
                value: query,
                onChange: (event) => setQuery(event.target.value),
              }),
              h(
                'div',
                { style: list },
                visible.length === 0
                  ? h('div', { style: { padding: 16, fontSize: 13, opacity: 0.6 } }, '没有匹配的技能')
                  : visible.map((skill) =>
                      h(
                        'div',
                        {
                          key: skill.name,
                          className: 'magpie-skillmap-row',
                          style: rowStyle(picked.has(skill.name)),
                          onClick: () => toggle(skill.name),
                        },
                        h('input', {
                          type: 'checkbox',
                          readOnly: true,
                          checked: picked.has(skill.name),
                        }),
                        h(SkillName, { skill }),
                        h(SkillMeta, { skill, onUsageReset }),
                        h('div', { className: 'magpie-skillmap-gist', style: gistStyle }, skill.gist || ''),
                        h(SkillSource, { skill }),
                      ),
                    ),
              ),
            ),
          ),
          h(
            'div',
            { style: footer },
            h('span', { style: { fontSize: 12, opacity: 0.7 } }, `已选 ${picked.size} 个`),
            h('button', { type: 'button', style: button(false), onClick: onClose }, '取消'),
            h('button', { type: 'button', style: button(false), onClick: confirmOrganize, title: '以内置技能方式交给 AI 整理' }, '整理索引'),
            h('button', { type: 'button', style: button(true), onClick: confirm }, '插入技能'),
          ),
        ),
      )
    }

    function SkillButton() {
      return h(
        React.Fragment,
        null,
        h('style', null, triggerHoverCss),
        h(
          'button',
          {
            type: 'button',
            className: 'magpie-skillmap-trigger',
            style: triggerButton,
            title: '按场景选择技能',
            onClick: () => store.open(null),
          },
          '技能集',
        ),
      )
    }

    async function updateSkillFeedback(index, name, patch) {
      const url = new URL('api/magpie-skillmap/feedback', document.baseURI)
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, ...patch }),
      })
      const result = await response.json()
      if (!response.ok || !result.ok) throw new Error(result.error || `feedback ${response.status}`)
      const next = {
        ...index,
        skills: (index.skills || []).map((skill) =>
          skill.name === name ? { ...skill, ...result.skill } : skill,
        ),
      }
      indexCache = next
      indexPromise = Promise.resolve(next)
      return next
    }

    function resetSkillUsage(index, name) {
      return updateSkillFeedback(index, name, { resetUsage: true })
    }

    // Render the dialog in the composer's overlay slot, never in the left
    // toolbar slot. Keeping a fixed backdrop inside the toolbar can leave an
    // invisible hit target over neighbouring controls such as + and Send.
    function SkillOverlay(props) {
      const snapshot = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
      const [index, setIndex] = React.useState(null)
      const [error, setError] = React.useState(null)

      React.useEffect(() => {
        if (!snapshot.open) return
        let alive = true
        setError(null)
        indexPromise = null
        loadIndex()
          .then((value) => alive && setIndex(value))
          .catch((reason) => alive && setError(reason))
        return () => {
          alive = false
        }
      }, [snapshot.open])

      if (!snapshot.open) return null
      if (error !== null) {
        return h(
          'div',
          { style: { ...backdrop, color: '#fff' }, onClick: () => store.close() },
          `操作失败：${String(error?.message || error)}`,
        )
      }
      if (index === null) {
        return h('div', { style: { ...backdrop, color: '#fff' } }, '正在加载技能索引…')
      }
      return h(Modal, {
        index,
        initialScene: snapshot.scene,
        inputApi: props.inputApi,
        inputActions: props.inputActions,
        onUsageReset: async (name) => {
          try {
            setIndex(await resetSkillUsage(index, name))
          } catch (reason) {
            setError(reason)
          }
        },
        onClose: () => store.close(),
      })
    }

    // ---- plugin ------------------------------------------------------------
    function apply(ctx) {
      ctx.effect(
        () =>
          ctx.commandUi.register({
            name: 'skillsmap',
            description: () => '按场景选择 magpie 技能，选中后把 /name 插入草稿',
            available: () => true,
            ui: {
              kind: 'popupSelect',
              options: async () => {
                const index = await loadIndex()
                return (index.scenes || []).map((scene) => ({
                  id: scene.id,
                  label: `${scene.family} · ${scene.zh}`,
                  detail: scene.when,
                }))
              },
              onSelect: (option) => store.open(option.id),
            },
          }),
        'magpie-skillsmap: /skillsmap command',
      )

      const inputTriggers = ctx.get('inputTriggers')
      if (inputTriggers !== undefined) {
        ctx.effect(
          () =>
            inputTriggers.registerSource({
              trigger: '/',
              name: 'magpie-skillmap',
              order: 3,
              // Keep magpie skills out of the slash menu. The lexicon alone
              // drives composer highlighting for /name tokens.
              candidates: async () => [],
              warm() {
                loadIndex().catch(() => {})
              },
              lexicon() {
                return indexCache?.skills?.map((skill) => skill.name)
              },
              subscribeLexicon(_session, listener) {
                lexiconListeners.add(listener)
                return () => lexiconListeners.delete(listener)
              },
            }),
          'magpie-skillsmap: highlight-only / skill source',
        )
      }

      ctx.slots.inject('conversation.input.left', () =>
        ctx.slots.register(
          {
            name: 'conversation.input.left',
            id: 'magpie-skillmap',
            order: 30,
            locale: NS,
          },
          SkillButton,
        ),
      )

      ctx.slots.inject('conversation.input.overlay', () =>
        ctx.slots.register(
          {
            name: 'conversation.input.overlay',
            id: 'magpie-skillmap',
            order: 30,
            locale: NS,
            inject: (sessionId) => {
              try {
                const actx = ctx.sessions.scope(sessionId)
                return { inputApi: ctx.conversation.input.for(actx) }
              } catch {
                return {}
              }
            },
          },
          SkillOverlay,
        ),
      )
    }

    exports.apply = apply
    exports.inject = inject
    exports.__test = {
      store,
      Modal,
      SkillName,
      SkillSource,
      SkillMeta,
      SkillButton,
      SkillOverlay,
      loadIndex,
      resetSkillUsage,
      insertOrganizeSkill,
      skillSceneIds,
      selectScene,
      insertPicked,
    }
    return module.exports
  },
})
