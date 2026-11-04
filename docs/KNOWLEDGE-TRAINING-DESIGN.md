# 知识库训练：工程规格（Knowledge Training Design）

- 版本：v1 草案（2026-10-16）
- 对应报告：`frontend/design-preview/knowledge-training-design.html`（含现状体检、调研、三轮自我辩论）
- 定位：**训语料，不训权重**。CRM 做治理端（生产 / 审核 / 成绩单），插件做运行端（检索 / 出稿）。

---

## 1. 目标与非目标

**目标**

1. 一次训练 = 一条可追溯的语料生产流水线：采集 → CLI 提炼 → 候选池 → 人工确认 → 发布 → 回流。
2. 训练操作简易：一屏 20 条、键盘可完成，目标 2 分钟/屏。
3. 训练完立刻能验证：`试问一句` + `成绩单`（golden set 回测）。
4. 每一次推荐回复都能**点开来源**，三层可展开：训练条目 → 出处（文件段落 / 会话） → 原文。
5. 检索按既定偏好走 **CLI 优先**：CLI 有选择权，没有编造权。

**非目标（明确不做）**

- 不微调任何模型（外部网关无通道，且权重污染不可回滚）。
- 不做 CRM↔插件的双向同步（CRM→插件单向发布 + 血缘镜像）。
- 不把客户会话原文写入 CRM 库（沿用既有铁律；出处用引用指针表达）。
- 不让自动回复自动发送（维持"草稿，人工发"）。

---

## 2. 现状断点（改之前的事实基线）

| # | 断点 | 证据 |
|---|---|---|
| 1 | 生产端错位：训练库长在插件控制台（3100），CRM 无工作台 | 训练库 CRUD 路由全在 `whatsapp-plugin/src/server/app.ts:1132-1212`；CRM `backend/src` 中无 `training_*` 任何引用 |
| 2 | 准入太松 + 污染口 | 45 条全部来自档案批量导入（`source=profile`），0 条人工；`selectSnippets()` 全不相关时仍退 priority 前 6（`training-library-service.ts:410-435`）；policy 超上限只 warning（`:380-381`） |
| 3 | 反馈断链 | `recordHits` 只覆盖 qa，调用点 2 处（`auto-chat-service.ts:543`、`:731`）；`forbiddenHits()` 无调用点；`curation-engine.ts` 已定义未接线 |
| 4 | 来源只到标签粒度 | 扩展仅渲染来源徽章 + `describeEvidence` 文案（`whatsapp-web-translator/src/resources.js:123-137`、`crm.js:520-541`），无法指回具体条目/文件/原文 |

---

## 3. 数据模型（CRM 新增两张表）

### 3.1 `kb_training_runs`（训练批次）

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | VARCHAR(64) PK | `kbr_<rand>` |
| `team_id` / `owner_id` | VARCHAR(64) | 沿用 CRM 团队/owner 口径，查询一律带 team_id |
| `sources_json` | JSON | `{"conversations":{"since":"…","limit":60},"files":{"assetIds":[…]}}` |
| `status` | VARCHAR(16) | `running` / `succeeded` / `partial` / `failed` |
| `engine` | VARCHAR(16) | `cli` / `ai` / `none`（**记录实际生效的那一档**，降级要如实） |
| `model` | VARCHAR(64) | 实际使用的模型 id |
| `stats_json` | JSON | `{"inputSegments":42,"candidates":23,"duplicates":7,"skipped":12,"cliCalls":3}` |
| `error_message` | VARCHAR(1000) | 整批失败原因 |
| `created_at` / `finished_at` | DATETIME(3) | |

### 3.2 `kb_training_candidates`（候选 / 已发布镜像）

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | VARCHAR(64) PK | `kbc_<rand>` |
| `run_id` | VARCHAR(64) | 关联批次（批次撤回的依据） |
| `team_id` / `owner_id` | VARCHAR(64) | |
| `kind` | VARCHAR(16) | `qa` / `snippet` / `policy` / `forbidden`（与插件同口径） |
| `question` / `answer` | TEXT | 整理后的内容（**不写原文**） |
| `tags_json` / `languages_json` | JSON | 受控词表标签（复用 `knowledge_vocabulary`）；语言 `zh/en/…` |
| `confidence` | DECIMAL(4,3) | CLI 给的置信度 |
| `source_type` | VARCHAR(16) | `file` / `conversation` / `manual` / `product` |
| `source_ref_json` | JSON | `{"type":"file","assetId":"ka_x","anchor":"§2.1","version":"v2"}` 或 `{"type":"conversation","conversationKey":"…","messageIds":[…]}` 或 `{"type":"manual","author":"admin","decidedAt":"…"}` |
| `rationale` | VARCHAR(1000) | CLI 给的"为什么值得进库"（确认界面直接显示） |
| `fingerprint` | CHAR(32) | 与插件一致的 `sha256(kind+question+answer)[:32]`，用于幂等 |
| `status` | VARCHAR(16) | `pending` / `approved` / `rejected` / `published` |
| `published_entry_id` | VARCHAR(64) | 插件训练库条目 id（血缘） |
| `reviewed_by` / `reviewed_at` | VARCHAR(64) / DATETIME(3) | |

**索引**：`(team_id, status, created_at)`、`(run_id)`、`UNIQUE(fingerprint)`。

**发布闸（硬规则，写进代码）**

```
可发布 = status == approved
      && source_ref_json 非空                     // 无出处永不发布
      && (source_type != "conversation" || 人工确认过)   // 会话来源必须人工
自动放行 = confidence >= 0.9
        && source_type == "file"
        && !answer 命中商务敏感正则（价格/折扣/交期承诺）
```

---

## 4. 接口

### 4.1 CRM 新增（治理端）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/kb/training/runs` | 发起训练。body：`{ sources:{conversations?:{since,limit}, files?:{assetIds}}, limit?:number }`；返回 `{run}`；提炼异步执行（同 followup-sync 的姿态：先返回、后台跑） |
| GET | `/api/kb/training/runs` | 批次列表（含 stats 与状态） |
| GET | `/api/kb/training/candidates?status=pending&runId=&limit=20&cursor=` | 候选池分页（**必须带回 `sourceRef`、`rationale`、`confidence`**） |
| POST | `/api/kb/training/candidates/review` | `{ ids:[…≤20], action:"confirm"\|"drop", edits?:[{id,question?,answer?}] }` → 与插件 `confirm` 语义一致（confirm→approved，drop→rejected） |
| POST | `/api/kb/training/candidates/publish` | `{ ids:[…≤20] }` → 逐条调插件 `POST /api/v1/training/library`（幂等：撞指纹返回既有条目），回写 `published_entry_id`；返回 `{published, existing, failed}` |
| POST | `/api/kb/training/candidates/:id/revoke` | 撤回：调插件 `DELETE` 或置 `archived`（保留留痕），CRM 侧记状态 |
| POST | `/api/kb/training/probe` | `{ body:"客户来文" }` → 代理插件 `/api/v1/training/library/match`，返回命中条目 + 拟用 citations + 是否会被护栏拦 |
| GET | `/api/kb/training/scorecard?runId=` | golden set 回测结果 + 命中/采纳统计 |

**鉴权与登记**：全部 `requireAuth`；`POST` 类要在 `agent-api-contracts.ts` 登记严格契约（未登记会挂 `agent-api-contracts-test`），`/api/kb/*` 可整体列入 agent 策略拒绝面（与 `/api/exchange` 同类：治理控制面）。

### 4.2 插件改造（运行端）

| 位置 | 改动 |
|---|---|
| `training-library-service.ts` `resolve()` | 返回结构加 `citations[]`（见 §6）；snippet 全不相关 → 返回空（**删除"退回 priority 前 6"**）；policy 超上限按相关度截断并记 warning 明细 |
| `recordHits()` | 覆盖四类（qa/snippet/policy/forbidden），并加"是否被采纳"维度 |
| 新增 `resolveWithCli()` | 候选 ≥2 或分数接近时调 CLI 精排：**只能从候选集挑 + 回引 id**；不在候选集的 pick 直接丢弃并计数（沿用 `resource-recommend-service.ts:461-507` 的 `invented` 规则） |
| `cli-engine.ts` | 新增技能包或提示词模板 `goodjob-kb-select`（选择 + 合并同族 + 给理由）；模型沿用 `deepseek-v4.1-flash`；超时建议 8s，超时即降级词法 |
| `auto-chat-service.ts` | `buildReplyRequest()` 提示词加"逐句回引 `[[src:id]]`"契约；生成后校验：引用的 id 必须 ⊆ 给定 citations，否则草稿标 `blocked: 依据不足，建议人工` |
| 缓存 | 同一问法 5 分钟内复用上次 CLI 选择结果（内存缓存，key = 归一化来文 hash） |

---

## 5. CLI 提炼契约（训练端）

调用方式：复用 `backend/src/cli-ai.ts::runCliSummary(prompt, { timeoutMs })`（本机 CLI 优先 → 失败退 CRM 配置模型 → 都没有则 `engine:"none"` 并如实上报）。

**批处理**：每 20 段语料 1 次调用；100 段语料 ≈ 5 次调用。**禁止每条一调**。

**输入**（user 段，系统提示由 CLI 自身拼接）

```
任务：把以下语料提炼成知识库候选条目。
规则：
1) kind 只能取 qa / snippet / policy / forbidden。
2) question 用客户真实问法；answer 必须是可对外口径，不得编造，不得含价格/折扣/交期承诺。
3) 每条必须给 source_seg（对应输入的段号）。
4) 与"现有条目问法"重复的，输出 action=duplicate 并给 targetEntryId。
5) 无法确定答案的，输出 action=knowledge_gap，answer 留空。
输入语料：
[seg 1] …（会话片段或文件段落）
[seg 2] …
现有条目问法：["MOQ 是多少？", "…"]
输出 JSON：{ "candidates": [ { kind, question, answer, tags, languages, source_seg, rationale, confidence, action } ] }
```

**输出校验（代码侧，不信任模型）**

- JSON 解析失败 / 缺字段 / `source_seg` 越界 → 该候选丢弃并计数（防臆造）。
- `confidence < 0.5` → 强制 `pending`。
- `action=knowledge_gap` → 落候选池并标"知识缺口"，**不进发布流程**，在界面上单独分组（这就是调研里"补缺口让准确率跳升"的动作入口）。

---

## 6. 引用结构（来源证明的载体）

```ts
export interface Citation {
  sourceType: "training_library" | "file" | "conversation" | "product";
  refId: string;        // tle_xxx / ka_xxx / conversationKey / prd_xxx
  title: string;        // 条目问法 或 资料标题 或 联系人+日期
  snippet: string;      // 支撑那句话的最小片段（≤200 字）
  anchor?: string;      // 文件段落锚点 / 会话消息 id
  version?: string;     // 资料版本
  score: number;        // 检索分
  hitTerms: string[];   // 命中的词（"为什么是它"）
  verified?: boolean;   // 已校订
  adopted?: boolean;    // 是否被采纳过（回流数据）
}
```

**三层展示（扩展侧）**

1. 条目层：标题 + 类型 + 命中词 + 分数；
2. 出处层：文件（含版本与段落锚点）/ 会话（含日期与联系人）/ 人工口径（录入人与时间）；
3. 原文层：「展开原文」按钮 → 资料正文，或「查看对话」→ 走既有 `followup-transcript` 通道（按需拉取，不落库）。

**弃答规则（硬）**：citations 为空或回引校验失败 → 不出正文，只出"依据不足，建议人工 + 来文关键词"。

---

## 7. 成绩单（训练后自动回测）

| 指标 | 定义 | 目标（首版） |
|---|---|---|
| 命中率 | golden 问法中检索出相关条目的比例 | ≥ 80% |
| 来源命中率 | 命中且引到正确 sourceRef 的比例 | ≥ 75% |
| 引用准确率 | 引用的条目确实支撑该句的比例（人工抽查 20 条） | ≥ 90% |
| 越权率 | 草稿中出现价格/折扣/交期承诺的比例 | 0% |

- golden set：20–50 条真实客户问法，覆盖典型问法、否定句、缩略语、中英混问；随库版本化存放（`kb_golden_queries`，或先落 JSON 文件由接口读取）。
- 每批训练结束自动跑，结果挂在批次上；两次训练可对比（这就是"训练有没有用"的答案）。
- 「试问一句」不等回测，随时可用。

---

## 8. 回流与退役

| 信号 | 采集点 | 动作 |
|---|---|---|
| 草稿被采纳（填进输入框并发送） | 扩展埋点（已有通道） | `hit_count+1` 且 `adopted_count+1`；连续采纳 → 检索升权 |
| 被改写后发送 | 扩展：AI 稿 vs 实发稿 diff | 存为改进样本，进下一批训练候选（**最高价值语料**） |
| 标记「没帮助」 | 扩展按钮（已有） | 该条对该场景降权；累计 N 次 → 待退役 |
| 90 天 0 命中 | 命中计数（本次补齐四类） | 自动置 `retired` 并提示复核（不删，留痕） |

---

## 9. 实施批次与验收

**批 1 · 可观测性打底**（不改行为，只加数据）
- [ ] `recordHits` 覆盖四类；`forbiddenHits()` 接线或删除（不留死代码）
- [ ] `match` 接口返回 `citations[]`
- [ ] 扩展来源徽章升级为可展开第一版
- 验收：任意一类条目命中后 `hit_count` 真实 +1；扩展点开来源能看到条目与命中词

**批 2 · 训练工作台**
- [ ] 两张表 + 迁移（`ensureKbTrainingSchema`）+ CRM 训练视图
- [ ] 会话库与文件中心两源采集（含段落锚点切分）
- [ ] CLI 批量提炼 + 候选落库 + 输出校验
- [ ] 候选确认界面（20 条/屏、键盘操作、预勾选）
- [ ] 发布到插件 + 血缘回写 + 批次撤回
- 验收：真跑一次训练 → 确认 → 插件库出现 active 条目 → CRM 可见血缘

**批 3 · 检索硬化**
- [ ] snippet 不再硬塞；policy 按相关度截断
- [ ] 分层权重（已校订 ×1.0 / 未校订 ×0.4 且仅精确命中）+ 同族合并 + 生命周期过滤
- [ ] CLI 精排接线（只挑不造 + 防臆造计数）+ 5 分钟缓存
- [ ] 出稿回引校验 + 弃答路径
- 验收：构造全无关库 → 提示词不污染；构造臆造引用 → 被拦并走弃答

**批 4 · 成绩单与回流**
- [ ] golden set + 四项指标自动回测 + 界面
- [ ] 采纳 / 改写 / 丢弃回流；90 天退役
- 验收：训练后自动出成绩单；改写样本进入下一批候选；零命中条目被标退役

---

## 10. 待定夺（默认取值已给，可直接按默认实施）

1. **价格/交期口径是否进库**：默认**进库但标「仅人工参考」**，不进入可引用集（检索层单独过滤）。
2. **训练频率**：默认**手动 + 每周提醒**（新增会话 ≥20 段才提示）。
3. **发布默认动作**：默认**高置信（≥0.9）+ 文件出处 + 无商务承诺 → 自动放行（可撤回）**，其余人工确认。
