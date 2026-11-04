# 跨语言检索设计（训练库词法匹配 + 贸易词典扩展）

状态：设计定稿 2026-10-12，随实现落地。
关联：`whatsapp-plugin/src/server/services/text-match.ts`、`training-library-service.ts`；`whatsapp-web-translator/src/trainer.js`（口径同步）。

## 1. 背景与缺口（已核实）

- 训练库问答匹配 `rankQa()` 是**纯词法**：`tokenize()`（中文相邻 bigram / 拉丁词）→ 共同特征数 + 覆盖率双门槛。
- 后果：客户用英文问 "What's your MOQ?"，库里 qa 是「客户问：起订量是多少」——两侧 token 交集恒 0 → **必不召回**，回复掉到档案兜底甚至降级。这是「多语言外贸」场景的结构性缺陷。
- CRM 资源中心检索（`backend/src/resource-hub.ts`）已有同思路的 `DOMAIN_EXPANSIONS` 词典（15 组中英双向），证明「词典扩展」在本项目是被验证过的路线；但训练库这一侧**完全没有**。

## 2. 目标

客户消息与训练库条目**语言不同**时仍能命中：用一张贸易域中英双向词典把查询词扩出等价词；扩展词命中计入匹配但按半权计，防误拦。

## 3. 方案设计

### 3.1 词典（text-match.ts，唯一来源，两处共用）

新增 `TRADE_TERM_EXPANSIONS`：`Array<{ pattern: RegExp; terms: string[] }>`，模式与 resource-hub 的 DOMAIN_EXPANSIONS 相同（pattern 测原文、terms 是等价词组）。首批覆盖外贸最高频的问法域：

moq/起订量、lead time/交期、price/报价、sample/样品、catalog/目录、shipping/运费、payment/付款、discount/折扣、certification/认证、warranty/质保、customs/报关、packaging/包装、order/订单、delivery/发货、after-sales/售后、agent/代理、oem/贴牌、material/材质、size/尺寸、color/颜色。
（约 20 组，每组的 terms 同时含中英文写法与常见变体。）

新增纯函数：

```ts
export function expandTokens(tokens: string[], originalText: string): {
  original: string[]; expanded: string[];   // 扩展词来自词典，不会与原词重复
};
```

### 3.2 匹配口径（training-library-service.ts `rankQa`）

- 查询侧：`tokenize(inboundBody)` 后过 `expandTokens`，得到原词集 + 扩展词集。
- 候选侧：不变（条目 question 照原样 tokenize，**不做扩展**——库里是标准写法，扩它反而引入噪音）。
- 计分（**实现期修正**）：扩展词与原词**同权**计入共同特征。
  > 设计稿原定扩展词半权，红绿推演把它证伪了：旗舰场景「英文 MOQ → 中文起订量」只有
  > `起订/订量` 2 个 bigram × 0.5 = 1.0，过不了 `MIN_QA_MATCHED_TOKENS=2`，词典等于白做。
  > 误召回改由两道闸挡住：① 单条扩展词命中 1 < 2，天然过不了共同特征门槛；
  > ② 相似度分母把扩展词算进去（querySize = 原词数 + 扩展词数），扩展词越多相似度被
  > 稀释得越狠，蹭词典的候选过不了 `MIN_QA_SIMILARITY`。
- 门槛不变：`MIN_QA_MATCHED_TOKENS`、`MIN_QA_SIMILARITY` 两个常量**不动**——词典扩展提高的是召回，不放松质量门槛。
- `forbidden` 场景词匹配**不扩展**：红线判断宁漏勿错，扩展会放大误拦。
- `verdict` 文案注明扩展命中（如「含词典等价命中」），保持「依据可解释」的原则；档案兜底
  `bestProfileExample` 用**同一套口径**，两处不分叉。

### 3.3 明确不做

- **不做运行时外部翻译**（MyMemory/Google）：把客户消息发第三方服务有隐私口径问题，且引入网络依赖与延迟；词典是纯本地。
- **不做条目侧变体问法字段**（`questions: string[]`）：需要 DB 迁移 + 界面 + 双端同步，留作二期；词典先行已能覆盖高频场景。
- 不动 CRM resource-hub 的检索（它有自己的词典与权重体系）。

## 4. 验收标准（先红后绿）

`whatsapp-plugin/tests/text-match.test.ts` + `training-library.test.ts`：

1. 红：英文 "What's your MOQ and lead time?" 对中文 qa「起订量是多少？交期多久？」→ 当前实现 0 命中（先写断言证明缺口）。
2. 绿：同例在词典扩展后 `matched≥门槛`、`similarity≥门槛`，命中且 verdict 含扩展说明。
3. 扩展词单条命中防误召回：只蹭到 1 个扩展词的候选过不了共同特征门槛（matched=1 < 2）。
4. 原词命中行为不受影响：纯中文对纯中文的老用例**全部保持原结果**（回归）；扩展集为空时新旧口径逐位一致。
5. forbidden 不扩展：禁用场景词只按原文匹配。
6. 词典大小写/标点无关："Moq?" 与 "MOQ！" 等价。

## 5. 真链路自测追加修复（0.6.4 验收轮）

设计文档验收通过后，又做了一轮**真实服务**自测（`tools/whatsapp-real-chain-selftest.mjs`，
不打桩、直打插件 3100 与 CRM 4188），发现并修复了一个设计稿没覆盖到的缺口：

- **缺口：出稿主路径只拿最后一条来信做检索。** `compose` 的 `candidate.inboundBody`
  取 `latestInbound.body`——客户连发几句（先问 MOQ 再问交期）时，最后一条往往是
  "And the lead time?" 这种半句，前面的正题永远打不中训练库。`match` 预览端点
  （整句进 resolve）命中了、真出稿却不命中，正是这类"两条路径口径分叉"的表现。
- **修复**：`Candidate` 增加 `retrievalBody`（最近 ≤3 条来信去重合并），仅用于
  训练库检索（`loadLibrary`）与档案兜底（`bestProfileExample`）；`inboundBody`
  保持"最后一条"语义不动（升级关键词、媒体占位判断仍看它）。单消息路径（后台
  runNow）不设此字段，行为不变。
- **回归**：`tests/auto-chat-compose.test.ts` 新增「连发几句、正题不在最后一条也能
  命中」（中文条目 + 英文连问，同时压住词典扩展与合并来文两个修复）；红验证过
  （退回 inboundBody → 新用例红）。原「没有相近问法」用例的来文改为全程不带贸易词
  ——它的旧前提恰好依赖了被修掉的缺陷行为。
