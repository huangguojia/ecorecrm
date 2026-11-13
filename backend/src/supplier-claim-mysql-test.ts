import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import {
  createMysqlSupplierRepository,
  ensureSupplierSchema,
  SUPPLIER_PROTECTION_DAYS
} from "./supplier-repository.js";

// ---------------------------------------------------------------------------
// 供应商归属 / 公池认领：真实 MySQL 上的行为验收
//
// 纯函数单测（supplier-repository-test.ts）只能证明「算得对」，
// 这里证明「落库对」：加列、回填、进公池保历史、认领只成功一次、并发不双吃。
// 需要 DATABASE_URL；跑完按 team_id 清掉自己造的数据。
// ---------------------------------------------------------------------------

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("supplier-claim-mysql-test 需要 DATABASE_URL");

const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 8 });
const repository = createMysqlSupplierRepository(pool);
// 每个进程用独立 team，避免和开发库里的真实数据互相干扰（收尾按 team 整段删除）
const teamId = `team_supclaim_${Date.now().toString(36)}`;

let passed = 0;
function ok(condition: unknown, message: string) {
  assert.ok(condition, message);
  passed += 1;
}

try {
  await ensureSupplierSchema(pool);

  // —— 1. 建档：created_by 写成本人，且真正落库 ——
  const created = await repository.create("u_alice", teamId, { company: "Acme Sensors" });
  ok(created.ownerId === "u_alice" && created.createdBy === "u_alice", "建档人应等于创建人");
  ok(created.previousOwnerId === "", "新建时不应带原归属");
  const reloaded = await repository.find(teamId, created.id);
  ok(reloaded?.createdBy === "u_alice", "created_by 必须真正落库，而不是只存在内存对象里");

  // —— 2. 手工置公池：先记原主人，再清空归属 ——
  const pooled = await repository.update(teamId, created.id, { status: "public" });
  ok(pooled?.status === "public" && pooled.ownerId === "", "公池行必须无主");
  ok(pooled?.previousOwnerId === "u_alice", "进公池要把原归属留下来");
  ok(pooled?.createdBy === "u_alice", "进公池不能改写建档人");
  const pooledDb = await repository.find(teamId, created.id);
  ok(pooledDb?.previousOwnerId === "u_alice", "原归属要落库，否则刷新就丢（这正是老代码的毛病）");

  // —— 3. 认领：归属换人、保护期重算、原归属清空 ——
  const before = Date.now();
  const claimed = await repository.claim(teamId, created.id, "u_bob");
  ok(claimed?.ownerId === "u_bob", "认领后归属应变成认领人");
  ok(claimed?.status === "open", "认领后应回到「未成交」");
  ok(claimed?.previousOwnerId === "", "认领成功后原归属要清掉（现任就是新主人）");
  ok(claimed?.createdBy === "u_alice", "认领不能改写建档人——谁建的档是历史事实");
  const protection = new Date(String(claimed?.protectedUntil)).getTime();
  ok(
    protection > before + (SUPPLIER_PROTECTION_DAYS - 1) * 86_400_000,
    "认领要重给 21 天保护期，不能继承上一个人的过期时间"
  );
  const claimedDb = await repository.find(teamId, created.id);
  ok(claimedDb?.ownerId === "u_bob", "认领结果要落库");

  // —— 4. 已不是公池的行不能被认领（否则等于抢） ——
  ok(await repository.claim(teamId, created.id, "u_carol") === null, "非公池行认领必须失败");

  // —— 5. 并发认领：只成功一个 ——
  const race = await repository.create("u_alice", teamId, { company: "Race Supplier" });
  await repository.update(teamId, race.id, { status: "public" });
  const raceResults = await Promise.all([
    repository.claim(teamId, race.id, "u_bob"),
    repository.claim(teamId, race.id, "u_carol")
  ]);
  ok(raceResults.filter(Boolean).length === 1, "两人同时点认领只能有一个人成功");
  ok(raceResults[0] === null || raceResults[1] === null, "失败的一侧要拿到 null（路由据回 409）");

  // —— 6. 到期释放：推进公池并保住原主人 ——
  const expiring = await repository.create("u_dave", teamId, { company: "Expiring Supplier" });
  await pool.execute(`UPDATE suppliers SET protected_until = ? WHERE id = ?`, [
    new Date(Date.now() - 60_000),
    expiring.id
  ]);
  const released = await repository.releaseExpired();
  ok(released >= 1, "到期未成交的供应商应被释放进公池");
  const releasedRow = await repository.find(teamId, expiring.id);
  ok(releasedRow?.status === "public" && releasedRow.ownerId === "", "释放后应变成无主公池行");
  ok(releasedRow?.previousOwnerId === "u_dave", "释放前必须把原主人记进 previous_owner_id");

  // —— 7. 老库回填：created_by 为空的历史行按归属回填 ——
  const legacyId = `sup_legacy_${randomUUID()}`;
  await pool.execute(
    `INSERT INTO suppliers (id, owner_id, created_by, previous_owner_id, team_id, supplier_code, company, company_full_name, created_at, updated_at)
     VALUES (?, 'u_old', '', '', ?, 'SUP-9001', 'Legacy Supplier', 'Legacy Supplier', NOW(3), NOW(3))`,
    [legacyId, teamId]
  );
  await ensureSupplierSchema(pool);
  const legacy = await repository.find(teamId, legacyId);
  ok(legacy?.createdBy === "u_old", "老库已有行要按 owner_id 回填 created_by（管理员要能追到人）");
} finally {
  await pool.query(`DELETE FROM suppliers WHERE team_id = ?`, [teamId]).catch(() => 0);
  await pool.end();
}

console.log(JSON.stringify({ ok: true, checked: passed }, null, 2));
