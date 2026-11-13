#!/usr/bin/env node
// 供应商「建档人 / 现在归属 / 公池认领」端到端验收（真实 HTTP + 真实数据库）
//
// 覆盖的是后端接口语义，不是界面：隔离、置公池保历史、认领、并发只成功一次、
// 认领后隔离重新生效、失败时不泄露存在性。界面另由 Playwright 脚本验收。
//
// 用法（默认打本机 4290 的开发实例）：
//   node scripts/verify-supplier-ownership.mjs
//   BASE=https://www.ecoreglobalcrm.com ADMIN_EMAIL=... A_EMAIL=... B_EMAIL=... PASSWORD=... \
//     node scripts/verify-supplier-ownership.mjs
//
// 前置：需要 1 个管理员 + 2 个业务员账号（隔离必须两个业务员才验得出来）。
// 脚本自己造数据、自己删数据；中途失败会在 finally 里尽力清理。

const BASE = (process.env.BASE || "http://127.0.0.1:4290").replace(/\/$/u, "");
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@goodjob.com";
const A_EMAIL = process.env.A_EMAIL || "a.isolation@goodjob.com";
const B_EMAIL = process.env.B_EMAIL || "b.isolation@goodjob.com";
const PASSWORD = process.env.PASSWORD || "goodjob123";
const ts = Date.now().toString(36);
const NAME = `E2E Supplier ${ts}`;
const NAME2 = `E2E Race ${ts}`;

let pass = 0;
const fails = [];
const created = [];

function ok(cond, msg) {
  if (cond) { pass += 1; console.log(`  ✓ ${msg}`); }
  else { fails.push(msg); console.log(`  ✗ ${msg}`); }
}

async function call(path, options = {}, token) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

async function login(email, password = PASSWORD) {
  const r = await call("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
  if (!r.body?.token) throw new Error(`登录失败 ${email}: ${r.status} ${JSON.stringify(r.body)}`);
  return { token: r.body.token, user: r.body.user };
}

const admin = await login(ADMIN_EMAIL);
const salesA = await login(A_EMAIL);
const salesB = await login(B_EMAIL);
console.log(`目标 ${BASE}`);
console.log(`账号：admin=${admin.user.name} / A=${salesA.user.name} / B=${salesB.user.name}`);

const list = async (who) => {
  const r = await call("/api/suppliers", {}, who.token);
  if (r.status !== 200) throw new Error(`列表 ${r.status}`);
  return r.body.suppliers || [];
};

try {
  console.log("\n[1] A 建档：建档人 = 自己，归属 = 自己");
  const madeA = await call("/api/suppliers", {
    method: "POST",
    body: JSON.stringify({ company: NAME, country: "Germany" })
  }, salesA.token);
  ok(madeA.status === 200, "创建返回 200");
  const supplierId = madeA.body?.supplier?.id;
  if (supplierId) created.push(supplierId);
  ok(Boolean(supplierId), "创建返回了 id");
  ok(madeA.body?.supplier?.createdByName === salesA.user.name, "建档人回显为 A");
  ok(madeA.body?.supplier?.ownerName === salesA.user.name, "归属人回显为 A");
  ok(madeA.body?.supplier?.canClaim === false, "非公池行 canClaim=false（不给认领按钮）");

  console.log("\n[2] 隔离：B 看不到 A 的供应商，admin 看得到且带建档人");
  const adminView = (await list(admin)).find((s) => s.id === supplierId);
  ok(Boolean(adminView), "admin 能看到 A 建的供应商");
  ok(adminView?.createdByName === salesA.user.name, "admin 看到「谁建立的」");
  ok(adminView?.ownerName === salesA.user.name, "admin 看到「现在属于谁」");
  ok(!(await list(salesB)).some((s) => s.id === supplierId), "B（另一个业务员）看不到这条");

  console.log("\n[3] admin 把它放入供应商公池：归属清空、原归属留痕");
  const pooled = await call(`/api/suppliers/${supplierId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "public" })
  }, admin.token);
  ok(pooled.status === 200, "置公池返回 200");
  ok(pooled.body?.supplier?.status === "public", "状态为 public");
  ok(pooled.body?.supplier?.ownerId === "", "公池行 ownerId 为空");
  ok(pooled.body?.supplier?.previousOwnerName === salesA.user.name, "原归属回显 A");
  ok(pooled.body?.supplier?.createdByName === salesA.user.name, "建档人不因进公池而丢失");

  console.log("\n[4] B 在公池里看到它，可以认领");
  const bPool = (await list(salesB)).find((s) => s.id === supplierId);
  ok(Boolean(bPool), "B 能看到公池里的供应商");
  ok(bPool?.previousOwnerName === salesA.user.name, "B 看到「原属 A」");
  ok(bPool?.canClaim === true, "公池行 canClaim=true");
  const claimed = await call(`/api/suppliers/${supplierId}/claim`, { method: "POST" }, salesB.token);
  ok(claimed.status === 200, "B 认领返回 200");
  ok(claimed.body?.supplier?.ownerId === salesB.user.id, "认领后归属变成 B");
  ok(claimed.body?.supplier?.status === "open", "认领后回到未成交");
  ok(claimed.body?.supplier?.previousOwnerId === "", "认领后原归属清空");
  ok(claimed.body?.supplier?.createdByName === salesA.user.name, "认领不改写建档人");

  console.log("\n[5] 认领后隔离重新生效");
  ok(!(await list(salesA)).some((s) => s.id === supplierId), "A 已经看不到（不再归他）");
  ok((await list(salesB)).some((s) => s.id === supplierId), "B 能看到（归他了）");
  const aClaim = await call(`/api/suppliers/${supplierId}/claim`, { method: "POST" }, salesA.token);
  ok(aClaim.status === 404, `A 再认领被拒且不泄露存在性（实际 ${aClaim.status}）`);
  const bAgain = await call(`/api/suppliers/${supplierId}/claim`, { method: "POST" }, salesB.token);
  ok(bAgain.status === 409 && bAgain.body?.errorCode === "SUPPLIER_NOT_IN_POOL", `已认领过的再认领回 409（实际 ${bAgain.status}）`);

  console.log("\n[6] 并发认领：只能成功一个");
  const race = await call("/api/suppliers", {
    method: "POST",
    body: JSON.stringify({ company: NAME2, country: "Italy" })
  }, salesA.token);
  const raceId = race.body?.supplier?.id;
  if (raceId) created.push(raceId);
  await call(`/api/suppliers/${raceId}`, { method: "PATCH", body: JSON.stringify({ status: "public" }) }, admin.token);
  const [r1, r2] = await Promise.all([
    call(`/api/suppliers/${raceId}/claim`, { method: "POST" }, salesA.token),
    call(`/api/suppliers/${raceId}/claim`, { method: "POST" }, salesB.token)
  ]);
  const codes = [r1.status, r2.status].sort();
  ok(codes[0] === 200 && (codes[1] === 404 || codes[1] === 409), `一人 200、另一人被拒（实际 ${codes.join("/")}）`);
  const winner = r1.status === 200 ? salesA : salesB;
  const raceRow = (await list(winner)).find((s) => s.id === raceId);
  ok(raceRow?.ownerId === winner.user.id, "赢家拿到归属");
} finally {
  if (created.length) {
    const del = await call("/api/suppliers/bulk-delete", {
      method: "POST",
      body: JSON.stringify({ ids: created })
    }, admin.token);
    console.log(`\n[收尾] 删除本次造的 ${created.length} 条（成功 ${(del.body?.deleted || []).length} 条）`);
  }
}

console.log(`\n结果：${pass} 项通过，${fails.length} 项失败`);
if (fails.length) {
  for (const f of fails) console.log(`  - ${f}`);
  process.exitCode = 1;
}
