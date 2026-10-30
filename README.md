# dsh-magpie-skillsmap (demo)

在 DSH 里按「6 族 / 29 场景」挑选 magpie 技能，把 `/skill-name` 插进当前消息；发送时由 host 插件把对应 `SKILL.md` 注入本轮。

这是可运行的 demo，不是完整产品：

- `/skillsmap` 命令：弹出场景列表（一级），选中场景后打开技能面板（二级）。
- 输入区「技能集」按钮：直接打开完整面板（左侧场景 / 右侧技能），hover 复用 DSH 原生交互背景。
- 技能面板支持搜索、多选；确认后把 `/name` 追加到草稿并高亮。
- host 端解析 `$name` 或 `/name`，注入 `<skill_content>`；同时提供索引读取、评分写回和增量整理接口。
- 面板底部「整理索引」只插入 `/magpie-skill-organizer 整理` 技能引用；发送时由原生机制注入内置 prompt，不依赖外部 indexer skill。
- Magpie 库技能仍走自定义面板；只有整理器注册为 `ctx.skills` 原生运行时技能，不改 DSH 核心。

## 数据

插件直接维护同一份索引文件：

```
~/.dsh/dsh-magpie-skillmap/skills.json
```

每个技能只有一份实体：`scene` 是用于统计的主场景，`sceneIds` 是 1–3 个导航场景且包含主场景。旧索引缺少 `sceneIds` 时自动按 `[scene]` 兼容。场景计数按唯一技能名去重；全局技能数始终为 `skills.length`，不能把各场景数量相加。

面板展示 `source` 仓库/作者；实际发送并注入时累计 `usageCount` 和 `lastUsedAt`，全部保存在 `skills.json` 中。最常用只收录 `usageCount > 0` 的技能，按使用次数降序排列，同次数时按最近使用排序。计数大于 0 时显示 `−`，点击将计数清零并删除 `lastUsedAt`，条目随即移出最常用；普通场景只更新计数不跳页。

## 整理索引

点击技能面板底部的「整理索引」后，插件只把 `/magpie-skill-organizer 整理` 插入当前输入框并关闭面板。它是插件注册的原生运行时技能，输入框保持紧凑；发送时由原生技能机制注入完整整理指令，AI 再执行：

1. AI 先调用 host 的 `organize/scan`，只处理新增、描述变更、正文变化、删除和同哈希改名。
2. AI 根据描述为新增与描述变更条目生成 `scene + sceneIds + gist` decisions；主场景用于统计，多场景用于导航，同哈希改名自动继承分类。
3. AI 调用 `organize/apply` 写回；只有正文变化时提交空 decisions 刷新哈希，批量删除默认被安全阈值阻止。
4. host 在写入前校验，保留 `.bak` 并原子替换；写回后自动重新扫描，AI 再调用 `organize/validate` 和 scan 复查。
5. 整理与使用计数、清零操作共享同一进程内串行写队列，避免相互覆盖。
6. 索引文件完全不存在时，读取和扫描会使用插件内置的 6 族 / 29 场景初始化空索引；首次写回自动创建目录和文件，不返回索引 400。

语义分类由 AI 完成，不使用关键词硬编码，也不渲染人工分类表单或把长 prompt 散落到输入框。外部 `magpie-skill-indexer` 不再是插件运行依赖；独立的 `magpie-skill-organizer` 运行时技能由插件直接提供。

明确要求调整现有技能导航归属时，可在 apply payload 中加入 `assign`；`assign` 只修改现有条目的 `scene/sceneIds`，不允许用于新增或描述变更，也不会复制技能或使用记录。

## 安装（当前 desktop profile）

```sh
# 1) 安装包（本地路径）
node ~/.dsh/profiles/node_modules/@deepseek-ai/dsh/lib/bin.js \
  plugin --profile desktop add /Users/flashsoft/workspace/dsh-magpie-skillmap

# 2) 在 ~/.dsh/profiles/desktop/cordis.patch.yml 增加：
# - insert:
#     - id: magpie-skillsmap
#       name: 'dsh-magpie-skillsmap'
#       config:
#         indexPath: /Users/flashsoft/.dsh/dsh-magpie-skillmap/skills.json

# 3) 重启 DSH
```

也可以把包直接软链到 `~/.dsh/profiles/desktop/node_modules/`，再按第 2 步加 insert。

## 验证

```sh
cd /Users/flashsoft/workspace/dsh-magpie-skillmap
node --test test/*.test.mjs
```

覆盖：`$name` 解析与注入、路由、`/skillsmap` 命令注册、二级面板渲染、token 插入、增量扫描与写回、无变化跳过、批量删除保护、整理与反馈串行写入、AI 整理 prompt 和 API。

浏览器验证（隔离实例）：`/skillsmap` → 场景列表 → 技能面板 →「整理索引」→ 输入框只出现 `/magpie-skill-organizer 整理`；返回后选 `research` → 草稿出现 `/research `。

## 限制

- 草稿插入是**追加到末尾**，不按光标位置。
- `/name` 通过独立 lexicon 高亮；技能不会加入原生 `/` 指令候选列表。
- 没有「最近使用」和未分类提示。
- 「整理索引」只填充草稿，不会自动发送；需要用户确认后由 AI 执行。

## 目录

- `lib/index.js`：host（注入、索引路由、串行写入）
- `lib/indexer.js`：内置增量扫描、决策应用与校验引擎
- `lib/organizer-prompt.js`：原生运行时整理技能的指令内容
- `lib/taxonomy.js`：插件持有的 6 族 / 29 场景与空索引初始化
- `lib/client.js`：浏览器 bundle（`/skillsmap` 命令 + 技能与整理面板）
- `cordis.patch.yml`：bundle patch
- `test/`：Node 单测
- `docs/`：验证截图
