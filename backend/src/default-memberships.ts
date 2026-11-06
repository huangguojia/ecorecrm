import { createHash } from "node:crypto";
import type mysql from "mysql2/promise";

/**
 * 为没有 IAM 成员身份的活跃账号补齐 `tenant_memberships` + `member_role_assignments`。
 *
 * 背景（ECORECRM 2026-11-06 实测）：README 的顺序是「迁移 → 补成员身份脚本 → 启动」，
 * 但开发种子账号（admin / mia / alex / shirley）是**首次启动服务时**才写进 users 表的，
 * 补身份脚本运行时它们还不存在 → 这些账号登录后所有接口都 403「公司已暂停或成员身份已失效」。
 * 所以写入种子账号后，由服务端自己补齐，不再依赖手工步骤的先后顺序。
 *
 * 逻辑与 scripts/seed-default-memberships.mjs 一致，幂等：已有身份 / 角色绑定就跳过。
 * 只在开发种子数据开启时调用（正式库里缺身份的账号可能是被有意移除的，不能自动补回）。
 */
const ROLE_CODE_BY_USER_ROLE: Record<string, string> = {
  admin: "legacy_admin",
  manager: "legacy_manager",
  sales: "legacy_sales",
  super_admin: "legacy_admin"
};

const sha1 = (value: string) => createHash("sha1").update(value).digest("hex");

export async function ensureDefaultMemberships(pool: mysql.Pool) {
  let createdMemberships = 0;
  let createdAssignments = 0;
  const [users] = await pool.query<mysql.RowDataPacket[]>(
    "SELECT id, role, team_id FROM users WHERE status = 'active' AND team_id <> 'all'"
  );
  for (const user of users) {
    const tenantId = String(user.team_id || "").trim();
    if (!tenantId) continue;
    const [tenantRows] = await pool.query<mysql.RowDataPacket[]>("SELECT id FROM tenants WHERE id = ? LIMIT 1", [tenantId]);
    if (!tenantRows.length) continue;
    const [orgRows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT id FROM organization_units WHERE tenant_id = ? AND status = 'active' ORDER BY created_at LIMIT 1",
      [tenantId]
    );
    const orgUnitId = orgRows[0]?.id || null;
    const [existing] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT id FROM tenant_memberships WHERE tenant_id = ? AND user_id = ? LIMIT 1",
      [tenantId, user.id]
    );
    let membershipId = existing[0]?.id as string | undefined;
    if (!membershipId) {
      membershipId = `mem_${sha1(`${tenantId}:${user.id}`)}`;
      await pool.query(
        `INSERT INTO tenant_memberships
           (id, tenant_id, user_id, employee_no, title, status, primary_org_unit_id,
            membership_auth_version, joined_at, left_at, invited_by, created_at, updated_at)
         VALUES (?, ?, ?, '', '', 'active', ?, 1, NOW(3), NULL, NULL, NOW(3), NOW(3))`,
        [membershipId, tenantId, user.id, orgUnitId]
      );
      createdMemberships += 1;
    }
    const roleCode = ROLE_CODE_BY_USER_ROLE[String(user.role)] || "legacy_sales";
    const [roleRows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT id FROM roles WHERE tenant_id = ? AND code = ? AND status = 'active' LIMIT 1",
      [tenantId, roleCode]
    );
    const roleId = roleRows[0]?.id as string | undefined;
    if (!roleId) continue;
    const [hasAssignment] = await pool.query<mysql.RowDataPacket[]>(
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
      [`mra_${sha1(`${tenantId}:${membershipId}:${roleId}`)}`, tenantId, membershipId, roleId]
    );
    createdAssignments += 1;
  }
  return { usersScanned: users.length, createdMemberships, createdAssignments };
}
