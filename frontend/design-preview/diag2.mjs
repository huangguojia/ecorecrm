import { spawn } from "node:child_process";
const CFT = "/Users/sendohakria/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const PORT = 9502;
const child = spawn(CFT, ["--headless=new", `--remote-debugging-port=${PORT}`, "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--no-first-run", "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let url = null;
for (let i = 0; i < 60; i++) {
  try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = l.find((t) => t.type === "page"); if (p) { url = p.webSocketDebuggerUrl; break; } } catch {}
  await sleep(200);
}
const ws = new WebSocket(url);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0; const pend = new Map();
const failed = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.method === "Network.loadingFailed") failed.push(`${m.params.type} ${m.params.errorText} blocked=${m.params.blockedReason || ""}`);
  if (m.method === "Network.responseReceived" && m.params.response.status >= 400) failed.push(`HTTP ${m.params.response.status} ${m.params.response.url.slice(0, 120)}`);
  if (m.method === "Runtime.exceptionThrown") failed.push("EXC " + (m.params.exceptionDetails.exception?.description || "").slice(0, 200));
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
});
const send = (method, params) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
const ev = async (x) => { const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? "ERR " + (r.exceptionDetails.exception?.description || "").slice(0, 200) : r.result.value; };
await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable");
await send("Page.navigate", { url: "http://127.0.0.1:5298/" });
await sleep(12000);
console.log("entryScript present?", await ev(`String(!!document.querySelector('script[src*="prototype-api"]'))`));
console.log("all scripts:", await ev(`[].map.call(document.querySelectorAll('script'),s=>s.src||('inline:'+s.textContent.length)).join(' | ')`));
console.log("body class:", await ev(`document.body.className`));
console.log("loginBtn onclick:", await ev(`String(!!(document.querySelector('#loginButton')||{}).onclick)`));
console.log("app markers:", await ev(`JSON.stringify({views:document.querySelectorAll('.view').length, nav:document.querySelectorAll('[data-view]').length, charts:!!window.echarts, st:!!document.querySelector('.sidebar')})`));
console.log("--- 失败/异常 ---");
console.log(failed.slice(0, 25).join("\n") || "(none)");
child.kill("SIGKILL"); process.exit(0);
