#!/usr/bin/env node
/* 实证核验：真实浏览器里「Hint 聚焦后是否真的消失」。
   对若干视图里的输入框逐个 focus()，读 getComputedStyle(el,'::placeholder').color。
   期望：失焦时 = rgb(148,163,182)，聚焦后 = rgba(0, 0, 0, 0)（透明）。
   用法：node verify-hint.mjs */
import { spawn } from "node:child_process";

const CFT = "/Users/sendohakria/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const BASE = "http://127.0.0.1:4188/";
const PORT = 9470;
const W = 1680, H = 1200;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(CFT, [
  "--headless=new", `--remote-debugging-port=${PORT}`,
  "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
  "--no-first-run", "--no-default-browser-check", "--hide-scrollbars",
  `--window-size=${W},${H}`, "about:blank",
], { stdio: ["ignore", "pipe", "pipe"] });
let stderr = ""; child.stderr.on("data", (d) => { stderr += d; });

let ws, id = 0; const pending = new Map();
const send = (m, p) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
async function evaluate(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "eval failed");
  return r.result.value;
}

const PROBE = `(function(){
  const out = [];
  const sel = 'input[placeholder], textarea[placeholder]';
  document.querySelectorAll(sel).forEach((el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || el.offsetParent === null) return;
    if (el.type === 'checkbox' || el.type === 'radio' || el.type === 'hidden') return;
    // 折叠的 <details> 里的控件根本拿不到焦点（focus() 是空操作），
    // 用户也点不进去 —— 不属于「Hint 点了不消失」的范畴，单列。
    if (el.closest('details:not([open])')) return;
    const ph = (el.getAttribute('placeholder') || '').slice(0, 26);
    if (!ph) return;
    const before = getComputedStyle(el, '::placeholder').color;
    el.focus();
    const focused = el.matches(':focus');
    const after = getComputedStyle(el, '::placeholder').color;
    const fs = cs.fontSize, h = Math.round(el.getBoundingClientRect().height);
    out.push({ ph, before, after, focused, fs, h, tag: el.tagName.toLowerCase(), cls: (el.className || '').slice(0, 28) });
    el.blur();
  });
  return JSON.stringify(out.slice(0, 16));
})()`;

(async () => {
  let wsUrl = null;
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = list.find((t) => t.type === "page");
      if (p?.webSocketDebuggerUrl) { wsUrl = p.webSocketDebuggerUrl; break; }
    } catch { /* 等端口 */ }
    await sleep(200);
  }
  if (!wsUrl) throw new Error("CDP 连不上\n" + stderr.slice(-600));
  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(`CDP ${m.error.message}`)) : res(m.result); }
  });
  await send("Runtime.enable"); await send("Page.enable");
  /* headless 下窗口没有系统焦点 → :focus 不会匹配（activeElement 却是对的）。
     打开 focus 仿真，页面才会像真实前台窗口一样响应 :focus / :focus-visible。 */
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: BASE });
  await sleep(5000);
  await evaluate(`(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));
    const set=(sel,v)=>{const e=document.querySelector(sel); if(!e) return 0; e.focus(); e.value=v;
      e.dispatchEvent(new Event("input",{bubbles:true})); e.dispatchEvent(new Event("change",{bubbles:true})); return 1;};
    set("#loginEmail","admin@goodjob.com"); set("#loginPassword","goodjob123");
    document.querySelector("#loginButton").click(); await s(9000); return 1;})()`);

  const VIEWS = ["customers", "leads", "products", "settings", "profile", "memos", "agent-skills", "prospect-list", "lead-finder"];
  let pass = 0, fail = 0, total = 0;
  for (const vid of VIEWS) {
    const ok = await evaluate(`(function(){const b=document.querySelector('[data-view="${vid}"]'); if(!b) return 0; b.click(); return 1;})()`);
    if (!ok) { console.log(`  ✗ ${vid} 导航不存在`); continue; }
    await sleep(1500);
    const rows = JSON.parse(await evaluate(PROBE));
    console.log(`### ${vid}  (${rows.length} 个可见占位符)`);
    for (const r of rows) {
      total++;
      // 透明判定：rgba(...,0) 或 transparent
      const gone = /rgba\(\s*0,\s*0,\s*0,\s*0\s*\)|transparent/.test(r.after);
      const restored = !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)|transparent/.test(r.before);
      const ok = gone && restored && r.focused;
      if (ok) pass++; else fail++;
      console.log(`   ${ok ? "✓" : "✗"} ${r.fs.padStart(6)} h${String(r.h).padStart(3)}  聚焦=${String(r.focused).padEnd(5)} 失焦=${r.before.padEnd(22)} 聚焦色=${r.after.padEnd(22)} |${r.ph}|`);
    }
  }
  console.log(`\n结果：${pass}/${total} 通过，${fail} 失败`);
  child.kill("SIGKILL");
  process.exit(fail ? 1 : 0);
})();
