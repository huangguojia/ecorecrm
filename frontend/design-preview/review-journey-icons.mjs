#!/usr/bin/env node
/* 客户旅程（客户抽屉里的 #customerJourneyTimeline）节点图标巡检。
   用法：CRM_BASE=http://127.0.0.1:5188/ node review-journey-icons.mjs [outDir]
   产物：shots-journey/journey-drawer.png（真实时间轴 3x）、journey-icons-board.png（全图标板 2x）、
        journey-icons.json（节点 dump + 断言结果）
   说明：走 vite dev（读源码，改完刷新即生效），/api 由 dev server 代理到后端 4188。

   为什么图标板要从源码里解析而不是手抄一份：手抄的板和实现迟早漂移，
   板就会变成"看起来很对但和线上无关"的证据。这里直接读 prototype-api.ts 的
   JOURNEY_GLYPHS / journeyIcons / customerContactIcon，板与实现同源。 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CFT = "/Users/sendohakria/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const BASE = process.env.CRM_BASE || "http://127.0.0.1:5188/";
const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.resolve(HERE, process.argv[2] || "shots-journey");
const PORT = 9499;
const W = 1680;
const H = 1050;

fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 1) 从源码解析图标定义（板与实现同源） ---------- */
const src = fs.readFileSync(path.resolve(HERE, "../src/prototype-api.ts"), "utf8");
const slice = (marker, stop) => {
  const i = src.indexOf(marker);
  if (i < 0) throw new Error(`源码里找不到：${marker}`);
  const j = src.indexOf(stop, i);
  return src.slice(i, j < 0 ? src.length : j);
};

const glyphs = {};
for (const m of slice("const JOURNEY_GLYPHS", "\n};").matchAll(/^\s{2}([A-Za-z]+):\s*'([^']*)'/gmu)) glyphs[m[1]] = m[2];

const contactSvgs = {};
const contactBlock = slice("function customerContactIcon", "\n}\n");
for (const m of contactBlock.matchAll(/channel === "(\w+)"\)\s*return\s*`([\s\S]*?)`;/gu)) contactSvgs[m[1]] = m[2];
const tailEnd = contactBlock.lastIndexOf("`;");
const tailOpen = tailEnd > 0 ? contactBlock.lastIndexOf("`", tailEnd - 1) : -1;
/* ⚠️ 不能用 /return `([\s\S]*?)`;\s*$/：非贪婪量词遇到末尾锚点会被拉长，
   一路吃到最后一个反引号 —— 实测把 email→wechat 之间的 2982 字符源码全当成图标，
   板上直接渲染出代码。从末尾的 "`;" 往前找配对反引号才可靠。 */
if (tailOpen >= 0 && tailEnd > tailOpen) contactSvgs.wechat = contactBlock.slice(tailOpen + 1, tailEnd);

/* type -> {icon: <svg 字符串>, color} —— 表达式只有两种形态，各自映射到对应来源 */
const iconEntries = [];
for (const m of slice("const journeyIcons", "\n  };").matchAll(/([A-Za-z_]+):\s*\{\s*icon:\s*([^,]+),\s*color:\s*"([^"]+)"/gu)) {
  const expr = m[2].trim();
  const contact = expr.match(/customerContactIcon\("(\w+)"\)/u);
  const glyph = expr.match(/journeyGlyph\("(\w+)"\)/u);
  let svg = "";
  if (contact) svg = contactSvgs[contact[1]] || "";
  else if (glyph && glyphs[glyph[1]]) svg = `<svg viewBox="0 0 24 24">${glyphs[glyph[1]]}</svg>`;
  iconEntries.push({ type: m[1], color: m[3], svg, missing: !svg });
}

/* ---------- 2) 浏览器 ---------- */
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
async function shot(name, clip, scale = 1) {
  const params = { format: "png" };
  if (clip) { params.clip = { ...clip, scale }; params.captureBeyondViewport = true; }
  const r = await send("Page.captureScreenshot", params);
  const file = path.join(OUT, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(r.data, "base64"));
  return file;
}

const FREEZE = `(function(){
  if(document.getElementById('__freeze')) return 1;
  const s=document.createElement('style'); s.id='__freeze';
  s.textContent='*,*::before,*::after{animation:none!important;transition:none!important}#toast,.toast,#cliDailyToast{display:none!important}';
  document.head.appendChild(s); return 1;})()`;

const LOGIN = `(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));
  const set=(sel,v)=>{const e=document.querySelector(sel); if(!e) return 0; e.focus(); e.value=v;
    e.dispatchEvent(new Event("input",{bubbles:true})); e.dispatchEvent(new Event("change",{bubbles:true})); return 1;};
  for(let i=0;i<40;i++){
    if(document.body.classList.contains("is-authenticated")) break;
    set("#loginEmail","admin@goodjob.com"); set("#loginPassword","goodjob123");
    document.querySelector("#loginButton")?.click();
    await s(900);
  }
  return document.body.className;})()`;

/* 打开客户抽屉：触发器是列表里的 button.customer-name[data-open-customer]，
   点整行只会开联系图标条（selectCustomerForContact），不是抽屉。 */
const OPEN_DRAWER = `(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));
  document.querySelector('[data-view="customers"]')?.click();
  let rows=[];
  for(let i=0;i<24;i++){ await s(700);
    rows=[...document.querySelectorAll('#customers tbody button[data-open-customer]')]
      .filter(b=>b.offsetParent!==null && b.getBoundingClientRect().height>6);
    if(rows.length) break; }
  if(!rows.length) return JSON.stringify({ok:false, why:'客户列表无可见行'});
  for(let k=0;k<Math.min(rows.length,6);k++){
    rows[k].click(); await s(1400);
    const box=document.querySelector('#customerJourneyTimeline');
    if(box && box.querySelector('.journey-node')) return JSON.stringify({ok:true, rowIndex:k, rowText:(rows[k].innerText||'').trim().slice(0,40)});
    document.querySelector('#customerDrawerClose')?.click(); await s(400);
  }
  return JSON.stringify({ok:false, why:'试了前 6 个客户都没有旅程节点'});
})()`;

const DUMP = `(function(){
  const box=document.querySelector('#customerJourneyTimeline');
  if(!box) return JSON.stringify({ok:false,why:'no box'});
  box.scrollIntoView({block:'center'});
  const nodes=[...box.querySelectorAll('.journey-node')];
  const items=nodes.map(n=>{
    const dot=n.querySelector('.journey-dot'); const svg=dot?dot.querySelector('svg'):null;
    const ds=dot?getComputedStyle(dot):null; const ss=svg?getComputedStyle(svg):null;
    const dr=dot?dot.getBoundingClientRect():null; const sr=svg?svg.getBoundingClientRect():null;
    return {
      label:((n.querySelector('.journey-label')||{}).textContent||'').trim(),
      date:((n.querySelector('.journey-date')||{}).textContent||'').trim(),
      latest:n.classList.contains('is-latest'),
      visible:n.classList.contains('visible'),
      dotText:(dot?dot.textContent:'').trim(),
      hasSvg:!!svg,
      dotW:dr?Math.round(dr.width):0, dotH:dr?Math.round(dr.height):0,
      cx:dr?Math.round(dr.left+dr.width/2):0, cy:dr?Math.round(dr.top+dr.height/2):0,
      svgW:sr?Math.round(sr.width):0, svgH:sr?Math.round(sr.height):0,
      color:ds?ds.color:'', bg:ds?ds.backgroundColor:'', borderColor:ds?ds.borderColor:'', borderW:ds?ds.borderWidth:'',
      fill:ss?ss.fill:'', stroke:ss?ss.stroke:'', strokeW:ss?ss.strokeWidth:'',
      brandGlyph:svg?svg.classList.contains('contact-brand-glyph'):false,
      svg:svg?svg.outerHTML:''
    };
  });
  const tr=box.querySelector('.journey-track'); const r=tr?tr.getBoundingClientRect():box.getBoundingClientRect();
  return JSON.stringify({ok:true,
    rect:{x:r.left,y:r.top,w:r.width,h:r.height},
    count:items.length, items,
    raw:box.innerHTML.length});})()`;

/* 板是独立页面，没有 CRM 的 :root 变量 —— 而图标颜色全是 var(--brand) 这类引用。
   不注入的话：border-color 会退回 currentColor，background 直接失效
   （实心态 = 无效背景 + color:#fff = 白底白图标，整段隐形）。
   变量直接从 index.html 解析，保证板与线上同一套色。 */
const crmHtml = fs.readFileSync(path.resolve(HERE, "../index.html"), "utf8");
const rootStart = crmHtml.indexOf(":root {");
const rootBlock = crmHtml.slice(rootStart, crmHtml.indexOf("}", rootStart));
const themeVars = [...rootBlock.matchAll(/(--[\w-]+):\s*([^;]+);/gu)].map((m) => `    ${m[1]}: ${m[2].trim()};`).join("\n");

/* 图标板：正常态 + 最新态（实心）两段 */
function board(entries) {
  const cell = (e, latest) => `<div class="cell" style="--c:${e.color}">
    <div class="dot${latest ? " is-latest" : ""}">${e.svg}</div>
    <span class="ty">${e.type}</span><span class="cl">${e.color.replace("var(--", "").replace(")", "")}</span></div>`;
  const grid = (latest) => `<div class="grid">${entries.map((e) => cell(e, latest)).join("")}</div>`;
  const missing = entries.filter((e) => e.missing).map((e) => e.type);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    :root{
${themeVars}
    }
    body{margin:0;padding:26px 30px;background:#fff;font:13px/1.4 -apple-system,"PingFang SC",sans-serif;color:#1d2738}
    h2{margin:0 0 4px;font-size:15px}
    .sub{color:#8290a3;font-size:11px;margin-bottom:20px}
    h3{margin:22px 0 10px;font-size:12px;color:#6b7d94;letter-spacing:.04em}
    .grid{display:grid;grid-template-columns:repeat(6,1fr);gap:16px 14px}
    .cell{display:flex;flex-direction:column;align-items:center;gap:5px}
    .dot{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;
      background:#fff;border:1.5px solid var(--c);color:var(--c);box-shadow:0 1px 3px rgba(16,33,31,.07)}
    .dot svg{width:17px;height:17px;display:block;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
    .dot svg.contact-brand-glyph{width:calc(15px * var(--glyph-k,1));height:calc(15px * var(--glyph-k,1));fill:currentColor;stroke:none}
    .dot.is-latest{background:var(--c);color:#fff}
    .ty{font-size:11px;font-weight:600}
    .cl{font-size:9px;color:#9aa7b8}
  </style></head><body>
    <h2>客户旅程 · 节点图标</h2>
    <div class="sub">共 ${entries.length} 种（客户跟进 6 + 商机事件 12）。图标与配色直接解析自 prototype-api.ts，与线上同源。${missing.length ? `<b style="color:#be123c"> 缺 ${missing.length} 个：${missing.join(", ")}</b>` : ""}</div>
    <h3>普通节点</h3>${grid(false)}
    <h3>最新节点（实心）</h3>${grid(true)}
  </body></html>`;
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
  // dSF=2 贴近用户的视网膜屏：1.5px 边框在 dSF=1 下会被吸附成 1px，看不到真实效果。
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 2, mobile: false });
  await send("Page.navigate", { url: BASE });
  await sleep(4500);

  console.log("login ->", await evaluate(LOGIN));
  const opened = JSON.parse(await evaluate(OPEN_DRAWER));
  console.log("drawer ->", JSON.stringify(opened));
  await evaluate(FREEZE);
  await sleep(400);

  let dump = { ok: false };
  let hover = null;
  if (opened.ok) {
    dump = JSON.parse(await evaluate(DUMP));
    if (dump.ok) {
      await evaluate(FREEZE);
      await sleep(250);
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2, buttons: 0 });
      await sleep(200);
      const pad = 16;
      const f = await shot("journey-drawer", {
        x: Math.max(0, dump.rect.x - pad), y: Math.max(0, dump.rect.y - pad),
        width: Math.min(W, dump.rect.w + pad * 2), height: Math.min(H, dump.rect.h + pad * 2)
      }, 2);
      console.log(`  时间轴 -> ${path.basename(f)}  (${dump.count} 个节点)`);

      /* 悬停反馈：is-latest 的选择器权重更高，必须实测光环没被压掉。
         先把指针移开再移到最新节点，保证 hover 是真的新进入的。 */
      const lat = dump.items.find((i) => i.latest);
      if (lat) {
        await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 3, y: 3, buttons: 0 });
        await sleep(200);
        await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: lat.cx, y: lat.cy, buttons: 0 });
        await sleep(320);
        hover = JSON.parse(await evaluate(`(function(){
          const n=[...document.querySelectorAll('#customerJourneyTimeline .journey-node')].find(x=>x.classList.contains('is-latest'));
          const d=n.querySelector('.journey-dot'); const cs=getComputedStyle(d);
          return JSON.stringify({shadow:cs.boxShadow, transform:cs.transform, bg:cs.backgroundColor});})()`));
        await shot("journey-hover-latest", {
          x: Math.max(0, dump.rect.x - pad), y: Math.max(0, dump.rect.y - pad),
          width: Math.min(W, dump.rect.w + pad * 2), height: Math.min(H, dump.rect.h + pad * 2)
        }, 2);
        await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 3, y: 3, buttons: 0 });
      }
    }
  }

  /* ---- 断言 ---- */
  const checks = [];
  const add = (name, pass, detail) => checks.push({ name, pass, detail });
  if (dump.ok) {
    const items = dump.items;
    add("有节点渲染", items.length > 0, `${items.length}`);
    add("无 emoji 文本残留", items.every((i) => i.dotText === ""), JSON.stringify([...new Set(items.map((i) => i.dotText))]));
    add("每个圆点内都有 svg", items.every((i) => i.hasSvg), items.filter((i) => !i.hasSvg).map((i) => i.label).join(","));
    const strokeOnes = items.filter((i) => !i.brandGlyph);
    add("描边图标 fill=none", strokeOnes.every((i) => i.fill === "none"), JSON.stringify([...new Set(strokeOnes.map((i) => i.fill))]));
    add("描边颜色 = 节点色", strokeOnes.every((i) => i.stroke === i.color), JSON.stringify([...new Set(strokeOnes.map((i) => `${i.stroke}|${i.color}`))].slice(0, 3)));
    add("描边粗细 1.9px", strokeOnes.every((i) => i.strokeW === "1.9px"), JSON.stringify([...new Set(strokeOnes.map((i) => i.strokeW))]));
    // border 是 layout 属性，会做设备像素吸附（dSF=1 时 1.5px→1px）；stroke-width 是绘制属性，不受影响。
    add("圆点边框 1.5px", items.every((i) => i.borderW === "1.5px" || i.borderW === "1px"), JSON.stringify([...new Set(items.map((i) => i.borderW))]));
    add("圆点尺寸 36px", items.every((i) => i.dotW === 36 && i.dotH === 36), `${items[0]?.dotW}x${items[0]?.dotH}`);
    add("图标尺寸 17px", strokeOnes.every((i) => i.svgW === 17 && i.svgH === 17), JSON.stringify([...new Set(strokeOnes.map((i) => `${i.svgW}x${i.svgH}`))]));
    add("最新节点恰好 1 个", items.filter((i) => i.latest).length === 1, `${items.filter((i) => i.latest).length}`);
    const latest = items.find((i) => i.latest);
    const others = items.filter((i) => !i.latest);
    add("最新节点实心", latest ? latest.bg !== "rgb(255, 255, 255)" : false, latest ? latest.bg : "");
    add("其余节点白底", others.every((i) => i.bg === "rgb(255, 255, 255)"), JSON.stringify([...new Set(others.map((i) => i.bg))]));
    add("节点已入场(visible)", items.every((i) => i.visible), items.filter((i) => !i.visible).length + " 个未 visible");
    add("最新节点 hover 有光环", Boolean(hover && /0px 0px 0px 4px/u.test(hover.shadow)), hover ? hover.shadow : "(未取到)");
    add("最新节点 hover 放大", Boolean(hover && hover.transform !== "none"), hover ? hover.transform : "");
    // 语义不再糊在一起：不同 label 的图标应当不同（此前 6 种类型全 fallback 成同一个）
    const byLabel = new Map();
    for (const i of items) { if (!byLabel.has(i.label)) byLabel.set(i.label, new Set()); byLabel.get(i.label).add(i.svg); }
    const collapsed = [...byLabel.entries()].filter(([, s]) => s.size > 1).map(([l]) => l);
    add("同一 label 图标一致", collapsed.length === 0, collapsed.join(","));
    const uniq = new Set([...byLabel.values()].map((s) => [...s][0]));
    add("不同 label 图标不重复", uniq.size === byLabel.size, `${uniq.size}/${byLabel.size}（label：${[...byLabel.keys()].join(" / ")}）`);
  } else {
    add("取到旅程节点", false, JSON.stringify(opened) + JSON.stringify(dump).slice(0, 120));
  }

  /* ---- 图标板 ---- */
  add("板覆盖 18 种类型且无缺失", iconEntries.length === 18 && iconEntries.every((e) => !e.missing),
    `${iconEntries.length} 种${iconEntries.some((e) => e.missing) ? "，缺：" + iconEntries.filter((e) => e.missing).map((e) => e.type).join(",") : ""}`);
  const bp = path.join(OUT, "_board.html");
  fs.writeFileSync(bp, board(iconEntries));
  await send("Page.navigate", { url: "file://" + bp });
  await sleep(1000);
  await shot("journey-icons-board", null, 1.5);
  console.log(`  图标板 -> journey-icons-board.png（${iconEntries.length} 种）`);

  const result = { base: BASE, opened, hover, notes: { types: iconEntries.map((e) => e.type) }, dump, checks };
  fs.writeFileSync(path.join(OUT, "journey-icons.json"), JSON.stringify(result, null, 1));

  console.log("\n=== 检查项 ===");
  let bad = 0;
  for (const c of checks) {
    if (!c.pass) bad++;
    console.log(`  ${c.pass ? "PASS" : "FAIL"}  ${c.name}${c.pass ? "" : "   → " + c.detail}`);
  }
  console.log(`\n${checks.length - bad}/${checks.length} 通过 · JSON: ${path.join(OUT, "journey-icons.json")}`);
  if (dump.ok) {
    console.log("\n=== 节点 ===");
    for (const i of dump.items) {
      console.log(`  ${i.latest ? "★" : " "} ${i.label.padEnd(12)} ${i.date.padEnd(6)} ${i.brandGlyph ? "品牌字形" : "描边"} ${i.svgW}x${i.svgH} 色=${i.color} 底=${i.bg}`);
    }
  }
  child.kill("SIGKILL");
  process.exit(bad ? 1 : 0);
})();
