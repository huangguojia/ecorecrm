# 修复记录 · 2026-11-06

针对 `docs/FUNCTION-AUDIT-2026-11-06.md` 中的 P0 / P1 问题所做的代码修复与实测结论。
所有改动均已通过类型检查、构建与后端全量测试。

## 一、P0 修复

### 1. 删除账号只删内存，重启后复活

**原因**：`users` 是全库唯一使用 `upsertRows` 的表（其余 88 处均为 `replaceRows` 全量替换）。
`upsertRows` 只做 `INSERT ... ON DUPLICATE KEY UPDATE`，从不 `DELETE`。
`DELETE /api/accounts/:id` 之前 `store.users.splice()`，内存里消失、库里 `status='active'` 原样保留；
服务启动时 `SELECT * FROM users` 全量加载，账号随即复活，且能继续登录。

**修复**（`backend/src/routes/iam.ts`）：删除改为「停用 + 失效会话」——
`status='disabled'` 并 `authVersion++`，状态随 upsert 落库，已签发的 JWT 同时失效。
`GET /api/accounts` 只列 `status='active'`，删除后的观感与之前一致。

**实测**：删除后库中 `status=disabled`、`auth_version=2`，同账号登录返回 401，账号列表不再出现；
重启后仍为停用（不再复活）。

### 2. 空请求就能生成可登录账号

**原因**：`POST /api/accounts/generate` 的 `count` 有 `.default(1)`，`{}` 即可建出 1 个 7 天有效的
sales 账号，且**不写 `tenant_memberships`**——账号能登录、但所有接口 403「公司已暂停或成员身份已失效」，
成员管理页也看不到，形成幽灵账号。

**修复**：
- `count` 改为必填（前端本来就显式传），空 body 返回 400 并指明缺字段；
- 生成后调用 `iamManagement.syncDefaultMemberships()` 补齐成员身份与角色绑定
  （新增方法，`backend/src/iam/iam-management-service.ts`，复用 `ensureDefaultMemberships`）。

**实测**：`{}` → 400；正常生成 → `tenant_memberships` 出现 active 记录，账号可登录。

### 3. 空请求清空系统配置

**原因**：多个配置端点用 `z.string().default("")`，缺字段即写入空值，整体覆盖语义，接口仍返回 200。

**修复**：改为「未传 = 保持原值」，显式传空串才清空。

| 端点 | 文件 |
|---|---|
| `PUT /api/company-profile` | `routes/system.ts` |
| `PUT /api/document-defaults` | `routes/trade-documents.ts` |
| `PUT /api/system-settings/ocr` | `routes/system.ts` |
| `PUT /api/email-tracking/config` | `routes/mail.ts` |

（`PUT /api/ai-engine/settings` 与 `POST /api/storage/settings` 复查后本来就是合并语义，未改动。）

**实测**：先写全量再只传一个字段，其余字段保持不变；`PUT {}` 不再清空配置。

## 二、P1 修复

| 问题 | 修复 | 验证 |
|---|---|---|
| `GET /api/organizations/:id/identity-profile` 用不存在的 ID 返回 500 | 先判存在性返回 404；缓存刷新失败只告警不阻断只读请求（`routes/organizations.ts`） | 404 + `ORGANIZATION_NOT_FOUND` |
| `GET /api/profile/email-domain-authentication` 未配发件邮箱时 500 | 返回 400 与可读原因（`routes/mail.ts`） | 400「请先填写有效的发件邮箱」 |
| `GET /api/agent/sales-training/:id`、`/api/agent/missions/:id/checkpoints`、`GET /api/outreach-plans/:id` 取不到时 500 | 捕获后返回 404（`routes/agent.ts`、`routes/outreach.ts`） | 404 |
| 数据库导入/备份相关端点 500 | 现状为 503「数据库迁移尚未启用」，属明确的功能开关状态 | 503 |
| 单据卖方写死 `GoodJob Trading Co., Ltd.` | 种子数据改为 `ECORE GLOBAL`，产品品牌 `GoodJob`→`ECORE`（`backend/src/data.ts`）；库中 4 张单据同步修正；`brandMarkText` 设为 `ECORE`（原来空值会让预览右上角被截断成 `ECORE G…`） | 单据列表/PDF 显示 ECORE GLOBAL，品牌标记为 ECORE |
| `document-defaults.seller` 为空 → 新建单据 400 | 默认配置写入 `seller=ECORE GLOBAL`、`brandMarkText=ECORE`（真实地址/银行信息待业务填写） | 新建单据不再被拦 |
| 客户列表仍有「活跃商机」列、登录页仍有「商机推进」 | 列表列改为「客户阶段」（用真实 `customer.stage`）+ 金额；登录页改为「单据协同 PI / PO」；看板卡、地图侧栏、客户详情同步清理 | 见截图验证 |
| 单据历史表头「客户 / 商机」 | 改为「客户」 | — |

## 三、验证结果

| 检查 | 结果 |
|---|---|
| 后端 `tsc --noEmit` | ✅ 0 |
| 前端 `tsc --noEmit` | ✅ 0 |
| 前端结构自测 | ✅ 324 条断言 |
| 前端生产构建 | ✅ 4.8s |
| `npm test --workspace backend` | ✅ 0（3m02s） |
| 客户列表 / 登录页截图 | ✅ 渲染正常，无 JS 错误 |

## 四、数据状态

测试产生的临时账号、成员身份、角色绑定、单据改动均已清理；
`users` 回到 8 个全 active，`td_seed_pi` 恢复 `ready`，单据卖方为 `ECORE GLOBAL`。
`document-defaults` 现为：`seller=ECORE GLOBAL`、`currency=USD`、`incoterm=DAP`、`templateStyle=rose`，
其余字段为空，**地址 / 联系人 / 银行信息仍需业务填写**——这是唯一无法自动补的部分。

## 五、仍未处理（需要决策）

1. **E2E**：66 例中约 55 例选择器指向已删除模块，是校准还是归档。
2. **生成物清理**：`frontend/test-results` 720MB、7 个 `index.html.bak-*` 11MB（已 gitignore，未删除）。
3. **隐藏模块的路由未关闭**：648 个端点中约 484 个界面无入口（获客、Agent、佣金、邮件营销…），
   后台线程已停但接口仍可访问，属攻击面。
4. **`users` 表仍是 upsert 语义**：本次用「停用」绕过了删除不落库的问题；
   若将来要物理删除账号，需要在 `persistAll` 里补一次「清理不在内存中的行」并处理 120 个外键。
5. **停用账号仍出现在 IAM 成员列表**（`tenant_memberships` 未同步停用），需要成员管理页手动停用。
