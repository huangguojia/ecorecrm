import { chromium } from "@playwright/test";

const BASE = "http://127.0.0.1:4188";
const OUT = "/Users/sendohakria/WorkBuddy/2026-09-12-15-45-50/outputs";
const GOAL = "泰国做化工配料的贸易商，需要称重配料系统";

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.evaluate(async () => {
  const r = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "admin@goodjob.com", password: "goodjob123" })
  });
  const d = await r.json();
  localStorage.setItem("gj_user", JSON.stringify(d.user));
  localStorage.removeItem("gj.autoflow.v2");
});
await page.reload({ waitUntil: "networkidle" });
await page.click('button[data-view="auto-flow"]');
await page.waitForTimeout(1200);

await page.fill("#afCommandInput", GOAL);
await page.click("#afCommandRun");
console.log("pipeline started:", new Date().toISOString());

const deadline = Date.now() + 25 * 60_000;
let skipped = false;
let lastLine = "";
while (Date.now() < deadline) {
  await page.waitForTimeout(10_000);
  const snap = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("gj.autoflow.v2") || "{}");
    const status = state.status || {};
    const progress = state.progress || {};
    const logs = (state.logs || []).slice(-2).map((l) => `${l.kind}:${l.text}`).join(" | ");
    const confirmVisible = !!document.querySelector(".af-send-confirm");
    const artifacts = state.artifacts || {};
    return {
      status: Object.fromEntries(Object.keys(status).map((k) => [k, `${status[k]}/${progress[k] || 0}`])),
      lastLogs: logs,
      confirmVisible,
      opps: (artifacts.opportunities || []).length,
      drafts: (artifacts.drafts || []).length,
      sent: (artifacts.sent || []).length
    };
  }).catch((e) => ({ error: String(e).slice(0, 80) }));
  const line = JSON.stringify(snap);
  if (line !== lastLine) {
    console.log(new Date().toISOString().slice(11, 19), line);
    lastLine = line;
  }
  if (snap.confirmVisible && !skipped) {
    await page.screenshot({ path: `${OUT}/自动流-发送确认门禁.png` });
    console.log(">>> 发送确认门禁出现：截图已存，点击「跳过发送」（不真发邮件）");
    await page.click('[data-af-action="send-skip"]');
    skipped = true;
    continue;
  }
  const st = snap.status || {};
  const allDone = ["prospect", "research", "compose", "send", "monitor"].every((k) => String(st[k] || "").startsWith("done"));
  if (allDone) {
    console.log(">>> 全部节点 done，流水线跑通");
    break;
  }
}

await page.screenshot({ path: `${OUT}/自动流-真实链路-跑完.png` });
const final = await page.evaluate(() => {
  const state = JSON.parse(localStorage.getItem("gj.autoflow.v2") || "{}");
  return {
    status: state.status,
    artifacts: {
      parsed: state.artifacts?.parsed,
      lfindTaskId: state.artifacts?.lfindTaskId,
      opps: (state.artifacts?.opportunities || []).map((o) => `${o.company}${o.email ? " <有邮箱>" : " <无邮箱>"}`),
      drafts: (state.artifacts?.drafts || []).map((d) => `${d.company}: ${d.subject} (${d.engineNote})`),
      sent: state.artifacts?.sent
    },
    logs: (state.logs || []).slice(-25).map((l) => `${l.kind}|${l.text}`)
  };
});
console.log("FINAL:", JSON.stringify(final, null, 2));
await browser.close();
