#!/usr/bin/env node
/* 弹窗输入框巡检：逐个视图点开「新增/新建/编辑/配置」类按钮 → 抽取弹窗内所有输入框
   用法：node review-modals.mjs [--shot] */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const CFT = "/Users/sendohakria/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const BASE = "http://127.0.0.1:4188/";
const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.resolve(HERE, "shots-modals");
const PORT = 9448;
const W = 1680;
const H = 1200;
const argShot = process.argv.includes("--shot");

const VIEWS = [
  ["customers", "客户"], ["leads", "线索"], ["pipeline", "商机"], ["todo", "待办中心"],
  ["products", "产品维护"], ["shipments", "发货跟踪"], ["reminders", "提醒规则"],
  ["memos", "备忘"], ["knowledge", "资料库"], ["agent-skills", "技能库"],
  ["outreach-batches", "发信批次"], ["prospect-list", "搜客清单"], ["profile", "个人主页"],
  ["settings", "设置"], ["ai-config", "AI配置"], ["member-management", "成员"],
  ["commission", "提成对账"], ["exchange", "汇率"], ["peers", "同行"],
  ["customer-pool", "客户公池"], ["problems", "问题"], ["cases", "案例"],
  ["documents", "单证"], ["maintenance-center", "维护中心"], ["integration-center", "对接中心"]
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
async function shot(name) {
  const r = await send("Page.captureScreenshot", { format: "png" });
  const file = path.join(OUT, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(r.data, "base64"));
  return file;
}

const EXTRACT = `(function(){
  const root = document.querySelector('#appModal.active');
  if (!root) return JSON.stringify({err:'no modal'});
  const title = (document.querySelector('#modalTitle')||{}).textContent || '';
  const out = [];
  const els = [...root.querySelectorAll('input,textarea,select,[contenteditable="true"]')];
  for (const el of els) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) continue;
    const type = (el.getAttribute('type') || el.tagName.toLowerCase()).toLowerCase();
    if (['hidden','checkbox','radio','file','submit','button','reset','image','range','color'].includes(type)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 12 || r.height < 8) continue;
    let chain = [], p = el.parentElement, n = 0;
    while (p && n < 3) {
      const c = (typeof p.className === 'string' && p.className) ? '.' + p.className.trim().split(/\\s+/).join('.') : (p.id ? '#' + p.id : p.tagName.toLowerCase());
      chain.push(c); p = p.parentElement; n++;
    }
    out.push({
      tag: el.tagName.toLowerCase(), type,
      cls: (typeof el.className === 'string') ? el.className.slice(0,50) : '',
      chain: chain.join(' < ').slice(0,110),
      id: el.id || '',
      ph: (el.getAttribute('placeholder')||'').replace(/\\s+/g,' ').slice(0,46),
      size: parseFloat(cs.fontSize), sizeRaw: cs.fontSize, weight: cs.fontWeight,
      h: +r.height.toFixed(1), w: Math.round(r.width),
      ratio: +(parseFloat(cs.fontSize) / Math.max(1, r.height)).toFixed(2),
      radius: cs.borderRadius, color: cs.color,
      phColor: (()=>{try{return getComputedStyle(el,'::placeholder').color;}catch{return '';}})(),
      multi: el.tagName === 'TEXTAREA'
    });
  }
  return JSON.stringify({ title: title.trim(), count: out.length, items: out, modalCls: (document.querySelector('#appModal .modal')||{}).className || '' });
})()`;

/* 可以在页面上安全点击的「打开表单」类按钮 */
const OPEN = `(function(){
  const view = document.querySelector('.view.active');
  if (!view) return JSON.stringify([]);
  const BAD = /(删除|清空|移除|重置|提交|保存|执行|运行|发送|发布|同步|退出|注销|停用|归档|批量|立即|确认|取消|关闭|登出)/;
  const OK = /^(新增|新建|添加|创建|编辑|配置|设置|导入|登记|上传|生成|绑定|维护|分组|规则|模板|邀请|分配|授权)/;
  const list = [...view.querySelectorAll('button, a.btn')].filter(b => {
    const t = (b.innerText||'').trim().replace(/\\s+/g,'').replace(/^[＋+·•＊*≥>\-]+/,'');
    const cs = getComputedStyle(b);
    if (cs.display==='none'||cs.visibility==='hidden') return false;
    const r = b.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return false;
    return t && t.length < 14 && OK.test(t) && !BAD.test(t);
  });
  return JSON.stringify(list.slice(0,6).map(b => (b.innerText||'').trim().replace(/\\s+/g,'').replace(/^[＋+·•＊*≥>\-]+/,'')));
})()`;

const CLICK = (text) => `(function(){
  const norm = (s) => (s||'').trim().replace(/\\s+/g,'').replace(/^[＋+·•＊*≥>\\-]+/,'');
  const view = document.querySelector('.view.active');
  const b = [...view.querySelectorAll('button, a.btn')].find(x => norm(x.innerText) === ${JSON.stringify(text)});
  if (!b) return 0; b.click(); return 1;})()`;

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
  /* 改前基线：INPUT_REFINE=off 时把精修样式块摘掉，量到的就是原状 */
  if (process.env.INPUT_REFINE === "off") {
    const off = await evaluate(`(function(){const s=document.getElementById('input-refine'); if(!s) return 0; s.remove(); return 1;})()`);
    console.log(off ? "  [INPUT_REFINE=off] 已摘掉 #input-refine，按改前口径巡检" : "  [warn] 找不到 #input-refine");
  }

  const results = [];
  const shotViews = ["customers", "leads", "products", "todo", "shipments", "settings", "profile", "agent-skills", "memos", "lead-finder"];
  for (const [vid, label] of VIEWS) {
    await evaluate(`(function(){document.querySelector('#appModal.active') && document.querySelector('#appModal [data-modal-close]')?.click(); return 1;})()`);
    await sleep(250);
    const ok = await evaluate(`(function(){const b=document.querySelector('[data-view="${vid}"]'); if(!b) return 0; b.click(); return 1;})()`);
    if (!ok) { results.push({ vid, label, missing: true }); continue; }
    await sleep(1600);
    const cands = JSON.parse(await evaluate(OPEN));
    if (!cands.length) { results.push({ vid, label, noButton: true }); console.log(`  ${vid} — 无可点开表单的按钮`); continue; }
    for (const text of cands) {
      await evaluate(`(function(){const r=document.querySelector('#appModal.active'); if(r) r.querySelector('[data-modal-close]')?.click(); return 1;})()`);
      await sleep(200);
      const clicked = await evaluate(CLICK(text));
      if (!clicked) continue;
      await sleep(1300);
      let data;
      try { data = JSON.parse(await evaluate(EXTRACT)); } catch (e) { data = { err: String(e).slice(0,120) }; }
      if (data.err || !data.count) { await evaluate(`(function(){document.querySelector('#appModal [data-modal-close]')?.click(); return 1;})()`); await sleep(200); continue; }
      results.push({ vid, label, trigger: text, ...data });
      console.log(`  ${vid} / ${text} → ${data.title}：${data.count} 个控件`);
      if (argShot && shotViews.includes(vid)) await shot(`${vid}__${text}`);
      await evaluate(`(function(){document.querySelector('#appModal [data-modal-close]')?.click(); return 1;})()`);
      await sleep(300);
      break;   // 每视图只取第一个能打开表单的按钮
    }
  }
  fs.writeFileSync(path.join(OUT, "modals.json"), JSON.stringify(results, null, 1));
  console.log("\nJSON:", path.join(OUT, "modals.json"));
  child.kill("SIGKILL");
  process.exit(0);
})();
