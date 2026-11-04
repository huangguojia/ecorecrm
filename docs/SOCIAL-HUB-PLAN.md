# 社媒聚合平台（Social Hub）落地方案

> 版本：v1.0（2026-10-21）
> 目标仓库：`GoodJob_private`（私人仓库；本文档位于 `docs/`，不进公开库）
> 定位：左侧导航新增一级入口「社媒聚合」，把海外客户的**私信、评论、主页内容**收进一个工作台，并闭合到 CRM 的线索/客户/商机。
> 阅读顺序：第 0 章看结论 → 第 3 章看平台能不能接 → 第 10 章看方案被推翻过什么 → 第 11 章看需要你拍板的事。

---

## 0. 一页结论

### 0.1 一句话方案

**不做"又一个聊天工具"，做"跨渠道客户会话的收件与治理层"**：连接器负责拿消息，Social Hub 负责排队、分配、合规回复、转线索，CRM 负责成交。

### 0.2 六个定调（先看这六条，后面全部由它们推导）

| # | 定调 | 原因 |
|---|---|---|
| 1 | **首发只做 4 个平台**：WhatsApp（复用现有）、Telegram、Facebook Messenger、Instagram | 这 4 个有可用官方 API，且是外贸客户实际在用的；其余平台的"能接"是名义上的 |
| 2 | **LinkedIn 只做"人工辅助"**：抓公开主页 + 起草消息 + 人工点发送 | LinkedIn 官方 Messages API 仅对合作伙伴开放，且条款明确禁止自动化/定时发送；浏览器自动化属违规 |
| 3 | **默认永不自动发送**，AI 只出草稿 | 与现有红线一致（CRM 智能回复永不自动发送）；LinkedIn/X 的条款也要求"人先看到字" |
| 4 | **接入层复用现有集成框架**（connector manifest / OAuth / 凭证库 / 队列 / 网络策略），只新建"会话域" | 避免第二套 OAuth 和凭证库；集成中心已有 6 个驱动在跑 |
| 5 | **本地部署 + 公网 webhook 的矛盾必须显式解决**：加一个"只验签、不入库"的公网网关 | 平台推送必须公网 HTTPS；把 4188 直接暴露是红线 |
| 6 | **会话数据是新增 PII**：保留 24 个月、可导出、可删除，权限按"渠道 × 团队"隔离 | 客户对话里会出现邮箱、电话、报价；欧盟客户适用 GDPR |

### 0.3 分三期，P0 就能闭环

| 期 | 内容 | 工作量（人日） | 闭环标志 |
|---|---|---|---|
| **P0** | 导航+视图骨架、渠道账号与健康度、统一收件箱、4 平台接入、草稿制回复、转线索 | 32–40 | 客户在 Telegram/FB 发消息 → 30 秒内进收件箱 → 起草 → 人工发送 → 一键转线索 |
| **P1** | 评论池（FB/IG/TikTok/YouTube）、分配与 SLA、快捷回复/模板、报表 | 24–30 | 评论能公开回复+私信回复，超时能告警 |
| **P2** | TikTok 私信（按地区）、X、LinkedIn 辅助通道、内容发布排期、多账号 | 30–36 | 一条素材排期发 3 个平台并回收数据 |

**如果只能先做一件事**：把 P0 的「统一收件箱 + 转线索」做透。评论和发布是增量，收件箱是地基；地基不对，后面全是返工。

### 0.4 三个必须先解决的外部依赖

1. **Meta App + 企业验证 + App Review**（FB/IG 共用）：审核要提交录屏，周期以周计，不通过就只能对 25 个测试用户生效。
2. **公网 HTTPS 入口**：webhook 回调地址必须是公网可达、证书有效、5 秒内返回 200。
3. **Telegram Bot**：找 @BotFather 建 bot 拿 token，5 分钟；但 bot 只能回复"先跟它说过话"的人。

---

## 1. 目标与非目标

### 1.1 目标（可验收）

| 编号 | 目标 | 验收口径 |
|---|---|---|
| G1 | 一个入口看到所有渠道的待回复会话 | 左侧导航「社媒聚合」带未读角标；列表默认"待我处理" |
| G2 | 消息不丢、不重、不乱序 | webhook 事件幂等率 100%；同一 `channel_message_id` 不产生两条记录 |
| G3 | 回复合规 | 窗口关闭时禁止自由文本，只能选模板；超长/禁词在发送前拦截 |
| G4 | 能转成生意 | 会话可一键转线索（幂等），线索可在 CRM 里继续跟 |
| G5 | 出问题看得见 | 每个渠道账号有健康度（token 剩余天数、最近一次推送、失败率），异常在导航角标与账号页同时提示 |
| G6 | 不污染考核数据 | 自动流程**不写** `customerActivities`；跟进记录只能人工确认写入 |

### 1.2 非目标（明确不做，避免范围失控）

- ❌ **不做批量群发/加粉/爬取通讯录**：Meta、TikTok、X、LinkedIn 全部禁止；这是封号的第一原因。
- ❌ **不做 WhatsApp 的第二套收发**：WhatsApp 仍由现有 3100 插件 + MV3 扩展负责；Social Hub 里只读 + 一键跳「即刻沟通」。
- ❌ **不做社媒数据大屏/舆情监控**：P2 之后再评估。
- ❌ **不做国内平台**（微信/企微/抖音国内版）：企业微信已有独立入口，合规与 API 体系不同。
- ❌ **不做自动成交/自动报价**：报价必须人确认。

---

## 2. 现状盘点：能复用什么，缺什么

### 2.1 已有且必须复用

| 能力 | 位置 | 复用方式 |
|---|---|---|
| 连接器框架（manifest / 驱动 / 审批 / 网络白名单） | `integration-sdk/src/connector-manifest.ts`、`integration-worker/src/drivers/` | 新平台作为 `official_api` 驱动接入，不新造协议 |
| OAuth 授权与回调 | `backend/src/integrations/integration-oauth-service.ts`、`integration-http-routes.ts`（`/oauth/callback/:connectorCode`） | 直接复用授权事务表与回调路由 |
| 凭证保管 | `backend/src/integrations/integration-credential-vault.ts` | 平台 token 加密存这里，前端只见 `last4` |
| Webhook 验签与幂等 | `backend/src/integrations/integration-webhook.ts` | 复用验签、事件表、重放机制 |
| 队列与重试 | `backend/src/integrations/integration-queue.ts` | 出站发送走同一套重试/死信 |
| 线索归集 | `POST /api/leads/ingest`（幂等键 `ownerId + sourceChannel + externalId`） | 会话转线索**只走这个接口** |
| AI 起草 | 3100 插件 `auto-chat/suggest` 四档引擎（rules/ai/cli/auto） | 复用规则快稿 + CLI 慢稿的两段式 |
| 知识库/训练库 | `backend/src/kb-training/` + 插件训练库 | 起草时按渠道语言检索，不新建知识体系 |
| 前端视图规范 | `frontend/index.html`（单文件，`.view` + `[data-view]`） | 新增 `<div class="view" id="social-hub">`，状态用模块级变量 |

### 2.2 真正的缺口（本方案要补的）

| 缺口 | 说明 | 影响 |
|---|---|---|
| 无统一会话模型 | 现有 `customer_activities` 是跟进记录，不是消息线程 | 必须新建 `social_*` 表 |
| 无公网入口 | 当前后端跑在本机 4188，平台推不进来 | P0 前置条件 |
| 无渠道账号生命周期 | 集成中心的 `connections` 面向"工具调用"，不面向"持续收消息" | 新建渠道账号表，但复用凭证与状态机思想 |
| 无窗口/计费感知 | 各平台窗口规则不同（24h/48h/7d） | 发送前必须过"窗口闸" |
| 无会话级权限 | 现有 RBAC 是功能级 | 需要"渠道 × 团队"的数据范围 |

### 2.3 与「即刻沟通」的边界（最容易做错的地方）

| | 即刻沟通（现有） | 社媒聚合（新增） |
|---|---|---|
| 定位 | WhatsApp 实时工作台 | 跨渠道收件箱 + 治理 |
| 发送 | 扩展面板内发送 | 除 WhatsApp 外，在 Hub 内发送 |
| WhatsApp 会话 | 主入口 | **只读镜像**，顶部按钮「去即刻沟通回复」 |
| 数据 | 插件库 | 同一套 `social_messages`（WhatsApp 由插件回写） |

**硬规则：同一条 WhatsApp 会话，同一时刻只有一个发送入口。** 双入口 = 双写 = 状态打架（知识库删除功能踩过"双向同步"的坑，见记忆第 7 节）。

---

## 3. 平台能力矩阵：到底能接什么（2026-10 核实）

> 这一章是全案的地基。很多"聚合平台"宣传能接 12 个平台，实际能读能回的只有一半。

### 3.1 能力矩阵

| 平台 | 收私信 | 发私信 | 评论 | 内容发布 | 官方门槛 | 结论 |
|---|---|---|---|---|---|---|
| **WhatsApp**（Cloud API / 现有插件） | ✅ | ✅ | — | — | WABA、号码、模板审核 | **P0**，复用现有 |
| **Telegram** | ✅（用户先 `/start`） | ✅（仅已发起用户） | — | 频道可发 | BotFather 拿 token，分钟级 | **P0**，最快出闭环 |
| **Facebook Messenger** | ✅ | ✅（24h 窗口内） | ✅ 主页评论 | ✅ 主页帖 | Meta App + 企业验证 + `pages_messaging` 审核 | **P0** |
| **Instagram** | ✅ | ✅（24h，人工可延至 7d） | ✅（评论私信回复 7d 内一次） | ✅（专业号） | 专业号 + 关联 FB 主页 + App Review | **P0** |
| **TikTok** | ⚠️ 仅 Business 且地区受限 | ⚠️ 仅回复，48h 内 10 条 | ✅（Business API 评论） | ✅ | Business API 权限；EEA/UK/CH 不支持私信 | **P1 评论 / P2 私信** |
| **X** | ✅（付费） | ✅（仅已同意接收者） | ⚠️ 有限 | ✅（$0.015/条，带链接 $0.20） | 按次计费，无免费档 | **P2** |
| **YouTube** | ❌ 无私信 | ❌ | ✅（配额 10,000 单位/天） | — | Google OAuth | **P1 仅评论** |
| **LinkedIn** | ❌ 无开放 API | ❌ | ⚠️ 仅 Community Management 合作伙伴 | ⚠️ 个人可发（`w_member_social`） | Messages API 仅合作伙伴；条款禁止自动化发送 | **P2 仅人工辅助** |

### 3.2 关键约束（写进代码，不是写进 PPT）

**Meta（FB/IG）**
- 必须有 Meta 开发者 App + 企业验证（Business Verification）；服务多商家需 Advanced Access + App Review，要提交录屏。
- 未过审只能对 App 内有角色的人（约 25 个测试用户）生效——**这不是"上线后再说"，是"没审就没有产品"**。
- IG 必须是 Business/Creator 专业号并关联 FB 主页，还要在 App 内打开「连接工具 → 允许访问消息」，否则一条都收不到。
- 标准回复窗口 **24 小时**（从客户最后一条消息起算）；人工客服可延到 **7 天**，但必须标记为人工发送，机器人不得使用。
- 长期 token **60 天**，需在到期前刷新；刷新失败 = 渠道变砖。
- 评论私信回复：**每条评论 7 天内只能私信一次**。

**TikTok**
- Business Messaging API **只能回复**，不能主动发起；窗口 **48 小时**、最多 **10 条**连续消息，超出不下发（不是限流，是直接不投递）。
- 注册地在 **EEA / 英国 / 瑞士** 的账号**完全不能**用 API 发私信；美国 2025-11 起开放；印度不可用。
- 评论回复限 **150 字符**纯文本；置顶/隐藏/删除不在 Business API 内。
- 图片私信在多数市场不可用，按"文本+链接"设计。

**X**
- 2026-02-06 起改为**按次计费**：读 DM 事件 **$0.01/条**、发 DM **$0.015/条**、发帖 $0.015（带链接 $0.20）。无免费档。
- 只能给**已同意接收**的用户发 DM；上限约 **15 条/15 分钟/账号**、**~1,440 条/24h**；禁止冷启动群发。
- 自动回复仅允许在"被 @ 或被引用"的 summoned 场景。

**LinkedIn**
- 开放权限只有三个：登录（`profile`/`email`）与**以本人身份发帖**（`w_member_social`）。
- Messages API **仅限获批合作伙伴**，且即使获批：只能发给一度人脉、必须由成员当场确认、**禁止自动化或定时发送**。
- 官方明确禁止爬虫/插件/自动化操作站点，违者账号可能被封。→ **只做"读公开主页 + 起草 + 人点发送"的辅助，不做接口发送。**

**WhatsApp（2026-10-01 起的新计费）**
- 24 小时客服窗口内的**自由回复开始计费**（按 utility/authentication 同价），每个企业号码每月 **1,000 条免费**服务消息。
- 窗口外只能发**已审核模板**，按营销/效用/验证分类计费。
- **这改变了成本模型**：以前"客户先来就免费"，现在客服量大的号码要算钱。

### 3.3 结论

> "连接各类国外平台"在 2026 年的真实含义是：**4 个能全功能接，2 个只能接一半，2 个只能看不能回。**
> 方案必须按这个现实设计 UI（能力灰显 + 原因说明），而不是画一个"支持 12 平台"的假矩阵。

---

## 4. 产品方案

### 4.1 导航与信息架构

**左侧一级导航**：在「即刻沟通」下方新增

```
[icon] 社媒聚合      ← data-view="social-hub"，右上角未读角标
```

- 角标数 = 未分配 + 分配给我且未读的会话数；超过 99 显示 `99+`。
- 无权限的成员不渲染该按钮（沿用现有 `data-permission` 机制）。
- 点击进入视图后，默认落在「收件箱 / 待我处理」。

**视图内 5 个页签**（标题行右侧小胶囊，不占内容区；这是 0.7.28 定案的同类交互）：

| 页签 | 内容 | 期 |
|---|---|---|
| 收件箱 | 三栏：渠道筛选 / 会话列表 / 会话详情 | P0 |
| 评论 | 评论池（FB/IG/TikTok/YouTube） | P1 |
| 发布 | 内容排期与回执 | P2 |
| 渠道 | 账号、授权、健康度、能力矩阵 | P0 |
| 报表 | 首响时长、解决时长、渠道转化 | P1 |

### 4.2 收件箱布局（三栏，宽度 260 / 360 / 自适应）

```
┌─────────────┬──────────────────┬──────────────────────────────┐
│ 渠道         │ 搜索 / 筛选       │ 会话头：联系人 + 渠道 + 状态   │
│ ○ 全部 (37)  │ ┌──────────────┐ │ 客户侧栏：国家/语言/历史订单   │
│ ○ WA   (12)  │ │ 头像 名称     │ ├──────────────────────────────┤
│ ○ TG    (8)  │ │ 最后一条摘要  │ │ 消息流（左客户/右我方）        │
│ ○ FB    (9)  │ │ 渠道标 时间   │ │ 系统事件：分配/状态/窗口变化   │
│ ○ IG    (8)  │ │ 未读 2        │ │                              │
│              │ └──────────────┘ ├──────────────────────────────┤
│ 状态         │                  │ 窗口条：剩余 3h12m · 计费提示  │
│ 待我处理 21  │                  │ AI 草稿卡（中文 + 客户语言）   │
│ 未分配  9    │                  │ 输入框 + 模板 + 发送(需确认)   │
│ 已解决  7    │                  │                              │
└─────────────┴──────────────────┴──────────────────────────────┘
```

**关键交互（都要落到实现细节）**

1. **未读与已读**：进入会话 800ms 后调用 `POST /read`；只有"客户消息"才计未读，我方与系统消息不计。
2. **回复框**：
   - `⌘/Ctrl + Enter` 发送，`Esc` 收起 AI 卡，`↑` 编辑上一条草稿。
   - 发送前本地校验：长度（按平台上限）、附件类型、窗口状态、禁词；服务端二次校验（前端校验不算数）。
   - 发送按钮在"窗口已关闭"时变为「选模板发送」，点击弹出模板选择器，不让人写自由文本。
3. **AI 草稿**：打开会话即请求 `engine=rules` 快稿（目标 < 300ms），2 秒后再补一轮完整稿并**静默替换**；替换时若用户已开始编辑，则只在卡片上提示「有更好的版本」，不覆盖输入框。
4. **草稿卡两格**：上中文（我方视角，给业务员看）、下客户语言（发给客户）；缺中文只出一格。
5. **转线索**：会话头「转线索」→ 预填（渠道、昵称、国家、语言、首条需求摘要）→ 人工确认 → 调 `/api/leads/ingest`。已关联客户时按钮变「查看客户」。
6. **渠道健康**：会话头显示该渠道账号的小圆点；红色时悬停给出原因与「去重连」。
7. **空态**：区分"没连渠道"（引导去渠道页）、"连了但没消息"（显示最近同步时间）、"筛选无结果"（清除筛选）。

### 4.3 渠道页（接入闭环的门面）

每个平台一张卡：

```
┌───────────────────────────────────────────────┐
│ ● Facebook Messenger          已连接 2 个账号  │
│ 能力：收私信 ✅  发私信 ✅  评论 ✅  发布 ✅   │
│ 窗口：24h（人工 7d）   计费：平台免费          │
│ 账号：GoodJob Machinery (Page)                 │
│       token 剩余 41 天 · 最近推送 12 秒前      │
│ [重连] [查看权限] [暂停] [移除]                │
└───────────────────────────────────────────────┘
```

- **未接入**的卡片显示"接入方式 + 门槛"，而不是灰掉的死按钮：
  - Telegram：「5 分钟接入」→ 弹窗贴 token → 自动 `getMe` 验证。
  - LinkedIn：「仅支持人工辅助」→ 解释为什么不能 API 发送，给"扩展辅助"开关。
  - TikTok：「私信受地区限制」→ 显示当前账号注册地判定结果。
- **能力矩阵**在页面底部常驻，用 ✅/⚠️/❌ 三态，任何灰显都能点出原因。

### 4.4 评论页（P1）

两栏：评论流（按平台/视频/关键词筛选）+ 详情（原文、作者、时间、点赞）。

- 每条评论三个动作：**公开回复**（平台内可见）、**私信回复**（Meta 平台每条评论 7 天内一次）、**转线索**。
- 批量勾选只允许"标记已处理"，**不允许批量回复**（防误触 + 防风控）。
- 公开回复模板化：`{品牌}已私信您，请查收`，正文在私信里说。

### 4.5 发布页（P2）

- 一条内容 → 多平台适配：字数（X 280 / IG 2200 / TikTok 2200）、图片比例、链接位置（X 带链接 $0.20，提示"链接放首条评论"）。
- 排期：按账号时区展示；发布前 10 分钟可改，发布中不可改。
- 回执：成功/失败/平台限流三种状态，失败给原始错误码。

---

## 5. 技术架构

### 5.1 分层

```
┌──────────────────────────────────────────────────────────────┐
│ 前端 frontend/index.html                                     │
│  #social-hub 视图 · socialHubState（模块级）· data-social-*  │
└───────────────┬──────────────────────────────────────────────┘
                │ /api/social/*
┌───────────────▼──────────────────────────────────────────────┐
│ 会话域 backend/src/social/                                   │
│  inbox-service（会话/消息）  routing-service（分配/SLA）      │
│  window-guard（窗口/模板）   identity-service（联系人合并）    │
│  publish-service（P2）       analytics-service（P1）          │
└───────┬───────────────────────────────┬──────────────────────┘
        │                               │
┌───────▼─────────────┐        ┌────────▼─────────────────────┐
│ 接入层（复用）       │        │ 公网 Webhook 网关（新增）     │
│ integration-sdk      │        │ verify → 200 → 入队 → 转发    │
│ oauth / vault / queue│        │ 不解析业务、不落库、不暴露内网 │
└───────┬─────────────┘        └────────┬─────────────────────┘
        │                               │
┌───────▼───────────────────────────────▼──────────────────────┐
│ 平台 API：Meta Graph / Telegram Bot / TikTok / X / LinkedIn   │
└──────────────────────────────────────────────────────────────┘
```

### 5.2 为什么必须有"公网网关"

- 平台只往**公网 HTTPS** 推；本机 4188 不能直接对外（安全红线，也过不了证书校验）。
- 网关职责只有三件：**验签 → 立即 200 → 投递到内网队列**。它不解析业务字段，不连数据库，被打穿也拿不到客户数据。
- 部署形态三选一（第 11 章要拍板）：
  1. 云函数/轻量云主机 + 反向隧道到内网（推荐，暴露面最小）；
  2. 现有公网服务器上加 Nginx 反代 + IP 白名单（Meta 的 IP 段会变，白名单不可靠）；
  3. **无公网兜底**：轮询拉取。代价是延迟 30–60 秒，且 Meta 的 `messages` 字段多数场景必须 webhook 订阅后才可读，**不保证等价**。

### 5.3 数据模型（MySQL，主键 `VARCHAR(64)`，与现有 `customers` 一致）

> 迁移要同步四处：`backend/src/migrate-mysql.ts` + PG 迁移 + `whatsapp-plugin/src/server/db/communication-tables.ts` + `whatsapp-plugin/tests/data-lifecycle.test.ts`（这是既有铁律）。

```sql
-- ① 渠道目录（静态，可 seed）
CREATE TABLE IF NOT EXISTS social_channels (
  code            VARCHAR(32) PRIMARY KEY,   -- whatsapp/telegram/facebook/instagram/tiktok/x/youtube/linkedin
  name            VARCHAR(64) NOT NULL,
  capabilities    JSON NOT NULL,             -- {inbox,send,comment,publish,window_hours,requires_review}
  status          VARCHAR(16) NOT NULL,      -- available/limited/assisted/planned
  created_at      DATETIME NOT NULL,
  updated_at      DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ② 渠道账号（一个平台可多账号）
CREATE TABLE IF NOT EXISTS social_channel_accounts (
  id                 VARCHAR(64) PRIMARY KEY,
  channel_code       VARCHAR(32) NOT NULL,
  external_id        VARCHAR(128) NOT NULL,  -- Page ID / Bot ID / IG user id
  display_name       VARCHAR(200) NOT NULL,
  avatar_url         VARCHAR(512) NULL,
  credential_ref     VARCHAR(128) NOT NULL,  -- 指向集成凭证库，明文 token 永不入库
  scopes             TEXT NULL,
  token_expires_at   DATETIME NULL,          -- Meta 60 天；Telegram 无
  webhook_secret_ref VARCHAR(128) NULL,
  status             VARCHAR(24) NOT NULL,   -- active/degraded/reauth_required/paused/disconnected
  health_json        JSON NULL,              -- {last_push_at, fail_rate, token_days_left}
  owner_id           VARCHAR(64) NOT NULL,
  team_id            VARCHAR(64) NULL,
  created_at         DATETIME NOT NULL,
  updated_at         DATETIME NOT NULL,
  UNIQUE KEY uk_channel_external (channel_code, external_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ③ Webhook 原始事件（幂等 + 可重放）
CREATE TABLE IF NOT EXISTS social_webhook_events (
  id             VARCHAR(64) PRIMARY KEY,
  account_id     VARCHAR(64) NOT NULL,
  platform_event VARCHAR(128) NOT NULL,      -- mid / event id / 组合哈希
  payload        MEDIUMTEXT NOT NULL,
  signature_ok   TINYINT(1) NOT NULL DEFAULT 0,
  status         VARCHAR(16) NOT NULL,       -- received/queued/processed/ignored/dead_letter
  attempts       INT NOT NULL DEFAULT 0,
  error          VARCHAR(500) NULL,
  received_at    DATETIME NOT NULL,
  processed_at   DATETIME NULL,
  UNIQUE KEY uk_event (account_id, platform_event),
  KEY idx_status (status, received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ④ 统一联系人
CREATE TABLE IF NOT EXISTS social_contacts (
  id              VARCHAR(64) PRIMARY KEY,
  display_name    VARCHAR(200) NULL,
  avatar_url      VARCHAR(512) NULL,
  country         VARCHAR(80) NULL,
  language        VARCHAR(16) NULL,          -- 由消息语言推断，可人工改
  primary_phone   VARCHAR(40) NULL,
  primary_email   VARCHAR(200) NULL,
  crm_customer_id VARCHAR(64) NULL,          -- 关联 customers，人工确认后写
  crm_lead_id     VARCHAR(64) NULL,          -- 关联 leads
  merged_into     VARCHAR(64) NULL,          -- 合并留痕，不物理删
  created_at      DATETIME NOT NULL,
  updated_at      DATETIME NOT NULL,
  KEY idx_phone (primary_phone),
  KEY idx_customer (crm_customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ⑤ 渠道身份（一个联系人在每个渠道有独立 ID）
CREATE TABLE IF NOT EXISTS social_contact_identities (
  id                VARCHAR(64) PRIMARY KEY,
  contact_id        VARCHAR(64) NOT NULL,
  account_id        VARCHAR(64) NOT NULL,
  external_user_id  VARCHAR(200) NOT NULL,   -- PSID / IGSID / TG user id / X id
  username          VARCHAR(200) NULL,
  profile_json      JSON NULL,
  first_seen_at     DATETIME NOT NULL,
  last_seen_at      DATETIME NOT NULL,
  UNIQUE KEY uk_identity (account_id, external_user_id),
  KEY idx_contact (contact_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ⑥ 会话
CREATE TABLE IF NOT EXISTS social_conversations (
  id                  VARCHAR(64) PRIMARY KEY,
  account_id          VARCHAR(64) NOT NULL,
  external_thread_id  VARCHAR(200) NOT NULL,  -- 平台会话 id；Telegram 用 chat id
  contact_id          VARCHAR(64) NOT NULL,
  subject             VARCHAR(300) NULL,
  status              VARCHAR(16) NOT NULL,   -- open/pending/resolved/snoozed
  assignee_id         VARCHAR(64) NULL,
  team_id             VARCHAR(64) NULL,
  priority            VARCHAR(8) NOT NULL DEFAULT 'normal', -- low/normal/high/urgent
  unread_count        INT NOT NULL DEFAULT 0,
  last_inbound_at     DATETIME NULL,
  last_outbound_at    DATETIME NULL,
  first_response_at   DATETIME NULL,          -- 首响指标，只写一次
  window_expires_at   DATETIME NULL,          -- 平台窗口截止
  sla_due_at          DATETIME NULL,
  resolved_at         DATETIME NULL,
  created_at          DATETIME NOT NULL,
  updated_at          DATETIME NOT NULL,
  UNIQUE KEY uk_thread (account_id, external_thread_id),
  KEY idx_queue (status, assignee_id, last_inbound_at),
  KEY idx_sla (sla_due_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ⑦ 消息
CREATE TABLE IF NOT EXISTS social_messages (
  id                  VARCHAR(64) PRIMARY KEY,
  conversation_id     VARCHAR(64) NOT NULL,
  account_id          VARCHAR(64) NOT NULL,
  channel_message_id  VARCHAR(200) NULL,      -- 平台消息 id；本机生成的出站消息先占位
  direction           VARCHAR(8) NOT NULL,    -- in/out
  sender_type         VARCHAR(16) NOT NULL,   -- contact/agent/ai/system
  sender_id           VARCHAR(64) NULL,
  content_type        VARCHAR(24) NOT NULL,   -- text/image/file/audio/video/template/card/system
  text                MEDIUMTEXT NULL,
  text_zh             MEDIUMTEXT NULL,        -- 译文/中文口径，检索用（与扩展的 zh 同思路）
  media_json          JSON NULL,
  reply_to_id         VARCHAR(200) NULL,
  status              VARCHAR(16) NOT NULL,   -- received/queued/sent/delivered/read/failed
  error_code          VARCHAR(80) NULL,
  error_message       VARCHAR(500) NULL,
  is_within_window    TINYINT(1) NULL,        -- 发送当时是否在窗口内
  billable_category   VARCHAR(16) NULL,       -- service/marketing/utility/auth/none
  sent_at             DATETIME NULL,
  created_at          DATETIME NOT NULL,
  UNIQUE KEY uk_msg (account_id, channel_message_id),
  KEY idx_conv_time (conversation_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ⑧ 会话事件（审计，不改历史）
CREATE TABLE IF NOT EXISTS social_conversation_events (
  id              VARCHAR(64) PRIMARY KEY,
  conversation_id VARCHAR(64) NOT NULL,
  type            VARCHAR(32) NOT NULL,  -- assigned/status_changed/tagged/sla_breached/window_closed/converted
  actor_id        VARCHAR(64) NULL,      -- 系统事件为 NULL
  payload         JSON NULL,
  created_at      DATETIME NOT NULL,
  KEY idx_conv (conversation_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ⑨ 出站队列（草稿 → 确认 → 发送，含幂等键）
CREATE TABLE IF NOT EXISTS social_outbound_queue (
  id                VARCHAR(64) PRIMARY KEY,
  conversation_id   VARCHAR(64) NOT NULL,
  account_id        VARCHAR(64) NOT NULL,
  idempotency_key   VARCHAR(128) NOT NULL,
  content_type      VARCHAR(24) NOT NULL,
  text              MEDIUMTEXT NULL,
  media_json        JSON NULL,
  template_code     VARCHAR(80) NULL,
  status            VARCHAR(16) NOT NULL, -- draft/approved/sending/sent/failed/cancelled
  approved_by       VARCHAR(64) NULL,
  attempts          INT NOT NULL DEFAULT 0,
  scheduled_at      DATETIME NULL,
  last_error        VARCHAR(500) NULL,
  created_by        VARCHAR(64) NOT NULL,
  created_at        DATETIME NOT NULL,
  updated_at        DATETIME NOT NULL,
  UNIQUE KEY uk_idem (idempotency_key),
  KEY idx_status (status, scheduled_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

P1/P2 追加：`social_comments`、`social_publish_jobs`、`social_sync_cursors`、`social_sla_policies`。

### 5.4 接口清单（P0）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/social/channels` | 能力矩阵（前端渠道页与灰显依据） |
| GET | `/api/social/accounts` | 账号 + 健康度 |
| POST | `/api/social/accounts/telegram` | 贴 token 接入（服务端 `getMe` 校验） |
| POST | `/api/social/accounts/:id/auth/start` | Meta OAuth 起跳（复用集成 OAuth） |
| POST | `/api/social/accounts/:id/reconnect` | 重连 |
| POST | `/api/social/accounts/:id/pause` | 暂停（停止推送处理，保留历史） |
| DELETE | `/api/social/accounts/:id` | 移除（软删，保留会话） |
| GET | `/api/social/conversations` | 列表：`status/channel/assignee/q/cursor` |
| GET | `/api/social/conversations/:id` | 详情 + 最近 50 条消息 |
| GET | `/api/social/conversations/:id/messages?before=` | 分页 |
| POST | `/api/social/conversations/:id/read` | 清未读 |
| POST | `/api/social/conversations/:id/assign` | 分配 |
| POST | `/api/social/conversations/:id/status` | 改状态 |
| POST | `/api/social/conversations/:id/suggest` | AI 草稿（`engine=rules` 快稿） |
| POST | `/api/social/conversations/:id/messages` | 发送。体含 `confirm:true` 与 `idempotencyKey` |
| POST | `/api/social/conversations/:id/convert-to-lead` | 转线索（内部调 `/api/leads/ingest`） |
| GET | `/api/social/overview` | 导航角标与未读数 |
| GET/POST | `/api/social/webhooks/:channel/:accountPublicId` | 平台回调（GET 校验、POST 事件） |

**发送接口的硬约束（服务端，不是前端）**

```ts
// 伪代码，落在 backend/src/social/window-guard.ts
assert(account.status === "active");
assert(!isWindowClosed(conv, now) || body.templateCode);   // 窗口外只允许模板
assert(textLength(text) <= CHANNEL_LIMITS[channel].text);  // X 280 / TikTok 150(评论)
assert(!containsForbidden(text));                          // 复用 applyGuardrails 的禁用词
assert(idempotencyKey && !exists(idempotencyKey));         // 重发不重复
// 通过后才入 social_outbound_queue，状态 approved → sending
```

### 5.5 收消息链路（可靠性设计）

```
平台 → 公网网关（验签，5s 内 200）→ 内网队列
     → social_webhook_events（UNIQUE 幂等）
     → normalize（平台 JSON → 统一 Message）
     → identity（匹配/创建 social_contacts + identities）
     → conversation upsert（UNIQUE account_id+thread_id）
     → unread++ / 分配规则 / SLA 计算 / 窗口刷新
     → WebSocket 推送前端（失败降级为 15s 轮询）
```

- **顺序**：以平台时间戳排序；同毫秒用 `channel_message_id` 兜底，绝不用"到达顺序"。
- **重试**：处理失败指数退避 5 次（1s/5s/30s/2min/10min），仍失败进 `dead_letter`，渠道页可见并可"重放"。
- **补偿**：每 5 分钟按 `social_sync_cursors` 拉一次增量（Telegram `getUpdates`/Meta conversations），补 webhook 丢失。
- **乱序与重复**：Meta 会重推同一事件，`UNIQUE(account_id, platform_event)` 直接 `ignored`。
- **大 payload**：只存必要字段 + 原文摘要，媒体只存 URL/平台 id，**不下载客户文件**（存储与合规双赢）。

### 5.6 前端实现要点（对着现有规范写）

1. 新视图 `<div class="view" id="social-hub">`，样式全部写在视图内 `<style>` 或用独立 CSS，**禁止** `#social-hub { display:none }` 这种"以 id 为唯一主体"的规则（ID 权重会压掉 `.view`，2026-10-16 全站渲染事故）。
2. 状态放模块级 `socialHubState`（`selectedChannel`, `conversations`, `activeId`, `messages`, `draft`, `filters`），**不进 `AppState`**（沿用 KB 训练页的做法）。
3. 渲染用字符串模板 + `data-social-*` 属性，事件用事件委托挂在视图根节点，避免 3 万行文件里到处 `addEventListener`。
4. 列表用 `cursor` 分页，滚到底加载；消息流"向上加载更多，保持滚动位置"。
5. 所有按钮带 `data-permission="social.reply"` 等；无权限渲染为只读并提示。
6. 首屏骨架屏 + 错误条（带重试），不要白屏；渠道红点时同时在导航角标体现。

---

## 6. 七个闭环（每个都有入口、正常路径、失败路径）

### 闭环 1：接入

`渠道页 → 选平台 → 授权/贴 token → 服务端校验 → 拉 profile → 订阅 webhook → 试发给自己 → status=active`

失败路径：
- token 无效 → 不落库，弹原始错误（`401 Unauthorized` 翻译成"token 不对或已失效"）。
- 权限不足（如 IG 没开"允许访问消息"）→ 明确指引到 App 内开关，而不是"接入成功但收不到"。
- webhook 订阅失败 → 账号状态 `degraded`，渠道页红条 + 重试按钮。

### 闭环 2：收件

`webhook → 验签 → 幂等 → 归一化 → 联系人 → 会话 → 未读 → 推送`

失败路径：验签失败 → 401 且记 `signature_ok=0`（不处理，但留证）；解析失败 → `dead_letter` + 告警；推送失败 → 前端轮询兜底。

### 闭环 3：分配与 SLA

`新会话 → 规则匹配（渠道/语言/国家/关键词/负载）→ 分配 → 通知 → 首响计时`

- 规则优先级：指定客服 > 语言匹配 > 渠道负责人 > 轮询。
- SLA：首响 30 分钟（工作时间），超时前 5 分钟提醒，超时记 `sla_breached` 并按周汇总。
- **不自动改客户归属**：`customers.ownerId` 不因会话分配而变（这是考核数据，见第 7 章）。

### 闭环 4：回复

`AI 草稿 → 人工编辑 → 本地校验 → 服务端校验（窗口/长度/禁词/幂等）→ 发送 → 回执 → 失败重试`

- 失败分类：可重试（429/5xx/网络）自动退避；不可重试（403 权限/窗口关闭/被拉黑）直接标红并给处置建议。
- 回执：`sent → delivered → read` 分行显示；平台不支持已读就不显示，不伪造。
- **发送只发生在用户点击那一下**（与资料卡发送同一条铁律）。

### 闭环 5：转线索

`会话 → 转线索弹窗（预填）→ 人工确认 → /api/leads/ingest（幂等）→ 回写 contact.crm_lead_id → 会话标 converted`

- 幂等键：`ownerId + "social:" + channel + ":" + externalUserId`，重复点击返回同一条。
- **绝不写 `customerActivities`**；需要留痕就写 `social_conversation_events`。
- 已存在同手机号/邮箱的客户 → 提示"可能是同一客户"，由人决定关联，**不自动合并**（自动合并会串客户历史）。

### 闭环 6：评论（P1）

`评论 webhook → 评论池 → 公开回复 / 私信回复 → 标已处理 → 可转线索`

- IG/FB 私信回复受"7 天一次"限制，UI 直接显示"已私信过"。
- TikTok 公开回复 150 字符，超长在输入框就截断提示。

### 闭环 7：断线恢复

`token 到期 / 权限撤销 / 限流 / 账号被封 → 健康度变红 → 站内提醒 → 一键重连 → 增量补偿`

- Meta token 剩余 15 天开始黄色提醒，7 天红色；刷新任务每天 03:00 跑。
- 限流（429）→ 账号维度熔断 60 秒，队列保留，恢复后按序补发（同一会话保持顺序）。

---

## 7. 治理、权限、合规、成本

### 7.1 权限

| 权限码 | 能力 | 默认给谁 |
|---|---|---|
| `social.view` | 看会话（按渠道 × 团队范围） | 销售 |
| `social.reply` | 起草与发送 | 销售 |
| `social.assign` | 分配/改状态 | 主管 |
| `social.accounts` | 接入/重连/暂停账号 | 管理员 |
| `social.publish` | 发布内容 | 市场 |
| `social.analytics` | 看报表 | 主管及以上 |
| `social.admin` | 模板、SLA、禁用词 | 管理员 |

数据范围：`team_id` 为空 = 全公司可见；有值则只对该团队可见。跨团队查看需 `social.admin`。

### 7.2 审计

所有写操作落 `social_conversation_events` 或 `social_audit_log`：谁、何时、对哪条会话、做了什么、原值/新值。**审计表只追加，不更新不删除。**

### 7.3 合规

- **PII**：会话含姓名、电话、邮箱、地址。保留 **24 个月**，到期归档（导出后删消息正文，保留统计）。
- **删除权**：按联系人删除 → 消息正文置空、保留 id 与时间（证明"曾有对话"），并记审计。
- **跨境**：客户数据存客户自己的服务器（私有部署），不上第三方云；公网网关**不落库**。
- **平台条款**：不抓取非授权数据、不群发、不诱导互动；LinkedIn 只做人工辅助。

### 7.4 成本模型（按月，按 3,000 条客户来消息估算）

| 项 | 计费口径 | 估算 |
|---|---|---|
| WhatsApp 服务消息 | 2026-10-01 起窗口内也计费；每号码 1,000 条/月免费，超出按 utility 价 | 2,000 条计费 × $0.0034–0.022 ≈ **$7–44** |
| WhatsApp 模板（窗口外） | 按营销/效用分类 | 200 条 × $0.025 ≈ **$5** |
| Meta（FB/IG） | API 免费 | **$0** |
| Telegram | 免费 | **$0** |
| X | 读 DM $0.01/条、发 $0.015/条 | 1,000 读 + 500 发 ≈ **$17.5** |
| 公网网关 | 轻量云主机/函数 | **$5–20** |
| 合计 | | **约 $30–90/月** |

> 注意：X 的"带链接发帖 $0.20"是隐藏炸弹；如果做内容发布，链接一律放首条评论。

---

## 8. 交付计划与验收

### 8.1 P0 拆解（32–40 人日）

| 工作包 | 内容 | 人日 |
|---|---|---|
| A. 数据与迁移 | 9 张表、双库迁移、parity 校验、数据生命周期测试 | 5 |
| B. 接入层 | Telegram bot、Meta OAuth、账号健康度、token 刷新 | 8 |
| C. 收件链路 | 网关、验签、幂等、归一化、联系人匹配、补偿拉取 | 7 |
| D. 会话域 API | 列表/详情/已读/分配/状态/发送/转线索 | 6 |
| E. 前端视图 | 导航、三栏收件箱、渠道页、草稿卡、窗口条 | 9 |
| F. 测试与验收 | 单测、接口测试、e2e（假渠道服务）、自检项 | 5 |

### 8.2 验收清单（P0 必须全绿）

- [ ] 导航出现「社媒聚合」，无权限账号看不到；未读数与列表一致。
- [ ] Telegram 从贴 token 到收到第一条消息 ≤ 5 分钟。
- [ ] FB/IG 授权后能收到真实客户消息；断开后能重连并补回断线期间消息。
- [ ] 同一事件重推 10 次，数据库只有 1 条消息。
- [ ] 窗口关闭时发送自由文本被服务端拒绝，提示可选模板。
- [ ] 发送失败有明确原因，重试不产生重复消息（幂等键生效）。
- [ ] 转线索重复点击 5 次，只产生 1 条线索。
- [ ] 自动流程执行后 `customerActivities` 条数不变。
- [ ] 视图在**其他页面不渲染**（`.view` 规范自检）。
- [ ] `self-test.ts` 新增 6 项：导航存在、视图唯一、权限门禁、窗口守卫、幂等键、无 ID 级 display。

### 8.3 测试策略（照现有铁律）

1. 断言里**不调用被测函数**，契约字符串写字面量。
2. 每条新自检要**实测会红**：改坏 → 确认红 → 还原并校验哈希。
3. "禁止某写法"的断言跑在**剥注释副本**上。
4. 验"视图存在"必须同时验"别处不存在"。
5. e2e 用假渠道服务（本地 HTTP），不连真实平台；真实平台只做 live-check 手工验证。

---

## 9. 风险清单

| 风险 | 概率 | 影响 | 处置 |
|---|---|---|---|
| Meta App Review 被拒/拖延 | 高 | P0 缩水成 Telegram 单渠道 | 先做 Telegram 打通全链路；Meta 并行提审；文档/隐私政策提前准备 |
| 公网网关被打 | 中 | 数据泄露 | 网关只验签不解析、不落库、不连内网数据库；限流 + IP 信誉 |
| token 过期导致静默停收 | 高 | 客户消息丢失 | 剩余 15 天提醒 + 每日刷新 + "最近推送"健康度 |
| 平台改版/字段变更 | 中 | 解析失败 | 归一化层版本化，原始 payload 留存可回放 |
| 业务员把 Hub 当 IM 闲聊 | 中 | 响应指标失真 | 只显示"客户会话"，内部沟通走现有渠道 |
| 自动转线索污染考核 | 低（已禁止） | 不可逆 | 转线索必须人工确认；不写 `customerActivities` |
| 成本超支（X/WhatsApp） | 中 | 账单 | 渠道级预算上限 + 超额熔断 + 月度报表 |
| 多账号登录态冲突 | 中 | 串号 | 账号维度隔离，禁止共用 token |

---

## 10. 自我辩论（三次）

> 规则：每一轮我先充当"反方"，只攻击、不辩护；再以"正方"回应；最后必须落到**方案的具体修改**，否则这轮算白辩。

### 第一轮：范围之辩——"连接各类平台"是不是一句空话？

**反方（攻击）**
1. 你在矩阵里自己写了：LinkedIn 不能发、TikTok 有地区限制、YouTube 没有私信、X 要按条付费。那"连接各类国外平台"就是营销话术。
2. 8 个平台 × 每条链路的差异（窗口、限长、媒体、评论、回执）= 至少 8 套特例，一个 3 人团队维护不动。
3. Meta 审核要几周，P0 承诺"4 平台闭环"是把公司命脉押在别人的审核队列上。

**正方（回应）**
1. 承认："全平台"是伪需求。外贸客户真实分布是 WhatsApp > FB/IG > Telegram > 其余；前四个覆盖 80% 以上的询盘。
2. 差异不应写在业务代码里，应写在**渠道能力描述**里（`capabilities` JSON + 每渠道一个 adapter），业务层只认统一模型。8 个 adapter 各 200 行，是可维护的；8 套业务分支才是灾难。
3. Meta 审核是外部依赖，不是排期问题。解法是**把 Telegram 做成第一条打通全链路的渠道**——它 5 分钟接入、无审核、有真实用户，能在 Meta 审核期间验证收件箱、分配、转线索全部逻辑。

**落到方案的修改**
- ✅ 首发平台从"各类"收敛为 **4 个**，其余标注 `limited/assisted/planned` 并在 UI 明说原因。
- ✅ 新增 `social_channels.capabilities` 作为**唯一能力事实源**，前端按钮禁用、后端校验都读它，禁止在代码里写 `if (channel === 'linkedin')`。
- ✅ 把 Telegram 提为**第一条验收渠道**（原计划是 FB），Meta 审核并行。
- ✅ P0 验收里去掉"4 平台同时可用"，改为"Telegram 全链路 + Meta 至少 1 个平台"。

**反方仍未被说服的点**：如果 Meta 审核拖 8 周，P0 就只有 Telegram + WhatsApp，产品价值是否撑得住？→ 见第二轮（用 WhatsApp 存量补位）。

---

### 第二轮：架构之辩——是不是在造第二个集成中心？

**反方（攻击）**
1. 你已经有 `integration-center` + `integration-sdk` + 6 个驱动 + OAuth + 凭证库 + 队列。现在又加 `social/*` 九张表、十几个接口，这就是第二套系统。
2. 更糟的是 WhatsApp：现有插件已经有一套会话与消息，你又要建 `social_messages`，必然双写。双写一定不一致——知识库那次"双向同步"已经教过一次。
3. 本地部署 + 公网 webhook 天然矛盾。你要么把 4188 暴露（安全红线），要么加网关（多一个要运维的组件）。为了收消息加一个公网服务，值吗？

**正方（回应）**
1. 分层不同：集成中心管"**能力调用**"（一次请求一次结果），Social Hub 管"**持续会话**"（有状态、有队列、有 SLA）。硬塞进 `connections` 会让两边都变形。复用的是**管道**（OAuth/凭证/队列/验签），新建的只是**领域模型**——这正是 Chatwoot 的做法：Channel 多态 + Inbox + Conversation 三层，新增渠道不改核心。
2. 双写问题的解法不是"不建表"，而是**定唯一写入方**：
   - WhatsApp：**插件是唯一写入方**，Social Hub 只读它的库（同库不同表，或视图）。
   - 其他渠道：**Social Hub 是唯一写入方**。
   - 禁止互相回写；需要展示时用只读投影。这条写成架构约束，并加自检（检测 `social_messages` 出现 `channel=whatsapp` 且 `sender_type=agent` 的写入来源必须是插件）。
   - 更彻底的选择：P0 **WhatsApp 不进 Social Hub 收件箱**，只在渠道页显示"已连接（由即刻沟通管理）"。这样零双写。
3. 公网网关是必要成本，但要把它做"薄"：只做验签 + 200 + 转发，不解析、不落库、不连数据库。它的攻击面等于一个 HTTP 路由器。备选是无公网轮询，但 Meta 部分字段必须 webhook 订阅后才可读，**轮询不是等价方案**，只能当降级。

**落到方案的修改**
- ✅ 明确"**管道复用、领域新建**"，并在文档画出边界（本方案 5.1）。
- ✅ **P0 的 WhatsApp 不写入 `social_messages`**：渠道页显示"由即刻沟通管理"，点击跳转。等 P2 再评估只读投影。这一条直接消灭双写风险。
- ✅ 增加架构自检：禁止 `social_*` 表出现 `channel_code='whatsapp'` 的入站写入（除非来源标记为插件同步）。
- ✅ 网关加"三不"约束并写进部署清单：不解析业务、不落库、不连内网 DB。

**反方仍未被说服的点**：如果 P2 真要把 WhatsApp 放进统一收件箱，只读投影会不会又变成"看起来能回、其实回不了"的假入口？→ 接受，P2 再议，且默认只读+跳转。

---

### 第三轮：合规与数据之辩——自动化是不是在给自己挖坑？

**反方（攻击）**
1. 你嘴上说"永不自动发送"，但产品里到处是"AI 推荐回复""一键发送""自动分配"。业务员一点，就是自动化发送，平台照样判 spam。
2. 转线索会写 `leads`，线索又参与业绩。你说的"人工确认"在高压销售场景会被点穿，最后等于自动灌数据。
3. 24 小时窗口、48 小时窗口、7 天人工窗口、每号码 1,000 条免费额度——这些一旦算错，客户消息发不出去，业务员会绕过系统用手机发，数据又回到私域。
4. 客户对话要存 24 个月，涉及欧盟客户就是 GDPR；你没有 DPA、没有删除流程、没有数据导出。

**正方（回应）**
1. "人点发送"和"机器自动发"是两件事。前者是工具，后者是自动化。LinkedIn 的条款原文要求"成员看到草稿并主动发送"，我们正好符合；Meta 也允许人工回复。真正的风险是**批量**：所以方案里明确禁止群发、禁止批量回复、禁止加粉。
2. 考核数据这条线不能靠"自觉"，要靠**代码级隔离**：转线索只写 `leads`（且幂等），`customerActivities` 的写入口径不变；加一条测试：跑完整个转线索流程后断言 `customerActivities` 数量不变。这是可验证的，不是承诺。
3. 窗口算错确实是产品死因。解法：**窗口状态由服务端算、前端只显示**；每个渠道 adapter 必须实现 `computeWindow(conv, now)` 并有单测覆盖边界（最后一条消息 +23:59、+24:01、人工窗口第 6 天/第 8 天）。发送前服务端强制校验，前端只是提示。
4. 合规不是"存了就行"：保留期 24 个月、按联系人删除、导出 JSON、审计留痕，四件事都进 P1 验收。

**落到方案的修改**
- ✅ 窗口计算抽成 `window-guard`，每个渠道必须有边界单测（新增 8 个用例）。
- ✅ 增加"**反自动化**"硬约束：无群发接口、无批量发送接口、无自动首次触达；代码评审清单里列一条。
- ✅ 增加 `customerActivities` 不变性测试（P0 验收第 8 条）。
- ✅ P1 增加数据导出/删除接口与保留期任务；文档补"客户数据处置说明"。
- ✅ 成本熔断：渠道级月度预算，超 80% 提醒、100% 停止自动重试（不停止人工发送）。

**反方仍未被说服的点**：业务员为了省事，仍会用手机直接回 WhatsApp，系统里的"首响时长"永远好看，数据是假的。→ 这是组织问题，不是技术问题；方案只能做到"系统内可追溯"，并在报表里标注"仅统计系统内回复"。如实写进限制，不粉饰。

---

### 三轮辩论后的净变化（这张表是辩论的产出）

| # | 辩前 | 辩后 | 触发轮次 |
|---|---|---|---|
| 1 | 首发 8 平台 | 首发 4 平台，其余三态标注 | 一 |
| 2 | WhatsApp 进统一收件箱 | P0 不进，只跳转；消灭双写 | 二 |
| 3 | "AI 一键回复" | 草稿制 + 服务端确认 + 禁批量 | 三 |
| 4 | 窗口规则散在业务里 | 抽 `window-guard` + 8 个边界单测 | 三 |
| 5 | 转线索"注意别写考核" | 代码隔离 + 不变性测试 | 三 |
| 6 | 公网网关"到时候再说" | P0 前置条件 + 三不约束 | 二 |
| 7 | 无成本上限 | 渠道预算 + 80/100% 熔断 | 三 |
| 8 | 能力判断散落 | `capabilities` 单一事实源 | 一 |

---

## 11. 需要你拍板的 6 件事

| # | 决策 | 选项 | 我的建议 |
|---|---|---|---|
| 1 | 首发平台 | A. Telegram+FB+IG（P0）B. 加 WhatsApp 统一收件 C. 先只做 Telegram | **A**；WhatsApp 保持现状 |
| 2 | 公网入口形态 | A. 轻量云主机/函数 + 隧道 B. 现有服务器反代 C. 不开放，轮询降级 | **A**（暴露面最小） |
| 3 | Meta 主体与审核 | A. 用公司主体做企业验证并提审 B. 先只接 Telegram，Meta 缓一缓 | **A 并行 B**（审核排队期用 Telegram 验证） |
| 4 | LinkedIn 定位 | A. 只做人工辅助 B. 不做 C. 用第三方账号型 API（付费、有封号风险） | **A**；明确告知不能自动发 |
| 5 | 月度预算上限 | A. $50 B. $100 C. 不限 | **B**，超 80% 提醒 |
| 6 | 数据保留期 | A. 24 个月 B. 12 个月 C. 永久 | **A**，到期归档 |

---

## 12. 附录

### A. 统一消息归一化字段（各平台映射）

| 统一字段 | Meta（FB/IG） | Telegram | TikTok | X |
|---|---|---|---|---|
| `external_thread_id` | `thread.id` / PSID | `chat.id` | `conversation_id` | `dm_conversation_id` |
| `external_user_id` | PSID / IGSID | `from.id` | `user_id` | `sender_id` |
| `channel_message_id` | `mid` | `message_id` | `message_id` | `dm_event_id` |
| `text` | `message.text` | `message.text` | `content.text` | `text` |
| `sent_at` | `timestamp` | `date` | `create_time` | `created_at` |
| 窗口 | 24h（人工 7d） | 无硬窗口（须先 `/start`） | 48h / 10 条 | 已同意接收 |

### B. 会话状态机

```
open ──分配──> open(assignee)
  │              │
  ├─待客户──> pending ──客户回复──> open
  ├─解决────> resolved ──客户再发──> open（新 unread）
  └─稍后────> snoozed ──到期──> open
```

规则：
- `resolved` 后客户再发消息 → 自动重开并 `unread++`，不新建会话（同一 thread）。
- `pending` 不计入"待我处理"，但计入"未关闭"。
- 状态变更全部写 `social_conversation_events`。

### C. 术语

- **窗口（window）**：平台允许自由文本回复的时间段，超时只能模板或不能发。
- **PSID/IGSID**：Meta 侧的用户标识，页面对用户唯一，跨页面不通用。
- **App Review**：Meta 对权限的审核，未过审只能对测试用户生效。
- **SLA**：这里指首响与解决时长目标，不是合同 SLA。

### D. 证据与参考（2026-10 核实）

- Meta：Messenger Platform / Instagram Messaging 权限、24h 窗口、7 天人工窗口、评论私信 7 天一次、长期 token 60 天。
- TikTok：Business Messaging API 仅回复、48h/10 条、EEA/UK/CH 不可用、评论 150 字符。
- X：2026-02-06 起按次计费（DM 读 $0.01、发 $0.015）、DM 频控 15/15min。
- LinkedIn：开放权限仅登录与发帖；Messages API 限合作伙伴且禁止自动化/定时发送。
- WhatsApp：2026-10-01 起窗口内服务消息计费、每号码 1,000 条/月免费。
- 产品参照：Chatwoot 的 Channel/Inbox/Conversation 三层模型；respond.io 的分配、SLA、CSAT 与全渠道收件箱。

---

**下一步**：你确认第 11 章的 6 项后，我出 P0 的详细任务拆解（表结构 DDL → 迁移 → 接入层 → 收件链路 → 前端视图），并按现有规范先做自检项与迁移一致性校验。
