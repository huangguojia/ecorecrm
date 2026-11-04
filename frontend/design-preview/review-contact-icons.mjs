#!/usr/bin/env node
/* 联系图标条（contact-dock）巡检 + 图标放大取证。
   用法：node review-contact-icons.mjs [outDir]
   产物：shots-icons/dock-<view>.png（3x 高清条图）、icons-board.png（同图标 4 档尺寸放大板）、contact-icons.json
   说明：走 dev server（源码实时），API 由 dev server 代理到后端 4188。 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CFT = "/Users/sendohakria/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const BASE = process.env.CRM_BASE || "http://127.0.0.1:5298/";
const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.resolve(HERE, process.argv[2] || "shots-icons");
const PORT = 9497;
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
  const file = path.join(OUT, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(r.data, "base64"));
  return file;
}

/* 注入：动画/过渡全停 + 隐藏 toast，避免截图被盖 */
const FREEZE = `(function(){
  const s=document.createElement('style'); s.id='__freeze';
  s.textContent='*,*::before,*::after{animation:none!important;transition:none!important}#toast,.toast,#cliDailyToast{display:none!important}';
  document.head.appendChild(s); return 1;})()`;

const DUMP_DOCK = `(function(){
  const dock=[...document.querySelectorAll('.contact-dock:not([hidden])')]
    .find(d=>d.getBoundingClientRect().height>4);
  if(!dock) return JSON.stringify({ok:false});
  const r=dock.getBoundingClientRect();
  const btns=[...dock.querySelectorAll('.contact-dock-action')].map(b=>{
    const cs=getComputedStyle(b); const br=b.getBoundingClientRect();
    const svg=b.querySelector('svg'); const sc=svg?getComputedStyle(svg):null;
    const sr=svg?svg.getBoundingClientRect():null;
    return {
      label:(b.innerText||'').trim(),
      cls:b.className,
      w:Math.round(br.width), h:Math.round(br.height),
      cx:Math.round(br.left+br.width/2), cy:Math.round(br.top+br.height/2),
      color:cs.color, bg:cs.backgroundColor, border:cs.borderColor, opacity:cs.opacity,
      fontSize:cs.fontSize, fontWeight:cs.fontWeight, radius:cs.borderRadius,
      svgHTML:svg?svg.outerHTML:'',
      svgW:sr?Math.round(sr.width):0, svgH:sr?Math.round(sr.height):0,
      svgStroke:sc?sc.strokeWidth:'', svgStrokeColor:sc?sc.stroke:'' , svgFill:sc?sc.fill:''
    };
  });
  /* 2026-10-14 起联系条「去按钮化」：只留图标 + 文字，没有外框也没有关闭按钮 */
  return JSON.stringify({ok:true, rect:{x:r.left,y:r.top,w:r.width,h:r.height}, btns,
    close:null,
    host:(dock.parentElement||{}).id||(dock.parentElement||{}).className||'',
    view:(dock.closest('.view')||{}).id||''});
})()`;

/* 放大板：把 4 个图标按 16/24/32/48 px 逐档渲染（尺寸走 --s 变量，保留品牌 glyph 的 --glyph-k） */
function boardHTML(icons) {
  const sizes = [16, 24, 32, 48];
  const withSize = (svg, s) => (svg.includes('style="') ? svg.replace('style="', `style="--s:${s}px;`) : svg.replace("<svg", `<svg style="--s:${s}px"`));
  return sizes.map((s) => `<div class="row"><span class="tag">${s}px</span>${icons.map((ic) => `<span class="cell">${withSize(ic.svg, s)}</span>`).join("")}</div>`).join("");
}

/* 登录：dev 模式首屏要拉 250+ 个模块（主模块 7.6MB），#loginButton 是静态 HTML ——
   它一早就存在但事件还没绑上，此时点击是空操作。故轮询“填值 + 点击”，直到 body.is-authenticated。
   JS 未就绪时的点击不会发请求，所以不会打出多余的登录请求。 */
const LOGIN = `(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));
  const set=(sel,v)=>{const e=document.querySelector(sel); if(!e) return 0; e.focus(); e.value=v;
    e.dispatchEvent(new Event("input",{bubbles:true})); e.dispatchEvent(new Event("change",{bubbles:true})); return 1;};
  for(let i=0;i<40;i++){
    if(document.body.classList.contains("is-authenticated")) break;
    set("#loginEmail","admin@goodjob.com"); set("#loginPassword","goodjob123");
    document.querySelector("#loginButton")?.click();
    await s(900);
  }
  return document.body.className + " | views=" + document.querySelectorAll(".view").length;})()`;

/* 行探测：dev 模式下列表数据是登录后异步拉的，点视图后要轮询到真的出现可见行 */
const ROW_PROBE = `(function(){
  const v=[...document.querySelectorAll('.view')].find(x=>x.classList.contains('active'))||document;
  const rows=[...v.querySelectorAll('tbody tr, .customer-mobile-card, .lead-mobile-card, .customer-pool-card')]
    .filter(r=>r.offsetParent!==null && r.getBoundingClientRect().height>8);
  return JSON.stringify({n:rows.length, first:rows[0]?(rows[0].innerText||'').trim().replace(/\\s+/g,' ').slice(0,60):''});})()`;

async function waitRows(tries = 24) {
  let last = { n: 0, first: "" };
  for (let i = 0; i < tries; i++) {
    await sleep(700);
    try { last = JSON.parse(await evaluate(ROW_PROBE)); } catch { /* 视图切换中 */ }
    if (last.n > 0) return last;
  }
  return last;
}

(async () => {
  let wsUrl = null;
  for (let i = 0; i < 90; i++) {
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
  await sleep(4000);

  const bodyCls = await evaluate(LOGIN);
  console.log("login ->", bodyCls);
  if (!/is-authenticated/.test(bodyCls)) console.log("  ⚠️ 登录未完成，后续取景可能全空");
  await evaluate(FREEZE);

  const views = await evaluate(`JSON.stringify([...document.querySelectorAll('[data-view]')].map(b=>b.dataset.view))`);
  console.log("views ->", views);
  const ONLY = (process.env.VIEWS || "customers,leads,customer-pool").split(",");

  const results = [];
  for (const vid of JSON.parse(views)) {
    if (!ONLY.includes(vid)) continue;
    const opened = await evaluate(`(function(){const b=[...document.querySelectorAll('[data-view="${vid}"]')][0]; if(!b) return 0; b.click(); return 1;})()`);
    if (!opened) continue;
    const info = await waitRows();
    if (!info.n) { console.log(`  ${vid}: 无数据行，跳过`); continue; }
    const clicked = await evaluate(`(function(){
      const v=[...document.querySelectorAll('.view')].find(x=>x.classList.contains('active'))||document;
      const rows=[...v.querySelectorAll('tbody tr, .customer-mobile-card, .lead-mobile-card, .customer-pool-card')]
        .filter(r=>r.offsetParent!==null && r.getBoundingClientRect().height>8);
      const target=[...rows[0].querySelectorAll('td,div,span')].find(e=>e.getBoundingClientRect().width>60)||rows[0];
      target.click(); rows[0].click(); return 1;})()`);
    await sleep(900);
    let dump;
    try { dump = JSON.parse(await evaluate(DUMP_DOCK)); } catch (e) { dump = { ok: false, err: String(e).slice(0, 200) }; }
    if (!dump.ok) { console.log(`  ${vid}: 点击后无联系条（rows=${info.n}）`); results.push({ vid, rows: info.n, dock: false }); continue; }
    await evaluate(FREEZE);
    await sleep(200);
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2, buttons: 0 });
    await sleep(220);
    const pad = 14;
    const file = await shot(`dock-${vid}`, {
      x: Math.max(0, dump.rect.x - pad), y: Math.max(0, dump.rect.y - pad),
      width: Math.min(W, dump.rect.w + pad * 2), height: dump.rect.h + pad * 2
    }, 3);
    console.log(`  ${vid}: dock ok, ${dump.btns.length} 个按钮 -> ${path.basename(file)}  [${dump.btns.map((b) => `${b.label}=${b.svgW}x${b.svgH}/sw${b.svgStroke}`).join(", ")}]`);
    results.push({ vid, rows: info.n, firstRow: info.first, ...dump });

    /* hover 态：把指针移到第一个「有值」按钮上 */
    const hv = dump.btns.find((b) => /is-ready/.test(b.cls)) || dump.btns[0];
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: hv.cx, y: hv.cy, buttons: 0 });
    await sleep(320);
    const hfile = await shot(`dock-hover-${vid}`, {
      x: Math.max(0, dump.rect.x - pad), y: Math.max(0, dump.rect.y - pad),
      width: Math.min(W, dump.rect.w + pad * 2), height: dump.rect.h + pad * 2
    }, 3);
    console.log(`  ${vid}: hover(${hv.label}) -> ${path.basename(hfile)}`);
  }

  /* 图标放大板：取客户视图的 4 个图标，按 16/24/32/48 渲染 */
  const cust = results.find((r) => r.btns);
  if (cust) {
    const icons = cust.btns.map((b) => ({ label: b.label, svg: b.svgHTML }));
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      body{margin:0;padding:26px 30px;background:#fff;font:13px/1.4 -apple-system,"PingFang SC",sans-serif;color:#1d2738}
      h2{margin:0 0 4px;font-size:15px}
      .sub{color:#8290a3;font-size:11px;margin-bottom:18px}
      .head,.row{display:flex;align-items:center;gap:22px}
      .head{margin-bottom:8px;color:#6b7d94;font-size:11px;font-weight:700;letter-spacing:.04em}
      .head .tag{width:48px}
      .row{padding:10px 0;border-top:1px solid #eef2f7}
      .tag{width:48px;color:#8290a3;font-size:11px;font-weight:700}
      .cell{display:flex;align-items:center;justify-content:center;color:#37445b;flex:0 0 60px}
      .cell svg{width:var(--s);height:var(--s);fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round;stroke-width:2;overflow:visible}
      .cell svg.contact-brand-glyph{width:calc(var(--s) * var(--glyph-k,1));height:calc(var(--s) * var(--glyph-k,1));fill:currentColor;stroke:none}
      .nm{display:flex;gap:22px}
      .nm span{flex:0 0 60px;text-align:center;color:#37445b;font-size:11px}
    </style></head><body>
      <h2>联系图标 · 尺寸放大板</h2>
      <div class="sub">同一份 SVG 在 16 / 24 / 32 / 48 px 下的真实渲染（含改后品牌 glyph 配重）</div>
      <div class="head"><span class="tag">尺寸</span><div class="nm">${icons.map((i) => `<span>${i.label}</span>`).join("")}</div></div>
      ${boardHTML(icons)}
    </body></html>`;
    const bp = path.join(OUT, `_board-${process.env.TAG || "after"}.html`);
    fs.writeFileSync(bp, html);
    await send("Page.navigate", { url: "file://" + bp });
    await sleep(1200);
    await shot(`icons-board-${process.env.TAG || "after"}`, null, 2);
    console.log(`  board -> shots-icons/icons-board-${process.env.TAG || "after"}.png`);
  }

  /* 主题跟随验证：品牌通道改用 var(--brand)/var(--brand-tint) 后，切主题不再残留硬编码绿 */
  if (process.env.THEMES || process.env.THEMES_ONLY) {
    if (process.env.THEMES_ONLY) {
      await send("Page.navigate", { url: BASE });   // 干净状态，避免与前序视图状态耦合
      await sleep(4000);
      await evaluate(LOGIN);
    }
    await evaluate(`(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));
      document.querySelector('[data-view="customers"]')?.click(); await s(1500); return 1;})()`);
    const tinfo = await waitRows(24);
    if (!tinfo.n) console.log("  theme: 列表无数据行，跳过");
    else await evaluate(`(function(){
      const v=[...document.querySelectorAll('.view')].find(x=>x.classList.contains('active'))||document;
      const tr=[...v.querySelectorAll('tbody tr')].find(r=>r.offsetParent!==null);
      tr?.querySelector('td,div,span')?.click(); tr?.click(); return 1;})()`);
    await sleep(1000);
    for (const t of ["paper", "ocean", "rose", "slate"]) {
      await evaluate(`(function(){document.documentElement.dataset.theme=${JSON.stringify(t)}; return 1;})()`);
      await sleep(420);
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2, buttons: 0 });
      await sleep(180);
      const dd = JSON.parse(await evaluate(DUMP_DOCK));
      if (!dd.ok) { console.log(`  theme ${t}: 无联系条`); continue; }
      await shot(`theme-${t}`, { x: Math.max(0, dd.rect.x - 14), y: Math.max(0, dd.rect.y - 14), width: Math.min(W, dd.rect.w + 28), height: dd.rect.h + 28 }, 3);
      const first = dd.btns[0] || {};
      console.log(`  theme ${t}: ready 色 ${first.color} 边 ${first.border} → shots-icons/theme-${t}.png`);
    }
    await evaluate(`(function(){document.documentElement.dataset.theme="paper"; return 1;})()`);
    if (process.env.THEMES_ONLY) {
      fs.writeFileSync(path.join(OUT, "contact-icons.json"), JSON.stringify(results, null, 1));
      child.kill("SIGKILL"); process.exit(0);
    }
  }

  /* 客户全景页的联系按钮（2 列网格 + 长文案，检验 12px 下是否拥挤） */
  await send("Page.navigate", { url: BASE });
  await sleep(4000);
  await evaluate(LOGIN);
  await evaluate(`(function(){document.querySelector('[data-view="customers"]')?.click(); return 1;})()`);
  await waitRows(20);
  await evaluate(`(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));
    const open=document.querySelector('#customers tbody [data-open-customer-page]')
      || [...document.querySelectorAll('#customers tbody tr')].find(r=>r.offsetParent!==null);
    if(open){ open.click(); await s(3200); }
    return document.querySelector('.view.active')?.id||'';})()`);
  await sleep(600);
  await evaluate(FREEZE);
  const det = await evaluate(`(function(){
    const box=document.querySelector('.customer-contact-actions');
    if(!box||box.getBoundingClientRect().height<4) return JSON.stringify({ok:false, view:document.querySelector('.view.active')?.id||''});
    const r=box.getBoundingClientRect();
    const btns=[...box.querySelectorAll('.customer-contact-action')].map(b=>{const br=b.getBoundingClientRect();
      return {label:(b.innerText||'').trim(), w:Math.round(br.width), h:Math.round(br.height), cls:b.className};});
    return JSON.stringify({ok:true, rect:{x:r.left,y:r.top,w:r.width,h:r.height}, btns, view:document.querySelector('.view.active')?.id||''});
  })()`);
  const detInfo = JSON.parse(det);
  if (detInfo.ok) {
    await shot("detail-contacts", { x: Math.max(0, detInfo.rect.x - 12), y: Math.max(0, detInfo.rect.y - 12), width: detInfo.rect.w + 24, height: detInfo.rect.h + 24 }, 3);
    console.log(`  detail(${detInfo.view}) -> shots-icons/detail-contacts.png  ${detInfo.btns.map((b) => `${b.label} ${b.w}x${b.h}`).join(" | ")}`);
    results.push({ vid: "detail-contacts", view: detInfo.view, rect: detInfo.rect, btns: detInfo.btns });
  } else {
    console.log(`  detail: 未取到（view=${detInfo.view}）`);
  }

  fs.writeFileSync(path.join(OUT, "contact-icons.json"), JSON.stringify(results, null, 1));
  console.log("\nJSON:", path.join(OUT, "contact-icons.json"));
  child.kill("SIGKILL");
  process.exit(0);
})();
