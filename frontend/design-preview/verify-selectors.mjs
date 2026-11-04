#!/usr/bin/env node
/* 核验各统计块的宿主视图 id —— 避免 CSS 选择器静默不命中 */
import { spawn } from "node:child_process";
const CFT = "/Users/sendohakria/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const PORT = 9448, BASE = "http://127.0.0.1:4188/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const child = spawn(CFT, ["--headless=new", `--remote-debugging-port=${PORT}`, "--no-sandbox", "--disable-gpu",
  "--disable-dev-shm-usage", "--no-first-run", "--hide-scrollbars", "--window-size=1680,1100", "about:blank"],
  { stdio: ["ignore", "pipe", "pipe"] });
let ws, id = 0; const pending = new Map();
const send = (m, p) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
async function ev(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description);
  return r.result.value;
}
(async () => {
  let url = null;
  for (let i = 0; i < 80; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = l.find((t) => t.type === "page"); if (p?.webSocketDebuggerUrl) { url = p.webSocketDebuggerUrl; break; } } catch {}
    await sleep(200);
  }
  ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } });
  await send("Runtime.enable"); await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1680, height: 1100, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: BASE }); await sleep(5000);
  await ev(`(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));
    const set=(q,v)=>{const e=document.querySelector(q); if(!e) return; e.value=v; e.dispatchEvent(new Event("input",{bubbles:true}));};
    set("#loginEmail","admin@goodjob.com"); set("#loginPassword","goodjob123");
    document.querySelector("#loginButton").click(); await s(9000); return 1;})()`);

  const cls = ["customer-pool-summary", "mt-summary", "file-center-metrics", "exam-metric-strip",
    "agent-skills-summary", "commission-kpis", "dy-auto-stats", "oj-summary", "dense-grid",
    "lead-command-strip", "report-hero-top", "pc-stats", "sh-stats", "sales-training-quality-empty",
    "integration-launcher-head", "todo-live-state", "pipeline-summary", "plan-task-stats", "approval-metrics"];
  for (const v of ["customers", "knowledge", "exam", "agent-skills", "commission", "daily-reports",
    "outreach-journey", "pipeline", "approval-center", "products", "shipments", "maintenance-center",
    "customer-pool", "plan-growth", "sales-distillation", "integration-center", "todo", "reports", "prospect-list", "leads"]) {
    await ev(`(()=>{document.querySelector('[data-view="${v}"]')?.click(); return 1;})()`);
    await sleep(900);
  }
  // 一次性把每个类所在视图 id 打出来
  const out = await ev(`(function(){
    const cls=${JSON.stringify(cls)};
    const res={};
    for(const c of cls){
      const el=document.querySelector('.'+c);
      if(!el){res[c]='(未渲染)';continue;}
      const view=el.closest('.view');
      res[c]=(view?('#'+view.id):'(无 .view 祖先)');
      // 是否在右上方（top<200 且 left 超过容器中线）
      const vr=view?view.getBoundingClientRect():null, r=el.getBoundingClientRect();
      res[c]+= vr? (' top='+Math.round(r.top-vr.top)) : '';
    }
    return JSON.stringify(res,null,1);})()`);
  console.log(out);
  child.kill("SIGKILL"); process.exit(0);
})();
