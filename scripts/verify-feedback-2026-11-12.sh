#!/bin/bash
# 2026-11-12 试用反馈验收（接口层）
# 对应两份反馈文件：CRM试用.doc（3条）+ CRM系统测试反馈及修改建议.docx（5条）
# 合并去重后 5 个可接口验证的点：成交归类 / 供应商隔离 / PO三字段 / Description合并 / 新建重置(纯前端，见 UI 验收)
B=http://127.0.0.1:4290
for i in $(seq 1 40); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' $B/api/health)" = "200" ] && break
  sleep 2
done
[ "$(curl -s -o /dev/null -w '%{http_code}' $B/api/health)" = "200" ] || { echo "后端未就绪：$B"; exit 1; }

PASS=0; FAIL=0
ok(){ PASS=$((PASS+1)); printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
no(){ FAIL=$((FAIL+1)); printf '  \033[31mFAIL\033[0m  %s  << %s\n' "$1" "$2"; }
code(){ curl -s -o /tmp/vf.json -w '%{http_code}' "$@"; }
msg(){ head -c 160 /tmp/vf.json; }
is2xx(){ [ "${1:0:1}" = "2" ]; }
pick(){ python3 -c "import json;d=json.load(open('/tmp/vf.json'));v=$1;print('' if v is None else v)" 2>/dev/null; }
CT="content-type: application/json"

login(){ curl -s -X POST $B/api/auth/login -H "$CT" -d "{\"email\":\"$1\",\"password\":\"goodjob123\"}" \
  | python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))"; }

TA=$(login admin@goodjob.com)
TM=$(login alex@goodjob.com)      # manager
T1=$(login a.isolation@goodjob.com)  # sales A
T2=$(login b.isolation@goodjob.com)  # sales B
[ -n "$TA" ] && [ -n "$T1" ] && [ -n "$T2" ] && [ -n "$TM" ] || { echo "登录失败"; exit 1; }
AA="authorization: Bearer $TA"; AM="authorization: Bearer $TM"
A1="authorization: Bearer $T1"; A2="authorization: Bearer $T2"
TS=$(date +%H%M%S)
CREATED_CUST=""; CREATED_SUP=""; CREATED_DOC=""

# ═══ 一、成交客户归类（反馈①：试用① + 建议①客户侧）═══
echo "═══ 一、成交客户归类 ═══"
C=$(code -X POST $B/api/customers -H "$AA" -H "$CT" -d "{
  \"company\":\"VF-Won $TS\",\"country\":\"Germany\",\"contactName\":\"Hans\",
  \"email\":\"won$TS@vf.example\",\"lifecycleStatus\":\"won\"}")
WID=$(pick "(d.get('customer') or d).get('id','')")
CREATED_CUST=$WID
if is2xx "$C" && [ -n "$WID" ]; then ok "建成交客户 $WID"; else no "建成交客户" "$C $(msg)"; fi

code $B/api/customers?scope=mine -H "$AA" >/dev/null
LIFE=$(pick "[c.get('lifecycleStatus') for c in d.get('customers',[]) if c.get('id')=='$WID'][0]")
WON=$(pick "[c.get('hasWonDeal') for c in d.get('customers',[]) if c.get('id')=='$WID'][0]")
PROT=$(pick "[c.get('protectedUntil') for c in d.get('customers',[]) if c.get('id')=='$WID'][0]")
[ "$LIFE" = "won" ] && ok "落库 lifecycleStatus=won" || no "lifecycleStatus 应为 won" "实际=$LIFE"
[ "$WON" = "True" ] && ok "列表 hasWonDeal=true（进已成交档案）" || no "hasWonDeal 应为 true" "实际=$WON"
[ -z "$PROT" ] && ok "成交客户无保护期（不参与回收）" || no "protectedUntil 应为空" "实际=$PROT"

C=$(code -X POST $B/api/customers -H "$AA" -H "$CT" -d "{
  \"company\":\"VF-Open $TS\",\"country\":\"France\",\"contactName\":\"Marie\",
  \"email\":\"open$TS@vf.example\"}")
OID=$(pick "(d.get('customer') or d).get('id','')")
CREATED_CUST="$CREATED_CUST $OID"
code $B/api/customers?scope=mine -H "$AA" >/dev/null
OLIFE=$(pick "[c.get('lifecycleStatus') for c in d.get('customers',[]) if c.get('id')=='$OID'][0]")
OWON=$(pick "[c.get('hasWonDeal') for c in d.get('customers',[]) if c.get('id')=='$OID'][0]")
OPROT=$(pick "[c.get('protectedUntil') for c in d.get('customers',[]) if c.get('id')=='$OID'][0]")
[ "$OLIFE" = "open" ] && [ "$OWON" = "False" ] && ok "不传状态 → 未成交，hasWonDeal=false" || no "默认应为 open" "$OLIFE/$OWON"
[ -n "$OPROT" ] && ok "未成交客户有保护期" || no "未成交应有保护期" "空"

# open → won 的修改路径
C=$(code -X PATCH $B/api/customers/$OID -H "$AA" -H "$CT" -d '{"lifecycleStatus":"won"}')
is2xx $C && ok "PATCH open→won 接受" || no "PATCH 改成交应成功" "$C $(msg)"
code $B/api/customers?scope=mine -H "$AA" >/dev/null
OLIFE=$(pick "[c.get('lifecycleStatus') for c in d.get('customers',[]) if c.get('id')=='$OID'][0]")
OPROT=$(pick "[c.get('protectedUntil') for c in d.get('customers',[]) if c.get('id')=='$OID'][0]")
OWON=$(pick "[c.get('hasWonDeal') for c in d.get('customers',[]) if c.get('id')=='$OID'][0]")
[ "$OLIFE" = "won" ] && [ "$OWON" = "True" ] && [ -z "$OPROT" ] \
  && ok "改成交后进已成交档案且清保护期" || no "改成交后状态不对" "$OLIFE/$OWON/prot=$OPROT"

# 成交客户再编辑别的字段，不能复活保护期（否则每次编辑都续期）
C=$(code -X PATCH $B/api/customers/$OID -H "$AA" -H "$CT" -d '{"contactName":"Marie Curie"}')
code $B/api/customers?scope=mine -H "$AA" >/dev/null
OPROT=$(pick "[c.get('protectedUntil') for c in d.get('customers',[]) if c.get('id')=='$OID'][0]")
[ -z "$OPROT" ] && ok "成交客户改其它字段不复活保护期" || no "保护期被误续" "prot=$OPROT"

# won → open 回退
C=$(code -X PATCH $B/api/customers/$OID -H "$AA" -H "$CT" -d '{"lifecycleStatus":"open"}')
code $B/api/customers?scope=mine -H "$AA" >/dev/null
OPROT=$(pick "[c.get('protectedUntil') for c in d.get('customers',[]) if c.get('id')=='$OID'][0]")
OLIFE=$(pick "[c.get('lifecycleStatus') for c in d.get('customers',[]) if c.get('id')=='$OID'][0]")
[ "$OLIFE" = "open" ] && [ -n "$OPROT" ] && ok "won→open 重新给保护期" || no "回退未给保护期" "$OLIFE/prot=$OPROT"

# ═══ 二、成交供应商归类（反馈①供应商侧）═══
echo "═══ 二、成交供应商归类 ═══"
C=$(code -X POST $B/api/suppliers -H "$AA" -H "$CT" -d "{
  \"company\":\"VF-Sup-Won $TS\",\"country\":\"Italy\",\"contact\":\"Marco\",
  \"status\":\"won\",\"grade\":\"A\"}")
SID=$(pick "(d.get('supplier') or d).get('id','')")
CREATED_SUP=$SID
if is2xx "$C" && [ -n "$SID" ]; then ok "建成交供应商 $SID"; else no "建成交供应商" "$C $(msg)"; fi
code $B/api/suppliers -H "$AA" >/dev/null
SST=$(pick "[s.get('status') for s in d.get('suppliers',[]) if s.get('id')=='$SID'][0]")
[ "$SST" = "won" ] && ok "回读 status=won（归入已成交供应商）" || no "status 应为 won" "实际=$SST"

C=$(code -X POST $B/api/suppliers -H "$AA" -H "$CT" -d "{
  \"company\":\"VF-Sup-Open $TS\",\"country\":\"Spain\",\"contact\":\"Lucia\"}")
S2=$(pick "(d.get('supplier') or d).get('id','')")
CREATED_SUP="$CREATED_SUP $S2"
code $B/api/suppliers -H "$AA" >/dev/null
S2ST=$(pick "[s.get('status') for s in d.get('suppliers',[]) if s.get('id')=='$S2'][0]")
[ "$S2ST" = "open" ] && ok "不传状态 → open（未成交供应商）" || no "默认应为 open" "实际=$S2ST"

C=$(code -X PATCH $B/api/suppliers/$S2 -H "$AA" -H "$CT" -d '{"status":"won"}')
code $B/api/suppliers -H "$AA" >/dev/null
S2ST=$(pick "[s.get('status') for s in d.get('suppliers',[]) if s.get('id')=='$S2'][0]")
[ "$S2ST" = "won" ] && ok "PATCH 供应商 open→won 生效" || no "供应商改成交未生效" "$C/$S2ST"

# ═══ 三、供应商仅自己可见（反馈②）═══
echo "═══ 三、供应商可见性（仅自己可见）═══"
C=$(code -X POST $B/api/suppliers -H "$A1" -H "$CT" -d "{
  \"company\":\"VF-Isolate $TS\",\"country\":\"Poland\",\"contact\":\"A only\"}")
ISID=$(pick "(d.get('supplier') or d).get('id','')")
CREATED_SUP="$CREATED_SUP $ISID"
is2xx $C && [ -n "$ISID" ] && ok "A 建私有供应商 $ISID" || no "A 建供应商" "$C $(msg)"

code $B/api/suppliers -H "$A1" >/dev/null
N1=$(pick "len([s for s in d.get('suppliers',[]) if s.get('id')=='$ISID'])")
[ "$N1" = "1" ] && ok "A 自己可见" || no "A 应可见" "count=$N1"

code $B/api/suppliers -H "$A2" >/dev/null
N2=$(pick "len([s for s in d.get('suppliers',[]) if s.get('id')=='$ISID'])")
[ "$N2" = "0" ] && ok "同组业务员 B 不可见（核心诉求）" || no "B 不应可见" "count=$N2"

code $B/api/suppliers -H "$AM" >/dev/null
N3=$(pick "len([s for s in d.get('suppliers',[]) if s.get('id')=='$ISID'])")
[ "$N3" = "1" ] && ok "主管可见（管理视角保留）" || no "主管应可见" "count=$N3"

code $B/api/suppliers -H "$AA" >/dev/null
N4=$(pick "len([s for s in d.get('suppliers',[]) if s.get('id')=='$ISID'])")
[ "$N4" = "1" ] && ok "管理员可见" || no "管理员应可见" "count=$N4"

C=$(code -X PATCH $B/api/suppliers/$ISID -H "$A2" -H "$CT" -d '{"contact":"hacked"}')
[ "$C" = "404" ] && ok "B 越权改 A 的供应商 → 404（不泄露存在性）" || no "越权改应 404" "$C $(msg)"

C=$(code -X POST $B/api/suppliers/bulk-delete -H "$A2" -H "$CT" -d "{\"ids\":[\"$ISID\"]}")
DELN=$(pick "len(d.get('deleted',[]))")
# 403 = IAM 权限闸前置拦截（sales 无 supplier.delete），404 = 路由层可见性拦截；
# 哪一层先拦都算通过，关键断言是「一行都没删掉」
{ [ "$C" = "403" ] || [ "$C" = "404" ]; } && [ "$DELN" = "0" ] \
  && ok "B 越权批量删除被拦（$C），未删任何行" || no "越权删应无效" "$C deleted=$DELN"

code $B/api/suppliers -H "$A1" >/dev/null
N1=$(pick "len([s for s in d.get('suppliers',[]) if s.get('id')=='$ISID'])")
[ "$N1" = "1" ] && ok "越权尝试后 A 的数据仍在" || no "A 数据被影响" "count=$N1"

# 客户侧不受影响：同一个 B 仍能看到同团队客户（不能把客户也锁成私有）
code "$B/api/customers?scope=team" -H "$A2" >/dev/null
TEAMN=$(pick "len(d.get('customers',[]))")
[ "$TEAMN" -gt 0 ] 2>/dev/null && ok "客户团队视图不受影响（仍可见 $TEAMN 条）" || no "客户团队视图被误伤" "count=$TEAMN"

# ═══ 四、PO 三字段（反馈③④）═══
echo "═══ 四、PO 三字段 Condition / Warranty / Lead Time ═══"
C=$(code -X POST $B/api/trade-documents -H "$AA" -H "$CT" -d "{
  \"type\":\"PO\",\"title\":\"VF PO $TS\",\"number\":\"VFPO$TS\",\"issueDate\":\"2026-11-12\",
  \"buyer\":\"VF Buyer GmbH\",\"currency\":\"USD\",
  \"condition\":\"Brand new\",\"warranty\":\"12 months\",\"leadTime\":\"25-30 days after deposit\",
  \"items\":[{\"product\":\"LED Flood Light\",\"model\":\"200W\",
    \"description\":\"LED Flood Light 200W, die-cast aluminium, IP65\",
    \"hsCode\":\"9405420000\",\"quantity\":100,\"unitPrice\":18.5}],
  \"totalAmount\":1850}")
DID=$(pick "(d.get('document') or d).get('id','')")
CREATED_DOC=$DID
is2xx $C && [ -n "$DID" ] && ok "新建 PO $DID" || no "新建 PO" "$C $(msg)"

code $B/api/trade-documents -H "$AA" >/dev/null
for f in condition warranty leadTime; do
  V=$(pick "[x.get('$f') for x in d.get('documents',[]) if x.get('id')=='$DID'][0]")
  case $f in condition) EXP="Brand new";; warranty) EXP="12 months";; leadTime) EXP="25-30 days after deposit";; esac
  [ "$V" = "$EXP" ] && ok "回读 $f = $EXP" || no "$f 回读不符" "实际=$V"
done

DESC=$(pick "[x.get('items',[{}])[0].get('description') for x in d.get('documents',[]) if x.get('id')=='$DID'][0]")
HS=$(pick "[x.get('items',[{}])[0].get('hsCode') for x in d.get('documents',[]) if x.get('id')=='$DID'][0]")
[ "$DESC" = "LED Flood Light 200W, die-cast aluminium, IP65" ] && ok "Description 整段自由文本完整回读" || no "Description 不符" "实际=$DESC"
[ "$HS" = "9405420000" ] && ok "HS Code 独立字段，10 位完整" || no "HS Code 不符" "实际=$HS"

# 老单据兼容：仍能带 material/finish 写入（历史数据 schema 不能炸）
C=$(code -X POST $B/api/trade-documents -H "$AA" -H "$CT" -d "{
  \"type\":\"PO\",\"title\":\"VF Legacy $TS\",\"number\":\"VFLEG$TS\",\"issueDate\":\"2026-11-12\",
  \"currency\":\"USD\",
  \"items\":[{\"product\":\"Legacy Item\",\"model\":\"x\",\"material\":\"Aluminium\",\"finish\":\"Anodized\",
    \"hsCode\":\"9405\",\"quantity\":1,\"unitPrice\":10}],
  \"totalAmount\":10}")
LID=$(pick "(d.get('document') or d).get('id','')")
CREATED_DOC="$CREATED_DOC $LID"
is2xx $C && [ -n "$LID" ] && ok "带旧 material/finish 的单据仍可写入（兼容历史）" || no "旧字段写入失败" "$C $(msg)"

# PATCH 是整份覆盖语义（前端保存时也传整份），所以先取回原单再整体改三个字段
cat > /tmp/vf_mkpatch.py <<'PY'
import json, sys
did = sys.argv[1]
docs = json.load(open('/tmp/vf.json'))['documents']
doc = [x for x in docs if x['id'] == did][0]
doc.update({"condition": "Refurbished", "warranty": "18 months", "leadTime": "40 days"})
json.dump(doc, open('/tmp/vf_patch.json', 'w'), ensure_ascii=False)
PY
code $B/api/trade-documents -H "$AA" >/dev/null
python3 /tmp/vf_mkpatch.py "$DID"
C=$(code -X PATCH $B/api/trade-documents/$DID -H "$AA" -H "$CT" --data-binary @/tmp/vf_patch.json)
code $B/api/trade-documents -H "$AA" >/dev/null
V=$(pick "[x.get('condition') for x in d.get('documents',[]) if x.get('id')=='$DID'][0]")
V2=$(pick "[x.get('warranty') for x in d.get('documents',[]) if x.get('id')=='$DID'][0]")
[ "$V" = "Refurbished" ] && [ "$V2" = "18 months" ] && ok "整份保存后三字段被更新" || no "PATCH 三字段失败" "$C/$V/$V2"
# ═══ 自清理 ═══
echo "═══ 五、自清理 ═══"
code -X POST $B/api/suppliers/bulk-delete -H "$AA" -H "$CT" -d "{\"ids\":[\"$SID\",\"$S2\",\"$ISID\"]}" >/dev/null
DELS=$(pick "len(d.get('deleted',[]))")
[ "$DELS" = "3" ] && ok "清理测试供应商 3 条" || no "清理供应商数量不符" "$DELS"

for id in $CREATED_DOC; do curl -s -X DELETE $B/api/trade-documents/$id -H "$AA" >/dev/null; done
ok "清理测试单据"

CDEL=$(curl -s -X POST $B/api/customers/bulk-delete -H "$AA" -H "$CT" -d "{\"ids\":[\"$WID\",\"$OID\"]}" \
  | python3 -c "import sys,json;print(len(json.load(sys.stdin).get('deleted',[])))" 2>/dev/null)
[ "$CDEL" = "2" ] && ok "清理测试客户 2 条" || no "客户清理数量不符" "deleted=${CDEL:-0}"

echo
printf '══════════════════════════════════\n'
printf '  接口验收：PASS=%s  FAIL=%s\n' "$PASS" "$FAIL"
printf '══════════════════════════════════\n'
[ "$FAIL" = "0" ]
