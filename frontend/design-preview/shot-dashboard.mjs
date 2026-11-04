#!/usr/bin/env node
/* 登录后截工作台：node shot-dashboard.mjs <out.png> [width] [height] */
import { spawn } from "node:child_process";
import fs from "node:fs";
const CFT = "/Users/sendohakria/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const out = process.argv[2] || "/tmp/dash.png";
const W = Number(process.argv[3] || 1600), H = Number(process.argv[4] || 1000);
const PORT = 9520 + Math.floor(Math.random() * 20);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const child = spawn(CFT, ["--headless=new", `--remote-debugging-port=${PORT}`, "--no-sandbox", "--disable-gpu",
  "--disable-dev-shm-usage", "--no-first-run", "--hide-scrollbars",
  `--window-size=${W},${H}`, "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
let ws, id = 0; const pending = new Map();
const send = (m, p) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
async function ev(e) { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result?.value; }
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
  await send("Page.navigate", { url: "http://127.0.0.1:5188/" });
  await sleep(3000);
  const loginState = await ev(`(() => { const e = document.querySelector('#loginEmail'); return e ? 'login-form' : 'maybe-logged-in'; })()`);
  console.log("state:", loginState);
  if (loginState === "login-form") {
    await ev(`(() => {
      const set = (sel, val) => { const el = document.querySelector(sel); if (!el) return false; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(el, val); el.dispatchEvent(new Event('input', { bubbles: true })); return true; };
      set('#loginEmail', 'admin@goodjob.com'); set('#loginPassword', 'goodjob123');
      document.querySelector('#loginButton')?.click();
      return true;
    })()`);
    await sleep(6000);
  }
  await ev(`(() => { const b = [...document.querySelectorAll('[data-view]')].find(x => x.dataset.view === 'dashboard'); b?.click(); return !!b; })()`);
  await sleep(3000);
  const h = await ev("Math.ceil(document.documentElement.getBoundingClientRect().height)");
  const r = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: W, height: Math.min(h, 2400), scale: 1 }, captureBeyondViewport: true });
  fs.writeFileSync(out, Buffer.from(r.data, "base64"));
  console.log(out, `${W}x${Math.min(h, 2400)}`, "total", h);
  child.kill("SIGKILL"); process.exit(0);
})().catch((e) => { console.error(e); child.kill("SIGKILL"); process.exit(1); });
