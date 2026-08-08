#!/usr/bin/env bash
# Build IPK, copy to rooted LG TV over SSH, close/update (and optionally launch).
#
# Usage:
#   ./deploy.sh [tv-host]                 # package + quiet deploy + launch (defaults)
#   ./deploy.sh --no-launch [tv-host]     # close + update only (do not start app)
#   ./deploy.sh --no-package [tv-host]    # reuse newest existing IPK
#   ./deploy.sh --verbose [tv-host]       # show extra local chatter
#   TV_PASS=alpine ./deploy.sh
#
# Env: from .env or shell — TV_HOST, TV_USER, TV_PORT, TV_PASS, SSH_IDENTITY
#      CLI host arg overrides TV_HOST.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

# Load local .env if present (does not override variables already set in the shell).
if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"
  set +a
fi

APP_ID="org.webosbrew.keyreplacer"
DIST_DIR="${ROOT_DIR}/dist"
PACKAGE=1
PRINT_ONLY=0
QUIET=1
NO_LAUNCH=0
HOST=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --package|-p) PACKAGE=1; shift ;;
    --no-package) PACKAGE=0; shift ;;
    --quiet|-q) QUIET=1; shift ;;
    --verbose|-v) QUIET=0; shift ;;
    --no-launch|--install-only) NO_LAUNCH=1; shift ;;
    --launch) NO_LAUNCH=0; shift ;;
    --print-only) PRINT_ONLY=1; shift ;;
    -h|--help)
      sed -n '2,15p' "$0"
      exit 0
      ;;
    -*) echo "Unknown option: $1" >&2; exit 1 ;;
    *) HOST="$1"; shift ;;
  esac
done

TV_HOST="${HOST:-${TV_HOST:-192.168.1.222}}"
TV_USER="${TV_USER:-root}"
TV_PORT="${TV_PORT:-22}"
TV_PASS="${TV_PASS:-}"
SSH_IDENTITY="${SSH_IDENTITY:-}"

SSH_BASE=(ssh -p "$TV_PORT" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10)
SCP_BASE=(scp -P "$TV_PORT" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10)

if [[ -n "$SSH_IDENTITY" ]]; then
  SSH_BASE+=(-i "$SSH_IDENTITY")
  SCP_BASE+=(-i "$SSH_IDENTITY")
fi

if [[ -n "$TV_PASS" ]]; then
  command -v sshpass >/dev/null || { echo "sshpass required for TV_PASS" >&2; exit 1; }
  SSH_BASE=(sshpass -p "$TV_PASS" "${SSH_BASE[@]}")
  SCP_BASE=(sshpass -p "$TV_PASS" "${SCP_BASE[@]}")
fi

remote() { "${SSH_BASE[@]}" "${TV_USER}@${TV_HOST}" "$@"; }

mkdir -p "$DIST_DIR"

# Migrate any leftover root-level IPKs into dist/
shopt -s nullglob
for leftover in "${ROOT_DIR}/${APP_ID}"_*.ipk; do
  echo "==> Moving $(basename "$leftover") → dist/"
  mv -f "$leftover" "$DIST_DIR/"
done
shopt -u nullglob

if [[ "$PACKAGE" -eq 1 ]]; then
  command -v ares-package >/dev/null || { echo "ares-package not found" >&2; exit 1; }
  echo "==> Packaging (clean staging) → dist/"
  STAGE="$(mktemp -d /tmp/keyreplacer-pkg.XXXXXX)"
  trap 'rm -rf "$STAGE"' EXIT
  cp appinfo.json index.html icon.png "$STAGE/"
  cp -a js css assets "$STAGE/"
  ares-package "$STAGE" -o "$DIST_DIR"
  rm -rf "$STAGE"
  trap - EXIT
fi

IPK="$(ls -1t "${DIST_DIR}/${APP_ID}"_*.ipk 2>/dev/null | head -n 1 || true)"
[[ -n "$IPK" && -f "$IPK" ]] || { echo "No IPK found in dist/. Run without --no-package (or build first)." >&2; exit 1; }

IPK_NAME="$(basename "$IPK")"
REMOTE_DIR="/media/developer/temp"
REMOTE_IPK="${REMOTE_DIR}/${IPK_NAME}"
REMOTE_HELPER="${REMOTE_DIR}/tv-install.sh"
LOCAL_HELPER="${ROOT_DIR}/scripts/tv-install.sh"

[[ -f "$LOCAL_HELPER" ]] || { echo "Missing $LOCAL_HELPER" >&2; exit 1; }

echo "==> IPK: $IPK_NAME"
echo "==> Target: ${TV_USER}@${TV_HOST}:${TV_PORT}"
if [[ "$NO_LAUNCH" -eq 1 ]]; then
  echo "==> Mode: install only (no launch)"
else
  echo "==> Mode: install + launch"
fi

if [[ "$PRINT_ONLY" -eq 1 ]]; then
  echo "scp $IPK_NAME and scripts/tv-install.sh to ${REMOTE_DIR}/"
  echo "ssh ... sh ${REMOTE_HELPER} ${REMOTE_IPK} ${APP_ID} ${NO_LAUNCH}"
  echo "ssh ... cat /tmp/keyreplacer-deploy.log"
  exit 0
fi

echo "==> Creating ${REMOTE_DIR}"
remote "mkdir -p '${REMOTE_DIR}'"

echo "==> Uploading IPK + tv-install.sh"
"${SCP_BASE[@]}" "$IPK" "${TV_USER}@${TV_HOST}:${REMOTE_IPK}"
"${SCP_BASE[@]}" "$LOCAL_HELPER" "${TV_USER}@${TV_HOST}:${REMOTE_HELPER}"

echo "==> Running on-device installer (log: /tmp/keyreplacer-deploy.log)"
if [[ "$QUIET" -eq 1 ]]; then
  remote "chmod +x '${REMOTE_HELPER}' && sh '${REMOTE_HELPER}' '${REMOTE_IPK}' '${APP_ID}' '${NO_LAUNCH}'; echo EXIT:\$?"
else
  remote "chmod +x '${REMOTE_HELPER}' && sh '${REMOTE_HELPER}' '${REMOTE_IPK}' '${APP_ID}' '${NO_LAUNCH}'; echo EXIT:\$?; echo '----- LOG -----'; cat /tmp/keyreplacer-deploy.log"
fi

echo "==> Deploy finished"
