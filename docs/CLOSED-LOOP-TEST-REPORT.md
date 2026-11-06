# ECORE GLOBAL · 闭环测试报告

**日期**：2026-11-05
**范围**：ECORECRM 精简版（保留 系统基础 / 客户管理 / 商机 / 供应商管理 / 单据平台 / 仪表盘）
**环境**：macOS · Node + tsx · MySQL `ecore_crm` · 后端 `127.0.0.1:4290` · 前端 `127.0.0.1:5189` · Chrome headless
**结论**：**通过**。业务主链、单据全生命周期、订单状态机、权限边界、级联一致性均符合契约；测试期间发现并修复 5 处缺陷。

---

## 一、总体结果

| 层级 | 内容 | 结果 |
| --- | --- | --- |
| 前端自测 | `frontend/src/self-test.ts`（结构 / 文案 / 主题 / 权限映射） | **155 项全通过** |
| 前端集成契约 | `integration-api-test` | 通过 |
| 后端测试套件 | `npm run test --workspace backend`（60+ 测试文件） | **EXIT 0 全通过** |
| 端到端业务闭环 | `scripts/e2e-closed-loop.sh` | **35 项全通过** |
| 逐页验收 | 20 个导航视图逐个渲染 | **20/20 通过**，0 运行时报错 |
| 视觉对比度 | 20 视图全站扫描（背景可判定项） | **0 处低对比**（阈值 3:1） |
| 构建 | frontend（vite）+ backend（tsc） | 均成功 |
| 数据一致性 | 测试后数据库 | **零孤儿记录**，基线复原 |

基线（测试前后一致）：`customers 5 / deals 5 / suppliers 3 / orders 0 / trade_documents 4 / todos 7 / reminders 3`。

---

## 二、端到端业务闭环（35 项）

### 1. 客户与商机
- 新建客户成功，返回 `customer.id`
- 同国家 + 同公司名重复创建 → **409** `CUSTOMER_DUPLICATE`，并回传 `existingId`
- 新建商机成功（客户/产品/数量/单价/下一步动作齐备）

### 2. 商机阶段机
- 跨阶段跳级（询盘 → 谈判）→ **400**，只允许相邻推进
- 进入「已报价」及之后阶段缺 `expectedCloseAt` → **400**
- 逐级推进 询盘 → 已联系 → 已报价 → 样品 → 谈判 → 成交，每步返回的 `stage` 与请求一致
- 成交后再次推进 → **400**（不可重复成交）

### 3. 成交自动建单
- 成交即生成订单：`source=deal_auto`，单号 `GJ-SO-2611-NNNN`
- 金额按明细重算：10 × 4200 = **42000**，与商机金额一致

### 4. 单据全生命周期
- 创建（必填 `title/number/issueDate/seller/items`）成功；缺 `number` → **400**
- `PI → CI` 转换成功，生成**独立**单据（源单据不被覆盖）
- 提交审批 → 审批通过 均返回 2xx
- 已审批单据原地 `PATCH` → **409**（必须走新版本）
- 生成修订版本成功（新 `id`，`revision` 递增）
- 已审批单据导出成功

### 5. 订单状态机
- 缺 `incoterm` / `paymentTerm` 时确认 → **400**「确认前必须补全 Incoterm 与付款条件」
- 手工建单（条款齐全 + `productionRequired`）成功
- `pending → confirmed → in_production` 正常
- 未标记需生产时进入生产中 → **400**
- `shipped` 手工设置 → **400**（只能由发货单回写）
- 重复推进到当前状态 → **409**
- 回退缺 `reason` → **400**；带原因可回退
- 履约备注追加成功（201）

### 6. 权限边界
- 无 token → **401**；伪造 token → **401**；错误密码 → **401**

### 7. 级联一致性
删除客户后，其商机、订单、贸易单据、客户活动**全部清除**，无孤儿。

---

## 三、发现并修复的缺陷

### 缺陷 1（数据一致性，后端）客户删除不级联订单与贸易单据
`POST /api/customers/bulk-delete` 的契约写明「连带清理关联数据」，但实现只清理了客户、活动、情报建议、商机、商机事件和相关待办，**订单与贸易单据被留下**。删客户后列表里会出现「客户已不存在」的订单与单据，金额还会进入统计口径。

实测：删除 1 个客户后残留 **2 条订单 + 7 张单据**。

修复（`backend/src/server.ts`）：同时按 `customerId` / `dealId` 清理 `orders`、`orderEvents`、`tradeDocuments`。
验证：修复后同一操作残留 **0**；数据库孤儿订单 0、孤儿单据 0。

### 缺陷 2（可读性，前端）报关单预览抬头白字压在浅灰上
抬头 `.customs-hero` 原本是「品牌渐变 + 白字」。深色换肤把渐变抹平后，底色变成浅灰 `#f1f5f9`，而副标题仍是 90% 白 → 对比度 **1.1:1**，几乎看不见。

修复：在纸张作用域内固定品牌青渐变 + 白字（`.doc-paper .customs-hero`）。

### 缺陷 3（可读性，前端）报关单商品表头深底配深字
表头行背景取模板主色（Executive 模板 = `#1e293b`），但文字色沿用 CSS 的 `var(--ink)`（浅色主题下是 `#10211f`）→ 对比度 **1.14:1**，表头完全读不出。该问题在移植前的 GoodJob 即存在。

修复：表头行随背景一并指定白色文字（`prototype-api.ts` 打印模板）。

### 缺陷 4（可读性，前端）客户地图版权署名不可读
署名用浅色主题的深青灰 `rgba(55,82,95,.66)`，压在深色地图上（**1.94:1**）。

修复：深色下改用 `rgba(255,255,255,.55)`。

### 缺陷 5（控制台噪声，前端）更新配置接口在未登录/非平台角色时被无条件调用
`initSystemUpdate()` 在模块加载阶段就请求 `/api/admin/updates/config`：未登录返回 401，公司管理员返回 403，浏览器控制台每次都留下两条报错，也让逐页验收的「零报错」无法达成。

修复：事件只绑定一次；仅在**已登录且具备平台运维权限**时才发起配置请求，登录成功后补一次。现 20 个视图控制台报错 **0**。

### 附带清理
- 移除知识库训练模块遗留的两个孤儿弹窗（`#kbProbeModal` / 无引用的死代码）
- `refreshAll` 增加渲染容错：某个已删除模块的渲染函数抛错，不再弹「需要处理」红色提示条
- 打印样式与单据纸张恢复浅色令牌，保证「白纸黑字」不被深色主题污染

---

## 四、复跑方式

```bash
# 端到端业务闭环（自清理，测试后数据自动删除）
npm run test:e2e:api

# 前端自测 + 集成契约
npm test --workspace frontend

# 后端全套
npm run test --workspace backend

# 构建
npm run build --workspace frontend && npm run build --workspace backend
```

前置：MySQL `ecore_crm` 可连、后端 `:4290` 已启动、前端 `:5189` 已启动、可用账号 `admin@goodjob.com / goodjob123`。

---

## 五、覆盖边界与未覆盖项

- 逐页验收使用**公司管理员**账号，平台运维专属视图（`platform-operations`）与运维账号能力未覆盖。
- 已移除模块（邮件中心、文件中心、知识库训练、搜客雷达、AI 研究、WhatsApp 等）不作为功能项测试，仅做「入口不得复现」的回归断言。
- 未做：并发/压力测试、跨浏览器（仅 Chrome headless）、真实邮件与 WhatsApp 外发、第三方集成真实回执。
- 供应商、客户、商机、单据、订单均覆盖了正常流转与主要异常分支；审批链的多级会签、单据水印/印章等可选配置未逐项验证。

---

## 六、权限模型：谁能管由「能力位」决定（本轮变更）

原实现把「管理成员和权限」写成了身份判断（`role === "admin" | "super_admin"`），前端 `canAccessWorkspaceView`、导航分组 `data-admin-only`、后端 overview 与 IAM 写接口四处都做了硬拦截。结果是：即使把 `member.manage` / `role.manage` 授予某个岗位，该岗位也进不去、改不了——授权形同虚设。

现统一为**能力位驱动**（能力位即 IAM 角色授权快照里的 `permissions[code]`）：

| 层次 | 判定 | 说明 |
| --- | --- | --- |
| 进入权限页面 | `member.read` / `org.read` / `role.read` / `permission.assign` / `audit.read` | 不再校验 admin 身份；导航分组按组内入口是否有可见项自动收起 |
| 成员增删改、停用 | `member.manage`（服务端 `assertTenantOperator`） | 与账号管理、账号有效期同一把钥匙 |
| 角色增删改 | `role.manage` | 前端对无此能力的账号隐藏「新增 / 复制 / 停用」 |
| 改角色权限、开通模块、临时授权 | `permission.assign` | 无此能力时角色页下拉与模块开关为只读 |
| 组织架构 | `org.manage` / `org.read` | — |
| 审计 | `audit.read` | — |

管理员不受影响：`公司管理员` 角色本身持有全部能力位（74 项）。改动点：

- `backend/src/iam/iam-management-service.ts`：`getOverview` / `listAudit` 去掉 admin 身份判断，保留 `assertTenantOperator`
- `backend/src/server.ts`：`/api/access-control/overview` 与 `sendIamMutation` 去掉身份闸门，写操作交给 IAM 服务按能力位判定
- `frontend/src/prototype-api.ts`：`canAccessWorkspaceView` 改为能力位判定（快照未就绪时乐观放行，加载完成后再收紧，避免登录瞬间把 dashboard 也挡掉并弹红条）；账号管理改判 `member.manage`；新增 `canAssignPermissions()` 控制授权类按钮/下拉只读
- `frontend/index.html`：`权限管理` 导航分组去掉 `data-admin-only hidden`，改为跟随组内入口显隐

### 数据变更（可直接在「角色管理」里调整或撤销）

给 `销售主管` 角色补了 4 项能力（tenant 范围）：`member.read`、`member.manage`、`org.read`、`role.read`。未授予 `role.manage` / `permission.assign` / `audit.read`。

### 三种账号实测

| 检查项 | 公司管理员 | 销售主管 | 业务员 |
| --- | --- | --- | --- |
| 权限管理分组 | 7 项全显示 | 5 项（总览 / 成员 / 组织 / 角色 / 界面） | 分组整体隐藏 |
| 页头标识 | 管理员可管理 | 已授权角色可管理 | — |
| 成员管理「新增成员」 | 可用 | 可用 | 不可进 |
| 角色管理「新增 / 复制 / 发布权限」 | 可用 | 隐藏 | 不可进 |
| 角色权限下拉 | 可编辑 | 74 项全部只读 | 不可进 |
| 界面开通「开通 / 关闭模块」 | 可用 | 隐藏 | 不可进 |
| 成员授权 / 权限审计 | 可进 | 403（无 `permission.assign` / `audit.read`） | 不可进 |

接口层实测（销售主管 token）：`PATCH /api/v1/members/:id` 停用/恢复 **200**；`POST /api/v1/roles` **403**；`PUT /api/v1/members/:id/role-assignments` **403**。控制台报错 0。

### 已知边界

- IAM 写操作目前只校验「能力位 + 同公司」，**未按组织子树收敛**：授予 `org_subtree` 范围的主管，实际可管理公司内全部成员。本轮把主管的 4 项能力设为 `tenant` 范围以保持与实现一致；若要做「只管本组」，需在 `mutate` 里补组织子树校验，属后续增强。
