# TermLoop

一个「术语级」背记系统：词表由 Agent 研究维护，人只负责复习与确认。

本文件只定义这个项目的**语言**——每个概念在我们嘴里只有一个名字。不含实现细节。

## 词表条目

**Term**（术语条目）：
词表里的一行，一个可被单独记忆与考核的知识单元。不限于名词性术语——`GPa`、`pair_style`、`meV/atom` 都是 Term，区别在 `kind`。
_Avoid_: 词条、单词、word、concept、entry、卡片

**kind**（类型）：
Term 的结构分类，决定它必填哪些字段、自动生成哪些卡。取值为封闭枚举：`term` / `phrase` / `procedural` / `metric` / `unit` / `symbol`。不是自由标签。
_Avoid_: 类别、标签、tag、domain

**Surface**（表征）：
一个 Term 的一种可识别写法。类型为 `en` / `zh` / `abbr` / `symbol` / `formula`；状态为 `preferred` / `accepted` / `rejected`。一个 Term 可以有多个 en Surface（连字符变体、全称与别名），但同类型下只有一个 `preferred`。
_Avoid_: 拼写、变体、alias（alias 是注解的一种，不是 Surface 类型）

**view**（视图）：
保存下来的一组过滤条件（按 kind / tag / importance / 状态）。它不是容器，不拥有数据，删掉它不影响任何 Term。
_Avoid_: 词书、decks、分组、文件夹

## 中文侧

**name**（译名）：
中文侧中可充当答案的那部分名词性表达，例如「势能面」。**可以为空**——找不到公认译法时它就该空着。
_Avoid_: 翻译、译文、translation

**explain**（解释）：
中文侧中用大白话说明「这个词怎么理解」的部分，例如「力是它的梯度」。陈述性，永不作为 zh2en 的答案。**不可为空**。
_Avoid_: 释义、定义、gloss、definition——这几个词在别处都指词典义项，会和 name 混淆

**annotation**（注解）：
附着在 name / explain 上的补充信息，五型：`alias`（别名）/ `catchword`（自创名标记）/ `dimension`（量纲或换算）/ `usage`（用途）/ `provenance`（出处）。旧数据里这五样全挤在括号内，必须拆开。
_Avoid_: 备注、note、括号内容

## 证据与状态

**evidence**（证据）：
支撑某个 Surface 成立的外部依据，四级：`unverified`（尚未核查，暂用）、`A`（原始出处明确使用）、`B`（权威中文术语源）、`C`（已核查且无权威来源）。
_Avoid_: 来源、source、citation、可信度

关键区分：`unverified` 是「不知道」，`C` 是「查过了，不行」。只有 `C` 会剥夺 `name` 资格；`unverified` 不剥夺，只在界面上标记。

**Draft**（候选）：
Agent 提交、尚未进入词表的改动建议。可被接受、拒绝或合并进已有 Term。
_Avoid_: 待办、pending、proposal、草稿

**Event**（事件）：
一次已发生的写入记录，append-only，含操作者身份与 diff。任何一条都可回滚。
_Avoid_: 日志、log、历史

**active**（启用复习）：
Term 的状态，表示它的卡片会进入复习队列。状态链为 `draft` → `accepted` → `active`，「入库」与「排复习」是两件事。
_Avoid_: 发布、上线、启用、approved

## 复习

**Card**（卡片）：
从 Term 派生的一次具体提问。同一 Term 的多张卡各自独立调度，互不共享记忆历史。
_Avoid_: 题、题目、question、考点

**verdict**（判定）：
系统对一次作答的对错判断（`correct` / `partial` / `wrong`），并记录判定者（`rule` / `llm` / `human`）。与 rating 是两件事。
_Avoid_: 结果、评分、score、对错

**rating**（档位）：
人最终喂给调度算法的四档自评（`again` / `hard` / `good` / `easy`）。与 verdict 分开存储，可被 verdict 建议但不可被强制覆盖。
_Avoid_: 评分、grade、review score

**Review**（作答记录）：
一次作答的完整事实：题面、原始答案、verdict、rating、耗时、当时算出的调度。永久保留、不可修改，用于统计与重算。
_Avoid_: 历史、log、答题记录

## 共享

**termbank**（词表资产）：
词表作为一份资产的可版本化形态：一行一个 Term，按稳定 id 排序，可 diff、可 review、可回滚。它是「词表」这个词唯一指代的东西。
_Avoid_: 数据库、导出物、dump、备份

**termpack**（分享包）：
一个自包含的压缩包：manifest + terms，默认不含 reviews。用于把自己的一个子集交给别人导入。
_Avoid_: 分享链接、导出包、备份、词书
