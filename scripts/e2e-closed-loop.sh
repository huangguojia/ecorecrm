#!/bin/bash
# ECORE GLOBAL — 端到端闭环验收（自清理）
# 覆盖：客户 → 商机阶段机 → 成交自动建单 → 单据全生命周期 → 订单状态机 → 级联删除
B=http://127.0.0.1:4290
# 等后端就绪：热重载期间会短暂 502，避免把「服务未起」误判成业务失败
for i in $(seq 1 40); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' $B/api/health)" = "200" ] && break
  sleep 2
done
[ "$(curl -s -o /dev/null -w '%{http_code}' $B/api/health)" = "200" ] || { echo "后端未就绪：$B"; exit 1; }
TOK=$(curl -s -X POST $B/api/auth/login -H 'content-type: application/json' \
  -d '{"email":"admin@goodjob.com","password":"goodjob123"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))")
AUTH="authorization: Bearer $TOK"; CT="content-type: application/json"
PASS=0; FAIL=0
ok(){ PASS=$((PASS+1)); printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
no(){ FAIL=$((FAIL+1)); printf '  \033[31mFAIL\033[0m  %s  << %s\n' "$1" "$2"; }
code(){ curl -s -o /tmp/c.json -w '%{http_code}' "$@"; }
msg(){ head -c 120 /tmp/c.json; }
is2xx(){ [ "${1:0:1}" = "2" ]; }
# 取值：Python 表达式直接拼接，避免引号嵌套导致 eval 语法错误
pick(){ python3 -c "import json;d=json.load(open('/tmp/c.json'));v=$1;print(v if v is not None else '')" 2>/dev/null; }

TS=$(date +%H%M%S)
echo "═══ 一、客户与商机 ═══"
C=$(code -X POST $B/api/customers -H "$AUTH" -H "$CT" \
  -d "{\"company\":\"E2E $TS\",\"country\":\"Germany\",\"contactName\":\"Hans Weber\",\"email\":\"hans$TS@e2e.example\",\"source\":\"展会\",\"level\":\"A\"}")
CID=$(pick "(d.get('customer') or d).get('id','')")
is2xx $C && [ -n "$CID" ] && ok "新建客户 $CID" || no "新建客户" "$C $(msg)"

C=$(code -X POST $B/api/customers -H "$AUTH" -H "$CT" \
  -d "{\"company\":\"E2E $TS\",\"country\":\"Germany\"}")
DUP_OWNER=$(pick "d.get('ownerName','')")
DUP_MSG=$(pick "d.get('message','')")
# 只回 409 不够：业务员要能看出「这家已经在同事手里」，所以连归属人一起校验
[ "$C" = "409" ] && [ "$DUP_OWNER" = "本人" ] && ok "同国同名去重 409，并回传归属人（本人）" \
  || no "重复客户应 409 且带归属人" "$C owner=$DUP_OWNER $DUP_MSG"

C=$(code -X POST $B/api/deals -H "$AUTH" -H "$CT" \
  -d "{\"customerId\":\"$CID\",\"title\":\"E2E 商机\",\"product\":\"Industrial Sensor\",\"quantity\":10,\"unitPrice\":4200,\"nextAction\":\"发首轮报价\",\"nextActionAt\":\"2026-11-20\"}")
DID=$(pick "(d.get('deal') or d).get('id','')")
is2xx $C && [ -n "$DID" ] && ok "新建商机 $DID" || no "新建商机" "$C $(msg)"

echo "═══ 二、商机阶段机 ═══"
C=$(code -X PATCH $B/api/deals/$DID/stage -H "$AUTH" -H "$CT" \
  -d '{"stage":"谈判","result":"跳级测试","nextAction":"x","nextActionAt":"2026-11-20","expectedCloseAt":"2026-12-20"}')
[ "$C" = "400" ] && ok "跨阶段跳级被拒(400)" || no "跳级应被拒" "$C"

C=$(code -X PATCH $B/api/deals/$DID/stage -H "$AUTH" -H "$CT" \
  -d '{"stage":"已报价","result":"缺预计成交日期","nextAction":"x","nextActionAt":"2026-11-20"}')
[ "$C" = "400" ] && ok "已报价缺 expectedCloseAt 被拒(400)" || no "缺日期应被拒" "$C"

for pair in '已联系|电话确认采购意向' '已报价|已发 FOB 报价' '样品|样品已寄出' '谈判|客户要求 30 天账期' '成交|客户书面确认订单'; do
  S=${pair%%|*}; R=${pair##*|}; EXTRA=""
  [ "$S" = "成交" ] && EXTRA=',"wonReason":"客户书面确认 10 台订单"'
  C=$(code -X PATCH $B/api/deals/$DID/stage -H "$AUTH" -H "$CT" \
    -d "{\"stage\":\"$S\",\"result\":\"$R\",\"nextAction\":\"下一步\",\"nextActionAt\":\"2026-11-25\",\"expectedCloseAt\":\"2026-12-20\"$EXTRA}")
  ST=$(pick "(d.get('deal') or d).get('stage','')")
  is2xx $C && [ "$ST" = "$S" ] && ok "推进到 $S" || no "推进到 $S" "$C $(msg)"
done

C=$(code -X PATCH $B/api/deals/$DID/stage -H "$AUTH" -H "$CT" \
  -d '{"stage":"成交","result":"重复成交","nextAction":"x","nextActionAt":"2026-11-25","expectedCloseAt":"2026-12-20","wonReason":"x"}')
[ "$C" != "200" ] && ok "成交后不可重复推进($C)" || no "重复成交应被拒" "$C"

echo "═══ 三、成交自动建单 ═══"
curl -s $B/api/orders -H "$AUTH" > /tmp/c.json
OID=$(python3 -c "
import json
d=json.load(open('/tmp/c.json')); os_=d if isinstance(d,list) else d.get('orders',[])
m=[o for o in os_ if o.get('dealId')=='$DID']
print(m[0]['id'] if m else '')")
AMT=$(python3 -c "
import json
d=json.load(open('/tmp/c.json')); os_=d if isinstance(d,list) else d.get('orders',[])
m=[o for o in os_ if o.get('dealId')=='$DID']
print(m[0].get('amount') if m else '')")
[ -n "$OID" ] && ok "自动建单 $OID 金额 $AMT" || no "自动建单" "未生成"
[ "$AMT" = "42000" ] || [ "$AMT" = "42000.0" ] || [ "$AMT" = "42000.00" ] && ok "金额 = 10×4200 计算正确" || no "金额不符" "$AMT"

echo "═══ 四、单据全生命周期 ═══"
C=$(code -X POST $B/api/trade-documents -H "$AUTH" -H "$CT" \
  -d "{\"title\":\"E2E PI\",\"number\":\"PI-E2E-$TS\",\"issueDate\":\"2026-11-05\",\"seller\":\"ECORE GLOBAL\",\"buyer\":\"E2E $TS\",\"currency\":\"USD\",\"customerId\":\"$CID\",\"dealId\":\"$DID\",\"items\":[{\"product\":\"Industrial Sensor\",\"quantity\":10,\"unitPrice\":4200}]}")
DOC=$(pick "(d.get('document') or d).get('id','')")
is2xx $C && [ -n "$DOC" ] && ok "创建单据 $DOC" || no "创建单据" "$C $(msg)"

C=$(code -X POST $B/api/trade-documents -H "$AUTH" -H "$CT" \
  -d "{\"title\":\"缺字段单据\",\"issueDate\":\"2026-11-05\",\"seller\":\"ECORE GLOBAL\",\"items\":[{\"product\":\"X\",\"quantity\":1,\"unitPrice\":1}]}")
[ "$C" = "400" ] && ok "缺 number 被拒(400)" || no "缺字段应被拒" "$C"

C=$(code -X POST $B/api/trade-documents/$DOC/convert -H "$AUTH" -H "$CT" -d '{"targetType":"CI"}')
CI=$(pick "(d.get('document') or d).get('id','')")
is2xx $C && [ -n "$CI" ] && [ "$CI" != "$DOC" ] && ok "PI→CI 转换 $CI" || no "单据转换" "$C $(msg)"

C=$(code -X POST $B/api/trade-documents/$DOC/submit-approval -H "$AUTH" -H "$CT" -d '{"note":"提交审批"}')
is2xx $C && ok "提交审批" || no "提交审批" "$C $(msg)"
C=$(code -X POST $B/api/trade-documents/$DOC/approve -H "$AUTH" -H "$CT" -d '{"note":"批准"}')
is2xx $C && ok "审批通过" || no "审批通过" "$C $(msg)"
C=$(code -X PATCH $B/api/trade-documents/$DOC -H "$AUTH" -H "$CT" \
  -d "{\"title\":\"试图覆盖已审批\",\"number\":\"PI-E2E-$TS\",\"issueDate\":\"2026-11-05\",\"seller\":\"ECORE GLOBAL\",\"items\":[{\"product\":\"X\",\"quantity\":1,\"unitPrice\":1}]}")
[ "$C" = "409" ] && ok "已审批禁止原地覆盖(409)" || no "已审批覆盖应被拒" "$C $(msg)"
C=$(code -X POST $B/api/trade-documents/$DOC/revision -H "$AUTH" -H "$CT" -d '{}')
REV=$(pick "(d.get('document') or d).get('id','')")
is2xx $C && [ -n "$REV" ] && [ "$REV" != "$DOC" ] && ok "生成修订版本 $REV" || no "修订版本" "$C $(msg)"
C=$(code -X POST $B/api/trade-documents/$DOC/export -H "$AUTH" -H "$CT" -d '{}')
is2xx $C && ok "导出已审批单据" || no "导出" "$C $(msg)"

echo "═══ 五、订单状态机 ═══"
C=$(code -X POST $B/api/orders/$OID/status -H "$AUTH" -H "$CT" -d '{"toStatus":"confirmed"}')
[ "$C" = "400" ] && ok "缺 Incoterm/付款条件禁止确认(400)" || no "缺条款应被拒" "$C"

C=$(code -X POST $B/api/orders -H "$AUTH" -H "$CT" \
  -d "{\"customerId\":\"$CID\",\"currency\":\"USD\",\"incoterm\":\"FOB Shanghai\",\"paymentTerm\":\"30% T/T 定金，余款见提单副本\",\"productionRequired\":true,\"items\":[{\"product\":\"Hydraulic Valve\",\"qty\":20,\"unitPrice\":150}]}")
OID2=$(pick "(d.get('order') or d).get('id','')")
is2xx $C && [ -n "$OID2" ] && ok "手工建单 $OID2" || no "手工建单" "$C $(msg)"
code -X POST $B/api/orders/$OID2/status -H "$AUTH" -H "$CT" -d '{"toStatus":"confirmed"}' > /dev/null
C=$(code -X POST $B/api/orders/$OID2/status -H "$AUTH" -H "$CT" -d '{"toStatus":"in_production"}')
is2xx $C && ok "confirmed → in_production" || no "进入生产中" "$C $(msg)"
C=$(code -X POST $B/api/orders/$OID2/status -H "$AUTH" -H "$CT" -d '{"toStatus":"shipped"}')
[ "$C" = "400" ] && ok "shipped 禁止手工设置(400)" || no "shipped 应被拒" "$C"
C=$(code -X POST $B/api/orders/$OID2/status -H "$AUTH" -H "$CT" -d '{"toStatus":"confirmed"}')
[ "$C" = "400" ] && ok "回退缺原因被拒(400)" || no "回退缺原因" "$C"
C=$(code -X POST $B/api/orders/$OID2/status -H "$AUTH" -H "$CT" -d '{"toStatus":"confirmed","reason":"客户要求改配色"}')
is2xx $C && ok "带原因可回退" || no "带原因回退" "$C $(msg)"
C=$(code -X POST $B/api/orders/$OID2/notes -H "$AUTH" -H "$CT" -d '{"content":"客户确认 12 月 10 日前发运"}')
is2xx $C && ok "履约备注追加" || no "履约备注" "$C $(msg)"

echo "═══ 六、权限边界 ═══"
C=$(curl -s -o /dev/null -w '%{http_code}' $B/api/customers)
[ "$C" = "401" ] && ok "未登录访问 401" || no "未登录" "$C"
C=$(curl -s -o /dev/null -w '%{http_code}' $B/api/customers -H "authorization: Bearer forged.token.value")
[ "$C" = "401" ] && ok "伪造 token 401" || no "伪造 token" "$C"
C=$(curl -s -o /dev/null -w '%{http_code}' -X POST $B/api/auth/login -H "$CT" -d '{"email":"admin@goodjob.com","password":"wrong"}')
[ "$C" = "401" ] && ok "错误密码 401" || no "错误密码" "$C"

echo "═══ 七、级联删除（自清理）═══"
C=$(code -X POST $B/api/customers/bulk-delete -H "$AUTH" -H "$CT" -d "{\"ids\":[\"$CID\"]}")
is2xx $C && ok "删除客户" || no "删除客户" "$C"
sleep 1
LEFT=$(mysql -uecore -p8b3b468bd1ed53af31bd4bae853a97f7 -h127.0.0.1 ecore_crm -N -e "
select (select count(*) from deals where id='$DID'),
       (select count(*) from orders where id in ('$OID','$OID2')),
       (select count(*) from trade_documents where id in ('$DOC','$CI','$REV'));" 2>/dev/null)
set -- $LEFT
[ "$1" = "0" ] && ok "商机级联删除" || no "商机级联" "$1"
[ "$2" = "0" ] && ok "订单级联删除" || no "订单级联" "$2"
[ "$3" = "0" ] && ok "单据级联删除" || no "单据级联" "$3"

echo
echo "═══ 结果：PASS=$PASS  FAIL=$FAIL ═══"
[ "$FAIL" = "0" ] && echo "闭环全部通过" || echo "存在失败项"
