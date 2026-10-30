export const ORGANIZER_SKILL_NAME = 'magpie-skill-organizer'

// Embedded runtime skill. It replaces the external skill at invocation time,
// while the plugin owns scanning, validation, taxonomy, and atomic writes.
export const ORGANIZER_SKILL_CONTENT = `请整理 Magpie 技能索引。你是增量分类器；插件已提供扫描、校验和写回能力。不要安装或调用其他同名外部 skill，不要修改 Magpie 技能库内任何文件，只通过插件本地 HTTP 接口读写索引。

接口路径：/api/magpie-skillmap/
执行 curl 时，HTTP origin 使用当前 runtime context 中的 DeepSeek Harness Web GUI URL。dsh-app://app 只是桌面内部协议，不可用于 curl。

硬性规则：
- 第一步必须扫描，先拿 counts 和 new / descChanged / removed 名单；不要凭感觉逐个打开 SKILL.md。
- 只分类 new 和 descChanged；unchanged 不动。纯正文变化只刷新哈希，同哈希改名自动继承分类。
- 先读取 index.json，严格使用插件返回的 6 族 / 29 场景，不新增场景。
- 每项选择一个主场景 scene 用于统计，并写 sceneIds 用于导航。sceneIds 必须包含主场景，允许 1-3 个，不允许重复；只有确实横跨多个场景才增加辅助场景，不要为了覆盖而覆盖。
- gist 写“什么时候用它”，不超过 18 个汉字且总长不超过 40 字符，不复述技能名。
- descChanged 默认保留原 scene 和 sceneIds，除非触发词明显改变；无论是否改分类，都必须提交 decision。
- 不修改 README / SCENE-MAP，不做全量重分类。索引文件不存在时，插件会提供内置分类体系和空索引，按首次建库处理，不要把缺文件当成 400 错误。
- 大量 removed 或库根异常时停止并向用户确认，不要允许批量删除来掩盖问题。

执行流程：
1. 用 curl 将 GET <HTTP-origin>/api/magpie-skillmap/organize/scan 保存到 /tmp/magpie-scan.json，同时读取 GET <HTTP-origin>/api/magpie-skillmap/index.json 的 scenes。
2. 若 pending=0 且 removed=0：changed>0 时用 {"classify":[]} 调用 apply 刷新哈希；否则报告“无变化”并结束。
3. 若 pending>0，只根据扫描结果中 new + descChanged 的 description 和触发词分类，生成 /tmp/magpie-decisions.json：
   {"classify":[{"dir":"目录名","scene":"主场景ID","sceneIds":["主场景ID","辅助场景ID"],"gist":"什么时候用它"}],"allowMassRemoval":false}
   每个非改名待处理项都必须有 decision。
4. 用 curl 以 application/json 将 decisions 文件 POST 到 <HTTP-origin>/api/magpie-skillmap/organize/apply。若因缺 decision 被拒绝，只补齐待处理项，不重分类其他技能。
5. 用 POST <HTTP-origin>/api/magpie-skillmap/organize/validate 校验，再 GET <HTTP-origin>/api/magpie-skillmap/organize/scan 复查。完成标准是 validate.ok=true，scan 的 pending=0、removed=0。
6. 最后读取 index.json，报告唯一技能总数和场景关联总数（后者可以大于技能数，禁止把各场景数量相加当技能总数），并说明新增、复核、正文刷新、删除、改名和 updatedAt；存疑分类单独列出，不贴整份 JSON。

如果用户明确要求调整现有技能的导航归属，可在 apply 请求中增加 assign；常规增量整理不要使用：
{"assign":[{"dir":"已存在目录名","scene":"主场景ID","sceneIds":["主场景ID","辅助场景ID"]}]}
assign 不能用于 new、descChanged，也不能绕过分类复核。

如果 apply 返回 ok=true 但 verification.ok=false，说明索引已经写入、只是写后复查失败；先重新扫描确认状态，不要直接重放旧 decisions。`
