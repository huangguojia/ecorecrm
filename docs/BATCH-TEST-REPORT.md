# ECORECRM 批量测试报告

执行时间：2026-11-05 08:54 – 09:55（GMT+8）
执行范围：前端自测、前端集成、后端全量注册套件、16 个未注册测试、
端到端闭环脚本、Playwright E2E（64 例）、三档账号逐页 UI 扫描、数据库完整性。

---

## 一、总览

| # | 套件 | 规模 | 结果 |
| --- | --- | --- | --- |
| 1 | 前端结构自测 `frontend/src/self-test.ts` | 155 项断言 | **全通过** |
| 2 | 前端集成 `integration-api-test.ts` | — | **通过** |
| 3 | 后端 `npm test`（test + pretest 链） | 61 个用例文件 | **EXIT 0** |
| 4 | 后端未注册测试补跑 | 16 个文件 | **15 通过 / 1 失败** |
| 5 | 端到端闭环 `scripts/e2e-closed-loop.sh` | 35 项 | **35 PASS / 0 FAIL** |
| 6 | `@goodjob/integration-connector-sdk` | — | **通过** |
| 7 | `@goodjob/local-runner` | — | **通过** |
| 8 | `integration-worker` | 13 个文件 | **9 通过 / 4 崩溃** |
| 9 | Playwright E2E `crm.spec.ts` | 53 例 | **5 通过 / 48 失败** |
| 10 | Playwright E2E 其余 4 个 spec | 11 例 | **4 通过 / 7 失败** |
| 11 | 三档账号逐页 UI 扫描 | 25 / 20 / 15 个可见视图 | **0 控制台报错、0 白屏** |
| 12 | 数据库完整性 | 6 张主表 + 5 组外键 | **0 孤儿** |

结论：**业务代码本身是绿的，红的是测试资产与依赖版本**。E2E 的 48 个失败没有一个是产品缺陷，
全部是精简前 GoodJob 的选择器/文案在 ECORE 里已不存在。

---

## 二、必须处理

### 1. 根 `npm test` 必红：`integration-worker` 的 4 个用例崩在 zod 版本

```
ProtocolError: Schema appears to be from zod 3, which the SDK cannot convert to JSON Schema.
Upgrade to zod >=4.2.0, or wrap your JSON Schema with fromJsonSchema().
```

- `integration-worker/package.json` 把 `@modelcontextprotocol/{client,server,node}` 钉在 **2.0.0**，
  该版本要求 **zod >= 4.2.0**；
- 仓库实际安装 `zod@3.25.76`（根 `package.json` 的 `^3.23.8` 与 backend 共用）；
- 受影响用例：`native-mcp-client-test`、`connector-driver-compliance-test`、
  `connector-failure-boundaries-test`、`integration-execution-test`（13 个里 4 个）；
- 后果：任何人在根目录跑 `npm test` 都会失败，且失败点与 CRM 业务无关。

三条路：给 worker 单独装 zod 4（改 import 面）、把 MCP SDK 降到兼容 zod 3 的大版本、
或在根的 `test` 链里暂时排除 `integration-worker` 并记录技术债。**未擅自改动**，等决策。

### 2. Playwright E2E 已整体失效，需要决定去留

`crm.spec.ts` 53 例：5 通过、48 失败；其余 4 个 spec 11 例：4 通过、7 失败。
失败原因分布（48 例）：

| 类型 | 数量 | 说明 |
| --- | --- | --- |
| 元素找不到 | 43 | 指向精简时删掉的模块：`leads` / `lead-finder` / `prospect-list` /
`prospect-verification` / `knowledge` / `exam` / `competitors` / `case-studies` /
`problems` / `memo` / `commission` / `executive-report`，以及旧按钮文案（如「新增待办」） |
| 断言不符 | 3 | 待办排序/置顶、客户工作队列抽屉 —— 同为旧 UI 结构 |
| 超时 | 2 | 流程走不到终点，根因同上 |

不是超时误判：把 6 个非元素类失败用配置默认 30s 重跑，仍 5 个失败，只有「单据工作室导出 PDF」恢复。

建议：保留 `pipeline` / `documents` 这类仍在的模块用例并逐个校准选择器，其余直接删除；
或者整份归档、按现有 22 个视图重写。**这是取舍题，未动代码。**

### 3. `frontend/test-results` 累积 764MB / 8369 个文件

- 已被 `.gitignore` 忽略，不进仓库，但会拖慢清理、并且在批量删除时被安全钩子拦下
  （本次 E2E 首次运行就是因为这个直接 EXIT=1）；
- 建议清空一次，并把 E2E 输出目录指到仓库外（本次用 `--output=/tmp/...` 绕开）。

---

## 三、已修

### 4. `logs`（系统日志）对无审计权限的账号可见但接口 403

三档账号扫描发现：`alex` / `mia` 侧栏能看到「系统日志」，点进去发
`GET /api/tools/logs` → **403**，控制台留下一条报错，页面显示「日志加载失败：当前账号没有操作审计查看权限」。

根因：`viewPermissionRequirements` 里有 `permission-audit: "audit.read"`，但漏了 `logs`，
而后端 `/api/tools/logs` 正是校验 `audit.read`。

修复：`frontend/src/prototype-api.ts` 映射表补 `logs: "audit.read"`。
验证：管理员可见 25 项（含日志）、销售主管 20 项、业务员 15 项，三者控制台报错均为 0；
前端自测 155 项、`tsc -b`、`vite build` 全通过。

### 5. Playwright 启动超时 20s 小于后端真实启动时间

实测内存态后端冷启动到 `/api/health` 返回 200 需要 **22s**，而 `webServer.timeout` 是 20s，
所以只要没预启动服务，E2E 一定在「等待 webServer」阶段就失败。
已把两个 webServer 的 `timeout` 提到 `60_000`。

### 6. E2E 需要绕过本机代理

环境里 `HTTP_PROXY/HTTPS_PROXY=http://127.0.0.1:64180`，Playwright 探测
`http://127.0.0.1:5288/` 时走代理拿到 **502**，据此判定「端口已被占用」并退出。
本地跑 E2E 必须带 `NO_PROXY=127.0.0.1,localhost`。

---

## 四、需要留意

### 7. `npm test` 只覆盖 158 个测试文件里的 61 个

- 后端共 **158** 个 `*test*.ts`；
- 被某个 npm script 引用：142 个；
- 但 `npm test` 实际串起来的只有 **61 个**（`pretest` 5 + `test` 56），
  其余散落在 `test:xxx` 单点脚本里，靠人记得才会跑；
- 完全没人引用的有 16 个，本次补跑：15 通过，1 失败——
  `wecom-command-http-test.ts` 在内存态存储下登录 `shirley@goodjob.com` 返回 **401**
  （MySQL 态下同一账号返回 200，说明是种子数据差异，不是鉴权回归）。

### 8. 数据库基线（本轮结束时）

`customers 5 / deals 5 / trade_documents 4 / suppliers 3 / todos 7 / orders 0`，
`deals→customers`、`orders→customers`、`orders→deals`、`trade_documents→deals`、
`tenant_memberships→users` 五组外键 **全部 0 孤儿**。共 231 张表。

### 9. 一处文案不一致（低优先）

`index.html` 静态标题是「ECORE GLOBAL · 外贸客户关系管理」，
`prototype-api.ts:57033` 启动后会改写为「ECORE GLOBAL 1.0.0 · 外贸客户管理系统」。

### 10. 仍未提交

13 项改动（`backend/src/iam/iam-management-service.ts`、`backend/src/server.ts`、
`frontend/index.html`、`frontend/src/prototype-api.ts`、`frontend/src/self-test.ts`、
`frontend/playwright.config.ts`、`package.json`，以及 `docs/`、`scripts/e2e-closed-loop.sh` 等新文件）。
另有两项历史挂起未决：7 个 `index.html.bak-*`（约 11MB）、公开仓库里 29 个文件写死本机路径。

---

## 五、可复跑命令

```bash
# 前端
cd frontend && npx tsx src/self-test.ts
cd frontend && npx tsx src/integrations/integration-api-test.ts

# 后端
npm test --workspace backend

# 端到端（需 4290 后端在跑）
bash scripts/e2e-closed-loop.sh

# E2E（必须先起 4288 内存后端 + 5288 前端，或让 config 自启）
cd frontend && NO_PROXY=127.0.0.1,localhost E2E_REUSE=1 \
  npx playwright test --project=chromium --output=/tmp/pw-out
```
