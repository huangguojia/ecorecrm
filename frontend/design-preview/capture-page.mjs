#!/usr/bin/env node
/* 通用整页截图：node capture-page.mjs <file-or-url> <out.png> [width] [height]
   用法：把本地 HTML 整页截成一张图（读图核对用） */
import { spawn } from "node:child_process";
import fs from "node:fs";
const CFT = "/Users/sendohakria/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const [target, out] = process.argv.slice(2);
const W = Number(process.argv[4] || 1080), H = Number(process.argv[5] || 900);
const PORT = 9460 + Math.floor(Math.random() * 20);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const child = spawn(CFT, ["--headless=new", `--remote-debugging-port=${PORT}`, "--no-sandbox", "--disable-gpu",
  "--disable-dev-shm-usage", "--no-first-run", "--hide-scrollbars", "--allow-file-access-from-files",
  `--window-size=${W},${H}`, "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
let ws, id = 0; const pending = new Map();
const send = (m, p) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
async function ev(e) { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); return r.result?.value; }
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
  await send("Page.navigate", { url: target });
  await sleep(2500);
  const h = await ev("Math.ceil(document.documentElement.getBoundingClientRect().height)");
  const limit = Number(process.argv[6] || 0);
  const y0 = Number(process.argv[7] || 0);
  const hh = limit ? Math.min(h - y0, limit) : h - y0;
  const r = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: y0, width: W, height: hh, scale: 1 }, captureBeyondViewport: true });
  fs.writeFileSync(out, Buffer.from(r.data, "base64"));
  console.log(out, `${W}x${hh}`, "total", h, "from y", y0);
  child.kill("SIGKILL"); process.exit(0);
})();
