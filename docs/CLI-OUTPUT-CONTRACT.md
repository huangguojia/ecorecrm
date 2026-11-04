# CLI 输出契约 · 设计说明

> **一句话**：CLI 敞开了挖，返回的数据格式必须贴合 CRM——防止显示不出来，信息尽量全面。

这份文档是 2026-10-10 明确的原则，适用于**所有**走本机 CLI 的 CRM 任务
（获客 / 背调 / 竞标日报 / 开发信 / 资料识别）。

---

## 1. 要解决的三类失效

以前「和 CRM 的数据格式配合」出问题，几乎都是下面三种之一：

| 失效模式 | 用户看到的现象 | 根因 |
|---|---|---|
| **整单作废** | 「本机 CLI 没有返回可解析的 JSON 结果，请查看集成中心的执行日志」 | 解析器不做确定性修复；抠不出 JSON 就直接判任务失败，`resultText` 里的内容全部作废 |
| **条目凭空消失** | 搜到 40 家只显示 30 家；某几条公告怎么都不出现 | 用精确字段名取值（`record.company`、`record.title`），模型改写成 `company_name` / `公告标题` 就被丢弃 |
| **信息被静默截断** | 背调只列出 8 条事实，剩下的不知道去哪了 | 上限即丢弃（`slice(0, 8)`），没有溢出通道，也不告诉用户「还有多少条」 |

三种失效都不报错——**它们只表现为"结果看起来有点少"**，所以极难被发现。

---

## 2. 四层原则

「敞开了挖」与「格式贴合」表面上矛盾，用分层化解：
**输入侧完全放开，输出侧只有一个形状，中间的转换层永远不丢信息。**

### L0 技能层（输入侧第 0 步）

每个引擎任务的提示词首行都要求 CLI 先用 Skill 工具加载对应的领域技能
（`goodjob-lead-acquisition` / `goodjob-company-research` / `goodjob-tender-daily` / `goodjob-outreach-email`，
单一来源 `ai-engine-prompts.ts::ENGINE_CLI_SKILLS`）。

它管的是**输入侧**的「怎么挖更专业」，与本文件的输出契约互补——
技能决定「怎么挖」，契约决定「怎么写回来」。技能未注册时任务照常执行，**不构成失败**。
详见 `CLI-SKILLS-DESIGN.md` §10。

### L1 契约层（输出侧唯一）

挖掘的广度不受限（来源、轮次、深度全放开），但**写回来的结构只有一份**。
提示词给出与 CRM 数据结构同名的 JSON 形状：字段名用 CRM 的驼峰命名，枚举值与 CRM 状态机一致。

CRM 渲染不了的字段，要求模型产出也没有意义——契约只要求 CRM 认得的键。

代码里的**单一来源**：`ai-engine-prompts.ts::engineOutputContract()`，
四个 CLI 任务的提示词都插入同一段话术（改一处、四处生效）。

这段话术包含五条硬约束：

1. 只返回一个 JSON 对象——不要 markdown 围栏、不要前后说明、**不要包一层 `{"data":…}`**；
2. 键名必须与给定的完全一致，不许改名、翻译、自创；
3. 缺值也要保持形状：字符串用 `""`、数组用 `[]`，不许省略键；
4. 数字必须是 JSON 数字（`85`），不是 `"85"` 也不是 `"85%"`；
5. 链接必须是绝对 `https://`；没核实就留空，**不许猜链接**。

> 为什么强调「不要包壳 / 不要改键名」：CRM 的解析层做了别名与剥壳，但那是**兜底**，不是契约。
> 契约越稳定，兜底越少被触发，「挖到了却显示不出来」的概率就越低。

### L2 宽容读入层（防「显示不出来」）

**绝不用精确字段名取值。** 模型实测会在这些写法之间摇摆：

| 写法 | 实例 |
|---|---|
| 下划线 / 驼峰 | `company_name` / `companyName` / `company` |
| 中文键名 | `"国家"` / `"主营业务"` / `"公告标题"` / `"已授标"` |
| 类型漂移 | `"confidence": "88"`、`"relevance": "85%"` |
| 标量当数组 | `"talkTracks": "只有一句"` |
| 字符串里的 JSON | `"opportunities": "[\"A\",\"B\"]"` |
| 对象当字符串 | `"opportunities": [{"text": "…"}]` |
| 外层包裹 | `{"data":{…}}` / `{"result":{…}}` / `{"draft":{…}}` |

这些全部由 `backend/src/engine-output.ts` 的读取原语吸收：

| 原语 | 作用 |
|---|---|
| `unwrapEnginePayload` | 剥掉 `data`/`result`/`output`/`payload`/`response`/`answer` 外壳；**顶层已有业务字段时不误剥** |
| `pickRaw` / `readText` | 按别名顺序取第一个有内容的值 |
| `readBlockText` | 多行文本（邮件正文、摘要）——**保留换行**，不压成一行 |
| `readInt` / `readNumber` | 数字与数字字符串都收（`"85%"` → 85）；非法值返回 `null`，不瞎猜 |
| `readTextList` | `string[]` / 单 string / `{text\|value\|label\|name}` 对象数组 |
| `readRecordList` | 对象数组；同时处理「字符串里的 JSON 数组」与 `{items:[…]}` 包裹 |
| `readUrl` | 只有合法 http(s) 才算数，避免前端渲染坏链接 |
| `toArray` | 单值 → 单元素数组 |

### L3 信息保全层（防丢）

**所有上限只约束「首屏渲染」，不约束「保留」。**

- `splitByLimit(items, limit)` → `{ primary, overflow }`；
- 背调：`opportunities` / `talkTracks` / `risks` / `findings` / `sources` 的溢出条目
  统一进 `overflow: string[]`，由 `applyResearchEnginePatch` 并进事实列表（`group: "引擎补充"`），
  **一条都不丢**；
- 日报：超出的公告在 `notes` 里如实写明「另有 N 条相关公告未在首屏展示，已保留在本次任务的执行留档中」；
- 获客：首屏 60 家（前端列表可滚动承载）。

> 底线：**可以「没显示」，不可以「没保留」，更不可以「不告诉用户」。**

### L4 诚实降级层

真的拿不到结构化结果时，**不报「无法解析」**，而是按任务类型抢救 + 如实归因。

`server.ts::finalizeEngineCliJobWithoutJson()`：

| 任务 | 降级动作 |
|---|---|
| 获客 | `@@FOUND@@` 流式增量与最终 JSON 是**两条独立通道**——先把流式里已出现的公司收干净，再如实报入池数量。有入池就标 `succeeded`，避免「候选清单里明明有公司，界面却说任务失败」 |
| 背调 | 背调骨架本身是 CRM 侧已核实的证据，引擎补丁读不到不代表没有价值 → 骨架照常落档，说明补丁缺失 |
| 日报 | 给一版带归因说明的空报告（宁空勿假），而不是让整天的日报显示不出来 |
| 开发信 | 模板兜底的草稿仍然可用，标明「需人工润色后发送」 |

同时把 CLI 的**原文摘要**（`rawPreview`，600 字）带回去——用户至少能看到 CLI 说了什么。
归因要指向真实原因（输出被截断 / 不是 JSON / 什么都没返回），而不是笼统的「解析失败」。

---

## 3. 代码位置速查

| 位置 | 职责 |
|---|---|
| `backend/src/engine-output.ts` | 宽容读入原语（L2/L3），文件头写明四层原则 |
| `backend/src/ai-engine-prompts.ts::engineOutputContract()` | 输出契约段（L1），四个提示词共用 |
| `backend/src/ai-engine-prompts.ts::extractEngineJson()` | 抠 JSON：围栏 → 前后有说明 → 多段取最后一个 → **整段文本修复**（全角标点 / 裸换行 / 尾随逗号） |
| 同文件 `normalizeAcquisitionCompanies` / `normalizeResearchPatch` / `normalizeTenderReport` / `normalizeEmailPatch` | 各任务的规范化（别名 + 强转 + 溢出） |
| `backend/src/server.ts::finalizeEngineCliJobWithoutJson()` | 降级收尾（L4） |

---

## 4. 怎么验证

```bash
cd backend
NODE_ENV=test npx tsx src/engine-output-contract-test.ts   # 契约层 41 条断言（含真实脏输出样本）
npm test                                                   # 全量（含 ai-engine-test / tender-daily-dedupe-test）
```

契约测试的每个用例都对应一类**实测发生过**的脏输出，目的不是验证「正常输出能解析」，
而是验证「不正常输出也能接住」。

---

## 5. 新增一个 CLI 任务时（checklist）

1. **提示词**：插入 `engineOutputContract()`；JSON 形状用 CRM 的键名，不发明新命名；
2. **数量**：写「有几条给几条」而不是「最多 N 条」——数量的裁剪交给 CRM 首屏，不限制检索广度；
3. **解析器**：走 `engine-output.ts` 的原语，**不要**写 `record.xxx`；所有别名集中成一张常量表并注释来源；
4. **上限**：配 `splitByLimit` + 溢出通道 + 告知用户，禁止裸 `slice()` 丢弃；
5. **收口**：在 `finalizeEngineCliJob` 的 kind 分支里补降级路径；
6. **测试**：至少加一条「字段名被改写」和一条「超上限不丢」的用例。

---

## 6. 已知边界（诚实记录）

- 别名表是**枚举**而非模糊匹配：模型造出别名表之外的新键名仍会丢。因此契约段要求「键名不许改」，
  别名表只覆盖实测出现过的写法；
- 日报首屏 25 条、获客 60 家是**渲染上限**，不是能力上限；超出的留档在 `ai_engine_jobs.result_json`，
  目前前端没有「查看被折叠条目」的入口（后端已保留，属于待做的 UI 补充）；
- 降级说明写在 payload 的 `message` / `rawPreview` 里，后端与轮询接口都已透传；
  但前端目前只在获客路径消费 `payload.acquisition`，**尚未把 `message` 渲染出来**——
  也就是说「降级发生了」这件事用户暂时看不到（入池数量仍然照常显示）；
- `readEnum` 已实现但暂未接入，留给后续需要枚举收敛的字段。
