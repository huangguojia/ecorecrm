#!/usr/bin/env node
/* 「右上文字」修改前后对比出图
   同一页面：摘掉 #head-text-refine = 改前；装回 = 改后。同口径裁剪右上区。
   用法：node shoot-compare.mjs */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CFT = "/Users/sendohakria/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const BASE = "http://127.0.0.1:4188/";
const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(HERE, "shots-cmp");
const PORT = 9452, W = 1680, H = 1200;
/* 裁剪：右上区（含顶栏右上账号 + 页头统计块） */
const CLIP = { x: 620, y: 0, width: 1060, height: 205 };

const VIEWS = [
  ["products", "产品维护"], ["shipments", "发货跟踪"], ["knowledge", "资料库"], ["exam", "考试"],
  ["approval-center", "审批中心"], ["outreach-journey", "发信明细"], ["pipeline", "商机"], ["leads", "线索"],
  ["commission", "提成对账"], ["customer-pool", "客户公池"], ["maintenance-center", "维护中心"], ["plan-growth", "增长计划"],
  ["daily-reports", "日报"], ["reports", "报表"], ["todo", "待办中心"], ["prospect-list", "搜客清单"],
  ["agent-skills", "技能库"], ["integration-center", "对接中心"], ["email-return-flow", "回流"], ["sales-skill-center", "技能中心"]
];

fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const child = spawn(CFT, ["--headless=new", `--remote-debugging-port=${PORT}`, "--no-sandbox", "--disable-gpu",
  "--disable-gpu-sandbox", "--in-process-gpu", "--disable-software-rasterizer", "--disable-dev-shm-usage",
  "--no-first-run", "--hide-scrollbars", `--window-size=${W},${H}`, "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
let stderr = ""; child.stderr.on("data", (d) => { stderr += d; });

let ws, id = 0; const pending = new Map();
const send = (m, p) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
async function ev(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "eval fail");
  return r.result.value;
}
async function shot(name) {
  const r = await send("Page.captureScreenshot", { format: "png", clip: { ...CLIP, scale: 1 }, captureBeyondViewport: true });
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(r.data, "base64"));
}

(async () => {
  let url = null;
  for (let i = 0; i < 80; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = l.find((t) => t.type === "page"); if (p?.webSocketDebuggerUrl) { url = p.webSocketDebuggerUrl; break; } } catch {}
    await sleep(200);
  }
  if (!url) throw new Error("CDP 连不上\n" + stderr.slice(-400));
  ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } });
  await send("Runtime.enable"); await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: BASE }); await sleep(5000);

  await ev(`(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));
    const set=(q,v)=>{const e=document.querySelector(q); if(!e) return; e.value=v; e.dispatchEvent(new Event("input",{bubbles:true}));};
    set("#loginEmail","admin@goodjob.com"); set("#loginPassword","goodjob123");
    document.querySelector("#loginButton").click(); await s(9000); return 1;})()`);

  // 关掉动画 + 隐藏 toast（本机 CLI 日报通知会盖住右上区）
  await ev(`(()=>{const st=document.createElement('style');st.id="__still";
    st.textContent="*,*::before,*::after{animation:none !important;transition:none !important}"
      +"[class*=toast],[class*=Toast],#gjToast,.toast{display:none !important;visibility:hidden !important;opacity:0 !important}";
    document.head.appendChild(st);return 1;})()`);

  for (const [v, label] of VIEWS) {
    await ev(`(()=>{document.querySelector('[data-view="${v}"]')?.click();return 1;})()`);
    await sleep(1500);
    const has = await ev(`(function(){const s=document.getElementById('head-text-refine');
      if(!s) return 'missing'; const keep=s; window.__ht=s; s.remove(); return 'removed';})()`);
    if (has === "missing") { console.log(`  !! ${v} 未找到 refine 样式块`); }
    await sleep(500);
    await shot(`${v}-before`);
    await ev(`(function(){const s=window.__ht; if(s && !document.getElementById('head-text-refine')) document.body.appendChild(s); return 1;})()`);
    await sleep(400);
    await shot(`${v}-after`);
    console.log(`  ✓ ${v} ${label}`);
  }

  // 生成对比页
  const rows = VIEWS.map(([v, label]) => `
    <section class="cmp">
      <h3>${label}<span>${v}</span></h3>
      <div class="pair">
        <figure><figcaption>改前</figcaption><img src="./${v}-before.png"></figure>
        <figure><figcaption>改后</figcaption><img src="./${v}-after.png"></figure>
      </div>
    </section>`).join("");
  const html = `<!doctype html><meta charset="utf-8"><title>右上文字 · 修改前后</title>
<style>
 body{margin:0;background:#eef2f8;font:14px/1.5 -apple-system,"PingFang SC",sans-serif;color:#131c2e}
 .wrap{width:1500px;margin:0 auto;padding:26px 0 40px}
 h1{font-size:22px;margin:0 0 6px} .lead{color:#5b6b86;margin:0 0 22px;font-size:13px}
 .cmp{margin-bottom:22px;background:#fff;border:1px solid #dde5f0;border-radius:12px;overflow:hidden}
 .cmp h3{margin:0;padding:11px 16px;font-size:14px;font-weight:600;border-bottom:1px solid #eef2f8;background:#f8fafd}
 .cmp h3 span{margin-left:9px;color:#94a3b6;font-weight:400;font-size:12px;font-family:ui-monospace,Menlo,monospace}
 .pair{display:grid;grid-template-columns:1fr 1fr}
 figure{margin:0;border-right:1px solid #eef2f8}
 figure:last-child{border-right:0}
 figcaption{padding:5px 14px;font-size:11px;color:#94a3b6;letter-spacing:.06em;background:#fcfdff}
 img{display:block;width:100%}
</style>
<div class="wrap">
 <h1>页面右上文字 · 修改前后对照</h1>
 <p class="lead">同页面同机位（1680×1200 视口，裁右上 1060×205）。左＝改前，右＝改后，均在同一份代码上以「摘掉样式块」的方式还原。</p>
 ${rows}
</div>`;
  fs.writeFileSync(path.join(OUT, "compare.html"), html);
  console.log("\n对比页:", path.join(OUT, "compare.html"));
  child.kill("SIGKILL"); process.exit(0);
})();
