import { readdirSync, readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { resolveLeadAiSearchDraft } from "./lead-ai-search.js";
import {
  isLeadSourceAutoSelected,
  isLeadSourceExecutable,
  resolveLeadSearchSources
} from "./lead-source-selection.js";


// 后端 server.ts 已拆分为 server.ts（入口）+ server-core.ts（共享内核）+ routes/*.ts（各业务路由）；
// 前后端对齐检查读取全部后端 HTTP 源码。后端目录不存在时抛错，由各调用点的 try/catch 跳过。
function readBackendServerSources() {
  const backendSrc = new URL("../../backend/src/", import.meta.url);
  const routeFiles = readdirSync(new URL("routes/", backendSrc)).filter((name) => name.endsWith(".ts")).sort();
  return ["server.ts", "server-core.ts", ...routeFiles.map((name) => `routes/${name}`)]
    .map((file) => readFileSync(new URL(file, backendSrc), "utf8"))
    .join("\n");
}

const prototype = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const apiLayer = readFileSync(new URL("./prototype-api.ts", import.meta.url), "utf8");
const prospectRadar = readFileSync(new URL("./prospect-radar.ts", import.meta.url), "utf8");
const integrationCenter = readFileSync(new URL("./integrations/integration-center.ts", import.meta.url), "utf8");
const productConfig = JSON.parse(readFileSync(new URL("../public/product-config.json", import.meta.url), "utf8")) as {
  productName?: string;
  version?: string;
};

const required = [
  "login-screen",
  "loginProductVersion",
  "customs-pack-preview-page",
  "is-missing",
  "todo-board",
  "report-deck",
  "id=\"settings\"",
  "id=\"database-maintenance\"",
  "data-view=\"database-maintenance\"",
  "MYSQL_LOCAL_BACKUP_ENABLED=true",
  "/api/system/database-maintenance/status",
  "/api/system/database-backups/jobs",
  "databaseStreamLog",
  "databaseTableProgressMeta",
  "暂停滚动",
  "下载日志",
  "prototype-api.ts",
  "/api/auth/login",
  "/api/dashboard/summary",
  "DASHBOARD_LIVE_REFRESH_MS",
  "EXCHANGE_RATE_REFRESH_MS",
  "refreshVisibleDashboard",
  "requestDashboardRefresh",
  "/api/exchange-rates/today",
  "dashboardExchangeTicker",
  "dashboardCurrentDate",
  "仅提供最近一个交易日",
  "retryAfterAt",
  "errorCode",
  "incrementalStats",
  "已结束",
  "lead-job-source-list",
  "pipelineAmount",
  "problemStatusFilter",
  "problemSeverityFilter",
  "problemCategoryFilter",
  "resolvedAt",
  "problem-solution-highlight",
  "problem-solution-field",
  "closeOnBackdrop: false",
  "advanced-excel-types",
  "is-current",
  "stageCurrency",
  "来源证据",
  "sourceEvidence",
  "ai_search",
  "notificationBellButton",
  "notificationBellBadge",
  "消息通知",
  "navigateFromInternalMessage",
  "查看日报",
  "quoteHistoryViewButton",
  "quoteHistoryWorkspace",
  "quoteHistoryProduct",
  "quoteHistoryCountry",
  "quoteHistoryProductModeButton",
  "quoteHistoryProductRows",
  "quoteHistoryProductOverview",
  "productAnalysis",
  "查看报价变化",
  "/api/quote-history",
  "agent-live-execution",
  "agent-action-chain",
  "aria-label=\"权限管理\"",
  "google_places",
  "prospectJoinedFrom",
  "prospect-mobile-detail-open",
  "prospectRadarDialog",
  "关系连线仅来自已记录证据"
];

assert.match(apiLayer, /documents: "单据平台"/u, "单据平台工作区标签必须使用中文名称");
assert.match(apiLayer, /suppliers: "供应商"/u, "供应商工作区标签必须使用中文名称");
assert.equal(apiLayer.includes('"email-return-flow": "开发信回流"'), false, "已精简模块不得再出现在视图标签表");
assert.match(apiLayer, /const captureHeight = Math\.max\(capture\.scrollHeight/u, "PDF 导出必须捕获完整预览高度");
assert.match(apiLayer, /const captureWidth = 794[\s\S]*captureHost = document\.createElement\("div"\)/u, "PDF 导出必须使用独立的 A4 宽度画布");
assert.match(apiLayer, /height: captureHeight/u, "PDF 导出必须把完整预览高度传给截图引擎");
assert.match(apiLayer, /capture\.style[\s\S]*maxWidth: "none"[\s\S]*margin: "0"/u, "PDF 导出画布不得继承屏幕预览的居中偏移");
assert.match(prototype, /\.print-only-document\.doc-paper \{[\s\S]*max-height: none !important;[\s\S]*overflow: visible !important;/u, "打印降级不能裁切多页单据");

for (const token of required) {
  if (!prototype.includes(token) && !apiLayer.includes(token)) throw new Error(`missing ${token}`);
}

// ---- 精简边界契约（2026-11-06）----
// 精简是一次性动作，之后每加一行代码都可能把删掉的模块悄悄带回来。
// 这一组断言只看两件事：删掉的视图不许复活，保留下来的五个板块不许长歪。
const removedViews = [
  "pipeline", "commission", "knowledge", "exam", "lead-finder", "prospect-list",
  "mail-center", "integration-center", "whatsapp", "tools", "products", "orders", "deals"
];
for (const view of removedViews) {
  assert.equal(prototype.includes(`id="${view}"`), false, `已精简视图 ${view} 不得重新出现在 index.html`);
}

const navStart = prototype.indexOf('<nav class="nav"');
const navBlock = navStart < 0 ? "" : prototype.slice(navStart, prototype.indexOf("</nav>", navStart));
assert.ok(navStart > 0, "侧边导航容器必须存在");
for (const view of ["dashboard", "customers", "customer-pool", "suppliers", "documents", "settings", "database-maintenance", "profile", "theme", "logs"]) {
  assert.ok(navBlock.includes(`data-view="${view}"`), `导航必须保留 ${view} 入口`);
}
assert.equal(navBlock.includes('data-view="pipeline"'), false, "商机看板已移除，导航不得再出现商机入口");
// ECORECRM 界面上不再有商机这一概念：从导航、卡片、筛选到提示语一律清除，后端接口与数据不动。
assert.equal(prototype.includes("商机"), false, "界面壳层不得再出现「商机」字样");
assert.equal(apiLayer.includes("商机"), false, "前端逻辑层不得再出现「商机」字样");

assert.match(apiLayer, /const ECORE_DOC_TYPES: string\[\] = \["PI", "PO"\];/u, "单据类型白名单必须只有 PI 与 PO");
const docTypeTabStart = prototype.indexOf('id="documentTypeTabs"');
const docTypeTabs = docTypeTabStart < 0 ? "" : prototype.slice(docTypeTabStart, prototype.indexOf("</div>", docTypeTabStart));
assert.match(docTypeTabs, /data-doc-type="PI"/u, "单据页签必须保留 PI");
assert.match(docTypeTabs, /data-doc-type="PO"/u, "单据页签必须保留 PO");
assert.doesNotMatch(docTypeTabs, /data-doc-type="(?:CI|PL|CUSTOMS|CONTRACT|QUOTATION|COO|SHIPPING)"/u, "单据页签不得再提供已收窄掉的单据类型");
assert.match(apiLayer, /const ECORE_TEMPLATE_STYLE = "custom-b"/u, "单据模板只保留定制 B 版式（界面名为默认模版）");
assert.match(apiLayer, /const invalid = targets\.find\(\(document\) => !ECORE_DOC_TYPES\.includes\(document\.type\)\);/u, "非 PI/PO 单据必须被删除守卫拦住");
// 历史单据必须能查能删：列表每行给「打开 + 删除」，批量删除要二次确认并输入份数
assert.match(apiLayer, /async function deleteTradeDocuments\(documents: TradeDocument\[\], button\?: HTMLButtonElement\)/u, "删除必须收敛到共用的 deleteTradeDocuments");
assert.match(apiLayer, /verificationText: single \? undefined : String\(targets\.length\)/u, "批量删除必须要求输入份数确认");
assert.match(apiLayer, /data-document-history-delete="\$\{escapeHtml\(document\.id\)\}"/u, "历史单据每行必须有删除按钮");
assert.match(apiLayer, /documentHistorySelection = new Set<string>\(\);\s*renderDocumentHistory/u, "每次查询历史单据都必须清空勾选，避免删到不可见单据");
assert.match(apiLayer, /#documentHistoryDeleteSelectedButton/u, "历史单据必须提供批量删除入口");
assert.match(prototype, /id="documentHistoryDeleteSelectedButton"/u, "历史单据工具条必须渲染批量删除按钮");
assert.match(prototype, /<th class="document-history-select-head">/u, "历史单据表头必须提供全选列");
assert.equal(prototype.includes('colspan="8" class="empty-cell">正在加载历史单据'), false, "历史单据表头已扩到 9 列，空态 colspan 必须同步");
// 卖方公司与单据资产面板：新增/编辑入口必须真的绑上事件，否则弹窗里点按钮毫无反应
assert.match(apiLayer, /#documentAssetAddLetterhead"\)\?\.addEventListener\("click", \(\) => openLetterhead\(\)\)/u, "「新增卖方公司」必须绑定 openLetterhead");
assert.match(apiLayer, /#documentAssetAddStamp"\)\?\.addEventListener\("click", \(\) => openStamp\(\)\)/u, "「新增印章」必须绑定 openStamp");
assert.match(apiLayer, /#documentAssetAddSignature"\)\?\.addEventListener\("click", \(\) => openSignature\(\)\)/u, "「新增签名」必须绑定 openSignature");
assert.match(apiLayer, /"\[data-edit-letterhead\]", modalRoot/u, "卖方公司卡片「编辑」必须绑定到对应记录");
assert.match(apiLayer, /请填写公司英文全称/u, "缺少公司英文全称要在前端拦下（后端 name/companyName 必填）");
assert.match(apiLayer, /请选择透明 PNG 印章图片/u, "印章未选图片要在前端拦下（后端 imageUrl 必填）");
assert.match(apiLayer, /请选择签名图片/u, "签名未选图片要在前端拦下（后端 imageUrl 必填）");

for (const token of ["--bg: #080808;", "--surface: #111111;", "--line: #242424;"]) {
  assert.ok(prototype.includes(token), `ecore 主题令牌 ${token} 不得丢失`);
}

assert.match(apiLayer, /\/api\/customers\?scope=public/u, "客户公池必须走 scope=public 的服务端筛选");
assert.match(apiLayer, /\/api\/customers\/bulk-delete/u, "客户批量删除接口不得丢失");
assert.match(apiLayer, /\/api\/suppliers\/bulk-delete/u, "供应商批量删除接口不得丢失");

for (const page of ["overview", "members", "organization", "roles", "ui", "authorization", "audit"]) {
  assert.ok(prototype.includes(`data-iam-page="${page}"`), `权限页面 ${page} 必须保留独立容器`);
}

assert.equal(prototype.includes("data-view=\"inbox\""), false, "消息通知不应出现在左侧导航");
assert.equal(prototype.includes("写站内信"), false, "通知中心不应提供人工写信入口");
assert.equal(apiLayer.includes("openInternalMessageComposeModal"), false, "不应保留旧写信交互");
const systemNavigation = prototype.slice(
  prototype.indexOf('<details class="nav-section" aria-label="系统配置">'),
  prototype.indexOf("</nav>")
);
assert.equal(systemNavigation.includes('data-view="member-management"'), false, "权限模块不得继续混在系统配置导航中");
assert.match(prototype, /aria-label="权限管理"[\s\S]*data-view="member-management"[\s\S]*data-view="permission-audit"/u, "权限页面必须集中在独立权限管理分组");
assert.match(apiLayer, /const requiredPermission = viewPermissionRequirements\[view\][\s\S]{0,120}return hasIamCapability\(requiredPermission\)/, "权限页面必须按能力位放行：管理员与被授权角色走同一条校验");
assert.doesNotMatch(apiLayer, /isAccessControlView\(view\) && !isSystemAdministrator\(user\)/, "权限页面不得再按 admin 身份一刀切截断被授权角色");
assert.match(apiLayer, /function isPlatformOperator[\s\S]*user\.role === "super_admin"/, "超级管理员必须被识别为平台运维身份");
assert.match(apiLayer, /if \(isPlatformOperator\(user\)\) \{[\s\S]*return view === "platform-operations"/, "平台运维账号只能进入运维中心");
assert.match(apiLayer, /view = platformOperator \? "platform-operations" : "dashboard"/, "平台运维账号非法跳转时必须返回运维中心");
assert.equal(prototype.includes('id="platform-operations"'), false, "运维中心已从精简版移除，不应残留视图");
assert.match(apiLayer, /if \(isPlatformOperator\(\)\) \{[\s\S]*openWorkspaceTabs = \["platform-operations"\][\s\S]*wrap\.innerHTML = ""/, "超级管理员顶部不得残留工作台标签");
assert.match(prototype, /body\.platform-mode #topOpenTabs,[\s\S]*body\.platform-mode \.top-status,[\s\S]*body\.platform-mode #notificationBellButton/u, "运维模式必须隐藏业务工作台状态栏");
assert.match(apiLayer, /qsa<HTMLElement>\("\.sidebar details\.nav-section"\)[\s\S]{0,200}section\.hidden = items\.every/, "权限管理分组必须跟着组内入口的能力位显示，而不是整块按管理员身份隐藏");
assert.match(apiLayer, /class="ac-workbench ac-role-layout"[\s\S]*class="ac-role-list"[\s\S]*class="ac-permission-table"/, "角色管理必须使用角色目录与当前角色权限双栏结构");
assert.match(apiLayer, /class="ac-role-checks" id="iamMemberRoleIds"[\s\S]*type="checkbox"/, "成员授权必须使用清晰的角色复选项，不能退回原生多选框");
assert.match(apiLayer, /data-ac-guide aria-label="权限使用说明"/, "权限模块必须提供独立的使用说明入口");
assert.match(apiLayer, /管理员与已授权角色可以设置[\s\S]*建立组织架构[\s\S]*创建角色并配置权限[\s\S]*给成员分配角色[\s\S]*通过审计复核/, "权限使用说明必须覆盖访问限制与完整配置顺序");
assert.match(apiLayer, /function bindAccessControlInteractions[\s\S]*const root = activeAccessControlRoot\(\)[\s\S]*root\.querySelector<T>/, "权限页面交互必须绑定在当前页面，不能误绑到隐藏的成员管理页面");
assert.doesNotMatch(apiLayer, /class="ac-metrics"|class="ac-loading-metrics"/, "权限页面和加载态都不得继续显示顶部五项统计条");
// 权限总览：把授权关系画成可读的图，而不是让管理员逐行读表格
assert.doesNotMatch(prototype, /aria-label="权限管理"[^>]*data-admin-only/u, "权限管理分组不得按 admin 身份整块隐藏，要跟着能力位走");
assert.match(prototype, /aria-label="权限管理"[\s\S]*data-view="access-overview"[\s\S]*data-view="member-management"/u, "权限管理分组必须把权限总览放在第一位");
assert.match(prototype, /class="view iam-view" id="access-overview"[\s\S]{0,120}data-iam-page="overview"/u, "权限总览必须是独立的权限页面容器");
assert.match(apiLayer, /function renderAccessControlOverview\([\s\S]*ac-viz-kpis[\s\S]*ac-viz-table/u, "权限总览必须同时给出指标条与成员×模块热力图");
assert.match(apiLayer, /accessControlSelectedMemberId = row\.dataset\.acVizMember[\s\S]{0,120}activateNavView\("member-authorization"\)/u, "热力图成员行必须能直接跳到该成员的授权详情");
assert.match(apiLayer, /当前账号没有该权限页面的查看授权，请联系管理员开通/u, "未获授权的账号进入权限页时必须提示走授权流程");
assert.match(apiLayer, /const body = !overview\.company[\s\S]{0,200}page === "overview"[\s\S]{0,80}renderAccessControlOverview/u, "权限总览必须接进权限页面路由分发");
const systemSettingsView = prototype.slice(
  prototype.indexOf('<div class="view" id="settings"'),
  prototype.indexOf('class="view" id="', prototype.indexOf('<div class="view" id="settings"') + 10)
);
assert.match(systemSettingsView, /<h1>系统设置<\/h1>/, "系统设置页面必须使用正确标题");
assert.doesNotMatch(systemSettingsView, /账号列表|新增账号|权限模板|角色权限/, "人员与权限配置不得在系统设置中重复出现");
assert.match(systemSettingsView, /公司资料[\s\S]*单据设置[\s\S]*系统更新/, "系统设置必须保留公司资料、单据设置与系统更新");
assert.equal(apiLayer.includes("leadFinderDetailMarkButton"), false, "自动获客不应保留标记可联系的授权语义");
assert.match(
  apiLayer,
  /async function openAdvancedExcelPanel\(\)[\s\S]*const editorType = currentDocumentType\(\)[\s\S]*if \(current\.type !== editorType\)[\s\S]*await saveTradeDocument\(\)[\s\S]*type === current\.type \? "is-current"/,
  "高级 Excel 必须先同步当前编辑器单据类型，并高亮当前类型模板"
);
assert.equal(apiLayer.includes("部分完成"), false, "任务与来源状态不得使用容易误解的“部分完成”提示");
assert.equal(apiLayer.includes("parseGoalToBrief"), false, "AI 解析失败后不得使用本地规则伪装成成功结果");
const leadFinderLaunchFlow = apiLayer.slice(
  apiLayer.indexOf("async function runLeadFinder"),
  apiLayer.indexOf("async function shortlistLeadFinderRows")
);
assert.deepEqual(resolveLeadAiSearchDraft({
  name: "Edited Mexico Filling Equipment",
  products: ["edited liquid filling machines"],
  markets: ["Mexico"],
  industries: ["coatings manufacturing"],
  exclusions: ["trading companies"],
  customerType: "终端工厂"
}), {
  parsedName: "Edited Mexico Filling Equipment",
  products: ["edited liquid filling machines"],
  markets: ["Mexico"],
  industries: ["coatings manufacturing"],
  exclusions: ["trading companies"],
  customerType: "终端工厂",
  marketOpen: false
}, "启动搜索必须完整采用用户修改后的 AI 解析字段");
assert.throws(() => resolveLeadAiSearchDraft({
  name: "",
  products: [],
  markets: ["China"],
  industries: [],
  exclusions: [],
  customerType: "*"
}), /产品关键词不能为空/, "修改后的必填搜索词为空时必须停止，不能降级");
assert.match(prospectRadar, /\.arcsData\(relationRows\)/, "3D 地球只能渲染模型提供的真实关系数据");
assert.match(prospectRadar, /\.htmlElementsData\(focusedPoint \? \[focusedPoint\] : \[\]\)/, "公司名称必须使用浏览器原生文字层以完整支持中文");
assert.match(prospectRadar, /function companyMarker[\s\S]*company\.textContent = item\.company/, "中文公司名称必须通过 textContent 安全渲染");
assert.equal(prospectRadar.includes(".labelText("), false, "公司名称不能继续使用缺少中文字形的 3D 纹理文字");
assert.match(prospectRadar, /function createCaptureFeed[\s\S]*role\", \"log\"[\s\S]*aria-live\", \"polite\"/, "回放必须提供可访问的实时企业捕获流");
assert.match(prospectRadar, /frame\.kind === \"candidate\" && focusedPoint[\s\S]*captureFeed\.addCandidate/, "捕获流只能从真实候选事件追加企业");
assert.match(prospectRadar, /function captureMilestone[\s\S]*count === 5[\s\S]*count === 10[\s\S]*count === 20/, "捕获流必须按真实企业数量插入阶段反馈");
assert.match(prospectRadar, /replay\(\)[\s\S]*captureFeed\.reset\(\)/, "重播必须清空旧捕获流后重新按事件打印");
assert.match(prototype, /\.prospect-radar-capture-list[\s\S]*mask-image: linear-gradient/u, "捕获流顶部和底部必须渐隐，避免旧结果硬切消失");
assert.match(prospectRadar, /prefers-reduced-motion: reduce/, "演示模式必须支持低动态偏好");
assert.match(prospectRadar, /destroy\(\)[\s\S]*resizeObserver\.disconnect\(\)[\s\S]*globe\._destructor\(\)/, "关闭演示必须完整释放 WebGL 和尺寸监听器");
assert.match(prototype, /data-view="settings" data-scope="manager"/u, "业务员导航中必须隐藏系统设置");
assert.match(prototype, /id="settings" data-scope="manager"/u, "业务员视图中必须隐藏系统设置页面");
assert.match(prototype, /data-view="database-maintenance" data-scope="admin"/u, "数据库维护导航必须只向管理员显示");
assert.match(prototype, /id="database-maintenance" data-scope="admin"/u, "数据库维护必须使用独立页面");
assert.equal(prototype.includes("id=\"mysqlImportPanel\""), false, "数据库迁移不能继续嵌在账号管理页");
assert.match(apiLayer, /"database-maintenance": "database\.maintain"/, "数据库维护页面必须绑定数据库维护能力");
assert.match(apiLayer, /"member-management": "member\.read"/, "成员管理页面必须绑定成员查看能力");
assert.match(apiLayer, /"role-management": "role\.read"/, "角色管理页面必须绑定角色查看能力");
assert.match(apiLayer, /"ui-access": "role\.read"/, "界面开通页面必须绑定角色查看能力");
assert.match(prototype, /data-view="ui-access" title="界面开通"/u, "权限管理导航必须提供界面开通入口");
assert.match(prototype, /id="ui-access" data-scope="admin" data-iam-page="ui"/u, "界面开通必须使用独立权限页面");
assert.match(apiLayer, /interface AccessControlUiModule[\s\S]*edition: string/, "界面开通必须把界面模块和版本说明结构化");
assert.match(apiLayer, /function renderAccessControlUiAccess[\s\S]*界面会按角色权限自动出现[\s\S]*data-ac-module-enable[\s\S]*data-ac-module-disable/, "界面开通必须支持按角色查看并开通或关闭模块");
assert.match(apiLayer, /function mutateAccessControlModule/, "界面模块开通必须有独立的批量发布函数");
assert.match(apiLayer, /\/api\/v1\/roles\/\$\{encodeURIComponent\(role\.id\)\}\/permissions/, "界面模块开通必须复用角色权限发布接口");
assert.match(apiLayer, /开通界面模块：\$\{module\.name\}/, "界面模块开通必须留下审计原因");
assert.match(apiLayer, /introducedVersion\?: string/, "权限项必须携带引入版本，方便按界面版本解释权限");
assert.match(apiLayer, /连接中断，正在重连/, "数据库任务断流必须进入重连状态而非误报失败");
assert.match(apiLayer, /if \(!canAccessWorkspaceView\(view\)\) \{[\s\S]*view = platformOperator \? "platform-operations" : "dashboard";/, "页面切换必须阻止越权访问，并按账号身份回到正确首页");
assert.match(apiLayer, /workspaceView: "gj_workspace_view"/, "工作区必须记录当前活动模块，避免刷新后退回主页");
assert.match(apiLayer, /sessionStorage\.setItem\(workspaceViewStorageKey\(\), view\)/, "导航切换必须按当前账号记住活动模块");
assert.match(apiLayer, /restoreSession\(\)[\s\S]*activateNavView\(state\.iamCapabilities\?\.source === "platform" \? "platform-operations" : rememberedWorkspaceView\(user\)\)/, "会话恢复后必须按身份回到刷新前的模块");
assert.match(prototype, /\.agent-chat-bubble,[\s\S]*\.agent-chat-answer > p[\s\S]*user-select: text;/u, "Agent 对话正文必须允许选择复制");
assert.equal(productConfig.productName, "ECORE GLOBAL");
assert.match(productConfig.version || "", /^\d+\.\d+(?:\.\d+)?$/);

assert.equal(isLeadSourceExecutable({ id: "ready", ready: true, enabled: true, accessMode: "api" }), true);
assert.equal(isLeadSourceExecutable({ id: "disabled", ready: true, enabled: false, accessMode: "api" }), false);
assert.equal(isLeadSourceExecutable({ id: "manual", ready: true, enabled: true, accessMode: "manual_assisted" }), false);
assert.equal(
  isLeadSourceAutoSelected({ id: "free", tier: "free", ready: true, enabled: true, accessMode: "api", recommended: true }),
  false
);
assert.equal(
  isLeadSourceAutoSelected({ id: "byok-free", tier: "byok_free", ready: true, enabled: true, accessMode: "api", recommended: true }),
  false
);
assert.equal(
  isLeadSourceAutoSelected({ id: "serper", tier: "byok_free", category: "web", capabilities: ["web"], hasApiKey: true, ready: true, enabled: true, accessMode: "api" }),
  true,
  "已配置的搜索 API 必须自动进入默认来源，不能被 AI 搜索绑架"
);
assert.equal(
  isLeadSourceAutoSelected({ id: "paid", tier: "paid", ready: true, enabled: true, accessMode: "api", recommended: true }),
  true
);
assert.deepEqual(
  resolveLeadSearchSources([
    { id: "ai_search", ready: true, enabled: true, accessMode: "api" },
    { id: "gleif", ready: true, enabled: true, accessMode: "api", recommended: true },
    { id: "wikidata", ready: true, enabled: false, accessMode: "api", recommended: true }
  ], [], false),
  { sources: ["ai_search", "gleif"], blocked: [], requiresSelection: false }
);
assert.deepEqual(
  resolveLeadSearchSources([
    { id: "free", tier: "free", ready: true, enabled: true, accessMode: "api", recommended: true },
    { id: "byok-free", tier: "byok_free", ready: true, enabled: true, accessMode: "api", recommended: true },
    { id: "serper", tier: "byok_free", category: "web", capabilities: ["web"], hasApiKey: true, ready: true, enabled: true, accessMode: "api", recommended: false },
    { id: "paid", tier: "paid", ready: true, enabled: true, accessMode: "api", recommended: true }
  ], [], false),
  { sources: ["serper", "paid"], blocked: [], requiresSelection: false }
);
assert.deepEqual(
  resolveLeadSearchSources([
    { id: "ai_search", ready: false, enabled: false, accessMode: "api" },
    { id: "gleif", ready: true, enabled: true, accessMode: "api", recommended: true }
  ], ["ai_search"], true),
  {
    sources: [],
    blocked: [{ id: "ai_search", reason: "not_ready" }],
    requiresSelection: false
  }
);
assert.deepEqual(
  resolveLeadSearchSources([
    { id: "serper", ready: true, enabled: false, accessMode: "api" },
    { id: "gleif", ready: true, enabled: true, accessMode: "api", recommended: true }
  ], ["serper"], true),
  {
    sources: [],
    blocked: [{ id: "serper", reason: "disabled" }],
    requiresSelection: false
  }
);
assert.deepEqual(
  resolveLeadSearchSources([{ id: "gleif", ready: true, enabled: true, accessMode: "api", recommended: true }], [], true),
  { sources: [], blocked: [], requiresSelection: true }
);
assert.deepEqual(
  resolveLeadSearchSources([
    { id: "importyeti", ready: true, enabled: true, accessMode: "manual_assisted" }
  ], ["importyeti"], true),
  {
    sources: [],
    blocked: [{ id: "importyeti", reason: "not_executable" }],
    requiresSelection: false
  }
);

if (!prototype.includes(".report-hero") || !prototype.includes(".ocr-workbench") || !prototype.includes(".account-grid")) {
  throw new Error("missing high fidelity prototype styles");
}

assert.equal(prototype.includes("collab-inbox-nav"), false, "message center must not remain in sidebar navigation");
assert.doesNotMatch(prototype, /class="lead-settings-summary"/u, "『来源与执行设置必须有醒目的标题样式』所属模块已从精简版移除");
assert.doesNotMatch(prototype, /免费源效果可能不佳，默认不勾选/u, "『来源设置必须提示免费源默认不勾选及质量风险』所属模块已从精简版移除");
assert.match(prototype, /lead-settings-summary::before/u, "来源设置必须显示可展开的箭头 affordance");
assert.match(prototype, /content: "展开"/u, "来源设置必须显示展开状态提示");
assert.equal(prototype.includes("id=\"composeMessageButton\""), false, "notification center must not present direct-message composition as its primary workflow");
assert.match(apiLayer, /selectedPendingHitIds/, "待清洗导入必须保留明确选择状态");
assert.equal(apiLayer.includes("lead-job-card is-openable"), false, "任务卡片不能整卡点击进入详情");
assert.equal(apiLayer.includes("同步本任务结果"), false, "任务结果操作必须使用明确的候选与线索语义");
const customerSectionIndex = prototype.indexOf('aria-label="客户管理"');
const customerOpenNavIndex = prototype.indexOf('data-view="customers" data-customer-outcome="open" title="未成交客户"');
const customerWonNavIndex = prototype.indexOf('data-view="customers" data-customer-outcome="won" title="已成交客户"');
const customerPoolNavIndex = prototype.indexOf('data-view="customer-pool" title="客户公池"');
assert.ok(customerSectionIndex >= 0 && customerSectionIndex < customerOpenNavIndex && customerOpenNavIndex < customerWonNavIndex && customerWonNavIndex < customerPoolNavIndex, "customers and customer pool must share one navigation group");
assert.match(prototype, /id="customerPageTitle">未成交客户/u, "customer page must expose the default outcome context");
assert.match(apiLayer, /customerOutcomeFilter: "open" \| "won"/, "customer outcome filter must be explicit in app state");
assert.match(apiLayer, /state\.customerOutcomeFilter === "won" \? customer\.hasWonDeal === true : customer\.hasWonDeal !== true/, "customer navigation must filter won and open customers from real data");
assert.match(apiLayer, /if \(view === "customers"\) \{\s*renderCustomers\(state\.customers\);\s*\}/, "switching customer outcome navigation must redraw the shared customer page");
assert.match(apiLayer, /\["成交状态", "客户状态", "状态", "Lifecycle Status", "lifecycleStatus"\]/, "customer import must accept an explicit lifecycle status");
assert.match(apiLayer, /成交状态: customer\.hasWonDeal \? "已成交" : "未成交"/, "customer export must preserve lifecycle status");
assert.doesNotMatch(apiLayer, /由关联商机自动判断/, "customer status must not be described as a live deal-derived value");
assert.match(apiLayer, /customer\.wonDealCount \? `已成交 \$\{customer\.wonDealCount\} 次` : "已成交客户"/, "imported won customers without deals must not invent a transaction count");
assert.doesNotMatch(apiLayer, /wonDealCount \|\| 1/, "customer UI must not fabricate one won deal for imported customers");
assert.doesNotMatch(prototype, /id="instantCommunicationState"/u, "『即刻沟通必须有明确的服务加载状态』所属模块已从精简版移除");
assert.match(apiLayer, /联系方式备注 \/ 其它渠道/, "客户表单必须支持登记其它渠道联系方式");
assert.match(apiLayer, /contactRemark/, "客户联系方式备注必须进入前端数据链路");
assert.match(apiLayer, /closeOnBackdrop: false/, "客户新增弹窗点击背景不能自动关闭");
assert.match(apiLayer, /let modalCloseOnBackdrop = false;/, "通用居中弹窗必须默认禁止点击背景关闭");
assert.match(apiLayer, /modalCloseOnBackdrop = options\.closeOnBackdrop \?\? false;/, "未显式配置时不得允许背景点击关闭弹窗");
assert.doesNotMatch(apiLayer, /#productModal[\s\S]{0,160}event\.target ===/, "产品编辑弹窗点击背景不得关闭");
assert.doesNotMatch(apiLayer, /#shipmentModal[\s\S]{0,160}event\.target ===/, "发货单编辑弹窗点击背景不得关闭");
assert.match(apiLayer, /联系方式备注（其它渠道）/, "客户导入导出必须包含联系方式备注列");
assert.match(apiLayer, /id="customerSourceInput"/, "客户新增编辑表单必须支持登记客户来源");
assert.match(apiLayer, /客户来源: customer\.source/, "客户导出必须包含客户来源");
assert.match(apiLayer, /\["客户来源", "来源", "获客渠道"/, "客户导入必须识别客户来源列及常用别名");
assert.match(prototype, /<th>客户来源<\/th>/u, "客户列表必须使用客户来源替换健康度列");
assert.match(apiLayer, /field\("客户来源", current\.source\)/, "客户全景必须展示客户来源");
assert.match(apiLayer, /<span>客户来源<\/span><b>\$\{escapeHtml\(customer\.source/, "客户侧边详情必须展示客户来源");
assert.match(apiLayer, /customerFullNameInput|customerCompanyFullNameInput/, "客户表单必须支持公司全名");
assert.match(apiLayer, /客户ID: customer\.id/, "客户导出必须包含稳定客户 ID");
assert.doesNotMatch(apiLayer, /· ID \$\{escapeHtml\(customer(?:\?|\.)\.id/, "客户和商机日常界面不得显示内置客户 ID");
assert.doesNotMatch(apiLayer, /客户编号 \$\{escapeHtml\(current\.id\)/, "客户全景不得显示内置客户编号");
assert.doesNotMatch(apiLayer, /<label>客户 ID<\/label>/, "客户编辑弹窗不得显示系统主键");
assert.match(apiLayer, /公司简称: customer\.company/, "客户导出必须区分客户简称");
assert.match(apiLayer, /customerDocumentName\(customer\)/, "单据生成必须优先使用公司全名");
assert.match(apiLayer, /公司全名/, "客户界面必须提供公司全名字段");
assert.equal(prototype.includes("topReminderCount"), false, "全局顶部栏不应继续显示提醒计数");
assert.equal(prototype.includes("主库 <b>MySQL<\/b>"), false, "全局顶部栏不应显示数据库实现信息");
assert.equal(prototype.includes("topImportButton"), false, "客户导入不能继续占用全局顶部栏");
assert.equal(prototype.includes("topExportButton"), false, "客户导出不能继续占用全局顶部栏");
assert.match(prototype, /class="customer-head-actions"[\s\S]*id="customerExportButton"[\s\S]*id="customerCreateButton"[\s\S]*>新增</u, "客户页只能保留一个「新增」入口，导出按钮与它在同一行");
assert.match(prototype, /<th>客户价值<\/th><th>保护期<\/th><th>跟进节奏<\/th>/u, "客户列表必须在客户价值之后展示保护期列");
assert.match(apiLayer, /function protectionCellHtml[\s\S]{0,320}?已到期[\s\S]{0,160}?剩 \$\{days\} 天/u, "保护期列必须同时区分已到期与剩余天数，不能只显示日期");
assert.match(prototype, /id="customerPagination"[\s\S]*id="customerPageSize"[\s\S]*id="customerPrevPage"[\s\S]*id="customerNextPage"/u, "客户列表必须保留分页和每页数量控制");
assert.match(apiLayer, /function customerPageRows[\s\S]*customers\.slice\(start, start \+ state\.customerPageSize\)/, "客户列表必须只渲染当前页数据");
assert.match(apiLayer, /state\.customerPage = Math\.min\(Math\.max\(1, state\.customerPage\), pageCount\)/, "客户数据减少后必须自动校正页码");
assert.match(apiLayer, /customerSearchInput[\s\S]*state\.customerPage = 1[\s\S]*customerQueueFilter[\s\S]*state\.customerPage = 1/, "客户搜索和队列筛选必须回到第一页");
assert.doesNotMatch(prototype, /id="agentSkillsGrid"/u, "『Skill 管理必须使用卡片目录』所属模块已从精简版移除");
assert.doesNotMatch(prototype, /class="integration-launcher"/u, "『集成中心必须使用卡片入口页』所属模块已从精简版移除");
assert.equal((prototype.match(/data-integration-launch-tab=/gu) || []).length, 0, "集成中心已从精简版移除，不应残留入口");
assert.doesNotMatch(prototype, /class="integration-tabs"[^>]*hidden/u, "『集成中心旧横向标签必须保持隐藏』所属模块已从精简版移除");
assert.doesNotMatch(prototype, /Stage 6/, "集成中心不得显示内部开发阶段字样");
assert.match(integrationCenter, /data-integration-home/, "每个集成工作区必须提供返回入口");
assert.match(integrationCenter, /showHome\(\)/, "集成中心首次进入必须显示卡片入口页");
assert.doesNotMatch(prototype, /id="agentSkillsCategoryFilter"/u, "『Skill 管理必须支持分类筛选』所属模块已从精简版移除");
assert.doesNotMatch(prototype, /id="agentSkillsStatusFilter"/u, "『Skill 管理必须支持状态筛选』所属模块已从精简版移除");
assert.doesNotMatch(prototype, /id="agentSkillsSourceFilter"/u, "『Skill 管理必须支持获取方式筛选』所属模块已从精简版移除");
assert.doesNotMatch(prototype, /id="agentSkillDrawerBackdrop"/u, "『Skill 详情必须有独立抽屉』所属模块已从精简版移除");
assert.doesNotMatch(apiLayer, /exec\(skill\.installCommand|eval\(skill\.installCommand/, "Skill 安装命令只能展示和复制，不能在浏览器执行");
assert.doesNotMatch(prototype, /id="agentSkillAddButton"/u, "『Skill 资源中心必须提供权限控制的上架入口』所属模块已从精简版移除");
assert.match(apiLayer, /type DevelopmentEmailScenario = "first_touch" \| "daily_contact" \| "holiday_greeting" \| "new_product" \| "custom_goal"/, "开发信必须提供五种明确写作场景");
assert.match(apiLayer, /正在加载开发信工作区/, "开发信进入时必须表达为加载工作区而非自动生成");
assert.doesNotMatch(apiLayer, /正在生成开发信/, "开发信进入时不得暗示已自动调用 AI");
assert.match(apiLayer, /scenario: developmentEmailScenario,[\s\S]*goal: developmentEmailGoal,[\s\S]*requireAi/, "开发信 AI 请求必须携带场景、自然语言目标和明确生成开关");
assert.match(apiLayer, /developmentEmailScenario === "custom_goal" && !developmentEmailGoal/, "自然语言目标场景调用 AI 前必须校验目标");
assert.match(apiLayer, /activateNavView\("development-email", \(\) => void generateDevelopmentEmailDraftPage\(\)\)/, "进入开发信页面只能加载基础模板");
assert.match(apiLayer, /const raw = state\.user\?\.theme \|\| getStoredTheme\(\) \|\| THEME_DEFAULT;[\s\S]*return isThemeSupported\(raw\) \? raw : THEME_DEFAULT;/, "系统无已保存主题或主题不受支持时必须回落到 ECORE 深色主题");
assert.match(apiLayer, /templateStyle: ECORE_TEMPLATE_STYLE/, "ECORECRM 新建单据固定使用「默认模版」（定制 B 版式）");
assert.match(apiLayer, /document\.type === "PI" && document\.templateStyle === "longtec"/, "PI 必须支持 Longtec 专用模板预览");
assert.match(prototype, /id="docTemplateInput">[\s\S]*value="longtec"/u, "单据编辑器必须提供 Longtec 可选模板");
assert.match(prototype, /id="docThemeInput">[\s\S]*value="longtec"/u, "单据主题选择必须同步提供 Longtec");
assert.match(prototype, /id="documentDefaultTemplateStyle"><option value="rose">Rose<\/option>/u, "单据默认配置必须优先显示玫红主题");
assert.match(prototype, /id="documentSellerProfilesList"/u, "单据默认配置必须展示全部卖方公司档案");
assert.match(prototype, /id="documentSellerProfilesManage"/u, "管理员必须能从默认配置进入卖方公司管理");
assert.match(prototype, /id="docSellerProfileInput"/u, "单据编辑器必须允许人工切换卖方公司");
assert.match(prototype, /id="docBrandMarkTextInput"[^>]*maxlength="8"/u, "单据编辑器必须允许单据级配置左上色块文字");
assert.match(prototype, /id="documentDefaultBrandMarkText"[^>]*maxlength="8"/u, "团队单据默认配置必须支持色块文字");
assert.match(prototype, /id="docShippingCostInput"[^>]*type="number"/u, "单据编辑器必须提供可选的运费输入");
assert.match(apiLayer, /lineType: "shipping_cost"/, "填写运费后必须生成独立的 shipping_cost 明细");
assert.match(apiLayer, /items = items\.filter\(\(item\) => item\.lineType !== "shipping_cost"\)/, "运费明细不能重复出现在产品编辑行中");
assert.match(apiLayer, /function matchedSellerProfile[\s\S]*sellerProfileMatchScore/, "新建单据必须通过统一规则自动匹配卖方公司");
assert.match(apiLayer, /function renderSellerProfilesInDefaults/, "默认配置必须渲染卖方公司及其匹配规则");
assert.match(apiLayer, /letterheadId: qs<HTMLSelectElement>\("#docSellerProfileInput"\)/, "单据保存必须持久化人工选择的卖方公司");
assert.match(apiLayer, /applyDocumentCustomerDefaults[\s\S]*applyMatchedSellerToEditor/, "客户或商机变化后必须重新匹配卖方公司");
assert.match(apiLayer, /function applyFallbackSellerToEditor/, "人工切回或规则未命中时必须真正恢复兜底卖方资料");
assert.match(apiLayer, /brandMarkText: documentDefaultValue\("documentDefaultBrandMarkText"\)/, "团队色块文字必须通过默认配置 API 持久化");
assert.match(apiLayer, /brandMarkText: qs<HTMLInputElement>\("#docBrandMarkTextInput"\)/, "单据级色块文字必须随单据保存");

// 定制B（PI）：黑白制式模板。左上角 Logo 必须取卖方公司档案，模板里不许出现品牌素材或品牌名。
assert.match(apiLayer, /document\.type === "PI" && document\.templateStyle === "custom-b"/, "PI 必须支持「定制B」专用模板预览");
assert.match(
  apiLayer,
  /function renderCustomBPiPreview[\s\S]{0,1400}?letterhead \? \(letterhead\.logoUrl \|\| ""\) : \(document\.letterheadSnapshot\?\.logoUrl \|\| ""\)/,
  "定制B 的左上角 Logo 必须取所选卖方公司档案的 logoUrl（没选档案的老单据才用保存快照），不能写死在模板里"
);
assert.match(apiLayer, /function renderCustomBPiPreview[\s\S]{0,9000}?cb-logo-image/, "定制B 必须把 Logo 真正渲染在页头（参考 PI 在右上角）");
assert.doesNotMatch(apiLayer, /function renderCustomBPiPreview[\s\S]{0,9000}?ecore/i, "定制B 模板里不能残留参考件的品牌名");
assert.match(prototype, /id="docTemplateInput">(?:(?!<\/select>)[\s\S])*?<option value="custom-b">默认模版<\/option>/u, "单据编辑器只提供「默认模版」（定制B 版式）");
assert.match(prototype, /id="docThemeInput">(?:(?!<\/select>)[\s\S])*?<option value="custom-b">默认模版<\/option>/u, "主题选择只保留「默认模版」");
assert.match(prototype, /id="documentDefaultTemplateStyle">(?:(?!<\/select>)[\s\S])*?<option value="custom-b">定制B<\/option>/u, "团队单据默认配置必须能选「定制B」");
assert.match(prototype, /\.doc-paper\.custom-b-pi \{/u, "定制B 必须有独立纸张样式（去掉主题色顶边、A4 内距）");
assert.match(prototype, /\.custom-b-pi \.cb-logo-image \{[\s\S]{0,200}?object-fit: contain/u, "定制B 的 Logo 必须等比例缩放，不能拉伸变形");
assert.match(apiLayer, /DOC_PINNED_TEMPLATE_STYLES[\s\S]{0,200}?"custom-b"/, "主题色板切换不能覆盖定制模板的选择");
// 定制B（PI）必须逐块对上参考 PI（595×842pt，1pt = 1.334px）：坐标由参考件量取后写死。
assert.match(prototype, /\.doc-paper\.custom-b-pi \{[\s\S]{0,120}?padding: 54px 37px 60px/u, "定制B 必须按参考 PI 的页边距（28.34pt）排版");
assert.match(prototype, /\.custom-b-pi \.cbq-top \{[\s\S]{0,120}?justify-content: flex-end/u, "定制B 的 Logo 必须靠右上（参考 PI 的页头）");
assert.match(prototype, /\.custom-b-pi \.cbq-title \{[\s\S]{0,160}?font-size: 32px;[\s\S]{0,40}?font-weight: 400/u, "标题必须是参考件的 24pt 常规字重");
assert.match(prototype, /\.custom-b-pi \.cbq-party p:nth-child\(3\) \{ margin-top: 10\.5px; \}/u, "抬头必须是参考件的五行结构（Company/Address 松、Tell/E-mail/Attn 紧）");
assert.match(apiLayer, /partyRows[\s\S]{0,400}?T\("tell"\)/, "抬头必须输出 Tell 行（参考件有电话标签）");
assert.match(prototype, /\.custom-b-pi \.cbq-col-no \{ width: 10%; \}[\s\S]{0,300}?\.custom-b-pi \.cbq-col-amount \{ width: 15%; \}/u, "明细表列宽必须是参考件的 10/35/15/15/10/15");
assert.match(prototype, /\.custom-b-pi \.cbq-table th,[\s\S]{0,120}?border: 0 !important/u, "定制B 的明细表必须去掉竖线与外框，只保留横线");
assert.match(prototype, /\.custom-b-pi \.cbq-table th \{[\s\S]{0,160}?border-bottom: 1\.3px solid #000/u, "表头下必须只有一条 1pt 横线");
assert.match(prototype, /\.custom-b-pi \.cbq-table td \{[\s\S]{0,160}?border-bottom: 1px solid #000/u, "明细行下必须是 .75pt 细横线");
assert.doesNotMatch(prototype, /\.custom-b-pi \.cbq-table tbody tr:last-child/, "明细表末行不能再加粗线（参考件整表同一条 .75pt 线）");
assert.match(prototype, /\.custom-b-pi \.cbq-totals p:nth-child\(2\) \{[\s\S]{0,80}?border-bottom: 1px solid #000/u, "合计区第一条线在 TOTAL NO VAT 下方");
assert.match(prototype, /\.custom-b-pi \.cbq-totals p:nth-child\(3\) \{[\s\S]{0,120}?border-bottom: 1px solid #000/u, "合计区第二条线在 TOTAL USD 下方");
assert.match(prototype, /\.custom-b-pi \.cbq-terms-title \{ margin: 94px 0 0;[\s\S]{0,120}?border-bottom: 1px solid #000/u, "Terms 标题下的线必须整幅通栏（参考件跨到右边距）");
assert.match(apiLayer, /<h3 class="cbq-terms-title">[\s\S]{0,120}?<\/h3>\s*<section class="cbq-lower">/, "Terms 通栏线必须在左右两栏之外，不能被左列宽度截断");
assert.match(prototype, /\.custom-b-pi \.cbq-sign \{ width: 251px; margin-top: 122\.3px; \}/u, "签署块必须落在参考件右下角的位置");
assert.match(prototype, /\.custom-b-pi \.cbq-sign-for \{[\s\S]{0,200}?color: #241a7d;[\s\S]{0,120}?font-style: italic/u, "签署块必须是参考件的深紫衬线斜体");
assert.match(prototype, /\.custom-b-pi \.cbq-sign-rule \{[\s\S]{0,120}?border-top: 3px dotted #241a7d/u, "签署处必须有参考件的点状虚线");
assert.match(prototype, /\.custom-b-pi \.cbq-table th\.cbq-col-vat,[\s\S]{0,90}?display: none/u, "手机宽度必须收起恒为 No VAT 的列，否则六列会挤在一起");
assert.match(apiLayer, /function renderCustomBPiPreview[\s\S]{0,9000}?class="cbq-body"/, "定制B 必须是「左标题 + 右侧元信息」两列结构");
// 卖方公司的 Logo 调节器：两行（上下左右 / 缩小放大），且必须真的作用到定制B 的 PI / PO。
// 以前这两个模板完全忽略 logoPlacement，用户在「卖方公司」里怎么调都看不到变化。
assert.match(apiLayer, /data-placement-nudge-dir="\$\{prefix\}" data-nudge-x="0" data-nudge-y="-1"/, "Logo 调节器第一行必须有上移键");
assert.match(apiLayer, /data-placement-nudge-dir="\$\{prefix\}" data-nudge-x="1" data-nudge-y="0"/, "Logo 调节器第一行必须有右移键");
assert.match(apiLayer, /data-placement-zoom="\$\{prefix\}" data-zoom="-5"[\s\S]{0,400}?data-placement-zoom="\$\{prefix\}" data-zoom="5"/, "Logo 调节器第二行必须是缩小与放大");
assert.match(apiLayer, /function documentLogoPlacementStyle[\s\S]{0,700}?transform-origin:\$\{anchor\} top/, "HTML 模板的缩放锚点必须取模板自身的角（PI 右上 / PO 左上）");
assert.match(apiLayer, /if \(!value\.offsetX && !value\.offsetY && value\.scale === 100\) return "";/, "没调过 Logo 位置时不能输出 transform（默认版式必须与参考件一致）");
assert.match(apiLayer, /function renderCustomBPiPreview[\s\S]{0,2400}?documentLogoPlacementStyle\(documentLogoPlacementFor\([\s\S]{0,120}?"PI"\), "right"\)[\s\S]{0,4000}?class="cb-logo-image"[^>]*?\$\{logoStyle\}/, "定制B PI 必须把卖方公司里为 PI 调好的 Logo 位置贴到 Logo 上（锚点取右上）");
assert.match(apiLayer, /function renderCustomBPoPreview[\s\S]{0,2400}?documentLogoPlacementStyle\(documentLogoPlacementFor\([\s\S]{0,120}?"PO"\), "left"\)[\s\S]{0,4000}?class="cb-logo-image"[^>]*?\$\{logoStyle\}/, "定制B PO 必须把卖方公司里为 PO 调好的 Logo 位置贴到 Logo 上（锚点取左上）");
// 分模板记忆：同一张 Logo 在 PI / PO / 通用（Excel 导出）各存一套，互不覆盖
assert.match(apiLayer, /function documentLogoPlacementFor[\s\S]{0,620}?source\.logoPlacements\?\.\[key\] \|\| source\.logoPlacement/, "没单独调过的模板必须回落到通用值（不能让老档案突然丢掉已调好的位置）");
assert.match(apiLayer, /data-placement-tab-key="\$\{escapeHtml\(slot\.key\)\}"[\s\S]{0,200}?data-placement-tab-excel=/, "Logo 调节器必须按模板分页签");
assert.match(apiLayer, /\{ key: "custom-b:PI"[\s\S]{0,400}?\{ key: "custom-b:PO"[\s\S]{0,400}?\{ key: ""/, "页签必须包含定制B · PI、定制B · PO 与通用（Excel 导出）");
assert.match(apiLayer, /const persistDraft = \(\) => \{[\s\S]{0,220}?drafts\[currentKey\] = readDocumentAssetPlacement\(prefix\);/, "切模板前必须先把当前这套调节值存进草稿，否则来回切会丢");
assert.match(apiLayer, /function readDocumentLetterheadLogoPlacements[\s\S]{0,700}?logoPlacement: documentAssetPlacementValue\(map\[""\]\)/, "保存时必须把通用值单独取出来回传 logoPlacement");
assert.match(apiLayer, /logoUrl, \.\.\.readDocumentLetterheadLogoPlacements\("assetLetterhead"\)/, "保存卖方公司必须同时回传 logoPlacement 与分模板的 logoPlacements");
// 单据编辑里的一行式 Logo 调节器：挂在卖方公司档案下拉下，随预览同步，停手后静默存回档案
assert.match(prototype, /id="docSellerProfileInput"[\s\S]{0,1400}?class="doc-logo-inline" id="docLogoInline"/u, "一行式 Logo 调节器必须放在卖方公司档案下方（单据编辑表单里）");
assert.match(prototype, /id="docLogoInline"[^>]*hidden[\s\S]{0,600}?data-doc-logo-dir="0\|-1"[\s\S]{0,800}?data-doc-logo-zoom="-5"[\s\S]{0,400}?data-doc-logo-zoom="5"/u, "一行调节器默认隐藏，且必须带方向键与缩小/放大键");
assert.match(apiLayer, /function syncDocumentLogoInline[\s\S]{0,400}?if \(!active \|\| !letterhead\) \{\s*row\.hidden = true;\s*return;/, "调节器只对会消费该设置的模板出现（定制B 的 PI / PO），其余模板必须隐藏");
// renderDocumentPreview 现在拆成「壳 + 内容」两层：壳负责渲染后按预览栏宽度做等比缩放，
// 内容函数负责真正画纸面并在第一行同步调节器，所以断言要落到 renderDocumentPreviewContent 上。
assert.match(apiLayer, /function renderDocumentPreviewContent\(document: TradeDocument\) \{[\s\S]{0,220}?syncDocumentLogoInline\(document\);/, "调节器必须随预览刷新同步（预览画哪套值，调节器就显示哪套）");
assert.match(apiLayer, /letterhead\.logoPlacements = \{ \.\.\.\(letterhead\.logoPlacements \|\| \{\}\), \[key\]: value \}/, "行内调节必须按当前模板的键写入对应那一套，不能覆盖其他模板");
assert.match(apiLayer, /docLogoInlineSaveTimer = window\.setTimeout\([\s\S]{0,120}?saveDocumentLogoInline/, "行内调节必须停手后静默保存，不能只在内存里改");
assert.match(apiLayer, /async function saveDocumentLogoInline[\s\S]{0,900}?\/api\/document-assets\/letterheads[\s\S]{0,700}?logoPlacements: asset\.logoPlacements \|\| \{\}/, "静默保存必须把分模板 logoPlacements 一并回传给卖方公司档案");

// 定制B（PO）：采购订单版式。买方主体在页头（Logo / 公司名 / Ship to / Confirmed By），
// Vendor 才是供应商；Logo 仍然取公司档案，不写死在模板里。
assert.match(apiLayer, /document\.type === "PO" && document\.templateStyle === "custom-b"/, "PO 必须支持「定制B」专用模板预览");
assert.match(
  apiLayer,
  /function renderCustomBPoPreview[\s\S]{0,1500}?letterhead \? \(letterhead\.logoUrl \|\| ""\) : \(document\.letterheadSnapshot\?\.logoUrl \|\| ""\)/,
  "PO 定制B 的左上角 Logo 也必须取所选公司档案的 logoUrl，不能写死在模板里"
);
assert.match(apiLayer, /function renderCustomBPoPreview[\s\S]{0,12000}?cbp-parties/, "PO 定制B 必须有 Vendor / Ship to 两栏");
assert.match(apiLayer, /function renderCustomBPoPreview[\s\S]{0,12000}?Confirmed By:/, "PO 定制B 必须有 Confirmed By 签章区");
assert.match(apiLayer, /function renderCustomBPoPreview[\s\S]{0,12000}?STANDARD PURCHASE ORDER TERMS AND CONDITIONS/, "PO 定制B 必须带标准采购条款");
assert.doesNotMatch(apiLayer, /function renderCustomBPoPreview[\s\S]{0,12000}?ecore/i, "PO 定制B 模板里不能残留参考件的品牌名");
assert.match(prototype, /data-doc-type="PO"/u, "单据类型页签必须能切到 PO");
assert.match(apiLayer, /PO: "采购订单"/, "PO 必须登记中文单据名");
assert.match(prototype, /\.doc-paper\.custom-b-po \{/u, "PO 定制B 必须有独立纸张样式");
assert.match(prototype, /\.custom-b-po \.cbp-parties \{[\s\S]{0,200}?grid-template-columns: 1fr 1fr/u, "PO 的 Vendor / Ship to 必须是两栏等高");
assert.match(prototype, /\.custom-b-po \.cbp-table th \{[\s\S]{0,160}?background: #d9d9d9/u, "PO 表头必须是黑白模板的浅灰底");
assert.match(prototype, /\.custom-b-po \.cbp-head \{[\s\S]{0,160}?justify-content: space-between/u, "PO 页头必须是 Logo 与公司名左右分置");
assert.match(prototype, /\.custom-b-po \.cbp-sign \{[\s\S]{0,120}?grid-template-columns: 1fr 1fr/u, "PO 的 Confirmed By / For and on behalf of 必须是双栏签章区");
assert.match(prototype, /\.custom-b-po \.cbp-terms-table th:nth-child\(4\) \{ width: 31%; \}/u, "PO 条款表必须固定五列比例，否则 Payment Term 会把 Terms 挤没");
assert.doesNotMatch(prototype, /id="leadFinderLfindButton"[\s\S]*Lfind 深入查询/u, "『自动获客页必须提供 Lfind 深入查询入口』所属模块已从精简版移除");
assert.doesNotMatch(prototype, /id="leadFinderLfindInlineButton"[\s\S]*Lfind 深入查询/u, "『来源与执行设置中必须提供 Lfind 深入查询入口』所属模块已从精简版移除");

// ---------------------------------------------------------------------------
// 2026-11-12 试用反馈（《CRM试用》《CRM系统测试反馈及修改建议》）
//
// 这几条守的都是「表单和后端脱节」类问题：模板上有字段、表单没处填；
// 用户选了成交、后端写死未成交。改回去很容易，所以用断言钉住。
// ---------------------------------------------------------------------------
assert.match(apiLayer, /customerLifecycleInput/u, "客户完整表单必须有「成交状态」下拉，否则录入已成交客户只能落成未成交");
assert.match(apiLayer, /quickCustomerLifecycle/u, "客户快速新增表单也必须能选成交状态（它才是默认入口）");
assert.match(apiLayer, /lifecycleStatus: \(qs<HTMLSelectElement>\("#customerLifecycleInput"\)/u, "客户保存必须把成交状态提交给后端");
assert.match(apiLayer, /data-doc-field="description"/u, "商品明细必须用单一 Description 自由输入框");
assert.doesNotMatch(apiLayer, /data-doc-field="material"/u, "材质 / 后处理拆栏已合并进 Description，不应再出现");
assert.match(apiLayer, /docConditionInput/u, "单据表单必须有 Condition（产品状态）输入项");
assert.match(apiLayer, /docWarrantyInput/u, "单据表单必须有 Warranty（质保）输入项");
assert.match(apiLayer, /docLeadTimeInput/u, "单据表单必须有 Lead Time（交期）输入项");
assert.match(prototype, /id="docConditionInput"/u, "Condition 输入框必须真实存在于单据表单 DOM 里");
assert.match(prototype, /id="docWarrantyInput"/u, "Warranty 输入框必须真实存在于单据表单 DOM 里");
assert.match(prototype, /id="docLeadTimeInput"/u, "Lead Time 输入框必须真实存在于单据表单 DOM 里");
assert.match(prototype, /\.custom-b-po \.cbp-items-table th\.cbp-money \{ text-align: center; white-space: normal/u, "PO 表头长标题必须允许换行，否则 TOTAL AMOUNT (USD) 被裁掉");
assert.match(prototype, /label\[data-doc-size="description"\] \{[\s\S]{0,40}span 7/u, "Description 必须按宽栏排版，不能挤成窄条");
assert.match(apiLayer, /if \(!selected \|\| selected\.type !== newType\) \{[\s\S]{0,200}fillDocumentEditor\(defaultTradeDocument\(newType\)\)/u, "切到另一种单据必须重建空白表单，不能把上一份的数据带过去");
assert.match(apiLayer, /\/api\/lead-finder\/lfind-tasks/, "前端必须通过 Lfind 任务接口启动和轮询本地 Skill");
assert.match(apiLayer, /searchReport/, "搜客候选必须接收每行搜索报告");

// ---------------------------------------------------------------------------
// 知识库训练工作台（P1）
//
// 这组断言守的是**最容易静默失效的地方**：控件 id 必须 index.html 与 prototype-api.ts
// 两端都对得上（少一个就是「点了没反应」），以及前端调用的路由后端必须真的存在。
// ---------------------------------------------------------------------------
/**
 * 断言源码里存在**生效的**代码行 —— 注释里出现同名字符串不算数。
 *
 * 这条是踩出来的：第一版用 `apiLayer.includes("bindKbTrainingEvents();")` 断言，
 * 把调用整行注释掉后断言依然通过（注释里也有那串字符）。会红的自检才算自检。
 */
function kbHasLiveLine(source: string, matcher: (line: string) => boolean, message: string) {
  const hit = source.split("\n").some((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return false;
    return matcher(line);
  });
  assert.ok(hit, message);
}

/**
 * 取「某函数定义之后、下一个函数定义之前」的源码片段 —— 用于「这段逻辑必须落在这个函数里」的断言。
 *
 * 这条也是踩出来的：写「勾选后必须在 finally 里重读」时用的是
 * `toggleKbKnowledgeEnabled[\s\S]{0,1600}?finally \{…await loadKbKnowledgeBases…`，
 * 但同一文件后面还有两个函数也有 `finally` + 同样的调用，惰性匹配直接跳过去命中它们 ——
 * 把该函数里的那一行删掉，断言依然全绿。凡"必须在这个函数里"的判据都得先切出函数体。
 */
function kbSourceBetween(source: string, fromMarker: string, toMarker: string): string {
  const start = source.indexOf(fromMarker);
  if (start < 0) return "";
  const end = source.indexOf(toMarker, start + fromMarker.length);
  return source.slice(start, end < 0 ? source.length : end);
}

assert.doesNotMatch(prototype, /<div class="view" id="kb-training">/u, "『index.html 必须提供知识库训练视图容器』所属模块已从精简版移除");
assert.doesNotMatch(prototype, /data-view="kb-training"/u, "『知识库训练必须有导航入口』所属模块已从精简版移除");
// ⚠️ 真实事故（用户报「为什么所有界面都有知识库训练？？？」）：视图自带的 <style> 里
//    写成 `#kb-training { display:flex }`（权重 1,0,0），压掉了全局的
//    `.view { display:none }`（权重 0,1,0）→ 该视图不再受活动态约束，**每个页面都渲染**。
//    这类错误的通用形态是「以视图 id 为唯一主体、且体内写 display」，所以按视图清单逐个扫。
//    注意：判据必须跑在**剥掉注释**的副本上 —— 上面那段说明文字里就写着 `#kb-training { display:flex }`，
//    不剥注释的话断言会命中自己的注释（第一版就这么误报过一次）。
const prototypeNoComments = prototype.replace(/\/\*[\s\S]*?\*\//gu, "");
const kbViewIdList = [...prototype.matchAll(/<div class="view" id="([^"]+)"/gu)].map((match) => match[1]);
kbViewIdList.forEach((viewId) => {
  assert.doesNotMatch(
    prototypeNoComments,
    new RegExp(`#${viewId}\\s*\\{[^}]*display\\s*:`, "u"),
    `视图 #${viewId} 的样式不得直接写 display —— 会压掉 .view{display:none}，该视图会在所有页面渲染（布局态请写 #${viewId}.active）`
  );
});
assert.doesNotMatch(
  prototypeNoComments,
  /#kb-training\.active\s*\{[^}]*display:\s*flex/u,
  "知识库训练已从精简版移除，不应残留激活态样式"
);
// 来源描述：资料从哪来 / 谁给的口径，跟着候选出处一起显示。三个落点缺一不可 ——
// 少了输入框用户填不了；少了提交体填了也不生效；少了出处渲染生效了也看不见。
assert.doesNotMatch(prototype, /id="kbSourceNote"/u, "『屏 1 必须有「来源描述」输入框 #kbSourceNote』所属模块已从精简版移除");
assert.doesNotMatch(prototype, /data-kb-staged-note/u, "『暂存清单每行必须有「来源描述」输入框』所属模块已从精简版移除");
assert.doesNotMatch(apiLayer, /"kb-training": "知识库训练",/u, "知识库训练已从精简版移除，viewLabels 不得再注册");
assert.doesNotMatch(apiLayer, /"kb-training": "training\.read",/u, "知识库训练已移除，权限映射不应再含该视图");
assert.doesNotMatch(apiLayer, /shouldPreselect|KB_PRESELECT_CONFIDENCE/, "前端不得复制后端的预勾选规则（规则只在后端有一份）");
const kbTrainingIds = [
  "kbRefreshButton",
  "kbSourceTitle",
  "kbSourceAsset",
  "kbSourceBody",
  "kbSourceFile",
  "kbUploadButton",
  "kbStartRunButton",
  "kbTargetKnowledgeBase",
  "kbStagedList",
  "kbSourceHint",
  "kbRunList",
  "kbCandidateSummary",
  "kbCandidateStatusFilter",
  "kbCandidateKindFilter",
  "kbCandidateConfidenceFilter",
  "kbCandidateGapOnly",
  "kbCandidateList",
  "kbCandidateNotice",
  "kbCandidateSelectedCount",
  "kbReviewSelectedButton",
  "kbDropSelectedButton",
  "kbPublishButton",
  "kbProbeInput",
  "kbProbeButton",
  "kbProbeResult",
  "kbProbeOpenButton",
  "kbProbeModal",
  "kbProbeModalClose",
  "kbKnowledgeSummary",
  "kbKnowledgeList",
  "kbKnowledgeNotice",
  "kbKnowledgeSearch"
];
// 知识库训练已随精简版移除：这些控件不应再出现在 index.html
kbTrainingIds.forEach((id) => {
  assert.equal(prototype.includes(`id="${id}"`), false, `知识库训练已移除，不应残留控件 #${id}`);
});
// 试问验证必须是「按钮 → 弹窗」：弹窗复用全局 .modal-backdrop/.modal 语言
//（自造一套浮层会让关闭/遮罩/Esc 的行为与其它弹窗不一致），且打开即聚焦输入框。
assert.doesNotMatch(prototype, /class="modal-backdrop" id="kbProbeModal"/u, "『试问验证必须用全局弹窗语言（.modal-backdrop + #kbProbeModal）』所属模块已从精简版移除");
assert.doesNotMatch(prototype, /id="kbProbeModalClose"/u, "『试问弹窗关闭键』所属模块已从精简版移除");
// 指标条的 <small> 是「这格是什么」，不是「取值范围枚举」：
// 曾经写成「CLI / 模型 / 未生效」，于是引擎正常工作时也摆着一个「未生效」，
// 用户读到的结论是「我的引擎没生效」—— 真降级反而被这句话淹掉。
assert.doesNotMatch(prototype, /<small>[^<]*未生效[^<]*<\/small>/u, "指标条说明位不得把「未生效」写成静态取值：引擎正常时会被读成「当前未生效」，真降级反而看不出");

assert.doesNotMatch(
  apiLayer,
  /probe\.blocked|blocked\?:\s*boolean/u,
  "插件 resolve() 没有 blocked 字段：前端不得伪造（假字段只会让界面永远少显示一句真话）"
);
assert.doesNotMatch(
  apiLayer,
  /\.\.\.\(probe\.hits \|\| \[\]\),\s*\.\.\.\(probe\.citations/u,
  "hits 与 citations 是同一次检索的两种视图，相加会让同一条问答被列两遍、条数翻倍"
);


// 多份资料：一次训练要能带上好几份（后端 text.items 上限 50 条）。
assert.doesNotMatch(prototype, /id="kbSourceFile"[^>]*\bmultiple\b/u, "『本地文件读取必须支持多选（一次只训一份是真实摩擦）』所属模块已从精简版移除");
assert.doesNotMatch(
  apiLayer,
  /files:\s*\{ assetIds:/u,
  "前端不得把关联资料同时塞进 files.assetIds：那条路径会把资料自身的说明当成一份语料喂进去"
);



// ---------------------------------------------------------------------------
// 知识库：公开 / 私用 + 账号级「默认知识库」多选启用
//
// 这一组守三件**错了也不会报错、只会安静地不对**的事：
//  ① 勾选即启用 —— 一旦退回「勾完再点保存」，用户勾完就走，出稿没变化且无从察觉；
//  ② 保存成功 ≠ 生效 —— 插件没推成功时必须**常驻**提示（清单在 CRM 生效、运行端还没生效）；
//  ③ 别人的库改不动 —— 只渲染勾选框，不渲染「改名 / 切公开」按钮
//     （渲染出来点了报错，比压根不渲染更糟：用户会以为是自己没权限）。
// ---------------------------------------------------------------------------
assert.doesNotMatch(
  apiLayer,
  /data-kb-kb-save/u,
  "启用清单不得有「保存」按钮：勾选即启用，多一步就会有人勾完不点保存，然后以为生效了"
);
assert.doesNotMatch(
  apiLayer,
  /function setKbKnowledgeNotice[\s\S]{0,400}?setTimeout/u,
  "知识库提示必须常驻：清单没同步到插件时出稿仍按旧清单走，自动消失的提示等于没说"
);

assert.doesNotMatch(
  prototype,
  /animation: kbBarIndeterminate/u,
  "『不定长进度必须有扫光动画（否则是静止的 38% 色块）』所属模块已从精简版移除"
);
assert.doesNotMatch(prototype, /id="kbPipeline"/u, "『知识库训练必须有流水线步骤条（这一屏最容易迷路）』所属模块已从精简版移除");
assert.doesNotMatch(prototype, /id="kbEntriesModal"/u, "『知识库必须能展开查看已发布条目』所属模块已从精简版移除");
assert.doesNotMatch(prototype, /id="kbEntriesSearch"/u, "『知识库条目必须可搜索』所属模块已从精简版移除");

// 前后端路由对齐：前端调了而后端没有 = 上线即 404。后端目录不在时跳过（前端可单独跑）。
let kbBackendServer = "";
try {
  kbBackendServer = readBackendServerSources();
} catch {
  kbBackendServer = "";
}
if (kbBackendServer) {
  const kbRoutes: Array<[string, string]> = [
    ["post", "/api/kb/training/extract"],
    ["post", "/api/kb/training/runs"],
    ["get", "/api/kb/training/runs"],
    ["get", "/api/kb/training/runs/:id"],
    ["post", "/api/kb/training/runs/:id/cancel"],
    ["get", "/api/kb/training/candidates"],
    ["post", "/api/kb/training/candidates/review"],
    ["post", "/api/kb/training/candidates/publish"],
    ["post", "/api/kb/training/candidates/:id/revoke"],
    ["get", "/api/kb/training/knowledge-bases"],
    ["get", "/api/kb/training/knowledge-bases/:id/entries"],
    ["put", "/api/kb/training/knowledge-bases/defaults"],
    ["patch", "/api/kb/training/knowledge-bases/:id"],
    ["delete", "/api/kb/training/knowledge-bases/:id"],
    ["post", "/api/kb/training/probe"]
  ];
  kbRoutes.forEach(([method, path]) => {
    assert.ok(kbBackendServer.includes(`app.${method}("${path}"`), `后端缺少 ${method.toUpperCase()} ${path}`);
  });

  // 批次候选计数必须四态齐全：界面那行「待确认 / 已确认 / 已发布 / 已丢弃」按状态对齐，
  // 后端少给一态，界面对应的数字就恒为 0 —— 看起来像「还没确认过」，其实是没查。
  let kbRepoSource = "";
  try {
    kbRepoSource = readFileSync(new URL("../../backend/src/kb-training/kb-training-repository.ts", import.meta.url), "utf8");
  } catch {
    kbRepoSource = "";
  }
  if (kbRepoSource.includes("countCandidatesByRun")) {
    ["pending", "approved", "rejected", "published"].forEach((status) => {
      assert.ok(
        kbRepoSource.includes(`SUM(status = '${status}')`),
        `批次候选计数缺少 ${status} 一态（界面「已确认 / 已丢弃」这类数字会恒为 0）`
      );
    });
  }
}

// ── 邮件中心：已从精简版移除（视图 / 导航 / 页签 / 路由成套校验随之失效）──────
// 精简后保留的是「消息通知 inbox」，独立的邮件中心（收件箱/客户速查/交互旅程/工具箱）不再提供；
// 这里只守住「不要偷偷把入口带回来」，其余成套性判据随模块一起下线。
assert.equal(prototype.includes('id="mail-center"'), false, "邮件中心已从精简版移除，不应残留视图容器 #mail-center");
assert.equal(prototype.includes('data-view="mail-center"'), false, "邮件中心已从精简版移除，不应残留导航入口");

/* ------------------------------ 订单履约 ------------------------------ */
// ECORECRM 定制需求守护
assert.match(prototype, /\.sidebar \.nav button\.nav-secondary-button\[hidden\][\s\S]{0,120}?display: none !important/u, "无权限的侧栏入口（数据库维护 / 系统日志 / 系统设置）必须真的隐藏，不能被皮肤的 display:flex !important 盖掉");
assert.match(apiLayer, /const ECORE_DOC_TYPES: string\[\] = \["PI", "PO"\]/u, "ECORECRM 单据平台只保留 PI / PO");
assert.match(apiLayer, /\/api\/trade-documents\?all=1/u, "仪表盘的 PO 成交额与排行必须统计全部单据，而不是最近 9 份");
assert.match(prototype, /id="documentDeleteButton" data-permission="document\.manage"/u, "PI / PO 必须可以删除，且删除按钮受 document.manage 控制");
assert.ok(!prototype.includes('data-view="pipeline"'), "ECORECRM 已去掉商机入口");
assert.match(apiLayer, /const DASHBOARD_LIVE_REFRESH_MS = 30_000;/u, "仪表盘定时刷新只做兜底，30 秒一次（切回页面 / 获得焦点时会立即刷新）");
assert.doesNotMatch(prototype, /cp-badge-breathe [^;]*infinite/u, "设置页的提示徽标不能无限循环 box-shadow 动画（空闲时会持续重绘）");
assert.ok(/\.ord-badge\.t-(warn|info|accent|ok|done|muted)/u.test(prototype), "订单状态徽章样式不完整");
// display:flex 会压掉 [hidden]，空横幅会留一条空胶囊
assert.ok(prototype.includes(".ord-banner[hidden]"), "订单横幅缺少 [hidden] 兜底，没有缺单时也会留一条空条");
// 视图显隐只能由 .view.active 控制：任何以 #orders 为唯一主体的 display 规则都会压掉它
assert.ok(
  !/#orders\s*\{[^}]*display\s*:/u.test(prototype),
  "订单视图写了以 #orders 为主体的 display 规则，会覆盖 .view 的显隐"
);
// 弹窗读的是 /api/knowledge/assets（资料维护），按钮却叫「去文件中心」并跳到 knowledge，
// 而菜单里的「文件中心」是另一套 files 台账 —— 名字撞车，用户点了只会更困惑。
assert.ok(
  !apiLayer.includes("data-ord-goto-knowledge>去文件中心"),
  "订单文件弹窗还把资料维护叫「文件中心」：菜单里另有同名页面，用户会以为跳错地方"
);
assert.ok(
  !/class="od-grid"/u.test(apiLayer) && !/class="od-stats"/u.test(apiLayer),
  "订单详情还在用两栏长页版式（od-grid / od-stats），旧版式已由页签取代"
);


const orderServer = (() => {
  try {
    return readBackendServerSources();
  } catch {
    return "";
  }
})();
const orderService = (() => {
  try {
    return readFileSync(new URL("../../backend/src/order-service.ts", import.meta.url), "utf8");
  } catch {
    return "";
  }
})();
const iamService = (() => {
  try {
    return readFileSync(new URL("../../backend/src/iam/iam-management-service.ts", import.meta.url), "utf8");
  } catch {
    return "";
  }
})();
const deriveSource = (() => {
  try {
    return readFileSync(new URL("../../backend/src/file-derive.ts", import.meta.url), "utf8");
  } catch {
    return "";
  }
})();
const storageSource = (() => {
  try {
    return readFileSync(new URL("../../backend/src/file-storage.ts", import.meta.url), "utf8");
  } catch {
    return "";
  }
})();

// ---- 文件中心（M1–M6）----
// 视图显隐靠 .view.active。视图自带的 <style> 一旦写「以视图 id 为唯一主体」的 display，
// ID 权重会压掉 .view → 每页都渲染（2026-10-16 事故）。这条必须在。
assert.ok(
  !/#file-center\s*\{[^}]*display\s*:/s.test(prototype),
  "文件中心样式直接用 #file-center 写 display：会压掉 .view 的显隐"
);
assert.equal(
  prototype.includes('class="view" id="file-center"') || prototype.includes('data-view="file-center"'),
  false,
  "文件中心已从精简版移除，不应残留视图容器或侧栏入口"
);
assert.equal(
  apiLayer.includes('"file-center": "文件中心"'),
  false,
  "文件中心已从精简版移除，VIEW_TITLES 不应再注册"
);
// 全局 table{min-width:900px}：放进窄栏的自建表格必须显式 min-width:0，
// 否则 width:100% + table-layout:fixed 全失效，右侧列被 overflow:hidden 裁掉
assert.doesNotMatch(
  prototype,
  /#file-center table\.fc-table \{[^}]*min-width:0/su,
  "『文件中心表格必须覆盖全局 table min-width』所属模块已从精简版移除"
);
// 审计表列的含义和台账不同（首列是占位而非勾选），共用列宽会把「文件」压成 84px 只显示 id
assert.doesNotMatch(
  prototype,
  /#file-center table\.fc-audit th:nth-child\(5\)/u,
  "『审计表必须独立列宽』所属模块已从精简版移除"
);
// .fc-bulk 是 display:flex，会压掉 [hidden] 的 display:none → 未选中时留一条空横幅
assert.doesNotMatch(
  prototype,
  /#file-center \.fc-bulk\[hidden\] \{ display:none; \}/u,
  "『批量条必须有 [hidden] 兜底』所属模块已从精简版移除"
);
// 审计日志表只有 file_id，接口不回填文件名，列表就只能显示一串 id
assert.ok(
  orderServer.includes('fileName: log.fileId ? names.get(log.fileId)'),
  "审计接口没有回填文件名"
);
// 文本响应不带 charset 时，Chrome 按本地编码解码 → 中文 txt/csv 预览整篇乱码
assert.ok(
  orderServer.includes('baseType.startsWith("text/")') && orderServer.includes("charset=utf-8"),
  "文本预览响应没有声明 charset=utf-8：中文 txt/csv 会整篇乱码"
);
// text/csv 在 iframe 里会被 Chrome 直接触发下载，「预览」按钮变成下载文件
assert.ok(
  apiLayer.includes('contentType.startsWith("text/")') && apiLayer.includes("od-preview-text"),
  "文本类预览仍交给 iframe：Chrome 对 text/csv 会直接下载而不是显示"
);
// sips/soffice 的 stderr 是给开发者的（"Try 'sips --help'"），不能拼进用户可见文案
assert.ok(
  deriveSource.length > 2000 &&
    !deriveSource.includes("brew install --cask libreoffice") &&
    !deriveSource.includes("line.slice(0, 160)"),
  "派生失败文案把安装命令或外部工具 stderr 甩给了业务用户"
);
// 能力探测要把平台带出去，前端才有依据切换指引
assert.ok(
  deriveSource.includes("platform: process.platform"),
  "能力探测没有返回 platform，前端无法按服务器平台给安装指引"
);
// 跨平台部署资产：开源后最主流的两种装法是 Docker 和 Windows 便携部署
{
  const readRepoFile = (rel: string) => {
    try {
      return readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8");
    } catch {
      return "";
    }
  };
  // 只检查真实配置，不检查注释：注释里提一句「别用 macOS 的目录」不该触发断言
  const linuxFontconf = readRepoFile("deploy/fontconfig/fonts.linux.conf").replace(/<!--[\s\S]*?-->/gu, "");
  assert.ok(
    linuxFontconf.includes("/usr/share/fonts") && !linuxFontconf.includes("/System/Library/Fonts"),
    "Linux fontconfig 用了 macOS 的字体目录：容器里会被当成「系统没有字体」，中文全丢"
  );
  assert.ok(
    linuxFontconf.includes("Noto Serif CJK SC") && linuxFontconf.includes("微软雅黑"),
    "Linux fontconfig 缺字体名别名：docx 里写的「宋体/微软雅黑」在 Linux 上会退到无中文字形的字体"
  );

  const winInstall = readRepoFile("deploy/install-libreoffice.ps1");
  const findBody = winInstall.match(/function Find-Soffice[\s\S]*?\n}/)?.[0] || "";
  assert.ok(
    findBody.includes("soffice.com") && !findBody.includes("soffice.exe"),
    "Windows 安装脚本的探测没有只认 soffice.com：用 soffice.exe 会立刻返回 0，转换实际没完成"
  );
  assert.ok(
    winInstall.includes("/a") && winInstall.includes("TARGETDIR"),
    "Windows 安装脚本没有免管理员的解包路径：普通用户装不上就没法预览"
  );

  const dockerfile = readRepoFile("deploy/docker-compose/Dockerfile.backend");
  assert.ok(
    dockerfile.includes("libreoffice-writer") && dockerfile.includes("libreoffice-impress"),
    "后端镜像只装了 libreoffice-calc：docx/pptx 预览会全部转换失败"
  );
  assert.ok(
    dockerfile.includes("poppler-utils") && dockerfile.includes("deploy/fontconfig"),
    "后端镜像缺 pdftoppm 或 fontconfig：缩略图没有，中文也可能整段消失"
  );
}

// 文件中心自己不提供上传入口时，不属于任何订单的基础文档根本进不了文件池
assert.equal(
  prototype.includes('id="fcUploadButton"') || prototype.includes('id="fcUploadInput"'),
  false,
  "文件中心已从精简版移除，不应残留上传控件"
);

// LibreOffice 在 macOS 上默认看不见系统字体，中文会整段消失，而转换仍报「成功」
assert.ok(
  deriveSource.includes("export function fontConfigEnv") && deriveSource.includes("env: fontConfigEnv()"),
  "转换子进程没有注入 fontconfig：macOS 上会把中文转丢，只剩数字和英文"
);
// 缩略图：sips 不依赖 QuickLook 服务，必须排在 qlmanage 之前
{
  const thumbBody = deriveSource.match(/private async pdfThumb\([\s\S]*?\n  \}/)?.[0] || "";
  assert.ok(
    thumbBody.includes("caps.sips") && thumbBody.indexOf("caps.sips") < thumbBody.indexOf("caps.pdftoppm"),
    "PDF 缩略图没有优先用 sips：qlmanage 在后台服务里会 sandbox 初始化失败"
  );
}
// 按后缀硬转会失败：WPS 常把 OOXML 存成 .doc/.wps
assert.ok(
  deriveSource.includes("export function conversionExtension") && deriveSource.includes("if (!isZip) return fallback;"),
  "转换前没有按魔数纠正后缀：WPS 存出的 .doc/.wps 会解析失败"
);
// OLE2（97-2003 与 WPS 原生格式）不识别 → sniff 返回 null → 上传直接被 415 拒掉
assert.ok(
  storageSource.includes("0xd0 && buffer[1] === 0xcf") && storageSource.includes('wps: "application/x-wps"'),
  "文件类型探测不识别 OLE2：WPS/老版 Office 文件会被 415 拒绝"
);

// 工作台不再展示「管道健康度」：商机阶段口径归商机页，工作台只留漏斗 / 跟进队列 / 竞标日报。
// 删掉后海外竞标日报要吃掉整行（span 12），否则右半边会空出 5 列。
assert.ok(
  !prototype.includes("管道健康度") && !prototype.includes("dp-pipeline") && !apiLayer.includes("renderPipelineHealth"),
  "工作台「管道健康度」已下线，不要再挂回来（区块 DOM / CSS / 渲染函数三处都要保持为空）"
);
assert.ok(
  /#dashboard\.dashboard-v2 \.dp-tasks \{ grid-column: span 7; \}\s*\n\s*#dashboard\.dashboard-v2 \.dp-tender \{ grid-column: span 12; \}/.test(prototype)
    && !/#dashboard\.dashboard-v2 \.dp-tender \{ grid-column: span 7; \}/.test(prototype),
  "管道健康度下线后，海外竞标日报必须通栏（基础栅格 span 12），否则第二行右侧留白 5 列"
);

// 顶栏页签的选中态要点主题色：换肤时跟着 --brand 走，不能写死近黑。
assert.ok(
  /\.top-tab\.active \{[^}]*color: var\(--brand-strong\)[^}]*\}/.test(prototype)
    && /\.top-tab\.active::after \{[^}]*background: var\(--brand\)[^}]*\}/.test(prototype),
  "顶栏页签选中项没有主题色（文字 + 下划线都应取 --brand），换肤后仍是黑白"
);

// 顶栏「待办」：固定在右上动作区（站内信左侧），点一下直达待办中心，颜色跟主题色走。
{
  const actionsIdx = prototype.indexOf('<div class="top-actions">');
  const pillIdx = prototype.indexOf('id="topTodoPill"');
  const bellIdx = prototype.indexOf('id="notificationBellButton"');
  assert.ok(
    actionsIdx > -1 && pillIdx > actionsIdx && bellIdx > pillIdx,
    "顶栏待办入口不在站内信旁边：必须放在 .top-actions 里、通知铃之前，否则页签一变它就跟着漂"
  );
  assert.ok(
    apiLayer.includes('qs<HTMLButtonElement>("#topTodoPill")?.addEventListener("click", () => activateNavView("reminders"))'),
    '顶栏待办入口点了不跳转（应 activateNavView("reminders") —— 精简版把「待办中心」并入跟进提醒页）'
  );
  assert.ok(
    /\.top-pill \{[^}]*background: var\(--brand-tint\)/.test(prototype)
      && /\.top-pill b \{[^}]*background: var\(--brand\)/.test(prototype),
    "顶栏待办按钮没用主题色（底色与计数都应取 --brand 系）"
  );
}

// 顶栏账号头像：浅色半透明品牌色，换肤自动跟随；禁止再写死渐变（绿/紫都不行）。
assert.ok(
  /\.avatar \{[^}]*background: color-mix\(in srgb, var\(--brand\) 12%, transparent\)/s.test(prototype)
    && /\.avatar \{[^}]*color: var\(--brand-strong\)/s.test(prototype),
  "顶栏头像不是半透明品牌色（底色 color-mix 12% + 文字 --brand-strong），换肤后会跟主题脱节"
);
assert.ok(
  !/\.avatar \{[^}]*background: linear-gradient/s.test(prototype),
  "顶栏头像不能再用写死的渐变，换肤时不会跟随主题"
);


// 单据 PDF 导出：一页报价单曾经 10MB，且「显示一张、打印两张」。
// ① jsPDF 的 addImage 不传压缩级别时默认 image_compression.NONE，整页位图按原始 RGB 写进 PDF
//    （1588×2246×3 ≈ 10.7MB）；
// ② A4 在 794px 宽下正好 1122.9px，元素高度取整成 1123px → 297.02mm，比 297mm 多 0.02mm，
//    `while (heightLeft > 0)` 必然再吐一张空白页。
// ③ 8 种单据（PI/CI/报关/装箱单/合同/报价/原产地证/装运通知）共用同一条导出链路，
//    所以压缩不能只保证报价单：整份源码只允许一个 addImage 出口，且必须带压缩级别常量。
{
  const start = apiLayer.indexOf("async function downloadDocumentPdf(");
  const end = apiLayer.indexOf("function parseNumberCell(", start);
  const body = start > -1 && end > start ? apiLayer.slice(start, end) : "";
  // 注释行里也会出现被禁的写法（解释"老坑"时引用了旧代码），断言只对去注释后的真实代码生效
  const code = body.replace(/^\s*\/\/.*$/gm, "");
  assert.ok(body.length > 0, "找不到 downloadDocumentPdf 的代码，PDF 导出逻辑被挪走了，请同步本断言");
  const addImageCalls = (code.match(/\.addImage\(/g) || []).length;
  assert.ok(addImageCalls === 0, "downloadDocumentPdf 必须通过 addDocumentPdfPage 贴图，不要在函数里直接写 addImage");
  assert.ok(
    !/while\s*\(\s*heightLeft\s*>\s*0\s*\)/.test(code),
    "PDF 分页不能再写 while (heightLeft > 0)：像素取整后必然多出零点几毫米，会多打印一张空白纸"
  );
  assert.ok(
    /const\s+ONE_PAGE_TOLERANCE\s*=/.test(code) && /imgH\s*<=\s*pageH\s*\*\s*ONE_PAGE_TOLERANCE/.test(code),
    "PDF 导出缺少「一页容差」：接近 A4 高度的单据必须压回一页，不能甩出几乎空白的第二页"
  );

  // 全文件只允许一个 addImage 出口，且压缩级别来自常量。新增单据类型若另起一条位图导出，
  // 这里立刻变红 —— 这正是「报价单压了、PI/CI/装箱单又变 10MB」的防线。
  const allCode = apiLayer.replace(/^\s*\/\/.*$/gm, "");
  assert.equal((allCode.match(/\.addImage\(/g) || []).length, 1,
    "整份源码只允许一个 addImage 出口（addDocumentPdfPage），否则新单据类型可能绕开压缩");
  assert.ok(
    /const\s+DOCUMENT_PDF_IMAGE_COMPRESSION\s*=\s*"FAST"/.test(allCode),
    "PDF 位图压缩级别必须是常量 DOCUMENT_PDF_IMAGE_COMPRESSION = \"FAST\"（Flate 无损，约 1/45 体积）"
  );
  assert.ok(
    /function\s+addDocumentPdfPage\([\s\S]{0,700}?\.addImage\([\s\S]{0,200}?DOCUMENT_PDF_IMAGE_COMPRESSION\s*\)/.test(allCode),
    "addDocumentPdfPage 必须把 DOCUMENT_PDF_IMAGE_COMPRESSION 作为 addImage 的第 8 个参数传进去"
  );
  assert.ok(
    (code.match(/addDocumentPdfPage\(/g) || []).length >= 3,
    "单页 / 多页首屏 / 多页续页三条分支都必须走 addDocumentPdfPage"
  );

  // 所有单据类型共用一个导出函数，不允许按 type 分流到别的 PDF 实现。
  const exportStart = apiLayer.indexOf("async function exportTradeDocumentPdfInner(");
  const exportEnd = apiLayer.indexOf("function printDocumentPreview(", exportStart);
  const exportCode = exportStart > -1 ? apiLayer.slice(exportStart, exportEnd > exportStart ? exportEnd : exportStart + 4000) : "";
  assert.ok(/await\s+downloadDocumentPdf\(/.test(exportCode),
    "单据导出必须统一调用 downloadDocumentPdf，不能按单据类型分流");
  const unionLine = (apiLayer.match(/type:\s*("PI"[^;]*);/) || [])[1] || "";
  ["PI", "CI", "PO", "CUSTOMS", "PL", "CONTRACT", "QUOTATION", "COO", "SHIPPING"].forEach((type) => {
    assert.ok(unionLine.includes(`"${type}"`), `单据类型 ${type} 必须留在 TradeDocumentType 里，共用同一条导出链路`);
  });
}

// 报价单默认付款条款：全款预付。曾经写死成 30% 定金 + 发货前付清，
// 每次新建报价单都要手改，客户看到也会以为要压款。
{
  const start = apiLayer.indexOf('...(type === "QUOTATION" ? {');
  const body = start > -1 ? apiLayer.slice(start, start + 600) : "";
  assert.ok(body.length > 0, "找不到报价单默认值（defaultTradeDocument 里的 QUOTATION 分支），请同步本断言");
  assert.ok(
    /paymentTerm:\s*"T\/T 100% in advance"/.test(body),
    "报价单默认付款条款必须是 T/T 100% in advance"
  );
  assert.ok(
    !/30%\s*deposit/.test(body),
    "报价单默认付款条款不能再带 30% 定金：报价阶段写分期会让客户以为要压款"
  );
}

// CLI 获客（搜客雷达）已从精简版移除：视图、角色筛选开关与调用链一并不再提供。
// 这里只守住「不要偷偷把入口带回来」；准入判定本身在后端，随模块一起下线。
assert.equal(
  prototype.includes('id="prospectBuyerOnlyToggle"'),
  false,
  "搜客雷达已从精简版移除，不应残留「只看决策人/采购人邮箱」开关"
);

// 供应商管理（仿「客户管理」：列表 + 筛选 + 分页 + 详情抽屉 + 新增/编辑/删除）
{
  assert.ok(/data-view="suppliers"/.test(prototype), "侧栏必须有「供应商管理」入口，否则视图进不去");
  assert.ok(
    /<details class="nav-section" aria-label="供应商管理"[\s\S]{0,700}data-view="suppliers"/.test(prototype),
    "供应商必须是侧栏的独立分栏，不能塞在「客户管理」下面当一个二级按钮"
  );
  assert.ok(
    /<div class="view" id="suppliers">[\s\S]{0,1200}customer-filter-row customer-view-filter[\s\S]{0,900}customer-list-workspace/.test(prototype),
    "供应商列表要复用客户管理的骨架（筛选行 + 列表工作区），另起一套样式就和客户管理长得不一样了"
  );
  assert.ok(/<div class="view" id="suppliers">/.test(prototype), "供应商视图容器必须存在");
  assert.ok(
    prototype.includes('id="suppliersTableBody"') && prototype.includes('id="supplierDrawer"'),
    "供应商列表与详情抽屉的挂载点必须存在"
  );
  assert.ok(
    /suppliers:\s*"supplier\.read"/.test(apiLayer),
    "供应商视图必须挂 supplier.read 权限，不能裸奔给所有账号"
  );
  assert.ok(
    /async function loadSuppliers[\s\S]{0,200}?api<\{ suppliers: Supplier\[\] \}>\("\/api\/suppliers"\)/.test(apiLayer),
    "供应商列表必须来自 /api/suppliers，不能在本地造假数据"
  );
  assert.ok(
    /async function saveSupplier[\s\S]{0,2600}?\/api\/suppliers/.test(apiLayer),
    "保存供应商必须走后端接口（新增 POST / 编辑 PATCH），不能只改内存"
  );
  assert.ok(
    apiLayer.includes('"/api/suppliers/bulk-delete"'),
    "删除供应商务必走确认后的批量删除接口（单条与多条同一条链路）"
  );
  assert.ok(
    /if \(view !== "suppliers"\) closeSupplierDrawer\(\)/.test(apiLayer),
    "离开供应商页必须收起详情抽屉，否则回到该页会自己弹开"
  );
  assert.ok(
    /"supplier-editor-modal"/.test(apiLayer) && /supplier-editor-modal/.test(prototype),
    "供应商编辑弹窗的专属宽度类必须在两处都声明，否则字段会被 520px 的基础弹窗挤成一团"
  );
  assert.ok(
    /function renderSupplierBulkToolbar[\s\S]{0,900}?data-supplier-bulk-delete/.test(apiLayer),
    "供应商列表要有和客户管理同一条批量工具条（全选 / 已选计数 / 批量删除 / 导出）"
  );
  assert.ok(
    /function exportSuppliers[\s\S]{0,1600}?text\/csv/.test(apiLayer),
    "批量导出必须真出文件（CSV + BOM），不能挂一个没实现的按钮"
  );
  assert.ok(
    /function syncSupplierStatusNav\(\)[\s\S]{0,700}?\[data-view="suppliers"\]/.test(apiLayer),
    "侧栏「全部/合作中/考察中/已停用」与页内状态筛选必须共享同一份状态，否则两边会各说各话"
  );
  assert.ok(
    /setButtonPending\(saveButton, true/.test(apiLayer),
    "保存供应商要有防重复提交（按钮进入 pending），否则连点会重复建档"
  );
  // —— 颜值对齐：结构抄对了但皮肤没抄，是供应商列表比客户列表「廉价」的真正原因 ——
  assert.ok(
    /#suppliers \.table-wrap \{[^}]*border-radius: 14px[^}]*box-shadow/.test(prototype)
      && /#suppliers \.panel\.section \{ padding: 18px; \}/.test(prototype)
      && /#suppliers tbody tr \{ height: 73px/.test(prototype),
    "供应商表格必须套用客户管理那套皮肤（18px 内边距 / 14px 圆角 + 投影 / 73px 行高），只继承全局 table 样式会比客户表矮一档"
  );
  assert.ok(
    /#suppliers table \{ min-width: 0; table-layout: fixed; \}/.test(prototype),
    "供应商表格要放开全局 min-width:900px 并改固定布局，否则 9 列按内容撑开后「操作」会被顶出可视区"
  );
  assert.ok(
    /<th>供应商名称<\/th><th>供应品类<\/th><th>供应等级<\/th><th>保护期<\/th><th>联系方式<\/th>/.test(prototype),
    "供应商表格必须是 9 列（供应等级与保护期各占一列）：分级与状态合并成「供应等级」，多一列会把名称列压到 241px"
  );
  assert.match(apiLayer, /function supplierProtectionExempt[\s\S]{0,200}?公池/u, "供应商保护期必须对已成交和公池停止计时");
  assert.ok(
    /function supplierGradeChip[\s\S]{0,600}?customer-grade customer-grade-/.test(apiLayer),
    "供应分级必须复用客户管理「客户价值」的字母方块（customer-grade），用 badge 会变成一颗横躺的大药丸"
  );
  // 正则不跨函数体扫：先切出 supplierContactCell 的函数体，再在体内断言两行结构
  const supplierContactBody = (() => {
    const start = apiLayer.indexOf("function supplierContactCell");
    if (start < 0) return "";
    const end = apiLayer.indexOf("function supplierUpdatedCell", start);
    return apiLayer.slice(start, end > start ? end : start + 2000);
  })();
  assert.ok(
    /sup-contact-primary/.test(supplierContactBody) && /sup-contact-secondary/.test(supplierContactBody),
    "联系方式必须拆成固定两行（邮箱 / 电话·官网），一串链接用 · 连接会在窄列折成三行、行高参差"
  );
  assert.ok(
    /#suppliers \.customer-mobile-meta \{ display: flex/.test(prototype),
    "供应商移动卡片的元信息 chip 样式要单独声明：#customers 作用域里的那批选择器管不到供应商"
  );
  assert.ok(
    !/sup-mobile-meta|sup-badge-cell/.test(prototype + apiLayer),
    "旧的供应商专用小类（sup-mobile-meta / sup-badge-cell）已并入客户管理同款，不能残留"
  );

  // —— 供应商编码：按需求从界面彻底移除（后端仍自动生成，只用于团队内唯一约束）——
  assert.ok(
    /interface Supplier \{[\s\S]{0,300}?code: string;/.test(apiLayer),
    "前端 Supplier 类型保留 code：后端仍生成，只是界面不再展示"
  );
  assert.ok(
    !/id="supplierCodeInput"/.test(apiLayer) && !/供应商编码/.test(apiLayer),
    "供应商弹窗 / 列表 / 抽屉 / 导出都不能再出现供应商编码"
  );

  // —— 供应商文件：走文件中心的 file_references，不另造一套附件表 ——
  assert.ok(
    /id="supplierFileList"/.test(apiLayer) && /id="supplierFileUploadButton"/.test(apiLayer),
    "供应商抽屉必须有文件列表与上传入口"
  );
  assert.ok(
    /\/api\/files\?entityType=supplier&entityId=/.test(apiLayer),
    "供应商文件必须按 file_references 查询，不能另造一套附件存储"
  );
  assert.ok(
    /contextType=supplier&contextId=/.test(apiLayer) && /contextType: "supplier"/.test(apiLayer),
    "上传必须带 contextType=supplier：直传与分片两条路都要，漏一条大文件就传不进去"
  );
  assert.ok(
    /\/recycle`,/.test(apiLayer) && /reason: "供应商附件移除"/.test(apiLayer),
    "移除附件必须走回收站（可恢复），不能物理删除"
  );
  assert.ok(
    /#supplierDrawer \.sup-file-row \{ display: grid/.test(prototype),
    "抽屉里的文件行要有自己的布局样式，否则文件名与三个按钮会挤成一行"
  );
  assert.ok(
    /#supplierDrawer \.sup-file-ops \{ grid-column: 1 \/ -1;/.test(prototype),
    "手机抽屉必须把文件操作按钮换到第二行，否则 420px 下文件名只剩几个字"
  );
}

// ---- 自动流：必须是真实链路，不许退回计时器动画（2026-11-03） ----
assert.equal(apiLayer.includes("autoFlowStartTicking"), false, "自动流不得残留旧的计时器模拟引擎");
assert.match(apiLayer, /gj\.autoflow\.v2/u, "自动流状态键升到 v2，避免读到旧版预演状态");
assert.match(apiLayer, /id="customerCompanyHint"/u, "新增客户弹窗必须在公司名下方留出撞单提示位");
assert.match(apiLayer, /status === 409[\s\S]{0,420}markCustomerCompanyInvalid\(\)/u, "同名客户被同事占用时，必须把归属人提示贴到公司名旁并聚焦输入框，而不是只弹 toast");
assert.match(apiLayer, /function markCustomerCompanyInvalid[\s\S]{0,400}setProperty\("border-color"/u, "撞单描边要用内联 important，普通类选择器压不住主题层的输入框边框规则");
assert.match(apiLayer, /throw Object\.assign\(new Error\(body\.message \|\| "请求失败"\), \{\s*status: response\.status,/u, "api 错误必须带 status，调用方才能区分撞单 409 与普通失败");

// 只报 required.length 会严重低估覆盖量（69 条必存 token 之外还有几百条正则契约），
// 这里顺带把本文件的断言条数一起报出来，便于和上一版对比是涨了还是掉了。
const selfSource = readFileSync(new URL("./self-test.ts", import.meta.url), "utf8");
const assertionCount = (selfSource.match(/^assert\./gmu) || []).length;
console.log(JSON.stringify({ ok: true, requiredTokens: required.length, assertions: assertionCount }, null, 2));
