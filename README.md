# ECORE GLOBAL

外贸客户关系管理系统（精简版）。从 GoodJob CRM 派生，只保留日常经营最常用的五个板块，
去掉获客、AI Agent、邮件营销、WhatsApp、知识库、考试等模块，作为独立项目维护。
界面采用纯黑单色设计系统（ECORE Theme）。

## 保留的功能

| 板块 | 内容 |
| --- | --- |
| **仪表盘** | 三张经营指标卡（累计成交额 / 在谈金额 / 待处理单据）、最近单据、销售排行、今日判断、跟进优先级队列 |
| **客户管理** | 未成交 / 已成交客户、客户全景、订单履约、客户公池、同行管理、跟进提醒 |
| **商机** | 商机管道看板、阶段推进、商机归档 |
| **供应商管理** | 全部 / 合作中 / 考察中 / 已停用 |
| **单据平台** | PI / CI / PL 等外贸单据生成、单据模板与抬头 |
| **系统基础** | 权限管理（成员 / 组织 / 角色 / 界面开通 / 成员授权 / 权限审计）、系统配置（数据库维护 / 系统日志 / 外观主题 / 系统设置 / 个人设置） |

## 界面与设计系统

全局样式集中在 `frontend/index.html` 末尾的 `<style id="ecore-theme">`，是一层追加式覆盖，
不改动原有 3 万行组件样式。设计令牌定义在 `:root`：

| 令牌 | 值 | 用途 |
| --- | --- | --- |
| `--bg` | `#080808` | 页面底板 |
| `--surface` | `#111111` | 卡片 / 面板 |
| `--surface-2` | `#181818` | 次级面、hover |
| `--line` | `#242424` | 描边、分隔线 |
| `--ink` / `--text` / `--muted` | `#f7f7f8` / `#d4d4d8` / `#8a8a90` | 三级文字 |
| `--brand` | `#ffffff` | 主强调色（单色系，用于主按钮与选中态） |
| `--green` | `#4ade80` | 正向状态（成交、已通过） |
| `--amber` | `#f5b544` | 待处理状态 |
| `--rose` | `#f26d6d` | 风险 / 驳回 |

- 主题预设精简为三套深色：`ecore`（默认）、`graphite`、`sand`；旧的浅色预设会被自动回落到 `ecore`。
- 新增视图时优先复用现有类（`.panel`、`.btn`、`.badge`、`.ec-*`），不要写死颜色值。
- 单据预览（`.doc-paper`）刻意保留白色纸张，模拟打印效果，外层用深色画布承托。


## 技术栈

- 前端：TypeScript + Vite，单页应用（`frontend/index.html` 是手写外壳，`frontend/src/prototype-api.ts` 承载视图渲染与交互）
- 后端：Node.js + Express + TypeScript，MySQL 存储
- 工作区：npm workspaces（backend / frontend / integration-worker / integration-sdk / goodjob-runner）

## 本地启动

前置：Node.js ≥ 22、MySQL ≥ 8。

```bash
# 1. 依赖（首次）
npm install

# 2. 独立数据库（一次性）：库名 ecore_crm，账号 ecore
mysql --protocol=TCP --host=127.0.0.1 --user=root -e "
CREATE DATABASE IF NOT EXISTS ecore_crm CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'ecore'@'127.0.0.1' IDENTIFIED BY '<你的密码>';
GRANT ALL PRIVILEGES ON ecore_crm.* TO 'ecore'@'127.0.0.1';"

# 3. 环境变量：复制 .env.example 为 .env.development.local 并填写
#    DATABASE_URL / JWT_SECRET / PROVIDER_CREDENTIAL_KEY 等（参考文件内注释）

# 4. 建表
npm run db:migrate:dev

# 5. 为内置账号补公司成员身份（新库必需，否则登录后提示「成员身份已失效」）
node scripts/run-with-profile.mjs development node scripts/seed-default-memberships.mjs

# 6. 启动（后端 4290 + 前端 5189）
npm run dev
```

打开 <http://127.0.0.1:5189>。内置账号（开发档位）：

| 账号 | 密码 | 角色 |
| --- | --- | --- |
| admin@goodjob.com | goodjob123 | 管理员 |
| mia@goodjob.com | goodjob123 | 业务员 |

> 账号域名沿用源项目的 `@goodjob.com`。如需统一改成自己的域名，请同步修改
> `backend/src/data.ts` 与既有库的 `users.email`（改动会影响部分测试用例）。

## 常用命令

```bash
npm run dev                 # 后端 + 前端（development 档位，连 ecore_crm）
npm run db:migrate:dev      # 数据库结构迁移（幂等）
npm run build               # 全量构建（含前端 dist）
npm run build --workspace frontend   # 只构建前端
cd frontend && npx tsc --noEmit -p tsconfig.json   # 前端类型检查
```

## 目录结构

```
backend/            Express 服务、MySQL 存储、业务模块
frontend/           index.html（外壳）+ src/prototype-api.ts（视图与交互）
integration-sdk/    集成连接器 SDK
integration-worker/ 集成任务执行器
goodjob-runner/     本地运行器（AI / CLI 相关，精简版界面未使用）
scripts/            档位包装、迁移、种子数据等脚本
docs/               历史设计文档（源自上游项目，仅供参考）
```

## 与上游 GoodJob CRM 的关系

- 本仓库是**独立副本**，不共享代码路径，也不影响原项目。
- 精简范围：删除了 50+ 个前端视图与对应导航入口；后端模块保留但不再暴露界面，
  便于后续按需恢复或二次清理。
- 已知保留的遗留：部分后端路由仍存在（如自动获客、AI、邮件营销），界面已无入口；
  数据库表结构完整保留（229 张表），便于后续裁剪数据。

## 环境变量说明

配置集中在 `.env.development.local`（已在 `.gitignore` 中排除，不要提交）。

| 变量 | 说明 |
| --- | --- |
| `DATABASE_URL` | MySQL 连接串，指向 `ecore_crm` |
| `APP_DATABASE_PROFILE` | 必须是 `development`（档位校验只认 `goodjob_crm_dev` / `ecore_crm`） |
| `PORT` | 后端端口，默认 4290 |
| `VITE_API_TARGET` | 前端代理目标，默认 `http://127.0.0.1:4290` |
| `JWT_SECRET` 等密钥 | 首次部署时自行生成；换库后需一并更新 |
| `PROSPECT_WORKER_ENABLED` | 精简版固定 `false`（无获客模块） |

## 许可证

沿用上游 Apache-2.0（见 `LICENSE`、`NOTICE`、`THIRD_PARTY_NOTICES.md`）。
