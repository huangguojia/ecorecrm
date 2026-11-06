# ECORECRM 全功能与使用体验测试报告

- 日期：2026-11-06
- 范围：本地运行版（前端 Vite 5189 / 后端 4290，MySQL `ecore_crm`），对应 `main` 分支本轮代码
- 方法：后端 GET 全量探测 + 空 body 写探测、18 视图 Playwright 扫描、多分辨率布局实测、
  角色隔离接口实测、单据全链路（建单 → 校验 → 保存 → 导出 PDF）、前后端 `tsc` + `self-test`

## 一、测试结论总览

| 项 | 结果 |
| --- | --- |
| 后端 GET 探测（219 个） | 无未捕获 500；仅数据库迁移类 4 个 503（部署开关未启用，属预期） |
| 空 body 写探测（413 个） | 缺失资源类端点已全部由 500 修正为 404 |
| 18 视图扫描 | 0 个 pageerror / console error / 失败请求 |
| 多分辨率（1920/1440/1280/1024/768/390） | 无页面级横向溢出，21 个导航入口齐全 |
| 角色隔离 | admin 全通；super_admin 在 IAM 模式下按设计 403；sales 仅见自己名下数据 |
| 单据全链路 | 空品名保存被拦 → 填充保存 → 导出 PDF（约 150KB，A4 两页）成功 |
| 回归 | 前后端 `tsc` 0 错误；前端 self-test 326 条断言全绿；后端自测全过 |

## 二、本轮修复

### P0/P1（功能与数据正确性）
1. **单据预览等比缩放**（`frontend/src/prototype-api.ts`）
   - 纸面按 A4（794px）设计，预览栏更窄时原来被 `max-width:100%` 直接压窄，
     列宽被挤、地址断成三四字母一行。
   - 现在 `fitDocumentPreview()` 按「可用宽度 / (794+28)」等比缩放整张纸（含主题层
     `margin:14px` 的外边距），比例恒定；用 ResizeObserver 观察 `.doc-preview-shell`
     （静态节点），视图从隐藏变可见、侧栏折叠、窗口缩放都会重新适配。
   - 实测：1920 → zoom 1；1680 → 0.97；1600 → 0.93；1024 → 0.88；430 手机 → 0.46，
     全宽度零横向溢出；1440 及以下表格单元格从 43px 恢复到 72px，无三行折词。
2. **客户建档时间被 persist 刷新**（`backend/src/mysql-store.ts`、`types.ts`、
   `routes/customers.ts`、`prospect-customer-conversion.ts`、`data.ts`）
   - 根因：`customers` 整表 DELETE+INSERT 回写不含 `created_at`，MySQL 的
     `DEFAULT CURRENT_TIMESTAMP` 每次保存把所有客户建档时间刷成保存时刻，
     「最近新增」排序失真。
   - 修复：`Customer` 增加 `createdAt`，加载时带回、回写时写回原值；两条创建路径
     （手工新增、智能获客转化）与种子数据都补上建档时间。
   - 验证：触发 persist 后全部客户 `created_at` 保持不变。
3. **三套单据模板白底上浅灰字**（`frontend/index.html`）
   - `longtec-pi` / `custom-b-pi` / `custom-b-po` 原按深色纸面（`#131313` 底 + `#ccc` 字）
     设计，主题层强制白纸后对比度只剩约 1.6:1，客户/地址/日期几乎看不见。
   - 统一改为白纸 + 中灰次级文字（约 5.4:1），`longtec-pi` 表格单元格同步改白底。

### P2（使用体验）
4. **右侧预览区一片黑**（`frontend/index.html`）
   - 主题层把 `.doc-preview-shell` 写死 `#0d0d0d`，比全站任何面板都黑，看起来像坏了。
     改为与其他面板一致的 `#111111`，白纸浮在上面的观感正常。
5. **手机端导航占满首屏**（`frontend/index.html` 主题块末尾新增 `max-width:760px` 覆盖）
   - 皮肤层 `.nav { display:flex !important; flex-direction:column }` 压过了 ≤760 的横向
     规则，手机上导航竖排 687px，内容被推到折叠线以下。
   - 现改为：导航压成一条横向滑动条（分组标题在上、子项横向一排），装饰性 logo 与
     公司信息块收起，侧栏从 687px 降到 118px。
6. **手机端客户/供应商页横向溢出**（390px 时整页被拖到 448px）
   - 页头按钮 `min-width:96px` 且不换行导致；改为可换行、按比例收缩，页面恢复 390px。
7. **手机端顶栏按钮文字竖排折行**：「新增客户」被挤成两行；顶栏允许换行、按钮文字
   强制单行。
8. **死代码清理**：`/api/products` 权限守卫下从未注册过任何路由，删除。

### 其他核对（非缺陷）
- `GET /api/logs` 404：前后端均无该路径引用，系统日志页实际走别的接口，页面数据正常。
- `logs` 视图的 `lg-drawer` 右溢出：抽屉式详情面板本身停在屏外，属实现方式，无页面滚动。
- 幂等/日志类接口空 body 返回 200（`todos/archive-due`、`tools/logs`、`reminders` 等）：
  语义为批处理或追加记录，可接受；`tools/shipments` 已加最小锚点校验。
- `lead-finder/free-search` 空 body 长耗时：属外部数据源抓取，非本机缺陷。

## 三、遗留与建议
- 存量客户的 `created_at` 已被历史 persist 刷成同一时刻，无法还原真实建档时间；
  修复后不再恶化。
- 导出 PDF 时控制台有 Google Fonts 跨域 CSS 警告（html-to-image 无法内联），
  不影响产物；如需消除可自托管字体。
- 手机端顶栏换行后纵向占用略多（待办/新增/铃铛各一行），后续可合并为一行图标条。
