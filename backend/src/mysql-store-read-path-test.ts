/**
 * 读路径 / 写快照回归：这两条路径都不许做多余的整库拷贝。
 *
 * 背景：MySQL 模式下 store 是整个数据集的内存镜像，任何一次「整库 structuredClone」
 * 都会把客户、跟进、单据、日志全部复制一遍。历史上两个高频位置都踩过：
 *
 * 1) 校验只读（validateProspectRunPersistence / 校验 campaign）却用
 *    persistenceSnapshot(store) 深拷贝 —— 轮询期间每几秒复制一次全库。
 * 2) store.persist() 每次都深拷贝全库再落库 —— 一次写入的临时内存等于整个数据集。
 *
 * 现在约定：
 * - 校验用 validationView（浅拷贝，数组元素共享引用，persist 为 no-op）；
 * - 持久化快照只复制数组外壳（新数组、同一个元素），元素级变更由下一次 persist 覆盖；
 * - readBarrier(maxAgeMs) 允许轮询接口声明「这么新的数据够用」，写路径不传窗口。
 */
import assert from "node:assert/strict";
import {
  createReloadGuard,
  persistenceSnapshot,
  validationView
} from "./mysql-store.js";
import type { CrmStore } from "./store.js";

// ── 1. 校验视图不深拷贝 ───────────────────────────────────────────
{
  const campaigns = [{ id: "pc_1", teamId: "team_1" }];
  const runs = [{ id: "pr_1", teamId: "team_1" }];
  let persistCalls = 0;

  const store = {
    prospectCampaigns: campaigns,
    prospectSearchRuns: runs,
    persist: async () => {
      persistCalls += 1;
    }
  } as unknown as CrmStore;

  const view = validationView(store);

  assert.notEqual(view, store, "校验视图不能就是真实 store 本身");
  assert.equal(
    view.prospectCampaigns,
    campaigns,
    "校验视图不允许拷贝业务数组（必须是同一个引用）"
  );
  assert.equal(
    view.prospectCampaigns[0],
    campaigns[0],
    "校验视图连元素都不应该被复制"
  );

  const reloaded = [{ id: "pr_2", teamId: "team_1" }];
  view.prospectSearchRuns = reloaded as never;
  assert.equal(store.prospectSearchRuns, runs, "视图上的替换不能影响真实 store");
  assert.equal(view.prospectSearchRuns, reloaded);

  await view.persist();
  assert.equal(persistCalls, 0, "校验视图的 persist 必须是 no-op");

  // 反证：真深拷贝出来的引用必然不同，确保上面的引用断言有意义
  assert.notEqual(structuredClone(campaigns), campaigns);
  assert.notEqual(structuredClone(campaigns)[0], campaigns[0]);
}

// ── 2. 持久化快照只复制数组外壳 ───────────────────────────────────
{
  const customers = [{ id: "c_1", company: "ACME" }];
  const activities = [{ id: "ca_1", customerId: "c_1" }];
  const view = {
    customers,
    customerActivities: activities,
    notes: "not-an-array"
  } as unknown as CrmStore;

  const snapshot = persistenceSnapshot(view);

  assert.notEqual(snapshot, view, "快照必须是独立对象");
  assert.notEqual(snapshot.customers, customers, "数组外壳必须换新（写期间 push/splice 不能改到快照）");
  assert.equal(snapshot.customers[0], customers[0], "元素不允许被深拷贝，否则每个写请求都复制整个数据集");
  assert.equal(snapshot.customerActivities[0], activities[0]);
  assert.equal(snapshot.notes, "not-an-array", "非数组字段按引用共享");

  snapshot.customers.push({ id: "c_2", company: "NEW" } as never);
  assert.equal(customers.length, 1, "往快照里 push 不能影响真实 store");

  await snapshot.persist();
  assert.equal(typeof snapshot.persist, "function", "快照的 persist 必须是 no-op 函数");
}

// ── 3. 重载守卫 ───────────────────────────────────────────────────
{
  let reloads = 0;
  let clock = 1_000_000;
  const guard = createReloadGuard(async () => {
    reloads += 1;
  }, () => clock);

  // 不传窗口 → 每次都读（写路径/调度路径的既有行为，不能被改掉）
  await guard();
  await guard();
  assert.equal(reloads, 2, "不传窗口时必须每次都重读");

  // 给了窗口 → 窗口内复用，窗口外重读
  clock += 2_000;
  await guard(1_000);
  assert.equal(reloads, 3, "超出窗口后必须真读一次");
  clock += 400;
  await guard(1_000);
  assert.equal(reloads, 3, "窗口内的重复轮询必须复用上一次结果（不再读表）");
  clock += 700;
  await guard(1_000);
  assert.equal(reloads, 4, "超出窗口后必须重新读表");

  // 失败不刷新时间戳：失败后必须允许下一次立刻重试
  let failNext = true;
  let flakyReloads = 0;
  const flaky = createReloadGuard(async () => {
    flakyReloads += 1;
    if (failNext) {
      failNext = false;
      throw new Error("boom");
    }
  }, () => clock);
  await assert.rejects(() => flaky(1_000), /boom/);
  await flaky(1_000);
  assert.equal(flakyReloads, 2, "上次失败不能被当成「刚读过」，必须重试");
}

console.log("mysql store read path tests passed");
