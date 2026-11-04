#!/usr/bin/env node
/* 诊断：dev 模式下登录为什么没生效（抓 console / 异常 / 失败请求） */
import { spawn } from "node:child_process";
const CFT = "/Users/sendohakria/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const BASE = process.env.CRM_BASE || "http://127.0.0.1:5298/";
const PORT = 9498;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const child = spawn(CFT, ["--headless=new", `--remote-debugging-port=${PORT}`, "--no-sandbox", "--disable-gpu",
  "--disable-dev-shm-usage", "--no-first-run", "--hide-scrollbars", "--window-size=1440,900", "about:blank"],
  { stdio: ["ignore", "pipe", "pipe"] });
let ws, id = 0; const pending = new Map();
const send = (m, p) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.value;
(async () => {
  let url = null;
  for (let i = 0; i < 90; i++) { try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = l.find((t) => t.type === "page"); if (p?.webSocketDebuggerUrl) { url = p.webSocketDebuggerUrl; break; } } catch {} await sleep(200); }
  ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); return; }
    if (m.method === "Runtime.exceptionThrown") console.log("[EXC]", (m.params.exceptionDetails?.exception?.description || "").slice(0, 500));
    if (m.method === "Runtime.consoleAPICalled") console.log("[CON]", m.params.type, m.params.args.map((a) => String(a.value ?? a.description ?? "").slice(0, 220)).join(" "));
    if (m.method === "Network.loadingFailed") console.log("[NET-FAIL]", m.params.type, m.params.errorText);
    if (m.method === "Network.responseReceived" && m.params.response.status >= 400) console.log("[HTTP]", m.params.response.status, m.params.response.url.slice(0, 160));
  });
  await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable");
  await send("Page.navigate", { url: BASE });
  await sleep(9000);
  console.log("--- 初始:", await ev(`document.body.className + ' | btn=' + !!document.querySelector('#loginButton')`));
  console.log("--- 环境:", await ev(`JSON.stringify({
    ready: document.readyState,
    res: performance.getEntriesByType('resource').length,
    tail: performance.getEntriesByType('resource').slice(-6).map(r=>r.name.replace(location.origin,'').slice(0,70)+'/'+Math.round(r.duration)),
    scripts: [...document.querySelectorAll('script')].map(s=>(s.type||'')+':'+(s.src||'inline').replace(location.origin,'').slice(0,60)),
    email: document.querySelector('#loginEmail')?.value ?? 'MISSING',
    pwd: (document.querySelector('#loginPassword')?.value||'').length,
    btnHTML: (document.querySelector('#loginButton')?.outerHTML||'').slice(0,160),
    vue: typeof window.Vue, react: typeof window.React,
  })`));
  await ev(`(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));
    const set=(sel,v)=>{const e=document.querySelector(sel); if(!e) return 0; e.focus(); e.value=v;
      e.dispatchEvent(new Event("input",{bubbles:true})); e.dispatchEvent(new Event("change",{bubbles:true})); return 1;};
    set("#loginEmail","admin@goodjob.com"); set("#loginPassword","goodjob123");
    document.querySelector("#loginButton").click(); await s(9000); return 1;})()`);
  console.log("--- 点击后:", await ev(`JSON.stringify({cls:document.body.className,
    loginViewCls:document.querySelector('#loginView')?.className||'n/a',
    loginVisible:!!document.querySelector('#loginScreen,#loginView,.login-screen'),
    toast:(document.querySelector('#toast')?.innerText||'').slice(0,120),
    active:document.querySelector('.view.active')?.id||''})`));
  child.kill("SIGKILL"); process.exit(0);
})();
