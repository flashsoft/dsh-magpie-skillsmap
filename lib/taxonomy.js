// Canonical Magpie taxonomy owned by the plugin, not by an external skill or
// an existing index file. Each empty index receives an independent copy.
export const SCENES = [
  { id: 'research', zh: '调研与采集', family: '想清楚', when: '要查清一个领域、找资料、读文档、抓网页数据' },
  { id: 'reverse', zh: '逆向与拆解', family: '想清楚', when: '只有成品，想知道它到底怎么实现的' },
  { id: 'plan', zh: '需求与规划', family: '想清楚', when: '事情模糊，要先拆清楚做什么、先做什么' },
  { id: 'architecture', zh: '架构与选型', family: '想清楚', when: '要定系统结构、技术选型、接口与数据模型' },
  { id: 'prototype', zh: '原型与 Demo', family: '写代码', when: '要快速做出能看、能点的原型或一次性 demo' },
  { id: 'feature', zh: '功能开发', family: '写代码', when: '要在现有代码里把功能真正做出来' },
  { id: 'refactor', zh: '重构与迁移', family: '写代码', when: '要整理结构、去重复、升级依赖、迁移框架，且不改变行为' },
  { id: 'review', zh: '代码评审', family: '写代码', when: '要有人帮你挑代码/方案的问题，判断能不能合' },
  { id: 'test', zh: '测试与 QA', family: '写代码', when: '要补单测、跑 E2E、做压测、验证没坏' },
  { id: 'debug', zh: '调试与排障', family: '写代码', when: '报错、崩溃、变慢、线上问题要定位并修复' },
  { id: 'database', zh: '数据库与 SQL', family: '写代码', when: '要查库、设计表、加索引、优化 SQL' },
  { id: 'integration', zh: '接口与集成', family: '写代码', when: '要接第三方 API/SDK、鉴权、支付、消息队列' },
  { id: 'agent', zh: 'Agent 与工具链', family: '写代码', when: '要给 AI 造 skill/MCP/hook/plugin，或编排多 agent' },
  { id: 'ui', zh: '界面与视觉设计', family: '做设计', when: '要做页面、组件库、设计系统、视觉风格' },
  { id: 'motion', zh: '动效与 3D', family: '做设计', when: '要做动画、滚动叙事、WebGL/Three.js、3D 建模' },
  { id: 'media', zh: '图像与媒体', family: '做设计', when: '要生成/处理图片、封面、插画、视频、音频' },
  { id: 'deploy', zh: '部署与 CI/CD', family: '上线与安全', when: '要发布、容器化、搭流水线、开环境' },
  { id: 'observability', zh: '监控与告警', family: '上线与安全', when: '要看指标、日志、trace、看板、告警、值班' },
  { id: 'security', zh: '安全与合规', family: '上线与安全', when: '要做安全审计、渗透、密钥凭证、隐私合规' },
  { id: 'ctf', zh: 'CTF 与攻防演练', family: '上线与安全', when: '打 CTF、靶场、复现漏洞链、做取证题' },
  { id: 'analytics', zh: '数据分析与可视化', family: '数据与钱', when: '要清洗数据、做统计建模、出报表和看板分析' },
  { id: 'finance', zh: '金融与投资', family: '数据与钱', when: '做股票/公司研究、估值、财报、交易与投资判断' },
  { id: 'writing', zh: '文档与写作', family: '表达与协作', when: '要写文档、README、笔记、翻译、规范文本' },
  { id: 'presentation', zh: '汇报与演示', family: '表达与协作', when: '要做 PPT、方案宣讲、汇报材料' },
  { id: 'marketing', zh: '营销与内容', family: '表达与协作', when: '做 SEO、社媒、小红书、公众号、分发文案' },
  { id: 'teaching', zh: '教学与学习', family: '表达与协作', when: '要教人、写教程、带新人、给学习路线' },
  { id: 'office', zh: '办公协作', family: '表达与协作', when: '飞书/Office 文档、表格、日历、邮件、会议、生活事务' },
  { id: 'project', zh: '项目与团队管理', family: '表达与协作', when: '管任务、工单、MR、Git 分支、OKR、进度' },
  { id: 'automation', zh: '自动化与脚本', family: '表达与协作', when: '写脚本、定时任务、浏览器自动化、tmux 批处理' },
]

export function createEmptyIndex(libraryRoot) {
  return {
    schemaVersion: 2,
    taxonomyVersion: 1,
    updatedAt: null,
    libraryRoot,
    scenes: SCENES.map((scene) => ({ ...scene })),
    skills: [],
    extras: [],
  }
}
