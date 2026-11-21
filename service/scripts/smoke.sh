#!/usr/bin/env bash
# End-to-end smoke test against a running dev server (npm run dev:node).
set -euo pipefail

BASE="${BASE:-http://localhost:8787}"
OWNER_TOKEN="${OWNER_TOKEN:-dev-owner-token}"
ORIGIN="http://localhost:3000"
SLUG="smoke-$(date +%s)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# req STATUS METHOD PATH [curl args...]: body in $TMP/out, fails on wrong status.
req() {
  local want="$1" method="$2" path="$3"; shift 3
  local got
  got="$(curl -s -o "$TMP/out" -w '%{http_code}' -X "$method" "$BASE$path" "$@")"
  if [ "$got" != "$want" ]; then
    echo "smoke: FAIL $method $path expected $want got $got" >&2
    cat "$TMP/out" >&2; echo >&2
    exit 1
  fi
}
field() { python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(eval(sys.argv[2]))' "$TMP/out" "$1"; }
owner=(-H "Authorization: Bearer $OWNER_TOKEN" -H "Content-Type: application/json")

req 200 GET /api/health

# The tag script is served as JavaScript.
ctype="$(curl -s -o /dev/null -w '%{content_type}' "$BASE/t.js")"
case "$ctype" in
  *javascript*) ;;
  *) echo "smoke: FAIL GET /t.js content type was '$ctype'" >&2; exit 1 ;;
esac
req 200 GET /t.js
req 201 POST /api/owner/sites "${owner[@]}" -d "{\"slug\":\"$SLUG\",\"name\":\"Smoke\",\"origin\":\"$ORIGIN\",\"repo\":\"example/smoke\"}"
req 201 POST /api/owner/reviewers "${owner[@]}" -d '{"name":"Smoke Reviewer"}'
RID="$(field 'd["id"]')"; RTOKEN="$(field 'd["token"]')"
req 201 POST /api/owner/assignments "${owner[@]}" -d "{\"site\":\"$SLUG\",\"reviewer_id\":\"$RID\",\"path\":\"/smoke\",\"title\":\"Smoke page\"}"
AID="$(field 'd["id"]')"

reviewer=(-H "Authorization: Bearer $RTOKEN")
req 201 POST /api/me/comments "${reviewer[@]}" -H "Origin: $ORIGIN" \
  -F "data={\"site\":\"$SLUG\",\"path\":\"/smoke\",\"body\":\"Make this button bigger\",\"device\":\"desktop\"};type=application/json"
CID="$(field 'd["id"]')"

req 200 GET "/api/owner/batch?reviewer=$RID&site=$SLUG" "${owner[@]}"
[ "$(field 'len(d["comments"])')" = "1" ] || { echo "smoke: FAIL batch should hold 1 comment" >&2; exit 1; }
[ "$(field 'd["comments"][0]["id"]')" = "$CID" ] || { echo "smoke: FAIL batch comment id mismatch" >&2; exit 1; }

# The reviewer opens the page first, then the owner marks the comment done.
req 204 POST "/api/me/assignments/$AID/opened" "${reviewer[@]}"
sleep 0.1
req 200 PATCH "/api/owner/comments/$CID" "${owner[@]}" -d '{"status":"done","pr_url":"https://github.com/example/smoke/pull/1"}'

req 200 GET /api/me "${reviewer[@]}"
[ "$(field 'd["assignments"][0]["is_updated"]')" = "True" ] || { echo "smoke: FAIL is_updated should be true" >&2; exit 1; }

echo "smoke: ok"
