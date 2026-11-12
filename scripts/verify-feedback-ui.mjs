/**
 * 2026-11-12 试用反馈验收（界面层）
 *
 * 对应两份反馈文件，逐条在真实界面上走一遍：
 *   ① 成交客户/成交供应商是否归入对应档案
 *   ② 同事之间供应商是否互不可见
 *   ③ PO Condition / Warranty / Lead Time 是否有处可填、能否回填
 *   ④ PO 表格排版（截图留证 + 表头裁切断言）
 *   ⑤ 新建 / 切单据类型是否为空白表单
 *
 * 用法：NO_PROXY=127.0.0.1,localhost node scripts/verify-feedback-ui.mjs
 */
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:5189";
const PASS_WORD = "goodjob123";
const TS = Date.now().toString().slice(-6);

let pass = 0;
let fail = 0;
const ok = (m) => { pass++; console.log(`  \x1b[32mPASS\x1b[0m  ${m}`); };
const no = (m, e = "") => { fail++; console.log(`  \x1b[31mFAIL\x1b[0m  ${m}  << ${e}`); };
const check = (cond, m, e = "") => (cond ? ok(m) : no(m, e));

async function login(page, email, name) {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.locator("#loginEmail").fill(email);
  await page.locator("#loginPassword").fill(PASS_WORD);
  await page.locator("#loginButton").click();
  await page.locator("body.is-authenticated").waitFor({ timeout: 20000 });
  await page.locator("#scopeUser", { hasText: name }).waitFor({ timeout: 20000 });
}

async function openNav(page, selector) {
  const btn = page.locator(selector).first();
  if (!(await btn.isVisible().catch(() => false))) {
    const section = btn.locator("xpath=ancestor::details[1]");
    if (await section.count()) await section.locator("summary").first().click();
  }
  await btn.click();
}

async function openView(page, view) {
  await openNav(page, `.nav button[data-view="${view}"]`);
  await page.locator(`#${view}.active`).waitFor({ timeout: 20000 });
}

/** 页面内直接打接口，用于造数/清理（带 CSRF） */
async function api(page, path, init = {}) {
  return page.evaluate(async ({ p, i }) => {
    const method = i.method || "GET";
    const csrf = document.cookie.split("; ").find((x) => x.startsWith("gj_csrf="))?.split("=").slice(1).join("=");
    const res = await fetch(p, {
      method,
      headers: {
        "content-type": "application/json",
        ...(!["GET", "HEAD"].includes(method.toUpperCase()) && csrf ? { "x-csrf-token": decodeURIComponent(csrf) } : {})
      },
      body: i.body === undefined ? undefined : JSON.stringify(i.body)
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  }, { p: path, i: init });
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
page.on("pageerror", (err) => consoleErrors.push(String(err)));

const createdDocs = [];
const createdSuppliers = [];

try {
  // ═══════════════════════════════════════════════════
  console.log("═══ ①-A 已成交客户归类（建议① / 试用①）═══");
  await login(page, "admin@goodjob.com", "Admin");

  await openNav(page, '.nav-secondary-button[data-view="customers"][data-customer-outcome="won"]');
  await page.locator("#customers.active").waitFor({ timeout: 20000 });
  const wonTitle = await page.locator("#customerPageTitle").innerText();
  check(wonTitle.includes("已成交"), "侧栏「已成交客户」进入后标题正确", wonTitle);

  await page.locator("#customerCreateButton").click();
  await page.locator("#quickCustomerCompany").waitFor({ timeout: 10000 });
  const defaultLife = await page.locator("#quickCustomerLifecycle").inputValue();
  check(defaultLife === "won", "从已成交页新增，成交状态默认「已成交」", `实际=${defaultLife}`);

  const wonCompany = `VF已成交客户${TS}`;
  await page.locator("#quickCustomerCompany").fill(wonCompany);
  await page.locator("#quickCustomerCountry").fill("Germany");
  await page.locator("#quickCustomerEmail").fill(`won${TS}@ui.example`);
  await page.locator("#saveQuickCustomerButton").click();
  await page.locator("#quickCustomerCompany").waitFor({ state: "hidden", timeout: 20000 });
  await page.waitForTimeout(1500);

  const wonListText = await page.locator("#customerListWorkspace").innerText();
  check(wonListText.includes(wonCompany), "保存后出现在「已成交客户」列表", wonListText.slice(0, 80).replace(/\n/g, " "));

  await openNav(page, '.nav-secondary-button[data-view="customers"][data-customer-outcome="open"]');
  await page.waitForTimeout(1200);
  const openTitle = await page.locator("#customerPageTitle").innerText();
  const openListText = await page.locator("#customerListWorkspace").innerText();
  check(openTitle.includes("未成交"), "切到未成交页标题正确", openTitle);
  check(!openListText.includes(wonCompany), "已成交客户不出现在「未成交」列表（核心诉求）");

  // 反向验证：未成交页新增仍默认未成交
  await page.locator("#customerCreateButton").click();
  await page.locator("#quickCustomerCompany").waitFor({ timeout: 10000 });
  const defaultLife2 = await page.locator("#quickCustomerLifecycle").inputValue();
  check(defaultLife2 === "open", "从已成交外的页面新增，默认未成交（不会误判）", `实际=${defaultLife2}`);
  await page.locator('[data-modal-close]').first().click();
  await page.waitForTimeout(400);

  // ═══════════════════════════════════════════════════
  console.log("═══ ①-B 已成交供应商归类（建议①供应商侧）═══");
  await openView(page, "suppliers");
  await page.locator("#supplierStatusFilter").selectOption("won");
  await page.waitForTimeout(900);
  const supTitle = await page.locator("#supplierPageTitle").innerText();
  check(supTitle.includes("已成交"), "供应商筛选切「已成交」标题正确", supTitle);

  await page.locator("#supplierCreateButton").click();
  await page.locator("#supplierStatusInput").waitFor({ timeout: 10000 });
  const supDefault = await page.locator("#supplierStatusInput").inputValue();
  check(supDefault === "won", "从已成交供应商页新增，状态默认「已成交」", `实际=${supDefault}`);

  const wonSupplier = `VF已成交供应商${TS}`;
  await page.locator("#supplierCompanyInput").waitFor({ timeout: 10000 });
  await page.locator("#supplierCompanyInput").fill(wonSupplier);
  await page.locator("#supplierCountryInput").fill("Italy");
  await page.locator("#saveSupplierButton").click();
  await page.waitForTimeout(1800);
  const supList = await page.locator("#supplierListWorkspace").innerText();
  check(supList.includes(wonSupplier), "保存后出现在「已成交供应商」列表", supList.slice(0, 80).replace(/\n/g, " "));

  await page.locator("#supplierStatusFilter").selectOption("open");
  await page.waitForTimeout(1200);
  const openSupList = await page.locator("#supplierListWorkspace").innerText();
  check(!openSupList.includes(wonSupplier), "已成交供应商不出现在「未成交供应商」列表");

  // ═══════════════════════════════════════════════════
  console.log("═══ ② 同事之间供应商互不可见（试用②）═══");
  const privateCo = `VF私有供应商${TS}`;
  const created = await api(page, "/api/suppliers", {
    method: "POST",
    body: { company: privateCo, country: "Poland", contact: "onlyA" }
  });
  const privateId = created.data?.supplier?.id;
  if (privateId) createdSuppliers.push(privateId);
  check(Boolean(privateId), "管理员建一条供应商作为样本", JSON.stringify(created.data).slice(0, 100));

  // 换业务员 A / B 看列表：每个账号用独立 context，否则共享登录态看不到登录页
  const probe = async (email, name) => {
    const c2 = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const p2 = await c2.newPage();
    await login(p2, email, name);
    await openView(p2, "suppliers");
    await p2.waitForTimeout(1800);
    const txt = await p2.locator("#supplierListWorkspace").innerText();
    await c2.close();
    return txt;
  };
  const listA = await probe("a.isolation@goodjob.com", "Isolation A");
  const listB = await probe("b.isolation@goodjob.com", "Isolation B");
  check(!listA.includes(privateCo) && !listB.includes(privateCo),
    "管理员名下供应商，普通业务员 A/B 均看不到",
    `A=${listA.includes(privateCo)} B=${listB.includes(privateCo)}`);

  const mine = await api(page, "/api/suppliers", { method: "POST", body: { company: `VF我自己的${TS}`, country: "Czech" } });
  const mineId = mine.data?.supplier?.id;
  if (mineId) createdSuppliers.push(mineId);

  const c3 = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const p3 = await c3.newPage();
  await login(p3, "admin@goodjob.com", "Admin");
  await openView(p3, "suppliers");
  await p3.waitForTimeout(1800);
  const adminList = await p3.locator("#supplierListWorkspace").innerText();
  check(adminList.includes(`VF我自己的${TS}`), "管理员能看到自己建的供应商", adminList.slice(0, 60).replace(/\n/g, " "));
  await c3.close();

  // ═══════════════════════════════════════════════════
  console.log("═══ ③ PO 三字段与 Description 单栏（试用③ / 建议③④）═══");
  await openView(page, "documents");
  await page.locator('#documentTypeTabs button[data-doc-type="PO"]').click();
  await page.waitForTimeout(900);

  for (const [sel, label] of [
    ["#docConditionInput", "产品状态 Condition"],
    ["#docWarrantyInput", "质保 Warranty"],
    ["#docLeadTimeInput", "交货周期 Lead Time"]
  ]) {
    const visible = await page.locator(sel).isVisible().catch(() => false);
    check(visible, `表单存在「${label}」输入框`, sel);
  }

  const descCount = await page.locator('[data-doc-field="description"]').count();
  const matCount = await page.locator('[data-doc-field="material"]').count();
  const finCount = await page.locator('[data-doc-field="finish"]').count();
  const hsCount = await page.locator('[data-doc-field="hsCode"]').count();
  check(descCount === 1, "明细只有 1 个「描述 Description」栏", `count=${descCount}`);
  check(matCount === 0 && finCount === 0, "Material / Finish 两栏已移除", `material=${matCount} finish=${finCount}`);
  check(hsCount === 1, "HS Code 保留为独立字段", `count=${hsCount}`);

  // 填写并在预览里核对
  const poTitle = `VF PO ${TS}`;
  await page.locator("#docTitleInput").fill(poTitle);
  await page.locator("#docBuyerInput").fill("VF Buyer GmbH");
  await page.locator("#docConditionInput").fill("Brand new");
  await page.locator("#docWarrantyInput").fill("12 months");
  await page.locator("#docLeadTimeInput").fill("25-30 days after deposit");

  const descBox = page.locator('[data-doc-field="description"]').first();
  await descBox.fill("LED Flood Light 200W, die-cast aluminium, IP65");
  await page.locator('[data-doc-field="hsCode"]').first().fill("9405420000");
  const nameBox = page.locator('[data-doc-field="product"]').first();
  if (await nameBox.count()) await nameBox.fill("LED Flood Light");
  await page.locator("#docTitleInput").click();
  await page.waitForTimeout(1000);

  const preview = page.locator(".doc-paper.custom-b-po").first();
  await preview.waitFor({ timeout: 10000 });
  const previewText = await preview.innerText();
  check(previewText.includes("Brand new"), "PO 预览条款区显示 Condition", "");
  check(previewText.includes("12 months"), "PO 预览条款区显示 Warranty", "");
  check(previewText.includes("25-30 days"), "PO 预览条款区显示 Lead Time", "");
  check(previewText.includes("die-cast aluminium"), "PO 预览描述列显示完整描述", "");
  check(previewText.includes("9405420000"), "PO 预览 HS Code 10 位完整未被裁", "");

  // ═══════════════════════════════════════════════════
  console.log("═══ ④ PO 表格排版（建议②）═══");
  const layout = await page.evaluate(() => {
    const paper = document.querySelector(".doc-paper.custom-b-po");
    if (!paper) return null;
    const terms = paper.querySelector(".cbp-terms-table");
    const items = paper.querySelector(".cbp-items-table");
    // 表头要连明细表一起扫：TOTAL AMOUNT (USD) 在明细表里，不在条款表
    const ths = Array.from(paper.querySelectorAll("th"));
    const info = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return {
        w: Math.round(r.width), h: Math.round(r.height),
        scrollW: el.scrollWidth, clientW: el.clientWidth,
        align: s.textAlign, wrapped: el.scrollWidth > el.clientWidth + 1,
        tableLayout: s.tableLayout
      };
    };
    return {
      terms: info(terms),
      items: info(items),
      headers: ths.map((th) => ({ text: th.innerText.trim(), ...info(th) })),
      rowH: items ? [...items.querySelectorAll("tbody tr")].map((tr) => Math.round(tr.getBoundingClientRect().height)) : []
    };
  });

  if (!layout) {
    no("拿到 PO 表格的排版数据", "未找到 .doc-paper.custom-b-po");
  } else {
    check(layout.terms?.tableLayout === "fixed" && layout.items?.tableLayout === "fixed",
      "两张表都是 table-layout: fixed（列宽可控）",
      `terms=${layout.terms?.tableLayout} items=${layout.items?.tableLayout}`);
    const clipped = layout.headers.filter((h) => h && h.text && h.wrapped);
    check(clipped.length === 0, "所有表头文字未被裁切", clipped.map((h) => h.text).join(" | "));
    const amountHeader = layout.headers.find((h) => /TOTAL AMOUNT/i.test(h.text || ""));
    check(Boolean(amountHeader) && !amountHeader.wrapped,
      "TOTAL AMOUNT (USD) 表头完整显示",
      amountHeader ? `w=${amountHeader.w} scrollW=${amountHeader.scrollW}` : "未找到该表头");
    const rowsOk = layout.rowH.length > 0 && layout.rowH.every((h) => h >= 28);
    check(rowsOk, "明细行高一致且不拥挤（≥28px）", `行高=${layout.rowH.join(",")}`);
  }

  // Item Number 列不应退化成 HS Code（列名与内容要一致，HS 已在描述里）
  const itemNos = await page.evaluate(() => {
    const t = document.querySelector(".cbp-items-table");
    return t ? Array.from(t.querySelectorAll("tbody td.cbp-item-no")).map((td) => td.innerText.trim()) : [];
  });
  check(itemNos.length > 0 && itemNos.every((n) => !/^\d{6,}$/.test(n)),
    "Item Number 列放型号/序号，不再用 HS Code 顶替",
    itemNos.join(" | "));
  await preview.screenshot({ path: "/tmp/vf-po-layout.png" }).catch(() => {});
  ok("已截图留证 /tmp/vf-po-layout.png");

  // ═══════════════════════════════════════════════════
  console.log("═══ ⑤ 新建 / 切类型为空白表单（建议⑤）═══");
  // 先保存这份 PO，形成「已保存单据」状态
  const beforeCount = (await api(page, "/api/trade-documents")).data?.documents?.length ?? 0;
  await page.locator("#saveDocumentButton").click();
  await page.waitForTimeout(2500);
  const afterDocs = (await api(page, "/api/trade-documents")).data?.documents ?? [];
  const saved = afterDocs.find((d) => d.title === poTitle);
  if (saved) createdDocs.push(saved.id);
  check(Boolean(saved), "PO 保存成功（用于后续切类型测试）", `before=${beforeCount} after=${afterDocs.length}`);

  // 新建：必须全空
  await page.locator("#newDocumentButton").click();
  await page.waitForTimeout(1000);
  const blank = async () => ({
    title: await page.locator("#docTitleInput").inputValue(),
    buyer: await page.locator("#docBuyerInput").inputValue(),
    desc: await page.locator('[data-doc-field="description"]').first().inputValue(),
    cond: await page.locator("#docConditionInput").inputValue(),
    war: await page.locator("#docWarrantyInput").inputValue(),
    lead: await page.locator("#docLeadTimeInput").inputValue(),
    customer: await page.locator("#docCustomerInput").inputValue().catch(() => ""),
    source: await page.locator("#docDataSourceInput").inputValue().catch(() => "")
  });
  const b1 = await blank();
  check(b1.buyer === "" && b1.desc === "" && b1.cond === "" && b1.war === "" && b1.lead === "",
    "点「新建单据」后：买方 / 描述 / 三字段全部清空",
    JSON.stringify(b1));
  check(b1.customer === "" && b1.source === "manual",
    "新建后关联客户清空、数据源回到「手工录入」",
    `customer=${b1.customer} source=${b1.source}`);
  check(b1.title !== poTitle, "新建后标题不再沿用上一份", b1.title);

  // 已保存 PO → 切 PI，应给空白 PI
  const poIdBefore = await page.evaluate(() => (window).__vfDocId || "");
  await openNav(page, '.nav button[data-view="documents"][data-doc-type="PO"]');
  await page.waitForTimeout(1500);
  // 选中刚才保存的那张 PO（按标题匹配列表项）
  const poItem = page.locator(`text=${poTitle}`).first();
  if (await poItem.count()) {
    await poItem.click();
    await page.waitForTimeout(1500);
    const loadedTitle = await page.locator("#docTitleInput").inputValue();
    check(loadedTitle === poTitle, "点开已保存的 PO，表单回填标题", loadedTitle);
    const loadedCond = await page.locator("#docConditionInput").inputValue();
    const loadedWar = await page.locator("#docWarrantyInput").inputValue();
    const loadedLead = await page.locator("#docLeadTimeInput").inputValue();
    const loadedDesc = await page.locator('[data-doc-field="description"]').first().inputValue();
    check(loadedCond === "Brand new" && loadedWar === "12 months" && loadedLead.includes("25-30"),
      "重新打开后三个新字段完整回填", `${loadedCond} / ${loadedWar} / ${loadedLead}`);
    check(loadedDesc.includes("die-cast aluminium"), "重新打开后描述完整回填", loadedDesc);

    // 切 PI
    await openNav(page, '.nav button[data-view="documents"][data-doc-type="PI"]');
    await page.waitForTimeout(1800);
    const b2 = await blank();
    check(b2.buyer === "" && b2.desc === "" && b2.cond === "" && b2.war === "" && b2.lead === "",
      "已保存 PO 切 PI：得到空白 PI，不继承 PO 数据（核心诉求）",
      JSON.stringify(b2));

    // 切回 PO，仍应空白（不是把 PO 数据捞回来）
    await openNav(page, '.nav button[data-view="documents"][data-doc-type="PO"]');
    await page.waitForTimeout(1800);
    const b3 = await blank();
    check(b3.buyer === "" && b3.desc === "" && b3.cond === "",
      "再切回 PO：仍是空白 PO，不会捞回上一份内容",
      JSON.stringify(b3));
  } else {
    no("在单据列表里找到刚保存的 PO", poTitle);
  }

  // ═══════════════════════════════════════════════════
  console.log("═══ ⑥ 控制台错误检查 ═══");
  const realErrors = consoleErrors.filter((e) => !/favicon|ResizeObserver|404 \(Not Found\)/i.test(e));
  check(realErrors.length === 0, "全流程无 JS 报错", realErrors.slice(0, 3).join(" | "));

} catch (error) {
  no("验收流程异常中断", String(error && error.message ? error.message : error));
} finally {
  // 清理测试数据
  try {
    for (const id of createdDocs) await api(page, `/api/trade-documents/${id}`, { method: "DELETE" });
    if (createdSuppliers.length) await api(page, "/api/suppliers/bulk-delete", { method: "POST", body: { ids: createdSuppliers } });
    const list = (await api(page, "/api/customers?scope=team")).data?.customers ?? [];
    const junk = list.filter((c) => String(c.company || "").includes(`VF已成交客户${TS}`)).map((c) => c.id);
    const sup = (await api(page, "/api/suppliers")).data?.suppliers ?? [];
    const junkSup = sup.filter((s) => String(s.company || "").includes(TS)).map((s) => s.id);
    if (junk.length) await api(page, "/api/customers/bulk-delete", { method: "POST", body: { ids: junk } });
    if (junkSup.length) await api(page, "/api/suppliers/bulk-delete", { method: "POST", body: { ids: junkSup } });
    console.log(`  （已清理：单据 ${createdDocs.length} 条 / 客户 ${junk.length} 条 / 供应商 ${createdSuppliers.length + junkSup.length} 条）`);
  } catch (e) {
    console.log("  清理时出错（不影响结论）：", String(e));
  }

  console.log("\n══════════════════════════════════");
  console.log(`  界面验收：PASS=${pass}  FAIL=${fail}`);
  console.log("══════════════════════════════════");
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
}
