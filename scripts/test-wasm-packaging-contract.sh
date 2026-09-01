#!/usr/bin/env bash
# Local simulation of build-wasm.sh packaging (no full LibreOffice build).
#
# Asserts the no-pthread packaging contract:
#   - build tree with only soffice.mjs → reject
#   - clean classic soffice.js → soffice.cjs with one global.Module bootstrap
#   - dirty bootstrap input is deduplicated and stale output is removed
#   - pthread glue, worker sidecars, and shared WASM memory are rejected
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_WASM="$ROOT/build/build-wasm.sh"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

PATCH_GLOBAL_MODULE='if(typeof global!=="undefined"){var Module=global.Module=global.Module||{}}'

write_unshared_wasm() {
  printf '\x00\x61\x73\x6d\x01\x00\x00\x00\x05\x03\x01\x00\x01' > "$1"
}

write_shared_wasm() {
  printf '\x00\x61\x73\x6d\x01\x00\x00\x00\x05\x04\x01\x03\x01\x01' > "$1"
}

package_once() {
  local ARTIFACT_DIR="$1"
  local OUTPUT_DIR="$2"

  if [ ! -f "${ARTIFACT_DIR}/soffice.wasm" ]; then
    echo "FAIL: no wasm"; return 1
  fi
  if [ ! -f "${ARTIFACT_DIR}/soffice.js" ]; then
    echo "reject-mjs-or-missing-js"
    if [ -f "${ARTIFACT_DIR}/soffice.mjs" ]; then
      return 2
    fi
    return 1
  fi
  if [ ! -f "${ARTIFACT_DIR}/soffice.data" ]; then
    echo "FAIL: no data"; return 1
  fi
  if ! node "$ROOT/scripts/inspect-no-pthread-runtime.mjs" "$ARTIFACT_DIR" >/dev/null 2>&1; then
    echo "reject-threaded-runtime"; return 3
  fi

  rm -f "${OUTPUT_DIR}/soffice.wasm" "${OUTPUT_DIR}/soffice.cjs" "${OUTPUT_DIR}/soffice.js" \
        "${OUTPUT_DIR}/soffice.data" "${OUTPUT_DIR}/soffice.worker.cjs" "${OUTPUT_DIR}/soffice.worker.js"

  cp "${ARTIFACT_DIR}/soffice.wasm" "${OUTPUT_DIR}/soffice.wasm"
  cp "${ARTIFACT_DIR}/soffice.js"   "${OUTPUT_DIR}/soffice.cjs"
  cp "${ARTIFACT_DIR}/soffice.data" "${OUTPUT_DIR}/soffice.data"

  cd "${OUTPUT_DIR}"
  if grep -qF "${PATCH_GLOBAL_MODULE}" soffice.cjs; then
    awk -v p="${PATCH_GLOBAL_MODULE}" 'BEGIN{first=1} {
      if ($0 == p) { if (first) { print; first=0 } }
      else print
    }' soffice.cjs > soffice.cjs.tmp && mv soffice.cjs.tmp soffice.cjs
  else
    { printf '%s\n' "${PATCH_GLOBAL_MODULE}"; cat soffice.cjs; } > soffice.cjs.tmp
    mv soffice.cjs.tmp soffice.cjs
  fi
  local n
  n=$(grep -cF "${PATCH_GLOBAL_MODULE}" soffice.cjs || true)
  if [ "$n" != "1" ]; then
    echo "FAIL: patch count $n"; return 1
  fi
  cp soffice.cjs soffice.js
  return 0
}

CLASSIC='function GROWABLE_HEAP_I8(){return 1}'

echo "=== Test 1: only soffice.mjs → must fail (code 2) ==="
A1="$WORK/art1"; O1="$WORK/out1"
mkdir -p "$A1" "$O1"
write_unshared_wasm "$A1/soffice.wasm"
echo fakedata > "$A1/soffice.data"
echo 'export default function createSofficeModule(){}' > "$A1/soffice.mjs"
set +e
package_once "$A1" "$O1"
rc=$?
set -e
if [ "$rc" != "2" ]; then
  echo "FAIL: expected exit 2 for mjs-only, got $rc"
  exit 1
fi
echo "PASS: mjs-only rejected"

echo "=== Test 2: clean classic soffice.js → one global.Module line ==="
A2="$WORK/art2"; O2="$WORK/out2"
mkdir -p "$A2" "$O2"
write_unshared_wasm "$A2/soffice.wasm"
echo fakedata > "$A2/soffice.data"
printf '%s\n' "$CLASSIC" > "$A2/soffice.js"
package_once "$A2" "$O2"
n=$(grep -cF "$PATCH_GLOBAL_MODULE" "$O2/soffice.cjs")
body=$(grep -vF "$PATCH_GLOBAL_MODULE" "$O2/soffice.cjs" | tr -d '\r')
if [ "$n" != "1" ] || [ "$body" != "$CLASSIC" ]; then
  echo "FAIL: n=$n body=$body"
  cat -A "$O2/soffice.cjs"
  exit 1
fi
if [ ! -f "$O2/soffice.js" ]; then
  echo "FAIL: missing browser js"; exit 1
fi
echo "PASS: classic js → cjs with exactly one bootstrap line"

echo "=== Test 3: dirty bootstrap + stale output → clean replacement ==="
A3="$WORK/art3"; O3="$WORK/out3"
mkdir -p "$A3" "$O3"
write_unshared_wasm "$A3/soffice.wasm"
echo fakedata > "$A3/soffice.data"
{
  printf '%s\n' "$PATCH_GLOBAL_MODULE"
  printf '%s\n' "$PATCH_GLOBAL_MODULE"
  printf '%s\n' "$PATCH_GLOBAL_MODULE"
  printf '%s\n' "$CLASSIC"
} > "$A3/soffice.js"
printf 'STALE_LFS_BODY\n' > "$O3/soffice.cjs"
printf 'STALE_WORKER\n' > "$O3/soffice.worker.js"
package_once "$A3" "$O3"
n=$(grep -cF "$PATCH_GLOBAL_MODULE" "$O3/soffice.cjs")
if [ "$n" != "1" ]; then
  echo "FAIL: expected 1 bootstrap line after dedupe, got $n"
  cat -A "$O3/soffice.cjs"
  exit 1
fi
if grep -q STALE_LFS_BODY "$O3/soffice.cjs" || [ -e "$O3/soffice.worker.js" ]; then
  echo "FAIL: stale output was not removed"
  exit 1
fi
echo "PASS: dirty input deduped; stale output removed"

echo "=== Test 4: pthread glue → must fail (code 3) ==="
A4="$WORK/art4"; O4="$WORK/out4"
mkdir -p "$A4" "$O4"
write_unshared_wasm "$A4/soffice.wasm"
echo fakedata > "$A4/soffice.data"
printf '%s\n' 'var pthreadMainJs=Module["mainScriptUrlOrBlob"];new Worker("soffice.worker.js")' > "$A4/soffice.js"
set +e
package_once "$A4" "$O4"
rc=$?
set -e
if [ "$rc" != "3" ]; then
  echo "FAIL: expected exit 3 for pthread glue, got $rc"
  exit 1
fi
echo "PASS: pthread glue rejected"

echo "=== Test 5: pthread worker sidecar → must fail (code 3) ==="
A5="$WORK/art5"; O5="$WORK/out5"
mkdir -p "$A5" "$O5"
write_unshared_wasm "$A5/soffice.wasm"
echo fakedata > "$A5/soffice.data"
printf '%s\n' "$CLASSIC" > "$A5/soffice.js"
printf '%s\n' 'forbidden-worker' > "$A5/soffice.worker.js"
set +e
package_once "$A5" "$O5"
rc=$?
set -e
if [ "$rc" != "3" ]; then
  echo "FAIL: expected exit 3 for pthread worker sidecar, got $rc"
  exit 1
fi
echo "PASS: pthread worker sidecar rejected"

echo "=== Test 6: shared WASM memory → must fail (code 3) ==="
A6="$WORK/art6"; O6="$WORK/out6"
mkdir -p "$A6" "$O6"
write_shared_wasm "$A6/soffice.wasm"
echo fakedata > "$A6/soffice.data"
printf '%s\n' "$CLASSIC" > "$A6/soffice.js"
set +e
package_once "$A6" "$O6"
rc=$?
set -e
if [ "$rc" != "3" ]; then
  echo "FAIL: expected exit 3 for shared WASM memory, got $rc"
  exit 1
fi
echo "PASS: shared WASM memory rejected"

echo "=== Test 7: build-wasm.sh syntax ==="
bash -n "$BUILD_WASM"
echo "PASS: bash -n build-wasm.sh"

if grep -q "EXPORT_ES6=1" "$ROOT/build/patches/wasm-build-fixes.patch"; then
  echo "FAIL: patch still contains EXPORT_ES6=1"
  exit 1
fi
if grep -E "^\+gb_Executable_FILENAMES.*soffice\.mjs" "$ROOT/build/patches/wasm-build-fixes.patch" | grep -q .; then
  echo "FAIL: patch still maps FILENAMES to soffice.mjs"
  exit 1
fi
echo "PASS: patch uses classic soffice.js (no EXPORT_ES6 link flags)"

echo ""
echo "All no-pthread packaging simulations passed."
