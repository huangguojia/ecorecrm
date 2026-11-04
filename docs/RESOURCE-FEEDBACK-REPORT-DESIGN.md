# 资料推荐反馈报表设计（采纳率统计）

状态：设计定稿 2026-10-12，随实现落地。
关联：`backend/src/resource-hub.ts`、`backend/src/server.ts`、`whatsapp-plugin/src/server/services/resource-recommend-service.ts`、扩展 `options.js`。

## 1. 背景与缺口（已核实）

- 埋点只进不出：`resource_retrieval_events` 持续记录 exposed / revealed / accepted / dismissed / sent 五类事件，`ResourceHubRepository` 也已有 `listEvents()`，但**没有任何统计/报表 HTTP 端点**。
- 闭环断在最后一步：推荐做得好不好、哪些资料被真正采纳，业务员与管理员都看不到。
- 消费方现状：CRM 前端（prototype-api.ts）**没有资源中心视图**；资料推荐的唯一消费界面是扩展 agent 面板。

## 2. 目标

一条只读统计链路：CRM 后端聚合埋点 → 插件转发 → 扩展「推荐效果」面板展示。第一版给三个数：**曝光、采纳率、发送转化**，按资料排 Top 列表。

## 3. 接口设计

### 3.1 CRM 后端：`GET /api/agent/resources/stats?days=30`

- 鉴权 `requireAuth`；teamId 口径（与写入同源，天然隔离）。
- `days` ∈ [1, 90]，默认 30。
- 仓库层 `ResourceHubRepository` 新增 `eventStats(teamId, since)`：

```ts
// 一次 GROUP BY 出全部口径，不逐资源循环查询
Promise<Map<string /* `${type}:${id}` */, {
  exposed: number; revealed: number; accepted: number;
  dismissed: number; sent: number;
}>>;
```

- 路由聚合后返回：

```ts
{
  days: number,
  totals: { exposed, revealed, accepted, dismissed, sent,
            adoptionRate,   // accepted / max(1, revealed)
            sendRate },     // sent / max(1, revealed)
  items: [{ sourceType, resourceId, title, counts..., adoptionRate }]
    // 只带出现过的资源；按 adoptionRate 降序、其次 revealed 降序；≤50 条
}
```

- 标题在路由侧用 `collectHubResources()` 反查补齐；已删除的资源标题回退 `（已移除）`。
- 只读 GET，**不需要** agent-api-contracts 契约（契约只登记写接口）；`listEvents`/内存实现同样补 `eventStats`，保证 memory 档位可测。

### 3.2 插件转发：`GET /api/v1/resources/stats`

- `requireCrmAuth` + `resource-recommend-service.stats(userId, days)` → 经 `crm-client` 请求 CRM，透传聚合结果；失败抛 `DomainError`（502，带上游原因），不在插件侧伪造空数据。

### 3.3 扩展展示：options 页「推荐效果」卡片

- 仅当已登录 CRM 时显示：totals 四个数字卡（曝光 / 查看 / 采纳率 / 发送）+ Top 8 资料行（标题 + 采纳率）。
- 拉取失败显示原因行，不出假数据；未登录显示一行引导文案。
- 只读展示，不新增任何写行为。

## 4. 验收标准（先红后绿）

1. backend 回归（resource-hub 相关 -test.ts）：memory 仓库 `eventStats` 聚合正确（造 exposed×3 / revealed×2 / accepted×1 → adoptionRate=0.5）；days 窗口过滤生效；无事件返回全 0 而不是报错。
2. 路由：无 token 401；`days=999` 归一到 90；空团队返回空 items + 全 0 totals。
3. 插件测试：透传 URL 与查询参数正确；上游 5xx → 插件 502 且带原因（不吞成空数据）。
4. 扩展单测（resources.test.mjs）：请求 URL 带 days 参数；渲染 totals 与 Top 行；未登录不渲染。
5. **定义口径**：adoptionRate 与 sendRate 的分母都是 revealed（看到了才谈得上采纳/发送）——写进代码注释与文案，避免以后各算各的。

## 5. 明确不做 / 后续

- 不做 CRM 前端视图（资源中心界面本身还不存在，报表先挂在扩展侧）。
- 不做趋势曲线 / 时间分桶（第一版总量 + Top 列表；表结构支持后续加 `GROUP BY DATE(created_at)`）。
- 不新增任何表与迁移（聚合全部发生在既有 `resource_retrieval_events` 上）。
