# CLI 侧闭环四段技能包设计（搜客获客 / AI 背调 / 招标日报 / 开发信）

> 日期：2026-10-06 ｜ 状态：设计定稿 → 实施
> 目标：为 WorkBuddy CLI 开发四份技能包（skill），CRM 通过 CLI 调用 WorkBuddy 时由 CLI 自动加载，
> 增强四个闭环环节的执行质量，且**不得破坏现有输出协议**。

> **⚠️ 命名变更（2026-10-10）**：技能包已重命名，本文正文一律使用新名。对照：
>
> | 旧名 | 新名 | 环节 |
> | --- | --- | --- |
> | `goodjob-prospecting` | **`goodjob-lead-acquisition`** | 搜客获客 |
> | `goodjob-research` | **`goodjob-company-research`** | AI 背调 |
> | `goodjob-tender-daily` | `goodjob-tender-daily`（不变） | 招标日报 |
> | `goodjob-development-email` | **`goodjob-outreach-email`** | 开发信 |
>
> 名字的**唯一来源**是 `backend/src/ai-engine-prompts.ts::ENGINE_CLI_SKILLS`；
> 改名同时要动 `.workbuddy/skills/<name>/` 目录名与 SKILL.md 的 frontmatter `name`，
> `ai-engine-test.ts` 会去磁盘核对三者一致。

---

## 1. 背景

CRM 的 AI 闭环三段（获客 → 背调 → 开发信）已全部由 WorkBuddy CLI 2.161.4 执行：
CRM 后端冻结提示词（`ai-engine-prompts.ts`）→ Runner（`goodjob-runner`）→ CLI 子进程 → 云端大模型。
CLI 任务实测普遍成功，但模型行为有波动（标记行堆尾部、偶发输出夹带、背调深度不稳定）。
用 CLI 侧 skill 把**领域方法论**固化到 CLI 可自动加载的位置，是提升下限的手段。

## 2. 前提核实（2026-10-06 实证）

| 事实 | 证据 |
| --- | --- |
| CLI 是 `@tencent-ai/codebuddy-code`（WB 变体） | 二进制 `codebuddy-lite-wb.mjs` |
| ~~CLI 扫描三处 skill 目录：项目级 `{cwd}/.workbuddy/skills/`（`getProjectSkillsDir`）、用户级 `~/.workbuddy/skills/`（`getHomeSkillsDir`）、connector 目录~~ **← 本条已于 2026-10-10 证伪，见 §9.1** | 实测：CLI 只扫 `<cwd>/.codebuddy/skills/`、`~/.codebuddy/skills/`、connector 目录，**不认 `.workbuddy/skills/`** |
| SKILL.md 必须带 YAML frontmatter（name、description） | 二进制 `parseSkillFile` + 模板提示 |
| **Runner 传给 CLI 的 cwd = `task.workspace`** | `workbuddy-adapter.ts:206`；DB 实测 `workspace_path = /Users/sendohakria/Desktop/GoodJob_private` |

**结论：skill 放 `<workspace>/.workbuddy/skills/`（项目级）。**

> ⚠️ **2026-10-10（r42）修订**：技能的**位置不变**，但**不再纳入版本库**——改为独立成品包
> 分发（见 §11）。该目录已 `svn:ignore`；路径也随 Runner 的 `--workspace` 而定，
> 不再默认绑定某个仓库根。

## 3. 四个 skill 规格

统一格式：`SKILL.md` + YAML frontmatter（`name` / `description`），主体 ≤ 120 行，中文，聚焦方法论。

### 3.1 goodjob-lead-acquisition（搜客获客）

- **职责**：企业搜索与核实方法论——市场/行业/国家筛选顺序、候选核实证据链
  （官网 → 法人/海关/展会/B2B 交叉印证）、置信度分级（high：多源交叉且官网可达；
  medium：单一可靠来源；low：仅目录/列表出现）、反编造守则。
- **必须包含**：「任务输出契约优先」条款；`@@FOUND@@` 增量协议遵从说明（有则逐条输出，格式以任务提示词为准）；中文公司名/中港区标识的归一化提示；**禁止编造网站/邮箱/电话**。

### 3.2 goodjob-company-research（AI 背调）

- **职责**：外贸企业背调框架——六维深挖（公司与规模 / 产品与产线 / 市场与出口 / 合规与认证 / 供应链与原料 / 决策链与联系人）、来源分级（官网/政府/海关/展会/新闻/目录）、
  机会点与风险点的写法（必须可执行、与卖方产品挂钩）、score 校准口径。
- **必须包含**：输出严格遵循任务提示词的 JSON 契约（字段名、语言、无额外字段）；事实必须带来源，**不确定就写 unknown/标低置信度**；禁把背调整段抄进后续信件（那是写信 skill 的事）。

### 3.3 goodjob-outreach-email（开发信）

- **职责**：继承 repo `agent-skills/development-email` 的核心口径——阶段决定唯一目标
  （7 阶段表）、收件人角色决定口吻、无依据不写信、成稿自检（无中文/无占位符/无空泛开头/≤阶段字数/至少一个问句）。
- **必须包含**：输出契约优先条款（CRM 提示词给的字数上限/主题规则/JSON 结构为准）；中文名守卫（收件人/公司名含 CJK 时的降级策略）；不编造背调没有的事实。

### 3.4 共同硬条款（每个 skill 都写）

1. **契约优先**：任务提示词定义的输出格式（JSON-only / @@FOUND@@ / 字段名 / 语言 / 字数）具有最高优先级；本技能只提供方法论，**不引入任何新的输出格式**。
2. **禁止编造**：公司、网站、联系人、认证、数字一律不编造；缺证据就降低置信度或如实说明。
3. **静默执行**：管道任务不做过程解说，不输出契约外文本。

## 4. 安装与分发

- 位置：`{workspace}/.workbuddy/skills/{name}/SKILL.md`（四个目录）。
- **分发方式：独立成品包，不进版本库**（2026-10-10 r42 起）。产包为
  `dist-packages/GoodJob-CLI-Skills-<版本>.zip`（四个 `SKILL.md` + `install-skills.sh` + 说明），
  接收方解压后跑 `./install-skills.sh <workspace>` 即可。
- **`.workbuddy/` 整个目录不在版本库**（r42 移出）：本机开发/调试仍可把技能放在这里，
  **不可能被误提交**，`svn update` 也不会碰它。
  （踩过的坑：只删 `skills` 会留下一个空的 `.workbuddy/`，gitee 的 SVN 服务端直接拒收——
  `E200015: Empty directories is not supported`。所以父目录要一并移出。）
- 不放用户级 `~/.workbuddy/skills/`（理由见辩论二）。

## 5. 验证方案

1. **结构自检**（脚本断言）：frontmatter 两字段齐全；包含「契约优先」条款；含 `@@FOUND@@`/JSON 遵从语句（按 skill 分别断言）；主体 ≤ 120 行；无输出格式示例与 CRM 契约冲突。
2. **CLI 发现实测**：cwd=GoodJob_private、干净环境跑 `codebuddy -p`，确认 skill 出现在**CLI 自报的注册列表**里（`AVAILABLE` / `<available_skills>`），而不是「用 Glob 能在磁盘上找到文件」——后者是 2026-10-10 那次的误判来源，见 §9.1。
3. **端到端**：CRM 触发一次真实背调（或获客）CLI 任务：任务成功、JSON 解析成功、
   （获客时）`@@FOUND@@` 提取正常、留档齐全——证明协议未被 skill 破坏。
4. **回归**：`backend npm test` 保持全绿（本次不动后端代码，预期无影响，跑一遍确认）。

## 6. 三轮自我辩论记录

### 辩论一：CLI 侧 skill 会不会和冻结提示词「打架」？

- **正方（风险）**：此前已实锤模型服从不稳定（标记行堆尾部、TOA 解析失败）；skill 再注入一套口吻/格式习惯，等于给不确定的系统再叠一层变量；出问题无法归因。
- **反方（可控）**：冲突的根源是**格式指令**竞争。skill 若只写方法论（怎么核实一家公司、怎么组织背调维度），不写任何输出格式，就不构成格式竞争；再加一条「契约优先」硬条款，让 skill 在指令冲突时自我让位。
- **裁定**：采纳反方，附加防御——① 每个 skill 开头即声明契约优先；② 结构自检断言 skill 内**不得出现** JSON 字段级示例（防止微妙的字段名漂移，例如把 `sourceUrl` 写成 `source_url`）；③ 端到端回归验证协议完好。**结论：可行，风险通过内容纪律 + 自检 + 回归三道闸控制。**

### 辩论二：项目级还是用户级安装？

- **正方（项目级）**：与代码同仓同版本——改口径 = 改代码 = 一次 svn 提交；多机/重建环境自动一致；review、回滚、归因都落在仓库里。
- **反方（用户级）**：runner 的授权 workspace 理论上可配置多个，若任务 workspace 不是本仓库，项目级 skill 失效；用户级全 workspace 通用。
- **裁定**：当前 DB 实证所有 CLI 任务 workspace 都是 GoodJob_private（唯一 workspace），项目级完全覆盖且优势实质；用户级反而制造「skill 在仓库外、口径漂移不可控」的老问题。**结论：项目级。** 补充一条运行约束写入设计：**CRM 的 CLI 任务 workspace 必须保持为 GoodJob_private**（写入 MEMORY 长期规矩）。

### 辩论三：skill 内容写多细？

- **正方（详尽）**：模型越有据可依输出越稳；现有 repo skill（如 development-email 98 行）证明细口径有效。
- **反方（精简）**：CLI 每个会话都注入 skill 描述、触发时读全文；四个 skill 都在各自任务上下文里，太长会挤占任务提示词与推理预算；且重复 CRM 提示词已有的规则反而稀释指令权重。
- **裁定**：折中——**每个 ≤ 120 行**，只保留「CRM 提示词里没有的领域方法论」（六维背调框架、证据链、置信度分级、阶段表精华版）；凡是 CRM 提示词已冻结的规则（输出格式、字数上限）只引用不重复。**结论：≤120 行 + 引用而非重复。**

## 7. 风险与回滚

| 风险 | 缓解 | 回滚 |
| --- | --- | --- |
| skill 触发后输出偏离契约 | 内容纪律 + 结构自检 + 端到端回归 | 删掉 `.workbuddy/skills/` 四个目录，CLI 立即回到无 skill 状态 |
| 模型不触发 skill（描述不匹配） | ① description 写明触发词；② **任务提示词首部主动点名加载**（§10） | 影响仅是「没用上」，无破坏 |
| workspace 变更导致 skill 失效 | 已写入 MEMORY 运行约束 | 同上，失效≠破坏 |

---

## 8. 2026-10-10 增补：第四个技能包 + 三个既有技能包重写

按「**来源是否精准 / 范围是否广泛 / 是否有多重验证**」三维度复审后落地（评分与依据见当次工作记录）：

| 技能包 | 复审得分 | 预期提升 | 主要改动 |
| --- | --- | --- | --- |
| goodjob-lead-acquisition | 73 | 83 | 补「公开来源清单」（各国工商注册库 / 海关数据 / 协会 / 展会 / B2B 分地区列举）+ 本地语言检索词；**补回漏写的 `@@FOUND@@` 增量协议标记字面量** |
| goodjob-company-research | 82 | 87 | 新增「关键事实默认需 ≥2 独立来源」硬规则（认证 / 规模 / 出口 / 原料 / 决策人）；单源须显式标注、互相转载按一源计、冲突并列呈现 |
| goodjob-outreach-email | 78 | 82 | 阶段表与 `STAGE_PLANS` 的 7 阶段对齐（补 `bounced` 退信并明确「不写信」）；新增「事实可追溯」硬要求与证据不足时的降级写法 |
| **goodjob-tender-daily**（新增） | 68 | 82 | 日报此前**只有提示词本体**（`ai-engine-prompts.ts::buildTenderDailyCliPrompt`）、无配套技能包；本次补齐：全球招标门户清单（UNGM / TED / ADB + 各国政府采购门户按地区列举 + 业主平台 + 聚合站降级）、本地语言检索词、逐条双源印证、排除规则 |

**四个技能包共享的硬条款不变**（契约优先 / 禁止编造 / 静默执行），结构约束不变（frontmatter 两字段、≤120 行、无字段级 JSON 示例）。

**验证方式已升级为可复现的一条命令**（`env -i` 干净环境，避免宿主注入变量导致误判认证失败）：

```bash
cd ~/Desktop/GoodJob_private && env -i HOME="$HOME" PATH=/opt/homebrew/bin:/usr/bin:/bin TMPDIR=/tmp TERM=dumb \
  CODEBUDDY_SESSION_SKILL_DIRS="$PWD/.workbuddy/skills" \
  codebuddy --print --output-format stream-json --effort low --max-turns 2 \
  "Do NOT use any file tool. From your registered skill list only, report each as AVAILABLE or MISSING: goodjob-company-research, goodjob-lead-acquisition, goodjob-tender-daily, goodjob-outreach-email."
```

预期返回四个 `AVAILABLE`——2026-10-10 实测通过（描述文案即新版技能包内容，可据此确认不是缓存）。

> **注意**：早期版本的这条命令没有 `CODEBUDDY_SESSION_SKILL_DIRS`，且只让模型「列出 goodjob 开头的技能名」。模型当时是用 Glob 在磁盘上找到文件的，于是得到了「四个都被发现」的错误结论——磁盘上有 ≠ CLI 注册了。判断标准必须是 CLI 自报的注册状态。

---

## 9. 2026-10-10（第二轮）：加载链路修复 + 四个技能包升级到 9.2 分档

### 9.1 重大勘误：四个技能包从未被 CLI 加载

**现象**：四个技能包放在 `<repo>/.workbuddy/skills/`，磁盘上确实存在、也在版本控制里，但 CLI 任务里从未生效。

**取证**（同仓对照实验，`env -i` 干净环境，`--permission-mode plan`）：

| 放置位置 | CLI 自报 |
| --- | --- |
| `<cwd>/.codebuddy/skills/goodjob-alpha/` | `AVAILABLE` |
| `<cwd>/.workbuddy/skills/goodjob-beta/` | `MISSING` |
| 经 `CODEBUDDY_SESSION_SKILL_DIRS` 注入的 `.workbuddy/skills/` | 四个技能全部 `AVAILABLE` |

CLI 自报原文：「no skill name starting with `goodjob` appears in my `<available_skills>` … they are not loaded/invocable via the Skill tool in this session」。

**根因**：CLI（CodeBuddy Code）的项目级技能目录是 `<cwd>/.codebuddy/skills/`，`PathUtils.getProjectHomeDir()` 默认拼 `.codebuddy`（仅当 `CODEBUDDY_PROJECT_CONFIG_DIR` 或产品配置指定时才改名）。`.workbuddy/skills/` 是 WorkBuddy **桌面版**的约定，CLI 不认。桌面版会读 `~/.workbuddy/skills/`，CLI 不读。

**影响**：§8 那轮「评分 73/82/78/68 → 预期 83/87/82/82」的改造，**全部没有作用到真实 CLI 任务上**；此后的每一轮技能评分与重写同样如此。「技能没起作用」这类故障不产生任何报错，只能靠自查发现。

### 9.2 修复：由 Runner 注入技能目录

保持 `.workbuddy/skills/` 作为**唯一来源**（与桌面版共用同一份），由 Runner 在启动 CLI 时显式注入：

- `goodjob-runner/src/workbuddy-adapter.ts` 新增 `workbuddySkillDirs(workspace)`：
  - 优先读 `GOODJOB_SKILLS_DIRS`（部署方可指定，支持多目录）；
  - 否则用 `<workspace>/.workbuddy/skills`；目录不存在则返回空串、不注入（保持 CLI 默认行为）。
- `executeWorkbuddyTask` 在 spawn 时把结果写进子进程环境 `CODEBUDDY_SESSION_SKILL_DIRS`（在 `workbuddyProcessEnvironment()` 剥离之后写入，不会被剥离规则吃掉）。
- `runner-test.ts` 新增断言：伪 CLI 记录子进程收到的 `CODEBUDDY_SESSION_SKILL_DIRS`，断言其以 `.workbuddy/skills` 结尾；并覆盖「目录不存在不注入」「`GOODJOB_SKILLS_DIRS` 优先」两条分支。

**为什么不把技能包搬到 `.codebuddy/skills/`**：那会让桌面版读不到（桌面版读 `.workbuddy/`），两份目录并存又会造成口径漂移——正是本设计 §6 辩论二要避免的老问题。

### 9.3 内容升级（深度档）

统一新增的**验证内核**（四份各自自足内联，不依赖子文件——plan 模式下 `WebFetch`/`Bash` 被拒且 `Read` 不可指望，技能必须单文件可用）：

1. **来源分级 T0–T3**：官方一手 / 权威二手 / 商业数据 / 低可信，逐级写明「可作事实」还是「只作线索」。
2. **独立性判定 4 条**：同域名、同机构、同源数据、转载改写 → 一律按 1 个来源计。
3. **二源硬规则**：关键事实必须 ≥2 个互相独立的来源且其中 ≥1 个为 T0；凑不齐必须显式降级标注并注明层级。
4. **矛盾裁决协议**：T0 新 > T0 旧 > T1 > T2；一手 > 转述；具体 > 概括；无法裁决时并列呈现。
5. **置信度量化**：把 high/medium/low 从主观判断改成**分值表累加后对号入座**，堵住「为了好看硬拔高」。
6. **饱和判定**：连续 N 轮零新增 + 覆盖指定层级来源，才允许收工。
7. **交付前 Gate + 红线**：逐条自检，不通过则补检索或降级标注。

各技能专属加厚：

| 技能包 | 主要加厚内容 | 行数变化 |
| --- | --- | --- |
| goodjob-company-research | 六维 → **九维**（补财务与信用、舆情与治理、产品与技术拆细）；**假设-验证循环**；**信息保鲜度**（>3 年降权）；**事实去重**（同一条事实只报一次，防「伪多方印证」）；机会点**三段推导链**；评分**锚点表** | 66 → 223 |
| goodjob-lead-acquisition | 六类来源 × 区域登记入口 × **16 语检索词**；**检索式构造公式**与排除项；Discovery/Verification **两轮制**；**企业身份唯一性判定 6 条**；置信度分值表；**与 CRM 一致的三级键去重口径**（域名+国家 / 归一化名+国家 / 国家缺失则不并）；每类来源的坑与四类典型误判 | 83 → 198 |
| goodjob-tender-daily | **五层来源体系**（补齐非洲/中东/中亚/拉美门户）；各层可信度与核查要点表；**检索式矩阵**（四维交叉）；**逐条三重验证**（存在性/归属/相关性）；**轮内转载去重 + 跨期去重**（消费提示词的 `previouslyReported`，五类实质进展才可重报）；**编号优先于标题**的同一性判定；**来源权威度择优**（政府/国际组织 > 普通站 > 聚合站）；时效与状态判定；**排除决策树** | 69 → 222 |
| goodjob-outreach-email | 阶段 × 角色 × **三维矩阵**；各阶段**典型失败模式表**；**事实引用核对 5 步**（逐字比对专名）；**量化自检**（词数/句长/spam 词/链接/问句）；**段落结构规则**；**按阶段的问句库**；语言与本地化规则 | 61 → 167 |

四份合计 279 → 810 行。四份都保留「无代码栅栏、无字段级 JSON 示例」的纪律，避免与 CRM 冻结提示词发生格式竞争。

> **2026-10-10 补记（招标日报去重全链）**：技能包只解决了「同一轮内」的重复；跨天重复由**后端**兜——`collectReportedTenderLines()` 从近 7 天 succeeded 报告抽出已报条目注入提示词 DATA 块，`dedupeTenderItems()` 在 `normalizeTenderReport()` 内做条目级兜底（归一化链接 → 公告编号 → 标题指纹三级键，重复时按来源分级择优保留）。三级键的选择理由：只按标题判会把「官方全名标题 vs 聚合站模板标题」漏掉，只按链接判会把「同一公告多站转载」漏掉；编号是同一公告最硬的证据，长度 <8 字符不作键以免跨机构误撞。测试 `backend/src/tender-daily-dedupe-test.ts`（40 断言）。

### 9.4 验证

1. **结构自检**（可复现）：frontmatter 两字段齐全且 `name` 与目录名一致；各自必备章节关键词齐全；` ``` ` 代码栅栏零出现。
2. **Runner 单测**：`npm test --workspace goodjob-runner` 通过新增的技能目录注入断言（本机既有 `isBrowserCdpReady` 断言失败与本改动无关，见 §7 风险表）。
3. **CLI 注册实测**：见本节上方命令，四个技能全部 `AVAILABLE`，描述文案即新版内容。

### 9.5 运维要点

- **技能目录（唯一来源）**：`<workspace>/.workbuddy/skills/<name>/SKILL.md`。**2026-10-10 r42 起不纳入版本库**，改由 `dist-packages/` 下的独立成品包分发（见 §11）。
- **CLI 侧生效前提**：Runner 必须在任务工作目录下能找到该目录（或通过 `GOODJOB_SKILLS_DIRS` 指定）。Runner 重启后生效。
- **桌面版**：读 `~/.workbuddy/skills/`，与 CLI 项目级目录是两回事，互不干扰。
- **改动技能后的检查动作**：① 结构自检；② 用 §9.4 的命令确认 `AVAILABLE`；③ 跑一次真实任务确认方法论落到输出上。

---

## 10. 2026-10-10（第三轮）：技能包重命名 + 任务级点名加载

### 10.1 重命名

四个技能包按「`goodjob-` 前缀 + 业务语义」统一（对照表见文件头）。改名涉及三处，必须同时改：

1. 目录：`.workbuddy/skills/<新名>/`（当时用 `svn rename` 保住版本历史；**该目录已于 r42 移出版本库**，今后改名只需改目录名 + frontmatter + `ENGINE_CLI_SKILLS`）；
2. SKILL.md 的 frontmatter `name:`；
3. 后端常量 `ENGINE_CLI_SKILLS`（`ai-engine-prompts.ts`）。

`ai-engine-test.ts` 新增断言会**去磁盘核对**：提示词点名的技能名必须存在同名目录、且 frontmatter `name` 与目录名一致。三者不一致时测试直接失败——这是为了堵住「改了名字但漏改一处 → 技能静默不加载」这个最难查的坑。
（**r42 起改为条件断言**：技能包不在版本库，本机没装技能时跳过磁盘核对、只断言提示词侧，避免干净 checkout 跑测试变红。）

### 10.2 任务级点名加载（补上第 ③ 层）

**问题**：技能放进扫描路径只是「可用」，用不用由模型临场判断。§7 风险表里那条「模型不触发 skill」在真实任务中是常态——**技能没被加载不会有任何报错**，只是背调变浅、来源清单消失、信件口径变差，属于最难发现的静默降档。

**做法**：四个引擎提示词首部各注入一句统一指令（`ai-engine-prompts.ts::engineSkillDirective`）：

```text
FIRST STEP: load the Skill named `goodjob-company-research` using the Skill tool,
then follow that Skill's methodology for the whole task.
If that Skill is unavailable in this session, continue with the instructions below
anyway — never stop, fail or ask because a Skill is missing.
```

设计要点：
- **点名 + 反引号**：技能名走反引号字面量，避免模型把它当成自然语言描述去猜。
- **必须带降级**：技能没装 / 没注册 / 被权限策略拦下时，任务照常按提示词本体执行。加载技能失败**绝不允许**让业务任务失败——结果的价值高于仪式。
- **不改契约**：这句话只说「先去读方法论」，不引入任何输出格式；`@@FOUND@@`、JSON 契约、字数上限仍以提示词为准。
- **位置**：写在提示词数组第一个元素。`applyCliProfileToPrompt()` 会把 `[[gj-cli-options …]]` 标记插到它**上面**成为首行，两者互不干扰。

### 10.3 断言覆盖

`backend/src/ai-engine-test.ts` §2c 新增 19 条断言：

- 四个提示词各自包含 `engineSkillDirective(<技能名>)` 与反引号技能名；
- 四个技能名唯一、且符合 `^goodjob-[a-z-]+$`；
- **同名目录与 frontmatter `name` 必须真实存在**（读磁盘核对）；
- 日报提示词仍带 `previouslyReported` 跨期去重字段。


---

## 11. 2026-10-10（r42）：技能包移出版本库，改为独立成品包分发

**决定（用户明确）**：技能包**不进代码仓库**——它要能单独发给别人（含外部 / 客户），
与 CRM 源码分开交付。

**改动对照**

| 项 | 改前（r41 及以前） | 改后（r42 起） |
| --- | --- | --- |
| 版本控制 | `svn add .workbuddy/skills/`，与代码同仓同版本 | `svn rm --keep-local`：本机文件保留、**整个 `.workbuddy/` 从版本库移出**（空目录服务端不收） |
| 防回流 | 无防护 | `.workbuddy/` 目录未纳管 → 里面新增任何文件都**不可能**被误提交，无需 ignore 规则 |
| 分发方式 | 随仓库走 | 独立成品包 `dist-packages/GoodJob-CLI-Skills-<版本>.zip` |
| 改名操作 | `svn rename` 保历史 | 直接改目录名（已不受版本控制约束） |
| `npm test` 磁盘核对 | 技能目录必须存在，缺失即失败 | **条件断言**：目录不存在则跳过，只断言提示词侧 |

**为什么位置不变**：Runner 的注入逻辑（§9.2）按 `<workspace>/.workbuddy/skills` 这个相对路径找人，
CLI 注入变量、Runner 单测、四个提示词的点名都不必动。变的只是「这份内容从哪来」——
从「跟着代码走」变成「跟着成品包走」。本机开发时把它当成一个本地安装的依赖即可。

**风险与代价**

- 新克隆一份代码**不自带技能**，必须单独装（`install-skills.sh`）。这是有意的取舍：
  技能要能单独发给别人，就不能同时又是代码的一部分，否则两份来源迟早漂移。
- 技能与 CRM 版本**不再自动对应**：`ENGINE_CLI_SKILLS` 里的名字与成品包里的目录名要靠人工一致。
  缓解手段：`ai-engine-test.ts` 的条件断言 + §5.2 的 CLI 注册探针（装了技能的机器上，改名漏改会被挡住）。
- **回滚方式变了**：`svn revert` 不再能恢复技能内容（内容已不在库里）。改技能前先在成品包里留版本。
