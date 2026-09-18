#!/usr/bin/env bash
# Read-only finance VPS checks. Prints pass/fail. Never dumps ledger JSON.
set -euo pipefail

HOST_HDR='himanshugupta2077@gmail.com'
BAD_HDR='other@example.com'
LOOP='http://127.0.0.1:8787'
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

echo "finance VPS check  $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo

# 1. bind
listen="$(ss -lntH 2>/dev/null | awk '$4 ~ /:8787$/ {print $4}')"
if echo "$listen" | grep -qx '127.0.0.1:8787'; then
  pass "listen 127.0.0.1:8787"
else
  fail "listen 127.0.0.1:8787 (got: ${listen:-none})"
fi
if echo "$listen" | grep -qE '0\.0\.0\.0:8787|\[::\]:8787'; then
  fail "8787 is on a public wildcard bind"
fi

# 2. unit
st="$(systemctl is-active finance.service 2>/dev/null || true)"
if [[ $st == active ]]; then
  pass "finance.service active"
else
  fail "finance.service is ${st:-unknown}"
fi
mem="$(systemctl show finance.service -p MemoryCurrent --value 2>/dev/null || echo 0)"
if [[ $mem =~ ^[0-9]+$ ]] && (( mem > 0 && mem < 256*1024*1024 )); then
  pass "memory $((mem / 1024 / 1024))M < 256M"
elif [[ $mem =~ ^[0-9]+$ ]]; then
  warn "memory ${mem} bytes (MemoryCurrent)"
fi

# 3. health
h="$(body "$LOOP/api/health" || true)"
hc="$(code "$LOOP/api/health" || echo 000)"
if [[ $hc == 200 ]] && echo "$h" | grep -q '"ok":true' && echo "$h" | grep -q '/var/lib/finance/finance.sqlite'; then
  ver="$(echo "$h" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("schemaVersion",""))' 2>/dev/null || true)"
  pass "GET /api/health 200 db=/var/lib/finance/finance.sqlite schema=${ver:-?}"
else
  fail "GET /api/health (http $hc)"
fi

# 4. auth gate
b0="$(code "$LOOP/api/books" || echo 000)"
b1="$(code -H "Tailscale-User-Login: $BAD_HDR" "$LOOP/api/books" || echo 000)"
b2="$(code -H "Tailscale-User-Login: $HOST_HDR" "$LOOP/api/books" || echo 000)"
[[ $b0 == 401 ]] && pass "GET /api/books no header → 401" || fail "GET /api/books no header → $b0 (want 401)"
[[ $b1 == 401 ]] && pass "GET /api/books wrong login → 401" || fail "GET /api/books wrong login → $b1 (want 401)"
if [[ $b2 == 200 ]]; then
  counts="$(
    curl -sS --max-time 8 -H "Tailscale-User-Login: $HOST_HDR" "$LOOP/api/books" \
      | python3 -c 'import sys,json; b=json.load(sys.stdin).get("books",{}); print("accounts",len(b.get("accounts") or []),"entries",len(b.get("entries") or []))' 2>/dev/null || echo "parse-fail"
  )"
  pass "GET /api/books good login → 200 ($counts)"
else
  fail "GET /api/books good login → $b2 (want 200)"
fi

# 5. prod dev routes off
w="$(code -X POST -H 'content-type: application/json' -H "Tailscale-User-Login: $HOST_HDR" \
  --data '{"confirm":"wipe"}' "$LOOP/api/dev/wipe" || echo 000)"
d="$(code -X POST -H "Tailscale-User-Login: $HOST_HDR" "$LOOP/api/dev/dummy-expense" || echo 000)"
[[ $w == 404 ]] && pass "POST /api/dev/wipe → 404" || fail "POST /api/dev/wipe → $w (want 404)"
[[ $d == 404 ]] && pass "POST /api/dev/dummy-expense → 404" || fail "POST /api/dev/dummy-expense → $d (want 404)"

# 6. SPA + prefix
html="$(body "$LOOP/finance/" || true)"
fc="$(code "$LOOP/finance/" || echo 000)"
if [[ $fc == 200 ]] && echo "$html" | grep -q '/finance/assets/'; then
  pass "GET /finance/ 200 with /finance/assets"
else
  fail "GET /finance/ (http $fc, missing /finance/assets?)"
fi
fh="$(code "$LOOP/finance/api/health" || echo 000)"
[[ $fh == 200 ]] && pass "GET /finance/api/health 200" || fail "GET /finance/api/health → $fh"

# 7. read-only API smoke (good login, status only)
smoke_ok=1
for path in /api/home /api/plan /api/wealth /api/accounts /api/goals /api/invest /api/portfolio /api/lock /api/settings; do
  c="$(code -H "Tailscale-User-Login: $HOST_HDR" "$LOOP$path" || echo 000)"
  if [[ $c != 200 ]]; then
    fail "GET $path → $c"
    smoke_ok=0
  fi
done
month="$(date +%Y-%m)"
c="$(code -H "Tailscale-User-Login: $HOST_HDR" "$LOOP/api/ledger?month=$month" || echo 000)"
if [[ $c != 200 ]]; then
  fail "GET /api/ledger?month=$month → $c"
  smoke_ok=0
fi
[[ $smoke_ok == 1 ]] && pass "read-only API smoke all 200 (bodies omitted)"

# 8. Serve
serve="$(tailscale serve status 2>/dev/null || true)"
if echo "$serve" | grep -q '/finance' && echo "$serve" | grep -qi 'tailnet only'; then
  pass "tailscale serve /finance tailnet-only"
else
  fail "tailscale serve status unexpected: $(echo "$serve" | tr '\n' ' ' | cut -c1-160)"
fi
if echo "$serve" | grep -qi funnel && echo "$serve" | grep -qi 'on the internet'; then
  fail "Funnel looks public"
fi

sc="$(code "${RESOLVE[@]}" "https://${TS_HOST}/finance/" || echo 000)"
shc="$(code "${RESOLVE[@]}" "https://${TS_HOST}/finance/api/health" || echo 000)"
[[ $sc == 200 ]] && pass "HTTPS Serve GET /finance/ 200" || fail "HTTPS Serve GET /finance/ → $sc"
[[ $shc == 200 ]] && pass "HTTPS Serve GET /finance/api/health 200" || fail "HTTPS Serve GET /finance/api/health → $shc"

# Serve should 200 /api/books using injected identity
sbc="$(code "${RESOLVE[@]}" "https://${TS_HOST}/finance/api/books" || echo 000)"
[[ $sbc == 200 ]] && pass "HTTPS Serve GET /finance/api/books 200 (injected identity)" \
  || fail "HTTPS Serve GET /finance/api/books → $sbc"

# 9. timer
if systemctl list-timers --all --no-pager 2>/dev/null | grep -q finance-github-backup.timer; then
  nxt="$(systemctl show finance-github-backup.timer -p NextElapseUSecRealtime --value 2>/dev/null || true)"
  pass "hourly backup timer present (${nxt:-next unknown})"
else
  fail "finance-github-backup.timer not listed"
fi

echo
echo "result  pass=$PASS  fail=$FAIL  warn=$WARN"
if (( FAIL > 0 )); then
  echo "next: sudo journalctl -u finance -n 80 --no-pager"
  exit 1
fi
exit 0
