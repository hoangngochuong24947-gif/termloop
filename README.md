# TermLoop

**一份由 Agent 研究维护、由人复习确认的术语资产。**

不是词书阅读器，也不是又一个背单词 App。这个项目解决的是专业术语学习里最脏的一段：
*这个词到底该怎么写、怎么译、出处在哪* —— 由 Agent 去查，人去记。

```
人：我只负责「我记住没有」
Agent：这个词是什么、该怎么说、依据在哪
```

---

## 三个设计选择

### 1. 中文侧不是「翻译」，是「译名 or 解释」二选一

专业术语经常没有公认中文译法。硬翻会造出「状态布居**阈值**」这种东西——英文里根本没有 threshold，
但它长得跟真译名一模一样，于是你就背下来了。

所以中文侧是三段结构：

```jsonc
"zh": {
  "name": "势能面",          // 译名。可以为 null —— 找不到公认译法时就该空着
  "name_evidence": "B",      // unverified | A | B | C
  "explain": "给定原子位置，体系能量是多少；力是它的梯度"   // 必须非空
}
```

**没有 A/B 级证据就不许产生译名。** `unverified`（还没查）和 `C`（查过了，没有）是两个状态，
不能合并——合并会让整条规则失效。见 [ADR-0002](docs/adr/0002-no-translation-without-evidence.md)。

### 2. 只有服务进程能写数据库

浏览器数据库没有端口，外部 Agent 写不进去；而两台设备各有一个 IndexedDB，数据互不相通。

所以真相源是一个 SQLite 文件 + 一个常驻本地进程，它是**唯一写入者**。
网页、CLI、MCP、你的 Claude Code 全都是它的客户端。词表另外以 JSONL 快照落到 `termbank/` 进 git，
拿到可 diff、可 review、可回滚的资产形态。

见 [ADR-0001](docs/adr/0001-single-writer-local-service.md)。

### 3. 写入分档：高风险进 Inbox，低风险直接生效

Agent 新建术语、改首选写法、改判分规则 → 进 `Draft` 队列等人确认。
改 tag、注解、重要度 → 直接生效但留下可回滚的 `Event`。

原因很实在：Agent 只要把判分关键词写宽一个词，那张卡就永远判对，
你的复习历史立刻变成噪声，而且**不可逆**——因为人已经因此少复习了 20 次。

---

## 快速开始

```bash
pnpm install
pnpm test          # 46 个用例
pnpm build         # 构建前端
pnpm seed          # 导入仓库自带的 261 条种子词表
pnpm start         # http://127.0.0.1:7788
```

第一次启动会在 `~/.termloop/token` 生成 API token。网页会自动拿到（服务端注入），
脚本调用需要自己带上：

```bash
TOKEN=$(cat ~/.termloop/token)
curl -H "Authorization: Bearer $TOKEN" localhost:7788/api/v1/terms?limit=3
```

> 服务默认只绑 `127.0.0.1`。要手机上用，建议走 Tailscale 或 SSH 隧道，而不是 `--host 0.0.0.0`。

<details>
<summary>装依赖时看到 <code>ERR_PNPM_IGNORED_BUILDS</code>？</summary>

pnpm 10+ 默认不执行依赖的安装脚本。本项目已在 `pnpm-workspace.yaml` 与 `.npmrc` 里放行
`better-sqlite3` / `esbuild`；better-sqlite3 在主流平台自带预编译二进制，通常不影响运行。
若确实装不上，执行 `pnpm approve-builds` 手动勾选，或 `node -e "require('better-sqlite3')"` 自检。

</details>

---

## 给 Agent 用

服务自己会讲清楚怎么用它：

| 地址 | 内容 |
|---|---|
| `GET /openapi.json` | 机器可读契约（15 个端点） |
| `GET /agent.md` | 给 Agent 的操作说明 |

典型调用——提交一条术语气，注意 `zh.name` 是 `null`：

```bash
curl -X POST localhost:7788/api/v1/drafts:batch \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-TermLoop-Client: my-agent" \
  -H "content-type: application/json" \
  -d '{
    "source": {"doc": "Falk et al. 2024", "locator": "§3.2"},
    "items": [{
      "kind": "term",
      "surfaces": [
        {"type": "en", "text": "materials property field", "status": "preferred"},
        {"type": "abbr", "text": "MPF", "status": "preferred"}
      ],
      "zh": {"name": null, "explain": "把任意材料物性表示为一个可求导的场函数"},
      "evidence": [{"grade": "A", "type": "paper", "citation": "Falk 2024", "locator": "§3.2"}],
      "importance": 4,
      "tags": ["author"],
      "rationale": "原文只给英文定义，没有中文译名"
    }]
  }'
```

写接口都支持 `?dry_run=1`（只校验不落库）和 `Idempotency-Key`（Agent 会重试，你得防住）。

---

## 数据模型

```
Term（kind: term | phrase | procedural | metric | unit | symbol）
 ├── surfaces[]   一个写法 + 类型(en/zh/abbr/symbol/formula) + 状态 + 证据
 ├── zh           name（可空）/ explain（必填）/ name_evidence
 ├── annotations  五型：alias / catchword / dimension / usage / provenance
 └── cards[]      en2zh · zh2en · en2explain · abbr2full · symbol2name …
                  └── reviews[]  每次作答，不可变，可重算

Draft    Agent 提交的改动建议 → Inbox → 接受/拒绝
Event    任何写入的不可变记录，可回滚
```

卡片不共享调度：`en2zh` 和 `zh2en` 是两种能力，混在一起会互相污染间隔。

---

## 现在能跑的 / 还不能跑的

**能跑**

- 261 条存量词表迁移：规则解析 261/261、0 失败、0 低置信度
- 词表 CRUD、JSONL 快照、事件日志
- 卡片自动生成、中英判分、简化调度器
- Draft/Inbox 审核流、`X-TermLoop-Client` 身份、Agent 改译名被 428 拦下
- 15 个 API 端点、OpenAPI 自描述、`/agent.md`
- Web 界面：复习 / 词表 / Inbox / 诊断

**还不能跑（不要假装能跑）**

| 项 | 状态 |
|---|---|
| 审计（`POST /api/v1/audit`） | 返回 501，排期 M5 |
| TTS（`POST /api/v1/tts`） | 返回 501，排期 M6 |
| 调度算法 | 简化实现，接口对齐 FSRS 但**不是** FSRS，参数未拟合 |
| `.termpack` 分享包 | 未实现，目前只有 JSONL |
| PWA / 离线 | 未做 |
| 在 UI 里走 Draft 流程的编辑 | 未做，UI 目前只读词表 |
| 门槛软校验（`below_threshold`） | 未实现，缺通用词表 |

---

## 判分

规则优先，可解释、可单测。三档 `correct / partial / wrong`，映射到 `good / hard / again`，
但 `verdict` 与 `rating` 分开存储——人改判不会覆盖原始判定。

英文侧刻意只丢冠词不丢介词（`equation of state` 丢了 of 会撞上 `equation state`），
并且保留希腊字母（`κ` 不能被蒸掉）。

自评题型（如 `en2explain`）不做自动判分，`verdict` 存 `null`、`decided_by` 记 `human`。
**宁可说「我不知道」也不猜**——把不确定伪装成 correct/wrong 会直接污染调度数据。

---

## 目录

```
src/
  core/        纯函数：判分、卡生成、中文侧解析、调度。无 IO，无 React
  db/          SQLite schema + 唯一的 repo 层
  api/         Hono 路由
  cli/         termloop serve|import|export|snapshot|terms|token
web/           React + Vite 前端
data/seed/     种子词表（261 条，MLIP / 热输运 / LAMMPS 术语）
termbank/      词表快照（进 git）
docs/
  prd/         需求文档 v2
  adr/         决策记录
  policy/      编辑方针——注入 Agent prompt 的那份
tests/         46 个用例
```

`src/core/` 不许 import `db/`，`src/` 不许 import React。这条约束是刻意留的：
领域逻辑要能被 CLI、测试和未来的 worker 复用。

---

## 设计与决策

- [CONTEXT.md](CONTEXT.md) — 领域词汇表，所有命名的唯一权威
- [PRD v2](docs/prd/PRD-v2.md) — 需求文档
- [编辑方针](docs/policy/curation.md) — 五条硬规则
- [ADR-0001 单写端服务](docs/adr/0001-single-writer-local-service.md)
- [ADR-0002 无证据不产生译名](docs/adr/0002-no-translation-without-evidence.md)

## 种子数据

`data/seed/termlist-sus2-261.tsv` 是 261 条英中对照词表，来自机器学习原子间势（MLIP）与
晶格热输运方向的实际阅读与调试，覆盖矩张量势、声子输运、第一性原理计算、LAMMPS 用法。
它是一份两列纯文本——这个仓库的迁移器就是为它写的。

## License

MIT
