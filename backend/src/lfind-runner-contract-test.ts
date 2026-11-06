import { readdirSync, readFileSync } from "node:fs";
import { strict as assert } from "node:assert";

// server.ts 已拆分为入口 + server-core.ts + routes/*.ts：合并读取全部 HTTP 源码
const server = ["server.ts", "server-core.ts", ...readdirSync(new URL("./routes/", import.meta.url)).filter((f) => f.endsWith(".ts")).sort().map((f) => `routes/${f}`)]
  .map((file) => readFileSync(new URL(`./${file}`, import.meta.url), "utf8")).join("\n");

assert.match(server, /const lfindResultSchema = z\.object/, "Lfind result schema must be validated before sync");
assert.match(server, /Use \$lfind\./, "Runner prompt must explicitly invoke the Lfind skill");
assert.match(server, /\/api\/lead-finder\/lfind-tasks/, "Backend must expose Lfind task launch and status endpoints");
assert.match(server, /filterExistingCrmOpportunities\(rawOpportunities, store, user\.teamId\)/, "Lfind results must be filtered against existing CRM records");
assert.match(server, /persistProviderOpportunities\(existingFilter\.opportunities/, "Lfind results must enter the normal prospect persistence path");
assert.match(server, /scheduleContactEnrichment\(user, candidateId, runId\)/, "Lfind candidates must continue through contact enrichment");
assert.match(server, /lfindSearchReportSchema/, "Lfind must accept row-level search reports for CRM display");
assert.match(server, /lfindOpportunityHasSourceBackedContact/, "Lfind sync must reject candidates without source-backed contacts");
assert.match(server, /reason: "no_contact"/, "Lfind contactless candidates must be returned with a concrete filter reason");

console.log(JSON.stringify({ ok: true, checked: "lfind-runner-contract" }, null, 2));
