# WorkBuddy CLI（本地 Runner）配置教程 — 服务器/纯终端部署版

> ⚠️ **本文已并入总入口文档 [`docs/CRM-WORKBUDDY-CLI-INTEGRATION.md`](./CRM-WORKBUDDY-CLI-INTEGRATION.md)**（覆盖「有源码」与「无源码」两条路线，并修正了本文中关于 CLI 工作目录的一处错误描述）。需要服务器/systemd 细节时仍可参考本文。
>
> 版本：1.0（2026-10-06）
> 适用：GoodJob CRM 部署在服务器上，执行机（跑 CLI 的那台电脑/服务器）**只有终端访问、没有完整源码**的场景。
> 目标：30 分钟内打通「CRM ↔ 本地 Runner ↔ WorkBuddy CLI」，让背调、开发信、获客三类 AI 任务由本机 CLI 执行并回传 CRM。

---

## 0. 架构与三个角色

```
┌──────────────┐         ①配对码（一次性）        ┌──────────────────┐
│  CRM 服务器   │ ◄──────────────────────────  │   执行机（本机）    │
│  backend:4188│    ②Runner 主动 claim/心跳     │  goodjob-runner   │
│  MySQL       │ ◄──────────────────────────  │  WorkBuddy CLI    │
└──────────────┘    ③任务结果/事件回传           └──────────────────┘
```

| 角色 | 说明 | 需要什么 |
|---|---|---|
| CRM 服务器 | 已部署 GoodJob CRM（backend 4188，MySQL 持久化） | 能被执行机访问到 |
| 执行机 | 跑 Runner 的电脑/服务器（就是跑 CLI 的那台） | Node.js ≥ 22、`goodjob-runner`、WorkBuddy CLI |
| WorkBuddy CLI | 真正执行 AI 任务的 `codebuddy` 命令行 | 登录一次（`/login`） |

**安全模型（先记住再动手）**：Runner 由本机**主动连出**到 CRM，不开放本机入站端口；配对码一次性；Runner 令牌存在本机、权限 0600；CLI 只能在**授权目录**里干活；CRM 管理员可随时撤销设备。

---

## 1. 前提检查（执行机上逐条跑）

```bash
# ① Node.js ≥ 22（fetch / structuredClone 必需）
node --version

# ② WorkBuddy CLI 在不在（任一形式即可）
codebuddy --version
# macOS 装了 WorkBuddy 桌面端的话，固定位置在这里（Runner 会自动找到）：
ls "/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy"

# ③ CRM 可达（在执行机上测，注意不要走代理）
curl -s --noproxy '*' -o /dev/null -w "%{http_code}\n" http://<CRM服务器>:4188/api/health
```

- ② 两条都没有？安装独立版 CLI（**推荐，见 §3**）：`npm install -g @tencent-ai/codebuddy-code`。装在非标准位置也没关系，后面用 `GOODJOB_WORKBUDDY_BIN` 指定。
- ③ 不通先解决网络/防火墙，Runner 只需要**出站**访问 CRM 这一个地址。

---

## 2. 安装 goodjob-runner（无需完整源码）

三选一，按运维条件挑最顺手的。

### 方式 A：离线安装包（服务器不通外网时的推荐做法）

在有源码的机器上打一个 npm 包：

```bash
cd goodjob-runner
npm install        # 生成 node_modules（Runner 运行只需要 @playwright/mcp）
npm run build      # 生成 dist/
npm pack           # 产出 goodjob-local-runner-0.1.0.tgz
```

把 `goodjob-local-runner-0.1.0.tgz` 传到执行机（scp/U盘均可）：

```bash
npm install -g ./goodjob-local-runner-0.1.0.tgz
goodjob-runner --help     # 有用法输出即成功
```

> ⚠️ `npm install -g` 安装 tarball 时会尝试从 registry 拉 `@playwright/mcp`。服务器完全离线的话改用方式 B。

### 方式 B：整目录拷贝（完全离线，最稳）

把整台机器上 `goodjob-runner/` 目录（含 `dist/`、`node_modules/`、`package.json`）原样拷到执行机，例如 `/opt/goodjob-runner/`：

```bash
scp -r goodjob-runner/ ops@<执行机>:/opt/goodjob-runner
# 执行机上验证：
cd /opt/goodjob-runner && node dist/cli.js --help
```

### 方式 C：SVN 导出子目录（执行机能连 SVN 仓库时）

```bash
svn export <仓库地址>/goodjob-runner /opt/goodjob-runner
cd /opt/goodjob-runner && npm install && npm run build
```

> 方式 B/C 用 `node dist/cli.js <命令>` 调用；方式 A 装完直接有全局命令 `goodjob-runner`。下文统一写 `goodjob-runner`，方式 B/C 请自行替换。

---

## 3. 登录 WorkBuddy CLI（一次性，必须有）

> ⚠️ **重要（2026-10-06 实测）**：macOS WorkBuddy 桌面端**自带**的 CLI 是精简版，只包含非交互的 headless 产物（`codebuddy --print` 可用），**不含 `/login` 需要的完整交互版**——直接对它执行 `/login` 会报 `Cannot find module '../dist/codebuddy'`。所以：
>
> - **桌面端自带的 CLI：能执行任务，但不能用来登录。**
> - **登录必须用 npm 安装的独立版**（两者都是 CodeBuddy Code CLI）。

Runner 配对前先做这步——**CLI 未登录是"任务失败但看不到原因"的头号原因**。

```bash
# 第 1 步：安装独立版（已装可跳过）
npm install -g @tencent-ai/codebuddy-code

# 第 2 步：登录（会弹出浏览器/给出授权链接，用 WorkBuddy 账号登录）
codebuddy /login
```

> 若终端里设了代理变量导致登录报 `fetch config failed ... setProxy`，先去掉代理再登录：
> ```bash
> env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy codebuddy /login
> ```

按提示完成账号登录。服务器没有桌面浏览器时，把 CLI 给出的授权 URL 复制到任意有浏览器的设备上完成（以 CLI 实际提示为准）。

登录后验证：

```bash
echo '只回复两个字：在线' | codebuddy --print
# 返回"在线"二字即登录态正常
```

---

## 4. 生成配对码（CRM 网页，管理员操作）

1. 用管理员账号登录 CRM 网页 → 左侧 **「集成中心」→「本地 Runner」**；
2. 点击 **「配对本地 Runner」**，填设备名（默认"我的电脑"，建议填"机房服务器A"这类好认的），点 **「生成配对码」**；
3. 弹窗会显示**一次性配对码**（带失效时间）和一条**现成的 pair 命令**，点 **「复制命令」** 拿走。

> 没有网页条件时也可以用 API 直接生成（需登录态）：
> ```bash
> curl -s -X POST http://<CRM服务器>:4188/api/integrations/local-runners/pairings \
>   -H "Authorization: Bearer <你的CRM登录token>" \
>   -H 'Content-Type: application/json' -d '{"deviceName":"机房服务器A"}'
> ```
> 响应里的 `pairingCode` 和 `command` 就是要的东西。
> ⚠️ 服务器若在反代/内网后面，CRM 侧记得设置 `GOODJOB_PUBLIC_URL` 环境变量，否则生成的命令里地址可能不对——不对就手动把 `--server` 换成执行机实际能访问到的 CRM 地址。

**配对码有效期短、用一次就作废**；泄露了就在集成中心删除该配对重新生成。

---

## 5. 配对（执行机）

```bash
goodjob-runner pair \
  --server "http://<CRM服务器>:4188" \
  --code "GJ-XXXX-XXXX-XXXX" \
  --workspace "/absolute/path/允许CLI工作的目录"
```

- `--workspace` 可重复多次（授权多个目录）。⚠️ **CRM 里的「CLI 工作目录」必须与某个授权目录路径完全一致（不是「其子目录」）**——两边都会做 `realpath` 后精确比对，填子目录会被 CRM 以 403 `该工作目录未在本机 Runner 授权范围内` 直接拒绝，任务根本不派发。想用子目录就把子目录也加进 `--workspace` 重新配对。
- 推荐授权一个专用目录（如 `/opt/goodjob-work`），而不是家目录。
- CLI 二进制不在标准位置时，先设环境变量再配对：
  ```bash
  export GOODJOB_WORKBUDDY_BIN=/usr/local/bin/codebuddy
  ```

配对成功会打印：设备名、授权目录、配置文件位置。**本机配置保存在 `~/.goodjob/runner.json`（权限 0600），含 Runner 令牌，勿外传。** 可用 `GOODJOB_RUNNER_CONFIG` 指定其他位置（systemd 多实例时有用）。

---

## 6. 启动与保活

### 手动前台（先跑通再说）

```bash
goodjob-runner doctor    # 体检：CLI 版本/执行文件/浏览器/连接状态，全绿再继续
goodjob-runner start     # 常驻等待任务；Ctrl+C 停止
goodjob-runner status    # 查看连接与 CLI 检测
goodjob-runner once      # 只领一个任务就退出（调试用）
```

`doctor` 关键行解读：

```
WorkBuddy CLI：2.156.0            ← 检测不到就查 GOODJOB_WORKBUDDY_BIN / PATH
WorkBuddy CLI 执行文件：/...      ← 实际会调用的二进制
连接：正常                         ← 异常先查 CRM 地址/防火墙/配对是否被撤销
独立浏览器：未运行（启动 Runner 后自动运行）   ← 正常，start 后自动拉起
```

### 生产保活（三选一）

**systemd（Linux 服务器推荐）：**

```ini
# /etc/systemd/system/goodjob-runner.service
[Unit]
Description=GoodJob Local Runner
After=network-online.target

[Service]
Type=simple
User=ops
WorkingDirectory=/opt/goodjob-runner
Environment=GOODJOB_WORKBUDDY_BIN=/usr/local/bin/codebuddy
Environment=GOODJOB_RUNNER_CONFIG=/home/ops/.goodjob/runner.json
ExecStart=/usr/bin/node dist/cli.js start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now goodjob-runner
journalctl -u goodjob-runner -f     # 看日志
```

> ⚠️ `runner.json` 在**配对用户的家目录**里，systemd 的 `User=` 必须和配对时是同一个用户，或用 `GOODJOB_RUNNER_CONFIG` 显式指定。

**nohup（最简）：**

```bash
nohup node dist/cli.js start >> ~/.goodjob/runner.log 2>&1 &
```

**pm2：**

```bash
pm2 start "node dist/cli.js start" --name goodjob-runner && pm2 save
```

---

## 7. 回 CRM 完成引擎配置（最后一步，别漏）

CRM 网页 → **设置 / AI 执行来源**（管理员）：

| 字段 | 填什么 |
|---|---|
| 默认背调来源 | **CLI** |
| 默认开发信来源 | **CLI** |
| CLI 适配器 | **workbuddy** |
| Runner 设备 | 选刚配对的设备（显示"在线"） |
| CLI 工作目录 | 必须是该 Runner **授权目录之一**（或其子目录） |
| CLI 超时 | 默认 900 秒；获客类长任务可调大 |

保存后页面顶部 Runner 徽标应变为在线/就绪（`cliReady: true`）。

---

## 8. 验证闭环

1. CRM 里挑一个客户/候选，发起一次 **AI 背调**；
2. 集成中心 · 本地 Runner 里应出现一条任务：`等待本机 → 执行中 → 已完成`，能看逐条执行日志；
3. 结果回到客户档案，`ai_engine_jobs` 表留档（`request_json` 存提示词、`result_json` 存结果摘要）。

API 探活（可选）：

```bash
# Runner 列表与在线状态（需登录态）
curl -s http://<CRM服务器>:4188/api/integrations/local-runners -H "Authorization: Bearer <token>"
```

---

## 9. 环境变量速查

| 变量 | 作用 | 默认 |
|---|---|---|
| `GOODJOB_WORKBUDDY_BIN` | 指定 codebuddy 二进制路径（Linux 服务器必配，若不在 PATH） | macOS 自动找 WorkBuddy.app 内置；否则 PATH 里的 `codebuddy` |
| `GOODJOB_CODEX_BIN` | 指定 Codex CLI 路径（仅 Codex 适配器用） | PATH |
| `GOODJOB_RUNNER_CONFIG` | Runner 配置文件位置 | `~/.goodjob/runner.json` |
| `GOODJOB_BROWSER_MCP_PORT` / `GOODJOB_BROWSER_CDP_PORT` | 受控浏览器端口（端口被占时改） | 自动 |
| `GOODJOB_BROWSER_DATA_DIR` / `GOODJOB_BROWSER_OUTPUT_DIR` | 浏览器资料/输出目录 | `~/.goodjob/browser-*` |
| `GOODJOB_BROWSER_EXECUTABLE` / `GOODJOB_BROWSER_PROXY_SERVER` | 指定 Chrome / 代理 | 自动 |
| `GOODJOB_PUBLIC_URL`（CRM 侧） | 配对命令里对外可见的 CRM 地址 | 请求的 host |
| `AI_ENGINE_ACQUIRE_WAIT_MS`（CRM 侧） | CLI 获客同步等待窗口 | 180000 |

---

## 10. 故障排查

| 现象 | 原因 | 处理 |
|---|---|---|
| CRM 发任务报 409，`AI_ENGINE_RUNNER_MISSING`（engineUnavailable） | Runner 没启动 / 心跳断了 | 执行机 `goodjob-runner status`；确认 start 进程活着 |
| 任务失败：`Authentication required. Please use /login` | WorkBuddy CLI 未登录 | 执行机跑一次 `codebuddy /login`（见 §3） |
| 任务失败：`WorkBuddy CLI 返回失败`（空原因） | Runner 版本旧：没剥本机代理、没读 `errors` 数组 | 升级 Runner（重打 tgz / 重拷 dist），2026-10-06 已修 |
| 任务失败：`任务工作目录不在本机 Runner 授权范围内` | CRM 的 CLI 工作目录不在 `--workspace` 白名单 | 重新 pair 加目录，或改 CRM 设置 |
| `浏览器 MCP 端口 8931 已被占用` | 两个 Runner 实例 / 旧浏览器服务残留 | 只留一个 Runner；或 `GOODJOB_BROWSER_MCP_PORT` 换端口 |
| 配对报"尝试过于频繁" | 配对接口限流（每分钟 20 次） | 等一分钟再试 |
| CLI 明明装了，doctor 显示"未检测到" | 二进制不在 PATH / 固定路径 | 设 `GOODJOB_WORKBUDDY_BIN` 后重启 Runner |
| Runner 一切正常但任务不领取 | CRM 侧 Runner 设置里选了**另一台**设备 | CRM 引擎设置里 Runner 设备选对 |

**日志位置**：Runner 自身日志跟着启动方式走（systemd→journalctl；nohup→重定向文件；CRM 侧任务日志→集成中心 · 本地 Runner 的任务详情）。

---

## 11. 日常运维速查

```bash
goodjob-runner status                          # 看连接与 CLI
goodjob-runner doctor                          # 全量体检
systemctl restart goodjob-runner               # 重启（改环境变量后）
# CRM 集成中心：撤销设备（令牌立即失效）→ 重新生成配对码 → 重新 pair
```

**升级 Runner**：有源码机器上重新 `npm run build && npm pack` → 执行机重装/重拷 `dist/` → 重启进程。配置（`~/.goodjob/runner.json`）不受升级影响，**无需重新配对**。

---

## 12. 常见问题

**Q：执行机必须装 WorkBuddy 桌面端吗？**
A：不需要。桌面端只是 macOS 上 CLI 的"随附来源"；Linux/Windows 服务器只要 `codebuddy` CLI 可执行（PATH 或 `GOODJOB_WORKBUDDY_BIN` 指定）即可。

**Q：一台执行机能同时服务多个 CRM 吗？**
A：一个 Runner 配置对应一个 CRM。多实例用 `GOODJOB_RUNNER_CONFIG` 隔离配置、`GOODJOB_BROWSER_MCP_PORT` 隔离浏览器端口。

**Q：CLI 会拿到我整台机器的权限吗？**
A：不会。CLI 子进程被限制在 `--workspace` 授权目录内工作；配对码一次性；令牌只在本机 `runner.json`；集成中心可随时撤销。

**Q：Runner 断网/重启会丢任务吗？**
A：任务在 CRM 侧留档（`ai_engine_jobs`），Runner 掉线任务会停在"等待本机"；Runner 恢复后继续领取。CRM 还有后台补收工序兜底收尾。
