#!/usr/bin/env bash
# Read-only whole-toolkit VPS checks. Never dumps notes, keys, or ledger JSON.
set -euo pipefail

HOST_HDR='himanshugupta2077@gmail.com'
LOOP_TK='http://127.0.0.1:8000'
LOOP_FIN='http://127.0.0.1:8787'
TS_HOST='toolkit.tailf7a628.ts.net'
TS_IP='100.86.221.101'
RESOLVE=(--resolve "${TS_HOST}:443:${TS_IP}")
PASS=0
FAIL=0
WARN=0

pass() { printf 'PASS  %s\n' "$1"; PASS=$((PASS + 1)); }
fail() { printf 'FAIL  %s\n' "$1"; FAIL=$((FAIL + 1)); }
warn() { printf 'WARN  %s\n' "$1"; WARN=$((WARN + 1)); }

code() {
  curl -sS -o /dev/null -w '%{http_code}' --max-time 8 "$@"
}

body() {
  curl -sS --max-time 8 "$@"
}

echo "toolkit VPS check  $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo

listen8000="$(ss -lntH 2>/dev/null | awk '$4 ~ /:8000$/ {print $4}')"
if echo "$listen8000" | grep -qx '127.0.0.1:8000'; then
  pass "listen 127.0.0.1:8000"
else
  fail "listen 127.0.0.1:8000 (got: ${listen8000:-none})"
fi
if echo "$listen8000" | grep -qE '0\.0\.0\.0:8000|\[::\]:8000'; then
  fail "8000 is on a public wildcard bind"
fi

listen8787="$(ss -lntH 2>/dev/null | awk '$4 ~ /:8787$/ {print $4}')"
if echo "$listen8787" | grep -qx '127.0.0.1:8787'; then
  pass "listen 127.0.0.1:8787 (finance.service)"
else
  fail "listen 127.0.0.1:8787 (got: ${listen8787:-none})"
fi

st="$(systemctl is-active toolkit.service 2>/dev/null || true)"
[[ $st == active ]] && pass "toolkit.service active" || fail "toolkit.service is ${st:-unknown}"
stf="$(systemctl is-active finance.service 2>/dev/null || true)"
[[ $stf == active ]] && pass "finance.service active" || fail "finance.service is ${stf:-unknown}"

h="$(body "$LOOP_TK/api/health" || true)"
hc="$(code "$LOOP_TK/api/health" || echo 000)"
if [[ $hc == 200 ]] && echo "$h" | grep -q '"ok":true'; then
  prof="$(echo "$h" | python3 -c 'import sys,json; d=json.load(sys.stdin); s=(d.get("stt") or {}); print(s.get("profile","?"), s.get("local_enabled"), s.get("cloud_ready"))' 2>/dev/null || echo '?')"
  pass "GET :8000/api/health 200 (stt $prof)"
  echo "$h" | python3 -c 'import sys,json; d=json.load(sys.stdin); s=d.get("stt") or {};
assert s.get("profile")=="vps", s
assert s.get("local_enabled") is False, s
print("profile-ok")' >/dev/null 2>&1 && pass "STT profile=vps local_enabled=false" || fail "STT profile is not vps/cloud-only"
else
  fail "GET :8000/api/health (http $hc)"
fi

for path in / /voice/ /voice/notes /food /cfa/ /heart /old-finance; do
  c="$(code "$LOOP_TK$path" || echo 000)"
  [[ $c == 200 ]] && pass "GET :8000$path → 200" || fail "GET :8000$path → $c"
done

vr="$(code "$LOOP_TK/voice" || echo 000)"
[[ $vr == 307 || $vr == 308 || $vr == 301 || $vr == 302 ]] && pass "GET :8000/voice → redirect $vr" || fail "GET :8000/voice → $vr (want redirect to /voice/)"

vm="$(code "$LOOP_TK/voice/manifest.webmanifest" || echo 000)"
[[ $vm == 200 ]] && pass "GET :8000/voice/manifest.webmanifest → 200" || fail "GET :8000/voice/manifest.webmanifest → $vm"
vs="$(code "$LOOP_TK/voice/sw.js" || echo 000)"
[[ $vs == 200 ]] && pass "GET :8000/voice/sw.js → 200" || fail "GET :8000/voice/sw.js → $vs"
vi="$(code "$LOOP_TK/voice/icons/icon-192.png" || echo 000)"
[[ $vi == 200 ]] && pass "GET :8000/voice/icons/icon-192.png → 200" || fail "GET :8000/voice/icons/icon-192.png → $vi"

cr="$(code "$LOOP_TK/cfa" || echo 000)"
[[ $cr == 307 || $cr == 308 || $cr == 301 || $cr == 302 ]] && pass "GET :8000/cfa → redirect $cr" || fail "GET :8000/cfa → $cr (want redirect to /cfa/)"
cm="$(code "$LOOP_TK/cfa/manifest.webmanifest" || echo 000)"
[[ $cm == 200 ]] && pass "GET :8000/cfa/manifest.webmanifest → 200" || fail "GET :8000/cfa/manifest.webmanifest → $cm"
cs="$(code "$LOOP_TK/cfa/sw.js" || echo 000)"
[[ $cs == 200 ]] && pass "GET :8000/cfa/sw.js → 200" || fail "GET :8000/cfa/sw.js → $cs"
ci="$(code "$LOOP_TK/cfa/icons/icon-192.png" || echo 000)"
[[ $ci == 200 ]] && pass "GET :8000/cfa/icons/icon-192.png → 200" || fail "GET :8000/cfa/icons/icon-192.png → $ci"

hc_cat="$(code "$LOOP_TK/api/heart/catalog" || echo 000)"
if [[ $hc_cat == 200 ]]; then
  counts="$(body "$LOOP_TK/api/heart/catalog" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(int(d.get("total") or 0), int(d.get("analyzed") or 0))' 2>/dev/null || echo '0 0')"
  total="${counts%% *}"
  analyzed="${counts##* }"
  if [[ ${total:-0} -gt 0 ]]; then
    pass "GET :8000/api/heart/catalog 200 (total=$total analyzed=$analyzed)"
  else
    warn "GET :8000/api/heart/catalog 200 but empty (laptop: bash vps/push-heart.sh)"
  fi
else
  fail "GET :8000/api/heart/catalog → $hc_cat"
fi

# /finance on toolkit is not required (Serve sends /finance to Node).
fc="$(code "$LOOP_FIN/finance/" || echo 000)"
[[ $fc == 200 ]] && pass "GET :8787/finance/ → 200" || fail "GET :8787/finance/ → $fc"
fhc="$(code "$LOOP_FIN/api/health" || echo 000)"
[[ $fhc == 200 ]] && pass "GET :8787/api/health → 200" || fail "GET :8787/api/health → $fhc"

# Options must not leak keys
opt="$(body "$LOOP_TK/api/options" || true)"
oc="$(code "$LOOP_TK/api/options" || echo 000)"
if [[ $oc == 200 ]] && echo "$opt" | grep -vqE 'sk-|OPENAI_API_KEY|DEEPSEEK'; then
  pass "GET /api/options 200 (no key material)"
else
  fail "GET /api/options leaked or failed (http $oc)"
fi

serve="$(tailscale serve status 2>/dev/null || true)"
echo "$serve" | grep -q 'http://127.0.0.1:8000' && pass "Serve / → 127.0.0.1:8000" || fail "Serve missing / → :8000"
echo "$serve" | grep -q 'http://127.0.0.1:8787' && pass "Serve /finance → 127.0.0.1:8787" || fail "Serve missing /finance → :8787"
if echo "$serve" | grep -qi funnel && echo "$serve" | grep -qi 'on the internet'; then
  fail "Funnel looks public"
else
  pass "Funnel not public"
fi

sc="$(code "${RESOLVE[@]}" "https://${TS_HOST}/" || echo 000)"
[[ $sc == 200 ]] && pass "Serve GET https://$TS_HOST/ → 200" || fail "Serve GET / → $sc"
sfc="$(code "${RESOLVE[@]}" "https://${TS_HOST}/finance/" || echo 000)"
[[ $sfc == 200 ]] && pass "Serve GET https://$TS_HOST/finance/ → 200" || fail "Serve GET /finance/ → $sfc"

if [[ -r /etc/toolkit.env ]]; then
  fail "/etc/toolkit.env is world-readable to this user (should be root:toolkit 640)"
else
  pass "/etc/toolkit.env not readable by toolkit without sudo"
fi

echo
echo "summary  pass=$PASS fail=$FAIL warn=$WARN"
if (( FAIL > 0 )); then
  exit 1
fi
