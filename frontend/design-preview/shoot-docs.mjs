#!/usr/bin/env node
/* 文档管理（文件中心 / Skill 资源中心）现状取景 + 结构抽取。
   用法：node shoot-docs.mjs
   产物：shots-docs/*.png + shots-docs/docs.json */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CFT = "/Users/sendohakria/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const BASE = "http://127.0.0.1:4188/";
const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.resolve(HERE, "shots-docs");
const PORT = 9495;
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

async function shot(name, clip) {
  const params = { format: "png" };
  if (clip) { params.clip = { ...clip, scale: 1 }; params.captureBeyondViewport = true; }
  const r = await send("Page.captureScreenshot", params);
  const file = path.join(OUT, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(r.data, "base64"));
  return file;
}

async function fullShot(name) {
  const h = await evaluate("Math.ceil(document.documentElement.getBoundingClientRect().height)");
  return shot(name, { x: 0, y: 0, width: W, height: h });
}

/* 抽取：当前视图里所有可见文字节点的计算样式 + 关键块几何 */
const EXTRACT = `(function(){
  const view = document.querySelector('.view.active');
  if (!view) return JSON.stringify({err:'no active view'});
  const cs2 = (el) => getComputedStyle(el);
  const vis = (el) => { const c = cs2(el); return c.display!=='none' && c.visibility!=='hidden' && Number(c.opacity)>0.05; };
  const nodes = [];
  const walk = (el) => {
    if (!vis(el)) return;
    const r = el.getBoundingClientRect();
    if (r.width===0||r.height===0) return;
    const isText = [...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim().length>0);
    if (isText) {
      const c = cs2(el);
      nodes.push({
        tag: el.tagName.toLowerCase(),
        cls: (typeof el.className==='string'?el.className:'').slice(0,60),
        id: el.id||'',
        text: (el.innerText||'').trim().replace(/\\s+/g,' ').slice(0,70),
        size:c.fontSize, weight:c.fontWeight, color:c.color, ls:c.letterSpacing,
        x:Math.round(r.left), y:Math.round(r.top), w:Math.round(r.width), h:Math.round(r.height)
      });
    }
    for (const c of el.children) walk(c);
  };
  walk(view);
  // 空态 / 提示
  const empties = [...view.querySelectorAll('.file-center-empty,.file-detail-empty,.empty,.muted,small')]
    .filter(vis).map(e=>({cls:(typeof e.className==='string'?e.className:'').slice(0,40), text:(e.innerText||'').trim().replace(/\\s+/g,' ').slice(0,60)}));
  // 按钮
  const buttons = [...view.querySelectorAll('button,a.btn')].filter(vis).map(b=>({text:(b.innerText||'').trim().replace(/\\s+/g,''), id:b.id||'', disabled:b.disabled}));
  return JSON.stringify({view:view.id, vw:Math.round(view.getBoundingClientRect().width), nodes, empties, buttons});
})()`;

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

  const results = [];
  for (const [vid, label] of [["knowledge", "文件中心"], ["agent-skills", "Skill 资源中心"], ["products", "产品维护"]]) {
    const ok = await evaluate(`(function(){const b=document.querySelector('[data-view="${vid}"]'); if(!b) return 0; b.click(); return 1;})()`);
    if (!ok) { results.push({ vid, label, missing: true }); continue; }
    await sleep(2500);
    let data;
    try { data = JSON.parse(await evaluate(EXTRACT)); } catch (e) { data = { err: String(e).slice(0, 160) }; }
    data.vid = vid; data.label = label;
    results.push(data);
    await fullShot(vid);
    console.log(`  ${vid} -> shots-docs/${vid}.png  nodes=${(data.nodes || []).length}`);
  }

  // 文件中心：添加资料弹窗
  await evaluate(`(function(){const b=document.querySelector('[data-view="knowledge"]'); if(b) b.click(); return 1;})()`);
  await sleep(1800);
  await evaluate(`(function(){document.querySelector('#knowledgeAddButton')?.click(); return 1;})()`);
  await sleep(900);
  await shot("knowledge-add-modal");
  const modalInfo = await evaluate(`(function(){
    const m=document.querySelector('#appModal .modal'); if(!m) return JSON.stringify({ok:false});
    const r=m.getBoundingClientRect();
    const items=[...m.querySelectorAll('label,input,select,textarea,.file-source-note,button')].map(e=>{
      const c=getComputedStyle(e); const b=e.getBoundingClientRect();
      return {tag:e.tagName.toLowerCase(), text:(e.innerText||e.value||e.getAttribute('placeholder')||'').trim().slice(0,60),
        size:c.fontSize, h:Math.round(b.height), disabled:!!e.disabled};
    });
    return JSON.stringify({ok:true, w:Math.round(r.width), h:Math.round(r.height), items});
  })()`);
  results.push({ vid: "knowledge-add-modal", label: "添加资料弹窗", modal: JSON.parse(modalInfo) });
  console.log("  modal -> shots-docs/knowledge-add-modal.png");

  fs.writeFileSync(path.join(OUT, "docs.json"), JSON.stringify(results, null, 1));
  console.log("\nJSON:", path.join(OUT, "docs.json"));
  child.kill("SIGKILL");
  process.exit(0);
})();
