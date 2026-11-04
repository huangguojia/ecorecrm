#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# Stable entry point for a Baota manual/ scheduled task. Routine image updates
# only need a new release argument; deployment packages are not uploaded again.
APP_ROOT="${GOODJOB_APP_ROOT:-/opt/goodjobcrm}"
SHARED_DIR="$APP_ROOT/shared"
ENV_FILE="$SHARED_DIR/deploy.env"
RUNTIME_DIR="${GOODJOB_UPDATE_RUNTIME:-$APP_ROOT/ops/runtime}"
LOCK_FILE="$APP_ROOT/baota-update.lock"

log() { printf '[GoodJob 宝塔更新] %s\n' "$*"; }
die() { printf '[GoodJob 宝塔更新][错误] %s\n' "$*" >&2; exit 1; }

[[ "${EUID:-$(id -u)}" -eq 0 ]] || die "计划任务必须使用 root 权限执行"
command -v docker >/dev/null 2>&1 || die "缺少 Docker"
command -v flock >/dev/null 2>&1 || die "缺少 flock"
[[ -s "$ENV_FILE" ]] || die "找不到生产配置：$ENV_FILE"
[[ -x "$RUNTIME_DIR/update-registry.sh" ]] \
  || die "找不到稳定更新脚本：$RUNTIME_DIR/update-registry.sh；请先完成一次性安装"

install -d -m 0700 "$(dirname "$LOCK_FILE")"
exec 9>"$LOCK_FILE"
flock -n 9 || die "已有另一项 GoodJob 更新正在执行，请稍后查看计划任务日志"

set -a
source "$ENV_FILE"
set +a

release="${1:-}"
[[ "$release" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] \
  || die "请在宝塔计划任务中填写版本号，例如：$0 1.6.7"

current_release="$(cat "$SHARED_DIR/state/current-release" 2>/dev/null || true)"
if [[ -n "$current_release" && "$current_release" == "$release" ]]; then
  log "当前已经是 $release，跳过重复更新"
  exit 0
fi

export GOODJOB_RELEASE_ID="$release"
log "开始执行 Docker 备份、迁移、更新和健康检查：$release"
"$RUNTIME_DIR/update-registry.sh" "$release"

log "更新完成：$release"
