# 知识库训练：开发方案（功能闭环版）

- 版本：v1（2026-10-16）
- 上游设计：`docs/KNOWLEDGE-TRAINING-DESIGN.md`（设计规格：做什么、为什么）
- 配套报告：`frontend/design-preview/knowledge-training-dev-plan.html`（可视化：闭环图 / 节奏 / 三轮辩论）
- 本方案回答的是**怎么做、按什么顺序做、怎么证明做对了**：把设计方案落成 **5 个可独立验收的功能闭环切片**，每片都能从一个真实场景的入口走到出口。

> 行号说明：文中 `file:line` 为本轮（2026-10-16）实测值，会随代码演进漂移。**实施时以「文件 + 函数名」为准**，行号仅作定位参考。

---

## 0 怎么读这份文档

| 你要什么 | 看哪节 |
|---|---|
| 一句话结论：分几批、每批交付什么 | §4 |
| 什么叫「功能闭环」，四个闭环各自的判据 | §3 |
| 建哪些表、开哪些接口、改哪些文件 | §5 / §6 / §7 / §8 |
| 坏了怎么办（CLI 挂 / 插件离线 / 发布半途失败） | §9 |
| 怎么证明真的做对了（命令 + 期望 + 反例） | §10 |
| 出事了怎么退回去 | §11 |
| 为什么这么分批（三次自我辩论） | §12 |

---

## 1 口径（沿用设计方案，不在此重复论证）

- **训练 = 语料生产**，不是模型微调。CRM 做治理端（生产 / 审核 / 成绩单），插件做运行端（检索 / 出稿）。
- **发布是单向的**：CRM → 插件。插件库是运行副本，CRM 表是事实与血缘。
- **来源是硬门槛**：无出处永不自动发布；引用不可回指则弃答。
- **四条不做**（继承设计方案 §1）：不微调权重 / 不做双向同步 / 不把会话原文写进 CRM 库 / 不让自动回复自动发送。

---

## 2 六个技术前提（本轮实测，开发方案的立足点）

开发方案与设计方案的差别，全在这六条上。**它们决定哪些设计可以照做、哪些必须改法。**

### 前提 1：CRM → 插件的认证通道已经天然打通，零改造

- 插件所有 `/api/v1` 路由统一挂 `requireCrmAuth(config.crmJwtSecret)`（`whatsapp-plugin/src/server/app.ts:593`）。
- 校验逻辑 `verifyCrmToken()`（`whatsapp-plugin/src/server/crm-auth.ts:34-56`）要求：`alg=HS256`、`iss=goodjob-crm`、`aud=goodjob-crm-web`、有 `sub` 与未过期的 `exp`，签名用 `CRM_JWT_SECRET`。
- CRM 侧 `signToken(user)`（`backend/src/auth.ts:111-124`；`TOKEN_ISSUER`/`TOKEN_AUDIENCE` 定义在 `auth.ts:17-18`）签发的 claims **正是这个格式**：`subject=user.id`、`ver=authVersion`、HS256、带 `exp`。
- 两侧 secret 同值（插件 `config.ts:228` 取 `CRM_JWT_SECRET || JWT_SECRET`，CRM 用 `JWT_SECRET`；两档实测共库同密）。

> **结论**：CRM 侧只需 `signToken(目标用户)` 就能调插件，**不需要任何插件侧改造来"接收 CRM"**。这同时回答了设计方案漏掉的关键问题——**发布给谁由"用谁的身份签 token"决定**。

### 前提 2：插件训练库写入是幂等的

`TrainingLibraryService.save()`（`training-library-service.ts:217-261`）在 `fingerprint = sha256(kind+question+answer)` 撞上已有条目时**不报错**，直接返回既有那条（`:231-234`）；路由用 201/200 区分新建与已存在（`app.ts:1150-1160`）。

> **结论**：CRM 侧重复发布（重试、补发、人工点两次）不会在插件库产生重复条目。发布链路可以放心重试。

### 前提 3：发布即生效，不需要二次确认

`save()` 新建条目时 `status: existing?.status ?? "active"`（`training-library-service.ts:252`，注释明确"人工录入的条目直接 active：人在录入那一刻就是确认动作"）。只有 `importFromProfile()`（`:299-`）会显式落 `candidate`。

> **结论**：CRM 的「确认」发生在 CRM 侧候选池，用户点「发布」→ 调一次 `POST /api/v1/training/library` → 插件库立刻 active 进提示词。**"发布"是一个动作不是两个**，闭环判据可以直接写"发布后插件库 status=active"。

### 前提 4：插件库按 owner 隔离，发布目标必须显式指定

所有训练库路由用 `request.crmIdentity!.userId` 作 ownerUserId（`app.ts:1143 / 1152 / 1176 / 1196 / 1206`）。

> **结论**：**这是设计方案里缺失的一环**。CRM 的「发布」必须先决定"发给谁"：
> - P1：**只发操作者本人**（`signToken(actor)`）——最小闭环，零歧义；
> - P2：可选发团队其他成员——需要对团队内"已接入插件的账号"枚举，来源见 §6.3。

### 前提 5：会话语料在插件库，CRM 需要一个批量出口

会话原文存于插件的 `conversations`（`whatsapp-plugin/src/server/db/mysql-migrate.ts:101-113`）与 `messages.body`（`:115-133`，LONGTEXT）。CRM 侧没有也不该有会话原文副本。

> **结论**：P2 采集会话必须**新增一个插件侧批量语料接口**，CRM 拉取后**即取即提炼、只存整理结果与引用指针**（原文不落 CRM 库，守住铁律）。单条会话的按需查看已有现成模式可复用（见前提 6）。

### 前提 6：CRM 侧已有「调插件」的现成模式与常量

- 插件基址：`process.env.WHATSAPP_PLUGIN_BASE_URL || "http://127.0.0.1:3100"`（`backend/src/server.ts:10917`，另见 `:11035`）。
- 现成代理范例：`GET /api/whatsapp/followup-transcript/:activityId`（`backend/src/server.ts:11034`）——"CRM 前端要插件数据时，由 CRM 代理并按需拉取"。
- CRM 侧 CLI 调用器：`runCliSummary(prompt, { timeoutMs, binary })`（`backend/src/cli-ai.ts:189`），环境变量剥离 `CODEBUDDY_/WORKBUDDY_/SERVER__/CLAUDE_` 前缀（`cli-ai.ts:68`），模型 `deepseek-v4.1-flash`（`cli-ai.ts:81`），**当前只服务跟进补全一个场景**（文件头注释 `cli-ai.ts:8`）。

> **结论**：CRM 侧新增 `backend/src/plugin-client.ts` 作为**唯一的插件出口**，把「签 token + 拼 URL + 超时 + 错误归一」收在一处；训练模块不直接写 fetch。

---

## 3 四个功能闭环（本方案的核心）

「闭环」的定义（严格）：**一个真实场景，用户从入口走到出口，中途不需要人工兜底、不需要查数据库、不会有静默失败**。缺任何一环都只是"做了个功能"，不是闭环。

### 闭环 ①「训练一次」（治理端主线）

| 项 | 内容 |
|---|---|
| 入口 | CRM「知识训练」视图 → 「开始训练」→ 选源 + 范围 → 确认 |
| 步骤 | 采集语料 → 后台 CLI 批量提炼 → 候选落池（含出处/理由/置信度）→ 候选屏批量确认（20 条/屏）→ 发布 |
| 出口 | 插件训练库出现 `status=active` 条目；CRM 侧该条显示 `published_entry_id` 血缘 |
| 闭环判据 | ① 一次训练从点下到出候选 ≤ 2 分钟（100 段语料 ≈ 5 次 CLI 调用）；② 确认 20 条 ≤ 2 分钟；③ 发布后插件库可查到、CRM 血缘可回指；④ **同一批重复发布不产生第二条**；⑤ 撤回后插件库该条 `archived`、CRM 状态可查 |
| 断裂点 | 候选池空（源没选对）/ 发布后插件里没有（owner 签错）/ 血缘空（回写失败被吞） |

### 闭环 ②「问一句」（训练完立刻验证）

| 项 | 内容 |
|---|---|
| 入口 | 训练工作台「试问一句」输入框 |
| 步骤 | 输入一段客户来文 → 走**真实检索链路** → 返回命中条目 + citations + 拟用回复 + 护栏判决 |
| 出口 | 屏幕上看到：会不会被采用、用哪几条、每条的证据切片、是否撞商务红线 |
| 闭环判据 | ① 结果与插件实跑**同源**（调用同一条 `resolve()`，不是另写一套模拟）；② citations 每条可点开出处；③ 撞护栏时明确显示"哪句被拦、为什么" |
| 断裂点 | 试问结果与真实推荐不一致（两套逻辑）；citations 为空却仍出稿 |

### 闭环 ③「答可溯源」（运行端最终价值）

| 项 | 内容 |
|---|---|
| 入口 | 扩展右侧「推荐回复」/「相关文档」面板 |
| 步骤 | 生成草稿 → 草稿带引用 → 点引用 → 三层展开（条目 → 出处 → 原文）→ 采纳 / 改写 / 没帮助 |
| 出口 | 看到"这句话是根据哪条训练条目、哪份资料第几段说的"；三种反馈都写入回流 |
| 闭环判据 | ① 从点击到看到原文 ≤ 2 次交互；② 引用校验失败时**弃答**（不出正文，只给"依据不足，建议人工"）；③ 采纳后 `hit_count` 与 `adopted_count` 真实 +1 |
| 断裂点 | 只能看到来源标签（当前状态，`resources.js:123-137`）；引用指向不存在的 id；采纳没回流 |

### 闭环 ④「训练有没有用」（度量）

| 项 | 内容 |
|---|---|
| 入口 | 批次详情「成绩单」 |
| 步骤 | 训练结束自动跑 golden set → 四项指标 → 与上一批对比 → 回流数据反哺下一批候选 |
| 出口 | 数字化回答"这批训练值不值"；改写样本出现在下一批候选；零命中条目被标退役 |
| 闭环判据 | ① 四项指标（命中率 / 来源命中率 / 引用准确率 / 越权率）来自**真实检索**而非写死；② 两次训练可并排对比；③ 越权率必须为 0（否则发布闸形同虚设） |
| 断裂点 | 指标永远 100%（没真跑）；改写样本没进候选池；退役只改标记不影响检索 |

---

## 4 批次划分（P0–P4，每批一个可独立验收的闭环切片）

**划分原则（三条）**

1. **每批结束时，用户都能用上一段真实功能**——不留"技术半成品"。
2. **零风险在前，改行为在后**：可观测性（不改行为）→ 语料生产（新增模块）→ 检索硬化（改行为，但此时已有语料可验证）。
3. **窄而通优于宽而断**：P1 只接文件源但全链路通；P2 再加会话源。

| 批次 | 一句话 | 交付的闭环切片 | 用户能干什么（结束时可验） | 风险 | 依赖 |
|---|---|---|---|---|---|
| **P0** | 可观测性打底 | 闭环 ③ 的第一层（来源可展开到条目 + 命中词） | 在扩展里点「来源」，看到是哪条、命中哪些词、多少分 | 低（不改检索行为） | 无 |
| **P1** | 训练工作台（文件源） | 闭环 ① 全链路（窄）+ 闭环 ② ｜ **文件 → 训练 → 发布 → 插件 active → 试问** 端到端通 | 传一份资料，训出一条 QA，发布后插件立刻能用；现场试问验证 | 中（新增模块 + 迁移） | P0（要能看见效果） |
| **P2** | 会话挖矿 | 闭环 ① 的第二个源 + 「知识缺口」补答 | 把真实客户对话里的**问法**挖出来，人工配答后发布 | 中高（涉会话数据，脱敏要求高） | P1 |
| **P3** | 检索硬化 | 闭环 ②③ 的准确性 | 库变干净：无关条目不污染提示词；臆造引用被拦并弃答 | 高（改既有检索行为） | P1/P2（要有语料才验证得出） |
| **P4** | 成绩单与回流 | 闭环 ④ ｜ 训练 → 度量 → 反哺 的循环 | 训练后自动出成绩单；改写样本进下一批候选；零命中条目退役 | 中 | P1（要有批次才回测） |

**节奏建议**：P0 与 P1 可连着做（P0 半天量级）；P2 独立成段（要处理脱敏与切分）；P3 必须在 P1/P2 之后（否则没有语料，硬化无法验证）；P4 收口。

**每批的"可关闭"设计**（贯穿全部批次）：CRM 侧统一开关 `KB_TRAINING_ENABLED`（默认 `true`，开发档先 `false` 后开）；插件侧硬化项各自带开关（见 §8 / §11）。**任一批出问题，关开关即回到上一批状态，不需要回滚代码。**

---

## 5 数据模型（三张新表 + 迁移）

### 5.1 建表位置（遵循项目「新模块独立 Repository」套路）

新建目录 `backend/src/kb-training/`，**照 `backend/src/exchange/exchange-repository.ts` 的模式**（该文件是目前唯一符合此套路且已上线的范例）：

```
backend/src/kb-training/
  kb-training-repository.ts   # ensureKbTrainingSchema(pool) + class MysqlKbTrainingRepository
                              #   + setKbTrainingRepository / getKbTrainingRepository
  kb-training-service.ts      # 采集 / 提炼 / 校验 / 发布编排
  kb-training-prompt.ts       # CLI 提炼提示词 + 输出校验（纯函数，便于单测）
  kb-training-test.ts         # 回归测试（挂进 backend/package.json 的 test 链尾）
```

**不要**把新表塞进 `mysql-store.ts` 的 `persistAll` 体系（那是全表重写模型，新模块不该背上）。

### 5.2 挂载三处（`backend/src/mysql-store.ts`）

| 位置 | 改动 |
|---|---|
| `createMysqlStore()` 内 | 在 `ensureExchangeSchema(pool)` 之后加 `await ensureKbTrainingSchema(pool); setKbTrainingRepository(pool)` |
| `migrateMysqlSchema()` 内 | 同样加 ensure（保证迁移路径也建表） |
| `close()` | 加 `setKbTrainingRepository(null)` |

`GOODJOB_MYSQL_SCHEMA_VERSION`（当前 `1.4.20-knowledge-governance`，`mysql-store.ts:2124`）→ 升为 `1.4.21-kb-training`。

### 5.3 表结构

**`kb_training_runs`（训练批次）**

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | VARCHAR(64) PK | `kbr_<rand>` |
| `team_id` / `owner_id` | VARCHAR(64) | 查询一律带 team_id |
| `sources_json` | JSON | `{"files":{"assetIds":[…]}}` 或 `{"conversations":{"since":"…","limit":60}}` |
| `status` | VARCHAR(16) | `running` / `succeeded` / `partial` / `failed` |
| `engine` / `model` | VARCHAR(16) / VARCHAR(64) | **实际生效的那一档**（cli / ai / none），降级如实记录 |
| `stats_json` | JSON | `{"segments":42,"candidates":23,"duplicates":7,"skipped":12,"cliCalls":3,"invented":0}` |
| `error_message` | VARCHAR(1000) | |
| `created_at` / `finished_at` | DATETIME(3) | |

**`kb_training_candidates`（候选 / 已发布镜像）**

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | VARCHAR(64) PK | `kbc_<rand>` |
| `run_id` | VARCHAR(64) | 批次撤回的依据 |
| `team_id` / `owner_id` | VARCHAR(64) | |
| `kind` | VARCHAR(16) | `qa` / `snippet` / `policy` / `forbidden`（与插件同口径） |
| `question` / `answer` | TEXT | 整理后内容（**不写原文**） |
| `tags_json` / `languages_json` | JSON | 受控词表标签（复用 `knowledge_vocabulary`） |
| `confidence` | DECIMAL(4,3) | CLI 给的置信度 |
| `source_type` | VARCHAR(16) | `file` / `conversation` / `manual` |
| `source_ref_json` | JSON | `{"type":"file","assetId":"ka_x","anchor":"§2.1","version":"v2","title":"…"}` 或 `{"type":"conversation","conversationKey":"…","messageIds":[…]}` |
| `rationale` | VARCHAR(1000) | "为什么值得进库"（确认屏直接显示） |
| `gap_flag` | TINYINT | 知识缺口（P2：机器认为该有问题但找不到答案） |
| `fingerprint` | CHAR(32) | `sha256(kind+question+answer)[:32]`，与插件一致，用于幂等 |
| `status` | VARCHAR(16) | `pending` / `approved` / `rejected` / `published` |
| `published_entry_id` | VARCHAR(64) | 插件侧条目 id（血缘） |
| `reviewed_by` / `reviewed_at` | VARCHAR(64) / DATETIME(3) | |

索引：`(team_id, status, created_at)`、`(run_id)`、`UNIQUE(fingerprint)`。

**`kb_golden_queries`（P4，golden set）**

| 列 | 类型 | 说明 |
|---|---|---|
| `id` / `team_id` / `owner_id` | VARCHAR(64) | |
| `question` | VARCHAR(500) | 真实客户问法（20–50 条） |
| `expect_kinds` | VARCHAR(64) | 期望命中的类型（`qa,snippet`） |
| `expect_source_ref` | JSON | 期望引到的出处（可选，用于算来源命中率） |
| `enabled` / `created_at` | TINYINT / DATETIME(3) | |

### 5.4 迁移与双库同步（项目铁律，必走）

```bash
cd ~/Desktop/GoodJob_private
npm run db:migrate:dev            # 开发库
npm run db:migrate:personal       # 个人库（新功能默认两库同步）
/Users/sendohakria/WorkBuddy/2026-09-12-15-45-50/tools/goodjob-db-parity.sh   # 双库结构比对，期望退出码 0
```

**回滚**：三张表都是 `CREATE TABLE IF NOT EXISTS` 且**不改任何既有列**，回滚 = 关开关 + `DROP TABLE kb_training_runs, kb_training_candidates, kb_golden_queries`。**不需要备份**（无数据风险；如需彻底干净可先 dump 三张表到 `database-backups/`）。

---

## 6 接口清单

### 6.1 CRM 新增（`backend/src/server.ts`）

| 方法 | 路径 | 批次 | 说明 |
|---|---|---|---|
| POST | `/api/kb/training/runs` | P1 | 发起训练。body `{sources:{files?:{assetIds},conversations?:{since,limit}}, limit?}` → 立即返回 `{run}`（`running`），提炼**后台执行**（沿用 followup-sync 的姿态：先返回、后台跑、前端轮询）。2026-10-16 起实际为 `{sources:{text?:{items:[{title?,body?,assetId?,note?}]}}, kbId?, kbName?}`；`note` = 来源描述（选填 ≤200 字，随候选 `sourceRef.note` 落库并在训练端出处渲染；**不**进运行端提示词） |
| GET | `/api/kb/training/runs` | P1 | 批次列表（含 stats / 状态 / 引擎） |
| GET | `/api/kb/training/runs/:id` | P1 | 单批详情（含候选统计、失败原因） |
| GET | `/api/kb/training/candidates?status=&runId=&limit=20&cursor=` | P1 | 候选池分页，**必须带回 `sourceRef` / `rationale` / `confidence` / `gapFlag`** |
| POST | `/api/kb/training/candidates/review` | P1 | `{ids:[…≤20], action:"confirm"\|"drop", edits?:[{id,question?,answer?,tags?}]}` |
| POST | `/api/kb/training/candidates/publish` | P1 | `{ids:[…≤20]}` → 逐条调插件 `POST /api/v1/training/library`（带该批归属的 `kbId`，另带出处三件套 `sourceTitle`/`sourceAnchor`/`sourceNote` ← 候选 `sourceRef`，插件引用卡片显示「《文件》§段落 · 描述」，不进提示词），回写 `published_entry_id`；返回 `{published, existing, failed:[{id,reason}]}` |
| POST | `/api/kb/training/candidates/:id/revoke` | P1 | 撤回：插件置 `archived`（保留留痕），CRM 状态回 `approved` |
| POST | `/api/kb/training/probe` | P1 | `{body, accountId?}` → 代理插件 `POST /api/v1/training/library/match`（**闭环②同源保证**） |
| GET | `/api/kb/training/knowledge-bases` | P2 | 知识库列表（我的 ∪ 同团队公开的）+ 本人启用清单 `{items, enabledIds}` |
| PUT | `/api/kb/training/knowledge-bases/defaults` | P2 | `{kbIds:[…≤200]}` → 覆盖式保存「默认知识库」多选清单，并**推给插件**；返回 `{enabled, rejected, pluginPushed, pluginError}` |
| PATCH | `/api/kb/training/knowledge-bases/:id` | P2 | `{name?, visibility?:"owner"\|"team"}`；**只有创建者能改** |
| GET | `/api/kb/training/scorecard?runId=` | P4 | golden 回测 + 回流统计 |

**鉴权**：全部 `requireAuth`；读用 `training.read`，写用 `training.manage`（复用既有权限位，与文件中心同口径）。

**必做登记**（漏了会挂测试）：

- `backend/src/agent-api-contracts.ts`：给每个 `POST` 加一行 `define(...)` 严格契约（`agent-api-contracts-test.ts` 会检查"缺少严格 Agent 操作契约"）。
- `backend/src/agent-api-policy.ts`：把 `/api/kb` 整条前缀加入 `deniedPatterns`（与 `/api/exchange` 同类的治理控制面）。
- 新增请求入参字段也要写进契约，否则 Agent 通道调用会被 `assertAgentOperationInput` 拒收。

### 6.2 插件新增（`whatsapp-plugin/src/server/app.ts`）

| 方法 | 路径 | 批次 | 说明 |
|---|---|---|---|
| GET | `/api/v1/training/corpus/conversations?since=&limit=` | P2 | 会话语料批量出口（**脱敏后**）：按 `request.crmIdentity.userId` 取该 owner 的会话与消息，组装成「会话片段 + 联系人 + 时间 + 消息 id」，供 CRM 提炼。**不返回原始 mime / 附件二进制**，附件只给文件名与体积标记 |
| GET | `/api/v1/training/library/citations` | P0 | （可选）纯粹为扩展服务的轻薄读口；若不新增，则复用 `/match` 的 `citations` 字段 |

复用不改造的部分：`POST /api/v1/training/library`（发布）、`POST /api/v1/training/library/confirm`（批量确认，插件控制台用）、`POST /api/v1/training/library/match`（试问）。

### 6.3 发布目标（前提 4 的落地方案）

| 批次 | 目标 | 做法 |
|---|---|---|
| P1 | 操作者本人 | `signToken(actor)` → 插件库落在操作者名下 |
| P2（**2026-10-16 已实现，走的是另一条路**） | 团队其他成员 | **不做"替别人发布"，改成"库可公开 + 对方启用"**：库上加 `visibility ∈ {owner, team}`；CRM 判定可见性并返回清单，插件只执行推送来的启用清单（`PUT /api/v1/training/kb-subscriptions`）。原来的 `targetOwnerId?` 占位字段**已删除** —— 把同一条语料复制到两个 owner 名下会让两份各自漂移，而且对方停用不掉。 |

**为什么不能靠插件自己判「同团队」**：插件身份令牌只有 `userId`，没有 `teamId`（`whatsapp-plugin/src/server/crm-auth.ts` 的
`CrmIdentity = { userId, authVersion }`）。所以**可见性判定必须留在 CRM**；又因为自动回复在插件内部跑
（`auto-chat-service` → `training-library-service.resolve`），那条链路上没有 CRM 请求上下文、临场问不了，
所以清单只能**由 CRM 主动推**。一处判定，不会两边各有一套规则慢慢漂移。

**启用清单的三个状态必须可区分**（`training_kb_subscriptions`）：

| 状态 | 含义 | 出稿范围 |
|---|---|---|
| 零行 | 从未配置 | **兼容口径**：自己的语料全用（保住历史 53 条 `kb_id=''` 的条目） |
| 一行哨兵 `kb_id=''` | 已配置但一个都不启用 | 只有自己的**未分组**语料 |
| 若干真实 kb_id | 严格按清单 | `(自己的未分组条目) ∪ (清单内各库的条目)` |

`kb_id=''`（未分组）的条目**始终参与**：它代表"不属于任何知识库"，这也是兼容与"关不掉"之间的取舍，
同时留了补归属的通道（`assignTrainingLibraryEntryKb`，只补空值）。

## 7 CRM 训练工作台（前端）

### 7.1 视图骨架（照 `knowledge` 视图的模式，`frontend/index.html` + `frontend/src/prototype-api.ts`）

| 项 | 值 |
|---|---|
| 视图容器 | `<div class="view" id="kb-training">`（`index.html`，紧邻 `#knowledge`（`:29836`）之后） |
| 导航按钮 | `data-view="kb-training"`，二级导航，紧邻「资料维护」按钮（`index.html:25636`） |
| 视图标签/权限登记 | `prototype-api.ts` 的视图标签表与权限表（`kb-training` → `training.read`） |
| 进入加载 | `activateNavView` 的 view 钩子 → `void loadKbTraining()` |
| 事件绑定 | 启动时 `bindKbTrainingEvents()` 一次（动态列表在每次 render 后重绑） |
| 渲染函数 | `renderKbTraining()` / `renderKbRunList()` / `renderKbCandidateList()` / `renderKbProbePanel()` / `renderKbScorecard()` |

### 7.2 三屏（对应四个闭环）

**屏 1 · 源与批次**（闭环①入口）

- `#kbSourceFiles`（文件中心多选，读 `GET /api/knowledge/assets`）、`#kbSourceConversations`（P2，时间窗 + 条数）
- `#kbStartRunButton`（`setButtonPending(button, true, "开始训练", "提炼中…")`）
- `#kbRunList`（批次卡片：状态徽章 + 引擎徽章（CLI/模型/未生效）+ `已提炼 N / 重复 N / 丢弃 N` + 失败原因）

**屏 2 · 候选确认**（闭环①出口，简易性落在这里）

- `#kbCandidateList`：一屏 20 条，每条 = 问法 / 答案 / 类型徽章 / 置信度 / **出处（可点）** / **理由** / 勾选框
- 键盘：`J/K` 上下、`空格` 勾选、`Enter` 确认、`D` 丢弃（**这是"2 分钟/屏"的关键**）
- `#kbCandidateFilter`（按类型 / 置信度 / 来源 / 知识缺口）
- `#kbPublishButton`（`已选 N 条 → 发布到插件`）；`#kbReviewSelectedButton`
- 预勾选规则（降低人工负担）：`confidence ≥ 0.9 且 source_type=file 且未命中商务红线` 自动勾选

**屏 3 · 试问与成绩单**（闭环②④）

- `#kbProbeInput` + `#kbProbeButton` → 命中条目 + citations（可展开）+ 拟用回复 + 护栏判决
- `#kbScorecard`（P4：四项指标 + 与上一批对比条）

### 7.3 必须遵守的既有界面规范（项目铁律，改界面必守）

- 右上统计块三档字级（标签 11px/500 `#6b7d94`、数值 20px/700 `#131c2e`、说明 11px/400 `#94a3b6`）；**0 值不上色**。
- 输入框字号三档、占位符 `#94a3b6` 且 `:focus::placeholder{color:transparent}`、**禁把提示语写进 `value`**、圆角统一 6px。
- **新样式追加到 `index.html` 尾部的 `<style id="input-refine">` / `<style id="head-text-refine">`，不要另写一套**；视图自身样式写在 `#kb-training` 作用域内。
- 弹窗若新增专属类，**必须同时补进 `openModal()` 的 `classList.remove(...)` 清理列表**（`prototype-api.ts` ≈`:8927`）。
- 写操作 handler **必须 try/catch + `toast(msg,"error")`**（`api()` 只 throw 不弹提示，静默失败是历史高发缺陷）。
- 动效只用既有令牌 `--ease-out` / `--ease-expo`，`animation-fill-mode: backwards`（不要 `both/forwards`，会让 hover 失效），并写 `prefers-reduced-motion` 降级。

### 7.4 P1 实施偏差（2026-10-16 实测补记，P2/P3 请按这里的前提走）

§7.2 是按「文件中心有正文」写的，实测不成立，实施时改了四处。评分与修复过程见
`frontend/design-preview/kb-training-p1-scorecard.html`。

| # | 方案原写 | 实测前提 | 实施做法 |
|---|---|---|---|
| 1 | 屏 1 选 `#kbSourceFiles`（文件中心多选）作为语料源 | `knowledge_assets` **没有正文列**（只有 title/description/tags/source_url；实测 4 条数据 description 长度 7/0/0/0） | 语料主体 = 粘贴正文 + 本地 txt/md（可多选，后端 `text.items` ≤50 条）；文件中心资料只作**出处**（`text.items[].assetId`），标题/版本由后端回查 |
| 2 | 关联资料可同时进 `files.assetIds` | 该路径会被 `collectSourceItems` 当成**内容源**：资料说明（实测 7 字）会被当作一份语料喂进提炼 | 前端**只**发 `text.items[].assetId`（资产元数据照样解析、出处照样回指），自检里加了禁止 `files.assetIds` 回归的断言 |
| 3 | 屏 2 的候选只能「确认 / 丢弃」 | 后端 `reviewCandidates` 早已支持 `edits`（并会重算指纹） | 补行内编辑：问法 / 答案可改，「保存并确认」= 编辑 + 确认一个动作；编辑期间暂停轮询（重绘会吞光标） |
| 4 | 屏 3 = 命中条目 + citations + 拟用回复 + 护栏判决 | 插件 `resolve()` 返回 `{hits, snippets, policies, forbidden, forbiddenPhrases, citations, verdict, warnings}`，**没有 `blocked`，也没有拟用回复**；且 `hits`（`TrainingLibraryMatch`）与 `citations`（`TrainingCitation`）是**两种不同结构**，相加会把同一问答列两遍 | 正文出处以 `citations` 为唯一来源（四类合一、已去重）按类型分组；`hits` 只补相似度与词典等价命中；`verdict` 作护栏判决、`forbidden` 单独红色块答「哪句被拦」；**拟用回复延后到 P3**（判据不要求，且插件没有「只出稿不落档」的读口） |

**另一处后端契约修补**：`countCandidatesByRun` 原本只返回 `{total, pending, published}`，
而界面摘要按四态渲染 →「已确认 / 已丢弃」恒为 0。现补齐四态，并加跨文件自检（少一态即红）。

**计数与截断**：`GET /api/kb/training/runs/:id` 最多带 100 条候选；前端用 `counts.total` 与已装条数
比对，超出即在界面明示（静默截断已两次成为历史缺陷，这里明确堵住）。

### 7.5 P2 实施记录：训练成果分享 + 「默认知识库」多选启用（2026-10-16）

用户原话：「训练完后的，可以分享给其它账号，也可以自用，也就是点公开和私用，然后可以选择默认知识库
（可多选，可以钩选自己的和他分享出来的）启用」。落地时有三处必须按实测改设计：

| # | 方案原写 | 实测前提 | 实施做法 |
|---|---|---|---|
| 1 | 「知识库」可以就挂在批次上 | 批次是**执行日志**（会失败、会堆），资产要有名字与归属，两种东西的生命周期不同 | 拆表：`kb_training_runs.kb_id` 指向新表 `kb_knowledge_bases`（`visibility ∈ {owner,team}`），启用清单在 `kb_user_knowledge_bases`；否则"知识库列表"会混进一堆 failed 批次 |
| 2 | 发布给谁 = `targetOwnerId?` | 插件令牌只有 `userId`，判不了 team；且复制一份到别人名下会各自漂移、对方还停用不掉 | 删掉该字段；改走「公开 + 对方启用」，可见性判在 CRM，清单**推**给插件（§6.3） |
| 3 | 启用清单用 `enabled` 布尔列 | 布尔有两种"不启用"写法，界面与插件各理解一种必然对不上 | `kb_user_knowledge_bases` **行存在即启用**；零启用写一行哨兵 `kb_id=''`（区分"从未配置"与"一个都不要"）；插件侧 `training_kb_subscriptions` 同构 |

**真机验收抓出来的一个真 bug（已修 + 已补会红的测试）**：插件取语料的 `inScope` 只判了
`subscribed.length`，于是「已配置 + 零启用」并进了「从未配置」那一档，表现是
**"我已经把这个知识库关掉了，它里面的语料照样进出稿提示词"**。
用另一个账号（B）断言命中数是抓不到的（B 本来就没有自有语料，两种写法都是 0 命中），
必须用**语料所有者**当读者。回归落在 `whatsapp-plugin/tests/training-library.test.ts` 的
「零启用只留未分组的自有语料」。

**另一个不做就说不通的点**：新建库会**自动把库勾进创建者清单**，而清单的唯一权威在 CRM、执行在插件 ——
所以 `POST /api/kb/training/runs` 建库后必须**立刻推一次清单**，否则会出现「面板上勾着、
运行端按旧清单出稿」，且没有任何东西会触发下一次同步。推送失败时返回
`knowledgeBaseSync:{ok:false,error}`，前端用**常驻提示**说明"库建好了但运行端还没同步"。

**屏 1 补了「这批成果归入哪个知识库」下拉**（默认"新建"）：不提供就等于每训一次多一个库，
同一份资料反复提炼（第一次失败、补内容再提）会把「选择默认知识库」那张清单彻底搞乱。
只列**自己的**库 —— 往别人的库发语料后端会 403，列出来只会让用户点了报错。

---

## 8 插件与扩展改造

### 8.1 P0（可观测性）

| 位置 | 改动 |
|---|---|
| `training-library-service.ts` `resolve()`（`:370-407`） | 返回结构加 `citations: TrainingCitation[]`（结构见设计方案 §6）；每类命中都生成一条 citation（含 `refId` / `title` / `snippet` ≤200 字 / `anchor` / `score` / `hitTerms`） |
| 同上 `recordHits()`（`:478`） | 覆盖四类（qa/snippet/policy/forbidden）+ 加 `adopted` 维度；调用点 `auto-chat-service.ts:543`、`:731` 从"只传 qa hits"改为传全部命中 id |
| 同上 `forbiddenHits()`（`:472`） | 接线或删除——**不留死代码**（两个选择都行，写清楚理由） |
| `whatsapp-plugin/src/shared/types.ts` | 新增 `TrainingCitation` 类型 |
| `whatsapp-web-translator/src/resources.js` | 字段白名单 `RESOURCE_FIELDS`（`:223-238`）加 citations；`SOURCE_LABELS`（`:123-130`）与 `describeEvidence`（`crm.js:520`）升级 |
| `whatsapp-web-translator/src/agent.js` | `resourceCard()`（`:1258`）渲染可展开来源块；`renderReplyBlock`（`:1299`）草稿下挂引用条 |

⚠️ 扩展铁律：`settings.js` / `content.js` 与 `agent.js` 存在**叶子函数逐字 parity 锁**，改一份必须同步另一份；改默认值必须走 schema 迁移。改完必须**重载扩展 + 刷新 web.whatsapp.com** 才可见（这是反复踩过的测试盲点）。

### 8.2 P1（训练端 CLI 提炼）

- CRM 侧 **只复用** `runCliSummary`（`cli-ai.ts:189`），不新写 CLI 调用器。
- 批处理：**每 20 段语料 1 次调用**（100 段 ≈ 5 次）；**禁止每条一调**。
- 回调姿态保持：CLI 优先 → 失败退 CRM 配置模型（`ai_model_configs`）→ 都没有则 `engine:"none"` 并如实上报（**不假装成功**）。
- 输出校验（代码侧，不信任模型，纯函数放 `kb-training-prompt.ts` 便于单测）：JSON 解析失败 / 缺字段 / `source_seg` 越界 → 丢弃并计数；`confidence < 0.5` → 强制 `pending`；未知 `kind` → 丢弃。

### 8.3 P3（检索硬化，全部在插件侧，每项独立开关）

| 改动 | 位置 | 开关 |
|---|---|---|
| snippet 去掉"按 priority 取前 6"兜底（全不相关就返回空） | `training-library-service.ts:428`（`selectSnippets` `:417-435`） | `KB_SNIPPET_STRICT` |
| policy 按相关度截断并记 warning 明细（当前超上限只 warning 不截断） | `training-library-service.ts:380-385` | `KB_POLICY_TRUNCATE` |
| 分层加权（已校订 ×1.0 / 未校订 ×0.4 且仅精确命中）+ 同族合并 + 生命周期过滤 | `rankQa`（`:445`）与 `resolve` 的排序段 | `KB_TIERED_RANKING` |
| CLI 精排 `resolveWithCli()`：**只能从候选挑 + 回引 id**，不在候选集的 pick 丢弃并计 `invented` | 新增，参考 `resource-recommend-service.ts:461-507` 的既有 `invented` 规则 | `KB_CLI_RERANK` |
| 同问法 5 分钟缓存（内存，key = 归一化来文 hash） | 新增 | — |
| 出稿回引校验：引用的 id 必须 ⊆ 给定 citations，否则草稿标 `blocked: 依据不足，建议人工` | `auto-chat-service.ts` `buildReplyRequest` + 生成后校验 | `KB_CITE_ENFORCE` |

---

## 9 降级矩阵（失败路径闭环）

**第一轮辩论的核心结论**：只画 happy path 的方案不是闭环。以下每种故障都必须在实现前定好"用户看到什么"。

| # | 故障 | 表现 | 降级动作 | 用户看到 |
|---|---|---|---|---|
| 1 | CLI 未 `/login` | `runCliSummary` 退出码 0 但无有效 result 事件 | 按现有契约**读 result 事件**判定失败（不能只看退出码）→ 退 CRM 配置模型 | 批次上标 `engine=ai`（如实降级），不报"成功" |
| 2 | CLI 超时（>120s） | 进程挂起 | `timeoutMs` 到点 kill，本批标 `partial` | 「N 段未处理，可重试」按钮 |
| 3 | CRM 配置模型 key 失效（如 401 INVALID_API_KEY） | 提炼全失败 | `engine:"none"` + `error_message` | 批次红色 + 明确的"引擎不可用，请检查配置" |
| 4 | 插件 3100 未启动 | 发布请求 ECONNREFUSED | **不置 published**，保留 `approved`；返回 `failed:[{id, reason:"插件未启动"}]` | 「N 条待发布（插件未启动）」+ 重试按钮 |
| 5 | 发布部分失败（10 条成 3 条） | 半途失败 | 逐条独立事务，成功即回写血缘；失败的保持 `approved` | 「已发布 3 / 待重试 7」，**重试不会重复**（靠前提 2 的幂等） |
| 6 | 迁移失败 | 后端拒启动 | 三表为纯新增，无护栏影响；按项目惯例先跑迁移修（见 skill「冷启动完整性门禁」） | 服务启动日志明确原因 |
| 7 | 候选池为空 | 训练完成 0 条 | 批次标 `succeeded` 但 `stats.candidates=0` | 「本批未发现新条目」+ 建议换源/放宽时间窗（**不是报错**） |
| 8 | 指纹冲突（重复训练同一份资料） | 全部撞既有 | 返回 `existing` 计数，不重复入库 | 「N 条已存在，跳过」 |
| 9 | 引用校验失败 | 草稿引用了不存在的 id | **弃答**：不出正文，只给"依据不足，建议人工" + 来文关键词 | 草稿位显示弃答卡片，可一键转人工 |
| 10 | 会话语料接口超时（P2） | CRM 拉不到语料 | 该源跳过，其余源照常提炼 | 批次标 `partial`，注明"会话源未取到" |

**统一原则**：**任何降级都必须写进 `engine` / `stats` / `error_message` 三处之一并在界面可见**。不允许"静默降级"——这是项目历史上最贵的一类 bug（"桩全绿≠能用"）。

---

## 10 验收方案（可证伪）

**第二轮辩论的核心结论**：验收条件写成"功能正常"是不可验的。每条判据都必须能被**故意弄坏**。

### 10.1 每批的验收命令与期望

**P0**

```bash
# ① 试问返回 citations
curl -s --noproxy '*' -X POST http://127.0.0.1:3100/api/v1/training/library/match \
  -H "Authorization: Bearer <自签 token>" -H 'Content-Type: application/json' \
  -d '{"body":"请问贵司的付款方式是什么"}' | jq '{hits:(.hits|length), citations:(.citations|length)}'
# 期望 citations 长度 > 0，且每条含 refId/title/snippet/hitTerms
```
```sql
-- ② 四类命中都真实 +1（不是只有 qa）
SELECT kind, SUM(hit_count) FROM training_library_entries GROUP BY kind;
```
```bash
# ③ 插件回归（既有 285 项不能挂）
cd whatsapp-plugin && npm test
```

**P1**

```bash
# ① 端到端：发起训练 → 轮询到 succeeded
curl -s --noproxy '*' -X POST http://127.0.0.1:4190/api/kb/training/runs \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"sources":{"files":{"assetIds":["ka_xxx"]}}}'
# 期望 201 + {run:{status:"running", engine:"cli"|"ai"}}
```
```bash
# ② 候选池带出处
curl -s --noproxy '*' "http://127.0.0.1:4190/api/kb/training/candidates?status=pending&limit=20" \
  -H "Authorization: Bearer $TOKEN" | jq '.items[0] | {question, confidence, sourceRef, rationale}'
# 期望 sourceRef.assetId 非空（无出处不入池）
```
```bash
# ③ 发布后插件 active + 血缘回写
curl -s --noproxy '*' -X POST http://127.0.0.1:4190/api/kb/training/candidates/publish \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"ids":["kbc_xxx"]}'
# 期望 {published:1, existing:0, failed:[]}；随后插件库该条 status=active、CRM 该条 published_entry_id 非空
```

### 10.2 三条「必须会红」的自检（先弄坏，确认能抓住）

这是项目铁律（**写自检必须实测会红**），也是本方案对"桩全绿≠能用"的正面回应：

| # | 故意弄坏 | 期望自检报错 |
|---|---|---|
| 1 | 把 `kb_training_candidates.source_ref_json` 手工改成 `NULL` 再点发布 | 发布被拒（无出处不可发布），**不是**静默发布成功 |
| 2 | 把插件 `selectSnippets` 的兜底改回"priority 前 6"，喂一条全无关来文 | `KB_SNIPPET_STRICT` 自检报"无关条目入提示词" |
| 3 | 让 CLI 返回一个 `source_seg` 越界的候选 | 输出校验丢弃该条并 `stats.skipped+1`，**不是**落库 |

### 10.3 必须保持绿的既有回归

| 套件 | 命令 | 说明 |
|---|---|---|
| CRM 全量 | `cd backend && npm test` | 含 `agent-api-contracts-test`（新增契约后必跑） |
| 插件 | `cd whatsapp-plugin && npm test` | 285 passed / 9 skipped 为基线 |
| 扩展单测 | 10 份（parity 298 / twotier 35） | **改了叶子函数必跑 parity** |
| 扩展 e2e | 3 份 + live-check | **不并发** |
| 双库结构 | `goodjob-db-parity.sh` | 迁移后必跑，期望退出码 0 |
| 前端 | `cd frontend && npm test` + `npm run test:e2e` | e2e 自起 memory 后端，不碰真实库 |

---

## 11 风险与回滚

| 风险 | 等级 | 缓解 | 回滚 |
|---|---|---|---|
| 迁移把生产库搞坏 | 低（只加表不改列） | 先在 dev 跑通再 personal；`MIGRATION_PROTECTED_TABLES` 行数护栏兜底 | `DROP TABLE` 三张表 + 还原 schema_version |
| 发布污染插件库 | 中 | 前提 2 幂等 + 撤回接口（置 `archived` 保留留痕）+ `KB_TRAINING_ENABLED=false` | 插件侧把误发条目 `archived`（不删） |
| 检索硬化改变现有回复质量 | **高** | 每项独立开关（§8.3），逐个开、开完对比成绩单 | 关对应开关即回退（无需发版） |
| 会话语料脱敏不彻底 | 高 | 出口侧只给"会话片段 + 文件名标记"，不给附件二进制；CRM 侧**即取即提炼不落原文** | 关 `conversations` 源 |
| CLI 提炼出臆造内容 | 中 | 输出校验（越界丢弃）+ 无出处不入池 + 高置信自动放行仅限 `file` 源 | 候选池人工全审（把自动勾选关掉） |
| 扩展改动影响既有翻译 | 中 | parity 锁保证两侧一致；改完必跑 10 份单测 | 重载扩展即可回退（扩展从源码目录加载） |
| 测试往真实客户写数据 | **高危（历史踩过）** | **一律用 dev 档位 + 独立测试客户；严禁直连写真实客户** | 按 id+type+marker 三重条件清理 |

**总开关**：`KB_TRAINING_ENABLED`（CRM 侧路由级，默认 `true`；开发档先 `false` 验证再开）。关闭后：路由返回 503 + 界面提示，**既有功能完全不受影响**。

---

## 12 三轮自我辩论（针对本开发方案）

### 辩论一：批次划分是否真的闭环？

**反方**：

1. P0 只有三个改动，够不上"一批"，不如并进 P1。
2. P1 只接文件源，用户真正想要的是会话——"窄而通"是不是自我安慰？
3. P3 改检索行为、P4 出成绩单，**凭什么 P3 在 P4 前**？没有成绩单，怎么知道硬化是改好了还是改坏了？

**正方**：

1. P0 的独立性理由是**风险类型不同**：P0 全是插件侧读取行为（不改检索决策，不加表，不加路由），半天可完成、当天可验、可单独回退；P1 是新增模块 + 迁移 + 新路由。合并会让"当天可验的最小价值"消失。
2. P1 只接文件源恰恰是优势：文件源有明确出处、可自动放行、无隐私顾虑，**闭环可以窄但必须真通**。会话源在 P2 补，此时 P1 已经建立起"采集→提炼→确认→发布→试问"的全部管道，P2 只是加一个采集器——**如果 P1 就上双源，一旦会话切分有问题，整条管道都验不了**。
3. **P3 在 P4 前是硬约束**：golden 回测测的是检索质量，而检索硬化本身会改变质量。若 P4 先做，它的基线是一个即将被推翻的检索器，成绩单立刻作废。**先定行为，再量行为。**

**裁决**：维持 P0→P1→P2→P3→P4，但把 P3 的开关做成"可逐项对比"——每开一项就重跑 golden，这样 P4 的成绩单在 P3 期间就已在发挥作用（**度量能力提前，度量界面后置**）。这一条是辩论产生的实质修订。

### 辩论二：失败路径是否闭环？

**反方**：本方案第一版只画了 happy path。CLI 挂了怎么办？插件 3100 没起怎么办？发布到一半失败怎么办？迁移失败怎么办？这些都是**必然而非偶然**——本项目历史上 CLI 未登录、模型 key 401、插件离线全都真实发生过。

**正方**（修订后）：补 §9 降级矩阵 10 条，并确立三条原则：

1. **降级必须可见**（写进 `engine`/`stats`/`error_message`，界面展示），禁止静默降级；
2. **每批都可关开关回到上一批状态**（不需要回滚代码）；
3. **部分失败不污染整体**：发布逐条独立事务、采集逐源独立跳过（沿用既有的"单会话失败不拖垮整轮"惯例）。

**裁决**：采纳 §9 全表。其中第 1 条（CLI 未登录要看 result 事件而非退出码）是本项目已踩过的坑（skill 明文记载"CLI 未 /login 必失败但退出码 0"），**写进实现注意事项而非仅测试**。

### 辩论三：验收是否可证伪？

**反方**：十条验收里若有一条写成"功能正常"，整份方案的严肃性就没了。而且本项目有过更贵的教训——**桩全绿 ≠ 能用**（插件侧 `request(app)` 随机 401、CLI 诊断脚本被 SIGKILL、扩展"修了没生效"其实是没刷新页面）。

**正方**（修订后）：

1. 每条闭环判据改成"可执行命令 + 期望输出"（§10.1），不给"正常/良好"这类词。
2. 补**三条"必须会红"的自检**（§10.2）——**先故意弄坏，确认自检能抓住**，再修回来。这是对"桩全绿≠能用"的正面回应。
3. 明确既有回归清单（§10.3）与"必须保持绿"的基线数字，避免"改好了这个坏了那个"。
4. 验收必须包含**真实链路**而非桩：P1 的闭环判据要求"发布后能在插件库查到"，而不是"接口返回 200"。

**裁决**：采纳全部。**额外增加一条**：P2 的会话源验收必须包含"脱敏检查"——用 grep 在 CRM 库中检索会话特征的原始文本，**命中数必须为 0**（与原"正文零泄漏"的检查同法）。

---

## 13 与既有铁律的一致性检查

| 铁律 | 本方案的做法 |
|---|---|
| 开发一律走 development 档位（4190） | 全部开发与验证在 dev 档；测试写数据只用 dev 测试客户 |
| 结构改动必须回灌个人库 | §5.4：`db:migrate:dev` → `db:migrate:personal` → `goodjob-db-parity.sh` |
| 新写接口必须有 Agent 契约 | §6.1：`agent-api-contracts.ts` 登记 + 入参登记 + `/api/kb` 进 `deniedPatterns` |
| 不把会话原文写进 CRM 库 | 前提 5 + §6.2：即取即提炼，只存整理结果与引用指针 |
| 全量持久化体系不背新模块 | §5.1：独立 Repository 文件，不进 `persistAll` |
| 界面字体/输入框/右上文字三档规范 | §7.3：追加到尾部 style 块，不另写一套 |
| 写操作必须有反馈（禁静默失败） | §7.3：handler 必 try/catch + toast；§9：降级可见 |
| 改完不抢跑提交，等用户给备注 | 全程不 `svn commit`，改动留在工作副本 |
| 在 personal 档重启必须 build + kickstart | §11 回滚与验证一律按此执行 |

---

## 14 待你定夺（默认值已给，**不阻塞开工**）

| # | 问题 | 默认取值 | 影响面 |
|---|---|---|---|
| 1 | 价格 / 交期口径是否进库 | **进库但标「仅人工参考」**，不进入可引用集（检索层单独过滤） | 若你选"完全不进库"，P1 的入库闸要加一条正则硬拒 |
| 2 | 训练频率 | **手动 + 每周提醒**（新增会话 ≥20 段才提示） | 只影响提醒入口，不影响主链路 |
| 3 | 发布默认动作 | **高置信（≥0.9）+ 文件出处 + 无商务承诺 → 自动勾选（仍可撤回）**，其余人工确认 | 若你选"全人工"，P1 的预勾选规则改成默认不勾 |
| 4 | （本方案新增）发布给谁 | **P1 只发操作者本人**；团队共享列为 P2 可选项 | 决定 §6.3 是否要建"插件接入账号"列表 |

四项都可在开工后按你的答复调整；**默认值下五批全部可执行**。

---

## 附：批次与原设计规格的对应关系

| 设计规格（§9 四批） | 本开发方案 | 差异说明 |
|---|---|---|
| 批 1 可观测性打底 | **P0** | 一致 |
| 批 2 训练工作台 | **P1 + P2** | 拆成两批：先文件源闭环，再补会话源（辩论一的产物） |
| 批 3 检索硬化 | **P3** | 一致，但增加"逐项开关 + 逐项回测"（辩论一的产物） |
| 批 4 成绩单与回流 | **P4** | 度量能力提前到 P3 期间使用，界面后置（辩论一的产物） |
