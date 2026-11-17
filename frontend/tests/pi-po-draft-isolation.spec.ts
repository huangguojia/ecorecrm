import { expect, test } from "@playwright/test";

// PI / PO 各持一份草稿：切类型不擦内容，也不把另一型的数据带过去；
// 只有「新建单据」才把当前这一型清空。草稿只在内存里（刷新即失，本轮不测刷新）。
async function login(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.locator("#loginEmail").fill("alex@goodjob.com");
  await page.locator("#loginPassword").fill("goodjob123");
  await page.locator("#loginButton").click();
  await expect(page.locator("body")).toHaveClass(/is-authenticated/);
}

async function openDocuments(page: import("@playwright/test").Page) {
  const button = page.locator('.nav button[data-view="documents"]').first();
  if (!(await button.isVisible())) {
    await button.locator("xpath=ancestor::details[1]").locator("summary").click();
  }
  await button.click();
  await expect(page.locator("#documents")).toHaveClass(/active/);
}

const tab = (type: "PI" | "PO") => `#documentTypeTabs button[data-doc-type="${type}"]`;

async function fillPi(page: import("@playwright/test").Page) {
  await page.locator("#docSellerInput").fill("PI-SELLER-A");
  await page.locator("#docBuyerInput").fill("PI-BUYER-A");
  await page.locator("#docConditionInput").fill("完好");
  await page.locator("#docWarrantyInput").fill("12month");
  await page.locator("#docLeadTimeInput").fill("4-7个工作日");
  await page.locator("#docPaymentInput").fill("PI-PAY-A");
}

async function fillPo(page: import("@playwright/test").Page) {
  await page.locator("#docSellerInput").fill("PO-VENDOR-D");
  await page.locator("#docBuyerInput").fill("PO-BUYER-D");
  await page.locator("#docConditionInput").fill("Brand new");
  await page.locator("#docWarrantyInput").fill("24 months");
  await page.locator("#docPaymentInput").fill("PO-PAY-D");
}

test("PI 与 PO 的编辑草稿互不串数据，切回来内容还在", async ({ page }) => {
  await login(page);
  await openDocuments(page);

  // 1. 一张全新的 PI，填 A/B/C 三项
  await page.locator("#newDocumentButton").click();
  await expect(page.locator(tab("PI"))).toHaveClass(/active/);
  await fillPi(page);

  // 2. 切到 PO：PI 的内容一项都不能跟过来
  await page.locator(tab("PO")).click();
  await expect(page.locator(tab("PO"))).toHaveClass(/active/);
  await expect(page.locator("#docSellerInput")).not.toHaveValue("PI-SELLER-A");
  await expect(page.locator("#docBuyerInput")).not.toHaveValue("PI-BUYER-A");
  await expect(page.locator("#docConditionInput")).not.toHaveValue("完好");
  await expect(page.locator("#docWarrantyInput")).not.toHaveValue("12month");
  await expect(page.locator("#docLeadTimeInput")).not.toHaveValue("4-7个工作日");
  await expect(page.locator("#docPaymentInput")).not.toHaveValue("PI-PAY-A");
  await expect(page.locator("#docBuyerInput")).toHaveValue("");

  // 3. PO 填 D/E，切回 PI：PI 还是原来那三项，PO 的值也没倒灌
  await fillPo(page);
  await page.locator(tab("PI")).click();
  await expect(page.locator("#docSellerInput")).toHaveValue("PI-SELLER-A");
  await expect(page.locator("#docBuyerInput")).toHaveValue("PI-BUYER-A");
  await expect(page.locator("#docConditionInput")).toHaveValue("完好");
  await expect(page.locator("#docWarrantyInput")).toHaveValue("12month");
  await expect(page.locator("#docLeadTimeInput")).toHaveValue("4-7个工作日");
  await expect(page.locator("#docPaymentInput")).toHaveValue("PI-PAY-A");
  await expect(page.locator("#docConditionInput")).not.toHaveValue("Brand new");

  // 4. 再切回 PO：PO 的 D/E 也原样还在
  await page.locator(tab("PO")).click();
  await expect(page.locator("#docSellerInput")).toHaveValue("PO-VENDOR-D");
  await expect(page.locator("#docBuyerInput")).toHaveValue("PO-BUYER-D");
  await expect(page.locator("#docConditionInput")).toHaveValue("Brand new");
  await expect(page.locator("#docWarrantyInput")).toHaveValue("24 months");
  await expect(page.locator("#docPaymentInput")).toHaveValue("PO-PAY-D");

  // 5. 预览跟着类型走：PI 页签下不应出现 PO 的供应商
  await page.locator(tab("PI")).click();
  await expect(page.locator("#documentPreview")).not.toContainText("PO-VENDOR-D");

  // 6. 新建只清当前这一型：PO 里新建空白后，切回 PI 内容仍在
  await page.locator(tab("PO")).click();
  await page.locator("#newDocumentButton").click();
  await expect(page.locator("#docBuyerInput")).toHaveValue("");
  await expect(page.locator("#docConditionInput")).toHaveValue("");
  await page.locator(tab("PI")).click();
  await expect(page.locator("#docBuyerInput")).toHaveValue("PI-BUYER-A");
  await expect(page.locator("#docConditionInput")).toHaveValue("完好");
  await page.locator(tab("PO")).click();
  await expect(page.locator("#docBuyerInput")).toHaveValue("");
});

test("侧栏 PI / PO 导航与页签同一套逻辑", async ({ page }) => {
  await login(page);
  await openDocuments(page);
  await page.locator("#newDocumentButton").click();
  await fillPi(page);

  // 侧栏切 PO
  await page.locator('.nav button[data-view="documents"][data-doc-type="PO"]').first().click();
  await expect(page.locator(tab("PO"))).toHaveClass(/active/);
  await expect(page.locator("#docBuyerInput")).toHaveValue("");

  // 侧栏切回 PI
  await page.locator('.nav button[data-view="documents"][data-doc-type="PI"]').first().click();
  await expect(page.locator(tab("PI"))).toHaveClass(/active/);
  await expect(page.locator("#docBuyerInput")).toHaveValue("PI-BUYER-A");
  await expect(page.locator("#docConditionInput")).toHaveValue("完好");
});

test("已保存单据的未保存改动：切类型后仍在，刷新后回到数据库版本", async ({ page }) => {
  await login(page);
  await openDocuments(page);

  // 存一份 PI 进数据库
  await page.locator("#newDocumentButton").click();
  await page.locator("#docSellerInput").fill("PI-SAVED-SELLER");
  await page.locator("#docBuyerInput").fill("PI-SAVED-BUYER");
  await page.locator("#docConditionInput").fill("DB-VALUE");
  await page.locator('[data-doc-field="product"]').first().fill("Platform Scale");
  await page.locator("#saveDocumentButton").click();
  await expect(page.locator(".doc-list-card").first()).toContainText("PI");

  // 改一处但不保存
  await page.locator("#docConditionInput").fill("UNSAVED-EDIT");

  // 切到 PO 再切回 PI：未保存的改动必须还在
  await page.locator(tab("PO")).click();
  await expect(page.locator("#docConditionInput")).toHaveValue("");
  await page.locator(tab("PI")).click();
  await expect(page.locator("#docConditionInput")).toHaveValue("UNSAVED-EDIT");

  // 刷新：草稿只活在内存里，回来读数据库里的版本
  await page.reload();
  await expect(page.locator("body")).toHaveClass(/is-authenticated/);
  await openDocuments(page);
  await page.locator(".doc-list-card").first().click();
  await expect(page.locator("#docConditionInput")).toHaveValue("DB-VALUE");
});

