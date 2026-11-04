# WhatsApp 对话 → CRM 客户跟进 自动同步 设计方案

> 状态：**P0 + P1 已实施**（CRM 侧编辑/撤销接口；插件侧同步引擎 + 记录表 + 定时 + 配置 + 界面接口）· P2–P4 待实施
> 日期：2026-10-14
> 触发需求：「定时拉取今天和客户的对话，推到 CRM，更新客户跟进的历史和内容。我要**无风险的**。」

---

## 0. 决策记录（2026-10-14 用户拍板）

| # | 决策 | 说明 |
|---|---|---|
| 1 | **做自动**，但**支持后期编辑** | 不做「草稿 + 人工确认」，直接写入；用「可编辑 + 可撤销」替代「写入前确认」 |
| 2 | **每天 19:00**，**在插件里配置开关与时间** | 定时放在插件常驻进程，不依赖浏览器是否打开 |
| 3 | 未匹配客户 → **归入线索**，设置来源，**站内信提示**（详细） | 顺带把「CRM 里没录 WhatsApp 号」这个数据质量问题显性化 |
| 4 | **同步要有记录文档**，显示匹配多少客户、多少线索 | 每次同步的运行记录 + 逐条明细 |

---

## 1. ⚠️ 必须先知道的技术约束（它决定了功能能做到什么程度）

### 1.1 扩展只能读到「**当前打开的那个会话**」

WhatsApp 网页版**只把当前会话的消息渲染进 DOM**：

```js
// whatsapp-web-translator/src/content.js:240
const panel = document.querySelector('#main [data-testid="conversation-panel-messages"]');
```

`#main` 就是当前会话面板。要拿「今天所有会话的对话」，扩展**必须逐个点击打开每个会话** —— 而那个方案同时带来两个问题：

- **打断用户**：页面会自己乱跳，业务员没法正常用
- **封号风险**：批量遍历会话是典型的自动化特征

这与「无风险」直接冲突。

### 1.2 因此采集方式定为「**被动累积**」

扩展已经在用 `MutationObserver` 观察整个页面（`content.js:1318-1319`），翻译功能就靠它捕获新消息。复用同一条通道：

- 用户**正常浏览会话时**，顺手把看到的每条消息累积到 `chrome.storage.local`（按自然日分桶）
- **不主动点击、不遍历、不改变页面状态** → 零封号风险、零干扰
- 到点只上传**已累积到的**那部分

**代价（必须说清楚）**：只能覆盖「业务员当天在网页版打开过的会话」。
- 用**手机**聊的、当天没打开网页版的会话，**拿不到**（除非用 Baileys 直连 —— 封号风险，已排除）
- 但业务含义上这个边界是**合理的**：当天没打开过 = 当天没在电脑上聊过

### 1.3 MV3 的 service worker 会休眠

`chrome.alarms` 在浏览器关闭后完全不跑。**所以定时不进扩展** —— 扩展只负责「采集 + 上传」，定时由插件（常驻 Node）负责。

---

## 2. 已完成（P0）：CRM 侧编辑 / 撤销跟进记录

**这一条是你决策 1 成立的前提，也是整个自动写入的安全网。**

### 2.1 为什么必须先建它

`customerActivities` **同时是业绩考核的数据源**：

```ts
// backend/src/server.ts:27237 → :27242 → :27248
const followUps = store.customerActivities.filter((activity) =>
  ownerCustomerIds.has(activity.customerId) &&
  activity.createdAt.slice(0, 10) >= periodStart && activity.createdAt.slice(0, 10) <= asOfDate);
followUpCount: followUps.length,
.sort((l, r) => r.activeDealCount - l.activeDealCount || r.followUpCount - l.followUpCount);
```

自动写入一旦写错（错客户 / 纯噪音），**必须能改、能撤**。否则自动写入就是不可逆的。

### 2.2 新增两个接口

| 接口 | 作用 |
|---|---|
| `PATCH /api/customers/{id}/activities/{activityId}` | 改 `content` / `type` / `nextReminder`，至少改一个字段 |
| `DELETE /api/customers/{id}/activities/{activityId}` | 整条撤销 |

**留痕规则（关键）**：
- `createdAt` 与 `operatorId` 是「谁在什么时候创建」的事实，**不可改写**
- 编辑只写 `updatedAt` / `editedBy`

这样任何时候都能分清「机器写的」和「人改过的」。

### 2.3 两项安全校验

- **客户归属**：`item.id === activityId && item.customerId === customer.id` —— 否则只要知道 activityId 就能跨客户改记录
- **权限**：走 `findWritableCustomer`（`server.ts:5644`），越权一律 404

### 2.4 结构改动（双库已同步）

| 位置 | 改动 |
|---|---|
| `types.ts:752` `CustomerActivity` | 加 `updatedAt?` / `editedBy?` |
| `mysql-store.ts:2562` | `ensureColumn` 补 `updated_at DATETIME(3)` / `edited_by VARCHAR(64)` |
| `mysql-store.ts:6583` | 读取映射（NULL → `undefined`，不退化成空串） |
| `mysql-store.ts:12179` | `replaceRows` 列清单同步 |
| `prospect-coverage-memory-mysql.ts:1725` | 转换路径的映射同步 |

> ⚠️ **踩到的坑**：`mysqlDate(undefined)` 返回的是 `new Date()`（`mysql-store.ts:15197`），不是 NULL。
> 直接写 `mysqlDate(item.updatedAt)` 会让**所有从未编辑过的记录都变成「刚编辑过」**——不报错、不崩溃，只是数据全错。
> 必须显式判空：`item.updatedAt ? mysqlDate(item.updatedAt) : null`。

双库迁移结果：dev / personal 各 `addedColumns: 2`；两库 `customer_activities` 列结构**逐字一致**（已用一次性脚本对比后删除）。

### 2.5 验证

- `customer-activity-edit-test.ts` **31/31**（新增，已挂进 `npm test` 链）
- **破坏验证**：去掉客户归属校验 → 越权改成功，2 条断言红；去掉 `updatedAt` 写入 → 2 条断言红。**共 4 条精确变红**
- Agent 契约：`executable 439`（+2）/ `coveragePercent 100`

---

## 3. 待实施：完整链路

```
┌─ Chrome 扩展（被动采集，零风险）──────────────────┐
│  MutationObserver 已有 → 累积当天消息到 storage    │
│  （不点击、不遍历、不改页面状态）                    │
│  定时/阈值上传 → POST /api/v1/conversations/ingest │
└────────────────────────────────────────────────────┘
                     ↓ 只送结构化消息，不送原文
┌─ 插件（常驻 Node 3100）───────────────────────────┐
│  ① 收下并落库（插件自己的表）                       │
│  ② AutomationRhythmService 每天 19:00（可配置）     │
│     扫当天会话 → CLI 摘要 → 分派：                  │
│       ├─ 匹配到客户 → POST /api/customers/:id/activities │
│       ├─ 未匹配   → POST /api/leads/ingest（新线索）│
│       └─ 汇总     → POST /api/internal-messages/system │
│  ③ 写 followup_sync_runs / items（同步记录）        │
└────────────────────────────────────────────────────┘
```

### 3.1 定时（决策 2）

复用现有骨架，**不新造调度**：`automation-rhythm.ts:102` 的 `tick()` 里已有 `dueAnalysis` / `dueDaily` 两个分支，**加第三个 `dueFollowupSync`**。

新增设置项（`AutomationSettings`，`shared/types.ts:167`）：
- `followupSyncEnabled: boolean`（默认 **false**，要显式打开）
- `followupSyncHour` / `followupSyncMinute`（默认 19 / 0）
- `lastFollowupSyncAt` / `nextFollowupSyncAt`

时区复用现有的 `nextDaily(hour, minute, timezone)`（`automation-rhythm.ts:13`）。

### 3.2 整理（不进原文）—— 引擎链：CLI 托管 → 配置的 AI 模型 → 占位

> **2026-10-14 用户拍板改版**：原方案是「CLI 不可用 → 退到规则摘要（抄客户最后 3 条原话）」。
> 这条兜底被取消 —— 它等于把客户原话搬进 CRM，报价、折扣、交期会被当成既定承诺，而且
> `customerActivities` 同时是业绩考核 `followUpCount` 的数据源，写进去撤不干净。
> 引擎解析的唯一入口是 `whatsapp-plugin/src/server/services/curation-engine.ts`。

| 档 | 条件 | 写进 CRM 的正文 |
|---|---|---|
| `cli` | 本机 WorkBuddy CLI 探测通过（`cli.status()`，成功缓存 5 分钟） | CLI 整理出的一句话 |
| `ai` | 没有 CLI，但有启用中的 AI Provider | 同一个提示词、同一个模型输出结构 |
| `none` | 两者都没有 | `当天有跟进（未配置AI，未整理具体内容）` |

- 提示词硬约束（CLI 与 AI **共用同一份** system 段，`buildSummaryPromptParts()`）：只出摘要不出原文；
  **不复述价格/折扣/交期数字**，涉及商务敏感时写「客户提到商务条件，需人工确认」；
  纯寒暄 → `worthRecording=false`，**不生成记录**。模型给的数字仍会被 `sanitizeSummary()` 拦成固定话术。
- 「配置的 AI 模型」按 **自动化里的深度分析 Provider → 自动回复里选的 Provider → 任一启用 Provider**
  的优先级挑（`pickCurationProviderId()`）；已停用/已删除的 id 一律不认。
- CLI 优先于 AI：本机登录即可用，零 API Key、零额外成本。CLI 调用失败时**还会再试一次 AI**。
- **没有通道时只记事实**：占位句不带任何对话内容；纯寒暄那天仍然什么都不写（保住「跟进历史不被 👍 刷屏」）。
- 占位数会出现在三处，**不许只在明细里藏一份**：运行记录的 `summary`、站内信（带一行「为什么没整理」+ 是谁）、
  每条明细的 `summary` 与 `error`。
- 汇总口径要分清两件事：**一台都没配**（`none`，不算失败）与**配了却全挂了**
  （`plan.engine !== "none"` 但每次调用都失败 → 进 `failures`，整轮 `status=partial`）。

### 3.3 客户匹配（宁可漏，不可错）

```
normalizePhone(contactPhone)  vs  normalizePhone(customer.whatsappPhone || customer.whatsapp)
命中 0 个   → 走 3.4 线索归集
命中 1 个   → 写客户跟进
命中 >1 个  → **什么都不写**，只在同步记录与站内信里点明「CRM 里存在重复客户」
```

**绝不允许「取第一个」**。多命中本身是数据质量问题，要暴露而不是掩盖。

> **P1 实施时对原方案的修正**：初稿写的是「多命中 → 也走线索归集」，实现时改成
> **不建线索**。原因：这种情况客户**已经存在**（还是两个），再建一条线索等于给同一个人
> 又造出第三个实体，把线索列表也弄脏 —— 而真正该做的动作是「去 CRM 里合并那两个客户」。
> 线索只留给「CRM 里根本没有这个人」。所以多命中记 `kind=skipped`、`ambiguous` 计数 +1，
> 并在站内信里单独列一段提示。

### 3.4 线索归集（决策 3）

用 **`POST /api/leads/ingest`**（`server.ts:9875`），不用 `POST /api/leads`。原因：`/leads` 遇上重复公司+国家会 **409 拒绝**，而 `/ingest` 内部处理重复、返回 `duplicate: true`。

| 字段 | 值 |
|---|---|
| `company` | WhatsApp 联系人名；拿不到则用号码本身（schema 要求 `min(1)`） |
| `contact` | 联系人名 |
| `phone` | 号码 |
| `source` | **`WhatsApp 自动同步`** |
| `sourceType` | `inbound`（客户主动来消息） |
| `sourceChannel` | **`whatsapp`** |
| `externalId` | **`whatsapp:<normalizePhone(phone)>`** |
| `inquiryContent` | 摘要（≤20000） |
| `occurredAt` | 对话日期 |

> **`externalId` 不带日期**，这是刻意的：线索是**持久实体**，一个号码只该有一条线索。
> 带上日期会让同一个号码 30 天产生 30 条线索，把线索列表刷屏。
> `/ingest` 的幂等正是按 `(owner, channel, externalId)` 判重（`server.ts:6557-6562`）。

**与跟进的粒度差异**：
- 跟进记录 = **一天一条**（描述「今天聊了什么」）
- 线索 = **一个号码一条**（描述「这个人是谁」）

### 3.5 站内信（决策 3）

`POST /api/internal-messages/system`（`server.ts:4686`），`idempotencyKey = whatsapp-followup-sync:<date>` → 每天一条，不会重复。

内容示例（用户要求「可以稍微详细点」）：

```
主题：WhatsApp 同步：3 个客户已更新跟进，2 个新线索待认领

正文：
  同步时间：2026-10-14 19:00（Europe/Berlin）
  扫描会话 5 个，共 87 条消息

  已写入客户跟进（3）
   · Nordic Tools AB（Emma，+46…） 12 条消息
     客户确认采用 30% 预付，要求下周提供 CE 报告
   · Atlas Home Inc（Daniel，+1…） 8 条消息
     客户提到价格偏高，需人工确认是否让价
   · …

  新建线索（2）—— CRM 里没有对应客户，请认领或补充资料
   · +4915112345678（联系人 "Hans"） 5 条消息
     询问 LED 工程灯 CE 认证与 3000 件报价
   · +86…（无联系人名） 2 条消息
     仅问「还在吗」，建议人工确认是否为有效询盘

  需要注意（1）
   · +49… 同时匹配到 2 个客户，已按线索处理，请先合并 CRM 里的重复客户
```

### 3.6 同步记录（决策 4，「记录文档」）

**总结表 `followup_sync_runs`**：每次同步一行

| 字段 | 含义 |
|---|---|
| `owner_user_id` + `run_date` | **UNIQUE** —— 每天一条，手动重跑则更新 |
| `trigger` | `scheduled` / `manual` |
| `status` | `running` / `success` / `partial` / `failed` |
| `conversations_scanned` | 扫描会话数 |
| `customers_matched` | **匹配到客户数**（用户明确要看的） |
| `activities_written` | 实际写入跟进数 |
| `leads_created` | **新建线索数**（用户明确要看的） |
| `leads_existing` | 命中已有线索数（幂等跳过） |
| `message_count` | 消息总数 |
| `engine` / `model` | `cli` / `ai` / `none`（历史值 `rules` 读回时归成 `none`） |
| `notification_sent` | 站内信是否发出 |
| `skipped` / `error` / `summary` | 跳过项、失败原因、一行摘要 |
| `started_at` / `finished_at` | 耗时 |

**明细表 `followup_sync_items`**：每条处理结果一行

`run_id` / `contact_phone` / `conversation_key` / `customer_id` / `lead_id` / `kind(customer|lead)` / `activity_id` / `summary` / `status` / `error`

界面放在插件内（同步是插件发起的，记录留在插件最自然）。

### 3.7 幂等（三层）

| 层 | 机制 | 防的情况 |
|---|---|---|
| 1 | `followup_sync_runs` `UNIQUE(owner, run_date)` | 同一天跑出多条记录 |
| 2 | `automation_deliveries` 同款 `UNIQUE(owner, followup_id, run_date, delivery_type)`（`migrate.ts:357`） | 同一条重复投递 |
| 3 | 跟进 content 里的 marker + CRM 侧 `externalId` | CRM 侧兜底 |

跟进记录的 marker 格式：`[WhatsApp 自动同步 2026-10-14] <摘要>`
→ 天然支持**按前缀批量识别与撤销**。

---

## 4. 需要新增/复用的接口总览

| 接口 | 状态 |
|---|---|
| `PATCH /api/customers/{id}/activities/{activityId}` | ✅ **本轮新增** |
| `DELETE /api/customers/{id}/activities/{activityId}` | ✅ **本轮新增** |
| `POST /api/customers/{id}/activities` | ✅ 已有（`server.ts:9593`） |
| `POST /api/leads/ingest` | ✅ 已有（`server.ts:9875`，带 `externalId` 幂等） |
| `POST /api/internal-messages/system` | ✅ 已有（`server.ts:4686`） |
| `GET /api/customers` | ✅ 已有（匹配客户用） |
| `POST /api/v1/conversations/ingest` | ⬜ 待新增（插件侧，收扩展上传） |
| 插件 `followup_sync_runs` / `items` | ✅ 已新增（P1） |

**CRM 侧的写接口已全部就位** —— 剩下的是扩展采集与界面。

---

## 5. 红线（逐条对应用户「无风险」）

1. **不启用 Baileys** —— `WHATSAPP_OFFICIAL_ONLY` 保持 `true`（封号风险）
2. **扩展不点击、不遍历会话** —— 只被动监听，避免自动化特征
3. **扩展不持有 `CRM_JWT_SECRET`** —— 写 CRM 必须经插件代理
4. **不把对话原文入 CRM** —— 只写摘要；原文留扩展本地
5. **匹配不上或多个 → 不猜**，走线索 + 站内信提示
6. **所有自动写入带 marker** —— 可批量识别、可撤销
7. **`createdAt` / `operatorId` 不可改写** —— 谁创建的事实不能被编辑覆盖
8. **默认关闭** —— `followupSyncEnabled` 默认 `false`，要用户显式开启
9. **不改业绩统计逻辑** —— `server.ts:27237` 一行都不动；靠 marker 让人随时能区分自动与手动

---

## 6. 分阶段落地

| 阶段 | 内容 | 风险 | 状态 |
|---|---|---|---|
| **P0** | CRM 编辑/撤销跟进记录（安全网） | 🟢 不自动写任何东西 | ✅ **已完成** |
| **P1** | 插件：同步引擎 + 两张记录表 + 配置项 + 定时分支 + 界面接口 | 🟢 只写插件自己的表（默认关闭） | ✅ **已完成** |
| **P2** | 插件：接扩展上传通道 `POST /api/v1/conversations/ingest` | 🟡 首次让对话进入插件 | ⬜ |
| **P3** | 扩展：被动累积 + 定时上传 | 🟡 涉及扩展改动 | ⬜ |
| **P4** | 同步记录界面 + 站内信打磨 | 🟢 | ⬜ |

> P1 可以在**没有扩展**的情况下先用「人工导入的对话」（`POST /api/v1/imports/whatsapp-text`，已存在）验证同步质量 —— 不满意随时停，**全程不碰 CRM 数据**（写入由开关控制，默认关）。

---

## 6.5 P1 实施记录（2026-10-14）

**新增文件**：`whatsapp-plugin/src/server/services/followup-sync.ts`、`.../services/time-zone.ts`

**迁移 v17**（`migrate.ts` + `mysql-migrate.ts` 双写）：`followup_sync_runs`、`followup_sync_items`、`automation_settings` 5 个新列。已在本机 MySQL 实跑（`npm run db:migrate`），并同步登记到 `communication-tables.ts`（否则 PG→MySQL 数据迁移脚本会跳过新表）。

**新增接口**（插件侧）：

| 接口 | 用途 |
|---|---|
| `GET /api/v1/automation/followup-sync/runs` | 同步记录列表 |
| `GET /api/v1/automation/followup-sync/runs/:id` | 某次的逐条明细 |
| `PUT /api/v1/automation/followup-sync/settings` | 开关 + 时点（时区沿用节奏中心，不重复填） |
| `POST /api/v1/automation/followup-sync/run` | 立即同步（失败 502 + 真实原因） |

**开关默认关**（`followup_sync_enabled = 0`）：这条链会往业绩考核的数据源里写东西，不能替用户默认打开。

**实施中抓到的三个真问题**（都不是"写完就好"的那种）：

1. **`trigger` / `trigger_type` 的方言差异**。PG 可用 `trigger`、MySQL 里是保留词，列名必须分方言（与既有 `automation_runs` 同一套约定）。测试直接报 `column "trigger_type" of relation "followup_sync_runs" does not exist`。
2. **被跳过 / 歧义的会话没有写明细行**。`continue` 早于 `saveFollowupSyncItem`，导致「今天扫了 5 个会话、其中 1 个是寒暄」这种**用户最需要看到的答案**在记录里丢失。已改成每个会话无论结局都落一条明细。
3. **`0049…` 与 `+49…` 生成两个不同的线索键**，同一个人会变成两条线索。修在键的生成处（只动 key 形态，不动共享的 `normalizePhone`）。

**假绿断言（破坏验证抓到的）**：原断言写的是 `content.startsWith(followupMarker(DAY))` —— 把实现和断言一起改掉，断言照样通过。字面前缀才是契约（人工靠它识别、**批量撤销**也靠它），已改成比字面量。

**破坏验证 4 处**（每处都精确变红后还原）：
① 去掉 marker → 前缀断言红；② 不屏蔽商务数字 → 「不复述金额」断言红；③ 多命中时「取第一个」→ 计数与「不得写 crm-dup」断言红；④ 重跑不再 PATCH → 活动数 2 ≠ 1 红。

---

## 7. 测试口径

- **幂等**：同一会话同一天连跑 3 次 → 客户跟进只有 1 条、线索只有 1 条
- **匹配三态**：0 命中 → 建线索；1 命中 → 写跟进；**多命中 → 必须为 NULL 且建线索**
- **线索 externalId**：同一号码跨天跑两次 → **仍然只有 1 条线索**（不带日期的意义）
- **降级链**：CLI 挂了 → 退到配置的 AI 模型（`engine='ai'`）；两个通道都不可用 → `engine='none'` 且只写占位；两个通道都可用但调用失败 → `status='partial'` 并在记录与界面上都标注
- **空对话**：纯寒暄 → 不生成任何记录，但 `conversations_scanned` 仍要 +1
- **红线**：断言写入的 `content` **一定**以 `[WhatsApp 自动同步` 开头
- **可撤销**：撤销后 `customerActivities` 中该 id 消失，其它记录不受影响
- **扩展侧**：`archive.js` 纯函数单测 + e2e 校验重传不产生重复累积
