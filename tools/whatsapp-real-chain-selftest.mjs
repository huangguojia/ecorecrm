/**
 * 「超级好用」真链路自测：不打桩、不进内存库，全部走运行中的真实服务。
 *   - 插件 3100（ts watch 实例，个人档共享库 goodjob_crm_personal）
 *   - CRM 后端 4188（launchd 个人档）
 * 令牌按 crm-auth.ts 的口径现签（HS256 / iss=goodjob-crm / aud=goodjob-crm-web / sub=真实用户）。
 * 密钥只从插件 .env 读取，不打印、不落盘。
 */
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import os from "node:os";

const ENV_PATH = `${os.homedir()}/Desktop/GoodJob_private/whatsapp-plugin/.env`;
const EXT_ID = "mfcnngeoclhdaiglofafkjogdpgkelfg"; // 本机真实扩展 id（Secure Preferences 取证所得）

function parseEnv(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

const env = parseEnv(readFileSync(ENV_PATH, "utf8"));
const SECRET = env.CRM_JWT_SECRET;
const CRM = (env.CRM_BASE_URL || "").replace(/\/$/, "");
const PLUGIN = "http://127.0.0.1:3100";
if (!SECRET || !CRM) {
  console.error("FATAL: .env 缺 CRM_JWT_SECRET / CRM_BASE_URL");
  process.exit(2);
}

// ---- 从个人库取一个真实 active 用户（requireAuth 会查 users 表）----
function realUserId() {
  const m = (env.DATABASE_URL || "").match(/^mysql:\/\/([^:]+):([^@]+)@([^:/]+):(\d+)\/([^?]+)/);
  if (!m) throw new Error("DATABASE_URL 无法解析");
  const [, user, pass, host, port, db] = m;
  const out = execFileSync("/opt/homebrew/bin/mysql", [
    "-h", host, "-P", port, "-u", user, `-p${pass}`, "-N", "-B", "-e",
    `SELECT id FROM users WHERE status='active' ORDER BY created_at LIMIT 1`, db
  ], { encoding: "utf8", timeout: 15_000 });
  const id = out.trim().split("\n")[0];
  if (!id) throw new Error("个人库没有 active 用户");
  return id;
}

const USER_ID = realUserId();

// ---- 现签 JWT（口径逐字对齐 crm-auth.ts::verifyCrmToken）----
function mintToken(sub, ttlSec = 600) {
  const b64u = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const header = b64u({ alg: "HS256", typ: "JWT" });
  const payload = b64u({ ver: 1, sub, iss: "goodjob-crm", aud: "goodjob-crm-web", iat: now, exp: now + ttlSec });
  const sig = createHmac("sha256", SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}
const TOKEN = mintToken(USER_ID);
const AUTH = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };

// ---- 断言器 ----
const results = [];
function record(name, ok, evidence) {
  results.push({ name, ok, evidence });
  console.log(`${ok ? "✅" : "❌"} ${name}${evidence ? ` — ${evidence}` : ""}`);
}
async function call(base, path, options = {}) {
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: { ...AUTH, ...(options.headers || {}) },
    signal: AbortSignal.timeout(90_000)
  });
  let body = null;
  const text = await res.text();
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

const RUN = `selftest-${Date.now()}`;
console.log(`自测目标：插件 ${PLUGIN} / CRM ${CRM} / 用户 ${USER_ID.slice(0, 8)}…\n`);

/* T0 双服务健康 */
{
  const plugin = await call(PLUGIN, "/api/health/live", { headers: { authorization: "" } }).catch((e) => ({ status: 0, body: String(e) }));
  const crm = await call(CRM, "/api/health", { headers: { authorization: "" } }).catch((e) => ({ status: 0, body: String(e) }));
  record("T0 双服务健康（插件+CRM）", plugin.status === 200 && crm.status === 200,
    `plugin=${plugin.status} crm=${crm.status}`);
}

/* T1 扩展登录来源放行：chrome-extension Origin 打登录口，绝不许 403「不允许的请求来源」 */
{
  const res = await fetch(`${CRM}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: `chrome-extension://${EXT_ID}` },
    body: JSON.stringify({ email: "selftest-not-a-user@example.invalid", password: "wrong-password" }),
    signal: AbortSignal.timeout(30_000)
  });
  const text = await res.text();
  const is403Origin = res.status === 403 && text.includes("不允许的请求来源");
  record("T1 扩展登录来源放行（401 凭据错误 ≠ 403 来源拒绝）", res.status !== 403 && !is403Origin,
    `status=${res.status} body=${text.slice(0, 80)}`);
}

/* T2 训练上报（含跨语言旗舰样本 + 中文护栏）→ 期望 201 且顺带入库 */
const PROFILE_NAME = `销售风格-自测-${RUN}`;
const profileInput = {
  name: PROFILE_NAME,
  tone: "友好、专业、简短",
  summary: "外贸销售风格：先回答问题，再给一个推进点。",
  languages: ["zh", "en"],
  guardrails: ["不承诺未确认的交期", "不报低于底价的价格"],
  examples: [
    { inbound: "起订量是多少？", reply: "我们的起订量是 500 个，超过 1000 个可以谈阶梯价。", score: 1 },
    { inbound: "交期要多久？", reply: "常规订单 25 天内出货，加急 15 天，具体以生产排期确认。", score: 1 },
    { inbound: "可以寄样品吗？", reply: "可以，样品免费，运费到付；确认订单后运费从货款里扣。", score: 1 }
  ]
};
let profileId = "";
{
  const res = await call(PLUGIN, "/api/v1/training/profiles/import", {
    method: "POST", body: JSON.stringify(profileInput)
  });
  const lib = res.body?.library;
  profileId = res.body?.profile?.id || "";
  // created+skipped 必须 = 3 问答 + 2 护栏（policy）；重跑时内容指纹已在 → 全部 skipped，同为正确
  const covered = Number(lib?.created ?? 0) + Number(lib?.skipped ?? 0);
  record("T2 训练上报全链（档案+训练库）", res.status === 201 && Boolean(profileId) && covered === 5,
    `status=${res.status} profile=${profileId.slice(0, 8)}… library.created=${lib?.created} skipped=${lib?.skipped}`);
}

/* T3 幂等：同内容再推一次 → 200 updated:false、同一份档案 */
{
  const res = await call(PLUGIN, "/api/v1/training/profiles/import", {
    method: "POST", body: JSON.stringify(profileInput)
  });
  const same = res.body?.profile?.id === profileId;
  record("T3 重复推送幂等（不重复落库）", res.status === 200 && res.body?.updated === false && same,
    `status=${res.status} updated=${res.body?.updated} sameId=${same}`);
}

/* T4 跨语言命中：英文 MOQ 问句打中文问答对（修复前共同特征恒 0） */
{
  await call(PLUGIN, "/api/v1/training/library", {
    method: "POST",
    body: JSON.stringify({ kind: "qa", question: "起订量是多少？有最低数量要求吗？", answer: "起订量 500 个，1000 个以上走阶梯价。", priority: 5 })
  });
  const res = await call(PLUGIN, "/api/v1/training/library/match", {
    method: "POST", body: JSON.stringify({ body: "What's your MOQ for this item? And lead time?" })
  });
  const hits = Array.isArray(res.body?.hits) ? res.body.hits : [];
  const cross = hits.find((hit) => String(hit.entry?.question || "").includes("起订量"));
  const verdict = String(res.body?.verdict || "");
  record("T4 跨语言检索（英文 MOQ → 中文起订量）", res.status === 200 && Boolean(cross) && (cross.expandedHits ?? 0) > 0 && verdict.includes("词典等价命中"),
    `hits=${hits.length} crossHit=${Boolean(cross)} expandedHits=${cross?.expandedHits} verdict="${verdict.slice(0, 60)}"`);
}

/* T5 真实出稿（rules 引擎，吃刚推的档案/库）：英文问句 → 有回复、有依据 */
{
  const res = await call(PLUGIN, "/api/v1/auto-chat/suggest", {
    method: "POST",
    body: JSON.stringify({
      engine: "rules",
      contact: { phone: "+8613800000001", name: "Selftest 客户" },
      conversationKey: RUN,
      messages: [
        { direction: "inbound", body: "Hi, what's your MOQ for this item?", occurredAt: new Date().toISOString() },
        { direction: "inbound", body: "And the lead time?", occurredAt: new Date().toISOString() }
      ]
    })
  });
  const reply = res.body?.reply;
  const text = String(reply?.reply || "");
  const grounded = text.includes("500") || text.includes("起订") || text.includes("25") || text.includes("15");
  record("T5 回复推荐出稿（rules 引擎真实组稿）", res.status === 200 && text.length > 0 && grounded,
    `status=${res.status} source=${reply?.source ?? "?"} blocked=${reply?.blocked ?? false} reply="${text.slice(0, 70)}"`);
}

/* T6 资料推荐检索 → 反馈 → 效果报表（闭环，用库里真实存在的资源 id） */
{
  const dir = await call(PLUGIN, "/api/v1/resources/search", { method: "POST", body: JSON.stringify({ q: "" }) });
  const all = Array.isArray(dir.body?.resources) ? dir.body.resources : [];
  record("T6a-目录 资料检索透传 CRM", dir.status === 200 && all.length > 0, `status=${dir.status} 目录资源=${all.length}`);

  // 召回验证：库里有 "Solar Street Light" 产品，英文 query 必须能打中
  const search = await call(PLUGIN, "/api/v1/resources/search", {
    method: "POST",
    body: JSON.stringify({
      conversationKey: RUN,
      messages: [{ direction: "inbound", body: "Do you have a solar street light catalog?", occurredAt: "" }]
    })
  });
  const hits = Array.isArray(search.body?.resources) ? search.body.resources : [];
  const hitSolar = hits.some((row) => String(row.title || "").toLowerCase().includes("solar"));
  record("T6b 召回（英文问句打中真实资料）", search.status === 200 && hitSolar,
    `status=${search.status} hits=${hits.length} solar=${hitSolar} tookMs=${search.body?.tookMs}`);

  if (all.length) {
    const target = all[0];
    await call(PLUGIN, "/api/v1/resources/feedback", {
      method: "POST",
      body: JSON.stringify({
        conversationKey: RUN,
        items: [{ resourceId: target.id, sourceType: target.sourceType, action: "accepted" }]
      })
    });
    await new Promise((resolve) => setTimeout(resolve, 800)); // 埋点是旁路落库
    const stats = await call(PLUGIN, "/api/v1/resources/stats?days=30");
    const totals = stats.body?.totals || {};
    const item = (stats.body?.items || []).find((row) => row.resourceId === target.id);
    record("T6c 埋点→效果报表闭环（采纳数回到报表）", stats.status === 200 && Number(totals.accepted ?? 0) >= 1 && Boolean(item),
      `status=${stats.status} totals=${JSON.stringify(totals)} item=${item ? `${item.resourceId.slice(0, 20)}… accepted=${item.counts?.accepted}` : "无"}`);
  }
}

/* T7 引擎能力状态（扩展设置页「引擎」卡片的数据源） */
{
  const res = await call(PLUGIN, "/api/v1/auto-chat/engine");
  const body = res.body || {};
  record("T7 引擎能力状态可用", res.status === 200 && "engine" in body || "cli" in body || "available" in body,
    `status=${res.status} keys=${Object.keys(body).slice(0, 6).join(",")}`);
}

/* T8 未登录必须被拦（安全底线） */
{
  const res = await fetch(`${PLUGIN}/api/v1/resources/stats?days=30`, { signal: AbortSignal.timeout(15_000) });
  record("T8 未登录访问被 401 拦截", res.status === 401, `status=${res.status}`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
if (failed.length) {
  console.log("未通过项：");
  for (const item of failed) console.log(`  - ${item.name}`);
  process.exit(1);
}
