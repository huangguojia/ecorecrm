# 资源中心与智能推荐（Resource Hub）设计方案

> 版本：v1.0 · 2026-10-12
> 关联模块：文件中心 `knowledge_assets` / Skill 资源 `skill_resources` / 智能体知识 `agent_knowledge_documents` / 产品库 `products`
> 消费方：WhatsApp 插件（3100）→ 浏览器扩展右侧整列

---

## 0. 一句话目标

把 CRM 里**已经维护好的资料**（文件、Skill 包、知识文档、产品）统一成一条可检索的资源流，
在 WhatsApp 聊天过程中**由 AI 判断"这条消息该配哪份资料"**，主动推到业务员右手边，业务员一键取真实链接或直接回给客户。

不是新建一个资料库，而是**给现有四套资源加一层统一的检索与推荐出口**。

---

## 1. 现状盘点（先认清有什么，避免重复造）

四套资源**后端都已存在**，缺的是"统一出口 + 推荐 + 消费端"。

| # | 源 | 表 | 关键列 | 状态语义 | 取真实地址的接口 | 真实链接在列表里？ |
|---|---|---|---|---|---|---|
| 1 | 文件中心 | `knowledge_assets` | title / category / version / `source_type`(external_url·baidu_share·legacy) / `source_url` / `share_code` / `file_type`(pdf·word·excel·image·video·archive·link·other) / description / tags_json / access_count | published / draft / review | `POST /api/knowledge/assets/:id/access` | ❌ 不下发 |
| 2 | Skill 资源 | `skill_resources` | name / category / version / summary / usage_guide / training_guide / optimization_advice / acquisition_instructions / `download_url` / `extraction_code` / tags_json / author / license | draft / published / archived | `POST /api/agent/skill-resources/:id/access` | ❌ 不下发 |
| 3 | 智能体知识 | `agent_knowledge_documents` + `agent-knowledge/*.json` 系统文件 | kind(system·module·workflow·policy·field·playbook·failure_case) / module / title / summary / content / keywords / toolRefs / successCriteria / failureCases / permissionCodes / trustLevel | draft / review / published / archived | 纯文本，无外链 | — |
| 4 | 产品库 | `products` | name_zh / name_en / model / category / unit / price / currency / hs_code / description_zh / description_en / tags_json / image_url | — | 无外链（图片走 image_url） | — |

**已有的检索能力**（`backend/src/agent-knowledge.ts::retrieveAgentKnowledge`）：
结构化 + 加权词法（TF-IDF + 中文 bigram）+ 语义扩展，自报 `vectorEnabled: false`。
它**只覆盖第 3 类**，且 `GET /api/agent/knowledge/search` 的返回是知识文档，不含文件与产品。

**已有的开放接口骨架**：`backend/src/agent-api-contracts.ts` 是接口契约注册表（`define(...)`），
`GET /api/agent/catalog` 下发目录；`agent-api-policy.ts` 的两张表控制"外发动作"与"不开放的控制面"。
→ 新增接口**必须**在契约表登记，否则 `agent-api-contracts-test.ts` 直接失败。

**已有的"外链不落列表"模式**：文件中心与 Skill 资源都把真实 URL/提取码关在独立的 `access` 接口后面。
→ 本方案**沿用这条姿态**，不另创一套。

---

## 2. 架构总览

```
                     ┌──────────────── CRM（4190 dev / 4188 personal）────────────────┐
                     │                                                              │
  业务员在 CRM 里     │  knowledge_assets   skill_resources   knowledge_docs  products │
  提前维护的资料 ────▶│        │                 │                  │            │      │
                     │        └────────┬────────┴──────────┬───────┴────────────┘      │
                     │                 ▼                   ▼                          │
                     │        ┌────────────────────────────────────┐                  │
                     │        │  resource-hub（新增）              │                  │
                     │        │  统一目录 / 混合检索 / 推荐排序    │                  │
                     │        │  + resource_embeddings（可选向量） │                  │
                     │        │  + resource_retrieval_events（埋点）│                 │
                     │        └────────────────┬───────────────────┘                  │
                     │                         ▼                                      │
                     │   6 个开放接口（/api/agent/resources*）                        │
                     └─────────────────────────┬──────────────────────────────────┘
                                               │  插件自签 token（该 owner 的权限）
                                               ▼
                     ┌────────── WhatsApp 插件（3100）──────────┐
                     │  crm-resources.ts   ← 读 CRM 四类资源    │
                     │  resource-recommend-service.ts           │
                     │   ① 词法/向量召回 ② CLI 复排 + 写"为什么" │
                     │  POST /api/v1/auto-chat/suggest          │
                     └────────────────┬────────────────────────┘
                                      │ 扩展 SW（唯一出网口）
                                      ▼
                     ┌──── 浏览器扩展（MV3）右侧整列 ────┐
                     │ ┌ 推荐回复 ────────────────────┐ │
                     │ │ 正文                          │ │
                     │ │ 为什么这么回（原因行）         │ │
                     │ │ 来源徽章：CRM跟进/知识库/训练话术│ │
                     │ │ 置信度 · 引擎 · [填进输入框]   │ │
                     │ └──────────────────────────────┘ │
                     │ ┌ 相关文档 ────────────────────┐ │
                     │ │ [PDF] LED工程灯规格书   0.87  │ │
                     │ │ 客户在索要规格书；标题双重命中 │ │
                     │ │ [复制链接] [打开]              │ │
                     │ └──────────────────────────────┘ │
                     └──────────────────────────────────┘
```

**分层职责**（一句话记忆）：

- **CRM**：谁可见、有什么、哪份最相关。**真实链接的唯一出口**。
- **插件**：把"页面上的对话"翻译成检索请求，把候选翻译成"这次该发哪份 + 为什么"。**不落库、不发送**。
- **扩展**：读页面、显示、填框。**永不自动发送**。

---

## 3. CRM 开放接口设计（6 个，全部新增）

统一前缀 `/api/agent/resources`，全部 `requireAuth` + 团队/对象级可见性过滤。

### 3.1 `GET /api/agent/resources` — 统一资源目录

给"我想看看都有什么"用（也用于插件侧的资料面板空态展示）。

| Query | 类型 | 说明 |
|---|---|---|
| `q` | string ≤200 | 可选关键词 |
| `sourceType` | `file`\|`skill`\|`knowledge`\|`product`\|`all` | 默认 `all` |
| `category` | string ≤80 | 精确类目过滤 |
| `fileType` | string ≤30 | 仅对 `file` 生效 |
| `limit` | int 1–50 | 默认 20 |
| `cursor` | string | 不透明游标（`updatedAt|id`） |

响应：
```json
{
  "resources": [{
    "id": "ka_8f21", "sourceType": "file", "title": "LED 工程灯 规格书",
    "category": "产品资料", "summary": "…", "tags": ["LED", "工程灯"],
    "fileType": "pdf", "version": "1.2", "author": "Shirley",
    "updatedAt": "2026-09-30T08:12:00.000Z", "accessCount": 12,
    "hasExternalLink": true, "score": 0.82, "reasons": ["标签命中「LED」"]
  }],
  "total": 37, "nextCursor": null,
  "retrievalMode": "weighted-lexical", "vectorEnabled": false
}
```

**硬约束：响应里永远不出现 `sourceUrl` / `shareCode` / `downloadUrl` / `extractionCode`。**
（与既有 `access` 接口同姿态；`hasExternalLink` 只暴露布尔。）

### 3.2 `POST /api/agent/resources/recommend` — 推荐（核心）

用 POST 而非 GET：会话转写会很长，塞进 query string 会撞长度上限。

请求：
```json
{
  "conversation": [
    { "role": "customer", "text": "Could you send the specification of the LED high bay?" },
    { "role": "agent",    "text": "Sure, let me check." }
  ],
  "customerId": "cus_1024",
  "limit": 6,
  "sourceTypes": ["file", "product"],
  "signal": "inbound",
  "useVector": null
}
```

| 字段 | 约束 |
|---|---|
| `conversation` | 1–20 条；`text` ≤2000 字符；`role` ∈ `customer`\|`agent` |
| `customerId` | 可选；给了就用于"该客户用过/收到过什么"的结构化加分，并**复核归属**（不是本人客户则忽略，不报错） |
| `limit` | 1–20，默认 6 |
| `sourceTypes` | 可选，默认全开 |
| `signal` | `inbound`（客户刚发消息）/ `compose`（业务员在写）/ `manual`（手动刷新），默认 `manual`。只影响排序先验，不改变可见性 |
| `useVector` | `null` 跟随服务端配置；`true` 强制尝试；`false` 强制词法 |

响应：
```json
{
  "recommendations": [{
    "id": "ka_8f21", "sourceType": "file", "title": "LED 工程灯 规格书",
    "category": "产品资料", "fileType": "pdf", "summary": "…",
    "tags": ["LED"], "version": "1.2", "updatedAt": "…", "accessCount": 12,
    "score": 0.87,
    "match": { "lexical": 0.71, "semantic": 0.18, "structured": 1, "vector": 0 },
    "reasons": [
      "客户正在索要规格书",
      "标题与「specification / LED」双重命中",
      "该客户此前收到过同类资料"
    ]
  }],
  "retrieval": {
    "mode": "weighted-lexical", "scanned": 4, "candidates": 37,
    "vectorEnabled": false, "tookMs": 12
  },
  "customer": { "matched": true, "id": "cus_1024", "company": "Nordic Tools AB" },
  "warnings": []
}
```

### 3.3 `POST /api/agent/resources/:sourceType/:id/reveal` — 取真实地址（唯一出口）

```json
// 请求
{ "reason": "客户索要规格书", "conversationKey": "wa:8613800000000" }
// 响应
{
  "resource": { "id": "ka_8f21", "sourceType": "file", "title": "LED 工程灯 规格书" },
  "access": { "url": "https://pan.baidu.com/s/1xxxx", "shareCode": "s123", "kind": "baidu_share" },
  "accessId": "rae_01H…"
}
```

- 校验：**必须**是 `published` 且当前账号可见；否则 404（故意不区分"不存在"与"无权"，避免探测）。
- 副作用：`access_count + 1`、写 `last_accessed_at`、写一条 `resource_retrieval_events(event_type='revealed')`。
- 对第 3 类（知识文档）没有外链 → 直接返回正文（`access.kind = "inline"`，`access.content`），仍记一次访问。
- **这个接口是审计重点**：谁、什么时候、为了哪句话、取了哪份资料，全部可回溯。

### 3.4 `POST /api/agent/resources/feedback` — 采纳/忽略埋点

```json
// 请求
{ "items": [
    { "resourceId": "ka_8f21", "sourceType": "file", "action": "sent" },
    { "resourceId": "sr_77",   "sourceType": "skill", "action": "dismissed" }
  ],
  "conversationKey": "wa:8613800000000" }
// 响应
{ "recorded": 2 }
```

`action` ∈ `accepted`（业务员点了"复制链接/打开"）| `dismissed`（关掉了这张卡）| `sent`（资料确实回给了客户）。

三点设计裁量：
1. **不加权重的在线学习**，只做**简单先验**：同一 `(teamId, resourceType, resourceId)` 的 `sent` 次数进入排序的
   `structured` 分项（对数压缩，上限 0.2 分）。理由：样本量小的时候，重学习比不学更容易崩。
2. `dismissed` **只降权同一会话内的这一份**，不做全局降权（"这次不需要"不等于"这类资料没用"）。
3. 埋点是**旁路**：写失败不影响任何主流程（与既有"背调留档写库失败不拖垮返回"同口径）。

### 3.5 `GET /api/agent/resources/stats` — 推荐效果报表

按 `resourceType + resourceId` 聚合埋点（`days` ∈ [1,90]，默认 30）。口径：
`adoptionRate = accepted / max(1, revealed)`、`sendRate = sent / max(1, revealed)` ——
分母都是 `revealed`：**看到了才谈得上采纳/发送**，`exposed` 只说明被推荐过。
详见 `docs/RESOURCE-FEEDBACK-REPORT-DESIGN.md`。

### 3.6 `GET /api/agent/resources/catalog` — 资料库目录快照（治理视图）

给插件看「文件中心里有什么、治理到什么程度」。与 §3.1 的分工：**§3.1 回答"这次该发哪几份"**
（四源混合 + 打分排序，给推荐位用），本接口回答"资料库里有什么、有多干净"。

它**只覆盖 `knowledge_assets` 一个源** —— 插件面板要画的类目树、要提示的「N 份未校订」
「M 份缺链接」必须和 CRM 文件中心同一个口径；把 skill / 产品 / 智能体知识混进来，这些数字就对不上账。

| Query | 类型 | 说明 |
|---|---|---|
| `since` | ISO string ≤40 | 增量游标：传上次响应的 `revision.latestUpdatedAt`，只回变过的条目 |
| `limit` | int 1–400 | 默认 200（与 `MAX_SCAN_PER_SOURCE` 同量级） |

响应：
```json
{
  "revision": { "generatedAt": "…", "latestUpdatedAt": "…", "total": 411, "fingerprint": "419:411:2:0:4:…" },
  "vocabulary": {
    "categories": [{ "value": "产品资料", "usageCount": 407 }],
    "tags":       [{ "value": "led", "usageCount": 120 }]
  },
  "governance": {
    "total": 419, "published": 411, "draft": 5, "review": 1, "archived": 2,
    "verified": 0, "unverified": 411, "corePool": 0, "longTailPool": 411,
    "missingLink": 4, "orphans": 0,
    "qualityFlags": { "缺少说明": 415, "缺少标签": 417 },
    "byCategory": [{ "category": "产品资料", "total": 407, "verified": 0, "missingLink": 1 }]
  },
  "items": [{
    "id": "ka_8f21", "title": "LED 工程灯 规格书", "category": "产品资料", "tags": ["LED"],
    "description": "…", "fileType": "pdf", "version": "1.2", "status": "published",
    "verified": false, "pool": "longtail", "hasExternalLink": true,
    "qualityFlags": ["缺少说明"], "accessCount": 3, "author": "Shirley",
    "createdAt": "…", "updatedAt": "…"
  }],
  "truncated": 0,
  "warnings": []
}
```

三条必须守住的设计：

1. **`items` 只给 `published`**：目录要能展示「待补链接」的资料（那正是治理对象），但草稿 / 已归档不给 ——
   插件点 reveal 取不到（`collectKnowledgeAssets` 只收 published），摆出来就是个必然 404 的按钮。
   而 `governance` 计数按**全量可见**算（含草稿 / 待审 / 已归档），否则「草稿 8 份」这种该催的数字永远看不见。
2. **`pool` 与检索排序同一口径**：`verified` → `core`（×1.0），否则 `longtail`（×0.5）。
   同一份数据不能算出两个结论 —— `corePool + longTailPool === published` 是恒等式。
3. **仍然不返回任何 URL**：`hasExternalLink` 只说"有没有"，不说"是什么"；真实地址的唯一出口依旧是 §3.3 的 reveal。

计数口径与 `GET /api/knowledge/assets/governance` **同源**（`canSeeKnowledgeAsset` + `knowledgeQualityFlags`）——
两处口径分叉比没有接口更糟。

---

## 4. 检索与推荐算法

四路召回收敛成一条 0–1 的分数：

```
score = clamp01( 0.52·lexical + 0.20·structured + 0.16·semantic + 0.12·vector )
```

| 分项 | 怎么算 | 缺省行为 |
|---|---|---|
| `lexical` | 复用 `agent-knowledge.ts` 的 `knowledgeTerms` 口径（NFKC + 小写 + 中文 bigram + 英文词干化），对 `title/summary/tags/category/description` 加权（标题 ×2.0、标签 ×1.6、摘要 ×1.0、正文 ×0.6）做 TF-IDF | 恒可用，**这是保底** |
| `structured` | ① 已匹配客户 → 该客户历史收到的资料 +0.12；② `category` 命中客户所在行业/产品线 +0.08；③ 同团队 `sent` 次数对数压缩 ≤0.20 | 无 `customerId` 时该项为 0 |
| `semantic` | 复用 `goalDomainModule` 的领域扩展（"规格书" → specification/datasheet/technical drawing） | 恒可用 |
| `vector` | 对词法预筛后的 top-N 候选（N=200）加载向量做余弦 | 未配 embedding 模型 → 该分项置 0，`vectorEnabled:false` |

**排序稳定性**：同分时按 `(accessCount, updatedAt, id)` 三级兜底，保证同一输入两次调用顺序一致
（否则前端会看到卡片"跳来跳去"）。

**`reasons` 的生成口径**（用户能验证的只有这一段，必须诚实）：

- 只能写**真实发生过的匹配**：命中哪个词、来自哪个分项、来自哪条结构化事实。
- **不允许**写"这份资料很适合这个客户"这类无依据的话。
- 客户未匹配到时，结构化分项整体缺席，`reasons` 里也不许出现"该客户……"。
- 词法命中要能指出**命中了什么**（`specification` / `LED`），不是"内容相关"。

---

## 5. 向量数据设计

### 5.1 结论：有必要，但必须是"可选 + 可降级"，不做外部向量库

理由：
- **必要**：词法检索对**同义改写**无能为力。客户写 "delivery lead time"，资料里写 "货期 / production cycle"，
  bigram 一个都对不上。这正是"聊天中该推荐哪份文件"最容易漏的场景。
- **可选**：embedding 需要模型凭据。`ai_model_configs` 是按 owner 隔离的，业务员账号未必配。
  所以**没有向量时系统必须照样可用**，只是召回质量降一档。
- **不做外部向量库**（Qdrant / Milvus / pgvector）：本系统是单节点 MySQL + Express，
  引入独立服务会带来部署、备份、版本、健康检查四份额外运维成本，而收益只在**万级 chunk 以上**才显现。
  当前 232 张表、最大表数百行量级，**暴力余弦完全够用**。

### 5.2 表结构（两张新表）

```sql
CREATE TABLE IF NOT EXISTS resource_embeddings (
  resource_type VARCHAR(20)  NOT NULL,        -- file | skill | knowledge | product
  resource_id   VARCHAR(90)  NOT NULL,
  model         VARCHAR(120) NOT NULL,
  dim           INT          NOT NULL,
  content_hash  VARCHAR(64)  NOT NULL,        -- 文本指纹：变了才重算
  vector_blob   LONGBLOB     NOT NULL,        -- Float32Array 的小端字节序
  updated_at    DATETIME(3)  NOT NULL,
  PRIMARY KEY (resource_type, resource_id, model),
  INDEX idx_resource_embeddings_model (model, updated_at)
);

CREATE TABLE IF NOT EXISTS resource_retrieval_events (
  id               VARCHAR(64)  PRIMARY KEY,
  owner_id         VARCHAR(64)  NOT NULL,
  team_id          VARCHAR(64)  NOT NULL,
  conversation_key VARCHAR(120) NOT NULL DEFAULT '',
  resource_type    VARCHAR(20)  NOT NULL,
  resource_id      VARCHAR(90)  NOT NULL,
  event_type       VARCHAR(20)  NOT NULL,     -- exposed | revealed | accepted | dismissed | sent
  score            DECIMAL(8,4) NOT NULL DEFAULT 0,
  channel          VARCHAR(30)  NOT NULL DEFAULT '',
  created_at       DATETIME(3)  NOT NULL,
  INDEX idx_resource_events_owner (owner_id, created_at),
  INDEX idx_resource_events_resource (resource_type, resource_id, event_type)
);
```

**关键工程决策：向量与业务行分离。**

- 不往 `knowledge_assets` / `skill_resources` / `products` 加 `embedding` 列 —— 那三张表在 `persistAll` 的
  **全表重写**体系里（`DELETE` + 整表 `bulk INSERT`）。把 LONGBLOB 塞进去会让每次 persistence 多搬几十 MB，
  且写频率与业务写频率绑定。**新表走独立 repository，不进 persistAll**（照 `docs` 里"新增模块标准套路"）。
- `content_hash` 是重算开关：资料改了才重嵌入，否则永远命中缓存。

### 5.3 什么时候真的会用到向量

| 条件 | 行为 |
|---|---|
| 未配置 embedding 模型 | `vectorEnabled:false`，`vector` 分项恒 0，其余三路照跑 |
| 已配置但资料没嵌入过 | 首次推荐时**异步**补嵌（不阻塞本次请求），本次仍按词法返回 |
| 已配置且已嵌入 | 词法预筛 top-200 → 加载向量 → 余弦 → 参与排序 |

**永远不阻塞主链路**：向量是精排，不是门槛。缺了它拿到的是"能用的结果"，不是错误。

---

## 6. AI 协同推荐（"为什么推荐"由谁写）

分两层，**能分开就分开**，因为两者对延迟的容忍度差一个数量级：

| 层 | 谁做 | 延迟预算 | 产出 |
|---|---|---|---|
| **召回 + 排序** | CRM（纯算法，不调模型） | ≤300ms | 候选 + `score` + 机器可判定的 `reasons` |
| **复排 + 说人话** | 插件侧 CLI/AI | 10–60s | 挑出"这次真该发的 1–3 份" + 一句业务员看得懂的推荐理由 + 一句可直接发给客户的话 |

第二层**不是必须的**：插件先返回第一层的结果（面板立刻有东西），CLI 结果回来后再原地替换/追加。
这就是"先给能用的，再给更好的"。

CLI 复排的提示词约束（与既有 `goodjob-auto-reply` 技能同一套护栏）：

- 只能从**给定候选清单**里挑，**不许发明**不在清单里的资料（清单里没有合适的，就返回空数组）。
- 理由必须引用清单里的字段（标题/类目/标签）+ 对话里**真实出现过**的信息。
- 语言跟随客户语言；不许承诺价格、交期、库存（含金额的回复走既有 `guardrails`）。
- 输出 schema 固定：`{"resources":[{"id":"…","why":"…","suggestedLine":"…"}],"reply":"…"}`。

---

## 7. 插件侧设计

新增三个文件，修改三处（**以下即已落盘的实现口径**，字段名以代码为准）：

- **`src/server/services/crm-client.ts`（改）**
  抽出 `CrmTransport` / `resolveCrmTransport` / `crmTransportUnavailableReason` / `crmRequestJson<T>`。
  自签 token 的签发口径收敛到**唯一一处**（`crmRequestJson`）；`CrmClient` 的公开面**仍然只有
  `getJson`** —— 插件对 CRM 的写操作不走这里。
- **`src/server/services/crm-resources.ts`（新）**
  `ResourceHubClient`：`list` / `recommend` / `reveal` / `feedback` / `stats` / `catalog`，与 `CrmClient` 共用同一份
  transport（避免超时/鉴权行为分叉）。附带 `toCrmConversation(messages)`（inbound→`customer`，
  outbound→`agent`，截最近 20 条）。
- **`src/server/services/json-extract.ts`（新）**
  把「从 CLI 输出里抠 JSON」抽成模块函数。资源复排与自动回复出稿必须**同一套口径**，
  两处各写一份早晚在围栏/转义上分叉。
- **`src/server/services/resource-recommend-service.ts`（新）**
  `search()`（快，不调模型）/ `suggest()`（慢，走 CLI 复排）/ `reveal()` / `feedback()`。
  **全部永不抛错**：取数失败一律收口成 `warnings[]` 里一句可显示的原因。
- **`src/server/app.ts`（改）** 四条新路由：
  | 路由 | 用途 | 慢/快 |
  |---|---|---|
  | `POST /api/v1/resources/search` | 只要资料（给面板一个「立刻有东西」的初值） | 快 |
  | `POST /api/v1/resources/reveal` | **代取真实外链**（扩展没有 `CRM_JWT_SECRET`，也不该有） | 快 |
  | `POST /api/v1/resources/feedback` | 采纳/忽略埋点。**恒回 202**，异步旁路 | 快 |
  | `POST /api/v1/auto-chat/suggest` | **回复 + 资料一次给全**。两件事 `Promise.all` 并行 | 慢 |
- **`src/server/services/auto-chat-service.ts`（改）**
  `ReplyEvidence` 增加 `sources: ReplySource[]`（`profile` / `library` / `crm_followup` /
  `crm_quote` / `knowledge` / `resource`），面板直接渲染成一排来源徽章。
  `resource` 由 `/auto-chat/suggest` 那条链路在拿到资料后补上 —— 让「回复的来源徽章」与
  「下面列出的资料」是同一件事，而不是两套各说各话的说法。

**字段命名的两个刻意选择**（都踩过）：

- 复排给业务员的那句备注叫 **`curatorNote`**，不叫 `reply`。叫 `reply` 时界面很自然就会把它
  渲染成「推荐回复」，而它其实只是「这批资料我都看了，建议先发规格书」这种内部说明。
  发给客户的话在 `resources[].suggestedLine`（逐份一条）。
- `suggest` 的响应是 `{ reply, curatorNote, resources[], warnings[], ... }`：**回复与资料是
  平级的两个顶层字段**，不是把资料塞进 `evidence` 里。`evidence.sources` 只负责「有 / 没有」。

**`suggestedLine` 的硬闸门**（`sanitizeSuggestedLine`，纯函数、单独回测）：出现货币符号或
货币代码紧跟数字就**整句清空**并记 warning。历史报价是旧价，让模型写「报价是 $8.5/pcs」
出来，就是拿去年的价钱去承诺今年的单。宁可让业务员自己补一句话。

**降级纪律（与既有 CRM 通道同一条）**：CRM 任一步失败都不许拖垮回复链；错误进 `warnings[]`，
面板显示成「资料推荐未取到：…」，而回复照常出。CLI 复排失败只降级成「算法排序」，
候选一份不少（`curated: false`）。

---

## 8. 扩展右侧整列设计

当前是"悬浮球 + 浮层面板"。用户要求：**右边可以完全开一整列**。

### 8.1 布局

```
┌─────────────────────────────────────────┬──────────────────┐
│                                         │  GJ  即刻沟通  × │
│         WhatsApp 原有内容               │ ───────────────  │
│      （被推窄，不被遮挡）                │  推荐回复        │
│                                         │  ┌────────────┐  │
│                                         │  │ 正文…      │  │
│                                         │  │ 为什么这么回│  │
│                                         │  │ 来源徽章    │  │
│                                         │  └────────────┘  │
│                                         │  相关文档        │
│                                         │  ┌────────────┐  │
│                                         │  │ [PDF] …    │  │
│                                         │  └────────────┘  │
└─────────────────────────────────────────┴──────────────────┘
              ← 拖拽这条边调宽度（320–720px）
```

- **推窄而非遮挡**：给 WhatsApp 根容器加 `margin-right: var(--gj-col-w)`，而不是浮在上面盖住消息。
  这是"一整列"与"浮层"的本质区别 —— 用户要的是**能长时间开着干活**。
- 宽度存 `chrome.storage.local`（`gj_panel_width`），下次打开还记得。
- 左边缘可拖拽，`320px`–`720px`，双击回到默认 `380px`。
- 可折叠成一条 40px 竖条（只剩 GJ 标识），折叠状态也持久化。
- **窄屏兜底**：视口 < 1100px 时自动退化成覆盖式抽屉（强制覆盖 + 半透明遮罩），
  避免把 WhatsApp 挤成不可用。

### 8.2 状态机

| 状态 | 触发 | 界面 |
|---|---|---|
| `idle` | 刚打开、无会话 | 一行引导：「切到一个会话就开始推荐」 |
| `scanning` | 会话切换后 debounce 1.5s | 骨架屏（不要转圈，转圈会让人以为卡住） |
| `ready` | 拿到结果 | 两块卡片 |
| `partial` | 回复拿到、资料没拿到（或反之） | 拿到的那块正常渲染，另一块显示原因 |
| `blocked` | 未登录 CRM / CLI 不可用 | 明确说明 + 「去设置」按钮，**不是空面板** |
| `error` | 网络/权限错误 | 原始错误 + 重试按钮 |

**关键交互**：
- 会话切换 → 自动刷新（`MutationObserver` 挂在会话标题节点上 + `history` 兜底 + 1.5s 防抖）。
- 「填入输入框」**只填不发**（沿用既有纪律）；填完 1600ms 抑制窗口内不触发自动翻译（避免中↔外震荡）。
- 「复制链接」调 `reveal` 拿真实地址（**这是唯一一次把外链给到页面**），复制后按钮变「已复制」3 秒。
- 每张文档卡右下角有 `…` 菜单：`没帮助`（→ `dismissed`）/ `已发给客户`（→ `sent`）。

### 8.3 不可妥协的三条

1. **永不自动发送**。`composeFromCrm` / `suggest` 的函数体里不许出现任何发送动作（parity 自检盯着）。
2. **真实链接只在用户点击时才取**。不预取、不缓存、不写进 DOM 直到用户点。
3. **面板坏了不能影响翻译与归档**。三块能力各自独立 content script / 独立失败域。

---

## 9. 安全与权限

三层过滤，缺一不可：

| 层 | 做什么 | 在哪 |
|---|---|---|
| ① 团队隔离 | `canSeeOwner(actor, ownerId, teamId)` —— 只能看本人 + 本团队共享 | CRM 路由 |
| ② 状态过滤 | 只出 `published`（文件中心的 `draft`/`review`、Skill 的 `draft`/`archived` 一律不可见） | CRM 路由 |
| ③ 能力码 | 知识文档按 `permissionCodes` 过 `hasIamPermission` | CRM 路由 |

其余硬约束：

- **真实外链只有一个出口**：`reveal`。目录与推荐两个接口的响应里出现 `sourceUrl`/`downloadUrl`/`shareCode` 就当 bug 处理。
- **越权不区分措辞**：`reveal` 对"不存在"和"无权"都返回 404。
- **插件侧不缓存真实链接**：取到就交给页面，不落 `chrome.storage`。
- **token 是"以该业务员身份"读**：插件用 `sub = 该 owner 的 userId` 签 10 分钟 HS256，
  `iss=goodjob-crm` / `aud=goodjob-crm-web` / `ver=1`。CRM 侧 `requireAuth` 会回查 `users.authVersion`，
  账号停用或版本变更立刻失效。**不引入新的服务账号或万能 key**。
- **契约登记**：4 个新接口全部写进 `agent-api-contracts.ts`；`reveal` 与 `feedback` 是写操作，
  由 `classifyAgentApiRequest` 自动判风险等级，**不在契约里手写风险等级**。
- `reveal` 不登记进 `externalPatterns`（它不对外发消息，只是读一个 URL），但写审计事件。

---

## 10. 降级矩阵（哪一步挂了会怎样）

| 挂掉的环节 | 用户看到 | 系统行为 |
|---|---|---|
| CRM 完全不可达 | 「资料推荐未取到：CRM 连接失败」 | 回复链照常（走本地训练话术） |
| embedding 未配置 | 无感 | `vectorEnabled:false`，词法照跑 |
| CLI 不可用 | 显示词法排序的候选（无"为什么"） | 面板退到 `partial` |
| 知识检索 500 | 其余三类照出 | 该项进 `warnings[]` |
| 客户认不出 | 无结构化加分 | `reasons` 里不出现任何"该客户…" |
| 资料没发布 | 不出现 | 服务端过滤 |
| `reveal` 失败 | 「暂时取不到链接」+ 重试 | 不缓存错误 |
| 扩展未登录 CRM | 面板 `blocked` + 「去登录」 | 翻译/归档不受影响 |

---

## 11. 测试口径（每层都要有"会红的断言"）

| 层 | 文件 | 必须覆盖的"否则全绿也算假"的断言 |
|---|---|---|
| CRM | `backend/src/resource-hub-test.ts` | ① 别的团队看不到；② `draft` 不出现；③ 目录/推荐响应**不含** `sourceUrl`；④ `reveal` 才拿到真实地址且 `access_count` +1；⑤ 跨团队 `reveal` 返回 404；⑥ 未配向量时 `vectorEnabled:false` **且不报错**；⑦ 并发/重复调用顺序稳定 |
| 插件 | `whatsapp-plugin/tests/resource-recommend.test.ts`（33 条）+ `tests/resource-suggest.integration.test.ts`（10 条，真 HTTP） | ① **断言实际发出去给 CRM 的请求 URL 与 body**（不是断言返回值）；② 假 CLI 把候选里的 marker 回读进 `why`，证明候选真的进了提示词；③ 模型臆造的 id 被丢弃；④ 含金额的建议话术被清空；⑤ CRM 500 时照常出稿且 `warnings` 非空；⑥ 目录/推荐响应 `JSON.stringify` 后**不含 `http`**；⑦ 三个新接口未登录一律 401 |
| 扩展 | `tests/resources.test.mjs` + `tests/parity.test.mjs` + `tests/e2e-agent.mjs` | ① 面板里两块都渲染；② 「填进输入框」后**输入框有字但没发送**；③ `suggest` 的入参真的来自页面（把转写回读进返回里验）；④ `composeFromCrm`/`suggest` 函数体里不出现发送动作；⑤ 新消息通道在 background 有分支、新 id 在 HTML 里存在 |

**纪律**：新写的自检**必须实测它会红**（临时改坏一处 → 确认退出码非 0 → 还原）。
本项目已经吃过"假绿"的亏，这条不打折。

---

## 12. 多维度评分

### 12.1 评分维度与初版得分

评分口径：**9 = 可以直接交给客户用**；10 = 在同类系统里做得比别人好。10 分不打满分。

| # | 维度 | 初版 | 短板与根因 |
|---|---|---|---|
| 1 | 功能完整性 | **8.5** | `reveal`/`feedback` 都设计了，但"知识文档无外链"这类边界只有一句话，没说清业务员看到什么 |
| 2 | 架构合理性 | **9.0** | 分层清晰，CRM 出数据 / 插件出判断 / 扩展只显示，未越界 |
| 3 | 既有资产复用度 | **9.5** | 四类资源、`access` 姿态、`knowledgeTerms`、契约表全是复用，几乎零重造 |
| 4 | 性能与延迟 | **6.5** | 只写了"≤300ms"目标，**没写怎么保证**；全表扫描四类资源 + 逐条算 TF-IDF 在数据长大后会线性劣化 |
| 5 | 安全与权限 | **8.0** | 三层过滤写清了，但**审计事件没定保留期**，"谁能看审计"也没说 |
| 6 | 可降级性 | **7.0** | 降级矩阵有，但**没有熔断/超时上限**：CRM 慢而不挂时，面板会一直 `scanning` |
| 7 | 可测试性 | **7.5** | 三层测试都在，但**缺"顺序稳定性"的可测口径**（同分排序不写出来就没法断言） |
| 8 | 可维护性 | **8.5** | 一个模块 + 两张表 + 契约登记，边界干净；但**新表不进 `persistAll` 这条约束只在文字里**，容易被后来者破坏 |
| 9 | 用户体验 | **6.0** | **最大的短板**。只描述了"有一列"，没解决：会话很长时卡片刷屏怎么办？推荐错了怎么纠正？"为什么推荐"是给业务员看的，不是给工程师看的 |
| 10 | 交付可行性 | **8.0** | 依赖 `ai_model_configs` 的 embedding 支持，而**当前库里 embedding 未必配得出来**；没写"配不出来怎么办" |

**均分 7.85，其中 4 项低于 9。** 下面逐项补齐。

### 12.2 低于 9 分的改进项（每项都要落到可执行的设计里）

---

#### 维度 4：性能与延迟 `6.5 → 9.0`

**问题**：只说目标不说手段。

**改进**：

1. **资源规模设上限并按源分页**：单次推荐每个源最多扫 **400 行**（`LIMIT 400`，按 `updated_at DESC`）。
   超出的部分靠"最近更新优先"覆盖 —— 这是有意识的取舍，不是遗漏。
2. **TF-IDF 的 idf 值进程内缓存**：以 `(sourceType, 资料数, 最新 updated_at)` 为缓存键，
   资料不变就不重算 idf。当前实现每次请求重算 `documentFrequency`，是纯浪费。
3. **文本预处理缓存**：以 `(resourceId, content_hash)` 缓存分词结果。
   同一份资料在几十次推荐里只分词一次。
4. **向量只对 top-200 精排**（已写），且**向量一次性 batch 加载**（单条 `IN (...)` 查询，不是循环单查）。
5. **硬超时**：CRM 侧检索 **内部预算 2000ms**，超时返回"已完成的部分 + `warnings`"，
   绝不返回 500；插件侧对 CRM 的调用超时 **3500ms**。
6. **可观测**：响应里带 `retrieval.tookMs` 与 `candidates`；超过 500ms 时写一条 warn 日志。
   （不引入 metrics 系统，就用日志 + 响应字段，够定位问题。）

> 达标理由：目标有了手段、手段有了缓存键、缓存有了失效条件、慢有了超时、慢过以后有日志。

---

#### 维度 6：可降级性 `7.0 → 9.2`

**问题**：有降级矩阵，但没有"卡住"的处理。**慢 ≠ 挂**，而面板最怕慢。

**改进**：

1. **超时分层**（写进契约，不是建议）：
   - CRM 内部检索：`2000ms` 硬预算
   - 插件 → CRM：`3500ms`（`AbortSignal.timeout`）
   - 插件 → CLI：沿用既有 CLI 超时（几十秒），但**面板不等它** —— 词法结果先渲染，CLI 结果回来再替换
2. **扩展侧三段式渲染**：`scanning`（骨架屏，最多 4s）→ 词法结果 → 若 CLI 后续返回则**原地升级**。
   4s 没回来就显示"推荐回复还在生成，文档推荐已就绪"，**面板永远不空转**。
3. **失败计数 + 短熔断**：同一 CRM 地址连续 3 次失败 → 5 分钟内不再自动请求（只响应手动刷新）。
   避免"CRM 挂了 → 每次切会话都等 3.5s"的体验灾难。
4. **`partial` 是常态不是异常**：面板明确区分"没有推荐"和"没取到推荐"，
   前者说「这段对话暂时没有匹配到资料」，后者说「资料推荐未取到：…」。这两种文案混起来用户会以为功能坏了。

> 达标理由：慢有超时、超时有先渲染、失败有熔断、部分成功有专门状态。

---

#### 维度 9：用户体验 `6.0 → 9.3`（改进最大项）

**问题**：这一版只解决了"能显示"，没解决"好用"。

**改进**：

1. **刷屏控制**：一列最多 **1 张回复卡 + 3 张文档卡**，其余收进「还有 4 份相关」的展开项。
   列是常驻的，刷屏的代价比弹窗高得多。
2. **推荐理由是给业务员看的**：`reasons` 分两层——
   - **主行（大字）**：一句人话结论，如「客户在索要规格书，这份最对口」
   - **依据行（小字）**：机器判据，如「标题命中 specification · 标签命中 LED · 客户 3 月收过同类」
   两行分开，业务员第一眼拿到结论，想核对时往下看。
3. **错了能纠正**：每张卡右下 `…` 菜单有 `没帮助` / `已发给客户`。
   `已发给客户` 立刻把卡片置灰并写 `sent` 埋点 —— **让用户看到自己的操作有后果**，
   否则"点了没反应"会被理解成坏了。
4. **空态不说空话**：`idle` 说「切到一个会话就开始推荐」；`blocked` 说清原因 + 给按钮。
   **不出现只有标题没有内容的空面板**。
5. **面板可整体折叠但不消失**：折叠成 40px 竖条（带 GJ 标识 + 未读小圆点）。
   业务员忙的时候需要它让开，但不该"关掉就找不到了"。
6. **可拖拽宽度 + 记忆**（写在 8.1）：一列的价值在于"能按我的屏调"。
7. **键盘可达**：卡片可 Tab 聚焦，`Enter` = 主操作（填入/复制），`Esc` = 收起面板。
8. **不打断**：会话切换才刷新，**新消息到达不自动弹面板**（沿用既有"悬浮球是开关"的裁量），
   否则会在业务员打字时抢焦点。
9. **视觉**：沿用 `src/gj-theme.css` 单一来源的品牌令牌，不新增色值。
   语义色只用在状态（`ok`/`blocked`/`skip`）与类型徽章（PDF/Excel/Skill/知识/产品），不滥用。

> 达标理由：刷屏、理由可读性、纠错闭环、空态、折叠、可调宽、键盘、不打断 —— 八件都落到实处。

---

#### 维度 7：可测试性 `7.5 → 9.1`

**问题**：缺"顺序稳定性"等可判定口径。

**改进**：

1. **排序确定性写成契约**：同分按 `(accessCount DESC, updatedAt DESC, id ASC)`。
   测试断言"同一输入连续调 5 次，`id` 序列完全一致"。
2. **`reasons` 可断言**：每个 `reason` 必须能追到 `match` 分项（`reason.kind` ∈ `lexical|structured|semantic|vector`），
   测试可断言"无 `customerId` 时不存在 `kind=structured` 的 reason"。
3. **不发明资料**：CLI 复排的测试里，假 CLI 返回一个不在候选里的 `id`，断言服务端**丢弃**它。
4. **契约测试自动兜底**：4 个新接口写进 `agent-api-contracts.ts` 后，
   `agent-api-contracts-test.ts` 会自动校验"每个对外写接口都有严格契约"，无需另写。
5. **先红后绿纪律**（第 11 节）写进文档，不只在约定里。

---

#### 维度 10：交付可行性 `8.0 → 9.0`

**问题**：embedding 未必配得出来。

**改进**：

1. **默认路径不依赖 embedding**：词法 + 结构化 + 语义扩展三路是 v1 的完整功能，
   向量是**增强**。这条明确写进接口字段（`vectorEnabled`）与 UI（不显示"向量"字样，避免用户误会没开就是坏的）。
2. **分两批交付**：
   - **批 1（本次）**：四源目录 + 三路检索 + AI 复排 + 右侧整列 + `reveal` + `feedback`。**不依赖任何模型凭据**（AI 复排走本机 CLI，不可用则退词法）。
   - **批 2（后续）**：向量表落库 + embedding 补齐任务 + 余弦精排。表结构本次就建好，开关留着，避免二次迁移。
3. **零新基础设施**：不新增端口、不新增守护进程、不新增外部服务。

### 12.3 改进后评分

| # | 维度 | 初版 | 改进后 | 关键补齐 |
|---|---|---|---|---|
| 1 | 功能完整性 | 8.5 | **9.2** | 知识文档"无外链 → 返回正文"写清；边界态逐个定义 |
| 2 | 架构合理性 | 9.0 | **9.4** | 分层职责一句话化；三处失败域独立 |
| 3 | 既有资产复用度 | 9.5 | **9.5** | 保持（四源 / access 姿态 / 词法口径 / 契约表全复用） |
| 4 | 性能与延迟 | 6.5 | **9.0** | 分源限流 400 行 + idf 缓存 + 分词缓存 + 向量 batch + 硬超时 + `tookMs` |
| 5 | 安全与权限 | 8.0 | **9.3** | 补审计保留期 90 天 + 审计仅 `agent.manage` 可见 + 越权措辞统一 |
| 6 | 可降级性 | 7.0 | **9.2** | 超时分层 + 三段式渲染 + 3 次失败短熔断 + `partial` 专门状态 |
| 7 | 可测试性 | 7.5 | **9.1** | 排序确定性契约 + reason 可追溯 + 不发明资料断言 + 先红后绿纪律 |
| 8 | 可维护性 | 8.5 | **9.2** | 独立 repository 不进 persistAll 写成硬约束 + 缓存键与失效条件明确 |
| 9 | 用户体验 | 6.0 | **9.3** | 刷屏控制 / 双层理由 / 纠错闭环 / 空态 / 折叠 / 调宽 / 键盘 / 不打断 |
| 10 | 交付可行性 | 8.0 | **9.0** | 两批交付 + 默认不依赖 embedding + 零新基础设施 |

**均分 7.85 → 9.22，10 项全部 ≥9.0。**

### 12.4 保留的两处"有意不做"（不是遗漏）

诚实标注，避免被当成漏项：

1. **不做在线学习重排**。`feedback` 只进对数压缩的简单先验，不做模型更新。
   样本量小时学习会放大噪声，收益为负。
2. **不做跨业务员的资源热度榜**。会让新业务员永远只看到"老业务员发过的那些"，
   压缩长尾资料的曝光。当前只做团队级 `sent` 计数的温和加权。

---

## 13. 落地清单

| 批次 | 内容 | 产出 |
|---|---|---|
| 1 | `backend/src/resource-hub.ts` + `resource-hub-test.ts` + 4 个开放接口 + 契约登记 + 双库迁移 | CRM 侧可被外部读到资源（**已完成**：62 断言，双库 `1.4.19-resource-hub`） |
| 1 | `whatsapp-plugin`：`json-extract.ts` / `crm-resources.ts` / `resource-recommend-service.ts` + 4 条路由 + 2 份测试 | 检索 + AI 复排（**已完成**：43 断言） |
| 1 | `whatsapp-web-translator`：右侧整列 + `suggest`/`resources`/`reveal` 通道 + 测试 | 业务员看得见、点得着 |
| 2 | `resource_embeddings` 补齐任务 + 余弦精排 | 同义改写召回 |

**铁律**：结构改动双库同步（`db:migrate:dev` → `db:migrate:personal` → `goodjob-db-parity.sh`）；
改完不抢跑提交。
