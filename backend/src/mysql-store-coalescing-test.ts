/**
 * 写合并队列回归：createCoalescingPersistence。
 *
 * 背景：persistAll 一次会全量重写 93 张表（replaceRows = `DELETE FROM t` + 全量 INSERT），
 * 而单个请求里经常连续调用多次 store.persist()。合并队列只允许「同一次写入执行期间
 * 到达的请求」被压成一次，绝不能把「顺序 await 的两次写」合并掉——那会丢掉中间状态。
 *
 * 因此下面两个方向都必须断言：
 * 1) 执行期间的并发请求 → 合并（calls 不随请求数线性增长）；
 * 2) 顺序 await 的请求 → 各自落库（不能被合并）。
 */
import assert from "node:assert/strict";
import { createCoalescingPersistence } from "./mysql-store.js";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

// ── 1. 第一个请求立即开跑，不引入延迟 ──────────────────────────────
{
  let calls = 0;
  const gate = deferred();
  const queue = createCoalescingPersistence(async () => {
    calls += 1;
    await gate.promise;
  });

  const first = queue.request();
  assert.equal(calls, 1, "第一个请求必须立即开跑，不能靠定时器延迟");
  gate.resolve();
  await first;
  assert.equal(calls, 1, "只有一轮写入");
}

// ── 2. 执行期间的并发请求合并成一次收尾写入 ────────────────────────
{
  let calls = 0;
  let running = 0;
  let maxConcurrent = 0;
  const gates: Array<ReturnType<typeof deferred>> = [];
  const queue = createCoalescingPersistence(async () => {
    calls += 1;
    running += 1;
    maxConcurrent = Math.max(maxConcurrent, running);
    const gate = deferred();
    gates.push(gate);
    await gate.promise;
    running -= 1;
  });

  const first = queue.request();
  assert.equal(calls, 1);
  const batched = [
    queue.request(),
    queue.request(),
    queue.request(),
    queue.request()
  ];
  assert.equal(calls, 1, "执行期间到达的请求不得各自触发一次落库");
  assert.equal(gates.length, 1, "同一时刻只允许一轮写入在跑");

  gates[0]!.resolve();
  await first;
  await tick();
  assert.equal(calls, 2, "执行期间的 4 个请求应合并成一次收尾写入");
  assert.equal(gates.length, 2);

  gates[1]!.resolve();
  await Promise.all(batched);
  await tick();
  assert.equal(calls, 2, "收尾写之后不应再有额外写入");
  assert.equal(maxConcurrent, 1, "写入必须串行，不允许两轮并发");
}

// ── 3. 顺序 await 的请求必须各自落库，不能被合并 ───────────────────
{
  let calls = 0;
  const queue = createCoalescingPersistence(async () => {
    calls += 1;
  });
  await queue.request();
  await queue.request();
  await queue.request();
  assert.equal(
    calls,
    3,
    "顺序 await 的请求各自落库；合并掉会丢失中间状态"
  );
}

// ── 4. 写入失败：拒绝等待者，但不无限重试，也不破坏队列 ────────────
{
  let calls = 0;
  const queue = createCoalescingPersistence(async () => {
    calls += 1;
    throw new Error("boom");
  });
  await assert.rejects(() => queue.request(), /boom/);
  assert.equal(calls, 1, "失败后不得自动重试");
  await assert.rejects(() => queue.request(), /boom/);
  assert.equal(calls, 2, "失败不破坏队列，后续请求仍能触发写入");
}

// ── 5. close：补写剩余变更、放行等待者、拒绝新请求 ─────────────────
{
  let calls = 0;
  let flushes = 0;
  const gate = deferred();
  const queue = createCoalescingPersistence(async () => {
    calls += 1;
    await gate.promise;
  });

  const first = queue.request();
  const second = queue.request(); // 执行期间 → 只置 dirty
  await queue.close(async () => {
    flushes += 1;
  });
  assert.equal(flushes, 1, "close 必须把没落库的变更补写一次");
  await assert.rejects(() => queue.request(), /已关闭/);

  gate.resolve();
  await first;
  await second;
  assert.equal(calls, 1, "close 之后不得再启动新一轮写入");
}

console.log("mysql store coalescing persistence tests passed");
