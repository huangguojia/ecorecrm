#!/usr/bin/env node
/* 原型体检：逐页 headless 打开 → 收集控制台错误 / 横向溢出 / 文字裁切 / 对比度 → 截图
   用法：node verify-protos.mjs [outDir] [--only=01,02] */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CFT = "/Users/sendohakria/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const DIR = path.dirname(new URL(import.meta.url).pathname);
const OUT = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "/tmp/proto-shots";
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").split("=")[1];
fs.mkdirSync(OUT, { recursive: true });

const files = fs.readdirSync(DIR).filter((f) => /^\d\d-.*\.html$/.test(f)).sort()
  .filter((f) => !ONLY || ONLY.split(",").some((k) => f.startsWith(k)));
const PORT = 9610 + Math.floor(Math.random() * 30);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(CFT, ["--headless=new", `--remote-debugging-port=${PORT}`, "--no-sandbox", "--disable-gpu",
  "--disable-dev-shm-usage", "--no-first-run", "--hide-scrollbars", "--allow-file-access-from-files",
  "--force-device-scale-factor=1", "--window-size=1440,1000", "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
let ws, id = 0; const pending = new Map(); const logs = [];
const send = (m, p) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
async function ev(expr) { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description || "")); return r.result.value; }

(async () => {
  let wsUrl = null;
  for (let i = 0; i < 100; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = l.find((t) => t.type === "page"); if (p?.webSocketDebuggerUrl) { wsUrl = p.webSocketDebuggerUrl; break; } } catch {}
    await sleep(150);
  }
  ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
    if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params.type)) logs.push(`${m.params.type}: ` + m.params.args.map((a) => a.value ?? a.description ?? a.type).join(" "));
    if (m.method === "Runtime.exceptionThrown") logs.push("exception: " + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  });
  await send("Runtime.enable"); await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

  const report = [];
  for (const f of files) {
    logs.length = 0;
    await send("Page.navigate", { url: "file://" + path.join(DIR, f) });
    await sleep(1100);
    const checks = await ev(`(() => {
      const de = document.documentElement;
      const overflowX = de.scrollWidth - de.clientWidth;
      const clipped = [];
      document.querySelectorAll('.stage *').forEach((el) => {
        const cs = getComputedStyle(el);
        if (cs.overflow === 'hidden' && cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
          clipped.push((el.className || el.tagName) + ' :: ' + (el.textContent || '').trim().slice(0, 24));
        }
      });
      const small = [];
      document.querySelectorAll('.stage *').forEach((el) => {
        if (!el.textContent || el.children.length) return;
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs && fs < 8) small.push((el.className||el.tagName) + ' ' + fs + 'px');
      });
      // 对比度：正文（p/td/li）4.2；次要标签（span/small/th/em）3.2；有渐变/深色图的容器跳过
      const parse = (c) => (c.match(/[\\d.]+/g) || []).map(Number);
      const lum = (r, g, b) => { const a = [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]; };
      const low = [];
      document.querySelectorAll('.stage p, .stage span, .stage li, .stage td, .stage small, .stage h1, .stage h2, .stage h3, .stage b').forEach((el) => {
        if (!el.textContent.trim() || el.children.length) return;
        const cs = getComputedStyle(el);
        const fg = parse(cs.color);
        let bgEl = el, bg = null, hasImage = false;
        while (bgEl) {
          const bcs = getComputedStyle(bgEl);
          if (bcs.backgroundImage && bcs.backgroundImage !== 'none') hasImage = true;
          const b = parse(bcs.backgroundColor);
          if (b.length >= 3 && (b[3] === undefined || b[3] > 0.5)) { bg = b; break; }
          bgEl = bgEl.parentElement;
        }
        if (hasImage) return;
        if (!bg) bg = [255, 255, 255];
        const L1 = lum(fg[0], fg[1], fg[2]), L2 = lum(bg[0], bg[1], bg[2]);
        const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
        const tag = el.tagName.toLowerCase();
        const need = ['p', 'td', 'li', 'h1', 'h2', 'h3'].includes(tag) ? 4.2 : 3.2;
        if (ratio < need) low.push(ratio.toFixed(1) + ':1 ' + el.textContent.trim().slice(0, 18));
      });
      return { overflowX, clipped: clipped.slice(0, 6), small: [...new Set(small)].slice(0, 6), low: [...new Set(low)].slice(0, 8), height: de.getBoundingClientRect().height };
    })()`);
    const h = Math.ceil(checks.height);
    const png = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 1440, height: h, scale: 1 }, captureBeyondViewport: true });
    const out = path.join(OUT, f.replace(/\.html$/, ".png"));
    fs.writeFileSync(out, Buffer.from(png.data, "base64"));
    report.push({ file: f, ...checks, logs: [...new Set(logs)].slice(0, 5), shot: out });
  }

  let bad = 0;
  for (const r of report) {
    const issues = [];
    if (r.overflowX > 1) issues.push(`横向溢出 ${r.overflowX}px`);
    if (r.clipped.length) issues.push(`裁切 ${r.clipped.length}`);
    if (r.logs.length) issues.push(`控制台 ${r.logs.length}`);
    if (r.low.length) issues.push(`低对比 ${r.low.length}`);
    if (r.small.length) issues.push(`过小字号 ${r.small.join(",")}`);
    if (issues.length) bad++;
    console.log(`\n${issues.length ? "✗" : "✓"} ${r.file}  h=${Math.round(r.height)}  ${issues.join(" | ") || "OK"}`);
    if (r.clipped.length) console.log("   裁切:", r.clipped.join(" / "));
    if (r.logs.length) console.log("   日志:", r.logs.join(" / "));
    if (r.low.length) console.log("   低对比:", r.low.join(" / "));
  }
  console.log(`\n${report.length - bad}/${report.length} 通过，截图在 ${OUT}`);
  child.kill("SIGKILL");
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); child.kill("SIGKILL"); process.exit(2); });
