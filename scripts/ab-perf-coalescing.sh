#!/usr/bin/env bash
# 写合并优化 A/B 对照：同一批体验指标，分别在「优化后」与「优化前（stash 回退）」下测量。
# 只 stash backend/src/mysql-store.ts —— 合并逻辑与其调用点都在这个文件里。
set -uo pipefail
B=http://127.0.0.1:4290
DB() { mysql -uecore -p8b3b468bd1ed53af31bd4bae853a97f7 -h127.0.0.1 ecore_crm -N -B -e "$1" 2>/dev/null; }

wait_health() {
  for _ in $(seq 1 40); do
    [ "$(curl -s -m 3 --noproxy '*' -o /dev/null -w '%{http_code}' $B/api/health)" = "200" ] && return 0
    sleep 1
  done
  echo "  后端未就绪"; return 1
}

bench() {
  local label="$1"
  local TOK IDS
  TOK=$(curl -s --noproxy '*' -X POST $B/api/auth/login -H 'content-type: application/json' \
    -d '{"email":"admin@goodjob.com","password":"goodjob123"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])" 2>/dev/null)
  IDS=$(curl -s --noproxy '*' "$B/api/customers?scope=team" -H "authorization: Bearer $TOK" \
    | python3 -c "import sys,json;d=json.load(sys.stdin);print(' '.join(c['id'] for c in d['customers'][:5]))" 2>/dev/null)
  set -- $IDS
  local n=$#
  [ "$n" -lt 2 ] && { echo "  [$label] 客户不足，跳过"; return 1; }

  echo "  [$label]"

  # 指标 1：单次写延迟（3 次取均值）
  local sum=0 ms
  for i in 1 2 3; do
    local id; id=$(echo $IDS | awk -v i=$i '{print $i}')
    ms=$(curl -s --noproxy '*' -o /dev/null -w '%{time_total}' -X PATCH "$B/api/customers/$id" \
      -H "authorization: Bearer $TOK" -H 'content-type: application/json' -d "{\"contactRemark\":\"ab$i\"}" \
      | python3 -c "import sys;print(round(float(sys.stdin.read())*1000))")
    sum=$((sum+ms))
  done
  echo "    单次写延迟均值: $((sum/3))ms"

  # 指标 2：5 个并发写的总墙钟
  local t0 t1
  t0=$(python3 -c "import time;print(time.time())")
  for id in $IDS; do
    curl -s --noproxy '*' -o /dev/null -X PATCH "$B/api/customers/$id" \
      -H "authorization: Bearer $TOK" -H 'content-type: application/json' -d '{"contactRemark":"ab并发"}' &
  done
  wait
  t1=$(python3 -c "import time;print(time.time())")
  echo "    5 并发写总耗时: $(python3 -c "print(round(($t1-$t0)*1000))")ms"

  # 指标 3：写后立刻读一致性
  local cid mark api_val db_val
  cid=$(echo $IDS | awk '{print $1}')
  mark="AB一致性$(date +%s)"
  curl -s --noproxy '*' -o /dev/null -X PATCH "$B/api/customers/$cid" \
    -H "authorization: Bearer $TOK" -H 'content-type: application/json' -d "{\"contactRemark\":\"$mark\"}"
  api_val=$(curl -s --noproxy '*' "$B/api/customers?scope=team" -H "authorization: Bearer $TOK" \
    | python3 -c "import sys,json;d=json.load(sys.stdin);print([c.get('contactRemark') for c in d['customers'] if c['id']=='$cid'][0])" 2>/dev/null)
  sleep 1
  db_val=$(DB "select coalesce(nullif(contact_remark,''),'(空)') from customers where id='$cid'")
  [ "$api_val" = "$mark" ] && echo "    写后立刻读(接口): ✅" || echo "    写后立刻读(接口): ❌ 读到=$api_val"
  [ "$db_val" = "$mark" ] && echo "    1 秒后已落库: ✅" || echo "    1 秒后已落库: ❌ 库=$db_val"

  # 还原
  for id in $IDS; do
    curl -s --noproxy '*' -o /dev/null -X PATCH "$B/api/customers/$id" \
      -H "authorization: Bearer $TOK" -H 'content-type: application/json' -d '{"contactRemark":""}'
  done
}

cd ~/Desktop/ECORECRM
echo "════════ A. 优化后（当前代码）════════"
wait_health && bench "优化后"

echo
echo "════════ B. 优化前（stash 回退 mysql-store.ts）════════"
git stash push -q -- backend/src/mysql-store.ts && echo "  已回退，等待后端重启…"
sleep 3
wait_health && bench "优化前"

echo
echo "════════ C. 恢复优化后（stash pop）════════"
git stash pop -q && echo "  已恢复，等待后端重启…"
sleep 3
wait_health && bench "优化后(复位)"

echo
echo "工作副本状态："
git status --short backend/src/mysql-store.ts
