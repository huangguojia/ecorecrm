# ECORECRM 全功能体检报告

- 日期：2026-11-06
- 对象：本机运行实例（后端 `:4290`、前端 `:5189`、MySQL `ecore_crm`）
- 账号：admin / manager / sales / super_admin 四角色
- 结论：**界面层可用；数据一致性有 1 个 P0，写接口校验有 2 类 P0，另有 3 个 P1、5 个 P2**

---

## 一、测试覆盖

| 维度 | 方法 | 规模 |
|---|---|---|
| 端点存在性 | 全量 GET 探测（哨兵值 + 真实 ID 两轮） | 219 个 GET |
| 写接口健壮性 | 空 body 探测（跳过危险动作类） | 115 个写接口 |
| 业务闭环 | 按业务流程串行跑通并逐步校验 | 49 项检查 |
| 前端视图 | Chromium 真实登录后逐个切换 | 17 个视图 |
| 权限隔离 | 4 个角色 × 14 个敏感接口 | 56 次探测 |
| 前后端一致性 | 前端调用路径 vs 后端注册表交叉比对 | 155 vs 648 |

基线数据（测试前后均已核对回同值）：客户 7、供应商 3、单据 4、用户 8、待办 7。

---

## 二、P0：数据会丢 / 会自己长出来

### 1. 删除用户只删内存，数据库不删 → 重启后账号复活

`mysql-store.ts` 中 `users` 是全库唯一使用 `upsertRows` 的表，其余 88 处均用 `replaceRows`。`upsertRows` 只做 `INSERT ... ON DUPLICATE KEY UPDATE`，**从不 DELETE**。

实测：`DELETE /api/accounts/:id` 返回 `{"ok":true}`，接口列表立刻看不到该账号，但 `users` 表里记录仍在、`status='active'`。

```bash
# 复现
curl -X POST :4290/api/accounts/generate -H 'auth...' -d '{}'   # 会创建一个临时账号
curl -X DELETE :4290/api/accounts/<新id> -H 'auth...'           # 返回 ok
curl :4290/api/accounts | jq '.accounts|length'                  # 少了一个（内存已删）
mysql -e "select id,email,status from users where email like 'trial.%'"  # 仍然 active
```

后果：服务重启后，所有「已删除」的离职员工账号重新可以登录。这条同时是安全问题。

修复方向：`users` 改为 `replaceRows`，或在 `persist()` 里补 `DELETE FROM users WHERE id NOT IN (...)`。

### 2. 空请求就能写数据（缺参数校验）

以下接口用 `{}` 请求即返回 2xx 并落库：

| 接口 | 后果 |
|---|---|
| `POST /api/accounts/generate` | 生成 1 个可登录的临时账号（sales、7 天有效），未写入 `tenant_memberships`，所以在「成员管理」里看不见，形成幽灵账号 |
| `POST /api/tools/shipments` | 创建空运单（单号、客户全为空） |
| `POST /api/tools/logs` | 写入空日志 |
| `POST /api/reminders` | 创建提醒 |
| `POST /api/dashboard/priority-tasks/batch-process` | 批量生成 3 条跟进待办 |
| `POST /api/agent/customer-maintenance` | 创建客户守护策略 |

其中 `/api/accounts/generate` 最严重：**空请求即可批量造登录账号**，且该账号不出现在成员管理页（因为不写 `tenant_memberships`），只能通过 `/api/accounts/:id` 删除。

### 3. 空请求会清空已有配置

这些接口是整体覆盖语义，请求体缺字段即写入默认空值：

`PUT /api/company-profile`、`PUT /api/document-defaults`、`PUT /api/ai-engine/settings`、`PUT /api/email-tracking/config`、`PUT /api/system-settings/ocr`、`POST /api/storage/settings`

实测 `PUT /api/company-profile {}` 后返回 `companyName:""`、`website:""` 等全部清空。当前实例的公司资料本就是空的，所以没造成可见损失；若线上已有资料，一次不完整的前端请求就会抹掉。

修复方向：改为 `schema.partial()` + 只覆盖传入字段，或加 `If-Match`/版本号。

---

## 三、P1：接口报 500 / 能力缺失

### 4. 组织身份档案接口 500（真实 ID 也复现）

`GET /api/organizations/:id/identity-profile`，用 `/api/access-control/overview` 返回的真实 `organizationUnits[0].id` 调用，返回 `500 服务器处理请求失败`。

位置：`backend/src/routes/organizations.ts:125`，`organizationIdentityProfile()` 抛错后 `sendOrganizationRelationError` 未覆盖该错误类型。

当前前端未调用此接口，所以界面看不出问题，但接口本身不可用。

### 5. 5 个 GET 端点用不存在的 ID 会 500 而非 404

| 端点 | 文件:行 |
|---|---|
| `/api/agent/sales-training/:id` | routes/agent.ts:379 |
| `/api/agent/missions/:id/checkpoints` | routes/agent.ts:1245 |
| `/api/profile/email-domain-authentication` | routes/mail.ts:1488 |
| `/api/organizations/:id/identity-profile` | routes/organizations.ts:125 |
| `/api/outreach-plans/:id` | routes/outreach.ts:142 |

前三后一属隐藏模块，第二个属邮件设置。统一问题是「查不到对象后直接取属性」导致 TypeError。

### 6. 客户没有单条删除接口

`DELETE /api/customers/:id` → 404（路由不存在），只有 `POST /api/customers/bulk-delete`。前端也只提供批量删除，所以界面能用，但 REST 能力不完整，外部集成方会踩空。

---

## 四、P2：已删模块的残留

### 7. 「商机」在两处仍然露出

- **客户列表有一列「活跃商机」**，每行显示「暂无活跃商机 / 1 个活跃商机」，数据字段 `pipelineStage`、`pipelineAmount` 仍在返回体里。
- **登录页左侧文案**仍是「商机推进 / Next action」。

### 8. 单据品牌仍是 GoodJob

单据预览与导出的 PDF 顶部显示 **`GOODJO...`**（卖方 `GoodJob Trading Co., Ltd.`），而系统叫 ECORE GLOBAL。同时 `document-defaults.profile.seller` 为空——新部署若不先配公司资料，直接调 `POST /api/trade-documents` 会 400「请填写卖方公司」。

### 9. 单据类型前后端不一致

前端 `ECORE_DOC_TYPES = ["PI","PO"]`，单据页签也只有 PI/PO；但后端 `documentBodySchema.type` 与 `convert` 的白名单仍接受 9 种（PI/CI/PO/CUSTOMS/PL/CONTRACT/QUOTATION/COO/SHIPPING）。用 API 仍可创建 CUSTOMS/QUOTATION 等单据（库里现存 2 张 CUSTOMS、1 张 QUOTATION 演示数据）。

### 10. 其余

- `POST /api/files` 返回 **201**，其余创建接口返回 200（风格不一致）。
- 登录页**预填了 admin@goodjob.com 与密码**，生产环境不应保留。
- `frontend/test-results`（约 720MB）与 7 个 `index.html.bak-*` 仍在磁盘上（已加入 `.gitignore`，未删除）。

---

## 五、未配置的外部依赖

| 能力 | 状态 | 影响 |
|---|---|---|
| OCR | `provider: none` | 单据页「OCR识别」按钮无可用引擎 |
| SMTP / IMAP | `outboundEmail`/`smtpHost`/`imapHost` 全空 | 邮件收发不可用；单据「发送」只记录发送动作，不受影响 |
| AI Engine | `cliAdapter: workbuddy` | 隐藏模块，界面无入口 |

---

## 六、验证通过（可以放心用）

1. **17 个前端视图全部正常渲染**：dashboard / documents / customers / customer-pool / suppliers / access-overview / member-management / organization-structure / role-management / ui-access / member-authorization / permission-audit / database-maintenance / logs / theme / settings / profile。切换过程 **0 个 JS 错误、0 个接口 4xx/5xx**。
2. **客户闭环**：UI 新增（真实键入）→ `POST /api/customers` 200 → 提示「客户已新增」→ 列表出现 → 编辑 → 跟进记录 → 全景 → 释放公池 → 公池可见 → 认领 → 批量删除。同名重复被 409 拦截并提示归属人。
3. **供应商闭环**：创建 / 列表 / 编辑（含停用）/ 同名 409 / 批量删除。
4. **单据闭环**：创建 PI → 编辑 → 生成新版本 → 提交审批 → 审批通过 → **导出 PDF（206KB / 2 页）** → 导出 Excel → **PI 转 PO** → 历史。
5. **文件闭环**：上传 → 列表 → 元信息 → 下载 → 预览 → 回收站 → 彻底删除。
6. **待办闭环**：创建 → 列表 → 完成 → 删除。
7. **权限隔离**：sales 只看到自己的 2 条客户；改/删他人客户 404；建角色 403；IAM 七页 403。manager 与 admin 看团队全部 7 条。super_admin 访问业务数据被明确拒绝并给出文案（设计如此）。
8. **工程自检**：前后端 `tsc --noEmit` 均 0 错误；前端生产构建 4.7s；仓库根 `npm test` 全链路 EXIT 0。

---

## 七、建议修复顺序

1. `users` 表改全量替换（P0-1，一个函数改动，风险最低收益最高）
2. 给 6 个空 body 可写入的接口补必填校验（P0-2）
3. 5 个 500 改为 404（P0/P1 交界，纯错误处理）
4. 单据默认配置补卖方资料 + 换掉 GoodJob 品牌（P2-8，直接影响对外文件观感）
5. 清掉「活跃商机」列与登录页「商机推进」文案（P2-7）
6. 决定 484 个无入口端点（agent 66 / prospect-list 29 / commission 18 / mail-center 17 / orders 14 / leads 12 / deals 11 …）是关掉还是保留

---

## 八、测试数据说明

测试过程中产生的客户、供应商、单据、待办、文件、导入任务记录、临时账号均已清理，数据库回到基线：客户 7 / 供应商 3 / 单据 4 / 用户 8 / 待办 7。

一处遗留：`td_seed_pi` 在**服务内存中**仍为 `approved`（数据库已改回 `ready`）。这是审批链路测试的副作用，下次重启服务即自动同步为 `ready`，无数据损失。
