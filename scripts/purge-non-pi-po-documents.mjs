#!/usr/bin/env node
/**
 * ECORECRM：永久删除 PI / PO 以外的外贸单据（CI、PL、合同、报价单、原产地、装运通知、报关资料等）。
 *
 * 2026-11-06 用户决定：单据平台只保留 PI 与 PO，库里已有的其它单据永久删除，不可恢复。
 *
 * 默认只预览（列出将要删除的单据，不改库）；加 --apply 才真正删除。
 * 执行前请先备份数据库，例如：
 *   mysqldump --single-transaction ecore_crm trade_documents > trade_documents-backup.sql
 *
 * 用法（必须走档位包装脚本，确保连的是 ecore_crm）：
 *   node scripts/run-with-profile.mjs development node scripts/purge-non-pi-po-documents.mjs
 *   node scripts/run-with-profile.mjs development node scripts/purge-non-pi-po-documents.mjs --apply
 *
 * 注意：后端服务运行时会把内存里的单据整表写回数据库，请先停掉服务再执行 --apply，
 * 否则服务下一次保存可能把刚删掉的单据重新写回去。
 */
import process from "node:process";
import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL || process.env.MYSQL_URL;
if (!url) {
  console.error("缺少 DATABASE_URL，请用 scripts/run-with-profile.mjs 启动");
  process.exit(2);
}
const apply = process.argv.includes("--apply");
const pool = mysql.createPool({ uri: url, connectionLimit: 1 });
try {
  const [rows] = await pool.query(
    "SELECT id, type, number, title FROM trade_documents WHERE type NOT IN ('PI', 'PO') ORDER BY type, number"
  );
  const byType = {};
  for (const row of rows) byType[row.type] = (byType[row.type] || 0) + 1;
  console.log(JSON.stringify({ mode: apply ? "apply" : "preview", toDelete: rows.length, byType }, null, 2));
  for (const row of rows.slice(0, 50)) console.log(`  ${row.type}\t${row.number}\t${row.title}`);
  if (rows.length > 50) console.log(`  …另有 ${rows.length - 50} 份`);
  if (!apply) {
    console.log(rows.length ? "预览完成，未改动数据库。确认无误后加 --apply 执行删除（先停服务、先备份）。" : "没有需要删除的单据。");
  } else if (rows.length) {
    const [result] = await pool.query("DELETE FROM trade_documents WHERE type NOT IN ('PI', 'PO')");
    console.log(`已删除 ${result.affectedRows} 份单据。`);
  }
} finally {
  await pool.end();
}
