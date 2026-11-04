# CRM 接入 WorkBuddy CLI 完全指南（有源码 / 无源码两条路线）

> 版本：1.0（2026-10-10）
> 适用：GoodJob CRM 1.8.4+ ｜ WorkBuddy CLI（codebuddy）2.161+ ｜ GoodJob Local Runner 0.1.0
> 读完本文你能做到三件事：**① 判断自己该走哪条路线；② 15–30 分钟内打通「CRM 网页 → 本机 Runner → WorkBuddy CLI」；③ 出问题时按表定位。**
>
> 本文是接入的**总入口**，合并了 `docs/WORKBUDDY-CLI-SETUP.md`（本机配置版）与 `docs/RUNNER-CLI-SETUP-GUIDE.md`（服务器/纯终端版）的步骤，并**修正了其中一处会直接导致任务失败的描述**（见 §4.2 的 ⚠️）。
> 流程标准与数据落点看 `docs/CRM-CLI-STANDARD-FLOW.md`；技能包口径看 `docs/CLI-SKILLS-DESIGN.md`。

---

## 0. 先选路线（30 秒）

| 你的情况 | 走哪条路线 | 你需要准备 |
| --- | --- | --- |
| 手上有 GoodJob 仓库（开发、自建、私有部署） | **路线 A：有源码** | 仓库 + Node.js ≥ 22 + 一台能跑 CLI 的电脑 |
| 只有 CRM 网页账号 + 一台执行机（公司统一部署的 CRM） | **路线 B：无源码** | 网页管理员权限 + 执行机上装两样东西（见 §3.2） |
| 只想让 AI 干活，不想装任何东西 | **都不用走** | 在网页把来源切成「AI API」或「CRM 本地分析」即可（见 §3.6） |

**一句话区别**：两条路线的**终点完全一样**，差别只在「Runner 从哪来」。
有源码的人自己 `npm run build` 出 Runner；无源码的人向部署方要一个安装包。**其余步骤（登录 CLI、配对、网页配置）两条路线一模一样。**

---

## 1. 一句话架构

```
┌─────────────────────┐   ①一次性配对码（网页生成）    ┌──────────────────────────┐
│   CRM 后端 (4188)    │ ─────────────────────────────▶ │  执行机（CLI 所在电脑）    │
│   ＋ MySQL           │                                 │  goodjob-runner（常驻）    │
│   ＋ CRM 网页        │ ◀───────────────────────────── │    └─ spawn ─▶ codebuddy  │
└─────────────────────┘   ②Runner 主动 claim/心跳/回传    └──────────────────────────┘
                                                                      │
                                                                      ▼
                                                              云端大模型（WorkBuddy 账号额度）
```

| 角色 | 是什么 | 装在哪 | 谁负责装 |
| --- | --- | --- | --- |
| **WorkBuddy CLI**（`codebuddy`） | 真正干活的那个命令行 Agent | 执行机 | 用 CLI 的人（必须自己 `/login`） |
| **GoodJob Local Runner**（`goodjob-runner`） | 把 CRM 任务翻译成 CLI 调用并回传的桥 | 执行机 | 有源码的人自己 build；无源码的人用部署方的包 |
| **CRM 后端 + 网页** | 派单、留档、显示进度与结果 | CRM 服务器 | 部署方（本文假定已就绪） |

**三条不能破的边界**（转述给别人时请带上）：

1. Runner 由本机**主动连出**到 CRM，**不开放本机任何入站端口**，也不接受任意 Shell 命令——它只认 CRM 下发的结构化任务。
2. CLI 只能在 `--workspace` **已授权目录**里干活（§4.2 有精确口径）。
3. CLI 登录凭据只存本机 `~/.codebuddy/`，**永不经过 CRM**。CRM 里存的是 Runner 自己的令牌（`~/.goodjob/runner.json`，权限 0600，随时可在网页撤销）。

---

## 2. 路线 A：有源码（仓库在你手上）

### A1. 前置检查

```bash
node --version          # 需要 ≥ 22
cd <仓库根>              # 例如 ~/Desktop/GoodJob_private
ls goodjob-runner/      # 应看到 src/ dist/ package.json
```

### A2. 装独立版 CLI（**必须**）

```bash
npm install -g @tencent-ai/codebuddy-code
codebuddy --version     # 预期 2.161.x 或更新
```

> ⚠️ **必须用 npm 独立安装版。** macOS 上 WorkBuddy 桌面 App 自带一份内置 CLI
> （`/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy`），
> 它是 **headless-only、无法 `/login`**。Runner 的选择顺序是「`GOODJOB_WORKBUDDY_BIN` > PATH 里独立版 > 桌面内置兜底」，
> 所以装好独立版后无需任何额外配置；**但请不要把桌面内置版当成能用的那份**——带着它会得到满屏 `Authentication required`。

### A3. 登录 CLI（一次即可）

在**系统自带的 Terminal / iTerm**里执行（**不要**在 WorkBuddy 桌面端的内嵌终端里执行）：

```bash
codebuddy /login
```

登录态写入 `~/.codebuddy/`，Runner 之后每次执行任务都会自动复用它。

> 为什么不能在桌面端内嵌终端登录：宿主会注入 `CODEBUDDY_CONFIG_DIR=~/.workbuddy` 等变量，登录态会写到另一个目录。
> 若终端里设了代理导致登录报 `fetch config failed ... setProxy`，先 `env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy codebuddy /login`。

### A4. 构建并安装 Runner

```bash
cd <仓库根>
npm install
npm run build --workspace @goodjob/local-runner
npm link --workspace @goodjob/local-runner    # 之后全局有 goodjob-runner 命令
```

### A5. 在网页生成配对码

1. 用管理员账号登录 CRM 网页 → 左侧 **「集成中心」→ 标签页「本地 Runner」**；
2. 点右上角 **「配对设备」** → 填设备名（如「市场部-MacBook」）→ **「生成配对码」**；
3. 弹窗会给出**一次性配对码**（`GJ-XXXX-XXXX-XXXX`，有失效时间）和一条**现成的 pair 命令** → 点 **「复制命令」**。

### A6. 执行机配对

```bash
goodjob-runner pair \
  --server "http://<CRM地址>:4188" \
  --code "GJ-XXXX-XXXX-XXXX" \
  --workspace "/绝对路径/GoodJob_private" \
  --workspace "/绝对路径/另一个授权目录"      # 可重复，授权多个目录
```

成功会打印设备名、授权目录、配置文件位置（`~/.goodjob/runner.json`，0600）。

> ⚠️ **`--workspace` 要指向你放技能的目录**：四个领域技能包位于 `<workspace>/.workbuddy/skills/`，Runner 启动 CLI 时会把这个目录注入技能扫描路径（`CODEBUDDY_SESSION_SKILL_DIRS`）。**技能包不在代码仓库里**（2026-10-10 起改为独立成品包分发，见 §5.3），所以「克隆一份代码」不自带技能，必须单独安装。
> 工作区不对则技能不加载——任务仍能跑，但输出质量**静默降档**（写作口径、来源清单、交叉验证规则全部失效，且不报错）。

### A7. 自检并常驻

```bash
goodjob-runner doctor     # 体检：CLI 版本 / 执行文件 / 连接状态
goodjob-runner start      # 常驻；Ctrl+C 退出
```

`doctor` 要看的四行：

```
WorkBuddy CLI：2.161.4                                ←「未检测到」就查 GOODJOB_WORKBUDDY_BIN / PATH
WorkBuddy CLI 执行文件：/opt/homebrew/bin/codebuddy    ← 绝不该是 /Applications/WorkBuddy.app/...
连接：正常
目录：/Users/you/Desktop/GoodJob_private
```

**macOS 保活（launchd）**，`~/Library/LaunchAgents/com.goodjob.local-runner.plist`：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.goodjob.local-runner</string>
  <key>ProgramArguments</key>
  <array><string>/opt/homebrew/bin/node</string><string>/绝对路径/goodjob-runner/dist/cli.js</string><string>start</string></array>
  <key>EnvironmentVariables</key><dict>
    <key>GOODJOB_WORKBUDDY_BIN</key><string>/opt/homebrew/bin/codebuddy</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/goodjob-runner.log</string>
  <key>StandardErrorPath</key><string>/tmp/goodjob-runner.err.log</string>
</dict></plist>
```

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.goodjob.local-runner.plist
launchctl kickstart -k gui/$(id -u)/com.goodjob.local-runner     # 之后重启用这条
```

Linux 服务器用 systemd、最简用 `nohup node dist/cli.js start &`，模板见 `docs/RUNNER-CLI-SETUP-GUIDE.md` §6。

### A8. 回网页完成引擎配置

见 **§4.2**。做完这一步才能产生业务任务。

---

## 3. 路线 B：无源码（只在网页配）

### 3.1 先看清「网页能做什么 / 不能做什么」

这一节是路线 B 的全部要点，**先读它，别急着点按钮**：

| 事项 | 网页能做 | 必须在执行机终端做 |
| --- | --- | --- |
| 生成一次性配对码 / 复制 pair 命令 | ✅ | |
| 查看已配对设备、在线状态、CLI 版本 | ✅ | |
| 撤销设备（令牌立即失效） | ✅ | |
| 把背调 / 开发信来源切成 CLI（含适配器、模型、档位、超时） | ✅ | |
| 指定具体 Runner、指定 CLI 工作目录 | ✅ | |
| 手工发一条 CLI 任务并实时看过程/结果 | ✅ | |
| 取消正在跑的任务 | ✅ | |
| **安装 WorkBuddy CLI** | ❌ | ✅ |
| **CLI 登录（`/login`）** | ❌ | ✅ |
| **安装 goodjob-runner** | ❌ | ✅ |
| **执行 `pair` / `start`** | ❌ | ✅ |
| **放技能包（可选）** | ❌ | ✅ |

> **一句话**：网页能替你完成「配对 + 配置 + 监控」，但**装包、登录、启动这三件事天生只能在执行机上做**（网页无法在你电脑上装软件，这是设计上的安全边界，不是缺功能）。

### 3.2 执行机准备（三件事）

**第 1 件：装 WorkBuddy CLI 独立版并登录**

```bash
npm install -g @tencent-ai/codebuddy-code
codebuddy --version      # 2.161.x 或更新
codebuddy /login         # 在系统 Terminal / iTerm 里执行，别在桌面端内嵌终端里做
```

**第 2 件：拿到 goodjob-runner 安装包**（向 CRM 部署方索取，四选一）：

```bash
# 方式 A：npm 包（部署方给了 .tgz）
npm install -g ./goodjob-local-runner-0.1.0.tgz
goodjob-runner --help

# 方式 B：整目录（部署方给了压缩包，含 dist/ 与 node_modules/，完全离线最稳）
#   解压到 /opt/goodjob-runner，之后用 node /opt/goodjob-runner/dist/cli.js <命令> 调用
node /opt/goodjob-runner/dist/cli.js --help

# 方式 C：私有 registry（部署方已发布）
npm install -g @goodjob/local-runner

# 方式 D：自己能连版本库
svn export <仓库地址>/goodjob-runner /opt/goodjob-runner && cd /opt/goodjob-runner && npm install && npm run build
```

> ⚠️ 方式 A/C 会尝试从 registry 拉依赖 `@playwright/mcp`。执行机完全离线时用**方式 B**。
> 下文命令统一写 `goodjob-runner`；用方式 B 的话把它替换成 `node /opt/goodjob-runner/dist/cli.js`。

**第 3 件：准备一个工作目录**（CLI 只允许在这里面干活）

```bash
mkdir -p ~/goodjob-workspace        # 建议专用目录，不要直接授权家目录
```

### 3.3 配对（网页 + 执行机各一步）

**网页侧**：集成中心 → 本地 Runner → **「配对设备」** → 填设备名 → **「生成配对码」** → **「复制命令」**。

**执行机侧**：把复制到的命令改好工作目录后执行：

```bash
goodjob-runner pair \
  --server "http://<CRM地址>:4188" \
  --code "GJ-XXXX-XXXX-XXXX" \
  --workspace "/Users/you/goodjob-workspace"
goodjob-runner doctor
goodjob-runner start
```

配对成功后回到网页，**「本地设备」列表里会出现这台机器**，并显示它探测到的 CLI 版本（如 `WorkBuddy CLI 2.161.4`）。

### 3.4 技能包（可选，但强烈建议）

技能包是纯 Markdown 文件，决定任务使用的**领域口径**（来源清单、交叉验证规则、写信分寸）。

> 📦 **技能包不在代码仓库里**（2026-10-10 起）。它是**独立成品包**，与 CRM 代码分开交付 —— 
> 拿到的是一份 `GoodJob-CLI-Skills-<版本>.zip`（`.workbuddy/skills/` 整个目录 + `install-skills.sh` + 说明）。
> 解压后一条命令装好；也可以手工拷目录。

```bash
# 解压后在这个目录里执行；参数 = 你的工作目录（也就是 ② 里 --workspace 给的那个路径）
./install-skills.sh ~/goodjob-workspace
```

手工等价操作就是把包里的 `skills/*` 拷成 `<工作目录>/.workbuddy/skills/*`：

```
~/goodjob-workspace/.workbuddy/skills/
├── goodjob-lead-acquisition/SKILL.md     （获客：渠道矩阵、检索式、两轮核实）
├── goodjob-company-research/SKILL.md     （背调：九维框架、二源硬规则、Gate）
├── goodjob-tender-daily/SKILL.md         （招标日报：五层来源、逐条三重验证、跨期去重）
└── goodjob-outreach-email/SKILL.md       （开发信：阶段×角色×目标、事实追溯、量化自检）
```

装完**重启 Runner**。**「克隆一份代码」不会自带技能**——代码仓库里没有 `.workbuddy/`
（该目录已整体移出版本库，见 `docs/CLI-SKILLS-DESIGN.md` §11）。

> 技能名必须与 CRM 提示词里点名的名字逐字一致。名字的**唯一来源**是后端常量
> `backend/src/ai-engine-prompts.ts::ENGINE_CLI_SKILLS`，改名时改那一处，四个提示词一起生效
> （装了技能包的机器，`ai-engine-test.ts` 会去磁盘核对目录名与 frontmatter，改名漏改会被测试挡住）。

> ⚠️ **`<工作目录>/.workbuddy/skills/` 不是 CLI 的默认技能目录**（CLI 默认只扫 `<cwd>/.codebuddy/skills/` 与 `~/.codebuddy/skills/`）。这个位置是 WorkBuddy 桌面版的约定，CRM 侧技能包统一放这里、由 Runner 显式注入给 CLI。
> 因此**放对位置还不够**，必须满足下面任一条件：> - **有源码 / 用官方 Runner 包（2026-10-10 及之后的版本）**：Runner 启动 CLI 时会自动注入 `CODEBUDDY_SESSION_SKILL_DIRS=<工作目录>/.workbuddy/skills`，放好 + 重启 Runner 即生效。
> - **旧版 Runner 或自建启动脚本**：手动给 Runner 进程加环境变量 `GOODJOB_SKILLS_DIRS=<技能目录绝对路径>`（支持多目录，用 `:` 分隔），或直接注入 `CODEBUDDY_SESSION_SKILL_DIRS`。

**目录层级必须严格是 `.workbuddy/skills/<技能名>/SKILL.md`**，少一层或多一层都不生效。放好后务必用 §5.2 的探针验证——**技能没加载不会有任何报错**，只会表现为输出质量静默降档。

**技能要真正被用上，三层缺一不可**（任何一层断了都是「静默降档」，不报错）：

| 层 | 做什么 | 谁负责 |
| --- | --- | --- |
| ① 放对位置 | `.workbuddy/skills/<技能名>/SKILL.md`，目录名 = frontmatter `name` | 部署方（用独立技能包 + `install-skills.sh`） |
| ② 注入扫描路径 | 启动 CLI 时注入 `CODEBUDDY_SESSION_SKILL_DIRS=<技能目录>` | Runner（`workbuddy-adapter.ts::workbuddySkillDirs`） |
| ③ 任务里点名 | 提示词首部写入 `FIRST STEP: load the Skill \`<技能名>\` …` | CRM 后端（`ai-engine-prompts.ts::engineSkillDirective`） |

第 ③ 层是 2026-10-10 补的：在此之前技能只靠「描述匹配」被动触发，模型不点就白装。现在四个引擎任务
（获客 / 背调 / 招标日报 / 开发信）都显式点名，而且**技能不存在时任务照常继续**——加载技能失败绝不能让业务任务失败。

### 3.5 回网页完成引擎配置

见 **§4.2**。

### 3.6 如果执行机连 CLI 都不想装

不装就不走 CLI 通道：在网页 **系统设置 → AI 执行来源** 把「默认背调来源」「默认开发信来源」切回 **AI API**（需先在 AI 配置里填模型 API Key）或 **CRM 本地分析 / 规则模板**（不联网、不调模型，永远可用）。
**CLI 通道是可选增强，不是必需件**——机器离线时切回去即可继续工作，不影响已有数据。

---

## 4. 网页配置逐字段说明

### 4.1 集成中心 · 本地 Runner

| 区域 | 说明 |
| --- | --- |
| 概览四格 | 当前在线（30 秒内有心跳）／已配对设备／执行中／已完成（最近 100 条） |
| 本地设备 | 点选目标机器；显示在线状态与探测到的 CLI 摘要；「解除」= 撤销该设备令牌（立即生效） |
| 最近任务 | 历史任务列表，点开看逐条执行日志与 CLI 最终回复 |
| 发送本机 CLI 任务 | **手工通道**：选适配器（WorkBuddy / Codex，不可用的会置灰）→ 填任务内容 → 选工作目录 → 选最长执行（5 分钟–24 小时）→ 选权限（**只读分析** / 可修改工作区）→ 发送到本机 |

### 4.2 系统设置 · AI 执行来源

| 字段 | 可选值 | 怎么填 |
| --- | --- | --- |
| 默认背调来源 | CRM 本地分析 / AI API / 本机 CLI | 要用 CLI 就选 **本机 CLI** |
| 默认开发信来源 | 规则模板 / AI API / 本机 CLI | 同上 |
| CLI 适配器 | WorkBuddy CLI / Codex CLI | 选 **WorkBuddy CLI** |
| CLI 模型 | 20 个模型 + 「跟随 CLI 默认」 | 出厂默认已设为 **deepseek-v4.1-flash**；见 §6，**这是「变傻」的总开关** |
| 思考档位 | minimal / low / medium / high / xhigh / max + 跟随默认 | 建议 medium 或 high |
| CLI 超时（分钟） | 1–1440 | 默认 15；获客类长任务调 30–60 |
| CLI 工作目录 | 文本 | **必须与某个 `--workspace` 授权目录完全一致**（见下方 ⚠️）；留空自动用首个授权目录 |
| 指定 Runner | 下拉（在线设备） | 只有一台机器时留空=自动选；有多台时建议显式指定 |

> ⚠️ **修正一处常见误配**：工作目录**不是**「授权目录或其子目录」，而是**必须与 `pair` 时授权的某个目录路径完全相同**（两边都做 `realpath` 后精确比对）。
> 例如授权了 `/Users/you/goodjob-workspace`，填 `/Users/you/goodjob-workspace/子目录` 会被拒：网页报 `该工作目录未在本机 Runner 授权范围内`（403），任务根本不派发。
> 想用子目录 → 用 `goodjob-runner pair` 重新配对，把子目录也加进 `--workspace`。

右上角那枚徽标是**实时状态**：绿色表示就绪并显示当前真正在用的模型；黄色/红色表示没有在线的、具备该 CLI 能力的 Runner，鼠标悬停或看 `runner.cliIssue` 会给出原因。

---

## 5. 验证（三层，逐层做）

### 5.1 执行机自检

```bash
goodjob-runner doctor
```

要看到 `WorkBuddy CLI：<版本>`、`WorkBuddy CLI 执行文件：<独立版路径>`、`连接：正常`。
若打印 `CLI 故障：…`，那是 Runner 已经把失败原因探明并上报了（没装 / 符号链接悬空 / 起不来 / 超时），照文案处理即可。

### 5.2 网页探针任务（验证 CLI 与技能包同时可用）

集成中心 → 本地 Runner → 发送本机 CLI 任务，适配器选 WorkBuddy，工作目录选授权目录，提示词：

```
Do not use any file tool (no Read, Glob, Grep, Bash). Answer only from your registered skill list.
Report each as AVAILABLE or MISSING: goodjob-lead-acquisition, goodjob-company-research, goodjob-tender-daily, goodjob-outreach-email.
```

预期四个全部 `AVAILABLE`。

> ⚠️ **必须看「注册状态」，不要用「磁盘上能不能找到文件」代替**。让模型自由发挥时它可能用 Glob 去磁盘找 `SKILL.md`，从而把「文件存在」误报成「技能已加载」——这两件事完全不同。提示词里那句「不要用文件工具」就是为堵这个漏洞加的。

### 5.3 真实业务任务

在任一客户上点「AI 背调」，任务详情里 engine 应显示 `WorkBuddy CLI 2.161.4` 且状态成功，集成中心能看到逐条执行日志。

---

## 6. 模型与思考档位（为什么「变傻」，怎么调）

**实测结论（2026-10-10 复核）**：不传 `--model` 时用哪个模型，由 CLI 按其**当前登录账号**决定，**不是一个固定值**。
同一台机器上实测见过 `fast-model`，也见过 `hy4-preview-f`——所以「跟随 CLI 默认」等于「模型会随 `workbuddy switch` 切账号而变」，跨机器、跨账号都不一致。

> ⚠️ 早期版本的本文档曾断言默认就是 `fast-model`，那是当时那一个账号的观测值，不能推广。
> 验证方法：`codebuddy --print --output-format stream-json --max-turns 1 "收到"`，看返回里 `system/init` 事件的 `model` 字段。

要让全团队行为稳定，**显式指定模型**，不要依赖默认档。所有走 CLI 的背调 / 开发信 / 获客 / 日报 / 资料识别都吃这个设置。

**系统出厂默认（2026-10-10 起）**：默认值已固定为 **`deepseek-v4.1-flash`**。未配置过的团队会自动显式传 `--model deepseek-v4.1-flash`，**不再落到上面那档随账号变化的 CLI 默认**，换账号也不会变。
若某台机器仍想跟随 CLI 账号（例如正在试新模型），在下拉里选「跟随 CLI 默认（由当前账号决定）」即可——它存的是空串，Runner 不传 `--model`。

**建议配置**：

| 任务 | 建议 | 理由 |
| --- | --- | --- |
| 默认（不折腾） | **deepseek-v4.1-flash（出厂默认）** | 快而稳，覆盖面广，绝大多数任务够用 |
| 背调、开发信、获客、招标日报（要更稳的判断） | **deep-model** 或 **deepseek-v4-pro**，档位 **medium / high** | 需要判断力与归纳，快不是第一优先级 |
| 新增客户资料识别等纯字段抽取 | 跟随默认（任务级已固定 `effort=low`） | 快比聪明值钱（实测默认参数 178 秒/53 次工具调用，压到 low 后 7.8 秒/3 次，字段质量一致） |
| 觉得等太久 | balanced-model，档位 low/medium | 速度与质量折中 |

模型与档位**只对 WorkBuddy CLI 生效**（模型 ID 是 WorkBuddy 侧命名，Codex 不认）；切换适配器到 Codex 时这两项不参与。

---

## 7. 进阶：任务级执行参数协议 `[[gj-cli-options …]]`

网页手工任务、以及任何自己拼提示词的地方，都可以在**提示词首行**声明一个执行档位标记，Runner 会把它翻译成 CLI 参数并从提示词里剥掉（**不会喂给模型**）：

```
[[gj-cli-options {"model":"deep-model","effort":"high","maxTurns":6,"disallowedTools":["Write","Edit","Glob","Grep","WebFetch","WebSearch","Agent"]}]]
你是外贸 CRM 的客户资料录入助手……
```

| 字段 | 取值 | 说明 |
| --- | --- | --- |
| `model` | 20 个模型 ID（与网页下拉一致） | 等价于 `--model` |
| `effort` | `minimal` / `low` / `medium` / `high` / `xhigh` / `max` | 等价于 `--effort` |
| `maxTurns` | 1–40 | 等价于 `--max-turns`，限制工具调用轮数 |
| `disallowedTools` | 工具名数组（最多 24 个） | 等价于 `--disallowedTools`，用于关掉「探索仓库」这类无用功 |

规则与坑：

- 标记**必须出现在提示词第一行**，且以 `[[gj-cli-options` 开头；
- **非法取值静默忽略**（白名单机制，不会把任意字符串透传给 CLI）；坏 JSON 会被剥掉但不影响正文；
- 标记与正文写在同一行是允许的（只剥标记本身）；
- 网页「AI 执行来源」里的模型/档位会**合并进**这个标记：**只覆盖 `model` / `effort`**，`maxTurns` 与 `disallowedTools` 原样保留（那些是「别去探索仓库」的硬约束，跟模型强弱无关）。

---

## 8. 环境变量速查

**执行机（Runner 侧）**

| 变量 | 作用 | 默认 |
| --- | --- | --- |
| `GOODJOB_WORKBUDDY_BIN` | 指定 codebuddy 二进制路径（Linux 服务器 / 非标准安装位置必配） | PATH 里的独立版 → macOS 桌面内置兜底 |
| `GOODJOB_CODEX_BIN` | 指定 Codex CLI 路径（仅 Codex 适配器用） | PATH |
| `GOODJOB_RUNNER_CONFIG` | Runner 配置文件位置（多实例隔离用） | `~/.goodjob/runner.json` |
| `GOODJOB_BROWSER_MCP_PORT` / `GOODJOB_BROWSER_CDP_PORT` | 受控浏览器端口 | 自动 |
| `GOODJOB_BROWSER_DATA_DIR` / `GOODJOB_BROWSER_OUTPUT_DIR` | 浏览器资料 / 输出目录 | `~/.goodjob/browser-*` |
| `GOODJOB_BROWSER_EXECUTABLE` / `GOODJOB_BROWSER_PROXY_SERVER` | 指定 Chrome / 代理 | 自动 |

**CRM 服务器侧**

| 变量 | 作用 | 默认 |
| --- | --- | --- |
| `GOODJOB_PUBLIC_URL` | 配对命令里对外可见的 CRM 地址（反代/内网后必配，否则生成的命令地址不对） | 请求的 host |
| `AI_ENGINE_ACQUIRE_WAIT_MS` | 获客同步等待窗口 | 180000 |
| `GOODJOB_OFFICE_PYTHON` | 「新增客户」上传 Excel / Word 时用来转文本的 Python 解释器（机器上有多个版本、想指定带 xlrd/pandas 的那个时用） | 自动探测（见 §12） |

---

## 9. 故障排查

| 现象 | 根因 | 处理 |
| --- | --- | --- |
| 任务失败 `Authentication required. Please use /login` | CLI 未登录，或登录写错了目录（在桌面端内嵌终端登录） | 系统终端重跑 `codebuddy /login`；确认 `~/.codebuddy/` 有内容 |
| 报 `400 connect ENOENT workbuddy-pac-*.sock` | 老版 Runner 未剥离桌面端 PAC 代理变量，且桌面 App 重启过 | 升级 Runner 后重启（新版已剥离 `WORKBUDDY_PAC_RPC_*`） |
| 任务**0 输出永久挂起**直到超时 | 宿主注入的 `SERVER__HOST` / `SERVER__PORT` 泄漏进 CLI 子进程，把 CLI 绑到了桌面端网关 | 升级 Runner（新版必剥这两个）；确认没有手工绕过 Runner 直接裸跑 CLI |
| 任务失败但错误信息为空 | 老版 Runner 没读 CLI 的 `errors` 数组 | 升级 Runner |
| `doctor` 显示 `WorkBuddy CLI：未检测到` | 独立版没装或不在 PATH | `which codebuddy`；或设 `GOODJOB_WORKBUDDY_BIN` 后重启 Runner |
| `pair` 报「未检测到 Codex CLI 或 WorkBuddy CLI」 | 配对前没装 CLI | 先完成 §A2 / §3.2 再配对 |
| 网页报 403 `该工作目录未在本机 Runner 授权范围内` | 填的工作目录与授权目录**不完全一致** | 见 §4.2 的 ⚠️；重新 `pair` 把该目录加进 `--workspace` |
| CRM 发任务报 409 `engineUnavailable` | 没有在线 Runner，或该 Runner 没有该 CLI 能力 | 执行机 `goodjob-runner status`；确认 `start` 在跑；确认网页选的 Runner 是这台 |
| 网页提示「这台 Runner 上暂时用不了本机 CLI」 | Runner 在线但探测不到 CLI（刚切过账号 / 二进制被换） | 等十几秒会自动重探恢复（实测 **2.1 秒**）；仍不行重启 Runner |
| 技能没生效（信件口径变差、来源清单消失，且**没有任何报错**） | 工作目录不含 `.workbuddy/skills/`、目录层级放错，或 Runner 版本未内置技能目录注入 | 用 §5.2 探针复验注册状态；旧版 Runner 补 `GOODJOB_SKILLS_DIRS` |
| 任务很久没动 | 同一台 Runner **同时只执行一个任务**，其余在排队 | 看任务 `createdAt → startedAt` 间隔即可确认；多机配对或错峰提交 |
| 配对报「尝试过于频繁」 | 配对接口限流（每分钟 20 次） | 等一分钟 |
| 切换 CLI 账号后 CRM「连不上」 | 旧版 Runner 心跳被 CLI 探测阻塞、探测缓存长时间粘滞 | 升级 Runner（心跳已与探测解耦 + 掉线 10 秒快速重探）；**CRM 只认「这台机器 CLI 能用」，不绑具体账号** |
| 新增客户上传 Excel 后「没识别到字段」 | 二进制 Office 文档需要先文本化，而 CRM 服务器上没有可用的 Python，或没装 xlrd / pandas | 见 §12：装 Python（或 `GOODJOB_OFFICE_PYTHON` 指一个带 xlrd 的解释器）；临时办法是把表格另存为 CSV / PDF 再传 |
| 新增客户识别报「CLI 返回的内容不是可解析的 JSON」 | 极少数情况：模型真的只回了一段文字而没给 JSON | 直接重试；若反复出现，把网页上提示的 `rawPreview`（原始返回片段）留作排查 |

**日志位置**：Runner 自身日志跟启动方式走（launchd → plist 里的路径 / systemd → `journalctl -u goodjob-runner` / nohup → 重定向文件）；任务级日志在网页「集成中心 · 本地 Runner · 任务详情」。

---

## 10. 安全边界（转述给别人时请带上）

- Runner 只接受 CRM 下发的结构化任务，**不开放本机端口、不接受任意 Shell**。
- CLI 登录凭据只在本机 `~/.codebuddy/`，**不经过 CRM 存储**；CRM 只存 Runner 令牌。
- Runner 子进程会**主动剥离**宿主注入的十余类环境变量（`SERVER__*`、`CODEBUDDY_CONFIG_DIR`、`WORKBUDDY_PAC_RPC_*`、`CODEBUDDY_GATEWAY_*`、`ELECTRON_RUN_AS_NODE`、本机会话代理等）。**这就是「不要绕过 Runner 手工裸跑 CLI」的原因**——少剥一个变量就可能认证失败或永久挂起。
- 配对码**一次性**且有效期短；泄漏可在集成中心删除该配对重新生成；设备可随时「解除」，令牌立即失效。
- CLI 只能在 `--workspace` 授权目录内工作；执行权限由 CRM 任务决定（只读 → plan 模式，可修改 → acceptEdits），**任务提示词无法自行提权**。
- 技能包是纯文本 Markdown，不含可执行代码。

---

## 11. 附：集成接口清单（给要自己写集成的人）

**Runner（执行机）侧**，`/api/integrations/runner-agent/*`，鉴权 `Authorization: Runner <token>`：

| 端点 | 用途 |
| --- | --- |
| `POST /runner-agent/pair` | 用一次性配对码换取长期令牌（限流 20/分钟） |
| `POST /runner-agent/claim` | 领取任务（返回 `claim` 或 `null`；同一 Runner 串行） |
| `POST /runner-agent/heartbeat` | 心跳（空闲 10s、任务中 8s；可带 `lastError` 与能力快照） |
| `POST /runner-agent/tasks/:id/events` `…/events/batch` | 上报执行事件 |
| `POST /runner-agent/tasks/:id/complete` | 回传终态与结果 |

**CRM 网页侧**，`/api/integrations/*` 与 `/api/ai-engine/*`：

| 端点 | 用途 |
| --- | --- |
| `POST /api/integrations/local-runners/pairings` | 生成配对码（返回 `pairingCode` 与现成 `command`） |
| `GET /api/integrations/local-runners` | 设备列表与在线状态 |
| `POST /api/integrations/local-runners/:id/revoke` | 撤销设备 |
| `GET/POST /api/integrations/local-runner-tasks` | 任务列表 / 手工建任务 |
| `GET /api/integrations/local-runner-tasks/:id` | 任务详情 + 事件流 |
| `POST /api/integrations/local-runner-tasks/:id/cancel` | 取消任务 |
| `GET/PUT /api/ai-engine/settings` | 引擎来源、适配器、模型、档位、超时、Runner 选择 |
| `POST /api/ai-engine/acquire`、`GET /api/ai-engine/jobs/:id` | CLI 获客与作业轮询 |

> 新增写接口必须在 `backend/src/agent-api-contracts.ts` 的 `define()` 注册契约；真外发接口必须进 `agent-api-policy.ts` 的 `externalPatterns`；改完跑 `npm test`。

---

## 12. 新增客户资料识别：支持哪些文件、读不了怎么办

「新增客户 → 从资料自动填表」这条链路是：**文件传到执行机 → 本机 CLI 读文件 → 回填表单**。文件由 CLI 的 `Read` 工具读，而它**读不了二进制 Office 文档**（`.xls` / `.xlsx` / `.docx` 都是二进制，直接读只会得到乱码）。所以 CRM 会在上传时先把这类文件**转成纯文本**，再把文本文件交给 CLI。

| 格式 | 处理方式 | 前提 |
| --- | --- | --- |
| PDF / 图片（png、jpg、webp…）/ txt / csv / md / html / eml | 直接交给 CLI 读（图片走多模态识别） | 只要 CLI 可用 |
| `.xlsx`、`.docx` | CRM 自动转成文本（Python 标准库 `zipfile` + XML），交给 CLI 的是文本 | CRM 服务器上有任意 Python 3 |
| `.xls`（旧版二进制） | 需要 Python 装了 `xlrd` 或 `pandas` | 见下 |
| `.doc` / `.ppt` / `.pptx` | 不支持自动转换 | 另存为 `.docx` / PDF / 截图后再传 |
| 转换失败 | **不阻断**：原件仍交给 CLI 试读（部分 `.xls` 其实是 HTML 伪装的，反而能读出来），并在文件条目上标出「未能自动转换」与改格式建议 | — |

**确认这台机器能不能读 Excel**

```bash
cd <仓库>/backend && npm run test:office-text    # 打印实际选用的解释器与支持范围
python3 -c "import xlrd; print('xls 可转')"       # 报错 = 旧版 .xls 转不了
```

装库：`python3 -m pip install xlrd`（`openpyxl` / `pandas` 也能顶）。机器上有多个 Python 版本时用 `GOODJOB_OFFICE_PYTHON` 显式指定——探测顺序是「该变量 → PATH → 常见安装位置（含 Homebrew / python.org / framework / conda）」。

**三种「没识别到」的含义完全不同，别混**

| 网页提示 | 含义 | 怎么办 |
| --- | --- | --- |
| `已填入 N 项` | 正常识别 | 核对后保存 |
| `未识别到可填入的字段` + 逐条「识别提示」 | **识别成功**，只是这份资料里确实没有客户字段（空白页、扫描件没内容、表格没转成文本） | 按提示换文件；不是 CLI 坏了 |
| `CLI 返回的内容不是可解析的 JSON` | 模型没按约定输出 JSON（罕见，通常是输出被截断） | 重试，或减少文件数量 / 换更小的资料 |

---

## 13. FAQ

**Q：执行机必须装 WorkBuddy 桌面端吗？**
不需要。桌面端只是 macOS 上 CLI 的「随附来源」；只要 PATH 里有独立版 `codebuddy`，或设了 `GOODJOB_WORKBUDDY_BIN` 即可。

**Q：无源码的人能不能完全不动终端？**
不能。**配对码生成、引擎设置、监控**都能在网页做，但**装 CLI、`/login`、装 Runner、`pair`、`start`** 必须在执行机终端完成——这是安全边界。如果连终端都不想碰，就别用 CLI 通道（见 §3.6）。

**Q：一台执行机能服务多个 CRM 吗？**
一个 Runner 配置对应一个 CRM。多实例用 `GOODJOB_RUNNER_CONFIG` 隔离配置、`GOODJOB_BROWSER_MCP_PORT` 隔离浏览器端口。

**Q：CLI 会拿到我整台机器的权限吗？**
不会，被限制在授权目录内（见 §10）。

**Q：切换 CLI 账号（`workbuddy switch` 之类）会让 CRM 掉线吗？**
不会。CRM 只认「这台机器 CLI 能用」，不绑账号。Runner 会在十几秒内自动重探并恢复；期间在跑的单个任务可能失败，重跑即可。**切换账号与「CRM 登录态」完全无关**——那是后端签发的 JWT，只受后端重启影响。

**Q：Runner 断网 / 重启会丢任务吗？**
不会。任务在 CRM 侧留档，掉线时停在「等待本机」，Runner 恢复后继续领取；CRM 另有后台补收工序兜底收尾。

**Q：升级 Runner 要重新配对吗？**
不用。配置在 `~/.goodjob/runner.json`，升级只替换 `dist/`。
