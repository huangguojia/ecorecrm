#!/usr/bin/env bash
# 写合并优化（createCoalescingPersistence）的体验验收
# 覆盖：写入延迟不退化 / 写后立即可读 / 连点不丢 / 并发不丢 / 混合负载响应时间
# 用法：bash scripts/verify-perf-ux.sh   （需要后端 4290 + 本地 MySQL）
set -uo pipefail

B=${B:-http://127.0.0.1:4290}
DB() { mysql -uecore -p8b3b468bd1ed53af31bd4bae853a97f7 -h127.0.0.1 ecore_crm -N -B -e "$1" 2>/dev/null; }
Q() { DB "SHOW GLOBAL STATUS LIKE 'Questions'" | awk '{print $2}'; }
PASS=0; FAIL=0
ok() { PASS=$((PASS+1)); printf '  \033[32m✓\033[0m %s\n' "$1"; }
no() { FAIL=$((FAIL+1)); printf '  \033[31m✗\033[0m %s  %s\n' "$1" "${2:-}"; }

TOK=$(curl -s --noproxy '*' -X POST $B/api/auth/login -H 'content-type: application/json' \
  -d '{"email":"admin@goodjob.com","password":"goodjob123"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
[ -z "$TOK" ] && { echo "登录失败"; exit 1; }
AH="authorization: Bearer $TOK"
CT='content-type: application/json'
TS=$(date +%s)
CREATED_CUST=()

jget() { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)" 2>/dev/null; }

echo "═══ 1. 单次写操作延迟（体验基线）════════════════"
IDS=$(curl -s --noproxy '*' "$B/api/customers?scope=team" -H "$AH" \
  | jget "' '.join(c['id'] for c in d['customers'][:6])")
N=$(echo $IDS | wc -w | tr -d ' ')
[ "$N" -lt 3 ] && { echo "客户太少（$N），跳过延迟基线"; }
for i in 1 2 3; do
  ID=$(echo $IDS | awk -v i=$i '{print $i}')
  T=$(curl -s --noproxy '*' -o /dev/null -w '%{time_total}' -X PATCH "$B/api/customers/$ID" \
    -H "$AH" -H "$CT" -d "{\"contactRemark\":\"延迟基线$i\"}")
  MS=$(python3 -c "print(round($T*1000))")
  echo "  第 $i 次 PATCH: ${MS}ms"
  LAST_MS=$MS
done
[ "${LAST_MS:-9999}" -lt 800 ] && ok "单次写延迟 ${LAST_MS}ms < 800ms（用户无感）" \
  || no "单次写延迟偏高" "${LAST_MS}ms"

echo
echo "═══ 2. 写后立即可读（不出现「保存了但界面看不到」）════"
CID=$(echo $IDS | awk '{print $1}')
MARK="可读校验${TS}"
curl -s --noproxy '*' -o /dev/null -X PATCH "$B/api/customers/$CID" -H "$AH" -H "$CT" -d "{\"contactRemark\":\"$MARK\"}"
# 立刻读接口（前端刷新列表走这条）
V_API=$(curl -s --noproxy '*' "$B/api/customers?scope=team" -H "$AH" \
  | jget "[c.get('contactRemark') for c in d['customers'] if c['id']=='$CID'][0]")
[ "$V_API" = "$MARK" ] && ok "写后立刻 GET 列表即可读到新值" || no "写后读不到新值" "读到=$V_API"

# 模拟最坏情况：写后请求会触发 readBarrier 的接口（跨过 1s 新鲜度窗口，强制真读库），
# 检查未落库变更是否被旧库快照覆盖回内存（这是写合并最危险的退化）
curl -s --noproxy '*' -o /dev/null "$B/api/prospect-runs" -H "$AH"
sleep 1.2
curl -s --noproxy '*' -o /dev/null "$B/api/prospect-runs" -H "$AH"
curl -s --noproxy '*' -o /dev/null "$B/api/prospect-campaigns" -H "$AH"
V_AFTER=$(curl -s --noproxy '*' "$B/api/customers?scope=team" -H "$AH" \
  | jget "[c.get('contactRemark') for c in d['customers'] if c['id']=='$CID'][0]")
[ "$V_AFTER" = "$MARK" ] && ok "强制全量 reload 后数据未被旧库快照覆盖" || no "reload 覆盖了未落库变更" "读到=$V_AFTER"
curl -s --noproxy '*' -o /dev/null -X PATCH "$B/api/customers/$CID" -H "$AH" -H "$CT" -d '{"contactRemark":""}'

echo
echo "═══ 3. 连点保存（同一实体连续写，最后一次必须生效）══"
TARGET=$(echo $IDS | awk '{print $2}')

# 3a. 顺序连点：用户点保存 → 等响应 → 再点。最后一次必须赢。
for i in 1 2 3 4 5; do
  curl -s --noproxy '*' -o /dev/null -X PATCH "$B/api/customers/$TARGET" -H "$AH" -H "$CT" \
    -d "{\"contactRemark\":\"顺序第${i}次\"}"
done
SEQF=$(curl -s --noproxy '*' "$B/api/customers?scope=team" -H "$AH" \
  | jget "[c.get('contactRemark') for c in d['customers'] if c['id']=='$TARGET'][0]")
SEQD=$(DB "select coalesce(nullif(contact_remark,''),'(空)') from customers where id='$TARGET'")
[ "$SEQF" = "顺序第5次" ] && ok "顺序连点：接口最终 = 第 5 次" || no "顺序连点接口值不对" "读到=$SEQF"
[ "$SEQD" = "顺序第5次" ] && ok "顺序连点：库最终 = 第 5 次（无丢失）" || no "顺序连点库值不对" "库=$SEQD"

# 3b. 并发连点：5 个请求并行（浏览器手滑双击 / 网络重发）。到达顺序不确定，
# 因此断言「接口与库一致」+「结果是 5 个候选之一」+「不是旧值」。
OLD=$(DB "select coalesce(nullif(contact_remark,''),'(空)') from customers where id='$TARGET'")
for i in 1 2 3 4 5; do
  curl -s --noproxy '*' -o /dev/null -X PATCH "$B/api/customers/$TARGET" -H "$AH" -H "$CT" \
    -d "{\"contactRemark\":\"并发第${i}次\"}" &
done
wait
sleep 0.4
CF=$(curl -s --noproxy '*' "$B/api/customers?scope=team" -H "$AH" \
  | jget "[c.get('contactRemark') for c in d['customers'] if c['id']=='$TARGET'][0]")
CD=$(DB "select coalesce(nullif(contact_remark,''),'(空)') from customers where id='$TARGET'")
[ "$CF" = "$CD" ] && ok "并发连点：接口与库一致（${CF}）" || no "并发后接口与库不一致" "接口=$CF 库=$CD"
case "$CF" in
  并发第[1-5]次) ok "并发连点：最终值是某个真实提交（未丢成旧值 ${OLD}）" ;;
  *) no "并发后出现旧值或空值" "读到=$CF" ;;
esac
curl -s --noproxy '*' -o /dev/null -X PATCH "$B/api/customers/$TARGET" -H "$AH" -H "$CT" -d '{"contactRemark":""}'

echo
echo "═══ 4. 并发写不同实体（多人同时操作，不能互相覆盖）════"
declare -a BEFORE
i=0
for ID in $IDS; do
  [ $i -ge 4 ] && break
  curl -s --noproxy '*' -o /dev/null -X PATCH "$B/api/customers/$ID" -H "$AH" -H "$CT" \
    -d "{\"contactRemark\":\"并发标签$i-$TS\"}" &
  i=$((i+1))
done
wait
sleep 0.5
i=0; ALLOK=1
for ID in $IDS; do
  [ $i -ge 4 ] && break
  DBV=$(DB "select coalesce(nullif(contact_remark,''),'(空)') from customers where id='$ID'")
  [ "$DBV" != "并发标签$i-$TS" ] && { ALLOK=0; echo "    $ID 期望=并发标签$i-$TS 实际=$DBV"; }
  i=$((i+1))
done
[ "$ALLOK" = "1" ] && ok "4 个并发写各自的变更全部落库，无互相覆盖" || no "并发写出现互相覆盖"

# 清理
i=0
for ID in $IDS; do
  [ $i -ge 4 ] && break
  curl -s --noproxy '*' -o /dev/null -X PATCH "$B/api/customers/$ID" -H "$AH" -H "$CT" -d '{"contactRemark":""}'
  i=$((i+1))
done

echo
echo "═══ 5. 新建实体后立刻可见（含落库）════════════════"
CNAME="UX性能客户${TS}"
NNEW=$(curl -s --noproxy '*' -X POST $B/api/customers -H "$AH" -H "$CT" \
  -d "{\"company\":\"$CNAME\",\"contact\":\"测试\",\"lifecycleStatus\":\"open\"}" | jget "d.get('customer',{}).get('id','')")
[ -n "$NNEW" ] && CREATED_CUST+=("$NNEW")
INLIST=$(curl -s --noproxy '*' "$B/api/customers?scope=team" -H "$AH" \
  | jget "1 if any(c['id']=='$NNEW' for c in d['customers']) else 0")
[ "$INLIST" = "1" ] && ok "新建客户后列表立刻包含" || no "新建客户列表不可见"
INDB=$(DB "select count(*) from customers where id='$NNEW'")
[ "$INDB" = "1" ] && ok "新建客户已落库" || no "新建客户未落库" "行数=$INDB"

echo
echo "═══ 6. 混合负载响应时间（P50 / P95 不能劣化）════════"
LAT=()
for r in 1 2 3; do
  for ep in "customers?scope=team" "suppliers" "trade-documents" "dashboard/summary" "internal-messages/unread-count"; do
    T=$(curl -s --noproxy '*' -o /dev/null -w '%{time_total}' "$B/api/$ep" -H "$AH")
    LAT+=("$(python3 -c "print(round($T*1000))")")
  done
done
STATS=$(printf '%s\n' "${LAT[@]}" | python3 -c "
import sys
v=sorted(int(x) for x in sys.stdin if x.strip())
n=len(v)
p50=v[n//2]; p95=v[min(n-1,int(n*0.95))]
print(f'{p50} {p95} {v[-1]}')
")
P50=$(echo $STATS | cut -d' ' -f1); P95=$(echo $STATS | cut -d' ' -f2); MAX=$(echo $STATS | cut -d' ' -f3)
echo "  读接口 P50=${P50}ms  P95=${P95}ms  MAX=${MAX}ms（${#LAT[@]} 次采样）"
[ "$P95" -lt 300 ] && ok "读接口 P95 ${P95}ms < 300ms" || no "读接口 P95 偏高" "${P95}ms"
[ "$MAX" -lt 800 ] && ok "读接口最慢 ${MAX}ms < 800ms（无卡顿感）" || no "存在慢请求" "${MAX}ms"

echo
echo "═══ 7. 空闲时不自增写入（优化未变成「空转全量重写」）════"
# persistAll 每轮必然产生 93 条 DELETE FROM + 大量 INSERT。
# 若合并队列有 bug（例如 dirty 被反复置起），空闲期 Com_delete 会持续增长。
# 先静置让前面测试的写操作余波落干净，否则会把自己造成的 DELETE 误判成空转。
sleep 15
SNAP() { DB "SHOW GLOBAL STATUS" | awk '$1=="Com_delete"||$1=="Com_insert"||$1=="Com_select"||$1=="Com_update"||$1=="Questions"{print $1"="$2}'; }
A=$(SNAP); sleep 20; Bq=$(SNAP)
python3 - "$A" "$Bq" <<'PY'
import sys
a=dict(x.split('=') for x in sys.argv[1].split())
b=dict(x.split('=') for x in sys.argv[2].split())
d={k:int(b[k])-int(a.get(k,0)) for k in b}
open('/tmp/ux-idle.env','w').write(" ".join(f"{k}={v}" for k,v in d.items()))
print("  静置 15s 后采样 20s：", "  ".join(f"{k.replace('Com_','')}={v}" for k,v in d.items()))
PY
. /tmp/ux-idle.env
IDLE_Q=$((Questions/20))
echo "  空闲 QPS ≈ ${IDLE_Q}"
[ "${Com_delete:-0}" -eq 0 ] && ok "空闲期 Com_delete=0（无空转全量重写）" \
  || no "空闲期出现 DELETE" "Com_delete=${Com_delete}（一次 persistAll 会是 93）"
[ "${Com_insert:-0}" -lt 10 ] && ok "空闲期 Com_insert=${Com_insert:-0}（无空转落库）" \
  || no "空闲期出现大量 INSERT" "Com_insert=${Com_insert}"
[ "${IDLE_Q:-99}" -lt 15 ] && ok "空闲 QPS ${IDLE_Q} < 15（无读放大）" \
  || no "空闲读放大" "${IDLE_Q} QPS"

# 清理
for id in "${CREATED_CUST[@]:-}"; do
  [ -n "$id" ] && curl -s --noproxy '*' -o /dev/null -X POST $B/api/customers/bulk-delete \
    -H "$AH" -H "$CT" -d "{\"ids\":[\"$id\"]}"
done
[ "${#CREATED_CUST[@]}" -gt 0 ] && echo "  （已清理测试客户 ${#CREATED_CUST[@]} 条）"

echo
printf '══════════════════════════════════\n'
printf '  体验验收：PASS=%s  FAIL=%s\n' "$PASS" "$FAIL"
printf '══════════════════════════════════\n'
[ "$FAIL" = "0" ]
