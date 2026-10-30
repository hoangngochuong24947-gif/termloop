# 术语背记站 需求文档（PRD）v1.0

> 工作名：**TermLoop**（术语循环）
> 版本：v1.0 ／ 2026-10-30 ／ 单人自用为主、可扩展多人
> 一句话定位：**为"术语级 / 短语级 / 符号级"知识设计的主动回忆系统**，而不是为四六级单词设计的词书阅读器。

---

## 1. 背景：为什么现有产品不够用

扇贝、不背单词、墨墨这类产品的数据模型是「**一个英文单词 + 一个中文义项**」，用它装专业术语会遇到 6 个硬伤（全部来自实际使用，不是猜的）：

| # | 缺口 | 具体表现 | 后果 |
|---|---|---|---|
| 1 | 一条术语其实是"多表征" | `moment tensor potential` / `MTP` / `矩张量势` 是同一个概念；`κ` 与 `thermal conductivity` 也是 | 一个概念被迫拆成 3 张卡，复习量翻三倍，且彼此不联动 |
| 2 | 中文译名不唯一 | `cutoff radius` 有时叫截断半径、有时叫截断距离；`body order` 学位论文叫"体阶"、源码文档叫"体序" | 用字符串比对判分必错；扇贝只能绑死一个译名 |
| 3 | 专业短语无词库 | 261 条里约 90% 是短语，官方词库不收录，导入后"无释义" | 只能纯单词导入，释义全丢，等于白记 |
| 4 | 卡片结构不能自定义 | 装不下：公式（$\phi_{ij}$）、单位（meV/Å）、出处（论文 §4.2）、代码命令（`pair_style sus2/mtp`）、一句大白话解释 | 术语的"上下文"全被砍掉，记成孤立的词 |
| 5 | 出题方向不可控 | 只会 EN→ZH，不会 ZH→EN、不会"缩写→全称"、不会"给场景说术语" | 只能"认得"，不能"产出"，而答辩/写作要的是产出 |
| 6 | 调度黑箱 + 无诊断 | 改不了目标记忆率、看不到"哪个维度最弱" | 无法针对知识缺口刻意练习 |

**结论**：需要的不是一个"更好的词书"，而是「**概念 → 多个表征 → 多题型卡片 → 可诊断的调度**」这套结构。

---

## 2. 用户与场景

**主用户（唯一 P0 用户）**：材料/物理方向研究生，研究方向为机器学习原子间势（MLIP）与热输运。特征：
- 术语来源固定且可溯源：学位论文、源码文档、PNAS 论文
- 在乎"能讲清楚"而不是"眼熟"：需要主动产出（中→英、英→中、缩写、符号）
- 中英双向都要：读文献要 EN→ZH，写论文/答辩要 ZH→EN
- 会持续新增术语（每读一篇论文加 20–40 条）
- 设备：PC 为主（读论文时），手机为辅（碎片时间）

**三个核心场景**
1. **读论文时增量录入（30 秒内完成）**：选中一段 → 粘贴 → 自动拆成「英文/中文/出处」三格 → 存。
2. **每天 12 分钟集中复习**：打开就出题，键盘 `1/2/3/4` 评分，不看解释就不给过。
3. **答辩前专项查漏**：看"按维度统计的遗忘率"，专攻 `⚑作者自定义词` 这类高危项。

---

## 3. 目标与非目标

**目标（MVP 必须有）**
- G1 一条概念能挂多个表征（英文短语、缩写、中文名、符号），一处修改全站同步
- G2 至少 4 种题型，且可按概念指定"要考哪几种"
- G3 判分能容忍译名差异与书写差异，误判可一键纠正并反哺规则
- G4 复习调度用公开算法（FSRS），参数可调、可解释
- G5 数据 100% 可导出（JSON），不锁定
- G6 手机可用、可离线

**非目标（v1 明确不做）**
- 不做社区/词书广场/排行榜
- 不做账号体系与云同步（单人单机，靠导出备份）
- 不做发音评测、不做 OCR 扫描导入
- 不做通用英语单词（四六级）适配——不优化那个场景

---

## 4. 核心概念与数据模型

### 4.1 两层结构（这是与扇贝最根本的区别）

```
Concept（概念，唯一的"知识单元"）
 ├── surfaces: 表征列表   en[] / zh[] / abbr[] / symbol / formula
 ├── answer_spec: 判分规格  keywords_must[] / keywords_optional[] / accepted_en[]
 ├── meta: 标签、出处、一句话解释、备注、单位
 └── Cards（同一概念派生出的多张卡，共享调度历史？→ 不共享，各自调度）
       ├── en2zh     英文 → 中文
       ├── zh2en     中文 → 英文
       ├── abbr2full 缩写 → 全称
       ├── symbol2name 符号 → 含义
       └── define    给场景/大白话 → 说出术语
```

> 设计决定：**卡片各自独立调度**（因为"认得"和"写得出"是两种能力，混在一起会互相污染间隔）。

### 4.2 存储 schema（JSON，直接可做 IndexedDB 表或 SQLite 表）

```jsonc
// concepts
{
  "id": "c_0001",
  "en": ["potential energy surface", "PES"],     // 主表征在前
  "zh": ["势能面"],
  "abbr": ["PES"],
  "symbol": null,                                 // 如 "κ"、"r_c"、"φ_ij"
  "formula": null,                                // KaTeX 字符串，如 "\\phi_{ij}"
  "gloss": "给定原子位置，体系能量是多少；力是它的梯度",  // 一句话大白话
  "answer_spec": {
    "keywords_must": ["势能面"],
    "keywords_optional": ["能量", "梯度"],
    "accepted_en": ["potential energy surface", "PES", "potential-energy surface"]
  },
  "tags": ["core", "pes", "ch1"],
  "source": { "doc": "胡晏箫学位论文", "locator": "§1.1 / 摘要", "type": "thesis" },
  "note": "与 potential（势函数本身）区分：potential energy 是它给出的能量值",
  "units": null,
  "created_at": "2026-10-30T11:00:00Z",
  "updated_at": "2026-10-30T11:00:00Z"
}
```

```jsonc
// cards
{ "id":"k_0001a", "concept_id":"c_0001", "direction":"en2zh", "enabled":true, "prompt_override":null }

// reviews（每次作答一条，永久保留，用于统计与重算）
{ "id":"r_...", "card_id":"k_0001a", "ts":"2026-10-30T11:02:00Z",
  "rating":3,                    // 1=Again 2=Hard 3=Good 4=Easy
  "answer_raw":"势能面，力是梯度", "verdict":"correct",  // correct|partial|wrong|appealed
  "elapsed_ms":4200,
  "sched": { "stability":2.4, "difficulty":4.1, "due":"2026-11-02T00:00:00Z", "reps":3 } }

// decks（视图，不复制数据）
{ "id":"d_core", "name":"SUS2 核心 261", "filter": { "tags_any":["core"], "limit":null } }
```

### 4.3 字段字典（关键几条）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `en[]` | string[] | 是 | 允许多写法（`machine-learning` / `machine learning`）；第 0 个为主写法 |
| `zh[]` | string[] | 是 | 允许多译名（体阶/体序），判分时任一命中即算对 |
| `answer_spec.keywords_must` | string[] | 是 | 中文答案的**必含词**，用于模糊判分 |
| `answer_spec.accepted_en` | string[] | 否 | 英文答案的白名单（含缩写、连字符变体），不填则由 `en[]` 自动生成 |
| `source.locator` | string | 否 | 可定位到章节/文件行，保证可追溯 |
| `formula` | string | 否 | KaTeX 源码，前端 `katex.renderToString` 渲染 |

---

## 5. 功能需求

### 5.1 词库导入（P0）

| 编号 | 需求 | 验收 |
|---|---|---|
| F1.1 | 支持 CSV / TSV / JSON 导入；自动识别分隔符与编码（UTF-8/GBK） | 现有 261 条 CSV 3 秒内导入完成，0 报错 |
| F1.2 | 列映射界面：把文件列拖到 `en/zh/abbr/symbol/gloss/source/tags` | 支持任意列顺序，映射可保存为模板 |
| F1.3 | 导入前预览：显示"将创建 X 个概念、Y 张卡"，可勾选"自动生成 en2zh + zh2en 卡" | 预览数字与落库一致 |
| F1.4 | 去重：按 `en[0]` 归一化（小写、去连字符、去括号）比对，冲突时给出"合并/跳过/新建"三选项 | 重复导入同一文件不产生重复概念 |
| F1.5 | 粘贴快速录入：一个输入框，按 `英文 ⇥ 中文 ⇥ 出处` 三列粘贴多行 | 30 秒内可录入 1 条新术语 |

### 5.2 词条编辑（P0）

| 编号 | 需求 |
|---|---|
| F2.1 | 概念编辑页：可增删 `en/zh` 表征、编辑 keywords、填公式（带 KaTeX 实时预览）、贴代码块、写备注 |
| F2.2 | "为什么这么判分"可视化：把 `keywords_must` 高亮在标准答案上，避免事后才发现判分规则写错 |
| F2.3 | 批量操作：按标签批量启用/停用某类卡片（如"全部 ⚑ 作者自定义词 只开 zh2en"） |
| F2.4 | 反向生成：从 `en` 自动生成 `accepted_en`（含连字符/空格变体、括号缩写），可手工补 |

### 5.3 卡片类型与出题（P0）

| 题型 | 题干 | 答案判定 |
|---|---|---|
| `en2zh` | 显示英文（+出处标签） | 中文关键词命中 |
| `zh2en` | 显示中文/大白话 | 英文白名单匹配 |
| `abbr2full` | 显示 `MPF` | 全称 `material property field` |
| `symbol2name` | 显示 `$\kappa$` 或 `r_c` | 名称 `thermal conductivity` / `cutoff radius` |
| `define`（P1） | 给"论文里那句话/那个场景" | 说出术语（口语容错度更高，靠关键词） |
| `cloze`（P2） | 把术语从一句英文里挖空 | 填空匹配 |

规则：
- 每张卡显示 `出处`（可选开关，默认显示——**溯源是记忆的钩子**）
- **不允许"看完答案直接点下一张"**：必须先评分（1–4），避免自我欺骗
- 答不出时按 `Space` 展开答案，展开后只能评 1 或 2

### 5.4 判分（P0，本项目最难也最值钱的一块）

判分必须"容忍表达差异、拒绝意思错误"。三层处理：

**① 归一化（英文）**
```
lowercase → 去首尾空白 → 连续空格压成一个 → 连字符/下划线统一成空格
→ 去句末标点 → 单复数归一（s/es/ies 简单规则表）
```
**② 匹配（英文）**
- 命中 `accepted_en` 任一 → `correct`
- 与某白名单项的**词集 Jaccard ≥ 0.8** → `partial`（例：`potential energy surfaces` vs `potential energy surface`）
- 否则 `wrong`

**③ 匹配（中文）**
- `keywords_must` **全部命中** → `correct`
- 命中率 ≥ 60% 且未出现"否定词/反义词" → `partial`
- 否则 `wrong`
- 中文不做字数/语序要求（"力是它的梯度"与"梯度给出力"等价）

**三档结果的调度映射**：`correct→Good(3)`、`partial→Hard(2)`、`wrong→Again(1)`；用户可手动改档。

**申诉闭环（必须有）**
- 每次作答后出现"我答的其实对"按钮 → 该 `review.verdict` 记为 `appealed`
- 申诉时弹出"把你的答案加进白名单 / 加进关键词"一键操作
- 申诉率统计：>10% 的卡在诊断页标红（说明判分规则需要重写）

### 5.5 复习调度（P0）

- 算法：**FSRS-4.5**（开源、参数少、可与 Anki 互操作），4 档评分
- 默认 `desired_retention = 0.90`（专业术语可调到 0.92–0.93）
- 每天上限：新卡 20、复习 120（可调）
- 两种队列：`due`（按到期）+ `new`（按标签优先级：`⚑ 作者自定义` > `核心` > 其他）
- 允许"今天不学新卡"（一键只清 due）
- 每次调度计算写进 `reviews.sched`，**永远可重算**（数据是不可变事件流）

### 5.6 缺口诊断（P1，用户明确要的"主动诊断"）

| 指标 | 定义 | 用途 |
|---|---|---|
| 维度遗忘率 | 按 `tags` 分组：`Again 次数 / 总作答` | 找出"哪个知识维度最烂"（如 `热输运` 45% vs `MPF` 12%） |
| 题型缺口 | `zh2en` 正确率 − `en2zh` 正确率 | 差值大 = 只会认不会写，需加产出练习 |
| 稳定性分布 | 各卡 `stability` 直方图 | 长期记忆有多少卡真正"扎根" |
| 判分质量 | `appealed / total` 按卡排序 | 找出判分规则写坏的卡 |
| 待确认项 | `source` 为空的卡 | 防止"记了但不知道哪来的" |

输出一张"本周该补什么"的清单（前 5 条），而不是一堆图表。

### 5.7 溯源与富内容（P0）

- 卡片背面固定显示：`出处 = 文档名 § 章节`（可点击复制）
- 支持行内/块级 KaTeX（`$...$`、`$$...$$`）
- 支持代码片段等宽渲染（`pair_style sus2/mtp`）
- 支持"备注警告"（如"body order：学位论文叫体阶，源码叫体序，统一用体阶"）

### 5.8 统计与导出（P1）

- 导出：全量 JSON（concepts + cards + reviews）、CSV（仅词表）
- 导入：从导出的 JSON 恢复，**复习历史无损**
- 可选：导出 Anki `.apkg`（P2）

### 5.9 增强（P2，明确排后）

- 语音朗读（Web Speech API，读英文术语）
- AI 辅助：粘贴论文段落 → 自动抽候选术语 + 建议中文 + 建议 keywords（人工确认后入库）
- 移动端手写/语音输入

---

## 6. 交互规格

### 6.1 复习页（唯一高频页面，必须极简）

```
┌──────────────────────────────────────────┐
│  12 / 43   [SUS2 核心]        ⏱ 00:04    │  ← 顶部：进度、词书、计时（可选关）
├──────────────────────────────────────────┤
│                                          │
│   moment tensor potential                │  ← 题干（大字，等宽/衬线分明）
│   [ ⚑ 作者自定义 ] [ §4.2 ]              │  ← 标签 + 出处（小字，可关）
│                                          │
│   ┌────────────────────────────────┐      │
│   │ 你的答案…                      │      │  ← 输入框（Tab 聚焦）
│   └────────────────────────────────┘      │
│                                          │
│   [ 显示答案 ␣ ]                          │
├──────────────────────────────────────────┤
│  答案：矩张量势                            │
│  ✔ 命中关键词：矩张量  /  ✘ 未提"势"       │  ← 判分依据可视化
│  出处：学位论文 §4.2.1                     │
│  备注：MTP 属"矩张量基组 + 线性拟合"族      │
│                                          │
│  [1 忘了] [2 难] [3 记得] [4 太简单]       │
└──────────────────────────────────────────┘
```

**键盘映射（桌面必须全键盘可操作）**：`Enter` 提交 → `Space` 显示答案 → `1/2/3/4` 评分 → `e` 编辑此概念 → `s` 跳过 → `u` 撤销上一次评分。

### 6.2 其他页面

- `/import`：导入向导（拖文件 → 列映射 → 预览 → 落库）
- `/concepts`：列表 + 筛选（标签、题型、待确认、申诉率高）+ 批量编辑
- `/diagnostics`：本周该补什么（5 条清单 + 4 个数字）
- `/settings`：FSRS 参数、每日上限、是否显示出处/标签、导出/恢复

---

## 7. 技术方案（建议）

### 7.1 选型：**本地优先，无后端**（推荐 A 案）

| 层 | 选择 | 理由 |
|---|---|---|
| 前端 | Vite + React + TypeScript | 构建快，生态熟悉 |
| 样式 | Tailwind CSS | 快速出极简界面 |
| 存储 | **Dexie（IndexedDB）** | 零运维、离线可用、单机足够；261 条到 10 万条都扛得住 |
| 公式 | KaTeX | 比 MathJax 快一个量级 |
| 状态 | Zustand | 轻量，避免 Redux 样板 |
| 调度 | `ts-fsrs`（npm）| 现成 FSRS 实现，参数可调 |
| 部署 | Cloudflare Pages / Vercel（静态） | 免费、免运维；数据在你本机 |
| 备份 | 手动导出 JSON + 定时提醒 + Git 私有仓库存 JSON | 无服务器时数据安全的唯一正解 |

**B 案（仅在"要给同门共用"时才考虑）**：Next.js + Postgres(Supabase) + 账号 + 行级权限。成本高 3–5 倍，v1 不做。

### 7.2 目录结构

```
src/
  db/            schema.ts  migrations/  repo.ts        # Dexie 表定义与读写
  domain/        concept.ts  card.ts  grade.ts  fsrs.ts   # 纯逻辑，必须有单测
  pages/         Review/  Import/  Concepts/  Diagnostics/  Settings/
  components/    CardFace.tsx  AnswerInput.tsx  RatingBar.tsx  Kbd.tsx
  lib/           normalize.ts  jaccard.ts  katex.ts  csv.ts
tests/           grade.test.ts  fsrs.test.ts  import.test.ts
```

### 7.3 关键纯函数（先写测试再写 UI）

```ts
// lib/grade.ts
type Verdict = 'correct' | 'partial' | 'wrong';
function normalizeEn(s: string): string;            // 小写/连字符/空格/单复数
function jaccard(a: string, b: string): number;     // 词集相似度
function gradeEn(input: string, accepted: string[]): Verdict;
function gradeZh(input: string, must: string[], opt: string[]): Verdict;
```

单测用例（直接照抄进 `grade.test.ts`）：
```
gradeEn("machine learning interatomic potential", ["machine-learning interatomic potential (MLIP)"]) === "correct"
gradeEn("potential energy surfaces", ["potential energy surface"]) === "partial"
gradeZh("力是它的梯度", ["势能面"], ["能量"]) === "wrong"      // 没提势能面
gradeZh("势能面，梯度给出力", ["势能面"], ["梯度"]) === "correct"
```

---

## 8. 非功能需求

| 项 | 要求 |
|---|---|
| 性能 | 答题→下一张 ≤ 100 ms；1 万卡时首屏 ≤ 1 s |
| 离线 | 首次加载后可完全离线（Service Worker 缓存） |
| 移动端 | 375 px 宽可用；可"添加到主屏幕"（PWA manifest） |
| 数据安全 | 每次启动若 > 7 天未导出，顶部提示备份；导出文件含版本号 |
| 可访问性 | 全键盘可操作；对比度 ≥ WCAG AA |
| 可维护 | `domain/` 与 `lib/` 无 React 依赖，纯函数 100% 单测覆盖 |
| 兼容 | Chrome / Safari(iOS 16+) 最近两个大版本 |

---

## 9. 里程碑与验收标准

| 阶段 | 交付 | 验收（可测） |
|---|---|---|
| **M1（1–2 天）** | schema + 导入 + 概念列表 | 261 条 CSV 导入 0 报错；重复导入不产生重复；条目可在列表里编辑 |
| **M2（2–3 天）** | 复习页 + 四题型 + 判分 | 附录 C 的 4 个单测全过；答题延迟 ≤ 100 ms；申诉可回写白名单 |
| **M3（1 天）** | FSRS 调度 | 连续答 Good 后间隔单调增长；Again 后当日重现；参数可改 |
| **M4（1 天）** | 诊断页 | 4 个指标可算；输出"本周该补 5 条"清单 |
| **M5（1 天）** | PWA + 导出/恢复 | 手机加到主屏可离线；导出→清库→导入，复习历史条数一致 |
| **M6（0.5 天）** | 部署 | 公网可访问（或纯本地 `npm run build` + 静态托管） |

**整体 MVP 目标：6–8 个工作日，单人可完成。**

---

## 10. 风险与开放问题

| 风险 | 影响 | 缓解 |
|---|---|---|
| 判分误判（尤其中文） | 高（会打击使用意愿） | keywords 可视化编辑 + 一键申诉 + 申诉率监控 |
| 自建站的"维护成本"反噬 | 中 | 无后端、无账号；只依赖静态托管 |
| 数据丢失 | 高（复习历史不可再生） | 事件流存储 + 强制备份提醒 + Git 版本化 JSON |
| 录入成本高于收益 | 中 | 粘贴三列快速录入 + P2 的 AI 抽取 |
| 过度设计（想做通用产品） | 中 | 严守"单人自用"非目标清单 |

**需要你拍板的 3 件事**
1. **只自用，还是要能给同门用？** → 决定 A 案（本地优先）还是 B 案（后端+账号）。默认按 A 案写。
2. **要不要发音/听写？** → 决定是否接 TTS，以及是否要"听→写"题型。
3. **公式与推导要到什么程度？** → 只要行内符号（`$\phi_{ij}$`）还是整段推导（块级 KaTeX + 图片）。

---

## 附录 A：现有 261 条如何落进 schema（示例）

```jsonc
{ "id":"c_017", "en":["moment tensor potential","MTP"], "zh":["矩张量势"], "abbr":["MTP"],
  "symbol":null, "formula":null,
  "gloss":"以矩张量为基组、系数线性拟合的势（SUS2 属于这一族）",
  "answer_spec":{"keywords_must":["矩张量"], "keywords_optional":["势","基组","线性拟合"],
                 "accepted_en":["moment tensor potential","MTP","moment-tensor potential"]},
  "tags":["core","model"], "source":{"doc":"胡晏箫学位论文","locator":"§4.2 / 摘要","type":"thesis"},
  "note":"与 MACE 的等变消息传递区分：这里是等变基底 + 不变量读出", "units":null }

{ "id":"c_142", "en":["thermal conductivity"], "zh":["热导率"], "abbr":[],
  "symbol":"\\kappa", "formula":null, "gloss":"热量穿过材料的顺畅程度",
  "answer_spec":{"keywords_must":["热导率"], "keywords_optional":["κ","W/(m·K)"],
                 "accepted_en":["thermal conductivity","heat conductivity"]},
  "tags":["thermo"], "source":{"doc":"学位论文 第7章","locator":"§7.2","type":"thesis"},
  "note":null, "units":"W/(m·K)" }

{ "id":"c_203", "en":["pair_style"], "zh":["势函数声明命令"], "abbr":[], "symbol":null,
  "formula":null, "gloss":"LAMMPS 输入脚本里挂势的第一行；SUS2 写 pair_style sus2/mtp",
  "answer_spec":{"keywords_must":["势函数声明"], "keywords_optional":["LAMMPS","命令"],
                 "accepted_en":["pair_style"]},
  "tags":["prog"], "source":{"doc":"superlinear_LAMMPS接口","locator":"pair_sus2_mtp.cpp","type":"code"},
  "note":"配 pair_coeff * * 使用", "units":null }
```

## 附录 B：标签体系建议（直接复用上一版词表的判定标记）

| 标签 | 含义 | 默认题型 |
|---|---|---|
| `core` | 必背骨架 | 全部题型 |
| `author` | ⚑ 作者/项目自定义（MPF、AER、DAS、超线性…） | `zh2en` 优先（要能写出来） |
| `math` | 数学工具（宇称、CG 系数…） | `en2zh` |
| `prog` | 程序性（pair_style、OOM、blow up…） | `en2zh` |
| `unit` | 单位/量纲 | `symbol2name` |
| `metric` | 指标（MAE、MAPE…） | `abbr2full` |
| `todo` | 出处待确认（DCBF 尾词、`af_*` 含义） | 不排复习，先补全 |

## 附录 C：判分逻辑伪代码（含单测锚点）

```ts
const BOILER = /\b(a|an|the)\b/g;

export function normalizeEn(s: string): string {
  return s.toLowerCase()
    .replace(/[‐-–—]/g, '-')          // 各种连字符统一
    .replace(/[-_]/g, ' ')            // 连字符→空格
    .replace(/[^\w\s]/g, ' ')         // 去标点
    .replace(BOILER, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b(\w+)(s|es|ies)\b/g, (m, w) => w)  // 极简单复数归一
    .trim();
}

export function jaccard(a: string, b: string): number {
  const A = new Set(normalizeEn(a).split(' ').filter(Boolean));
  const B = new Set(normalizeEn(b).split(' ').filter(Boolean));
  const inter = [...A].filter(x => B.has(x)).length;
  return inter / (A.size + B.size - inter);
}

export function gradeEn(input: string, accepted: string[]): 'correct'|'partial'|'wrong' {
  const n = normalizeEn(input);
  if (accepted.some(a => normalizeEn(a) === n)) return 'correct';
  if (accepted.some(a => jaccard(a, input) >= 0.8)) return 'partial';
  return 'wrong';
}

export function gradeZh(input: string, must: string[], opt: string[] = []) {
  const hitMust = must.filter(k => input.includes(k)).length;
  const hitOpt  = opt.filter(k => input.includes(k)).length;
  if (hitMust === must.length) return 'correct';
  const ratio = (hitMust + 0.5 * hitOpt) / (must.length + 0.5 * opt.length);
  return ratio >= 0.6 ? 'partial' : 'wrong';
}
```

## 附录 D：给 AI 编码助手的启动提示词（可直接复制）

```
你在实现一个本地优先的术语背记 PWA，需求见本 PRD。
技术栈：Vite + React + TS + Tailwind + Dexie + KaTeX + ts-fsrs，无后端。
先做 M1：按 4.2 的 schema 建 Dexie 表，实现 CSV/TSV 导入（列映射 + 去重 + 预览），
以及 /concepts 列表与编辑器。
硬性约束：
1. domain/ 与 lib/ 必须是纯函数，先写 tests/grade.test.ts（用例见附录 C），跑通再写 UI。
2. 任何写操作都要能通过导出 JSON 完整还原，不留只在内存里的状态。
3. 卡片评分必须先评分再下一张，禁止"看完答案直接跳过"。
4. 不要在 v1 引入账号、后端、云同步。
完成后给出：路由清单、Dexie 表定义、跑通的测试输出。
```
