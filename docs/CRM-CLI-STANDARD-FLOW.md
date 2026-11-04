# CRM ↔ WorkBuddy CLI 标准流程与数据持久化规范

> 版本：1.0（2026-10-06）
> 适用：GoodJob CRM 个人版 1.8.4+ / 开发档位 4190、个人档位 4188 / WorkBuddy CLI（Runner 8931 配对）
> 定位：获客 → 背调 → 写信 → 发送 → 阶段演进 全链路的**流程标准**、**数据落点**与**守门约束**。任何新增 AI/CLI 能力必须挂进这条链，不允许绕过留档自建旁路。

---

## 1. 流程总览

```
┌─ 获客层 ──────────────────────────────────────────────┐
│  数据源搜索（provider dispatcher）                     │
│  AI 搜客（callAiModel）                               │
│  CLI 获客（Runner + goodjob-lead-acquisition 口径）   │
│         ↓ 三条通道全部汇入                             │
│  persistProviderOpportunities()  ← 统一去重/合并/验证   │
│         ↓                                            │
│  website_opportunities（候选清单）                     │
└──────────────────────────────────────────────────────┘
         ↓ 官网探针 / 联系方式补全（取邮箱，禁编造）
┌─ 写信层 ──────────────────────────────────────────────┐
│  阶段推导（prospect_touchpoints + 转换状态）            │
│  背调（AI API / CLI，research）→ background_research_records │
│         ↓                                            │
│  buildStageAwareSequence()：按阶段 × 背调 × 发件人身份  │
│  产出批次/方案信件（AI API 或 CLI，email）              │
└──────────────────────────────────────────────────────┘
         ↓ 草稿确认（人工）→ pending 门禁 → 发送窗口
┌─ 发送层 ──────────────────────────────────────────────┐
│  批次 Runner / 方案 Runner 自动投递                    │
│  outbound_email_logs + prospect_touchpoints 双留档     │
│         ↓                                            │
│  回复/退信 → 阶段演进 → 回到写信层（不再从第一封重来）   │
└──────────────────────────────────────────────────────┘
```

**核心原则：同一件事只有一个入口、一份留档、一套去重。** 获客三条通道共用入池逻辑；写信两条引擎共用同一份"阶段 × 背调"蓝图（`assembleDevelopmentEmailBrief`）；发送后阶段是推导值，不手工维护。

---

## 2. 引擎作业标准（CLI / AI 双通道统一）

### 2.1 作业类型（`ai_engine_jobs.kind`）

| kind | 用途 | 输入要点 | 结果落点 |
|---|---|---|---|
| `research` | 客户背调 | entityType（candidate→prospect）+ entityId | `background_research_records` 留档 |
| `email` | 开发信正文 | 阶段 + 背调 + 发件人/收件人画像 | 批次/工坊信件（items_json / draft 响应） |
| `search` | CLI 获客 | goal/productKeywords/countries/industry/customerType/limit(1-30) | `syncAcquisitionCandidates()` → 候选清单 |

### 2.2 作业生命周期（标准）

1. **创建**：`runEngineCliJob()` 写 `ai_engine_jobs`（request_json 含完整提示词，可回查）。
2. **领取**：Runner 主动 claim（一次性配对码），心跳 8–10s。
3. **收尾**：HTTP 等待窗口内同步返回；超窗由**轮询接口**或**后台补收工序** `recoverEngineCliJobs()` 收尾——收尾分支必须完成业务落库（如 search 的入池），保证用户关页面不丢结果。
4. **留档**：result_json 存结构化结果摘要（如 search 存 `{rawCount, created, evidenceUpdated}`）。

### 2.3 降级与错误口径（标准）

- Runner 离线 / 环境不满足 → **409 `engineUnavailable: true`**，不建作业、不产生脏数据。
- 档位缺能力（如无 AI 配置）→ 503。
- CLI 写信失败 → 该项 `letterStatus: failed`，**降级为模板版**，不阻塞批次其余项。
- 补写超时兜底：`LETTER_PENDING_MAX_MS = 2 小时`，超时自动放行模板版，防止整批永久卡死。

---

## 3. 开发阶段阶梯（写信层的标准口径）

```
not_contacted → first_touch_sent → following_up   ← 冷触达链（最多 3 封）
replied_interested / replied_negative / bounced / converted ← 特殊阶段
```

- **阶段是推导值**：由 `prospect_touchpoints`（outbound `send` / inbound `reply`+`bounce`）+ 转换状态推导，不落库。
- **接着客户现在的阶段往下走**：已发首触的客户只生成"跟进 + 收尾"，绝不再发第一封。
- **coldOnly（批量/自动方案默认）**：已拒绝 / 已退信 / 已转化的目标直接不进批次（skipped 占位并写明原因）。单封工坊关闭 coldOnly 时，这三类各有一封合适的信。
- **人工临时覆盖**：草稿批次里可 `POST /api/prospect-outreach-batches/:id/items/:itemId` with `action:"stage"` + `stageKey`，重排并重写信件；`stageSource: "manual"`，选"按系统推导"即回退。
- **pending 门禁**：`letterStatus: pending`（正文补写中）的项**发送端跳过**，半成品绝不外发。

---

## 4. 数据持久化清单（可查询地图）

| 数据 | 表 / 落点 | 说明 |
|---|---|---|
| 引擎作业全量 | `ai_engine_jobs` | request_json（发出的提示词）+ result_json（结果摘要），任何 AI/CLI 调用可回查 |
| 背调留档 | `background_research_records` | 写信依据可追溯；写库失败不影响背调返回 |
| 获客候选 | `website_opportunities` | 三通道统一入池；CLI 通道 source=`cli_acquisition`、sourceLabel=本机 CLI 获客，带 evidence 快照 |
| 批次信件 | `prospect_outreach_batches.items_json` | 逐条 stageKey / stageSource / researchId / researchScore / letterStatus / letterEngine / letterBasis / letterNote |
| 自动方案 | `prospect_outreach_plans.items_json` | 同上口径，与批次共用 composeItem |
| 触达留档 | `prospect_touchpoints` | outbound send / inbound reply+bounce；阶段推导唯一依据 |
| 已发邮件 | `outbound_email_logs` | ⚠️ 与 touchpoints **双索引合并**（messageId 优先 + recipient\|sentAt 兜底） |
| 团队引擎设置 | AI 引擎设置（researchSource/emailSource/cliAdapter/timeout） | 团队共享；CLI 适配器默认 workbuddy |

**新增字段规则**：`items_json` / `policy_json` / `result_json` 都是 JSON 列，扩展字段**不需要数据库迁移**；`kind` 这类枚举列扩值时确认列宽即可。

---

## 5. API 一览（标准入口）

| 端点 | 作用 | Agent 通道 |
|---|---|---|
| `POST /api/ai-engine/acquire` | CLI 获客（等待窗口 `AI_ENGINE_ACQUIRE_WAIT_MS`，默认 3 分钟） | 已注册契约，externalPatterns |
| `GET /api/ai-engine/jobs/:id` | 作业轮询（收尾时同步完成业务落库） | 已注册 |
| `GET/PUT /api/ai-engine/settings` | 团队引擎来源设置 | 已注册 |
| `POST /api/ai-background-research` | 背调（成功返回前 `persistBackgroundResearchRecord`） | externalPatterns |
| `POST /api/development-email/draft` | 单封工坊（stage 可选入参，省略自动推导） | externalPatterns |
| `POST /api/prospect-outreach-batches` | 创建批次（阶段感知成稿） | 已注册 |
| `POST /api/prospect-outreach-batches/:id/items/:itemId` | remove / restore / edit / **stage** | 已注册 |
| `POST /api/outreach-journey/send` | 按阶段发送（草稿 → 人工确认 → 真发） | externalPatterns |

**新增写接口的硬规则**：必须在 `agent-api-contracts.ts` `define()` 注册，真外发接口必须进 `agent-api-policy.ts` 的 `externalPatterns`；入站 webhook 类进 `deniedPatterns`。改完必跑 `npm test`（契约测试 abort 在第一个失败处）。

---

## 6. Runner 运维标准

- **启动**：Runner 与 CRM 通过一次性配对码配对，心跳 8–10s；Runner 离线时所有 CLI 作业 409 降级（见 §2.3），这是**预期行为**不是故障。
- **真实 CLI 首次使用**：需手动 `codebuddy` → `/login` 一次。
- **适配器**：`workbuddy`（默认）| `codex`；提示词包装器统一走 `ai-engine-prompts.ts`，**不允许**各调用点手拼 CLI 提示词。
- **浏览器降级**：`tryStartBrowserService()` 降级存活，浏览器端口被占不杀进程。

---

## 7. 守门约束（不可绕过）

1. **外发必确认**：真外发接口（写信发送 / 获客联网搜索 / 背调联网）必须经外发确认门禁；批量发送永远走"草稿 → 人工确认 → 真发"。
2. **禁编造**：CLI 获客候选按技能口径**不带邮箱**——只产出经核实的公司与来源 URL。进批次前必须走官网探针 / 联系方式补全，这是设计内的人工核实环节。
3. **禁爬领英**：`BLOCKED_HOSTS` 主动屏蔽；社媒只走官方 API（见 `docs/SOCIAL-MEDIA-INTEGRATION-RESEARCH-AND-PLAN.md`）。
4. **中文名守卫**：中文公司名/人名绝不进英文信；称呼退到 "Sales team"，主题用不含公司名的版本。
5. **发送前资格复核**：do_not_contact / excluded / suppressed / synced 保护 + coldOnly 口径，逐项过 `itemLetterReadyToSend()`。

---

## 8. 验证清单（每次改这条链后必做）

- [ ] `cd backend && npm test` 全绿（契约测试 abort 在第一个失败处，红了逐文件摸底）
- [ ] 前后端 `npx tsc --noEmit` 干净
- [ ] 双库 parity：`bash tools/goodjob-db-parity.sh` → 「两库结构一致 ✓」
- [ ] 开发档位 E2E（临时端口 4191，`GOODJOB_ENV_FILE=.env.development.local PORT=4191`，Node fetch 禁连 4190）
- [ ] 编译产物启动的进程**不热重载**：重建 dist 后必须重启（`spawn-detached.py backend`；`crmctl stop` 杀不掉 `node dist/server.js`）
- [ ] 新文件 `svn add`，随版本说明一起提交
