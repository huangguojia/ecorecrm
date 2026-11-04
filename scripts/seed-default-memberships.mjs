#!/usr/bin/env node
/**
 * ECORECRM：为内置种子账号补齐 IAM 成员身份。
 *
 * 背景：backend/src/data.ts 的种子用户只写入 `users` 表，而 IAM 校验要求
 * `tenant_memberships` + `member_role_assignments` 同时存在，否则登录后各处
 * 会提示「公司已暂停或成员身份已失效」。
 *
 * 本脚本幂等：已存在成员身份 / 角色绑定则跳过，可反复执行。
 *
 * 用法（必须走档位包装脚本，确保连的是 ecore_crm）：
 *   node scripts/run-with-profile.mjs development node scripts/seed-default-memberships.mjs
 */
import { createHash } from "node:crypto";
import process from "node:process";
import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!url) {
  console.error("缺少 DATABASE_URL，请用 scripts/run-with-profile.mjs 启动");
  process.exit(2);
}

/** users.role → IAM 角色 code（对应 roles 表里的 legacy_* 角色）。 */
const ROLE_CODE_BY_USER_ROLE = {
  admin: "legacy_admin",
  manager: "legacy_manager",
  sales: "legacy_sales",
  super_admin: "legacy_admin"
};

const hash = (value) => createHash("sha1").update(value).digest("hex");

const pool = mysql.createPool({ uri: url, connectionLimit: 2, namedPlaceholders: true });
let createdMemberships = 0;
let createdAssignments = 0;

try {
  const [users] = await pool.query(
    "SELECT id, role, team_id FROM users WHERE status = 'active' AND team_id <> 'all'"
  );
  for (const user of users) {
    const tenantId = String(user.team_id || "").trim();
    if (!tenantId) continue;

    const [tenantRows] = await pool.query(
      "SELECT id FROM tenants WHERE id = ? LIMIT 1",
      [tenantId]
    );
    if (!tenantRows.length) continue;

    const [orgRows] = await pool.query(
      "SELECT id FROM organization_units WHERE tenant_id = ? AND status = 'active' ORDER BY created_at LIMIT 1",
      [tenantId]
    );
    const orgUnitId = orgRows[0]?.id || null;

    const [existing] = await pool.query(
      "SELECT id FROM tenant_memberships WHERE tenant_id = ? AND user_id = ? LIMIT 1",
      [tenantId, user.id]
    );

    let membershipId = existing[0]?.id;
    if (!membershipId) {
      membershipId = `mem_${hash(`${tenantId}:${user.id}`)}`;
      await pool.query(
        `INSERT INTO tenant_memberships
           (id, tenant_id, user_id, employee_no, title, status, primary_org_unit_id,
            membership_auth_version, joined_at, left_at, invited_by, created_at, updated_at)
         VALUES (?, ?, ?, '', '', 'active', ?, 1, NOW(3), NULL, NULL, NOW(3), NOW(3))`,
        [membershipId, tenantId, user.id, orgUnitId]
      );
      createdMemberships += 1;
    }

    const roleCode = ROLE_CODE_BY_USER_ROLE[user.role] || "legacy_sales";
    const [roleRows] = await pool.query(
      "SELECT id FROM roles WHERE tenant_id = ? AND code = ? AND status = 'active' LIMIT 1",
      [tenantId, roleCode]
    );
    const roleId = roleRows[0]?.id;
    if (!roleId) continue;

    const [hasAssignment] = await pool.query(
      `SELECT id FROM member_role_assignments
       WHERE tenant_id = ? AND membership_id = ? AND role_id = ? AND status = 'active' LIMIT 1`,
      [tenantId, membershipId, roleId]
    );
    if (hasAssignment.length) continue;

    await pool.query(
      `INSERT INTO member_role_assignments
         (id, tenant_id, membership_id, role_id, scope_anchor_org_unit_id,
          valid_from, valid_until, status, reason, granted_by, revoked_by, revoked_at, created_at)
       VALUES (?, ?, ?, ?, NULL, NOW(3), NULL, 'active', '种子账号初始化', NULL, NULL, NULL, NOW(3))`,
      [`mra_${hash(`${tenantId}:${membershipId}:${roleId}`)}`, tenantId, membershipId, roleId]
    );
    createdAssignments += 1;
  }

  console.log(JSON.stringify({
    ok: true,
    usersScanned: users.length,
    createdMemberships,
    createdAssignments
  }));
} finally {
  await pool.end();
}
