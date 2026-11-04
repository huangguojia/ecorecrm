#!/usr/bin/env node
/* 工作台重设计 · 方案出图脚本
   用真实页面（4188）+ 逐方案注入 CSS，产出同口径对比图。
   用法：node shoot.mjs  （输出到 frontend/dist/design-preview/shots/） */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CFT = "/Users/sendohakria/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const BASE = "http://127.0.0.1:4188/";
const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.resolve(HERE, "shots");
const PORT = 9444;
const W = 1680;
const H = 1320;

const PLANS = [
  ["before", "改版前（现状）", "before-restore.css"],
  ["plan-a", "A · 晨白原生", "plan-a-paper-native.css"],
  ["plan-b", "B · 柔光层叠", "plan-b-soft-depth.css"],
  ["plan-c", "C · 靛蓝墨玉", "plan-c-indigo-ink.css"],
  ["plan-d", "D · 行动优先", "plan-d-action-first.css"]
];

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
  console.log("  →", file);
}

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

  console.log("打开页面…");
  await send("Page.navigate", { url: BASE });
  await sleep(5000);

  console.log("登录…");
  await evaluate(`(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));
    const set=(sel,v)=>{const e=document.querySelector(sel); if(!e) return 0; e.focus(); e.value=v;
      e.dispatchEvent(new Event("input",{bubbles:true})); e.dispatchEvent(new Event("change",{bubbles:true})); return 1;};
    set("#loginEmail","admin@goodjob.com"); set("#loginPassword","goodjob123");
    document.querySelector("#loginButton").click(); await s(9000);
    return document.body.className;})()`);

  // 等工作台数据渲染完，并打开「晨会指挥带」（默认收起，需点击才 active）
  await evaluate(`(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms)); await s(3500);
    document.querySelector("#morningViewButton")?.click(); await s(1500);
    const d=document.querySelector("#dashboard"); d.scrollIntoView({block:"start"}); d.scrollTop=0; await s(400); return 1;})()`);

  // 稳定态样式（汇率条动画停掉，截图不糊）——每次 reload 后都要重新注入
  const injectStill = () => evaluate(`(()=>{document.getElementById("__gj-still")?.remove();
    const st=document.createElement("style");st.id="__gj-still";
    st.textContent="*{animation-play-state:paused !important}";document.head.appendChild(st);return 1;})()`);

  let scriptId = null;
  for (const [key, label, cssFile] of PLANS) {
    console.log(`\n[${label}]`);

    // 图表颜色是「渲染时」读取的（ECharts），所以方案样式必须在文档创建时就注入，
    // 否则漏斗折线会一直用页面首次加载时的颜色。用 addScriptToEvaluateOnNewDocument + reload。
    if (scriptId) {
      await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: scriptId });
      scriptId = null;
    }
    const css = fs.readFileSync(path.resolve(HERE, cssFile), "utf8");
    const pre = `(function(){var css=${JSON.stringify(css)};
      function ins(){if(!document.head)return false;var s=document.createElement("style");
        s.id="__gj-plan";s.textContent=css;document.head.appendChild(s);return true;}
      if(!ins()){var t=setInterval(function(){if(ins())clearInterval(t);},5);}})();`;
    const r = await send("Page.addScriptToEvaluateOnNewDocument", { source: pre });
    scriptId = r.identifier;

    await send("Page.reload", {});
    await sleep(7000);
    await evaluate(`(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms)); await s(2500);
      document.querySelector("#morningViewButton")?.click(); await s(5200);
      document.querySelectorAll("[class*=toast]").forEach(function(e){e.remove();});
      const d=document.querySelector("#dashboard"); d.scrollIntoView({block:"start"}); d.scrollTop=0; await s(400);
      return 1;})()`);
    await injectStill();
    await sleep(300);

    // 首屏
    await shot(`${key}-top`, null);

    // 工作台完整：页面内容是内部滚动容器（window 不滚动），
    // 所以先临时放大视口 + 解除内部滚动限制，让整块工作台完整落在视口内，再按视口坐标裁。
    await send("Emulation.setDeviceMetricsOverride", { width: W, height: 2400, deviceScaleFactor: 1, mobile: false });
    await evaluate(`(()=>{const st=document.createElement("style"); st.id="__gj-full";
      st.textContent=".workspace,.main{overflow:visible !important;height:auto !important;max-height:none !important}"+
        "#dashboard.dashboard-v2{min-height:0 !important}";
      document.head.appendChild(st); return 1;})()`);
    await evaluate(`(async()=>{window.scrollTo(0,0); await new Promise(r=>setTimeout(r,450)); return 1;})()`);
    const rect = await evaluate(`(()=>{const d=document.querySelector("#dashboard"); const r=d.getBoundingClientRect();
      return {x:Math.round(r.left), y:Math.round(r.top), width:Math.round(r.width), height:Math.round(r.height)};})()`, false);
    await shot(`${key}-full`, rect);
    await evaluate(`(()=>{document.getElementById("__gj-full")?.remove(); return 1;})()`);
    await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    await sleep(300);
  }

  console.log("\n完成。");
  child.kill();
  process.exit(0);
})().catch((e) => { console.error("失败：", e.message); child.kill(); process.exit(1); });
