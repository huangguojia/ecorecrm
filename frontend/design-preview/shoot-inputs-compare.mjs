#!/usr/bin/env node
/* 输入框改前/改后同机位出图：
   同一份代码上 `#input-refine` 摘掉 → 截图（改前）→ 装回 → 截图（改后），零偏差。
   用法：node shoot-inputs-compare.mjs */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CFT = "/Users/sendohakria/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const BASE = "http://127.0.0.1:4188/";
const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.resolve(HERE, "shots-input-cmp");
const PORT = 9449;
const W = 1680, H = 1200;

/* [视图, 标签, {click: 按钮文案, anchor: 选择器, anchorText: 文本, pad, delay}] */
const TARGETS = [
  ["customers", "客户 · 筛选工具条", { anchor: ".customer-filter-row" }],
  ["leads", "线索 · 筛选工具条", { anchor: ".lead-filter-row" }],
  ["products", "产品维护 · 搜索与币种", { anchor: ".pc-toolbar" }],
  ["shipments", "发货跟踪 · 搜索", { anchor: ".sh-boardbar" }],
  ["agent-skills", "技能库 · 搜索与筛选", { anchor: ".agent-skills-toolbar" }],
  ["prospect-list", "搜客清单 · 工具条", { anchor: ".prospect-toolbar" }],
  ["profile", "个人主页 · 账号资料表单", { anchor: ".profile-form-grid" }],
  ["settings", "系统设置 · 公司资料", { anchorText: "公司资料" }],
  ["settings", "系统设置 · 单据 OCR 来源", { anchorText: "OCR 来源" }],
  ["settings", "系统设置 · AI 执行来源", { anchorText: "AI 执行来源" }],
  ["memos", "备忘 · 标题与元信息", { anchor: ".memo-fields", pad: { top: 70 } }],
  ["todo", "待办中心 · 快速新增", { anchor: ".todo-toolbar" }],
  ["maintenance-center", "自动维护 · 规则矩阵", { anchor: ".mt-matrix" }],
  // ---- 弹窗 ----
  ["pipeline", "弹窗 · 新增商机", { click: "新增商机", modal: true }],
  ["customers", "弹窗 · 新增客户", { click: "新增客户", modal: true }],
  ["leads", "弹窗 · 新增线索", { click: "新增线索", modal: true }],
  ["products", "弹窗 · 新增产品", { click: "新增产品", modal: "#productModal" }],
  ["shipments", "弹窗 · 新增发货单", { click: "新增发货单", modal: "#shipmentModal" }],
  ["profile", "弹窗 · 登记发件邮箱", { click: "登记发件邮箱", modal: true }],
  ["reminders", "弹窗 · 设置提醒规则", { click: "设置提醒规则", modal: true }],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

const child = spawn(CFT, [
  "--headless=new", `--remote-debugging-port=${PORT}`,
  "--no-sandbox", "--disable-gpu", "--disable-gpu-sandbox", "--in-process-gpu",
  "--disable-software-rasterizer", "--disable-dev-shm-usage",
  "--no-first-run", "--no-default-browser-check", "--hide-scrollbars",
  `--window-size=${W},${H}`, "about:blank"
], { stdio: ["ignore", "pipe", "pipe"] });
let stderr = "";
child.stderr.on("data", (d) => { stderr += d; });

let ws, id = 0;
const pending = new Map();
const send = (method, params) => new Promise((res, rej) => {
  const i = ++id;
  pending.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method, params: params || {} }));
});
async function evaluate(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "eval failed");
  return r.result.value;
}
async function shot(name, clip) {
  const params = { format: "png" };
  // clip 用的是视口坐标（滚进视口后再取），所以不要 captureBeyondViewport
  if (clip) params.clip = { ...clip, scale: 1 };
  const r = await send("Page.captureScreenshot", params);
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(r.data, "base64"));
}

/* 隐藏 toast（本机 CLI 日报通知会正好盖住右上区）+ 关掉动画 */
const STILL = `(()=>{
  let st = document.getElementById('__still');
  if (!st) { st = document.createElement('style'); st.id='__still';
    st.textContent = '*,*::before,*::after{animation:none !important;transition:none !important}';
    document.documentElement.appendChild(st); }
  document.querySelectorAll('.toast, .gj-toast, #toastLayer, [class*="toast"]').forEach(n=>n.style.display='none');
  return 1;})()`;

(async () => {
  let wsUrl = null;
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) { wsUrl = page.webSocketDebuggerUrl; break; }
    } catch { /* 等端口 */ }
    await sleep(200);
  }
  if (!wsUrl) throw new Error("CDP 连不上\n" + stderr.slice(-600));
  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(`CDP ${m.error.message}`)) : res(m.result);
    }
  });
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: BASE });
  await sleep(5000);
  await evaluate(`(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));
    const set=(sel,v)=>{const e=document.querySelector(sel); if(!e) return 0; e.focus(); e.value=v;
      e.dispatchEvent(new Event("input",{bubbles:true})); e.dispatchEvent(new Event("change",{bubbles:true})); return 1;};
    set("#loginEmail","admin@goodjob.com"); set("#loginPassword","goodjob123");
    document.querySelector("#loginButton").click(); await s(9000);
    return document.body.className;})()`);

  let lastView = null, openModal = null;
  let n = 0;
  for (const [vid, label, opt] of TARGETS) {
    // 关掉上一个弹窗
    if (openModal) {
      const sel = typeof openModal === "string" ? openModal : "#appModal";
      await evaluate(`(function(){
        const m = document.querySelector(${JSON.stringify(sel)});
        if (!m) return 1;
        const close = m.querySelector('[data-modal-close], #productModalClose, #shipmentModalClose, .modal-close');
        if (close) close.click(); else m.classList.remove('active');
        return 1;})()`);
      openModal = null; await sleep(250);
    }
    if (lastView !== vid) {
      const ok = await evaluate(`(function(){const b=document.querySelector('[data-view="${vid}"]'); if(!b) return 0; b.click(); return 1;})()`);
      if (!ok) { console.log(`  ✗ ${vid} 导航按钮不存在`); continue; }
      lastView = vid; await sleep(1700);
    }
    if (opt.click) {
      const norm = `(s)=>(s||'').trim().replace(/\\s+/g,'').replace(/^[＋+·•＊*≥>\\-]+/,'')`;
      const clicked = await evaluate(`(function(){
        const nm = ${norm};
        const scope = document.querySelector('.view.active');
        const b = [...document.querySelectorAll('button, a.btn')].find(x => nm(x.innerText) === ${JSON.stringify(opt.click)})
              || [...scope.querySelectorAll('button, a.btn')].find(x => nm(x.innerText) === ${JSON.stringify(opt.click)});
        if (!b) return 0; b.click(); return 1;})()`);
      if (!clicked) { console.log(`  ✗ ${label}：找不到按钮「${opt.click}」`); continue; }
      await sleep(1500);
      const sel = typeof opt.modal === "string" ? opt.modal : "#appModal";
      const has = await evaluate(`(function(){const m=document.querySelector(${JSON.stringify(sel)}); return !!m && (m.classList.contains('active') || getComputedStyle(m).display !== 'none');})()`);
      if (!has) { console.log(`  ✗ ${label}：点了「${opt.click}」但弹窗没打开`); continue; }
      openModal = sel;
    }
    await evaluate(STILL);
    await sleep(200);
    const base = `${String(++n).padStart(2, "0")}-${vid}${opt.click ? "-modal" : ""}`;
    // 取景：弹窗按实际 rect；页面元素先滚进视口再按 rect（视口坐标，不再靠猜）
    let clip = null;
    if (openModal) {
      const r = await evaluate(`(function(){
        const m = document.querySelector(${JSON.stringify(typeof openModal === "string" ? openModal : "#appModal")} + " .modal");
        if (!m) return null; const b = m.getBoundingClientRect();
        return JSON.stringify({x:Math.max(0,Math.round(b.left)-16), y:Math.max(0,Math.round(b.top)-16),
          width:Math.min(${W},Math.round(b.width)+32), height:Math.min(${H},Math.round(b.height)+32)});})()`);
      if (r) clip = JSON.parse(r);
    } else {
      const finder = opt.anchor
        ? `document.querySelector(${JSON.stringify(opt.anchor)})`
        : `[...document.querySelectorAll('.panel, .section, .card, .form-card, .settings-card')]
             .filter(n => n.textContent.includes(${JSON.stringify(opt.anchorText || "")}))
             .sort((a,b) => a.textContent.length - b.textContent.length)[0]`;
      const r = await evaluate(`(function(){
        const n = ${finder};
        if (!n) return null;
        n.scrollIntoView({ block: 'center' });
        const b = n.getBoundingClientRect();
        const padTop = ${opt.pad?.top ?? 18}, padX = ${opt.pad?.x ?? 12};
        return JSON.stringify({x:Math.max(0,Math.round(b.left)-padX), y:Math.max(0,Math.round(b.top)-padTop),
          width:Math.min(${W},Math.round(b.width)+padX*2), height:Math.min(${H}-Math.max(0,Math.round(b.top)-padTop),Math.round(b.height)+padTop+18)});})()`);
      if (r) clip = JSON.parse(r);
    }
    if (!clip) { console.log(`  ✗ ${label}：取景失败`); continue; }
    await sleep(150);
    // 改前：把新增样式块摘掉
    const removed = await evaluate(`(function(){const s=document.getElementById('input-refine'); if(!s) return 0; window.__ir=s; s.remove(); return 1;})()`);
    if (!removed) { console.log(`  ✗ ${label}：找不到 #input-refine`); continue; }
    await sleep(250);
    await shot(`${base}-before`, clip);
    // 改后：装回去
    await evaluate(`(function(){if(window.__ir) document.body.appendChild(window.__ir); return 1;})()`);
    await sleep(250);
    await shot(`${base}-after`, clip);
    console.log(`  ✓ ${label}  → ${base}-{before,after}.png`);
  }
  child.kill("SIGKILL");
  process.exit(0);
})();
