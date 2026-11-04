#!/usr/bin/env bash
#
# 私人仓库（GoodJob_private）→ 公开版 SVN 工作副本（GoodJob_svn）同步工具
#
# 内容边界（与用户 2026-09-20 定的规则一致：只要功能，不要开发文档/备份/部署包）：
#   ① 【最权威的闸门】公开版已跟踪的文件 → 一律同步（它就是历次沉淀下来的功能边界）。
#      这样公开版绝不会因为规则误判而变陈旧。
#   ② 私人仓库 **SVN 已纳管** 的文件才会进入同步范围。
#      构建产物、测试产物、运行数据、本地未提交文件从不出现在 `svn ls` 里 → 自动被挡住。
#   ③ 剩下的（私人仓库纳管了、公开版还没有的）才按非功能规则过滤：
#      开发文档、原型稿、宝塔/私有 registry 部署包、发布工具自身。规则集中在下面的 awk 过滤器里。
#   ④ 只增改、不删。公开版有而私人仓库没有的文件（如 deploy-ubuntu.sh）保持原样。
#      要删公开版的文件请用显式 `svn delete`，不要指望本脚本。
#   ⑤ 目标工作副本的 URL 必须等于公开仓库，否则拒绝执行。
#
# 用法：
#   scripts/sync-public-working-copy.sh [--dry-run] [--list-excluded] [--exclude-prefix <路径前缀>]...
#
#   --dry-run              只预览将要发生的变更，不写盘
#   --list-excluded        额外打印被规则排除的清单及原因（用来核对边界）
#   --exclude-prefix <p>   本次显式排除某个路径前缀（可重复）。优先级**高于**「公开版已跟踪」，
#                          用于「某个模块暂时只留在私人仓库」的情形（如 whatsapp-web-translator）。
#                          只跳过「同步」，不会删除公开版里已存在的同名文件。
#   -h, --help             显示本说明
#
# 环境变量：
#   GOODJOB_PUBLIC_WORKING_COPY   公开版 SVN 工作副本路径（默认 ~/Desktop/GoodJob_svn）
#
# 注意：本脚本只负责「把文件放进公开版工作副本」，**不会** 执行 svn add / svn commit。
#       落盘后请人工复核 svn status，再走白名单式 svn add + svn commit。

set -euo pipefail

SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_ROOT="${GOODJOB_PUBLIC_WORKING_COPY:-/Users/sendohakria/Desktop/GoodJob_svn}"
EXPECTED_URL="svn://gitee.com/sendoh-huang/GoodJob"

# 安全下限：私人仓库当前已纳管 632 个文件、公开版已跟踪 524 个。低于下限说明 svn ls 出错或
# 工作副本异常，直接中止，避免因为拿到空清单而误判成「没有要同步的东西」。
MIN_TRACKED=500
MIN_PUBLIC=400

DRY_RUN=0
LIST_EXCLUDED=0
EXCLUDE_PREFIXES=()

usage() {
  awk '/^#!/{next} /^#/{sub(/^# ?/,""); print; next} {exit}' "${BASH_SOURCE[0]}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)        DRY_RUN=1 ;;
    --list-excluded)  LIST_EXCLUDED=1 ;;
    --exclude-prefix)
      [[ $# -ge 2 && -n "$2" ]] || { printf '%s\n' "--exclude-prefix 需要一个路径前缀" >&2; exit 2; }
      EXCLUDE_PREFIXES+=("$2"); shift ;;
    -h|--help)        usage; exit 0 ;;
    *) printf 'Usage: %s [--dry-run] [--list-excluded] [--exclude-prefix <路径前缀>]...\n' "$0" >&2; exit 2 ;;
  esac
  shift
done

# 拼成正则交替式（awk 里用 index() 逐项比对，这里只做去重与空值保护）
EXCLUDE_PREFIX_RE=""
if [[ ${#EXCLUDE_PREFIXES[@]} -gt 0 ]]; then
  EXCLUDE_PREFIX_RE="$(printf '%s\n' "${EXCLUDE_PREFIXES[@]}" | awk 'NF && !seen[$0]++' | paste -sd'|' -)"
fi

fail() { printf '%s\n' "$*" >&2; exit 1; }

[[ -d "$SOURCE_ROOT/.svn" ]] || fail "源不是 SVN 工作副本：$SOURCE_ROOT"
[[ -d "$TARGET_ROOT/.svn" ]] || fail "公开版工作副本不存在：$TARGET_ROOT"

actual_url="$(svn info --show-item url "$TARGET_ROOT")"
[[ "$actual_url" == "$EXPECTED_URL" ]] \
  || fail "拒绝同步：目标工作副本 URL 不是公开仓库。期望 $EXPECTED_URL，实际 $actual_url"

tmpdir="$(mktemp -d "${TMPDIR:-/tmp}/goodjob-public-sync.XXXXXX")"
trap 'rm -rf "$tmpdir"' EXIT

# ---------------------------------------------------------------------------
# ① 取私人仓库的已纳管清单
# ---------------------------------------------------------------------------
if ! ( cd "$SOURCE_ROOT" && svn ls -R . ) | grep -v '/$' | sort -u > "$tmpdir/tracked.txt"; then
  fail "读取私人仓库已纳管清单失败，请先确认工作副本正常（svn status）"
fi

tracked_count="$(wc -l < "$tmpdir/tracked.txt" | tr -d ' ')"
[[ "$tracked_count" -ge "$MIN_TRACKED" ]] \
  || fail "已纳管文件数异常：$tracked_count（下限 $MIN_TRACKED），拒绝继续"

# ---------------------------------------------------------------------------
# ② 取公开版已跟踪清单 —— 功能边界的权威依据（公开版已跟踪的一律同步，不让它变陈旧）
#    注意：以目标工作副本的 BASE 为准，所以流水线里必须先 `svn update` 再跑本脚本。
# ---------------------------------------------------------------------------
if ! ( cd "$TARGET_ROOT" && svn ls -R . ) | grep -v '/$' | sort -u > "$tmpdir/pub_tracked.txt"; then
  fail "读取公开版已跟踪清单失败，请先在 $TARGET_ROOT 执行 svn update"
fi

public_count="$(wc -l < "$tmpdir/pub_tracked.txt" | tr -d ' ')"
[[ "$public_count" -ge "$MIN_PUBLIC" ]] \
  || fail "公开版已跟踪文件数异常：$public_count（下限 $MIN_PUBLIC），拒绝继续。先在 $TARGET_ROOT 跑 svn update"

# ---------------------------------------------------------------------------
# ③ 内容过滤器
#    第一优先级：公开版已跟踪 → 一律同步（边界权威，绝不因规则误判而变陈旧）
#    其余（私人仓库纳管了、公开版还没有的）才按非功能规则判定：
#      命中 → 记入 excluded.txt（附原因）；未命中 → 输出到 stdout 作为同步候选。
# ---------------------------------------------------------------------------
cat > "$tmpdir/filter.awk" <<'AWK'
BEGIN {
  while ((getline line < pubfile) > 0) { if (line != "") pub_known[line] = 1 }
  close(pubfile)
  # 调用方显式排除的前缀（--exclude-prefix，多值用 | 分隔）
  n_unpref = 0
  if (unpref != "") n_unpref = split(unpref, upref, "|")
}
{
  p = $0
  if (p == "") next

  # ⓪ 调用方显式排除 —— 优先级最高，压过「公开版已跟踪」
  #    半开区间：前缀 "whatsapp-web-translator/" 不会误伤 "whatsapp-web-translator-x"
  for (ui = 1; ui <= n_unpref; ui++) {
    u = upref[ui]
    if (p == u || index(p, u) == 1) {
      print p "\t调用方本次显式排除（--exclude-prefix " u "）" > exfile
      next
    }
  }

  # ① 公开版已跟踪 —— 直接放行
  if (p in pub_known) { print p; next }

  bad = 0; reason = ""

  # ② 非公开模块（用户 2026-10-21 定：翻译插件只留私人仓库，公开库已 svn delete）
  if      (p ~ /^whatsapp-web-translator\//)                { bad=1; reason="非公开模块：翻译插件只留私人仓库" }

  # ③ 开发文档
  else if (p ~ /^docs\//)                                   { bad=1; reason="开发文档目录 docs/" }
  else if (p ~ /^whatsapp-plugin\/docs\//)                  { bad=1; reason="插件侧开发文档" }
  else if (p ~ /^whatsapp-plugin\/[^\/]*\.md$/)             { bad=1; reason="插件侧开发文档" }
  else if (p ~ /^[^\/]*\.md$/)                              { bad=1; reason="根目录内部文档" }

  # ③ 原型稿 / 设计预览
  else if (p ~ /^design-prototype\//)                       { bad=1; reason="设计原型稿" }
  else if (p ~ /^workbench-prototype\//)                    { bad=1; reason="工作台原型稿" }
  else if (p ~ /^frontend\/.*(原型|预览|副本)\.html$/)      { bad=1; reason="前端原型/预览稿" }
  else if (p == "frontend/外贸单证管理系统.html")            { bad=1; reason="前端原型/预览稿" }
  else if (p == "frontend/.impeccable.md")                  { bad=1; reason="设计工具产物" }

  # ④ 部署包 / 私有运维（宝塔专属、私有 registry）
  else if (p ~ /^deploy\/baota\//)                          { bad=1; reason="宝塔部署包（含 database/bootstrap.sql.gz）" }
  else if (p ~ /^deploy\/docker-compose\/(publish-images|update-registry|build-registry-package)\.sh$/) { bad=1; reason="私有 registry 运维脚本" }

  # ⑤ 发布工具自身 / 根目录私有脚本
  else if (p == "scripts/sync-public-working-copy.sh")      { bad=1; reason="发布工具自身" }
  else if (p ~ /^shot-[^\/]*\.mjs$/)                        { bad=1; reason="个人截图脚本" }
  else if (p == "verify-theme.mjs")                         { bad=1; reason="个人主题自检脚本" }
  else if (p == "publish-images.sh" || p == "update-registry.sh") { bad=1; reason="根目录私有运维包装脚本" }

  # ⑥ 兜底硬护栏（正常不会出现在已纳管清单里，出现即说明有问题）
  else if (p ~ /(^|\/)node_modules\//)                      { bad=1; reason="依赖目录" }
  else if (p ~ /(^|\/)dist\//)                              { bad=1; reason="构建产物" }
  else if (p ~ /^dist-packages\//)                          { bad=1; reason="部署包" }
  else if (p ~ /^database-backups\//)                       { bad=1; reason="数据库备份" }
  else if (p ~ /(^|\/)uploads\//)                           { bad=1; reason="运行时上传数据" }
  else if (p ~ /(^|\/)\.data\//)                            { bad=1; reason="运行时数据" }
  else if (p ~ /(^|\/)\.env\./ && p !~ /\.env\.example$/)   { bad=1; reason="本地环境文件" }
  else if (p ~ /\.tsbuildinfo$/)                            { bad=1; reason="增量构建信息" }
  else if (p ~ /\.(log|csv)$/)                              { bad=1; reason="日志/导出文件" }
  else if (p == ".DS_Store" || p ~ /\/\.DS_Store$/)         { bad=1; reason="macOS 元数据" }

  if (bad) { print p "\t" reason > exfile; next }
  print p
}
AWK

awk -v exfile="$tmpdir/excluded.txt" -v pubfile="$tmpdir/pub_tracked.txt" -v unpref="$EXCLUDE_PREFIX_RE" \
    -f "$tmpdir/filter.awk" "$tmpdir/tracked.txt" > "$tmpdir/keep_rule.txt"

# ---------------------------------------------------------------------------
# ④ 只保留磁盘上真实存在的文件；已纳管但缺失的单独列出来警告
# ---------------------------------------------------------------------------
: > "$tmpdir/sync.txt"
: > "$tmpdir/missing.txt"
while IFS= read -r p; do
  [[ -n "$p" ]] || continue
  if [[ -f "$SOURCE_ROOT/$p" ]]; then
    printf '%s\n' "$p" >> "$tmpdir/sync.txt"
  else
    printf '%s\n' "$p" >> "$tmpdir/missing.txt"
  fi
done < "$tmpdir/keep_rule.txt"

# 硬护栏复查：同步清单里一旦出现产物/隐私路径就中止（.env.example 属工程文件，放行）
HARD_GUARD='(^|/)(node_modules|dist|database-backups|uploads|\.data)/|(^|/)\.env\.|\.tsbuildinfo$|\.DS_Store$'
HARD_GUARD_ALLOW='(^|/)\.env\.example$'
guard_hits="$(grep -E "$HARD_GUARD" "$tmpdir/sync.txt" | grep -vE "$HARD_GUARD_ALLOW" || true)"
if [[ -n "$guard_hits" ]]; then
  printf '⛔ 同步清单里出现硬护栏禁止的路径，已中止：\n%s\n' "$guard_hits" >&2
  exit 1
fi

excluded_count="$(wc -l < "$tmpdir/excluded.txt" 2>/dev/null | tr -d ' ' || echo 0)"
unpref_count="$(grep -c '调用方本次显式排除' "$tmpdir/excluded.txt" 2>/dev/null || true)"
unpref_count="${unpref_count:-0}"
sync_count="$(wc -l < "$tmpdir/sync.txt" | tr -d ' ')"
missing_count="$(wc -l < "$tmpdir/missing.txt" | tr -d ' ')"
pub_synced="$(comm -12 "$tmpdir/pub_tracked.txt" <(sort "$tmpdir/sync.txt") | wc -l | tr -d ' ')"
new_synced="$(( sync_count - pub_synced ))"

printf '\n【同步范围】\n'
printf '  私人仓库已纳管   : %s\n' "$tracked_count"
printf '  公开版已跟踪     : %s\n' "$public_count"
printf '  规则排除（非功能）: %s\n' "$excluded_count"
if [[ "$unpref_count" -gt 0 ]]; then
  printf '  本次显式排除     : %s（--exclude-prefix %s；公开版已有同名文件保持原样，不删）\n' \
    "$unpref_count" "$EXCLUDE_PREFIX_RE"
fi
printf '  磁盘缺失（不同步）: %s\n' "$missing_count"
printf '  本次同步清单     : %s（公开版已有的 %s ＋ 新增 %s）\n' "$sync_count" "$pub_synced" "$new_synced"
printf '  目标工作副本     : %s\n' "$TARGET_ROOT"

if [[ "$missing_count" -gt 0 ]]; then
  printf '\n⚠️  私人仓库已纳管但磁盘上不存在（未纳入同步，公开版对应文件保持原样）：\n'
  sed 's/^/     /' "$tmpdir/missing.txt"
fi

if [[ "$LIST_EXCLUDED" -eq 1 && "$excluded_count" -gt 0 ]]; then
  printf '\n【被规则排除的清单】\n'
  awk -F'\t' '{ printf "     %-58s %s\n", $1, $2 }' "$tmpdir/excluded.txt"
fi

# ---------------------------------------------------------------------------
# ⑤ 同步（只增改，不删；--checksum 保证按内容比对，不依赖时间戳）
# ---------------------------------------------------------------------------
printf '\n【变更明细】\n'
rsync_args=( -a --checksum --itemize-changes --files-from="$tmpdir/sync.txt" )
if [[ "$DRY_RUN" -eq 1 ]]; then
  rsync_args+=( --dry-run )
  printf '  （--dry-run 预览，未写盘）\n'
fi
rsync "${rsync_args[@]}" "$SOURCE_ROOT/" "$TARGET_ROOT/"

if [[ "$DRY_RUN" -eq 1 ]]; then
  printf '\n预览结束。确认无误后去掉 --dry-run 再执行。\n'
  exit 0
fi

# ---------------------------------------------------------------------------
# ⑥ 落盘后自检：新增待纳管清单 + 残渣警示 + 数据库安全守卫
# ---------------------------------------------------------------------------
( cd "$TARGET_ROOT" && svn status ) | awk 'substr($0,1,1)=="?" { print substr($0,9) }' | sort > "$tmpdir/tgt_untracked.txt"

sort "$tmpdir/sync.txt" > "$tmpdir/sync.sorted.txt"
comm -12 "$tmpdir/sync.sorted.txt" "$tmpdir/tgt_untracked.txt" > "$tmpdir/to_add.txt"
comm -13 "$tmpdir/sync.sorted.txt" "$tmpdir/tgt_untracked.txt" > "$tmpdir/junk.txt"

to_add_count="$(wc -l < "$tmpdir/to_add.txt" | tr -d ' ')"
junk_count="$(wc -l < "$tmpdir/junk.txt" | tr -d ' ')"

printf '\n【下一步：需要 svn add 的新增文件】%s 个\n' "$to_add_count"
if [[ "$to_add_count" -gt 0 ]]; then
  sed 's/^/     /' "$tmpdir/to_add.txt"
else
  printf '     （无）\n'
fi

if [[ "$junk_count" -gt 0 ]]; then
  printf '\n⚠️  公开版工作副本里还有 %s 个《未纳管、且不在本次同步范围》的残渣。\n' "$junk_count"
  printf '    它们不会被 svn commit 带上，但建议清理，避免哪天被批量 add 误提交：\n'
  sed 's/^/     /' "$tmpdir/junk.txt"
fi

printf '\n【数据库安全守卫】\n'
if ( cd "$TARGET_ROOT" && npm run --silent svn:check-database ); then
  :
else
  printf '\n⛔ 数据库安全守卫未通过 —— 先处理上面的问题，不要提交。\n' >&2
  exit 1
fi

printf '\n完成。请复核后按白名单式提交：\n'
printf '  cd %s\n' "$TARGET_ROOT"
printf '  svn status | grep -E "^[AM]"        # 复核清单\n'
printf '  svn add <上面列出的新增文件>         # 显式列路径，禁止 svn add .\n'
printf '  svn commit --non-interactive -m "<版本号>版本" <显式路径>\n'
