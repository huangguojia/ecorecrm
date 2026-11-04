#!/usr/bin/env node
/* 各界面「右上方文字」巡检：登录 → 逐个视图 → 抽取右上区文字节点(含计算字号/颜色/字重) + 截图顶部条
   用法：node review-topright.mjs [--shot] [--outdir=...] */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CFT = "/Users/sendohakria/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const BASE = "http://127.0.0.1:4188/";
const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.resolve(HERE, "shots-topright");
const PORT = 9446;
const W = 1680;
const H = 1200;

const argShot = process.argv.includes("--shot");

const VIEWS = [
  ["dashboard", "工作台"], ["customers", "客户"], ["leads", "线索"], ["customer-pool", "客户公池"],
  ["pipeline", "商机"], ["reminders", "提醒规则"], ["todo", "待办中心"], ["prospect-list", "搜客清单"],
  ["lead-finder", "搜客雷达"], ["outreach-batches", "发信批次"], ["outreach-journey", "发信明细"],
  ["plan-growth", "增长计划"], ["memos", "备忘"], ["ai-agent", "AI 助手"], ["approval-center", "审批中心"],
  ["integration-center", "对接中心"], ["maintenance-center", "维护中心"], ["sales-skill-center", "技能中心"],
  ["commission", "提成对账"], ["reports", "报表"], ["shipments", "发货跟踪"], ["global-map", "全球地图"],
  ["email-return-flow", "回流"], ["tools", "工具箱"], ["sales-distillation", "销售蒸馏"],
  ["knowledge", "资料库"], ["exam", "考试"], ["wecom", "企业微信"], ["daily-reports", "日报"],
  ["competitors", "竞品"], ["cases", "案例"], ["problems", "问题"], ["products", "产品维护"],
  ["leaderboard", "排行榜"], ["agent-skills", "技能库"], ["documents", "单证"], ["exchange", "汇率"],
  ["whatsapp", "WhatsApp"], ["peers", "同行"], ["member-management", "成员"], ["organization-structure", "组织"],
  ["role-management", "角色"], ["ui-access", "界面权限"], ["member-authorization", "授权"],
  ["permission-audit", "权限审计"], ["database-maintenance", "数据库"], ["ai-config", "AI配置"],
  ["logs", "日志"], ["theme", "主题"], ["approval-workflows", "审批流"], ["settings", "设置"], ["profile", "个人主页"]
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
  return file;
}

/* 抽取：当前 active 视图里，落在「首屏右上区」的文字节点 */
const EXTRACT = `(function(){
  const view = document.querySelector('.view.active');
  if (!view) return JSON.stringify({err:'no active view'});
  const vr = view.getBoundingClientRect();
  const nodes = [];
  const isText = (el) => {
    if (!el.childNodes.length) return false;
    return [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 0);
  };
  const walk = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const top = r.top - vr.top;
    if (top > 200) return;                      // 只看首屏顶部 200px
    const relLeft = r.left - vr.left;
    const txt = (el.innerText || '').trim();
    if (isText(el) && txt && txt.length < 160) {
      let chain = [], p = el.parentElement, n = 0;
      while (p && n < 4) {
        const c = (typeof p.className === 'string' && p.className) ? '.' + p.className.trim().split(/\s+/).join('.') : (p.id ? '#' + p.id : p.tagName.toLowerCase());
        chain.push(c); p = p.parentElement; n++;
      }
      nodes.push({
        tag: el.tagName.toLowerCase(),
        chain: chain.join(' < ').slice(0, 160),
        cls: (el.className && typeof el.className === 'string') ? el.className.slice(0, 70) : '',
        text: txt.replace(/\\s+/g, ' ').slice(0, 90),
        size: cs.fontSize, weight: cs.fontWeight, color: cs.color,
        ls: cs.letterSpacing, lh: cs.lineHeight,
        x: Math.round(relLeft), y: Math.round(top), w: Math.round(r.width), h: Math.round(r.height),
        rightGap: Math.round(vr.width - (r.right - vr.left))
      });
    }
    for (const c of el.children) walk(c);
  };
  walk(view);
  // 视图自身的头部容器统计
  const heads = [...view.querySelectorAll(':scope > header, :scope > .page-head, :scope > .view-head, :scope > .th-page-head')]
    .map(h => ({ cls: (typeof h.className === 'string' ? h.className : '').slice(0,60), top: Math.round(h.getBoundingClientRect().top - vr.top), h: Math.round(h.getBoundingClientRect().height) }));
  // 顶栏右上（全局）
  const topRight = [...document.querySelectorAll('.topbar .top-actions *')].filter(el => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    const t = (el.innerText || '').trim();
    return t && [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
  }).map(el => { const cs = getComputedStyle(el); return {
    cls: (typeof el.className === 'string' ? el.className : '').slice(0,40),
    text: (el.innerText||'').trim().replace(/\\s+/g,' ').slice(0,50),
    size: cs.fontSize, weight: cs.fontWeight, color: cs.color }; });
  return JSON.stringify({ view: view.id, vw: Math.round(vr.width), heads, nodes, topRight });
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
  for (const [vid, label] of VIEWS) {
    const ok = await evaluate(`(function(){const b=document.querySelector('[data-view="${vid}"]'); if(!b) return 0; b.click(); return 1;})()`);
    if (!ok) { results.push({ vid, label, missing: true }); continue; }
    await sleep(1600);
    let data;
    try { data = JSON.parse(await evaluate(EXTRACT)); } catch (e) { data = { err: String(e).slice(0, 120) }; }
    results.push({ vid, label, ...data });
    if (argShot) {
      const f = await shot(`${vid}`, { x: 0, y: 0, width: W, height: 340 });
      console.log(`  ${vid} -> ${f}`);
    } else {
      console.log(`  ${vid} ok`);
    }
  }

  fs.writeFileSync(path.join(OUT, "topright.json"), JSON.stringify(results, null, 1));
  console.log("\nJSON:", path.join(OUT, "topright.json"));
  child.kill("SIGKILL");
  process.exit(0);
})();
