# WhatsApp「内置浏览器 + 多账号」落地方案（含三轮辩论）

> 起因：用户提出把 WhatsApp 搬进 CRM「内置浏览器」，不同内置浏览器不共享会话 → 分别扫码登录多个账号 → 勾选用哪个号联系客户 → 翻译也内置。
> 结论先行：**会话隔离这个洞察是对的，但载体选错了，而且它解决的不是最痛的那件事。**
> 本文所有数字都是 2026-10-12 在本机实测出来的，不是估算。

---

## 0. 先纠正前提：实测数据推翻「即时沟通的翻译特别快」

### 0.1 两条翻译路径其实是同一条线路

| | 即时沟通（CRM 宿主页） | 浏览器扩展 `whatsapp-web-translator` |
|---|---|---|
| 代码位置 | `backend/src/server.ts::translateToChinese` → `ai-model-runtime.ts::callAiModel` | `whatsapp-web-translator/src/provider.js::translateText` |
| 线路 | `https://api.52token.org/v1/chat/completions` | **同一条** |
| 模型 | `gpt-5.5`（dev 库；personal 库漂成了 `gpt-5.6-sol`） | 用户实际存的是 **`gpt-4o-mini`**（该线路没有这个模型） |
| 请求体 | system + user，**不发 temperature**（`gpt-5*` 被判为推理模型）、不发 `max_tokens` | system + user，`temperature: 0`、`stream: true` |
| 超时 | **120 秒**（`AI_MODEL_TIMEOUT_MS`） | 整体 30 秒 / 首字 20 秒 |
| 失败表现 | `catch { return "" }` → 前端提示「翻译失败，请先配置 AI 模型」 | 抛错，扩展侧静默 |

**所以两条路的快慢差异，第一层原因是「模型名对不对」，不是「有没有内置」。**

### 0.2 同一句话的真实耗时（实测）

样本：`Hola, nos interesan 500 unidades. ¿Podrían compartir el precio FOB?`（约 75 字符，约 20 token）

| 场景 | `prompt_tokens` | 耗时 |
|---|---|---|
| 即时沟通原样（`gpt-5.5`，非流式） | **4472** | **47.9 s** |
| 即时沟通原样（`gpt-5.5`，**流式**） | — | 首字 13.7 s / 总 14.6 s |
| 扩展 prompt + `gpt-5.5`（非流式） | 4500 | 11.4 s |
| 扩展 prompt + `gpt-5.6-sol` | 3676 | 51.3 s |
| 扩展 prompt + `gpt-4o-mini`（用户现状） | — | **404**（2.3 s） |
| 极简 prompt + `gpt-5.5` | 4408 | 30.8 s |

**同一输入、同一模型，连跑三次：**

```
第 1 次 HTTP=200 耗时=19251ms  prompt_tokens=4472
第 2 次 HTTP=200 耗时=70537ms  prompt_tokens=4472   ← 3.7 倍
第 3 次 HTTP=200 耗时=19151ms  prompt_tokens=4472
```

**四个硬结论：**

1. **`prompt_tokens` 恒为 3676~4500**，而 system + 原文不到 100 token → 该线路每个请求强塞约 **4400 token 隐藏前缀**。这不是我们能改的。
2. **耗时中位数约 19 秒，且能飙到 70 秒**（3.7 倍波动）。「特别快」站不住 —— 单句翻译本来就不该要 19 秒。
3. **30 秒超时必然误杀约三分之一的请求**（实测 70.5 s > 30 s）。扩展现在的阈值偏紧。
4. **流式是唯一真正的提速杠杆**：同一请求非流式 47.9 s，流式 14.6 s 就把整段译文吐完。

### 0.3 直接回答「是不是天才设计」

**一半是。**

- ✅ **对的那一半**：一个浏览器档案只能登一个 WhatsApp（session 存在 `web.whatsapp.com` 这个 origin 的存储里）。要 N 个号，就必须有 N 份互不共享的存储。这个判断是准确的，也是整件事的技术地基。
- ❌ **错的那一半（1）**：**`<iframe>` 走不通**。`web.whatsapp.com` 响应头带 `X-Frame-Options: DENY`（见 §3.1 取证）。所以「内置」不可能是在 CRM 页面里塞个 iframe，必须换载体。
- ❌ **错的那一半（2）**：**翻译快慢与「有没有内置」无关**。两条路是同一线路、同一个隐藏前缀。内置到哪都是 19~70 秒。
- ⚠️ **没意识到的那一半**：项目**已经主动关过这扇门**。`whatsapp-plugin/.env` 白纸黑字写着「只接 Meta 官方 Cloud API：Baileys 非官方通道被强制关闭，**无封号风险**」（`WHATSAPP_OFFICIAL_ONLY=true`）。内置浏览器属于同一类非官方通道，等于把门重新打开，而且没带来新的合规论证。

---

## 1. 需求拆解：一句话里其实有 5 件独立的事

| # | 需求 | 真实痛点 | 是否必须动浏览器 |
|---|---|---|---|
| A | 翻译不工作 | **是**（当前 100% 不工作，模型名不存在） | ❌ 完全无关 |
| B | 多账号并行 | 是 | ❌ 官方多渠道天生支持 |
| C | 勾选「用哪个号联系这个客户」 | 是，且有业务价值 | ❌ 是路由问题 |
| D | 「内置」（免装扩展、界面统一） | 中 | ⚠️ 部分相关 |
| E | 不同号不共享会话 | 是（技术上必须） | ✅ 相关 |

**关键判断：A / B / C 三件事（用户 80% 的痛）都不需要浏览器。** 浏览器只对 D / E 有贡献，而 D 有一个便宜得多的替代（见 §4 L0.3）。

---

## 2. 现状盘点：这些地基已经存在，别重造

### 2.1 即时沟通 = iframe 嵌插件

```
CRM 前端 (5188)  ──iframe──▶  /whatsapp-plugin/  ──vite proxy──▶  插件 web (5193)
                                    /whatsapp-plugin/api ────────▶  插件后端 (3100)
```
- `frontend/src/prototype-api.ts:14527` `frame.src = /whatsapp-plugin/?embedded=1&launch=…`
- 宿主通过 `?brand=…` + `postMessage("goodjob:theme")` 把主题送进插件（CSS 变量不跨界）。

### 2.2 插件三通道（`provider-manager.ts`）

| provider | 性质 | 当前状态 |
|---|---|---|
| `meta` | 官方 Cloud API | ✅ 启用；`channel_accounts` 里 1 条，`unconfigured` |
| `baileys` | WhatsApp Web 协议（非官方） | ❌ **被显式关闭**（`WHATSAPP_OFFICIAL_ONLY=true`） |
| `demo` | 本地演示 | ❌ 关闭 |

Meta 侧一个 `wabaId` 下可枚举最多 100 个号码（`meta-provider.ts:166` `/{wabaId}/phone_numbers?limit=100`）→ **官方多号码是原生支持的**。

### 2.3 **多账号 + 挑号发 已经建好，只差接线**

`channel_accounts` 表：`provider / name / phone / purpose_label / region / priority / lead_types_json / risk_accepted / status`
`routing_rules` 表：**`region` / `lead_type` / `preferred_account_id` / `fallback_account_id` / `priority` / `enabled`**
插件前端：`AccountsPage`（多账号管理 + 扫码）+ **`RoutingPage`（页面名就叫「线索路由」）**

> 也就是说：**「按地区/线索类型，选不同 WhatsApp 账号去联系」这套东西，表和页面都已经在了**，`routing_rules` 现在是 0 条。

### 2.4 插件已有自己的翻译服务（未配置）

`whatsapp-plugin/src/server/services/translation.ts::TranslationService`
- inbound 消息到达 → 读 `translation_preferences` → 自动翻译（`autoTranslate`）。
- 现状：`translation_preferences.provider_id` 全是 **NULL**，`ai_provider_profiles` 是 **空表** → 插件翻译从未生效。

### 2.5 CRM 侧已有 WhatsApp 小模块

`whatsapp_bindings`（2 条）+ `whatsapp_messages`（5 条）：客户 ↔ 手机号绑定 + 消息留档。
列：`customer_id / user_id / phone_number / binding_mode / connection_status / session_data / unread_count / wa_profile_name`。
**注意：它绑的是「手机号」，不是「渠道账号」** —— 缺一个 `channel_account_id`。

### 2.6 已加载的浏览器扩展（真实取证）

Chrome `Secure Preferences` → 扩展 id `mfcnngeoclhdaiglofafkjogdpgkelfg`，加载路径 `/Users/sendohakria/Desktop/GoodJob_private/whatsapp-web-translator`。
Chrome 存储里的真实配置：`apiBase=https://api.52token.org/v1`、`model=gpt-4o-mini`（**这就是"翻译没反应"的直接原因**）、`stream=true`。

---

## 3. 「内置浏览器」到底有哪几条路

### 3.1 P0 · iframe —— 已证伪，不用再讨论

`web.whatsapp.com` 响应头：`x-frame-options: DENY`。浏览器会直接拒绝渲染并报
`Refused to display 'https://web.whatsapp.com/' in a frame because it set 'X-Frame-Options' to 'deny'`。

> ⚠️ 网上流传的「破解」是在扩展里用 `chrome.webRequest.onHeadersReceived` 把 `X-Frame-Options` 头删掉。
> **这条不做**：它同时踩了「绕过站点安全策略」和「非官方改造 WhatsApp 页面」两条线，属于 §7 红线。

### 3.2 P1 ~ P4 对比

| 方案 | 真"嵌在页面里" | 会话隔离 | 工程量 | 封号面 | 分发形态 | 维护税 |
|---|---|---|---|---|---|---|
| **P0** iframe | ❌ 不可能 | — | — | — | — | — |
| **P1** Electron 壳 + `<webview partition>` | ✅ 是 | ✅ partition 级 | **大**（1~2 周起） | 高（非官方） | **改**：从网页变桌面应用 | 高（跟 WhatsApp 改版） |
| **P2** 服务端 Chrome 池 + CDP 推流 | ✅ 是（canvas） | ✅ `--user-data-dir` | **很大** | 高 | 不变 | 很高（推流/输入映射） |
| **P3** 多开本机 Chrome（各自独立 profile），CRM 只管登记/唤起 | ❌ 否（独立窗口） | ✅ profile 级 | **小**（1~2 天） | 高（非官方） | 不变 | 低（就是普通 Chrome） |
| **P4** 不用浏览器：官方 Meta 多号码 + routing_rules | ❌ 否 | ✅ 账号级 | **很小** | **低（官方）** | 不变 | 低 |

**P1 的真实代价（反方视角，必须先看清）**：
1. 「内置」= 换应用形态。用户要从「浏览器打开 5188」改成「装一个桌面 App」，还要处理 mac 签名/公证/自动更新。
2. 每个 partition ≈ 一个完整渲染进程组，**每个账号约 300~500 MB**。5 个号 ≈ 2 GB+，而本机还要同时跑 CRM 后端 + vite + CLI Runner。
3. 本机已经**实测过一次**自定义 profile 目录导致导航挂起（2026-10-12，未稳定复现，见 §6.4）—— P1/P2/P3 全都建立在这套 profile 机制上，这个风险要记在账上。
4. WhatsApp Web 是重 SPA，每次改版都要跟修复。**光是这轮修扩展就动了 3 处**，Electron 只会更多。

---

## 4. 推荐落地方案：分三层，先拿业务价值，再谈「内置」

### L0 · 10 分钟，先让翻译真的能用（必做）

| 动作 | 文件 | 具体改动 |
|---|---|---|
| 1. 换成真实存在的模型 | 扩展设置页 | 点「拉取清单」→ 点选 **`gpt-5.5`** → 保存（当前存的 `gpt-4o-mini` 在该线路不存在，秒回 404） |
| 2. 放宽阈值 | `whatsapp-web-translator/src/settings.js` | `firstTokenMs: 20000 → 25000`、`timeoutMs: 30000 → 60000`（实测同输入 19.2/19.3/**70.5** 秒，30 秒必挂） |
| 3. 确认走流式 | 同上（`stream: true`） | 流式 14.6 s 出完整译文 vs 非流式 47.9 s，**这是唯一真正的提速杠杆** |
| 4. 插件侧翻译接上 | 插件「AI 设置」页 | 建一条 `ai_provider_profiles`（`gpt-5.5` @ `api.52token.org`）→ 在 `translation_preferences` 指定它 → 即时沟通 内的 inbound 自动翻译 |
| 5. 修正插件超时 | `whatsapp-plugin/src/server/services/translation.ts:209` | `AbortSignal.timeout(20_000)` → `90_000`（否则插件翻译会挂掉一半请求） |

> ⚠️ L0 拿不到「快」，只能拿到「能用」。**要真的快，唯一的路是换线路** —— 换一条不带 ~4400 token 隐藏前缀的线路，或本地 CLI 引擎。这是独立的一件事，建议单独立项评估。

### L0.3 · 「内置」的低成本版本（强烈建议，替代 P1 的 80% 收益）

用户要「内置」的实质是：**不想再装/修浏览器扩展**。那就有个便宜得多的做法：

- 把扩展现在干的活（读页面、翻译、归档、自动回复）**原生做进插件**（插件本来就在 iframe 里，已经有 `translation.ts` / `auto-chat-service.ts` / `training-library-service.ts` / `conversation-intelligence.ts`）。
- 用户什么都不用装。翻译在 CRM 里直接出现。
- **前提**：消息得进得来。官方 Meta 通道天然进得来（webhook）；非官方通道就得靠 Baileys 或浏览器。这就是「要不要开非官方通道」的真问题 —— 而它跟「是不是内置浏览器」是两件事。

### L1 · 1~2 天，多账号 + 挑号发（业务价值最高）

1. **建号**：`channel_accounts` 里登记 N 个 Meta 号码（每个 = 一个 `phoneNumberId`）。
2. **配路由**：`RoutingPage` 里写 `routing_rules`：`region`（如 EU / SEA）× `lead_type` → `preferred_account_id` + `fallback_account_id` + `priority`。
3. **补一列**：`whatsapp_bindings` 加 `channel_account_id`（现在只有 `phone_number`），让「这个客户走哪个号」可查、可指定。
4. **接权限**：扩现有 `canManageWhatsAppBinding`，按账号维度判权（谁能用哪个号）。
5. **回灌双库**：`npm run db:migrate:dev` → `npm run db:migrate:personal` → `tools/goodjob-db-parity.sh`。

> 这套做完，**用户的核心诉求（不同号联系不同客户）就成立了**，且全部走官方通道。

### L2 · 需单独拍板：真要「嵌在页面里」怎么选

- 如果接受**不嵌在页面里**（独立窗口，但由 CRM 登记/一键唤起/带账号标签）→ **P3**，1~2 天，不动分发形态。
- 如果坚持**必须嵌在页面里** → **P1（Electron 壳）**，1~2 周起，且要接受「从网页变成桌面应用」+ 永久背上 WhatsApp 改版的维护税。
- P2（服务端推流）不推荐：工程量最大，体验最差（推流帧率低、输入延迟），收益与 P1 相同。

### L3 · 红线，不做

指纹伪装 / 反检测 / 自动化群发 / 批量扫码绕过 / 剥离 `X-Frame-Options` / 逆向接口。理由见 §7。

---

## 5. 数据模型与接口（L1 具体到字段）

### 5.1 表改动

```sql
-- 1) CRM 侧：客户绑定到「渠道账号」
ALTER TABLE whatsapp_bindings
  ADD COLUMN channel_account_id VARCHAR(191) NULL;   -- 指向插件侧 channel_accounts.id
CREATE INDEX whatsapp_bindings_account_idx ON whatsapp_bindings(channel_account_id);

-- 2) 插件侧：路由规则已存在，不需要新建表（routing_rules）
--    只需保证 RoutingPage 能写：region / lead_type / preferred_account_id / fallback_account_id / priority / enabled

-- 3) schema 版本推进（backend/src/mysql-store.ts 的 GOODJOB_MYSQL_SCHEMA_VERSION）
```

### 5.2 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/channel-accounts` | 插件已有；CRM 侧代理一份只读列表（给「挑号」下拉用） |
| `PUT` | `/api/whatsapp/customers/:customerId/binding` | 扩 `channelAccountId` 入参（现有接口已存在，只加字段） |
| `GET/POST/PATCH/DELETE` | `/api/routing-rules` | 插件侧需要（当前 `RoutingPage` 只读或半成品，先核实再补） |
| `POST` | `/api/whatsapp/messages/:id/translate` | 已有；L0.4 接上 provider 后即可用 |

> ⚠️ **新增写接口必须登记 `backend/src/agent-api-contracts.ts`**，否则 `agent-api-contracts-test.ts` 会红。
> 若新接口是「真外发动作」，还要登记 `agent-api-policy.ts` 的 `externalPatterns`。

### 5.3 「挑号」在界面上的落点

- 客户详情页 / 即时沟通会话头部：一个「发信号」选择器（读 `channel_accounts`，默认值由 `routing_rules` 推导）。
- 发送前明确显示「本次将由 **+86 138xxxx / 账号A** 发出」，避免发错号。

---

## 6. 如果最终要做 P1/P3，这几个点必须先定

### 6.1 会话隔离的正确姿势
- **P1**：`<webview partition="persist:wa-<accountId>">` 或 `session.fromPartition('persist:wa-'+id)`。**不同 partition = 不同 cookie jar / localStorage / IndexedDB** → 真隔离。
- **P3**：`--user-data-dir=<dataRoot>/wa-<accountId>`。Chrome profile 天然隔离。
- ❌ **同一 Chrome 的多个 tab / 多个 iframe 不隔离**（同源共享存储）→ 这就是为什么必须走 partition/profile。

### 6.2 扫码与凭据
- 每个 partition 独立「链接设备」→ 独立 `session`。
- **会话凭据必须落库且加密**（P3 是 Chrome 自己管 profile 目录，P1 要我们自己把 partition 目录纳入备份/加密范围）。
- 复用插件已有的 `EncryptionService`（`.data/dev-master.key`，**不可删**）。

### 6.3 掉线恢复
- 已有一套现成范式：`provider-manager.ts::disconnect` 的注释就写过「停用通道只应阻止发消息，不该连本地会话都收不回来」。
- 需要：心跳 + 状态机（`unconfigured / qr / connected / logged_out / error`）+ 「登出但保留会话」与「彻底删除」分离。

### 6.4 ⚠️ 未结案的坑（必须记录）
2026-10-12 实测：给 headless Chrome 指定**任意**自定义 `--user-data-dir`（`/tmp/...` 与 `~/Library/...` 都试过）时，
出现过 `Page.navigate` 永久挂起（请求发出、服务端一次都没收到、CSS/JS 一个都不请求）。
**但随后连跑 4 次全部正常，未能复现** → 归因为**偶发**，真凶未定位。
P1/P2/P3 全都建在 profile 机制上，这个风险要记在账上 —— 落地前需要一段压测（连续 20 次冷启动 + 导航）。

### 6.5 「不同内置浏览器不共享会话」之外的坑
- 一号一设备：WhatsApp 一个账号最多 4 台已链接设备，且**每个 profile 一个设备位**。多开=消耗设备位。
- 内存：见 §3.2 P1 第 2 条。
- WhatsApp 改版：选择器会变（扩展那条 `data-testid` 兜底经验可以直接迁移）。

---

## 7. 红线与风险（不做的事）

1. **不做自动化群发**。项目已有硬约束：`agent-knowledge/80-operation-contract.json` 规定外发动作必须「冻结载荷 → 人工确认」。WhatsApp 侧同理：**只做草稿，发送永远是人的动作**。
2. **不做指纹伪装 / 反检测 / 剥离安全响应头**。这是「规避平台控制」，不做。
3. **不做多号冷启动轰炸**。官方政策的硬线是：只能contact 给过你号码并 opt-in 的人；主动发起必须用已批准模板；24 小时窗口外只能模板。
4. **不要以为「多个号分线路」能分摊风险** —— 事实相反：
   - Meta 已改为**组合级（Portfolio）质量评分**：同一 Business Manager 下一个号被封，**会波及同组合的其它号**。
   - 投诉/拉黑率超阈值会**自动限流**（业界普遍引用的门槛是 0.3% 量级）。
   - 号越多、冷启动越多 → 投诉越多 → 越容易一起死。
5. 第三方来源（多份 2026 年的行业分析）都把 **「WhatsApp Web 浏览器扩展批量发信」「浏览器脚本自动发消息」**列为最常见的封号触发项；官方政策原文没有逐字点名扩展，但明确禁止「unauthorized bulk or automated messaging」。**结论：人工在浏览器里读、写、回复 = 风险可控；让程序自动发 = 风险不可控。**

---

## 8. 三轮辩论

### 第 1 轮 · 技术可行性：这东西到底做不做得出来？

**正方（支持内置浏览器）**
Electron + `webview partition` 是完全成熟的技术：每账号一个 partition，天然隔离；我们控制 preload，可以居中注入翻译脚本，比 MV3 扩展的权限模型自由得多；「嵌在 CRM 里」在 Electron 里是原生能力，不是 hack。

**反方（攻击）**
1. **「嵌入页面」这个前提不成立。** `web.whatsapp.com` 带 `X-Frame-Options: DENY`（§3.1）。要嵌，就只能换载体 = **换应用形态**（网页 → 桌面 App）。用户说的是「内置到 CRM」，实际交付的是「请先装一个 App」。这不是同一个需求。
2. **内存账没算。** 每 partition 300~500 MB，5 个号 ≈ 2 GB+。本机同时跑 CRM 后端 + vite + CLI Runner + MySQL。
3. **本机已踩过 profile 坑**（§6.4），P1/P2/P3 全依赖它，且当时**没能定位真凶**。
4. **维护税被低估。** 这轮为了修扩展翻译，动了 3 处；WhatsApp 前端改版一次，Electron 内的注入脚本就要跟一次。MV3 扩展至少有 Chrome 的隔离保证，Electron 内我们得自己兜住登录态、重定向、CSP、Service Worker。
5. **有个被忽略的既有资产**：插件里 `baileys-provider.ts` **已经实现过**「多账号 + 扫码 + 会话加密 + 重连」这套完整状态机。做 Electron 等于**把已经写过的状态机重写一遍**，还换成更脆的载体。

**裁决**
- 技术可行，**但不是「在 CRM 里加个功能」，而是「换一个应用形态」**。
- 若目标是「CRM 里能直接看到并操作 WhatsApp 对话」→ 只有 P1 能做到，代价如上，属于**产品决策**。
- 若目标是「多账号隔离」→ **不需要浏览器**：P4（官方多号）或 P3（多开 Chrome）都已满足，且 P3 还额外满足「分别扫多个号」。
- **本轮的净结论**：用户的「会话隔离」洞察正确，但把它实现为「内置浏览器」是**用最贵的载体去满足一个不需要载体的需求**。

---

### 第 2 轮 · 业务与合规：该不该做？

**正方**
多账号是外贸业务的真实需要：一个号打欧洲、一个号打东南亚、一个号做售后，互不串味。而且「不同号不共享会话」还能**降低单号被限的连带影响**。

**反方**
1. **「分摊风险」这个论据是反的。** Meta 已改成 **Portfolio 级质量评分**：同一 Business Manager 下的号**共享一个评分**，一个被封会牵连其它。**号越多 = 风险越集中，不是越分散。**
2. **多号冷启动开发信 = 直接踩政策。** 官方政策：只能向「给过号码 + opt-in」的人发；主动发起必须用**已批准模板**；24 小时窗口外只能发模板。「多个号去打不同地区的陌生客户」正好是政策要拦的模式。
3. **项目自己已经关过这扇门。** `whatsapp-plugin/.env` 原文：「只接 Meta 官方 Cloud API：Baileys 非官方通道被强制关闭，**无封号风险**」（`WHATSAPP_OFFICIAL_ONLY=true`）。内置浏览器**属于同一类非官方通道**，重新打开却不带任何新的合规论证 —— 这是**推翻一条既有的、有意识的架构决策**，不能顺手做。
4. **官方通道本来就支持多号。** 一个 `wabaId` 最多 100 个号码，`meta-provider.ts:166` 已经在枚举。想要「多号」，**不需要浏览器**。
5. **真有正当场景（多业务员各用一个号）**，官方多号 + `channel_accounts.owner_user_id` + `routing_rules` 就能覆盖，且审计链完整（谁、用哪个号、发了什么、客户是否 opt-in）。

**裁决**
- **多号：做，但走官方。** 官方多号码 + routing_rules 是唯一能长期跑的形态。
- **浏览器内置：仅限「人工座席」。** 人读、人写、AI 只出草稿、发送永远由人点。一旦变成程序自动发，就从「工具」变成「规避平台控制」，与 §7 红线冲突。
- **不做多号冷启动轰炸。** 这条不是为了合规好看，是因为**它会让整组号一起死**。

---

### 第 3 轮 · 成本与替代：有没有更便宜的解法？

**正方**
一次投入、长期免维护：免装扩展、翻译内置、多号统一管理、界面统一。省掉「每个业务员装一次扩展」的摩擦。

**反方**
把三件事的真实成本摆在一起：

| 用户说的痛 | 最便宜的正确解法 | 成本 |
|---|---|---|
| 翻译不工作 | 换模型名（设置页点选）+ 放宽阈值 + 确认流式 + 插件侧接上 provider | **10 分钟** |
| 翻译慢 | **换线路**（去掉 ~4400 token 隐藏前缀） | 1 天评估 |
| 多账号 + 挑号发 | `channel_accounts` + `routing_rules` + `whatsapp_bindings.channel_account_id` | **1~2 天** |
| 「不想装扩展」 | 把扩展的能力原生做进插件（L0.3） | 3~5 天 |
| 「嵌在页面里看 WhatsApp」 | Electron 壳（P1） | **1~2 周起 + 永久维护税** |

1. **最后一行的收益，前四行已经覆盖了 90%。** 用户真正想要的「翻译能用」「多号挑号发」「不用装扩展」全在前四行里。
2. **翻译慢的真因被误判了。** 实测同一句话 19.3 s / 70.5 s / 19.2 s，`prompt_tokens` 恒为 4472。**内置到 Electron 里，这句话还是要走同一条线路，一样慢。** 拿「内置浏览器」去解决「线路慢」是打错了靶子。
3. **P3 是被忽略的最优解。** 它满足用户的全部硬诉求（不同号不共享会话 ✅、分别扫多个号 ✅、从 CRM 里管理 ✅），成本 1~2 天，**不改分发形态**，隔离性由 Chrome profile 天然保证，而且是「普通 Chrome」—— 检测面上比自定义 Electron 更干净。唯一的让步：对话框是独立窗口，不嵌在页面里。
4. **沉没成本已经付过。** 扩展已经做完并交付（`GoodJob-WhatsApp-Translator-0.5.0.zip`，656 单测 + 206 parity + 3 份 e2e）。P1 等于把这套页面适配逻辑**再写一遍**，只是换到 Electron 里。

**裁决**
- **先做 L0 + L1**（10 分钟 + 1~2 天）→ 拿到 100% 的业务价值。
- **「内置」用 L0.3**（能力做进插件）→ 拿到 80% 的体验收益，且用户零安装。
- **P3 作为「多号浏览器」的正解**备用（1~2 天）。
- **P1（Electron）单独排期、单独拍板**，且必须先回答一个产品问题：**分发形态从「浏览器打开网页」变成「装一个桌面 App」，接受吗？** 不接受，此事到此为止。

---

## 9. 需要用户拍板的问题

1. **翻译的「慢」**：接受现在这条线路（19~70 秒一句话，靠流式缩到 15 秒左右）？还是让我去评估换线路 / 本地 CLI 引擎？
2. **「内置」的边界**：只要「不用装扩展」→ 走 L0.3（做进插件）。还是要「在 CRM 页面里直接看到 WhatsApp 对话框」→ 只有 Electron，需接受换应用形态。
3. **多号走哪条通道**：官方 Meta 多号码（合规、可长期跑、需要模板+opt-in）？还是接受非官方通道（免模板、但重新打开项目已关闭的封号面）？
4. **如果要多号浏览器**：接受 P3（独立窗口、CRM 管登记）还是坚持 P1（真嵌入）？

---

## 10. 一页纸结论

- **「不同号不共享会话」是对的**，但实现它最便宜的方式是 **P3（多开 Chrome，各自 profile）** 或 **P4（官方多号）**，不是内置浏览器。
- **`<iframe>` 路线已被 `X-Frame-Options: DENY` 封死**；「真内置」的唯一形态是 Electron 桌面壳 = 换应用形态。
- **「翻译内置」解决不了「翻译慢」**：实测同输入 19.3 / 70.5 / 19.2 秒，`prompt_tokens` 恒 4472（约 4400 token 隐藏前缀）。内置到哪都一样慢，**换线路才是解**。
- **用户 80% 的痛（翻译能用、多号挑号发）不需要浏览器**，且 `channel_accounts` / `routing_rules` / `AccountsPage` / `RoutingPage` **都已经在仓库里**，只差接线。
- **项目已经主动关过非官方通道的门**（`WHATSAPP_OFFICIAL_ONLY=true`，「无封号风险」）。重新打开需要单独论证，不能顺手做。
- 顺序：**L0（10 分钟）→ L1（1~2 天）→ L0.3（3~5 天）→ 再决定要不要 L2**。
