#!/usr/bin/env node
/* 插件「训练与自动回复」页取景。用法：node shoot-plugin-training.mjs */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const CFT = "/Users/sendohakria/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.resolve(HERE, "shots-docs");
const PORT = 9496;
const W = 1480, H = 1100;
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const child = spawn(CFT, ["--headless=new", `--remote-debugging-port=${PORT}`, "--no-sandbox", "--disable-gpu",
  "--disable-gpu-sandbox", "--in-process-gpu", "--disable-software-rasterizer", "--disable-dev-shm-usage",
  "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", `--window-size=${W},${H}`, "about:blank"],
  { stdio: ["ignore", "pipe", "pipe"] });
let stderr = ""; child.stderr.on("data", (d) => { stderr += d; });
let ws, id = 0; const pending = new Map();
const send = (m, p) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
async function ev(expr) { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "eval"); return r.result.value; }
async function shot(name, clip) { const p = { format: "png" }; if (clip) { p.clip = { ...clip, scale: 1 }; p.captureBeyondViewport = true; } const r = await send("Page.captureScreenshot", p); fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(r.data, "base64")); }
(async () => {
  let wsUrl = null;
  for (let i = 0; i < 80; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = l.find(t => t.type === "page"); if (p?.webSocketDebuggerUrl) { wsUrl = p.webSocketDebuggerUrl; break; } } catch {} await sleep(200); }
  if (!wsUrl) throw new Error("CDP 连不上 " + stderr.slice(-400));
  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } });
  await send("Runtime.enable"); await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: "http://127.0.0.1:5193/?view=training" });
  await sleep(7000);
  const info = await ev(`(function(){
    const txt=document.body.innerText||'';
    const headings=[...document.querySelectorAll('h1,h2,h3')].map(h=>h.innerText.trim()).slice(0,30);
    const nodes=[...document.querySelectorAll('*')].filter(e=>{const c=getComputedStyle(e);
      return c.display!=='none'&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());}).map(e=>{
      const c=getComputedStyle(e); const r=e.getBoundingClientRect();
      return {tag:e.tagName.toLowerCase(),cls:(typeof e.className==='string'?e.className:'').slice(0,44),
        text:(e.innerText||'').trim().replace(/\\s+/g,' ').slice(0,50),size:c.fontSize,weight:c.fontWeight,color:c.color,
        x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width)};});
    const sizes={};nodes.forEach(n=>sizes[n.size]=(sizes[n.size]||0)+1);
    return JSON.stringify({headings,sizeDist:sizes,count:nodes.length,nodes:nodes.slice(0,140)});
  })()`);
  fs.writeFileSync(path.join(OUT, "plugin-training.json"), info);
  const h = await ev("Math.ceil(document.documentElement.getBoundingClientRect().height)");
  await shot("plugin-training", { x: 0, y: 0, width: W, height: Math.min(h, 6000) });
  console.log("plugin-training.png  totalH=" + h);
  child.kill("SIGKILL"); process.exit(0);
})();
