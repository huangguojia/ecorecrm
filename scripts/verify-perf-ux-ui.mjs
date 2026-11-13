/**
 * 写合并优化（createCoalescingPersistence）的界面体验验收（2026-11-13）
 *
 * 目的：确认「落库合并」没有把延迟或数据不一致带到用户可见的操作路径上。
 * 逐项测量真实交互耗时，而不是只看接口：
 *   1. 登录 / 列表首屏 / 打开编辑弹窗的感知耗时
 *   2. 改字段 → 保存 → 弹窗关闭 → 列表出现新值 的端到端耗时
 *   3. 连续快速保存两次，最后一次内容必须生效并显示
 *   4. 新建客户后列表立即出现
 *   5. 多标签页并发改不同客户，互不覆盖
 *   6. 视图切换流畅度 + 控制台零报错
 *
 * 用法：NO_PROXY=127.0.0.1,localhost node scripts/verify-perf-ux-ui.mjs
 */
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:5189";
const PW = "goodjob123";
const TS = Date.now().toString().slice(-6);

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  \x1b[32mPASS\x1b[0m  ${m}`); };
const no = (m, e = "") => { fail++; console.log(`  \x1b[31mFAIL\x1b[0m  ${m}  << ${e}`); };
const check = (c, m, e = "") => (c ? ok(m) : no(m, e));
const ms = (t0) => Math.round(performance.now() - t0);

async function login(page, email = "admin@goodjob.com", name = "Admin") {
  const t = performance.now();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.locator("#loginEmail").fill(email);
  await page.locator("#loginPassword").fill(PW);
  await page.locator("#loginButton").click();
  await page.locator("body.is-authenticated").waitFor({ timeout: 25000 });
  await page.locator("#scopeUser", { hasText: name }).waitFor({ timeout: 25000 });
  return ms(t);
}

async function openNav(page, sel) {
  const btn = page.locator(sel).first();
  if (!(await btn.isVisible().catch(() => false))) {
    const sec = btn.locator("xpath=ancestor::details[1]");
    if (await sec.count()) await sec.locator("summary").first().click();
  }
  await btn.click();
}

async function openView(page, view) {
  const t = performance.now();
  await openNav(page, `.nav button[data-view="${view}"]`);
  await page.locator(`#${view}.active`).waitFor({ timeout: 20000 });
  return ms(t);
}

/** 保存后客户详情抽屉会自动打开并遮挡列表行，操作前必须先关掉 */
async function closeDrawer(pg) {
  const d = pg.locator("#customerDrawer.open");
  if (await d.count()) {
    await pg.locator("#customerDrawerClose").click({ timeout: 5000 }).catch(() => {});
    await d.waitFor({ state: "hidden", timeout: 8000 }).catch(() => {});
  }
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));

let createdId = null;

try {
  console.log("═══ 1. 感知耗时基线 ═══");
  const loginMs = await login(page);
  console.log(`  登录到可用: ${loginMs}ms`);
  check(loginMs < 6000, `登录 ${loginMs}ms < 6s`, `${loginMs}ms`);

  const tList = performance.now();
  await openView(page, "customers");
  await page.locator("#customers tbody tr[data-customer-id]").first().waitFor({ timeout: 20000 });
  const listMs = ms(tList);
  console.log(`  客户视图到首行渲染: ${listMs}ms`);
  check(listMs < 3000, `客户列表 ${listMs}ms < 3s`, `${listMs}ms`);

  const row = page.locator("#customers tbody tr[data-customer-id]").first();
  const custId = await row.getAttribute("data-customer-id");
  const custName = (await row.locator("button.customer-name").innerText()).trim();
  console.log(`  目标客户: ${custName} (${custId})`);

  const tModal = performance.now();
  await row.getByRole("button", { name: "编辑" }).click();
  await page.locator(".modal.customer-editor-modal").waitFor({ state: "visible", timeout: 15000 });
  const modalMs = ms(tModal);
  console.log(`  打开编辑弹窗: ${modalMs}ms`);
  check(modalMs < 1500, `编辑弹窗 ${modalMs}ms < 1.5s`, `${modalMs}ms`);

  console.log();
  console.log("═══ 2. 保存到列表更新的端到端耗时 ═══");
  // 用「联系人」做断言字段——它是列表行上可见的（`国家 · 联系人 · 归属`），
  // 备注只在详情抽屉里显示，用它断言会误判成「保存失败」。
  const origContact = await page.locator("#customerContactInput").inputValue();
  const MARK1 = `UX联${TS}`;
  await page.locator("#customerContactInput").fill(MARK1);
  const tSave = performance.now();
  await page.locator("#saveCustomerButton").click();
  await page.locator(".modal.customer-editor-modal").waitFor({ state: "hidden", timeout: 20000 });
  const closeMs = ms(tSave);
  let listUpdated = false;
  try {
    await page.locator(`#customers tbody tr[data-customer-id="${custId}"]`)
      .getByText(MARK1, { exact: false }).waitFor({ timeout: 15000 });
    listUpdated = true;
  } catch { listUpdated = false; }
  const e2eMs = ms(tSave);
  console.log(`  点保存→弹窗关闭: ${closeMs}ms ; →列表显示新值: ${e2eMs}ms`);
  check(closeMs < 3000, `保存响应 ${closeMs}ms < 3s（弹窗即时关闭）`, `${closeMs}ms`);
  check(listUpdated, "保存后列表立刻显示新值（无需手动刷新）", "未在列表行中找到新联系人");
  check(e2eMs < 4000, `保存到可见 ${e2eMs}ms < 4s`, `${e2eMs}ms`);

  // 刷新页面确认真的落库了（不是只改了内存）
  await closeDrawer(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("body.is-authenticated").waitFor({ timeout: 25000 });
  await openView(page, "customers");
  await page.locator(`#customers tbody tr[data-customer-id="${custId}"]`).waitFor({ timeout: 20000 });
  const afterReload = await page.locator(`#customers tbody tr[data-customer-id="${custId}"]`).innerText();
  check(afterReload.includes(MARK1), "刷新页面后新值仍在（真落库，非仅内存）", afterReload.replace(/\n/g, " ").slice(0, 70));

  console.log();
  console.log("═══ 3. 连续快速保存两次（最后一次必须赢）═══");
  const quickSave = async (value) => {
    await closeDrawer(page);
    await page.locator(`#customers tbody tr[data-customer-id="${custId}"]`)
      .getByRole("button", { name: "编辑" }).click({ timeout: 15000 });
    await page.locator(".modal.customer-editor-modal").waitFor({ state: "visible", timeout: 15000 });
    await page.locator("#customerContactInput").fill(value);
    await page.locator("#saveCustomerButton").click();
    await page.locator(".modal.customer-editor-modal").waitFor({ state: "hidden", timeout: 20000 });
  };
  await quickSave(`UX快A${TS}`);
  await quickSave(`UX快B${TS}`);
  await page.waitForTimeout(600);
  await closeDrawer(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("body.is-authenticated").waitFor({ timeout: 25000 });
  await openView(page, "customers");
  await page.locator(`#customers tbody tr[data-customer-id="${custId}"]`).waitFor({ timeout: 20000 });
  const finalTxt = await page.locator(`#customers tbody tr[data-customer-id="${custId}"]`).innerText();
  check(finalTxt.includes(`UX快B${TS}`), "第二次保存的值生效", finalTxt.replace(/\n/g, " ").slice(0, 70));
  // 还原联系人
  await quickSave(origContact);
  await closeDrawer(page);

  console.log();
  console.log("═══ 4. 新建客户后列表立即出现 ═══");
  const NEWNAME = `UX性能客户${TS}`;
  const tNew = performance.now();
  const addBtn = page.locator("#customerCreateButton").first();
  if (await addBtn.count()) {
    await addBtn.click();
    await page.locator("#quickCustomerCompany").waitFor({ state: "visible", timeout: 15000 });
    await page.locator("#quickCustomerCompany").fill(NEWNAME);
    await page.locator("#saveQuickCustomerButton").click();
    let appeared = false;
    try {
      await page.locator(`#customers tbody button.customer-name:has-text("${NEWNAME}")`).waitFor({ timeout: 20000 });
      appeared = true;
    } catch { appeared = false; }
    const newMs = ms(tNew);
    console.log(`  新建到列表出现: ${newMs}ms`);
    check(appeared, "新建客户后列表立即出现", "未找到");
    check(newMs < 8000, `新建到可见 ${newMs}ms < 8s`, `${newMs}ms`);
    const el = page.locator(`#customers tbody button.customer-name:has-text("${NEWNAME}")`).first();
    createdId = await el.evaluate((n) => n.closest("tr")?.dataset.customerId || null);
  } else {
    no("找不到新增客户入口", "选择器未命中");
  }

  console.log();
  console.log("═══ 5. 多标签页并发改不同客户（互不覆盖）═══");
  const pageB = await ctx.newPage();
  await pageB.goto(BASE, { waitUntil: "domcontentloaded" });
  await pageB.locator("body.is-authenticated").waitFor({ timeout: 25000 }).catch(() => {});
  await openView(pageB, "customers");
  await pageB.locator("#customers tbody tr[data-customer-id]").first().waitFor({ timeout: 20000 });
  const rowIds = await pageB.$$eval("#customers tbody tr[data-customer-id]", (rs) => rs.slice(0, 2).map((r) => r.dataset.customerId));
  if (rowIds.length >= 2) {
    // A 页改第一个，B 页改第二个，同时保存
    const [idA, idB] = rowIds;
    const rowContact = (t) => (t.split("·")[1] || "").trim();
    const origA = rowContact(await pageB.locator(`#customers tbody tr[data-customer-id="${idA}"]`).innerText().catch(() => ""));
    const origB = rowContact(await pageB.locator(`#customers tbody tr[data-customer-id="${idB}"]`).innerText().catch(() => ""));
    const editAndSave = async (pg, id, value) => {
      await closeDrawer(pg);
      const r = pg.locator(`#customers tbody tr[data-customer-id="${id}"]`).first();
      await r.getByRole("button", { name: "编辑" }).click({ timeout: 15000 });
      await pg.locator(".modal.customer-editor-modal").waitFor({ state: "visible", timeout: 15000 });
      await pg.locator("#customerContactInput").fill(value);
      await pg.locator("#saveCustomerButton").click();
      await pg.locator(".modal.customer-editor-modal").waitFor({ state: "hidden", timeout: 20000 });
      await closeDrawer(pg);
    };
    await Promise.all([
      editAndSave(page, idA, `UX-A页${TS}`),
      editAndSave(pageB, idB, `UX-B页${TS}`)
    ]);
    await page.waitForTimeout(800);
    await pageB.reload({ waitUntil: "domcontentloaded" });
    await pageB.locator("body.is-authenticated").waitFor({ timeout: 25000 });
    await openView(pageB, "customers");
    await pageB.waitForTimeout(1200);
    const txtA = await pageB.locator(`#customers tbody tr[data-customer-id="${idA}"]`).innerText().catch(() => "");
    const txtB = await pageB.locator(`#customers tbody tr[data-customer-id="${idB}"]`).innerText().catch(() => "");
    check(txtA.includes(`UX-A页${TS}`), "标签页 A 的改动保存成功", txtA.replace(/\n/g, " ").slice(0, 60));
    check(txtB.includes(`UX-B页${TS}`), "标签页 B 的改动保存成功（未被 A 覆盖）", txtB.replace(/\n/g, " ").slice(0, 60));
    // 还原
    await editAndSave(pageB, idA, origA);
    await editAndSave(pageB, idB, origB);
  } else {
    no("客户数不足 2 条，无法测多标签并发", String(rowIds.length));
  }
  await pageB.close();

  console.log();
  console.log("═══ 6. 视图切换流畅度 ═══");
  for (const v of ["documents", "dashboard", "suppliers", "customers"]) {
    const t = performance.now();
    await openView(page, v);
    await page.waitForTimeout(500);
    const d = ms(t);
    console.log(`  切到 ${v}: ${d}ms`);
    check(d < 3000, `${v} 切换 ${d}ms < 3s`, `${d}ms`);
  }

  console.log();
  console.log("═══ 7. 控制台异常 ═══");
  const realErrors = errors.filter((e) => !/favicon|404 \(Not Found\)|Failed to load resource/i.test(e));
  check(realErrors.length === 0, `控制台无 JS 错误（共捕获 ${errors.length} 条，过滤资源类后 ${realErrors.length} 条）`,
    realErrors.slice(0, 3).join(" | "));
} catch (e) {
  no("脚本执行中断", e.message);
} finally {
  // 清理：删除本次新建的客户 + 还原备注
  try {
    if (createdId) {
      await page.evaluate(async (id) => {
        const csrf = document.cookie.split("; ").find((x) => x.startsWith("gj_csrf="))?.split("=").slice(1).join("=");
        await fetch("/api/customers/bulk-delete", {
          method: "POST",
          headers: { "content-type": "application/json", ...(csrf ? { "x-csrf-token": decodeURIComponent(csrf) } : {}) },
          body: JSON.stringify({ ids: [id] })
        });
      }, createdId);
      console.log(`  （已清理测试客户 ${createdId}）`);
    }
  } catch { /* 清理失败不影响结论 */ }
  await browser.close();
}

console.log();
console.log("══════════════════════════════════");
console.log(`  界面体验验收：PASS=${pass}  FAIL=${fail}`);
console.log("══════════════════════════════════");
process.exit(fail === 0 ? 0 : 1);
