# 术语背记站 TermLoop — 需求文档 v2.0

> 工作名：**TermLoop**（术语循环）
> 版本：v2.0 ／ 2026-10-30 ／ 单人自用 · Agent 优先 · 本地优先
> 一句话定位：**一份由 Agent 研究维护、由人复习确认的术语资产**——不是词书阅读器，也不是又一个背单词 App。

---

## 0. 这份文档怎么读

v2.0 **推翻了 v1.0 的三条地基**，不是在 v1.0 上打补丁。如果你只读一节，读 §0.1。

### 0.1 v1.0 → v2.0 的实质变更

| # | v1.0 的说法 | v2.0 的结论 | 为什么 |
|---|---|---|---|
| 1 | 真相源 = 浏览器 IndexedDB（Dexie） | 真相源 = **SQLite + 本地单写端服务** | 浏览器库没有端口，外部 Agent 物理上写不进去；手机也无法共享 |
| 2 | 「不做账号与云同步」+「手机可用可离线」 | 单实例 + **同一实例的多端瘦客户端**（Tailscale/LAN） | v1.0 这两条自相矛盾：两台设备 = 两个互不相通的库 |
| 3 | 词表 = `concepts` 表 + tag 视图 | 词表 = **一等资产**（termbank 快照，可 diff / 可回滚） | 「维护一份词表」要的是版本与审计，不是一张表 |
| 4 | 中文侧 = `zh[]` + `gloss` | 中文侧 = **name / explain / annotation 三段** | 261 条实测：中文列里混着译名、解释、别名、量纲、用途五种东西 |
| 5 | 一张表可以有中文，也可以没有 | **证据分级**：无 A/B 级证据不得产生译名 | 存量里已实测出「状态布居阈值」这类凭空补词 |
| 6 | 导入 = 拖列做列映射 | 导入 = **规则解析 → LLM 补分类 → 人工只审低置信度** | 现有数据只有 2 列纯文本，没有可映射的语义列 |
| 7 | AI 辅助是 P2 锦上添花 | **Agent 写入是一等输入通道**，审计是一等能力 | 新定位：Agent 优先 |

### 0.2 本轮已冻结的 14 个决策

| 编号 | 决策 |
|---|---|
| D1 | 单一写端：只有服务进程能写 SQLite；一切客户端走 HTTP/CLI |
| D2 | 词表额外以行式 JSONL 快照进 git；数据库管运行态，文本管资产 |
| D3 | Agent 写入分档：高风险（新建/改首选面/改判分规则）进 Draft；低风险直接生效留 Event |
| D4 | 范围锁定术语级，不做通用单词引擎（不建词形还原、不建词频） |
| D5 | 单实例 + 单所有者；手机经 Tailscale/LAN 连同一实例；不做多人协作 |
| D6 | 分享 = `.termpack` 导出 → 对方导入；不做只读网页 |
| D7 | 判分以规则为主，边界与申诉才调 LLM；LLM 与 TTS 共用同一 provider 抽象 |
| D8 | Surface 化：`en/zh/abbr/symbol` 不再是并列字段，改为带类型的 Surface 列表 |
| D9 | 不做 sense（义项）层；多义用 `domain` 标注或拆成两个 Term 互指 |
| D10 | 中文侧三态：`name` 可空，`explain` 不可空 |
| D11 | 证据四级：`unverified` / `A` / `B` / `C`，只有 `C` 剥夺译名资格 |
| D12 | 该门槛按 Term 判、软校验，绝不按单词判 |
| D13 | 审计为一等能力，但只做 API/CLI，不做 UI 表单 |
| D14 | 无 `Termlist` 实体；一个 Term 池 + `view`；termpack = 快照 |

### 0.3 术语

本文件中所有专有名词的权威定义见 [`CONTEXT.md`](../../CONTEXT.md)。实现代码、API 字段、UI 文案必须使用该文件里的名字，不得自造近义词。

---

## 1. 产品定位

### 1.1 主要操作者不是人

绝大多数学习产品假设「人录入 → 人复习」。本产品假设：

> **Agent 负责「这个词是什么、该怎么说、出处在哪」；人负责「我记住没有」。**

由此推出三条不可协商的设计原则：

**P1｜写入面必须对进程友好。** 优先级顺序是：HTTP/JSON > CLI > MCP > 网页表单。网页表单是**最后**才被优化的界面，因为它只服务于「临时改一条」这个低频场景。

**P2｜Agent 的输出必须可被证伪。** Agent 提交的不是「一个词对」，而是「一条带证据的主张」。没有 `evidence` 的主张不能升格为译名。

**P3｜人只做判断题，不做填空题。** 人的时间花在复习和「这条对不对」上，不花在录入、查词、排版上。任何需要人手工补齐字段的流程都是设计缺陷。

### 1.2 主用户

材料/物理方向研究生，研究方向为机器学习原子间势（MLIP）与晶格热输运。特征：

- 术语来源固定且可溯源：学位论文、LAMMPS 源码与文档、期刊论文
- 中英双向都要：读文献要 EN→ZH，写论文/答辩要 ZH→EN
- 会持续新增术语（每读一篇论文 20–40 条），且**新增发生在 Agent 侧**
- 设备：Mac 为主（读论文时），手机为辅（碎片时间）

### 1.3 非目标

- 不做社区、词书广场、排行榜
- 不做账号体系、不做多人协作、不做云同步
- 不做发音评测、不做 OCR 扫描导入
- 不做通用英语单词适配（不建词形还原、不建词频分级引擎）
- 不做 sense（义项）层
- 不做移动端原生 App（PWA + 同一实例即可）

---

## 2. 领域模型

### 2.1 关系图

```
Term（术语条目，kind ∈ 6 种）
 ├── surfaces[]     Surface：一个写法 + 类型 + 状态 + 证据
 ├── zh             name（可空）／ explain（不可空）／ name_evidence
 ├── annotations[]  五型注解：alias / catchword / dimension / usage / provenance
 ├── tags[]         自由标签（core / author / thermo / mlip …）
 ├── importance      1–5，仅用于排序与统计，不参与调度
 ├── level           general / academic / domain
 └── cards[]        派生卡，各自独立调度
       └── reviews[] 每次作答一条，永久保留

Draft     Agent 提交的改动建议 → 接受后进 Term，或合并进已有 Term
Event     任何写入的不可变记录（谁、何时、改了什么、能否回滚）
view      保存的过滤条件（不拥有数据）
termbank  词表的 JSONL 快照（可 diff、可回滚）
termpack  导出包（manifest + terms）
```

### 2.2 Term 的六个 kind

`kind` 是**结构枚举**，不是标签。它决定必填字段与自动生成的卡。

| kind | 覆盖对象 | 额外必填 | 自动生成的卡 |
|---|---|---|---|
| `term` | 名词性术语 | — | `en2zh`（name 非空时）、`zh2en`（name 非空且 name_evidence ≠ C）、`en2explain` |
| `phrase` | 重要表述 / 固定搭配 | 可选 `example` | `en2zh`、`zh2en`、`cloze`（P2） |
| `procedural` | 命令、报错、作业动作 | `context`（代码或报错片段） | `en2usage`、`scene2en` |
| `metric` | 指标、误差度量 | 缩写 Surface + 定义 | `abbr2full`、`en2zh` |
| `unit` | 单位、量纲 | 符号 Surface + 读法 | `symbol2name` |
| `symbol` | 数学/物理符号 | LaTeX Surface + 读法 | `symbol2name` |

> **为什么必须区分**：`meV/atom` 和 `potential energy surface` 需要的字段、题型、校验规则完全不同。用 tag 区分会导致「所有字段都可空」，最后没有一条数据是完整的。

### 2.3 中文侧

```jsonc
"zh": {
  "name": "势能面",              // 可为 null —— 找不到公认译法时就该空着
  "name_evidence": "unverified", // unverified | A | B | C
  "explain": "给定原子位置，体系能量是多少；力是它的梯度"  // 不可为空
}
```

规则：

- `name` 为 null 时，`en2zh` 与 `zh2en` 都不生成，只生成 `en2explain`
- `name_evidence = C` 时，视同 `name` 为 null（保留但隐藏），UI 显示「此译名无权威来源」
- `explain` 是**解释这句话**，不是**翻译这个词**。验收标准：一个没学过该领域的人读完能说出它在讲什么

### 2.4 annotation 的五种类型

旧数据里这些信息全挤在中文括号里，必须拆开——它们的生命周期和执行逻辑完全不同。

| 类型 | 用途 | 例子 | 是否进卡片 |
|---|---|---|---|
| `alias` | 别名 / 异称 | 「体序（源码文档）」 | 是，作为可接受答案 |
| `catchword` | 标记「这是论文自创名」 | 「材料物性场（论文自创名）」 | 是，作为警示标签 |
| `dimension` | 量纲 / 换算 | 「1 GPa = 10 kbar」 | 是，作为提示 |
| `usage` | 用途说明 | 「能量误差」 | 否 |
| `provenance` | 出处 | 「胡晏箫学位论文 §1.1」 | 是，作为溯源 |

### 2.5 证据分级

| 等级 | 判定依据 | 可否产生 `name` |
|---|---|---|
| `unverified` | 还没有人核查过（**所有新提交与全部存量的默认值**） | 可以，但界面标记 + 进审计待办 |
| `A` | 原始出处明确使用：论文正文 / 源码注释 / 规范文档，须带 locator | 可以 |
| `B` | 权威中文术语源：全国科学技术名词审定委员会、术语在线、国标、权威译著 | 可以 |
| `C` | 已核查，确认无权威中文来源 | **禁止**，只能写进 `explain` |

> 把 `unverified` 与 `C` 合并会让整条规则失效——要么把 261 条存量译名一夜判死，要么被静默忽略。详见 [ADR-0002](docs/adr/0002-no-translation-without-evidence.md)。

### 2.6 Term 的状态机

```
draft ──accept──> accepted ──activate──> active
  │                   │                    │
  └──reject──> ✗      └──archive──> archived <──┘
```

- **入库 ≠ 排复习**。迁移进来的 261 条可以是 `accepted` 且立刻 `active`，也可以先放着。
- 只有 `active` 的 Term 会生成卡片、进入复习队列。
- 归档是软删除，可恢复。

---

## 3. 编辑方针（Curation Policy）

这一节是**产品的一部分**，不是文档修辞。它必须同时以三种形态存在：(a) 本文件，(b) 仓库里的 `docs/policy/curation.md`，(c) 注入每个 Agent 的 prompt 与导入校验逻辑。

### 3.1 五条硬规则

**R1｜先查官方，再决定怎么说。** 每条 Term 的 `name` 必须能被 A 级或 B 级证据支撑；查不到就降级为 `explain`，不得自造。

**R2｜宁可没有译名，也不要编一个。** 中文侧永不空置：`name` 为 null 时 `explain` 必须写清楚「这个词怎么理解」。

**R3｜必须成对。** 每一行都是「英文侧 ↔ 中文侧（译名或解释）」的对照，不允许只有英文或只有中文。`explain` 不可为空正是为了兜住这条。

**R4｜补重要表述，不只补名词。** 固定搭配、常用句式（`run a job`、`blow up`、`out of memory`）同样是背诵对象，走 `phrase` / `procedural`。

**R5｜按重要性排序，不收录通用词。** 门槛按 **Term** 判定而非单词判定：`potential` 是高考词，`potential energy surface` 是硬术语，绝不能被同一个词典挡在外面。

### 3.2 「官方译法核查」的可执行定义

| 情形 | 处理 |
|---|---|
| 找到 A 级（论文/源码明确使用） | 记为 `name` + `name_evidence=A` + locator |
| 找到 B 级（名词委/术语在线/国标/权威译著） | 记为 `name` + `name_evidence=B` + 出处 |
| 多个中文译名并存且有争议 | 主流者为 `name`，其余进 `annotation(type=alias)`，UI 显示分歧 |
| 只有社群惯例或 LLM 推断 | **不得记为 name**，写入 `explain`，`name_evidence=C` |

### 3.3 常用但无对照的程序性词语

`pair_style`、`blow up`、`hang`、`segfault`、`ghost atom` 这类东西没有「官方中文译名」，但它们是最容易在调试时卡住的地方。它们的处理是 `kind=procedural` + `context`，中文侧给**操作性的解释**（「跑飞；数值爆炸」），且 `name_evidence` 恒为 `C` 或 `unverified`。

### 3.4 门槛判定（软校验）

导入或写入时，若整个 Term 的所有 Surface 都是通用词（`level=general`），返回 `warning: below_threshold` 并默认不生成卡片，但**不拒绝写入**。

理由：261 条里有 80 条是单字词，其中 20 余条是高考词汇（`build` / `link` / `node` / `core` / `thread` / `queue` / `batch` / `crash` / `hang`），而它们恰恰是调试时的核心词汇。硬过滤会删掉半份词表。

---

## 4. 功能需求

### 4.1 写入通道（Agent 优先）

| 编号 | 需求 | 验收 |
|---|---|---|
| F1.1 | `POST /api/v1/drafts` 单条提交，`POST /api/v1/drafts:batch` 批量提交（≤ 200 条/次） | 批量接口返回逐条结果，部分失败不整体回滚 |
| F1.2 | 每条 Draft 必须带 `evidence`；缺省视为 `unverified`，**不得缺省为 A** | 不带 evidence 的提交被接受但标记 |
| F1.3 | 所有写接口支持 `?dry_run=1`，返回「将会发生什么」而不落库 | dry_run 前后库无变化 |
| F1.4 | 支持 `Idempotency-Key` 头，24h 内同 key 同 payload 只执行一次 | 重复提交 10 次只产生 1 条 |
| F1.5 | 分档写入：新建 Term / 改 `preferred` Surface / 改判分规则 → 进 Draft；改 tag / annotation / importance → 直接生效但留 Event；删除 → 软删 + 可撤销 | 高风险写入在 Inbox 出现，低风险不出现 |
| F1.6 | `GET /api/v1/openapi.json` 自描述，`GET /agent.md` 给 Agent 的操作说明 | 一个陌生 Agent 只读这两个地址即可完成一次写入 |
| F1.7 | CLI 覆盖同一能力：`termloop add` / `import` / `export` / `audit` / `serve` | CLI 与 HTTP 走同一套 service 层 |

### 4.2 审计（Audit）

**定义**：给一份文档（Markdown / PDF 转文本 / 汇报稿），找出其中「AI 生成的、生硬翻译的、无出处的」科学词汇，并给出纠正。

| Finding 类型 | 判据 | 纠正方式 |
|---|---|---|
| `misattribution` | 中文写法对不上原始英文出处 | 给出原始英文 + locator |
| `invented` | 该词无公认中文译法，现有中文系自造 | 删除中文，改为「英文 + 解释」 |
| `nonstandard` | 存在权威译法，现用法不规范 | 给出权威译法 + 出处 |
| `slop` | 语序/搭配呈机翻痕迹 | 给出改写建议 |

| 编号 | 需求 | 验收 |
|---|---|---|
| F2.1 | `POST /api/v1/audit` 接收文本或文件引用，异步执行，返回 job id | 一份 5000 字文档 60s 内出报告 |
| F2.2 | 每条 Finding 带：原文片段 + 位置 + 类型 + 严重度 + 建议 + 证据 + 「是否命中现有 Term」 | 报告可直接对照原文定位 |
| F2.3 | Finding 可一键转成 Draft（修正版），进入 Inbox | 审计结果与词表维护闭环 |
| F2.4 | 支持对**存量词表**整体审计（`termloop audit --termbank`），把 `unverified` 批量升级为 A/B/C | 261 条跑完，输出变更清单 |
| F2.5 | 无 UI 表单；报告以 Markdown + JSON 双格式输出 | 不新增审计页面路由 |

### 4.3 导入与迁移

| 编号 | 需求 | 验收 |
|---|---|---|
| F3.1 | 两段式：`preview` 返回计划变更（新建 x 条 / 合并 y 条 / 冲突 z 条 / 警告 w 条），`commit` 才落库 | preview 与 commit 的计数一致 |
| F3.2 | 解析器支持「英文\<TAB\>中文」裸两列，并从括号内提取缩写/符号 | 261 条零丢失 |
| F3.3 | 中文侧拆分：`；` 前为 name、后为 explain；括号内容按五型分类 | 人工抽查 20 条，分类正确率 ≥ 85% |
| F3.4 | 无法规则判定的条目交 LLM 分类，标记 `confidence`，**只把 `confidence < 0.8` 的推给人审** | 261 条里人工需确认 ≤ 40 条 |
| F3.5 | 迁移全程可重放：同一条 seed 文件跑两次结果一致（幂等） | 二次导入产生 0 条新建 |
| F3.6 | 支持 CSV / TSV / JSON / JSONL / Markdown 表格 | 每种格式有一个 fixture 用例 |

详细的 261 条迁移规则见 **附录 A**。

### 4.4 复习与判分

| 编号 | 需求 |
|---|---|
| F4.1 | 卡片按 §2.2 的矩阵自动生成；规则变更时可整体重算（不丢历史） |
| F4.2 | 复习页必须先出答案再评分，不允许「看完答案直接下一张」 |
| F4.3 | 判分三层：归一化 → 规则匹配 → 边界升级（`partial`/申诉时可选调 LLM） |
| F4.4 | `verdict` 与 `rating` 分开存储；`decided_by ∈ {rule, llm, human}`；申诉保留原判 |
| F4.5 | 答不出时按空格展开答案，展开后只能评 `again`/`hard` |
| F4.6 | 全键盘：`Enter` 提交 → `Space` 展开 → `1/2/3/4` 评分 → `e` 编辑 → `u` 撤销 → `s` 跳过 |
| F4.7 | FSRS 调度（`ts-fsrs`），四档评分，`desired_retention` 默认 0.90（可调至 0.95） |
| F4.8 | 每日上限可配（默认新卡 20 / 复习 120），支持「今天只清 due，不学新卡」 |
| F4.9 | 每次调度结果写入 `reviews.sched`，**永远可重算**（review 是不可变事件） |

判分算法与单测锚点见 **附录 C**。

### 4.5 词表浏览与编辑

| 编号 | 需求 |
|---|---|
| F5.1 | 列表支持按 kind / tag / state / evidence / importance / 是否有 name 过滤，结果可存为 `view` |
| F5.2 | 详情页可编辑全部字段，`explain` 失焦即校验非空 |
| F5.3 | 显示「这条为什么会被判对」：把 name 与 alias 高亮在标准答案上 |
| F5.4 | 证据未核查（`unverified`）的条目有显著标记，可按此筛出待办 |
| F5.5 | 任何修改即时生成 Event，详情页可看该条的完整变更历史并回滚 |

### 4.6 诊断

输出「本周该补什么」清单（≤ 5 条），而不是一堆图表。指标：

| 指标 | 定义 |
|---|---|
| 维度遗忘率 | 按 tag 分组：`again` 次数 / 总作答 |
| 题型缺口 | `zh2en` 正确率 − `en2zh` 正确率（差值大 = 只会认不会写） |
| 证据缺口 | `unverified` 条目占比（这是你要还的技术债） |
| 判分质量 | 申诉率 > 10% 的卡（判分规则写坏了） |

### 4.7 分享与导出

| 编号 | 需求 | 验收 |
|---|---|---|
| F7.1 | 导出 `.termpack`：manifest + terms（默认剥除 reviews），可选包含 reviews | 对方导入后结构与来源完整 |
| F7.2 | 导出全量 JSON / 词表 CSV / termbank JSONL | JSONL 可被 git diff 阅读 |
| F7.3 | 导入 `.termpack` 时按 `id` 与 `slug` 双键去重，冲突给「保留本地 / 采用外来 / 并存」 | 重复导入不产生重复 |
| F7.4 | 不做只读分享网页、不做在线协作 |

### 4.8 发音

| 编号 | 需求 |
|---|---|
| F8.1 | 定义 `TTSProvider` 接口：`synthesize(text, opts) → audio`，实现三档 `none / local / cloud` |
| F8.2 | 内置实现：macOS `say`（本地默认）、浏览器 Web Speech（回退）、OpenAI-compatible（云端可选） |
| F8.3 | 音频按 `sha1(text + voice)` 落盘缓存至 `data/audio/`，命中即秒回 |
| F8.4 | UI 仅在卡片背面提供一个朗读按钮 |
| F8.5 | **不做听写题型**（术语的使用场景是读与写，听力无迁移价值） |

---

## 5. API 契约

### 5.1 通用约定

- Base：`http://127.0.0.1:7788/api/v1`
- 认证：`Authorization: Bearer <token>`，token 首次启动生成于 `~/.termloop/token`
- 归属：`X-TermLoop-Client: <agent-name>`，写入 Event 供追溯
- 幂等：写接口支持 `Idempotency-Key`
- 试运行：所有写接口支持 `?dry_run=1`
- 错误：RFC 9457 `application/problem+json`，含 `type` / `title` / `detail` / `instance`
- 时间：全部 ISO 8601 UTC
- 分页：keyset 分页（`?cursor=&limit=`），不用 offset

### 5.2 端点

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/health` | 存活与版本 |
| GET | `/openapi.json` | 自描述契约 |
| GET | `/terms` | 列表与检索（`q` / `kind` / `tag` / `state` / `evidence`） |
| GET | `/terms/:id` | 单条详情（含 surfaces / zh / annotations / cards 摘要） |
| PATCH | `/terms/:id` | 低风险字段直改（tag / annotation / importance / explain） |
| DELETE | `/terms/:id` | 软删（`state=archived`），可撤销 |
| POST | `/terms/:id/activate` | 启用复习 |
| GET | `/drafts` | Inbox 队列（`status=pending`） |
| POST | `/drafts` | 提交单条候选 |
| POST | `/drafts:batch` | 批量提交（≤ 200） |
| POST | `/drafts/:id/accept` | 接受（可携带最终字段覆盖） |
| POST | `/drafts/:id/reject` | 拒绝（须给 reason） |
| POST | `/drafts/:id/merge` | 合并进指定 Term |
| GET | `/review/next` | 取下一批待复习卡（`limit` 默认 1） |
| POST | `/review/:cardId/answer` | 提交作答，返回 verdict + 建议 rating |
| POST | `/review/:cardId/rate` | 覆盖 rating（人改判） |
| POST | `/import/preview` | 解析并返回计划变更 |
| POST | `/import/commit` | 执行导入 |
| GET | `/export` | `format=jsonl\|csv\|termpack\|json` |
| POST | `/audit` | 提交审计任务，返回 job id |
| GET | `/audit/:jobId` | 取报告（`status=running\|done\|failed`） |
| GET | `/events` | 变更流（按 target 或 actor 过滤） |
| POST | `/events/:id/revert` | 回滚一次写入 |
| POST | `/tts` | 取音频（命中缓存直接返回 302 到静态地址） |
| GET | `/stats/diagnostics` | 诊断指标 |

### 5.3 关键请求／响应示例

**提交候选（Agent 的典型调用）**

```http
POST /api/v1/drafts:batch
Authorization: Bearer <token>
X-TermLoop-Client: claude-code
Content-Type: application/json

{
  "source": {"doc": "Falk et al. 2024", "locator": "§3.2"},
  "items": [{
    "kind": "term",
    "surfaces": [
      {"type": "en", "text": "materials property field", "status": "preferred"},
      {"type": "abbr", "text": "MPF", "status": "preferred"}
    ],
    "zh": {"name": null, "explain": "把任意材料物性表示为一个可求导的场函数"},
    "evidence": [{"grade": "A", "type": "paper", "citation": "…", "locator": "§3.2"}],
    "importance": 4,
    "tags": ["author", "mpf"],
    "rationale": "原文只给了英文定义，没有中文译名，按 R2 不给译名"
  }]
}
```

```json
{
  "results": [{"index": 0, "status": "accepted", "draft_id": "d_01J…", "warnings": ["below_threshold"]}],
  "created": 1, "rejected": 0, "warnings": 0
}
```

**作答**

```json
// POST /review/k_01J.../answer
{"answer_raw": "potential energy surfaces", "elapsed_ms": 4200, "revealed": false}

// 200
{"verdict": "correct", "decided_by": "rule",
 "matched": ["exact_after_normalize"],
 "suggested_rating": "good",
 "answer": {"name": "势能面", "explain": "…", "provenance": "…"}}
```

### 5.4 安全（本机 HTTP 服务的必要条件）

本机端口并非「只有我能访问」：**任何在浏览器里打开的网页都可以 `fetch` 到 `127.0.0.1`**。因此：

1. 所有 `/api/v1/*` 需要 Bearer token（`/health` 与 `/openapi.json` 除外）。
2. 校验 `Origin`：非 `http://127.0.0.1:7788` 或 `http://localhost:7788` 的浏览器请求一律拒绝（CORS 预检直接 403）。
3. 默认只绑定 `127.0.0.1`；要供手机使用时显式 `--host 0.0.0.0` 并提示风险。
4. 写操作有速率限制（默认 60 次/分钟），防止 Agent 失控刷库。
5. `--readonly` 模式：只允许 GET，用于把实例临时暴露给别的 Agent 查询。

---

## 6. 技术方案

### 6.1 选型

| 层 | 选择 | 理由 | 备选 |
|---|---|---|---|
| 语言 | TypeScript（Node 22） | 前后端同语言，纯函数可直接被 Web 复用 | — |
| 服务端 | **Hono** | 极轻、路由即函数、原生支持 zod 校验与 `node-server` 适配器 | Fastify（更重）、NestJS（本项目不需要 DI 容器与模块系统） |
| 数据库 | **SQLite**（`better-sqlite3`, WAL） | 单文件、可复制、可备份、并发够用 | `node:sqlite`（实验性，API 尚薄） |
| 数据访问 | **裸 SQL + zod 校验的 repo 层** | 查询简单、语义透明、Agent 易读易改 | Drizzle（可行，但对本项目是额外抽象） |
| 迁移 | `schema_migrations` 版本表 + 代码内 `MIGRATIONS` 数组（`src/db/migrate.ts`） | 启动即迁移；只增不改；老库升级可验证 | 外置 `.sql` 文件（暂不需要） |
| 校验 | **zod** | 一份 schema 同时服务 API 入参、DB 出参、termpack 格式 | — |
| 前端 | React 19 + Vite + TypeScript | 生态最成熟，多平台构建一致 | — |
| 数据获取 | TanStack Query | 缓存、重试、失效语义完整 | — |
| UI 状态 | Zustand（仅复习会话） | 会话机状态不值得上更重的东西 | — |
| 样式 | 设计 token + 手写 CSS | 配色与排版是定制的，utility 反而更啰嗦；token 见 `web/src/styles.css` | Tailwind（可选） |
| 公式 | KaTeX | 比 MathJax 快一个量级 | — |
| 调度 | `ts-fsrs` | 现成 FSRS 实现，参数可调 | — |
| 测试 | Vitest + Playwright | 纯函数全覆盖 + 一条复习主链路 | — |
| 分发 | `npx termloop serve` / 单文件 bundle | 零安装启动 | Docker |

**明确不选 NestJS**：它的价值在模块边界、DI、微服务拆分——本项目只有一个进程、一个数据库、一个人。引入它会让「读懂整个系统」的成本翻倍，而这恰好是 Agent 协作最需要的属性。

### 6.2 进程与拓扑

```
┌──────────────────────────────────────────────┐
│  termloop serve（唯一写端）                    │
│  ├─ Hono: /api/v1/*        (JSON)            │
│  ├─ 静态托管: /            (web 构建产物)      │
│  ├─ SQLite: data/termloop.db  (WAL)          │
│  ├─ 快照:  termbank/terms.jsonl → git         │
│  └─ 缓存:  data/audio/                       │
└───────┬──────────────┬──────────────┬────────┘
        │              │              │
   Mac 浏览器      手机浏览器       Agent（CLI/MCP/HTTP）
   localhost       Tailscale IP     同一 token
```

开发期：`pnpm dev` 同时起 Vite（5173）与 Hono（7788），Vite 代理 `/api`。

### 6.3 目录结构

```
termloop/
├── CONTEXT.md                  # 领域词汇表（唯一权威）
├── docs/
│   ├── prd/PRD-v2.md
│   ├── adr/                    # 决策记录
│   └── policy/curation.md      # 编辑方针（注入 Agent prompt）
├── src/
│   ├── core/                   # 纯函数：无 IO、无框架、100% 单测
│   │   ├── grade.ts            #   normalize / gradeEn / gradeZh
│   │   ├── zh.ts               #   中文侧拆分与注解分类
│   │   ├── cardgen.ts          #   由 Term 生成卡片
│   │   └── schema.ts           #   zod：Term / Draft / termpack
│   ├── db/                     # schema.sql + repo 层
│   ├── api/                    # Hono 路由
│   ├── services/               # import / audit / tts / schedule / snapshot
│   ├── cli/                    # termloop 命令
│   └── mcp/                    # stdio MCP server
├── web/                        # React SPA（独立 vite 工程）
├── data/                       # 运行时，gitignore
│   ├── seed/termlist-sus2-261.tsv
│   └── audio/
├── termbank/terms.jsonl        # 词表资产快照（git 跟踪）
└── tests/
```

**架构约束**：`core/` 与 `services/` 不得 import React；`core/` 不得 import `db/`。这条约束由 ESLint 规则强制。

### 6.4 数据模型（SQLite）

```sql
CREATE TABLE terms (
  id TEXT PRIMARY KEY,            -- ULID，可排序
  slug TEXT NOT NULL UNIQUE,      -- 由首选 en Surface 生成，可手工改
  kind TEXT NOT NULL,             -- term|phrase|procedural|metric|unit|symbol
  level TEXT NOT NULL DEFAULT 'domain',
  importance INTEGER NOT NULL DEFAULT 3,
  state TEXT NOT NULL DEFAULT 'draft',  -- draft|accepted|active|archived
  domain TEXT,                    -- mlip|thermo|prog|math（替代 sense 层）
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE surfaces (
  id TEXT PRIMARY KEY, term_id TEXT NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  type TEXT NOT NULL,             -- en|zh|abbr|symbol|formula
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'preferred',  -- preferred|accepted|rejected
  evidence TEXT NOT NULL DEFAULT 'unverified', -- unverified|A|B|C
  locator TEXT,
  UNIQUE (term_id, type, text)
);

CREATE TABLE zh_sides (
  term_id TEXT PRIMARY KEY REFERENCES terms(id) ON DELETE CASCADE,
  name TEXT,                      -- 可为 NULL
  name_evidence TEXT NOT NULL DEFAULT 'unverified',
  explain TEXT NOT NULL,          -- 约束：非空
  CHECK (length(explain) > 0)
);

CREATE TABLE annotations (
  id TEXT PRIMARY KEY, term_id TEXT NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  type TEXT NOT NULL,             -- alias|catchword|dimension|usage|provenance
  text TEXT NOT NULL
);

CREATE TABLE cards (
  id TEXT PRIMARY KEY, term_id TEXT NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  direction TEXT NOT NULL,        -- en2zh|zh2en|en2explain|abbr2full|symbol2name|…
  enabled INTEGER NOT NULL DEFAULT 1,
  prompt_override TEXT,
  UNIQUE (term_id, direction)
);

CREATE TABLE reviews (
  id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES cards(id),
  ts TEXT NOT NULL, prompt TEXT NOT NULL, answer_raw TEXT,
  verdict TEXT NOT NULL, decided_by TEXT NOT NULL,
  rating TEXT NOT NULL, elapsed_ms INTEGER,
  sched_json TEXT NOT NULL,       -- 当时的 FSRS 输出，用于重算
  appeal_of TEXT,                 -- 指向被申诉的那条 review
  UNIQUE (card_id, ts)
);

CREATE TABLE drafts (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, source TEXT,
  actor_type TEXT NOT NULL, actor_name TEXT,
  payload_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  ai_confidence REAL, decided_at TEXT, decided_by TEXT, term_id TEXT, result_json TEXT
);

CREATE TABLE events (
  id TEXT PRIMARY KEY, ts TEXT NOT NULL,
  actor_type TEXT NOT NULL, actor_name TEXT,
  action TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL,
  diff_json TEXT, revertable INTEGER NOT NULL DEFAULT 1, reverted_by TEXT
);

CREATE TABLE audit_runs (
  id TEXT PRIMARY KEY, ts TEXT NOT NULL, input_ref TEXT NOT NULL,
  status TEXT NOT NULL, model TEXT
);

CREATE TABLE findings (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES audit_runs(id),
  type TEXT NOT NULL,             -- misattribution|invented|nonstandard|slop
  severity TEXT NOT NULL, snippet TEXT NOT NULL, location TEXT,
  suggestion TEXT, evidence_json TEXT, term_id TEXT
);
```

### 6.5 词表快照（termbank）

- 服务在每次写事务提交后（防抖 5s）把词表导出为 `termbank/terms.jsonl`，**一行一个 Term，按 id 升序**。
- 可选 `termloop snapshot --out` 手动生成。
- git 提供版本、diff、review、回滚；数据库提供运行态。
- 两者**永远不是双真相源**：JSONL 是只写的投影，从不被服务读取来覆盖数据库。

### 6.6 备份

| 对象 | 方式 | 频率 |
|---|---|---|
| `data/termloop.db` | 复制（WAL 需先 `VACUUM INTO`） | 每日自动，保留 7 份 |
| `termbank/terms.jsonl` | git commit | 每次快照 |
| `reviews` | 只存在于 db，属不可再生数据 | 同上第一条 |

启动时若超过 7 天未备份，顶部提示。

---

## 7. 交互与视觉

### 7.1 复习页（唯一高频页面）

```
┌────────────────────────────────────────────────┐
│ 12 / 43   ⚑ 作者自定义 · domain        ⏱ 04    │
├────────────────────────────────────────────────┤
│                                                │
│   moment tensor potential                      │   ← 大号衬线（拉丁用 serif，中文用黑体）
│   §4.2                                          │   ← 出处，小字可关
│   ┌──────────────────────────────────────┐      │
│   │ 你的答案…                             │      │
│   └──────────────────────────────────────┘      │
│   [ 显示答案  ␣ ]                                │
├────────────────────────────────────────────────┤
│   矩张量势          ✔ 命中 name                  │
│   以矩张量为基组、系数线性拟合的势               │   ← explain
│   出处：学位论文 §4.2.1        🔈                │
│   [1 忘了] [2 难] [3 记得] [4 太简单]            │
└────────────────────────────────────────────────┘
```

规则：答案展开后 `1/2` 可达，`3/4` 置灰（除非显式按住 `Shift` 强制）；禁止「看完答案直接下一张」。

### 7.2 Inbox（Agent 活动）

复习前的一个可选入口：`昨夜 Agent 提了 12 条 · 3 条待确认 · 2 条需要你判断译名`。

每条显示：Term + 提议 + 证据 + 一句话理由（`rationale`）。操作只有三个键：`A` 接受、`R` 拒绝、`M` 合并。**不做表单，只做判断题。**

### 7.3 其他页面

- `/import`：拖文件 → 规则解析预览 → 低置信度条目逐条确认 → 落库
- `/terms`：列表 + `view` 筛选 + 批量操作 + `unverified` 待办入口
- `/diagnostics`：5 条清单 + 4 个数字
- `/settings`：FSRS 参数、每日上限、TTS provider、备份、token 管理

### 7.4 视觉方向：Claude / Anthropic 气质

> 以下是**我给出的具体取值**，不是 Anthropic 的官方设计规范。请目视确认后再落代码。

**配色（暖、低饱和、纸感）**

```css
--bg:        #F7F4ED;  /* 暖米白，不用纯白 */
--surface:   #FDFCF9;  /* 卡片面 */
--ink:       #14130F;  /* 近黑，带褐 */
--muted:     #6F6A5F;  /* 次要文字 */
--line:      #E3DED2;  /* 发丝线 */
--accent:    #C15F3C;  /* 陶土橙，仅用于主操作与强调 */
--accent-soft:#F0E2D9;
--ok:        #4F6B52;  --warn: #B5822F;  --bad: #A2483A;
```

**字体**

| 用途 | 拉丁 | 中文 |
|---|---|---|
| 题面 / 标题 | `Newsreader`（衬线） | `Noto Serif SC` |
| 正文 / UI | `Inter` | `PingFang SC` / `Noto Sans SC` |
| 代码 / 公式 | `JetBrains Mono` | — |

> 中文**必须单独指定字体栈**，否则西文衬线回退会导致中英混排严重失衡。这是本设计最容易翻车的一点。

**规则**

- 分隔用 1px 发丝线，不用阴影；圆角上限 12px，按钮 8px
- 留白是主要视觉手段：复习页正文上下至少 96px
- 小标签用全大写 + `letter-spacing: .08em` + 12px
- 强调只用一个颜色（`--accent`），一屏最多出现两处
- 暗色模式 v1 不做（暖色纸感在暗色下会失效，做不好不如不做）

---

## 8. 非功能需求

| 项 | 要求 |
|---|---|
| 性能 | 作答→下一张 ≤ 100ms；1 万 Term 时列表首屏 ≤ 1s |
| 启动 | `npx termloop serve` 冷启动 ≤ 1.5s |
| 离线 | 服务在本地，天然离线；手机端离线时只读缓存 |
| 移动端 | 375px 宽可用；可添加到主屏（PWA manifest + 只读 SW 缓存） |
| 数据安全 | 词表变更全量可回滚；reviews 不可变；每日自动备份 |
| 可访问性 | 全键盘可操作；对比度 ≥ WCAG AA；`prefers-reduced-motion` 生效 |
| 可维护 | `core/` 与 `services/` 无 React 依赖；`core/` 单测覆盖 ≥ 90%；ESLint 强制分层 |
| Agent 可读性 | 单个文件 ≤ 300 行；路由、service、repo 一一对应；错误信息必须能直接指导修复 |
| 兼容 | Chrome / Safari(iOS 16+) 最近两个大版本；Node 22+ |

---

## 9. 里程碑

| 阶段 | 交付 | 验收（可测） | 估时 |
|---|---|---|---|
| **M0** | 仓库骨架、SQLite、Hono、token、health、CI | `npx termloop serve` 起得来，`/openapi.json` 可读 | 0.5d |
| **M1** | 领域模型落地：Term/Surface/zh_side CRUD、Event、termbank 快照 | 手工建 3 条 Term，JSONL 快照 diff 合理，回滚可用 | 1.5d |
| **M2** | 261 条迁移：规则解析 + LLM 补分类 + 低置信度人工确认 | 零丢失；人工确认 ≤ 40 条；二次导入 0 新建 | 1d |
| **M3** | 复习闭环：卡片生成、判分、FSRS、复习页 | 附录 C 单测全绿；键盘全链路可走 | 2d |
| **M4** | Agent 面：drafts、batch、idempotency、openapi、Inbox、CLI | 一个陌生 Agent 只读 `/agent.md` 完成一次批量写入 | 1.5d |
| **M5** | 审计：audit job、四类 Finding、存量审计 | 对 261 条跑完，产出可核对的变更清单 | 1.5d |
| **M6** | 分享与发音：termpack、TTS provider + 缓存 | 导出→另一实例导入，结构完整；音频二次命中 < 50ms | 1d |
| **M7** | 部署与移动端：PWA、Tailscale、备份策略 | 手机加到主屏可复习；备份恢复后 reviews 条数一致 | 1d |

**v1.0 目标：10 个工作日。** 比 v1.0 PRD 估的 6–8 天多 2–3 天，多出来的是 M2（迁移）与 M5（审计）——这两块 v1.0 完全没有。

---

## 10. 风险与开放问题

| 风险 | 影响 | 缓解 |
|---|---|---|
| 判分误判（尤其中文） | 高 | 规则可解释 + 边界调 LLM + 一键申诉 + 申诉率监控 |
| Agent 批量写入污染词表 | **高** | Draft 分档 + 幂等 + 速率限制 + Event 全量可回滚 |
| 证据债：261 条全是 `unverified` | 中 | 审计是他的一等能力；诊断页把「证据缺口」作为指标露出 |
| 自建站的维护成本反噬 | 中 | 单进程、零外部依赖、`npx` 启动 |
| 数据丢失（reviews 不可再生） | 高 | 不可变事件流 + 每日自动备份 + git 化词表 |
| 过度设计 | 中 | 严守 §1.3 非目标清单；任何新实体先问「能不能用现有字段表达」 |

**待你确认的 3 件事**

1. **视觉**：§7.4 的配色与字体是否合口味？特别是中文用 `Noto Serif SC` 做标题有没有太重。
2. **M2 的人工确认量**：如果 LLM 分类置信度调阈值后仍需人工确认 60+ 条，是否接受？（可调，但会影响到你开始使用的时间）
3. **TTS 默认 provider**：macOS `say` 零配置但只有 Mac 能发声；是否愿意为了手机也发声而默认走云端（产生 API 成本）？

---

## 附录 A：261 条存量迁移规则

输入：`data/seed/termlist-sus2-261.tsv`（261 行，TAB 分隔，2 字段，无表头）。

### A.1 流水线

```
① 逐行切分 TAB → [en_raw, zh_raw]
② en_raw 括号提取     → en surface + 候选第二表征
③ zh_raw 分号切分     → name + explain
④ zh_raw 括号提取     → annotation（五型分类）
⑤ kind 规则判定        → 命中则定，未命中交 LLM
⑥ 一致性校验          → explain 非空、无重复 Term、无孤儿符号
⑦ 产出 migrated.jsonl → 人工审低置信度 → commit
```

### A.2 规则细节

**② en 侧括号**

```
/^(.*?)\s*[(（]([^)）]+)[)）]\s*$/
```
括号内判定：
- 纯大写字母 2–6 位，或含数字 → `abbr`
- 含 `²` `³` `⁻` 或非 ASCII 符号 → `symbol`
- 其余 → `abbr` 并入，但标 `needs_review`

> 反例：`coefficient of determination (R²)` 的括号是**符号**不是缩写；`projector augmented-wave (PAW)` 是缩写。必须按模式判定，不能一律当缩写。

**③ zh 侧分号**

- 含 `；` → 第一段为 `name`，其余合并为 `explain`
- 不含 `；` → 整段先作 `name` 候选，`explain` 置空后由 ⑤ 补

> 261 条中仅 10 条含 `；`，因此**大部分 explain 需要单独生成**，这正是需要 LLM 的地方。

**④ zh 侧括号五型判定**

| 特征 | 类型 |
|---|---|
| 含 `称` / `旧称` / `又名` | `alias` |
| 含 `自创` / `论文` / `项目` | `catchword` |
| 含数字 + 单位字母，或 `≈` `=` | `dimension` |
| 含 `误差` / `吞吐` / `筛` / `用途` | `usage` |
| 含书名 / 章节 / 文件名 | `provenance` |
| 其余 | 追加进 `explain` |

**⑤ kind 判定**

| 条件 | kind |
|---|---|
| 匹配单位正则（`^(meV\|eV\|GPa\|THz\|fs\|ps\|ns\|W/\|cm²/s\|Matom)` 或含 `/` 且无空格） | `unit` |
| 命中程序性词表（`pair_style` `pair_coeff` `segfault` `OOM` `blow up` `hang` `crash` `queue` `build` `link` `node` `core` `thread` `log file` `input script` `module load` …） | `procedural` |
| 有 abbr 且中文含「误差/系数/率/度」 | `metric` |
| 纯符号（LaTeX 可表达） | `symbol` |
| 英文 ≥ 2 词且非上述 | `term` / `phrase`（含动词短语→`phrase`） |
| 其余 | 交 LLM |

**⑥ 统一后处理**

- 全部 `evidence = unverified`
- 全部 `state = active`（入库即可背，审计异步跟进）
- `importance`：含 `core` 语义或为高频量的记 4–5，程序性词语记 3，其余记 2–3
- 生成 `explain`：凡 `explain` 为空的条目，由 LLM 补一句大白话，标 `generated_by=llm`

### A.3 已知需人工复核的条目

| 行 | 英文 | 现中文 | 问题 |
|---|---|---|---|
| L49 | `asymptotic limit` | 渐近边界 | limit = 极限，非边界 |
| L78 | `basis size` | 基底条数 | 与 L42/L43 的「基组」不一致 |
| L126 | `state population` | 状态布居**阈值** | 英文无 threshold，凭空补词 |
| L254/255/256 | `W/(m·K)` 等 | 「热导率单位」 | 是用途不是读法，应为「瓦每米开尔文」 |

---

## 附录 B：termpack 规格

```
xxx.termpack            # zip
├── manifest.json
├── terms.jsonl         # 一行一个 Term，字段同 API
└── reviews.jsonl       # 可选，默认不含
```

```jsonc
// manifest.json
{
  "format": "termpack/1",
  "name": "SUS2 术语 261",
  "version": "2026.10.30",
  "created_at": "2026-10-30T03:00:00Z",
  "created_by": "termloop/0.1.0",
  "lang": ["en", "zh"],
  "license": "private",
  "attribution": "胡晏箫学位论文 / LAMMPS 文档",
  "counts": {"terms": 261, "with_name": 240, "unverified": 261},
  "filter": {"tags": ["core"], "kinds": ["term"]},
  "includes_reviews": false
}
```

导入规则：按 `id` 与 `slug` 双键去重；`id` 冲突视为同一条；`slug` 冲突但 `id` 不同 → 提示「并存 / 覆盖 / 跳过」。

---

## 附录 B.2：给编码 Agent 的启动提示

```
你在实现 TermLoop —— 一个本地优先、Agent 优先的术语背记站。
先读 CONTEXT.md（领域词汇，唯一权威）与 docs/prd/PRD-v2.md。

本轮范围：M0 + M1。
技术栈：Node 22 + TypeScript + Hono + better-sqlite3(WAL) + zod；前端 React 19 + Vite + Tailwind v4。
不要引入 NestJS、不要引入 ORM、不要引入 Redux。

硬性约束：
1. src/core/ 是纯函数，不 import db/、不 import React。先写测试再写实现。
2. 只有服务进程写数据库；任何客户端走 HTTP 或 CLI。
3. 每一笔写入必须产生一条 Event，且可回滚。
4. zh.explain 非空由数据库 CHECK 约束保证，不靠应用层自觉。
5. API 必须能通过 GET /openapi.json 自描述。
6. 字段名必须与 CONTEXT.md 一致，不得自造近义词。

完成后给出：路由清单、SQLite schema、npm test 输出、一次 dry_run 的 curl 示例。
```

---

## 附录 C：判分算法与单测锚点

### C.1 英文归一化

```ts
export type Verdict = 'correct' | 'partial' | 'wrong';

export function normalizeEn(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015-]/g, '-') // 各种连字符统一
    .replace(/[-_/]/g, ' ')                                   // 连字符→空格，视作分词
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')                        // 去标点，保留字母数字（含希腊字母）
    .replace(/\b(a|an|the)\b/g, ' ')                          // 只丢冠词，不丢介词
    .replace(/\s+/g, ' ')
    .trim();
}
```

> v1.0 的写法有三个 bug：`[^\w\s]` 会把 `κ`、`R²` 剥掉；`\b(\w+)(s|es|ies)\b` 会把 `studies` 变成 `stud`、`process` 变成 `proce`；整体丢弃介词会混淆 `equation of state`。

### C.2 单复数与规范化

```ts
function deplural(w: string): string {
  if (w.length <= 3) return w;
  if (w.endsWith('ies')) return w.slice(0, -3) + 'y';       // studies → study
  if (/(ses|xes|zes|ches|shes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('s') && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

const canon = (s: string) =>
  normalizeEn(s).split(' ').filter(Boolean).map(deplural).join(' ');
```

### C.3 英文判分

```ts
function lev(a: string, b: string): number { /* 标准 DP，略 */ }

export function gradeEn(input: string, accepted: string[]): Verdict {
  const a = canon(input);
  if (!a) return 'wrong';
  const pool = accepted.map(canon);
  if (pool.includes(a)) return 'correct';                       // 归一化后完全一致
  const sorted = (s: string) => [...new Set(s.split(' '))].sort().join(' ');
  if (pool.some(x => sorted(x) === sorted(a))) return 'correct'; // 词序不同
  if (a.length >= 8 && pool.some(x => lev(x, a) <= 1)) return 'correct'; // 手滑容错

  const at = new Set(a.split(' '));
  const covered = pool.some(x => {
    const xt = x.split(' ').filter(Boolean);                    // 去冠词后可能为空
    if (!xt.length) return false;
    return xt.filter(t => at.has(t)).length / xt.length >= 0.8; // 覆盖 ≥ 80%
  });
  return covered ? 'partial' : 'wrong';
}
```

### C.4 中文判分（含极简否定守卫）

```ts
const NEG = /[不非无未]+\s*$/;   // 关键词前紧邻否定词

export function gradeZh(input: string, must: string[], opt: string[] = []): Verdict {
  const s = input.replace(/\s+/g, '');
  if (!s) return 'wrong';
  const hit = (k: string) => {
    const i = s.indexOf(k);
    return i > 0 && NEG.test(s.slice(Math.max(0, i - 2), i)) ? false : i >= 0;
  };
  const hitMust = must.filter(hit).length;
  if (must.length > 0 && hitMust === must.length) return 'correct';
  const hitOpt = opt.filter(hit).length;
  const total = must.length + 0.5 * opt.length;
  if (total === 0) return 'wrong';
  return (hitMust + 0.5 * hitOpt) / total >= 0.5 ? 'partial' : 'wrong';
}
```

### C.5 单测锚点

```ts
// 归一化
normalizeEn("Machine-Learning  Interatomic Potentials") === "machine learning interatomic potentials"
normalizeEn("thermal conductivity κ") === "thermal conductivity κ"   // 希腊字母保留

// 英文判分
gradeEn("potential energy surfaces", ["potential energy surface"]) === "correct"  // 单复数同一术语
gradeEn("machine learning interatomic potential", ["machine-learning interatomic potential (MLIP)"]) === "correct"
gradeEn("potetial energy surface", ["potential energy surface"]) === "correct"    // 单次手滑
gradeEn("potential energy", ["potential energy surface"]) === "partial"           // 覆盖 2/3 < 0.8 → wrong?
gradeEn("kinetic energy", ["potential energy surface"]) === "wrong"

// 中文判分
gradeZh("势能面", ["势能面"], []) === "correct"
gradeZh("力是它的梯度", ["势能面"], ["能量"]) === "wrong"          // 没提势能面
gradeZh("势能面，梯度给出力", ["势能面"], ["梯度"]) === "correct"
gradeZh("这不是势能面", ["势能面"], []) === "wrong"                // 否定守卫
```

> ⚠️ `gradeEn("potential energy", ["potential energy surface"])` 的期望值取决于覆盖阈值。按当前 0.8 规则应为 `wrong`（2/3 ≈ 0.67）。这一条在实现时请以测试为准，不要凭直觉改常数。

### C.6 verdict → rating 映射

| verdict | decided_by | 建议 rating |
|---|---|---|
| `correct` | rule | `good` |
| `correct` | llm（申诉改判） | `hard` |
| `partial` | rule / llm | `hard` |
| `wrong` | rule | `again` |

映射只是**建议**，`rating` 最终由人决定；两者分开存储，申诉不覆盖原 `verdict`（新开一条 `review`，`appeal_of` 指向原记录）。
