# 训练上报通道设计（扩展归档 → 插件训练库）

状态：设计定稿 2026-10-12，随实现落地。
关联：`whatsapp-web-translator/src/agent.js` / `src/trainer.js` / `src/crm.js`；`whatsapp-plugin` training 系列。

## 1. 背景与缺口（已核实）

- 扩展「归档并学习」目前只做三件事：抓会话 → **下载 jsonl 文件** → 本地存语料/档案（`agent.js::archiveAndLearn`）。
- 插件侧训练库/训练档案齐全（`training_profiles`、`training_library_entries`、`POST /api/v1/training/profiles`、`/training/library/import`），但 `train()` **只吃插件库里的会话**（Meta 官方通道进的对话）。
- 结论：浏览器 WhatsApp Web 上的会话语料**没有进插件的通道**，用户只能手动拿导出的文件想办法 —— 这就是缺口。
- 扩展的 `buildProfileFromCorpus()` 产物（name/tone/summary/guidelines/signaturePhrases/guardrails/languages/examples/stats）与插件 `training_profiles` 表字段**几乎一一对应**，缺的只是一个接收口。

## 2. 目标

在扩展 agent 面板增加「推送到 CRM」：把本地训练档案一键推到插件，落成训练档案 + 问答样本进训练库；同一条语料推多少次都只落一份（幂等）。

## 3. 接口设计

### 3.1 插件新增：`POST /api/v1/training/profiles/import`

- 鉴权：`requireCrmAuth`（与现有训练接口一致），`ownerUserId` 一律取 JWT 身份，**不信 body**。
- 请求体（zod 校验 + 上限）：

```ts
{
  name: string,                 // 1..120
  tone?: string,                // ≤80
  summary?: string,             // ≤1200
  guidelines?: string[],        // ≤12 条，每条 ≤300
  signaturePhrases?: string[],  // ≤12 条，每条 ≤120
  guardrails?: string[],        // ≤12 条，每条 ≤300
  languages?: string[],         // ≤8
  examples: Array<{             // ≤200 组；inbound/reply 各 ≤2000 字符
    inbound: string, reply: string,
    occurredAt?: string, conversationId?: string, score?: number
  }>,
  stats?: { conversations?: number, messages?: number, exchanges?: number, samples?: number },
  source?: { from?: string|null, to?: string|null }
}
```

- 语义：**upsert**。按 `ownerUserId + engine='web-import' + name` 找既有档案：
  - 找到 → 用本次内容覆盖更新（`trained_at` 刷新），返回 200；
  - 没找到 → 新建，`engine='web-import'`，`account_id=NULL`，返回 201。
  - 幂等判断看「同内容不重复建档」：内容指纹（name+examples 数+stats 摘要）一致时直接返回既有档案，不动库。
- 落库后**顺路进训练库**：把 examples 转成 `qa` 条目（question=inbound、answer=reply），复用 `training-library-service` 的 fingerprint 去重逻辑；profile 自带 guardrails 转成 `policy` 条目。响应带 `library: { created, skipped }`。
- 审计：`training.profile.imported`。
- **不做**：不碰 `auto_chat_settings` 的 profile 绑定（用户在界面自己选）；不做向量/嵌入。

### 3.2 扩展侧

- `crm.js` 新增 `importTrainingProfile(settings, session, payload)`：`POST {base}/api/v1/training/profiles/import`，带 `Authorization: Bearer <crm JWT>`；401 时返回明确的「登录已过期」。
- `agent.js`：`archiveAndLearn` 完成本地学习后，若已登录 CRM（`readSessionState` 有效），面板出现「推送到 CRM」按钮；点击后把 `state.profile` 映射成上面的请求体推送，成功/失败写 `state.note`（含 created/skipped 数字）。**推送失败绝不影响本地学习结果。**
- 边界不变：推送的只是语料档案，**不是消息**；「永不代发」不受影响。

## 4. 验收标准（先红后绿）

1. 插件单测（training-library.test.ts 侧新增）：
   - 推送新档案 → 201 + 训练库 created>0；同内容再推 → 200 + skipped=库内条数、不新增行；
   - 改一条 example 再推 → 200 + 档案被更新（trained_at 变化、qa 新增）；
   - 未登录（无 JWT）→ 401；超限（examples 201 条）→ 422。
2. 扩展单测（crm.test.mjs）：断言**实际发出的请求 URL** 是 `/api/v1/training/profiles/import`（挂在 `settings.crm` 层级下，防「读错层级静默回环」老坑）、Bearer 头带 JWT。
3. e2e（agent）：点推送按钮 → mock 服务收到请求体、note 显示「已推送」。

## 5. 明确不做 / 后续

- 不做扩展会话原文全量上送（只送提炼后的档案与问答样本，体量小、隐私面小）。
- 不做定时自动推送（第一版手动按钮；自动化等用户用起来再说）。
- CRM 侧 `whatsapp_bindings` 关联不动（那是渠道绑定，不是训练）。
