#!/bin/sh
# Runs on the TV. Args: <ipk-path> <app-id> [no-launch]
# no-launch: 1 = close + install only; 0/omit = also launch the app
set -e

IPK="${1:?ipk path required}"
APP_ID="${2:?app id required}"
NO_LAUNCH="${3:-0}"
APP_DIR="/media/developer/apps/usr/palm/applications/${APP_ID}"
LOG="/tmp/keyreplacer-deploy.log"

exec >"$LOG" 2>&1
echo "=== keyreplacer tv-install $(date) ==="
echo "IPK=$IPK"
echo "APP_ID=$APP_ID"
echo "NO_LAUNCH=$NO_LAUNCH"

LS="$(command -v luna-send || true)"
LSPUB="$(command -v luna-send-pub || true)"
AIU="$(command -v applicationinstallerutility || command -v applicationInstallUtility || true)"

echo "luna-send=$LS"
echo "luna-send-pub=$LSPUB"
echo "installer=$AIU"

luna() {
  # Prefer luna-send-pub when private bus calls return empty over SSH.
  if [ -n "$LSPUB" ]; then
    "$LSPUB" "$@" || true
  fi
  if [ -n "$LS" ]; then
    "$LS" "$@" || true
  fi
}

echo "--- close ---"
luna -n 1 -f luna://com.webos.applicationManager/closeByAppId "{\"id\":\"${APP_ID}\"}"
luna -n 1 -f luna://com.webos.applicationManager/close "{\"id\":\"${APP_ID}\"}"
luna -n 1 -f luna://com.webos.service.applicationManager/closeByAppId "{\"id\":\"${APP_ID}\"}"

# Kill WebAppMgr helpers that still reference this app (best-effort).
ps w 2>/dev/null | grep -F "$APP_ID" | grep -v grep | grep -v tv-install | awk '{print $1}' | while read -r pid; do
  echo "kill $pid"
  kill -9 "$pid" 2>/dev/null || true
done
sleep 1

echo "--- install ---"
INSTALLED=0
if [ -n "$AIU" ]; then
  echo "using applicationinstallerutility"
  if "$AIU" -c install -p "$IPK"; then
    INSTALLED=1
    echo "AIU install ok"
  else
    echo "AIU install exit=$?"
  fi
fi

if [ "$INSTALLED" -ne 1 ]; then
  echo "using appInstallService/dev/install (subscribe, max ~8s)"
  OUT=/tmp/keyreplacer-luna-install.log
  rm -f "$OUT"
  if [ -n "$LSPUB" ]; then
    "$LSPUB" -w 8000 -i -f luna://com.webos.appInstallService/dev/install \
      "{\"id\":\"com.ares.defaultName\",\"ipkUrl\":\"${IPK}\",\"subscribe\":true}" >"$OUT" 2>&1 &
  else
    "$LS" -w 8000 -i -f luna://com.webos.appInstallService/dev/install \
      "{\"id\":\"com.ares.defaultName\",\"ipkUrl\":\"${IPK}\",\"subscribe\":true}" >"$OUT" 2>&1 &
  fi
  LPID=$!
  i=0
  while [ "$i" -lt 8 ]; do
    if grep -qE '"status"[[:space:]]*:[[:space:]]*"installed"|state":"installed"' "$OUT" 2>/dev/null; then
      INSTALLED=1
      break
    fi
    if grep -qE '"status"[[:space:]]*:[[:space:]]*"failed"' "$OUT" 2>/dev/null; then
      break
    fi
    sleep 1
    i=$((i + 1))
  done
  kill "$LPID" 2>/dev/null || true
  wait "$LPID" 2>/dev/null || true
  echo "luna install log:"
  cat "$OUT" 2>/dev/null || true
fi

if [ "$INSTALLED" -ne 1 ]; then
  echo "fallback: manual ar/tar extract"
  WORK="$(mktemp -d /tmp/keyreplacer-ipk.XXXXXX)"
  cd "$WORK"
  ar x "$IPK"
  if [ -f data.tar.gz ]; then
    tar -xzf data.tar.gz -C /media/developer/apps
  elif [ -f data.tar.xz ]; then
    tar -xJf data.tar.xz -C /media/developer/apps
  else
    echo "no data.tar.*"; ls -la; exit 1
  fi
  rm -rf "$WORK"
  chmod -R a+rX "$APP_DIR" 2>/dev/null || true
fi

echo "--- appinfo ---"
if [ -f "$APP_DIR/appinfo.json" ]; then
  cat "$APP_DIR/appinfo.json"
else
  echo "MISSING $APP_DIR/appinfo.json"
  exit 1
fi

echo "--- rescan ---"
luna -n 1 -f luna://com.webos.applicationManager/rescanAppList '{}'
luna -n 1 -f luna://com.palm.applicationManager/rescan '{}'
sleep 1

if [ "$NO_LAUNCH" = "1" ]; then
  echo "--- launch skipped (--no-launch) ---"
  echo "=== done ==="
  exit 0
fi

echo "--- launch ---"
luna -n 1 -f luna://com.webos.applicationManager/launch "{\"id\":\"${APP_ID}\"}"
luna -n 1 -f luna://com.webos.service.applicationManager/launch "{\"id\":\"${APP_ID}\"}"
sleep 1
echo "--- foreground ---"
luna -n 1 -f luna://com.webos.applicationManager/getForegroundAppInfo '{}'

echo "=== done ==="
exit 0
