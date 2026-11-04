# GoodJob CRM 文件存储层开发方案 v2（产品级 / 高级商用版）

> 状态：v2，经两轮审核修订（产品级 62 → 88，工程级 71 → 90，评分与处置见附录 A）。待开工。
> 关系：`FILE-CENTER-DEVELOPMENT.md`（链接制）的升级方案；链接制能力在过渡期继续可用，最终收缩为「外链资料」类型（见 §8 兼容层）。
>
> ## 0. 已拍板决策
> 1. **可见性并集**：文件可见性 = 引用它的业务对象可见性之并集。
> 2. **不自动删**：归零引用进台账，人工判断；自动清除仅作回收站安全网，**默认关闭**。
> 3. **配额只统计不限制**，超阈值黄条提醒。
> 4. **本地目录 + StorageDriver 抽象**（S3 语义），不用 FUSE 挂载。
> 5. （v2 新增）**多租户预留**：所有表带 `tenant_id`、key 带租户段，当前恒 `default`，不是真隔离。
> 6. （v2 新增）**对外分享是商用必需能力**：限时链接 + 水印 + 访问记录，不等同于「把文件公开」。
> 7. （v2 新增）**HTTP 语义做全**：Range / HEAD / ETag 是预览能力的一部分，不是优化项。

## 1. 产品定位与商用验收标准

文件层不是「附件柜」，是**单证资产的流转中枢**：传得进、看得见、发得出、追得到、删得掉、搬得走。

上线验收（全部可实测，缺一不算完成）：

| # | 场景 | 达标线 |
|---|---|---|
| 1 | 销售把一份 PI 发给客户 | ≤3 次点击生成限时链接，带水印，事后能查到谁在何时打开 |
| 2 | 展会上手机拍 60MB 扫描件、网络抖动 | 分片续传成功，不产生重复文件 |
| 3 | 打开 80MB PDF 单证 | 首屏 ≤2s，可翻页（Range 生效），不整包下载 |
| 4 | 客户要「这一单的全部单据」 | 一键 zip 或合并为单份 PDF，文件名规范 |
| 5 | 管理员处理 200 个孤儿文件 | 批量选择 + 批量回收/改归属，≤5 分钟完成 |
| 6 | 误删 | 30 天内可自助恢复；彻底删需理由与二次确认 |
| 7 | 员工离职 | 一键转移其文件归属，配额与台账同步 |
| 8 | 磁盘故障 | 按 RPO ≤1h / RTO ≤4h 恢复，季度演练留痕 |

## 2. 总体架构

```
浏览器（含移动端拍照）
   │  multipart / 分片上传 / Range 下载
   ▼
/api/files/*  ── requireAuth + CSRF + fileAccessGuard（唯一可见性收口）
   │            └─ /api/share/:token（公开入口，独立校验，不走登录）
   ├─ UploadSession（断点续传 + client_token 幂等）
   ├─ StorageDriver（唯一碰字节的地方：put/get/stat/remove/sign）
   ├─ DerivePipeline（持久化队列：串行转换 / 水印 / 合并 PDF / 缩略图）
   ├─ Metrics（计数器 + 队列深度 + 容量）
   └─ MySQL（files / derivatives / references / access_logs / share_links / upload_sessions / settings）
```

铁律不变：DB 不存绝对路径；字节只经 driver；可见性只有一个判定函数。

## 3. 数据模型

建表沿用 `backend/src/mysql-store.ts` 的 `CREATE TABLE IF NOT EXISTS` + `ensureColumn` 模式（`migrate-mysql.ts` 只是 CLI 壳），双档位 `db:migrate:dev` → `db:migrate:personal`。

```sql
files (
  id VARCHAR(64) PK, key VARCHAR(320), tenant_id VARCHAR(64) DEFAULT 'default',
  sha256 CHAR(64), size BIGINT, mime VARCHAR(120), original_name VARCHAR(255),
  driver_generation INT DEFAULT 1, client_token VARCHAR(64) NULL,   -- 幂等：唯一索引
  owner_id VARCHAR(64), team_id VARCHAR(64), quota_owner_id VARCHAR(64),
  visibility ENUM('inherit','private','team') DEFAULT 'inherit',
  tags_json JSON NULL, remark_json JSON NULL,                       -- 标签 / 原上传场景快照
  version_group_id VARCHAR(64), is_current TINYINT DEFAULT 1,
  review_status ENUM('none','draft','pending','approved','issued','void') DEFAULT 'none',
  legal_hold TINYINT DEFAULT 0, retain_until DATE NULL,             -- 合规：不可删 / 保留到某日
  derive_status ENUM('none','processing','ready','failed') DEFAULT 'none', derive_error VARCHAR(300),
  status ENUM('active','recycled') DEFAULT 'active',
  recycled_at DATETIME NULL, recycled_by VARCHAR(64), recycle_reason VARCHAR(40) DEFAULT '',
  row_version INT DEFAULT 0,
  created_by VARCHAR(64), created_at DATETIME, updated_at DATETIME,
  UNIQUE KEY uk_files_client_token (client_token),
  INDEX idx_files_owner (owner_id), INDEX idx_files_team (team_id),
  INDEX idx_files_sha (sha256), INDEX idx_files_status (status), INDEX idx_files_vgroup (version_group_id)
)

file_derivatives ( id PK, file_id, kind ENUM('thumb','pdf','text','watermarked'),
  key VARCHAR(320), status ENUM('processing','ready','failed'), error VARCHAR(300),
  created_at, INDEX(file_id), UNIQUE(file_id, kind) )

file_references ( id PK, file_id, entity_type ENUM('order','customer','lead','kb','mail'),
  entity_id VARCHAR(64), kind VARCHAR(30), pinned_file_id VARCHAR(64) NULL,
  created_by, created_at,
  UNIQUE KEY uk_ref (file_id, entity_type, entity_id, kind), INDEX(entity_type, entity_id) )

share_links ( id PK, token VARCHAR(64) UNIQUE, file_id, created_by, team_id,
  mode ENUM('preview','download'), password_hash VARCHAR(120) DEFAULT '',
  expires_at DATETIME, max_views INT DEFAULT 0, view_count INT DEFAULT 0,
  watermark_text VARCHAR(120) DEFAULT '', revoked_at DATETIME NULL, created_at,
  INDEX(file_id), INDEX(expires_at) )

upload_sessions ( id PK, client_token VARCHAR(64) UNIQUE, owner_id, team_id,
  original_name VARCHAR(255), size BIGINT, chunk_size INT, received_json JSON,
  status ENUM('open','completed','expired'), expires_at, created_at )

file_access_logs ( id BIGINT AUTO_INCREMENT PK, file_id, user_id DEFAULT '', action
  ENUM('preview','raw','zip','share_create','share_view','share_download'),
  ip VARCHAR(64), user_agent VARCHAR(200), request_id VARCHAR(64), at DATETIME,
  INDEX(file_id, at), INDEX(user_id, at), INDEX(action, at) )

storage_settings ( k VARCHAR(64) PK, v TEXT )
```

时间统一 UTC 存、前端本地化（避开 `mysqlDate(undefined)` 类坑）；`legal_hold=1` 或 `retain_until > today` 的文件，任何删除路径直接 409。

## 4. 权限模型（唯一收口）

```ts
// backend/src/file-storage.ts
fileAccessGuard(user, fileId, action: "preview"|"raw"|"zip"|"manage")
  → { ok: true, file, canManage, reasons } | { ok: false, code: 403|404|409 }
```

判定顺序：
1. 查 file；`status='recycled'` → 404（回收站仅 owner/admin 经台账接口可见）。
2. `private` → 仅 `user.id===owner_id` 或 admin；`team` → 同 team 或 admin。
3. `inherit` → 并集：一条 SQL 取出 references 对应的业务对象归属，批量过 `canSeeOwner`（`auth.ts:316`，已兼容 IAM `iamDataScope`）。**禁止逐条 N+1 查询**；结果按 `(user, file)` 缓存 30s，写操作清缓存。验收要求 EXPLAIN 走索引、10 个引用的文件判定 ≤30ms。
4. 通过 → 记 access_log（带 request_id）；本地流式代理，云端走 `sign()` 15 分钟。
5. 管理动作：`hasIamPermission(user,'file.manage'/'file.admin')`，照 `server.ts:1002` 的 `enforceIamTenantPermission` 登记。

**分享链接（新）**：创建需 `file.manage`；访问 `/api/share/:token` 不走登录，但必须校验 `revoked_at / expires_at / max_views / password`，且 `mode=preview` 时服务端只发水印派生或缩略图，**不返回原文件**。每次访问记 `share_view`，带 IP/UA。分享不改变文件可见性，撤销即失效。

## 5. API 契约

全部登记 `backend/src/agent-api-contracts.ts`；非 GET 过 CSRF；批量写接口（batch/settings）在 `authorizationFor` 单独判 `explicit_confirmation`；zod 校验；错误码 400/403/404/409/413/415/423(legal hold)/429/507。

| 端点 | 权限 | 说明 |
|---|---|---|
| `POST /api/files` | file.upload | ≤20MB 直传；带 `clientToken` 幂等；返回 meta 或 `duplicate_of` |
| `POST /api/files/uploads` + `PUT .../chunks/:i` + `POST .../complete` | file.upload | >20MB 分片（5MB/片，并发 3），`received_json` 位图续传，24h 过期 |
| `GET /api/files/:id/meta` | guard | meta + canManage + 派生状态 + 分享列表 |
| `GET /api/files/:id/preview` | guard | 有 pdf/thumb 给派生，否则降级 raw；支持 `Range`、`ETag`、`304` |
| `GET|HEAD /api/files/:id/raw` | guard | `Accept-Ranges: bytes`、`ETag=sha256[0:16]`、RFC5987 中文名、`X-Content-Type-Options: nosniff` |
| `POST /api/files/:id/recycle` / `restore` | manage | 条件更新 `WHERE status=...` 防并发竞态；reason 必填 |
| `DELETE /api/files/:id` | manage+owner/admin | 引用>0 → 409；legal_hold → 423；key 上还有其他行 → 只删行不删字节 |
| `POST /api/files/:id/versions` | manage | 同 version_group 新行；旧行 is_current=0（事务内） |
| `POST /api/files/merge` | guard(全部源文件) | `{orderId, fileIds[]}` → 临时合并 PDF（24h 过期，不入 files） |
| `POST /api/files/:id/share` / `DELETE /api/share/:id` / `GET /api/share/:token` | manage / 公开 | 见 §4 |
| `GET /api/files/search` | guard | 文件名/标签/类目/订单号，分页，服务端过滤 |
| `GET /api/files/ledger` | 自己的 / file.admin 全部 | 归零引用台账 + 回收站视图 |
| `POST /api/files/batch` | manage | 批量 recycle/restore/purge/改 owner/打标签，单批 ≤50，逐条返回结果 |
| `GET /api/storage/dashboard` | 登录(个人)/admin(全站) | 用量、分布、水位、孤儿、失联、配额、队列深度 |
| `POST /api/storage/settings` | file.admin | driver/root/双根/auto_purge（默认 0） |
| `GET /api/orders/:id/files.zip` | 订单 read | 流式 archiver；无权文件跳过并在 `manifest.json` 注明 |
| `GET /api/metrics/files` | file.admin | 上传成功率、转换 p95、队列深度、4xx/5xx |

安全：魔数认类型（pdf/docx/xlsx/pptx/jpg/png/webp/heic/zip/txt）；单文件 ≤100MB；key 用 uuid；下载口加 `nosniff` + `Content-Security-Policy: sandbox`（预览 PDF 时防嵌入脚本）；root 下拒绝 symlink，`realpath` 前缀校验。

## 6. 派生管道

- **持久化**：`derive_status='processing'` 是队列的真相源；进程启动时扫描 processing 行重置为 failed 并重排（避免重启后永久卡住）。
- 串行并发 1（LibreOffice 互相踩内存），单任务 60s 超时 `SIGKILL` 进程组；每用户队列上限 20，超限 429。
- 规则：docx/xlsx/pptx → PDF；pdf → 前 10 页缩略图；jpg/png/webp → EXIF 纠正 + webp 缩略图；**HEIC → jpg 再入图片管线**。
- 分享预览/无下载权限的预览 → 生成 `watermarked` 派生（客户名 + 日期 + 用途文字，由分享配置决定），**原文件不出口**。
- 失败：`failed` + 原因 + 「重试转换」（manage 权限），永不阻塞下载。
- 派生 key 在本体旁 `.deriv/`，可随时重生成；备份只搬本体。

## 7. 台账与回收站

- 状态机：`active --recycle--> recycled --restore--> active`；recycled >30 天标「可彻底删除」，仍不自动删。
- 台账 = active 且引用 0；列：文件名、大小、上传人、原上传场景（remark_json 快照）、天数、最后访问、legal hold 标记。
- 批量操作（≤50/批）+ 逐条结果；彻底删除需二次确认 + 理由（误传/过期/重复/其他）。
- `auto_purge_enabled=0`：开启后仅清 recycled >90 天、非 legal hold、每批 ≤50、逐条审计；设置页红字标注风险。
- **删订单/客户只删 references**，文件入台账；legal hold 文件即使引用归零也不可删。
- GDPR 式彻底删除：清本体 + 派生 + 缩略图 + 分享链接；access_log 保留但 `user_id` 匿名化为 `deleted`（审计与合规的折中，写进文档）。

## 8. 与既有 `order_files` 的兼容层（v2 新增，关键）

现状：`order_files(order_id, asset_id, file_kind, ...)` 唯一键 `(order_id, asset_id)`，指向 `knowledge_assets`。**不做破坏性迁移**：

- **写**：新上传/新关联一律写 `file_references`；
- **读**：订单文件列表 = 旧 `order_files` ∪ 新 `file_references`，按 (kind, 内容标识) 去重，UI 用徽章区分「外链资料 / 已上传文件」；
- **收编**（M6）：补传旧资产→生成 file→建 reference，并在 `order_files` 新增可空列 `superseded_by_file_id`（ensureColumn），UI 折叠旧的重复项；
- 旧 `order_files` 永不删行（历史可追溯），删除订单时只删 references + 标记旧行 `orphaned`。

理由：唯一键结构决定了「加 file_id 列」会撞键；双读一写是唯一无损路径。

## 9. 前端改造

1. 订单文件弹窗三页签：已关联 | 从文件中心选 | 上传新文件（拖拽 + 移动端 `capture` 拍照）。
2. 通用预览组件：PDF iframe（Range 生效）/ 图片墙 / Office 预览中 / 失败重试；挂 `#appModal`，令牌自带。
3. 文件中心新增「台账」「存储设置（admin）」；台账支持多选批量。
4. 分享面板：有效期（1/7/30 天）、仅预览/可下载、密码可选、水印文案、复制链接、访问记录、撤销。
5. 订单详情：「下载全部（zip）」「合并为一份 PDF」「单证齐套卡片」（只读聚合单证模块状态，不重复造）。
6. 列表分页 + 服务端搜索；上传队列 UI（并发 3、失败重试、断点续传提示）。

## 10. 运维与容量

- **RPO ≤1h / RTO ≤4h**：rclone 每小时增量同步 + 每日全量校验；季度恢复演练（随机抽 10 个 key 还原比对 sha256），结果写 dashboard「演练」卡。
- 指标：上传成功/失败、转换 p95、队列深度、下载 4xx/5xx、存储字节、孤儿字节；`/api/metrics/files` 输出 JSON，dashboard 展示。
- 水位：≥80% 黄、≥90% 红并限制上传（507 前置提示）。
- 容量估算：25 人 × 6 单/月 × 10 文件 × 4MB ≈ 6GB/月 ≈ 72GB/年；规划 500GB 盘 + 云端同步，3 年无压力。
- 日志保留 12 个月后聚合成月计数；审计导出 CSV（admin）。
- 部署：`brew install --cask libreoffice` / `apt install libreoffice-core` 写入部署文档；双根过渡（`legacy_root_uri` 读旧写新）+ `scripts/migrate-storage.mjs` 断点续传 + sha256 校验。

## 11. 里程碑（每期闭环：码 → 迁移 → 测试 → 构建 → 部署 → 验证 → 可回滚）

### M1 地基 + HTTP 语义 + 兼容层
- 5+2 张表（files/derivatives/references/logs/share_links/upload_sessions/settings）、`file-storage.ts`（driver+guard）、直传/预览/raw/meta、Range/HEAD/ETag、订单双读、三页签。
- DoD：guard 矩阵 ≥14 断言（private/inherit 并集/team/回收站 404/IAM dataScope/legal_hold 阻塞）；Range 206 与 304 实测；中文名下载；EXPLAIN 达标；契约测试 100%。
- 回滚：新表独立 + 双读开关，回退 dist 即恢复旧行为。

### M2 分片与预览
- 分片上传/续传/幂等、LibreOffice 队列与重启恢复、HEIC、缩略图、失败重试。
- DoD：80MB 断网续传不重复；杀进程后队列自愈；60s 超时杀进程；HEIC 可见；转换失败不阻塞下载。

### M3 分享 + 水印 + 版本
- share_links 全链路、水印派生、版本化、review_status 展示（与单证模块对齐）。
- DoD：预览链接不泄露原文件；撤销 10s 内失效；过期/超次数拒绝；水印含客户名与日期；PI v2 不影响已锁 v1 的订单。

### M4 台账 + 批量 + 审计 + 合规
- 台账/回收站/批量、访问日志查询页、legal hold、GDPR 删除、离职转 owner。
- DoD：批量 50 条事务一致；hold 文件删除返回 423；彻底删除清派生与分享；转 owner 后配额/台账同步。

### M5 打包 + 合并 + 仪表盘 + 巡检
- zip（流式）、合并 PDF、dashboard、指标、hash 巡检、容量告警。
- DoD：50 文件 zip 逐个过 guard；合并 PDF 顺序可控；仪表盘数据与 DB 对账一致；巡检发现人为改动的文件。

### M6 旧资产收编 + 商用验收
- 失效链接巡检、补传、`order_files.superseded_by_file_id` 回填、§1 八条验收全跑。
- DoD：清单归零或人工标「保留外链」；§1 全绿。

## 12. 风险清单（实现时逐条对照）

| # | 风险 | 对策 |
|---|---|---|
| 1 | 中文名下载乱码 | RFC5987，M1 验收 |
| 2 | HEIC 传不上 | 白名单 + 转换 |
| 3 | 删单误伤 | 只删 references |
| 4 | LibreOffice 僵尸 | 60s SIGKILL 进程组 |
| 5 | 磁盘满静默截断 | tmp+rename+回读+507 |
| 6 | 路径穿越/symlink | uuid key + realpath 前缀校验 |
| 7 | 并发重复上传 | sha256 去重 + client_token 唯一键 |
| 8 | URL 直达绕过权限 | 唯一 guard，preview/raw/zip/share 全覆盖 |
| 9 | 权限 N+1 拖慢 | 单 SQL + 30s 缓存 + EXPLAIN 验收 |
| 10 | 队列重启卡死 | 启动扫描 processing 重置 |
| 11 | 大文件预览卡 | Range/206 + 首屏优先 |
| 12 | zip 撑爆内存 | archiver 流式 + 大包转后台 |
| 13 | 分享链接外泄 | 限时+次数+密码+水印+撤销+访问记录 |
| 14 | 合同被误删 | legal_hold/retain_until 硬阻断 |
| 15 | 备份能备不能恢复 | 季度恢复演练 + 校验报告 |
| 16 | 迁移半拷贝 | 断点续传 + sha256 |
| 17 | 旧双轨混乱 | 双读一写 + superseded 回填 |
| 18 | 日志膨胀 | 12 个月聚合 |
| 19 | 时区错位 | UTC 存 + 前端本地化 |
| 20 | 批量误操作 | ≤50/批 + 逐条结果 + 显式确认 |
| 21 | 单机队列单点 | 明确为已知限制，异常自动重排；多实例前先做队列外置 |

## 13. 明确不做（本轮范围外）

- 在线协同编辑 Office、文件内评论/@提醒（二期评估）。
- 全站语义检索、OCR 文字层（预留 text 派生）。
- 客户门户完整入口（share_links 已覆盖「发给客户」这一核心场景）。
- 真·多租户隔离（仅 `tenant_id` 预留）。
- 病毒扫描（预留上传钩子）。
- 审批流引擎（review_status 只做状态展示，流程仍归单证模块）。

## 附录 A：两轮审核记录

### 第一轮：产品级（v1 得分 62/100 → v2 88）

| 发现 | 级别 | 处置 |
|---|---|---|
| 没有「发客户」通道，文件只能下载再手动发邮件 | P0 | 新增 share_links + 水印 + 访问记录（§4/§5） |
| 无 Range/HEAD，80MB 扫描件预览必然失败 | P0 | 提升为 HTTP 语义要求，M1 验收（§5） |
| 弱网大文件无续传，展会现场必失败 | P0 | 分片 + client_token 幂等（M2） |
| 客户要全套单据只能逐个下载 | P1 | zip + 合并 PDF（M5） |
| 单证齐套无产品表达 | P1 | 订单「齐套卡片」只读聚合（§9） |
| 合同类文件可被删，无合规保留 | P1 | legal_hold / retain_until（§3/§7） |
| 台账无批量，200 个孤儿不可运维 | P1 | 批量接口 + UI（M4） |
| 商用化缺租户前瞻 | P2 | tenant_id + key 租户段预留（§0/§3） |
| 缺可观测与容量规划 | P2 | 指标端点 + 容量估算 + RPO/RTO（§10） |

### 第二轮：工程与安全（v1 得分 71/100 → v2 90）

| 发现 | 级别 | 处置 |
|---|---|---|
| 权限并集若逐条反查将 N+1 | P0 | 单 SQL + 缓存 + EXPLAIN 验收（§4） |
| 上传「写盘成功、写库失败」产生无主字节 | P0 | 双向孤儿检测 + 上传会话表（§3/§5） |
| 重试导致重复文件 | P0 | client_token 唯一键（§3） |
| 无 Range/ETag，PDF 预览与缓存失效 | P0 | 补齐 206/304（§5） |
| recycle/restore 并发竞态 | P1 | 条件更新 + row_version |
| 队列状态只在内存，重启即卡 | P1 | DB 为真相源 + 启动自愈 |
| zip 全量入内存 | P1 | 流式 archiver |
| 旧 order_files 与新 references 双轨冲突 | P0 | 双读一写 + superseded 回填（§8） |
| 时间字段时区不一致 | P1 | UTC 存、前端本地化 |
| 批量/设置接口漏 `explicit_confirmation` | P1 | 契约 registry 明确要求（§5） |
| 分享链接成为新的越权面 | P0 | 独立校验 + 仅派生出口 + 全量审计（§4） |
| 恢复能力未演练 | P2 | 季度演练 + 报告（§10） |

### v2 保留的已知限制

1. 派生队列为进程内单机，多实例部署前必须外置（M6 后评估）。
2. `tenant_id` 只是预留，不是隔离；SaaS 化需重做鉴权上下文。
3. 无 OCR：扫描件只能看，不能全文搜。
4. 水印为栅格叠加（PDF 派生重绘），非矢量签名，不能防专业去除。

## 14. 实施进度（代码事实，以本节为准）

### M1 已上线（2026-10-28）
表 7 张（schema `1.4.25-file-chunk-derive`）；`backend/src/file-storage.ts` 提供 driver + guard + 仓库；直传 / meta / preview / raw（ETag/304/Range 206/416/HEAD）/ recycle / restore / delete / ledger / dashboard / settings；订单详情双读旧 `order_files` 与新 `file_references`。验收：guard 17 项断言、契约 100%（488 操作）、中文名下载、Range 与 304 实测。

### M2 已上线（2026-10-28）
- **分片上传**：`POST /api/files/uploads` → `PUT .../chunks/:index` → `POST .../complete`；5MB/片、会话 24h、单用户 20 个并发会话；`client_token` 复用会话，断网重试只补缺片；拼装边写边算 sha256，与声明不一致返回 422 且不落库；缺片返回 409 + `missing` 清单。
- **派生管道** `backend/src/file-derive.ts`：串行并发 1、60s 超时杀**进程组**、per-user 20 上限、`derive_status` 为队列真相源、启动把 `processing` 落成 `failed` 后自动重排（只重排「重启中断」这一种）。
- **三类派生**：Office→`preview_pdf`（LibreOffice）、HEIC→`image_jpg`（sips）、PDF/图片→`thumb`；派生件写在本体旁 `<key>.deriv/`，彻底删除时连派生件与空目录一起清。
- **降级**：未装 LibreOffice 时上传即提示「未安装 LibreOffice」，预览返回 409 + 原因 + `canRetry`，**下载永远可用**；`POST /api/files/:id/derive` 重试。
- 验收：`file-derive-test` 15 项；80MB 传 10 片后中断再续传，落库 1 份、sha256 与磁盘一致；重复 complete 同一文件；HEIC 预览 200 `image/jpeg`；Office 预览 409 而 raw 200；杀进程重启日志 `reset=1 requeued=1` 且缩略图恢复 ready；前端分片进度/失败重试/预览状态机实测。

### M3 已上线（2026-10-28）分享 / 水印 / 版本
- **分享**：`POST /api/files/:id/shares`（`mode=preview|download`、`ttlDays`、`maxViews`、可选密码、可选水印文案）；token 32 字节 base64url；密码 `scrypt$salt$hash` + `timingSafeEqual`；解锁态走独立 cookie（非登录态）。公开三端点 `/api/share/:token`、`/unlock`、`/content`：**先原子 `consumeShareView`（`UPDATE ... WHERE revoked_at IS NULL AND (max_views=0 OR view_count<max_views)`）再出字节**，并发不超发；撤销/过期/超次统一 410。
- **水印**：PDF 用 `pdf-lib` + `fontkit` 内嵌 Arial Unicode 子集（中文可渲染），斜向平铺 0.18 + 居中大字 0.12，水印后页数不变；图片走分享页 CSS 覆盖层（仅展示层，不重绘原图）。文案 = `客户名 · 日期 · token 前 6 位`。
- **版本**：`version_group_id` + `is_current`；上传新版本 → 成为当前版本，但**不自动改已关联订单的旧引用**（避免财务单据被悄悄换掉）。`POST /api/files/:id/versions/:versionId/promote` 切换当前版本 + `migrateReferences` 改引用（切前抓 `previousCurrent` 以便回退）。订单双读过滤 `!supersededByFileId`。
- **权限修复**：`/api/shares`（`training.read`）与 `/api/share-links/:id`（`document.manage`）原本没挂 `requireAuth`，`req.user` 为 undefined → 未登录可看「谁分享了哪些文件」并 500。已显式补 `requireAuth + enforceIamTenantPermission`。

### M4 已上线台账 / 批量 / 审计 / 合规
- `GET /api/files`：统一台账（`scope/status/ownerId/entityType/entityId/q/onlyOrphans` + 分页），回收站也在此查。
- `POST /api/files/batch`：**先全量预检、全部通过才执行**（任一文件被 `legal_hold` 拦截则整批 423，不做半成功）；单条与批量复用 `recycleFileFor / restoreFileFor / purgeFileFor`。
- `GET /api/files/audit`：仅管理员；`file_access_logs` 只存 `file_id`，接口批量回填 `fileName`（已彻底删除的回落显示 id）。
- `POST /api/files/:id/hold`（保留/解除保留）、`POST /api/files/transfer-owner`（离职交接：换 owner + team，留审计）。
- 审计动作：`preview / raw / share / share_view / share_download / unshare / recycle / restore / purge / version / promote / zip / merge / hold / unhold`。

### M5 已上线打包 / 合并 / 巡检
- `POST /api/files/zip`：自写流式 ZIP（store 模式 + Bit11 UTF-8 名 + data descriptor + EOCD，CRC32 表驱动），边读边发不整包入内存；单文件读失败**不中断整包**，用 `X-Skipped-Count` 告知跳过数。同名去重加 `(2)`。
- `POST /api/files/merge-pdf`：按提交顺序 `copyPages` 合并（`pdf-lib`）。
- `POST /api/storage/verify`：抽样 ≤20MB 重算 SHA256，回报 missing / mismatch。
- 验收：zip 用 `python3 zipfile.namelist()/testzip()` 校验（macOS 自带 `unzip` 不认 UTF-8 flag，会误报乱码）；合并 6 页；巡检 3 文件 0 异常。

### M6 已上线旧资产收编
- `GET /api/orders/legacy-files/audit`：列出旧 `order_files` 中无实体文件、无新引用的条目。
- `POST /api/orders/legacy-files/adopt`：建 `file_references`（契约里标 `explicit_confirmation`）。旧表只读不删，双读继续兜底。

### 数据库（2026-10-28）
schema `1.4.26-share-version-ops`：新增 `share_links` 视图所需列与 `order_files.superseded_by_file_id`；dev（262 表 / 3896 列）与 personal（263 表 / 3948 列）均已迁移，奇偶差 1 张表为 personal 独有的历史表，`goodjob-db-parity.sh` 通过。

### 前端（文件中心）
侧栏新增「文件中心」（`data-view="file-center"`）：4 张指标卡（文件总数/回收站/转换失败/磁盘）+ 四页签（全部文件 / 回收站 / 分享链接 / 访问审计）+ 搜索 / 归属筛选 / 只看无关联 / 批量条（回收·恢复·彻底删除·清空）/ 打包下载 / 分页；订单文件行加「分享」「版本」两个动作。
- **自带上传入口**（`#fcUploadButton` + `#fcUploadInput`）：不绑定订单，落到默认空间，`kind=other`。
  ≤8MB 直传、>8MB 走分片（`/api/files/uploads` → `PUT .../chunks/:i` → `complete`），
  单文件上限 100MB。修复前只有订单详情能传文件，不属于任何订单的基础文档没有入口。
- 分享页签状态与真实可用性一致：`已撤销 > 文件已删除 > 已过期 > 次数用尽 > 有效`，失效行禁用「复制/打开」。
- 验收：Playwright 前端 18 项（视图/指标卡/台账/分享生成与外链/版本/批量/四页签/回收站流转）+ 7 项（上传按钮 → 选文件 → 台账出现 → 点预览 → iframe 渲染 PDF）；`self-test` 补 9 条结构断言（视图显隐权重、`min-width:0`、审计独立列宽、`[hidden]` 兜底、分页、失效态、审计回填文件名），并做了变异验证确认会红。

### 本轮回归
`file-storage-test` 17、`file-derive-test` 16、`file-bundle-test` 9、`file-share-test` 9、`order-service-test` 13 组、`agent-api-contracts-test` 508/508（100%）、前端 `self-test` 174 项（含本轮新增 6 条预览/字体/上传断言，6/6 变异验证通过），全绿。

### 预览链路专项复核（2026-10-29）

**预览类型矩阵（实测）**

| 类型 | 通道 | 结果 |
|---|---|---|
| PDF | iframe → `/preview` | Chrome 内置阅读器正常渲染，页缩略图/页码可用（`CSP: sandbox` 不挡 PDF viewer） |
| 图片（png/jpg/gif/webp） | iframe → `/preview` | 正常，1024×646 容器，比例不变形 |
| 文本（txt/csv） | 前端 fetch → `<pre>` | 正常，中文不乱码 |
| Office（docx/xlsx/pptx，含 WPS 存出的） | 派生 `preview_pdf` → iframe | 已装 LibreOffice，正常渲染；未装时 409 + 明确原因 + 重试/下载出口 |
| HEIC | 派生 `image_jpg` → iframe | macOS `sips` 可用则正常；源文件损坏时 409 + 可读原因 |
| ZIP 等其它 | — | 415；台账「预览」按钮直接禁用并带 `title` 说明 |

**本轮修掉的三处真问题**

1. 🔴 **文本预览中文整篇乱码**：`sendStoredFile` 只发 `Content-Type: text/plain`，不带 charset，Chrome 按本地编码解码 → 「第二行」变成「绗笁琛屻」。改为 `text/*` 一律追加 `; charset=utf-8`。
2. 🔴 **CSV 点「预览」变成下载文件**：Chrome 对 `text/csv` 没有内置查看器，iframe 直接触发下载，「预览」语义失效。改为前端识别 `content-type: text/*` 后自行拉全文用 `<pre class="od-preview-text">` 渲染（>3MB 提示下载），txt/csv 走同一条路。
3. 🔴 **失败文案把外部工具 stderr 甩给业务用户**：`shortError` 原先把 stderr 最后一行拼进文案，用户看到的是 `Try 'sips --help' for help using this tool.`；DOCX 还带 `brew install --cask libreoffice`。现在 stderr 只写 `console.error`，对外文案统一为「…，可下载原文件查看」/「服务器缺少 Office 转换组件，暂时只能下载查看」。安装命令移到「存储设置 → 在线预览能力」。

**可观测性补强**

- 台账「转换失败 N」指标卡可点 → 直接落成 `deriveFailed=1` 筛选；工具栏加「只看转换失败」（`GET /api/files?deriveFailed=1`）。
- 台账标签由「预览需转换」改为「转换失败」（只有必需派生件失败才会把文件标 failed，PDF 缩略图失败不影响预览）。
- 存储设置弹窗新增「在线预览能力」：Office / HEIC / PDF 缩略图三项 + 缺失项安装提示 + 转换队列（进行中/排队）。

**边界行为（已确认，非缺陷）**

- 回收站中的文件仍可预览（可恢复语义）；**彻底删除后** `/preview` 与 `/raw` 均 404。
- 已彻底删除文件的审计记录**保留**（合规要求），列表回退显示文件 id。
- 普通销售跨用户访问 → 403「没有可访问的关联业务」（`evaluateFileAccess` 的 inherit 无引用即私有）。

**预览专项验收**

- 后端 60 项断言全通过：响应头（`inline` + RFC5987 中文名 + CSP sandbox + ETag + Accept-Ranges）、Range 206/416、ETag 304、HEAD 探针、各类型状态码与文案、`deriveFailed` 过滤、删除后 404、审计回填。
- 前端 Playwright 26 项：PDF/图片 iframe 渲染、文本/CSV 走 `<pre>` 且中文正确、ZIP 按钮禁用并带原因、DOCX 409 文案与重试、指标卡跳筛选、存储设置能力面板。
- `file-derive-test` 增至 16 项（新增「stderr 不进用户文案」）；`self-test` 再补 6 条预览结构断言（charset、走 `<pre>`、文案不含安装命令、指标卡入口、能力面板），全部做过变异验证，174 项必查 id 全保留。

### Office / WPS 预览落地（2026-10-29）

**结论：Office 预览已打通，服务端转换、客户端零安装。**

LibreOffice 26.8.1 装在 `~/Applications/LibreOffice.app`（不需要管理员密码），
配套字体配置 `deploy/fontconfig/fonts.conf`，后端在转换子进程上注入
`FONTCONFIG_FILE` / `FONTCONFIG_PATH`（见 `fontConfigEnv()`）。

**为什么必须显式配字体**

LibreOffice 在 macOS 上只扫描自己 bundle 内的字体（128 个，缺中日韩字形），
看不见 `/System/Library/Fonts`。不注入 fontconfig 时，转出来的 PDF「转换成功」，
但**中文整段消失**，只剩数字和英文——比转换失败更危险，因为看起来像成功了。
实测同一份 docx：无字体配置时正文全空白；注入后中文完整可读。

**WPS 兼容性**

| 输入 | 处理 | 结果 |
|---|---|---|
| `.docx/.xlsx/.pptx`（WPS 默认存法，与 Office 同一标准） | LibreOffice 直接转 | 正常 |
| `.wps/.et/.dps/.wpt/.ett/.dpt`（WPS 专有，OLE2 容器） | 识别 OLE2 魔数 → 尝试转换 | 能转则转；失败提示「建议另存为 docx/xlsx/pptx」 |
| 后缀是 `.doc/.wps` 但内容是 OOXML（PK 魔数） | `conversionExtension()` 按魔数改成 `.docx/.xlsx/.pptx` 再转 | 正常（按后缀硬转会解析失败） |
| 字体名「宋体/黑体/微软雅黑/楷体/仿宋」 | fontconfig 别名 → WPS 自带字体（书宋/汉仪旗黑）→ macOS 系统字体 | 正常显示 |

`sniffFileType` 补了 OLE2 分支（`D0 CF 11 E0`），否则 `.wps/.doc/.xls/.ppt`
会被判为未知类型直接 415；上传控件 `accept` 也补上了这些扩展名。

**版式保真度（需要如实告知）**

同一份 11 页中文方案：WPS/Office 原生 11 页，LibreOffice 转换后 **14 页**，
表格列宽有挤压。原因是替代字体的字宽与真正的宋体/SimSun 不完全一致。
内容、层级、表格数据都正确，**适合「看内容」不适合「打印前定版」**。
要接近 1:1，需把真正的 SimSun/SimHei 装进系统并在 `fonts.conf` 里提到优先位。

**部署**

```bash
bash deploy/install-libreoffice.sh     # 只下载 + 挂载 + 拷到 ~/Applications，无需 sudo
launchctl kickstart -k gui/$(id -u)/com.goodjob.crm.backend
```

能力探测已把 `~/Applications/LibreOffice.app/...` 列为候选路径，不需要改其它配置；
`GET /api/storage/dashboard` 的 `derive.capabilities` 与 `derive.fontconfig` 可自检。

### PDF 缩略图不再依赖 poppler

`pdfThumb()` 现在优先用 macOS 自带 `sips`（只出首页，正好是缩略图需要的），
其次 `pdftoppm`，最后 `qlmanage`。`qlmanage` 在 launchd/无 GUI 会话里会报
`sandbox initialization failed` 且**退出码仍可能是 0**，所以只能当兜底，不能当主力。

### 彻底删除的派生件残留（已修）

`purge` 与派生写盘是两条并发路径：任务可能在文件被彻底删除之后才写盘，
留下 `file_derivatives` 表里查不到的孤儿缩略图。两处加固：

1. 派生件写完后**再校验文件是否还存在**，不在就立即删掉刚写的字节；
2. 彻底删除时除按 DB 记录的 key 删，还整目录清掉 `<key>.deriv/`。

实测：上传 → 派生完成（磁盘 3 个文件：本体 + preview_pdf + thumb）→ 回收站 →
彻底删除 → **磁盘 0 文件**。

---

## 15. 跨平台部署（macOS / Windows / Linux / Docker）

项目要开源，服务器不一定是 macOS。文件中心的跨平台成本几乎全集中在
**外部命令 + 字体**这两件事上——纯 Node 部分（存储、权限、分享、打包、水印算法）
本来就没有平台假设。下面是逐项差异与已落地的处理。

### 15.1 平台差异矩阵

| 能力 | macOS | Windows | Linux / Docker | 代码位置 |
|---|---|---|---|---|
| Office→PDF | `/Applications/LibreOffice.app/.../soffice` | `soffice.com`（**不能是 `.exe`**） | `/usr/bin/soffice` | `libreOfficeCandidates()` |
| 中文字体来源 | 需注入 fontconfig（LO 只认 bundle 内 128 个字体） | **系统字体，直接可用** | 需注入 Linux 版 fontconfig + 别名 | `fontConfigFile()` |
| PDF 首页缩略图 | `sips` → `pdftoppm` → `qlmanage` | `pdftoppm`（poppler）→ ImageMagick | `pdftoppm` → ImageMagick | `pdfThumb()` |
| 图片 / HEIC 转 JPEG | `sips` | ImageMagick（可选） | ImageMagick（可选） | `convertImage()` |
| 超时杀进程树 | `process.kill(-pid)` | `taskkill /pid <p> /T /F` | `process.kill(-pid)` | `runCommand()` |
| LO 独立 profile | `file:///...` | 必须 `pathToFileURL()`（`file://C:\` 非法） | 同 macOS | `convertWithLibreOffice()` |
| 文件占用时删除 | 允许（inode 语义） | `EPERM/EBUSY`，需重试 | 允许 | `renameInto()` / `remove()` |
| zip 文件名 | 宽松 | 禁 `<>:"\|?*`、保留名 `CON/NUL/COM1`、结尾点空格 | 宽松 | `sanitizeZipName()` |
| 水印中文字体 | Arial Unicode（.ttf） | `simhei.ttf` / `Deng.ttf`（.ttc 需拆包） | Droid 单文件 / Noto（.ttc 需拆包） | `cjkFontCandidates()` |

### 15.2 三个必须踩对的坑（都会「看起来成功、结果不对」）

**① Windows 上用 `soffice.exe` 会立刻退出**

`soffice.exe` 是 GUI 入口。命令行调用它，进程马上带着退出码 0 返回，
而转换还在后台跑——服务端读不到产物，判成「转换没有产出 PDF」。
必须用同目录下的 `soffice.com`（控制台壳，会等转换结束）。
代码里 `.com` 排在 `.exe` 之前，单测锁住了这个顺序。

**② `-env:UserInstallation=file://C:\Users\...` 不是合法 URL**

LibreOffice 会**静默忽略**这个参数，转而去抢桌面版 LO 的 profile 锁，
表现为「装了 LO 但转换一直失败」。改用 `pathToFileURL(dir).href`。

**③ 用错平台的 fontconfig 比不注入更糟**

`fonts.conf` 里的 `<dir>` 是字体目录白名单。把 macOS 那份塞进 Linux 容器，
等于声明「系统里没有任何字体」：转换照样「成功」，版面全空。
所以按平台分两份文件，Windows 直接返回空（它走 GDI/DirectWrite，不需要 fontconfig）：

- `deploy/fontconfig/fonts.conf` — macOS（含 WPS 自带字体目录）
- `deploy/fontconfig/fonts.linux.conf` — Linux（`/usr/share/fonts` + 字体名别名）

Linux 那份还做了**字体名别名**：docx 里写的是「宋体 / SimSun / 微软雅黑」，
这些名字在 Linux 上不存在，不配 alias 会退到无中文字形的字体。

### 15.3 Windows 部署

```powershell
# 1) 装 LibreOffice（自动优先 winget；无 winget 可给离线 MSI）
powershell -ExecutionPolicy Bypass -File deploy\install-libreoffice.ps1

# 无管理员权限：用 MSI 做 administrative install，解包到 %LOCALAPPDATA%\Programs
powershell -ExecutionPolicy Bypass -File deploy\install-libreoffice.ps1 `
  -Mode msi -MsiPath D:\LibreOffice_26.2.0_Win_x86-64.msi

# 2) 可选：缩略图 / HEIC 需要 poppler + ImageMagick
powershell -ExecutionPolicy Bypass -File deploy\install-libreoffice.ps1 -WithPdfTools

# 3) 构建并起服务
npm ci
npm run build --workspace backend

# 连 MySQL（PowerShell 写法；npm 脚本已用跨平台包装，下面这条在 cmd 里也能跑）
npm run start:mysql --workspace backend

# 或者手动指定变量
$env:GOODJOB_FILE_ROOT = "D:\GoodJobData\storage"
$env:CRM_STORE = "mysql"
node backend\dist\server.js
```

**`npm` 脚本已做过跨平台处理**：`backend/package.json` 里原来写的是
`NODE_ENV=test tsx src/x.ts` 这种 POSIX 语法，在 cmd/PowerShell 里会报
「找不到 NODE_ENV=test」。现在统一走 `scripts/run-with-env.mjs`（纯 Node、零依赖），
`npm run test:files` / `npm run test:order` / `npm run start:mysql` 在 Windows 上可直接执行。

**Windows 上不需要设置 `FONTCONFIG_FILE`**，也不需要拷字体：宋体/黑体/微软雅黑
都是系统自带，LibreOffice 直接取用。

把服务注册成开机自启，用「任务计划程序」或 NSSM 均可；本项目不自带 Windows
服务封装，避免为单一平台引入额外依赖。日志重定向到文件后，`Get-Content -Wait` 即可跟踪。

### 15.4 Linux / Docker

```bash
sudo apt install libreoffice-writer libreoffice-impress libreoffice-calc \
                 fonts-noto-cjk fonts-wqy-zenhei \
                 fonts-crosextra-carlito fonts-crosextra-caladea \
                 poppler-utils

# Docker 部署已把这些写进镜像（deploy/docker-compose/Dockerfile.backend）
cd deploy/docker-compose && ./install.sh
```

镜像原来只装 `libreoffice-calc`，导致 `.docx/.pptx` 一律转换失败——已改为
writer + impress + calc 三件套，并补 `poppler-utils`（缩略图）、Carlito/Caladea
（Calibri/Cambria 的度量兼容替代，直接影响版式保真度）。

### 15.5 环境变量（开源用户最需要的几个）

| 变量 | 作用 | 默认 |
|---|---|---|
| `GOODJOB_FILE_ROOT` | 存储根目录 | `<仓库>/storage` |
| `LIBREOFFICE_BIN` | 显式指定 soffice 路径 | 按平台探测 |
| `GOODJOB_PDFTOPPM` | 显式指定 pdftoppm | 按平台探测 |
| `GOODJOB_MAGICK_BIN` | 显式指定 ImageMagick | 按平台探测 |
| `GOODJOB_FONTCONFIG_FILE` | 覆盖 fontconfig 配置 | 按平台选 `deploy/fontconfig/*` |
| `GOODJOB_WATERMARK_FONT` | 水印用中文字体（.ttf/.otf 优先） | 按平台挑候选 |

`GET /api/storage/dashboard` 的 `derive.capabilities` 现在带 `platform` 字段，
前端「存储设置 → 在线预览能力」据此显示对应的安装命令（brew / winget / apt），
不再一律给 macOS 的 brew。

### 15.6 已知限制（如实说明）

1. **HEIC 在 Windows / Linux 上默认不可预览**。LibreOffice 不认 HEIC，
   只有装了带 HEIC 解码的 ImageMagick 才能转。上传时会当场提示「只能下载查看」，
   不会等到用户点预览才失败。iPhone 拍照较多的团队建议在手机端设为「兼容性最佳」
   （存 JPEG），或给服务器装 ImageMagick。
2. **`.ttc` 字体集合不能直接喂给 pdf-lib**（`font.createSubset is not a function`）。
   水印链路会先拆包成单字体（`extractSfntFromCollection()`），拆不出来则**降级成 ASCII 水印**，
   保留 token 前 6 位与日期（倒查能力不丢），绝不因此把下载打成 500。
3. **Windows 长路径**：存储根不要放在层级很深的中文目录下。`files/default/{yy}/{mm}/{uuid}.ext`
   本身约 40 字符，配合常规根目录远低于 260；但如果根目录已接近上限，需要开
   `LongPathsEnabled`。
4. **平台验证范围**：macOS 已跑通端到端（上传→转换→预览→水印→打包）。
   Windows / Linux 的**平台分支**用运行时切换 `process.platform` 做了单测覆盖
   （候选路径顺序、fontconfig 分流、taskkill 分支、路径处理），
   但**尚未在真机 Windows 上跑完整端到端**。首次在 Windows 部署时建议按下面清单自检。

### 15.7 Windows 首次部署自检清单

```powershell
# 1) 能力探测是否命中 .com
node -e "const{probeDeriveCapabilities:c}=require('./backend/dist/file-derive.js');console.log(c(true))"
# 期望：libreoffice 以 soffice.com 结尾，platform: 'win32'

# 2) 手工验证一次转换（不经过服务）
& "C:\Program Files\LibreOffice\program\soffice.com" --headless --convert-to pdf `
  --outdir $env:TEMP "$env:TEMP\test.docx"
# 期望：$env:TEMP\test.pdf 存在，且打开后中文完整

# 3) 服务起来后看面板
#    文件中心 → 存储设置 → 在线预览能力：应显示「服务器 Windows」且三项状态正确
```
