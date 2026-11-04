#!/usr/bin/env node
/* 联系条配色试验：在同一份真实页面上注入多套候选 CSS，同机位截图对比。
   用法：node tune-dock-colors.mjs
   产物：shots-icons/tune/*.png + tune.json */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CFT = "/Users/sendohakria/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const BASE = process.env.CRM_BASE || "http://127.0.0.1:5298/";
const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.resolve(HERE, "shots-icons/tune");
const PORT = 9498;
const W = 1680;
const H = 1050;

fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
async function evaluate(expr, awaitPromise = true) {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "eval failed");
  return r.result.value;
}
async function shot(name, clip, scale = 1) {
  const params = { format: "png" };
  if (clip) { params.clip = { ...clip, scale }; params.captureBeyondViewport = true; }
  const r = await send("Page.captureScreenshot", params);
  const f = path.join(OUT, `${name}.png`);
  fs.writeFileSync(f, Buffer.from(r.data, "base64"));
  return f;
}

const FREEZE = `(function(){
  let s=document.getElementById('__freeze');
  if(!s){ s=document.createElement('style'); s.id='__freeze'; document.head.appendChild(s); }
  s.textContent='*,*::before,*::after{animation:none!important;transition:none!important}#toast,.toast,#cliDailyToast{display:none!important}';
  return 1;})()`;

/* 登录：dev 入口模块 7.6MB，#loginButton 是静态 HTML —— 模块未执行完时点击是空操作。
   依赖 UI 点击的时序很脆（连点会并发打请求互扰），故直接同源 fetch 换 cookie + 写 localStorage，
   再由 restoreSession() 在 reload 后接管（它会用 /api/auth/me 复核并加 body.is-authenticated）。 */
const SEED_LOGIN = `(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));
  for(let i=0;i<10;i++){
    if(localStorage.getItem("gj_user")) return "already";
    try{
      const r=await fetch("/api/auth/login",{method:"POST",credentials:"include",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({email:"admin@goodjob.com",password:"goodjob123"})});
      const d=await r.json();
      if(d && d.user){ localStorage.setItem("gj_user",JSON.stringify(d.user)); return "seeded:"+d.user.id; }
    }catch(e){}
    await s(1500);
  }
  return "seed-failed";})()`;

/* reload 后等 restoreSession() 用 /api/auth/me 复核（cookie + localStorage 双轨）。
   这一步偶发不成立（dev server 重编译期间模块迟到），故带一次 UI 点击兜底。 */
const AWAIT_AUTH = `(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));
  for(let i=0;i<70;i++){ if(document.body.classList.contains("is-authenticated")) return "session"; await s(500); }
  const e=document.querySelector("#loginEmail"), p=document.querySelector("#loginPassword");
  if(e&&p&&e.value.trim()){
    document.querySelector("#loginButton")?.click();
    for(let i=0;i<60;i++){ await s(500); if(document.body.classList.contains("is-authenticated")) return "fallback-click"; }
  }
  return "TIMEOUT|"+document.body.className+"|prefill="+(e?e.value:"-");})()`;

const ROW_PROBE = `(function(){
  const v=[...document.querySelectorAll('.view')].find(x=>x.classList.contains('active'))||document;
  const rows=[...v.querySelectorAll('tbody tr')].filter(r=>r.offsetParent!==null && r.getBoundingClientRect().height>8);
  return JSON.stringify({n:rows.length, first:rows[0]?(rows[0].innerText||'').trim().replace(/\\s+/g,' ').slice(0,60):''});})()`;

async function waitRows(tries = 24) {
  let last = { n: 0, first: "" };
  for (let i = 0; i < tries; i++) {
    await sleep(700);
    try { last = JSON.parse(await evaluate(ROW_PROBE)); } catch {}
    if (last.n > 0) return last;
  }
  return last;
}

/* ---------- 候选方案：只覆盖「联系条容器 + 联系按钮」这一小块 ---------- */
const COMMON_RESET = `
  /* 统一空态：不用虚线，改冷调浅底 + 实线细边 */
  .contact-dock .customer-contact-action:not(.is-ready),
  .customer-contact-actions .customer-contact-action:not(.is-ready){
    background:#f5f7fb !important; border:1px solid #e5ebf4 !important;
    color:#93a1b5 !important; box-shadow:none !important;
  }
  .contact-dock .customer-contact-action:not(.is-ready):hover,
  .customer-contact-actions .customer-contact-action:not(.is-ready):hover{
    background:#eff3f9 !important; border-color:#dbe3ef !important; color:#8492a6 !important;
  }
  /* 关闭键：跟容器融为一体 */
  .contact-dock .contact-dock-close{
    background:transparent !important; border-color:#e5ebf4 !important; color:#8b98ab !important;
  }
  .contact-dock .contact-dock-close:hover{ background:#eef2f8 !important; color:#37445b !important; }
`;

/* 容器：品牌氛围底 + 左侧品牌竖条（三套方案共用，只有按钮不同） */
const SHELL = `
  .contact-dock{
    border-color: var(--brand-ring) !important;
    background: linear-gradient(112deg, var(--brand-tint) 0%, var(--surface) 44%) !important;
    border-radius: 12px !important;
    box-shadow: 0 2px 4px rgba(23,35,61,.05), 0 20px 34px -24px rgba(23,35,61,.55) !important;
    padding-left: 15px !important;
    overflow: hidden;
  }
  .contact-dock::before{
    content:""; position:absolute; left:0; top:8px; bottom:8px; width:3px;
    border-radius:0 3px 3px 0; background: var(--brand);
  }
  .contact-dock .contact-dock-id > span{ color: var(--brand) !important; font-weight: 600 !important; }
  .contact-dock .contact-dock-id > b{ color:#18212f !important; }
`;

const PLANS = {
  /* live = 不注入任何 CSS，取源码真实渲染（落地后作为成品对照） */
  live: "",

  /* P1 · 品牌实心：有值 = 品牌实底白字（"能点"的最强信号） */
  p1: SHELL + COMMON_RESET + `
  .contact-dock .customer-contact-action.is-ready,
  .customer-contact-actions .customer-contact-action.is-ready{
    background: var(--brand) !important; border-color: var(--brand) !important; color:#fff !important;
    box-shadow: 0 1px 2px rgba(23,35,61,.14), 0 6px 14px -8px var(--brand) !important;
  }
  .contact-dock .customer-contact-action.is-ready:hover,
  .customer-contact-actions .customer-contact-action.is-ready:hover{
    background: var(--brand-strong) !important; border-color: var(--brand-strong) !important; color:#fff !important;
  }`,

  /* P2 · 通道分色：每通道专属色相，有值 = 该色浅底 + 深字 */
  p2: SHELL + COMMON_RESET + `
  .customer-contact-action[data-contact-dock-channel="email"],
  .customer-contact-action[data-customer-contact="email"]{ --ch:#4f46e5; --ch-bg:#e8eaff; --ch-bd:#c3c8f8; }
  .customer-contact-action[data-contact-dock-channel="phone"],
  .customer-contact-action[data-customer-contact="phone"]{ --ch:#0c736a; --ch-bg:#ddf3f0; --ch-bd:#a9ded8; }
  .customer-contact-action[data-contact-dock-channel="whatsapp"],
  .customer-contact-action[data-customer-contact="whatsapp"]{ --ch:#12733e; --ch-bg:#ddf3e6; --ch-bd:#a8dcc0; }
  .customer-contact-action[data-contact-dock-channel="wechat"],
  .customer-contact-action[data-customer-contact="wechat"]{ --ch:#0a6435; --ch-bg:#dcf0e4; --ch-bd:#a5d7bd; }
  .contact-dock .contact-dock-id > span{ color:#6b7d94 !important; }
  .contact-dock::before{ background: linear-gradient(180deg,#4f46e5,#0c736a 42%,#12733e 74%,#0a6435) !important; }
  .contact-dock .customer-contact-action.is-ready,
  .customer-contact-actions .customer-contact-action.is-ready{
    background: var(--ch-bg) !important; border-color: var(--ch-bd) !important; color: var(--ch) !important;
    box-shadow: inset 0 1px 0 rgba(255,255,255,.7) !important;
  }
  .contact-dock .customer-contact-action.is-ready:hover,
  .customer-contact-actions .customer-contact-action.is-ready:hover{
    background: var(--ch) !important; border-color: var(--ch) !important; color:#fff !important;
  }`,

  /* P3 · 品牌渐变实心：有值 = 品牌渐变实底，比 P1 更亮一档 */
  p3: SHELL + COMMON_RESET + `
  .contact-dock .customer-contact-action.is-ready,
  .customer-contact-actions .customer-contact-action.is-ready{
    background: linear-gradient(135deg, var(--brand) 0%, var(--brand-2) 100%) !important;
    border-color: transparent !important; color:#fff !important;
    box-shadow: 0 2px 6px -1px var(--brand-ring), 0 8px 18px -10px var(--brand) !important;
  }
  .contact-dock .customer-contact-action.is-ready:hover,
  .customer-contact-actions .customer-contact-action.is-ready:hover{
    filter: saturate(1.08) brightness(.96); color:#fff !important;
  }`
};

const applyPlan = (key) => `(function(){
  let s=document.getElementById('__tune');
  if(!s){ s=document.createElement('style'); s.id='__tune'; document.head.appendChild(s); }
  s.textContent=${JSON.stringify(PLANS[key])};
  return s.textContent.length;})()`;

/* 模拟「四个通道全有值」：仅用于看极端配色，不改源码 */
const ALL_READY = `(function(){
  document.querySelectorAll('.customer-contact-action').forEach(b=>{ b.classList.add('is-ready'); b.classList.remove('is-empty'); b.disabled=false; });
  return 1;})()`;
const RESTORE_CLS = `(function(){
  document.querySelectorAll('.customer-contact-action').forEach(b=>{
    if(b.dataset.k==='ready'){ b.classList.add('is-ready'); b.classList.remove('is-empty'); }
    else { b.classList.remove('is-ready'); b.classList.add('is-empty'); }
  });
  return 1;})()`;

(async () => {
  let wsUrl = null;
  for (let i = 0; i < 90; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) { wsUrl = page.webSocketDebuggerUrl; break; }
    } catch {}
    await sleep(200);
  }
  if (!wsUrl) throw new Error("CDP 连不上\n" + stderr.slice(-600));

  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id); pending.delete(m.id);
      m.error ? rej(new Error(`CDP ${m.error.message}`)) : res(m.result);
    }
  });
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: BASE });
  await sleep(4500);
  console.log("seed ->", await evaluate(SEED_LOGIN));
  await send("Page.reload", {});
  await sleep(2500);
  console.log("auth ->", await evaluate(AWAIT_AUTH));
  await evaluate(FREEZE);

  /* ---- 列表页：出联系条 ---- */
  const VID = process.env.VID || "customers";
  const SUF = VID === "customers" ? "" : "-" + VID;
  await evaluate(`(function(){document.querySelector('[data-view="${VID}"]')?.click(); return 1;})()`);
  const info = await waitRows();
  console.log("rows ->", JSON.stringify(info));
  if (!info.n) { console.log("⚠️ 列表无数据行，无法取景"); child.kill("SIGKILL"); process.exit(1); }
  await evaluate(`(function(){
    const v=[...document.querySelectorAll('.view')].find(x=>x.classList.contains('active'))||document;
    const rows=[...v.querySelectorAll('tbody tr')].filter(r=>r.offsetParent!==null && r.getBoundingClientRect().height>8);
    const t=[...rows[0].querySelectorAll('td,div,span')].find(e=>e.getBoundingClientRect().width>60)||rows[0];
    t.click(); rows[0].click(); return 1;})()`);
  await sleep(1000);
  await evaluate(FREEZE);

  /* 记录原始 ready/empty 归属，便于恢复 */
  await evaluate(`(function(){
    document.querySelectorAll('.customer-contact-action').forEach(b=>{
      b.dataset.k = b.classList.contains('is-ready') ? 'ready' : 'empty'; });
    return 1;})()`);

  const rectRaw = await evaluate(`(function(){
    const d=[...document.querySelectorAll('.contact-dock:not([hidden])')].find(x=>x.getBoundingClientRect().height>4);
    if(!d) return 'null';
    const r=d.getBoundingClientRect();
    return JSON.stringify({x:r.left,y:r.top,w:r.width,h:r.height});})()`);
  if (rectRaw === "null") throw new Error("未取到联系条");
  const rect = JSON.parse(rectRaw);
  const pad = 16;
  const clip = {
    x: Math.max(0, rect.x - pad), y: Math.max(0, rect.y - pad),
    width: Math.min(W, rect.w + pad * 2), height: rect.h + pad * 2
  };
  console.log("dock rect ->", JSON.stringify(rect));

  const KEYS = process.env.ONLY ? process.env.ONLY.split(",") : Object.keys(PLANS);
  const manifest = [];
  for (const key of KEYS) {
    await evaluate(applyPlan(key));
    await evaluate(RESTORE_CLS);
    await evaluate(`(function(){document.querySelectorAll('.contact-dock-action').forEach(b=>{
      if(b.dataset.k!=='ready'){ b.classList.remove('is-ready'); b.classList.add('is-empty'); }}); return 1;})()`);
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2, buttons: 0 });
    await sleep(260);
    await shot(`${key}-real${SUF}`, clip, 3);
    const st = await evaluate(`(function(){
      const d=[...document.querySelectorAll('.contact-dock:not([hidden])')].find(x=>x.getBoundingClientRect().height>4);
      const cs=getComputedStyle(d);
      const b=d.querySelector('.customer-contact-action.is-ready')||d.querySelector('.customer-contact-action');
      const bc=getComputedStyle(b);
      return JSON.stringify({dockBg:cs.backgroundImage.slice(0,60)+' | '+cs.backgroundColor, ready:(b.classList.contains('is-ready')?'ready':'empty'), color:bc.color, bg:bc.backgroundColor});})()`);
    console.log(`  ${key}-real  ${st}`);

    await evaluate(ALL_READY);
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2, buttons: 0 });
    await sleep(260);
    await shot(`${key}-all${SUF}`, clip, 3);
    console.log(`  ${key}-all  (四通道全有值)`);
    manifest.push({ key, clip, rect });
  }

  /* 成品附加取证（仅 live 档）：hover 反馈 + 主题跟随 */
  if (KEYS.includes("live")) {
    await evaluate(applyPlan("live"));
    /* 还原到「真实数据」状态：只有原本有值的通道才保留 is-ready */
    await evaluate(`(function(){document.querySelectorAll('.contact-dock-action').forEach(b=>{
      if(b.dataset.k==='ready'){ b.classList.add('is-ready'); b.classList.remove('is-empty'); }
      else { b.classList.remove('is-ready'); b.classList.add('is-empty'); }}); return 1;})()`);
    const hpRaw = await evaluate(`(function(){
      const d=[...document.querySelectorAll('.contact-dock:not([hidden])')].find(x=>x.getBoundingClientRect().height>4);
      const b=d.querySelector('.customer-contact-action.is-ready')||d.querySelector('.customer-contact-action');
      const r=b.getBoundingClientRect();
      return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),label:(b.innerText||'').trim()});})()`);
    const hp = JSON.parse(hpRaw);
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: hp.x, y: hp.y, buttons: 0 });
    await sleep(420);
    const hcss = await evaluate(`(function(){
      const b=document.querySelector('.contact-dock .customer-contact-action.is-ready');
      const c=getComputedStyle(b); return c.color+' | '+c.backgroundColor;})()`);
    await shot(`live-hover${SUF}`, clip, 3);
    console.log(`  live-hover(${hp.label}) ${hcss}`);
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2, buttons: 0 });
    await sleep(220);

    for (const t of ["paper", "rose", "ocean", "slate"]) {
      await evaluate(`(function(){document.documentElement.dataset.theme=${JSON.stringify(t)}; return 1;})()`);
      await sleep(360);
      await shot(`live-theme-${t}`, clip, 3);
      const tcss = await evaluate(`(function(){
        const d=[...document.querySelectorAll('.contact-dock:not([hidden])')].find(x=>x.getBoundingClientRect().height>4);
        const b=d.querySelector('.customer-contact-action.is-ready');
        return getComputedStyle(b).color+' / dock='+getComputedStyle(d).backgroundImage.slice(0,52);})()`);
      console.log(`  theme ${t}: ${tcss}`);
    }
    await evaluate(`(function(){document.documentElement.dataset.theme="paper"; return 1;})()`);
  }

  /* ---- 详情页：同一套按钮组 ---- */
  await evaluate(`(function(){const s=document.getElementById('__tune'); if(s) s.textContent=''; return 1;})()`);
  await send("Page.navigate", { url: BASE });
  await sleep(4500);
  console.log("auth#2 ->", await evaluate(AWAIT_AUTH));
  await evaluate(`(function(){document.querySelector('[data-view="customers"]')?.click(); return 1;})()`);
  await waitRows(20);
  await evaluate(`(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));
    const open=document.querySelector('#customers tbody [data-open-customer-page]')
      || [...document.querySelectorAll('#customers tbody tr')].find(r=>r.offsetParent!==null);
    if(open){ open.click(); await s(3200); }
    return document.querySelector('.view.active')?.id||'';})()`);
  await sleep(700);
  await evaluate(FREEZE);
  const detRaw = await evaluate(`(function(){
    const box=document.querySelector('.customer-contact-actions');
    if(!box||box.getBoundingClientRect().height<4) return 'null';
    const r=box.getBoundingClientRect();
    return JSON.stringify({x:r.left,y:r.top,w:r.width,h:r.height});})()`);
  if (detRaw !== "null") {
    const d = JSON.parse(detRaw);
    const dclip = { x: Math.max(0, d.x - 14), y: Math.max(0, d.y - 14), width: d.w + 28, height: d.h + 28 };
    for (const key of KEYS) {
      await evaluate(applyPlan(key));
      await sleep(220);
      await shot(`detail-${key}-real`, dclip, 3);
    }
    for (const key of KEYS) {
      await evaluate(applyPlan(key));
      await evaluate(`(function(){document.querySelectorAll('.customer-contact-action').forEach(b=>{
        b.classList.remove('is-ready'); }); return 1;})()`);
      await sleep(220);
      await shot(`detail-${key}-empty`, dclip, 3);
    }
    /* 只把「邮件 / 电话」置为有值，看真实混排 */
    await evaluate(`(function(){
      const box=document.querySelector('.customer-contact-actions');
      box.querySelectorAll('.customer-contact-action').forEach(b=>{
        const k=b.dataset.customerContact;
        if(k==='email'||k==='phone') b.classList.add('is-ready'); });
      return 1;})()`);
    for (const key of Object.keys(PLANS)) {
      await evaluate(applyPlan(key));
      await sleep(220);
      await shot(`detail-${key}-mixed`, dclip, 3);
    }
    console.log("detail -> shots-icons/tune/detail-*.png");
  } else {
    console.log("detail: 未取到联系按钮组");
  }

  fs.writeFileSync(path.join(OUT, "tune.json"), JSON.stringify(manifest, null, 1));
  child.kill("SIGKILL");
  process.exit(0);
})();
