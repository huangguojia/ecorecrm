#!/usr/bin/env node
/* 生成联系图标候选对照板（静态 HTML，供 capture-page.mjs 截图）。
   用法：node make-icons-board.mjs  → shots-icons/_board-candidates.html */
import fs from "node:fs";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(HERE, "shots-icons");
fs.mkdirSync(OUT, { recursive: true });
const si = (n) => fs.readFileSync(`/tmp/si-${n}.svg`, "utf8").match(/d="([^"]+)"/)[1];
const lu = (n) => fs.readFileSync(`/tmp/lu-${n}.svg`, "utf8").match(/<path d="([^"]+)"/)[1];
const luRect = (n) => fs.readFileSync(`/tmp/lu-${n}.svg`, "utf8").match(/<rect[^>]+>/)[0];

/* ---- 现状（改造前，逐字来自 prototype-api.ts:14619） ---- */
const OLD = {
  email: `<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>`,
  phone: `<svg viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.78.62 2.63a2 2 0 0 1-.45 2.11L8 9.73a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.85.3 1.73.5 2.63.62A2 2 0 0 1 22 16.92z"/></svg>`,
  whatsapp: `<svg viewBox="0 0 24 24"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.5 9 9 0 0 1-4.2-1.1L3 20l1.3-4.4A8.5 8.5 0 1 1 21 11.5z"/><path d="M8.7 8.4c.5 3 2.2 4.7 5.2 5.2"/></svg>`,
  wechat: `<svg viewBox="0 0 24 24"><path d="M8.5 5C5.5 5 3 7 3 9.5c0 1.5.9 2.9 2.3 3.7L5 15l2.1-1c.5.1.9.1 1.4.1 3 0 5.5-2 5.5-4.5S11.5 5 8.5 5z"/><path d="M15.5 10c3 0 5.5 2 5.5 4.5 0 1.5-.9 2.9-2.3 3.7L19 20l-2.1-1c-.5.1-.9.1-1.4.1-3 0-5.5-2-5.5-4.5"/></svg>`
};

/* ---- R2 全描边：通用用 Lucide 几何，品牌用官方轮廓描边（放大 stroke 补 24 满铺缩放） ---- */
const R2 = {
  email: `<svg viewBox="0 0 24 24">${luRect("mail")}<path d="${lu("mail")}"/></svg>`,
  phone: `<svg viewBox="0 0 24 24"><path d="${lu("phone")}"/></svg>`,
  whatsapp: `<svg viewBox="0 0 24 24" class="sw-brand"><path d="${si("whatsapp")}"/></svg>`,
  wechat: `<svg viewBox="0 0 24 24" class="sw-brand"><path d="${si("wechat")}"/></svg>`
};

/* ---- R3 混排：通用描边，品牌官方实心 glyph（按视觉高度配重） ---- */
const mix = (waS, wcS) => ({
  email: `<svg viewBox="0 0 24 24">${luRect("mail")}<path d="${lu("mail")}"/></svg>`,
  phone: `<svg viewBox="0 0 24 24"><path d="${lu("phone")}"/></svg>`,
  whatsapp: `<svg viewBox="0 0 24 24" class="filled" style="--k:${waS}"><path d="${si("whatsapp")}"/></svg>`,
  wechat: `<svg viewBox="0 0 24 24" class="filled" style="--k:${wcS}"><path d="${si("wechat")}"/></svg>`
});
const R3a = mix(0.88, 1.0);
const R3b = mix(0.9, 1.12);
const R3c = mix(0.94, 1.18);

const NAMES = { email: "邮箱", phone: "电话", whatsapp: "WhatsApp", wechat: "微信" };
const KEYS = ["email", "phone", "whatsapp", "wechat"];
const SIZES = [16, 24, 36];

const block = (title, sub, set, sw) => `
  <section>
    <h3>${title}<em>${sub}</em></h3>
    <div class="grid">
      ${SIZES.map((s) => `
        <div class="row">
          <span class="sz">${s}px</span>
          ${KEYS.map((k) => `<span class="cell"><i class="ico" style="--s:${s}px;--sw:${sw}">${set[k].replace("<svg", `<svg style="width:${s}px;height:${s}px"`)}</i><b>${NAMES[k]}</b></span>`).join("")}
        </div>`).join("")}
    </div>
  </section>`;

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
  *{box-sizing:border-box}
  body{margin:0;padding:28px 32px 34px;background:#fff;color:#131c2e;
    font:13px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",sans-serif}
  h1{margin:0 0 2px;font-size:16px;letter-spacing:-.01em}
  .lead{color:#6b7d94;font-size:11.5px;margin-bottom:22px}
  section{padding:16px 0 18px;border-top:1px solid #eef2f7}
  section:first-of-type{border-top:0}
  h3{margin:0 0 12px;font-size:12.5px;font-weight:600;letter-spacing:.01em;display:flex;align-items:baseline;gap:9px}
  h3 em{font-style:normal;font-weight:400;font-size:11px;color:#94a3b6}
  .row{display:flex;align-items:center;gap:26px;padding:7px 0}
  .row+.row{border-top:1px dashed #f1f5f9}
  .sz{flex:0 0 40px;color:#94a3b6;font-size:11px;font-weight:600;letter-spacing:.02em}
  .cell{flex:0 0 74px;display:flex;align-items:center;gap:9px;color:#37445b}
  .cell b{font-size:11px;font-weight:500;color:#8290a3;white-space:nowrap}
  .ico{display:flex;align-items:center;justify-content:center;width:var(--s);height:var(--s);flex:0 0 var(--s)}
  .ico svg{fill:none;stroke:currentColor;stroke-width:var(--sw,2);stroke-linecap:round;stroke-linejoin:round;overflow:visible}
  .ico svg.sw-brand{stroke-width:2.9}
  .ico svg.filled{fill:currentColor;stroke:none;width:calc(var(--s) * var(--k))!important;height:calc(var(--s) * var(--k))!important;overflow:visible}
  .note{margin-top:16px;padding:11px 13px;border:1px solid #e7ecf4;border-radius:8px;background:#f8fafc;color:#6b7d94;font-size:11px;line-height:1.7}
</style></head><body>
  <h1>联系图标 · 候选对照板</h1>
  <div class="lead">同一套 24 网格，在 16 / 24 / 36 px 下的真实渲染。全部单色（不引品牌色）。</div>
  ${block("R1 · 现状（改造前）", "信封 rx 偏小、描边 2px；WhatsApp / 微信为自绘近似形，第二个气泡路径未闭合有缺口", OLD, 2)}
  ${block("R2 · 全描边（官方几何）", "通用图标用 Lucide 几何；WhatsApp / 微信改用官方 glyph 的轮廓描边（16px 下细节发糊）", R2, 1.9)}
  ${block("R3a · 混排 · 品牌等比", "邮箱 / 电话描边；WhatsApp / 微信用官方实心 glyph，两者同比例 0.88 / 1.00", R3a, 1.9)}
  ${block("R3b · 混排 · 高度配重", "WhatsApp 0.90 / 微信 1.12 —— 微信 glyph 天然横长，按视觉高度补足", R3b, 1.9)}
  ${block("R3c · 混排 · 再加一档", "WhatsApp 0.94 / 微信 1.18 —— 品牌块更饱满，需确认是否压过描边图标", R3c, 1.9)}
  <div class="note">判断要点：① 16px 下四个图标的"视觉重量"是否接近（实心块天然偏重，故缩尺）；② 品牌图标是否一眼认得出（R1 的 WhatsApp / 微信认不出，R2 在 16px 糊，实心版最清楚）；③ 微信 glyph 宽高比 1.46:1，需要单独放大才能与方形 WhatsApp 配平。</div>
</body></html>`;

const p = path.join(OUT, "_board-candidates.html");
fs.writeFileSync(p, html);
console.log(p);
