# WorkBuddy CLI 自动配置指南（GoodJob CRM 本地 Runner）

> ⚠️ **本文已并入总入口文档 [`docs/CRM-WORKBUDDY-CLI-INTEGRATION.md`](./CRM-WORKBUDDY-CLI-INTEGRATION.md)**（覆盖「有源码」与「无源码」两条路线，并修正了本文中关于 CLI 工作目录的一处错误描述）。需要分步细节时仍可参考本文。
>
> 版本：1.0（2026-10-06） ｜ 适用：GoodJob CRM 1.8.4+ ｜ 面向：第一次在本机配置 WorkBuddy CLI 执行通道的人
> 目标：让 CRM 的 AI 闭环任务（获客搜索 / 客户背调 / 开发信撰写）由本机 WorkBuddy CLI 执行。
> 全程约 15 分钟，只需终端与浏览器，无需修改任何代码。

---

## 0. 架构一句话

```
CRM 后端 ──派任务──▶ 本机 Runner（goodjob-runner）──spawn──▶ WorkBuddy CLI（codebuddy）──▶ 云端大模型
        ◀──配对码/心跳/结果回传──
```

Runner 由本机**主动**连 CRM（不开端口、不收任意 Shell 命令），CLI 的登录态、环境隔离、
skill 加载全部由 Runner 自动处理，你要做的只有：装 CLI → 登录 → 装 Runner → 配对 → 启动。

---

## 1. 前置要求

| 项目 | 要求 |
| --- | --- |
| 操作系统 | macOS（Linux 同理，路径细节略有差异） |
| Node.js | ≥ 20（Runner 与 CLI 都基于 Node） |
| CRM 访问 | 能打开 CRM 网页，且账号有「集成中心」权限 |
| 项目目录 | 已 checkout 的 GoodJob 仓库（Runner 授权的工作区，下面用 `<工作区>` 代指） |

---

## 2. 安装 WorkBuddy CLI（独立版，必须）

```bash
npm install -g @tencent-ai/codebuddy-code
codebuddy --version    # 预期输出 2.161.x 或更新
```

> ⚠️ **必须用 npm 独立安装版**。macOS 上 WorkBuddy 桌面 App 自带一份内置 CLI
> （`/Applications/WorkBuddy.app/.../cli/bin/codebuddy`），但它是 headless-only、
> **无法 `/login`**——Runner 会自动优先选独立版、把桌面内置版只当兜底，请勿依赖它。

## 3. 登录 CLI（一次即可）

在**普通终端**（不是 WorkBuddy 桌面 App 内嵌终端）执行：

```bash
codebuddy /login
```

按提示完成认证。登录态写入默认配置目录 `~/.codebuddy/`，Runner 以后每次执行任务都会自动使用它。

> ⚠️ 如果在 WorkBuddy 桌面端内嵌终端里执行，宿主会注入 `CODEBUDDY_CONFIG_DIR` 等
> 环境变量，登录态会写错位置。**用系统自带 Terminal / iTerm 即可。**

## 4. 安装本地 Runner

在仓库的 `goodjob-runner/` 目录下：

```bash
cd <工作区>/goodjob-runner
npm install
npm run build --workspace @goodjob/local-runner
npm link --workspace @goodjob/local-runner
```

`npm link` 之后系统里就有了 `goodjob-runner` 命令。

## 5. 配对（把本机 Runner 注册到 CRM）

1. 打开 CRM 网页 → **集成中心 → 本地 Runner → 添加 Runner**，得到一次性配对码（形如 `GJ-XXXX-XXXX-XXXX`）。
2. 回到终端执行（工作区给绝对路径，可给多个）：

```bash
goodjob-runner pair \
  --server https://你的CRM地址 \
  --code GJ-XXXX-XXXX-XXXX \
  --workspace /absolute/path/to/GoodJob_private
```

成功后会打印：配对名、授权目录、配置文件位置（`~/.goodjob/runner.json`，权限 0600）。

> ⚠️ **工作区里必须有 `.workbuddy/skills/`**：四个领域技能包
> （获客 / 背调 / 招标日报 / 开发信）放在这个目录下，Runner 启动 CLI 时把它注入技能扫描路径。
> 技能包**不在代码仓库里**（独立成品包 `GoodJob-CLI-Skills-*.zip`，解压后跑 `install-skills.sh <工作区>` 装进来），
> 所以「新克隆一份代码」并不自带技能——必须单独装。工作区不对或没装技能则技能不加载，
> 任务仍能跑，但质量口径静默降档。

## 6. 自检并启动

```bash
goodjob-runner doctor   # 自检：应看到 WorkBuddy CLI 版本 + 执行文件路径 + 连接正常
goodjob-runner start    # 常驻运行，等待任务（Ctrl+C 退出）
```

`doctor` 重点看三行：

```
WorkBuddy CLI：2.161.x            ← 检测到独立版
WorkBuddy CLI 执行文件：/opt/homebrew/bin/codebuddy   ← 不是 /Applications/WorkBuddy.app/... 
连接：正常
```

建议用 `nohup goodjob-runner start &` 或 launchd/pm2 把它挂成常驻进程。

---

## 7. Runner 自动处理的事（无需手动配置）

| 事项 | 说明 |
| --- | --- |
| **环境变量隔离** | Runner 启动 CLI 子进程时自动剥离宿主注入的 `CODEBUDDY_CONFIG_DIR` / `WORKBUDDY_PAC_RPC_SOCKET` / `SERVER__*` / 本机代理等十余个变量。这些变量任何一个泄漏进 CLI 都会导致认证失败或代理死等——这就是不要手动替代 Runner 直接跑 CLI 的原因 |
| **CLI 二进制选择** | 优先级：`GOODJOB_WORKBUDDY_BIN` 环境变量 > PATH 里的独立版 > 桌面内置版（兜底）。装好独立版后无需设置 |
| **项目级 skill** | **四个**领域技能（`goodjob-lead-acquisition` 获客 / `goodjob-company-research` 背调 / `goodjob-tender-daily` 招标日报 / `goodjob-outreach-email` 开发信）放在工作区的 `.workbuddy/skills/`。**技能包不进代码仓库**，来自独立成品包（`install-skills.sh` 一键安装）。CLI 默认**不扫**这个目录（它只认 `<cwd>/.codebuddy/skills/`），由 Runner 启动时通过 `CODEBUDDY_SESSION_SKILL_DIRS` 注入 |
| **任务级点名加载** | 四个引擎任务（获客/背调/日报/开发信）的提示词首部由 CRM 自动写入「先加载 Skill `<技能名>`」（`ai-engine-prompts.ts::engineSkillDirective`），不依赖模型自己判断要不要用技能。技能缺失时任务照常继续，不会失败 |
| **能力上报** | Runner 心跳自动上报 CLI 版本与能力，CRM 集成中心据此显示 Runner 在线状态 |

## 8. 验证（两条，各 1 分钟）

1. **Skill 发现探针**（走 CRM 集成中心 → 本地 Runner → 新建任务，adapter 选 WorkBuddy，
   工作区选仓库根，提示词如下）：

   ```
   Do NOT use any file tool. From your registered skill list only, report each as
   AVAILABLE or MISSING: goodjob-lead-acquisition, goodjob-company-research,
   goodjob-tender-daily, goodjob-outreach-email.
   ```

   预期四个全部 `AVAILABLE`。
   （注意：① 让模型"列出全部 skill"它只会回一部分，**必须用精确探针验证**；
   ② 必须禁用 Read/Glob/Grep 等文件工具，否则模型会用 Glob 直接在磁盘上找到文件、
   假装"技能已注册"——磁盘上有文件 ≠ CLI 注册了技能。）

2. **真实业务任务**：CRM 里对任一客户点「AI 背调」，任务详情中 engine 应显示
   `WorkBuddy CLI 2.161.x` 且状态成功。

## 9. 故障排查

| 症状 | 原因 | 处理 |
| --- | --- | --- |
| 任务失败，报 `Authentication required` | CLI 未登录，或登录态写错了配置目录（桌面端内嵌终端登录） | 在系统终端重跑 `codebuddy /login`；确认 `~/.codebuddy/` 存在且有内容 |
| 报 `400 connect ENOENT workbuddy-pac-*.sock` | 老版本 Runner 未剥离桌面端 PAC 代理变量，且桌面 App 重启过 | 升级 Runner 到含 `WORKBUDDY_PAC_*` 剥离的版本并重启 |
| `doctor` 显示 `WorkBuddy CLI：未检测到` | 独立版没装或不在 PATH | `which codebuddy` 检查；或临时设 `GOODJOB_WORKBUDDY_BIN=/path/to/codebuddy` |
| `pair` 报「未检测到 Codex CLI 或 WorkBuddy CLI」 | 同上，配对前先完成第 2 节 | 先装 CLI 再配对 |
| 任务长时间 0 输出 | CLI 版本过旧 / 环境变量泄漏 | `codebuddy --version` 确认独立版 ≥2.161；确认 Runner 是最新构建 |
| CRM 发起任务报 409 `engineUnavailable` | Runner 不在线或无可用适配器 | `goodjob-runner status` 看连接；确认 `goodjob-runner start` 在跑 |
| 技能没生效（信件口径变差） | 工作区里没有 `.workbuddy/skills/`（技能包未装），或装错了工作区 | 用 `install-skills.sh <工作区>` 装一次；再跑第 8 节探针复验 |

## 10. 安全边界（转述给别人时请带上）

- Runner 只接受 CRM 下发的结构化任务，不开放本机端口、不接受任意 Shell。
- CLI 登录凭据只存本机 `~/.codebuddy/`，不经过 CRM 存储。
- 配对码是一次性的；泄漏可在集成中心撤销该 Runner。
- CLI 子进程的执行模式由 CRM 任务决定（`read_only` → plan 模式，`workspace_write` → acceptEdits），不会被任务提示词改写。
