import { spawn } from "node:child_process";
const CFT = "/Users/sendohakria/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const PORT = 9503;
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
const reqs = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.method === "Network.requestWillBeSent" && /prototype-api|\.ts|auth\/login/.test(m.params.request.url)) reqs.push(Date.now() + " " + m.params.request.method + " " + m.params.request.url.slice(-70));
  if (m.method === "Runtime.exceptionThrown") console.log("  [EXC]", (m.params.exceptionDetails.exception?.description || "").slice(0, 300));
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
});
const send = (method, params) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
const ev = async (x) => { const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? "ERR " + (r.exceptionDetails.exception?.description || "").slice(0, 200) : r.result.value; };
await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable");
const t0 = Date.now();
await send("Page.navigate", { url: "http://127.0.0.1:5298/" });
for (let i = 1; i <= 12; i++) {
  await sleep(5000);
  const st = await ev(`JSON.stringify({prefill:(document.querySelector('#loginEmail')||{}).value||'', authed:document.body.classList.contains('is-authenticated'), cls:document.querySelector('#loginEmail')?document.querySelector('#loginEmail').className:''})`);
  console.log(`${((Date.now()-t0)/1000).toFixed(0)}s -> ${st}`);
  if (/is-authenticated":true/.test(st)) break;
}
console.log("--- 关键请求 ---");
console.log(reqs.slice(0, 12).join("\n") || "(none)");
console.log("--- 再点一次登录 ---");
await ev(`(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));
  const e=document.querySelector('#loginEmail'), p=document.querySelector('#loginPassword');
  e.value='admin@goodjob.com'; p.value='goodjob123';
  e.dispatchEvent(new Event('input',{bubbles:true})); p.dispatchEvent(new Event('input',{bubbles:true}));
  document.querySelector('#loginButton').click(); await s(6000);
  return document.body.className;})()`);
await sleep(4000);
console.log("body ->", await ev(`document.body.className`));
console.log("toast ->", await ev(`(document.querySelector('#toast')||{}).innerText||''`));
child.kill("SIGKILL"); process.exit(0);
