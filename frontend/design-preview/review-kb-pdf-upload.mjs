#!/usr/bin/env node
/* 资料训练：扫描件 PDF 上传走查（真实 4188 + 真实 OCR），用 playwright 驱动 */
import { chromium } from "playwright";
import fs from "node:fs";

const CFT = "/Users/sendohakria/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const BASE = "http://127.0.0.1:4188/";
const OUT = "/tmp/gj-kb-pdf-shots";
const PDF = process.argv[2] || "/Users/sendohakria/Desktop/demo-company.pdf";

fs.mkdirSync(OUT, { recursive: true });

const results = [];
function record(label, ok, detail) {
  results.push({ label, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? "  — " + detail : ""}`);
}

const browser = await chromium.launch({
  executablePath: CFT,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"]
});
const page = await browser.newPage({ viewport: { width: 1680, height: 1500 } });
page.on("console", (m) => { if (m.type() === "error") console.log("  [console]", m.text().slice(0, 160)); });

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
await page.fill("#loginEmail", "admin@goodjob.com");
await page.fill("#loginPassword", "goodjob123");
await page.click("#loginButton");
await page.waitForFunction(() => document.body.classList.contains("is-authenticated"), null, { timeout: 20000 });
record("登录成功", true);

// 知识库训练挂在侧栏的「更多」里，按钮默认不可见：直接触发点击并等视图激活
await page.evaluate(() => {
  const button = document.querySelector('[data-view="kb-training"]');
  if (button) button.click();
});
await page.waitForFunction(() => document.getElementById("kb-training")?.classList.contains("active"), null, { timeout: 15000 });
await page.waitForTimeout(1200);
const acceptsPdf = await page.getAttribute("#kbSourceFile", "accept");
record("文件选择器接受 PDF", String(acceptsPdf || "").includes(".pdf"), String(acceptsPdf || ""));

const started = Date.now();
await page.setInputFiles("#kbSourceFile", PDF);

let staged = { visible: false, text: "", hint: "" };
for (let i = 0; i < 90; i += 1) {
  await page.waitForTimeout(1000);
  staged = await page.evaluate(() => {
    const list = document.getElementById("kbStagedList");
    const hint = document.getElementById("kbSourceHint");
    return {
      visible: Boolean(list) && !list.hidden && list.innerText.trim().length > 0,
      text: list ? list.innerText : "",
      hint: hint ? hint.innerText : ""
    };
  });
  if (staged.visible) break;
}
const elapsed = ((Date.now() - started) / 1000).toFixed(1);
record(
  "扫描件 PDF 读完并进入暂存区",
  staged.visible && /DEMOCO|字符/u.test(staged.text),
  `${elapsed}s ｜ ${staged.text.replace(/\s+/gu, " ").slice(0, 100)}`
);
record("界面说明用了 OCR（失败/降级不静默）", /OCR/u.test(staged.hint), staged.hint.replace(/\s+/gu, " ").slice(0, 140));

await page.evaluate(() => window.scrollTo(0, 0));
const file = `${OUT}/kb-pdf-staged.png`;
await page.screenshot({ path: file });
console.log("截图:", file);

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length ? 1 : 0);
