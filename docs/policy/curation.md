# TermLoop 编辑方针（Curation Policy）

> 本文件是**产品的一部分**，不是文档修辞。它被三种东西同时读取：注入每个 Agent 的 prompt、导入校验逻辑、以及人工复核界面。
> 修改本文件必须同步检查 `src/core/zh.ts` 与 `src/services/import.ts`。

---

## 一、五条硬规则

### R1｜先查官方，再决定怎么说

每条 Term 的 `name`（译名）必须能被 **A 级**或 **B 级**证据支撑。

| 等级 | 判定依据 |
|---|---|
| `A` | 原始出处明确使用：论文正文 / 源码注释 / 规范文档，须带 locator |
| `B` | 权威中文术语源：全国科学技术名词审定委员会、术语在线、国标、权威译著 |
| `C` | 已核查，确认不存在权威中文译法 |

查不到 A/B，就落到 `C`，**不得自造**。

### R2｜宁可没有译名，也不要编一个

`name` 为 `null` 是合法状态。此时中文侧必须由 `explain` 兜底：一句大白话，说清这个词怎么理解。

判定标准：一个没学过该领域的人读完 `explain`，能说出它在讲什么。

### R3｜必须成对

每一行都是「英文侧 ↔ 中文侧」的对照。中文侧可以是**译名**，也可以是**解释**，但**不能为空**，也不能两者都缺。

数据库层由 `CHECK (length(explain) > 0)` 强制。

### R4｜补重要表述，不只补名词

固定搭配、常用句式、报错信息、命令片段，同样是背诵对象：

- `run a job` / `blow up` / `out of memory` → `kind=phrase` 或 `procedural`
- `pair_style` / `pair_coeff` → `kind=procedural` + `context`

### R5｜按重要性排序，不收录通用词

**门槛按 Term 判定，绝不按单词判定。**

- `potential` 是高考词汇 → 不收
- `potential energy surface` 是硬术语 → 必收

因此不得把「高考 3500 词表」等单词级黑白名单直接套到 Term 上。软校验：若一个 Term 的所有 Surface 都在通用词范围内，返回 `warning: below_threshold`，默认不生成卡片，但**不拒绝写入**。

---

## 二、提交契约

Agent 提交的每一条必须包含：

```jsonc
{
  "kind": "term",
  "surfaces": [{"type": "en", "text": "...", "status": "preferred", "evidence": "A"}],
  "zh": {"name": null, "name_evidence": "C", "explain": "..."},
  "evidence": [{"grade": "A", "type": "paper", "citation": "...", "locator": "§3.2"}],
  "importance": 1,
  "rationale": "为什么这么写——一句话，会显示在人工复核界面上"
}
```

**缺省 `evidence` 一律视为 `unverified`，不得缺省为 `A`。**

`rationale` 不是可选项：人工复核时只做判断题，凭的就是这一句。

---

## 三、什么时候必须进 Draft（人工确认）

| 改动 | 通道 |
|---|---|
| 新建 Term | **Draft** |
| 修改 `preferred` Surface | **Draft** |
| 修改 `name` 或其证据等级 | **Draft** |
| 修改判分规则（`answer_spec` / must / optional） | **Draft** |
| 改 tag / annotation / importance / explain 措辞 | 直接生效，留 Event |
| 删除 | 软删 + 可撤销 |

> 判分规则必须走 Draft：Agent 只要把 `must` 写宽一个词，这张卡就会永远判对，复习数据立刻变成噪声，且**不可逆**——因为人已经因此少复习了 20 次。

---

## 四、审计时怎么判

拿到一份文档（汇报、论文、代码注释），找出四类问题：

| 类型 | 判据 | 纠正 |
|---|---|---|
| `misattribution` | 中文写法对不上原始英文 | 给原文英文 + locator |
| `invented` | 无公认中文译法，现有中文是自造的 | 删中文，改「英文 + 解释」 |
| `nonstandard` | 有权威译法，现用法不规范 | 给权威译法 + 出处 |
| `slop` | 语序/搭配有机翻痕迹 | 给改写建议 |

三条输出要求：

1. **能溯源就溯源**：有代码或论文出处的，对照原始英文写法给出指正。
2. **无译名就说英文**：词汇有误且没有对应中文译名时，直接告诉正确英文是什么，并说明中文错在哪。
3. **有专门译法就给译法**：存在权威中文译法的，直接给。

---

## 五、已知的坑（来自实测）

| 坑 | 例子 |
|---|---|
| 凭空补词 | `state population` 被译成「状态布居**阈值**」——英文里没有 threshold |
| 近义偏移 | `asymptotic limit` 译成「渐近**边界**」——limit 是极限 |
| 同族不一致 | `basis` 一会儿「基组」一会儿「基底」 |
| 单位当用途 | `W/(m·K)` 写成「热导率单位」——那是用途，读法是「瓦每米开尔文」 |
| 括号多义 | `(R²)` 是符号、`(PAW)` 是缩写、`（论文自创名）` 是标记——不能一律当缩写解析 |
