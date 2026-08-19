#!/bin/bash
# LibreOffice WASM Build Script with Automatic Patching
# Builds LibreOffice for WASM with headless document conversion
#
# Usage:
#   ./build-wasm.sh                         # Full build
#   SKIP_DEPS=1 ./build-wasm.sh             # Skip apt dependencies  
#   BUILD_JOBS=32 ./build-wasm.sh           # Set parallel jobs
#   CLEAN_BUILD=1 ./build-wasm.sh           # Clean and rebuild
#   LIBREOFFICE_VERSION=libreoffice-24-8 ./build-wasm.sh  # Specify version

set -e

# Configuration
LIBREOFFICE_VERSION="${LIBREOFFICE_VERSION:-libreoffice-24-8}"
EMSDK_VERSION="${EMSDK_VERSION:-3.1.74}"
BUILD_JOBS="${BUILD_JOBS:-$(nproc)}"
SKIP_DEPS="${SKIP_DEPS:-0}"
CLEAN_BUILD="${CLEAN_BUILD:-0}"
RESET_PATCHED_SOURCE="${RESET_PATCHED_SOURCE:-0}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/patch-stack.sh"

# Detect Docker environment and use pre-installed paths
if [ -d "/opt/emsdk" ] && [ -d "/build/libreoffice" ]; then
    # Running in Docker - use pre-installed paths
    DOCKER_MODE=1
    BUILD_DIR="/build/libreoffice"
    OUTPUT_DIR="${OUTPUT_DIR:-/output}"
    EMSDK_DIR="/opt/emsdk"
else
    # Running locally
    DOCKER_MODE=0
    BUILD_DIR="${BUILD_DIR:-$HOME/libreoffice-wasm-build}"
    OUTPUT_DIR="${OUTPUT_DIR:-$(pwd)/wasm}"
    EMSDK_DIR="${BUILD_DIR}/emsdk"
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

echo ""
echo "=============================================="
echo "  LibreOffice WASM Build"
echo "=============================================="
echo ""
echo "Configuration:"
echo "  LibreOffice:  ${LIBREOFFICE_VERSION}"
echo "  Emscripten:   ${EMSDK_VERSION}"
echo "  Build Dir:    ${BUILD_DIR}"
echo "  Output Dir:   ${OUTPUT_DIR}"
echo "  EMSDK Dir:    ${EMSDK_DIR}"
echo "  Jobs:         ${BUILD_JOBS}"
echo "  Docker mode:  ${DOCKER_MODE}"
echo "  Clean build:  ${CLEAN_BUILD}"
echo "  Reset source: ${RESET_PATCHED_SOURCE}"
echo ""

mkdir -p "${BUILD_DIR}" "${OUTPUT_DIR}"
cd "${BUILD_DIR}"

# ============================================================
# Step 1: System Dependencies
# ============================================================
log_info "[1/7] Checking system dependencies..."

check_deps() {
    local missing=()
    for cmd in git python3 make gcc g++ cmake autoconf automake flex bison gawk gperf nasm pkg-config; do
        if ! command -v $cmd &> /dev/null; then
            missing+=($cmd)
        fi
    done
    if [ ${#missing[@]} -gt 0 ]; then
        echo "Missing: ${missing[*]}"
        return 1
    fi
    return 0
}

if [ "$SKIP_DEPS" = "1" ]; then
    log_warn "Skipping dependency check (SKIP_DEPS=1)"
elif check_deps; then
    log_success "All dependencies found"
else
    log_info "Installing dependencies..."
    if command -v apt-get &> /dev/null; then
        sudo apt-get update
        sudo apt-get install -y --no-install-recommends \
            build-essential git cmake ninja-build \
            python3 python3-pip python3-dev python3-setuptools \
            autoconf automake bison ccache flex gawk gettext \
            libarchive-dev libcups2-dev libcurl4-openssl-dev \
            libfontconfig1-dev libfreetype6-dev libglib2.0-dev \
            libharfbuzz-dev libicu-dev libjpeg-dev liblcms2-dev \
            libpng-dev libssl-dev libtool libxml2-dev libxslt1-dev \
            pkg-config uuid-dev xsltproc zip unzip wget curl \
            ca-certificates xz-utils gperf nasm
    else
        log_error "apt-get not found. Please install dependencies manually."
        exit 1
    fi
fi

# ============================================================
# Step 2: Emscripten SDK
# ============================================================
log_info "[2/7] Setting up Emscripten SDK..."

if [ "$DOCKER_MODE" = "1" ]; then
    # In Docker, Emscripten is pre-installed
    log_info "Using pre-installed Emscripten at ${EMSDK_DIR}..."
    cd "${EMSDK_DIR}"
    source "${EMSDK_DIR}/emsdk_env.sh"
    log_success "Emscripten $(emcc --version | head -1)"
else
    # Local build - download if needed
    if [ ! -d "${EMSDK_DIR}" ]; then
        log_info "Cloning Emscripten SDK..."
        git clone https://github.com/emscripten-core/emsdk.git "${EMSDK_DIR}"
    fi

    cd "${EMSDK_DIR}"

    if [ ! -f "${EMSDK_DIR}/upstream/emscripten/emcc" ]; then
        log_info "Installing Emscripten ${EMSDK_VERSION}..."
        ./emsdk install ${EMSDK_VERSION}
        ./emsdk activate ${EMSDK_VERSION}
    else
        ./emsdk activate ${EMSDK_VERSION}
    fi

    source "${EMSDK_DIR}/emsdk_env.sh"
    log_success "Emscripten $(emcc --version | head -1)"

    # Pre-compile system libraries
    log_info "Pre-compiling Emscripten system libraries..."
    embuilder build sysroot libc libc++ libc++abi 2>/dev/null || true
fi

# ============================================================
# Step 3: Clone LibreOffice
# ============================================================
log_info "[3/7] Setting up LibreOffice source..."

if [ "$DOCKER_MODE" = "1" ]; then
    # In Docker, LibreOffice is pre-cloned at /build/libreoffice
    LO_DIR="/build/libreoffice"
    log_success "Using pre-cloned LibreOffice at ${LO_DIR}"
else
    # Local build - clone if needed
    LO_DIR="${BUILD_DIR}/libreoffice"

    if [ ! -d "${LO_DIR}" ]; then
        log_info "Cloning LibreOffice ${LIBREOFFICE_VERSION} (this takes a while)..."
        git clone --depth 1 --branch ${LIBREOFFICE_VERSION} \
            https://git.libreoffice.org/core "${LO_DIR}"
    else
        log_success "LibreOffice source exists at ${LO_DIR}"
    fi
fi

cd "${LO_DIR}"

CONSOLIDATED_PATCH="${SCRIPT_DIR}/patches/wasm-build-fixes.patch"
CONVERSION_EXPORTS_PATCH="${SCRIPT_DIR}/patches/wasm-trim-lok-exports-conversion-only.patch"
CONVERSION_SHIMS_PATCH="${SCRIPT_DIR}/patches/wasm-trim-lok-shims-conversion-only.patch"
NATIVE_BRIDGE_PATCH="${SCRIPT_DIR}/patches/wasm-native-conversion-bridge.patch"
ACTIVE_PATCHES=("$CONSOLIDATED_PATCH")
if [ "${CONVERSION_ONLY:-0}" = "1" ]; then
    ACTIVE_PATCHES+=(
        "$CONVERSION_EXPORTS_PATCH"
        "$CONVERSION_SHIMS_PATCH"
        "$NATIVE_BRIDGE_PATCH"
    )
fi

# Clean if requested. A clean build also implies source normalization below.
if [ "$CLEAN_BUILD" = "1" ]; then
    log_warn "Cleaning previous build..."
    make clean 2>/dev/null || true
fi

# Cached build outputs are intentionally preserved, but tracked source must be
# pristine before the reviewed patch stack is replayed. This avoids mistaking a
# baseline patch for pending after later atoms modify the same files.
if [ "$RESET_PATCHED_SOURCE" = "1" ] || [ "$CLEAN_BUILD" = "1" ]; then
    log_warn "Resetting patched LibreOffice source while preserving ignored build outputs..."
    if reset_patched_source "${ACTIVE_PATCHES[@]}"; then
        log_success "LibreOffice source reset to HEAD"
    else
        log_error "Failed to reset LibreOffice source"
        exit 1
    fi
fi

# ============================================================
# Step 4: Apply Patches
# ============================================================
log_info "[4/7] Applying patches for headless WASM build..."

# Apply the consolidated WASM build fixes patch
# This patch includes all necessary fixes for headless WASM builds:
# - Repository.mk: conditional wpftdraw/wpftimpress based on ENABLE_CDR/ENABLE_ETONYEK
# - autogen.input: WASM build configuration
# - desktop/source/lib/init.cxx: LOK shim functions for WASM
# - solenv/gbuild/platform/EMSCRIPTEN_INTEL_GCC.mk: PROXY_TO_PTHREAD, exports
# - writerperfect module fixes
# - xmlsecurity headless fixes
# - Emscripten fs image optimizations
apply_reviewed_patch() {
    local patch_name="$1"
    local patch_path="$2"
    local patch_state

    if [ ! -f "$patch_path" ]; then
        log_error "Reviewed patch not found: $patch_path"
        return 1
    fi

    patch_state="$(patch_file_state "$patch_path")"
    case "$patch_state" in
        applied)
            log_success "${patch_name} already applied"
            ;;
        pending)
            log_info "Applying ${patch_name}..."
            if ! apply_pending_patch "$patch_path"; then
                log_error "Failed to apply ${patch_name}"
                return 1
            fi
            if [ "$(patch_file_state "$patch_path")" != "applied" ]; then
                log_error "${patch_name} did not reach the applied state"
                return 1
            fi
            log_success "Applied ${patch_name}"
            ;;
        inconsistent)
            log_error "${patch_name} is neither fully pending nor fully applied"
            log_error "Refusing a partial or fuzzy reapply; rerun with RESET_PATCHED_SOURCE=1"
            return 1
            ;;
        *)
            log_error "Unknown patch state '${patch_state}' for ${patch_name}"
            return 1
            ;;
    esac
}

apply_reviewed_patch "wasm-build-fixes.patch" "$CONSOLIDATED_PATCH"

# Conversion-only atoms -- applied ON TOP of the consolidated baseline patch
# when CONVERSION_ONLY=1. Independent atoms (archive 014/015 style), NOT
# one giant reverse-diff:
#   1. exports -- EXPORTED_FUNCTIONS link contract only (Executable_soffice_bin.mk)
#   2. shims   -- non-conversion LOK shim bodies only (desktop/source/lib/init.cxx)
#   3. bridge  -- private native conversion transaction (source + export list)
# Each atom is independently reversible for bisection. Order: exports, shims,
# then the private native conversion bridge.
# KEEP: conversion group (hook/preinit/load/saveAs/destroy/getError/malloc/free)
#       + abort group (abortOperation/setOperationTimeout/getOperationState/resetAbort).
# See build/patches/CONVERSION-ONLY-TRIM.md.
apply_conversion_atom() {
    apply_reviewed_patch "$@"
}

if [ "${CONVERSION_ONLY:-0}" = "1" ]; then
    log_info "CONVERSION_ONLY=1 -- applying conversion-only atoms (exports, shims, then bridge)..."
    apply_conversion_atom \
        "wasm-trim-lok-exports-conversion-only.patch" \
        "$CONVERSION_EXPORTS_PATCH"
    apply_conversion_atom \
        "wasm-trim-lok-shims-conversion-only.patch" \
        "$CONVERSION_SHIMS_PATCH"
    apply_conversion_atom \
        "wasm-native-conversion-bridge.patch" \
        "$NATIVE_BRIDGE_PATCH"
fi

# Create autotext files (handled in Step 6 background process)
# The mytexts autotext build tries to zip files that don't exist in WASM builds

# ============================================================
# Step 5: Configure LibreOffice
# ============================================================
log_info "[5/7] Configuring LibreOffice for WASM..."

# Copy the working autogen.input from the build directory
cp "${SCRIPT_DIR}/autogen.input" autogen.input
log_info "Using autogen.input from ${SCRIPT_DIR}/autogen.input"

log_info "Running autogen.sh..."
./autogen.sh

# Verify configuration
if [ -f "config_host.mk" ]; then
    log_success "Configuration complete"
    grep -E "^export (DISABLE_GUI|ENABLE_WASM)" config_host.mk || true
else
    log_error "Configuration failed - config_host.mk not created"
    exit 1
fi

# ============================================================
# Step 6: Build
# ============================================================
log_info "[6/7] Building LibreOffice WASM (this takes 1-4 hours)..."
echo "Started: $(date)"
echo ""

# Pre-build: create autotext files that cause zip errors
# This needs to happen after make starts creating workdir but before the zip step
create_autotext_files() {
    local AUTOTEXT_DIR="${LO_DIR}/workdir/CustomTarget/extras/source/autotext/user/mytexts"
    if [ -d "${AUTOTEXT_DIR}" ] && [ ! -f "${AUTOTEXT_DIR}/BlockList.xml" ]; then
        mkdir -p "${AUTOTEXT_DIR}/META-INF"
        
        # Copy or create BlockList.xml
        if [ -f "${LO_DIR}/extras/source/autotext/mytexts/BlockList.xml" ]; then
            cp "${LO_DIR}/extras/source/autotext/mytexts/BlockList.xml" "${AUTOTEXT_DIR}/"
        else
            cat > "${AUTOTEXT_DIR}/BlockList.xml" << 'XMLEOF'
<?xml version="1.0" encoding="UTF-8"?>
<block-list:block-list xmlns:block-list="http://openoffice.org/2001/block-list"/>
XMLEOF
        fi
        
        # Copy or create manifest.xml
        if [ -f "${LO_DIR}/extras/source/autotext/mytexts/META-INF/manifest.xml" ]; then
            cp "${LO_DIR}/extras/source/autotext/mytexts/META-INF/manifest.xml" "${AUTOTEXT_DIR}/META-INF/"
        else
            cat > "${AUTOTEXT_DIR}/META-INF/manifest.xml" << 'XMLEOF'
<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0">
 <manifest:file-entry manifest:media-type="application/vnd.sun.star.autotext" manifest:full-path="/"/>
 <manifest:file-entry manifest:media-type="text/xml" manifest:full-path="BlockList.xml"/>
</manifest:manifest>
XMLEOF
        fi
        
        touch "${AUTOTEXT_DIR}/mimetype"
        log_info "Created missing autotext XML files"
    fi
}

# Start a background process to create autotext files when needed
(
    sleep 30  # Wait for build to create workdir
    while true; do
        create_autotext_files
        sleep 10
    done
) &
AUTOTEXT_HELPER_PID=$!

# Cleanup function
cleanup_autotext_helper() {
    kill $AUTOTEXT_HELPER_PID 2>/dev/null || true
}
trap cleanup_autotext_helper EXIT

# Build with error handling
if make -j${BUILD_JOBS}; then
    log_success "Build completed successfully!"
else
    BUILD_EXIT=$?
    log_error "Build failed with exit code $BUILD_EXIT"
    echo ""
    echo "Check the build log for errors."
    echo "Common fixes:"
    echo "  - Run with CLEAN_BUILD=1 to start fresh"
    echo "  - Check if patches were applied correctly"
    echo "  - Reduce BUILD_JOBS if running out of memory"
    exit $BUILD_EXIT
fi

echo ""
echo "Finished: $(date)"

# ============================================================
# Step 7: Package Output
# ============================================================
# Deliver classic Emscripten glue for two loaders that share one body:
#   soffice.cjs — Node (require after setting global.Module)
#   soffice.js  — browser (<script> after setting window.Module)
# EMSCRIPTEN gbuild links the executable as soffice.html (gb_Executable_EXT);
# emscripten also emits aux soffice.js / .wasm / .worker.js beside it.
# Packaging copies that aux soffice.js → soffice.cjs (not the .html shell).
# Clear OUTPUT_DIR first so a failed copy cannot leave stale files.
# ============================================================
log_info "[7/7] Packaging WASM output..."

mkdir -p "${OUTPUT_DIR}"

# Remove duplicate soffice.data from SDK (saves 80MB)
if [ -f "instdir/sdk/bin/soffice.data" ] && [ -f "instdir/program/soffice.data" ]; then
    log_info "Removing duplicate soffice.data from sdk/bin/ (saves 80MB)..."
    rm -f instdir/sdk/bin/soffice.data
    rm -f instdir/sdk/bin/soffice.data.js.metadata
    log_success "Removed duplicate files"
fi

# Add minimal fallback fonts if --without-fonts was used
FONTS_DIR="instdir/share/fonts/truetype"
if [ ! -d "$FONTS_DIR" ] || [ -z "$(ls -A $FONTS_DIR 2>/dev/null)" ]; then
    log_info "Adding minimal fallback fonts..."
    mkdir -p "$FONTS_DIR"
    if [ ! -f "$FONTS_DIR/NotoSans-Regular.ttf" ]; then
        curl -sL "https://github.com/googlefonts/noto-fonts/raw/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf" \
            -o "$FONTS_DIR/NotoSans-Regular.ttf" 2>/dev/null || \
        log_warn "Could not download NotoSans font"
    fi
    if [ ! -f "$FONTS_DIR/NotoSerif-Regular.ttf" ]; then
        curl -sL "https://github.com/googlefonts/noto-fonts/raw/main/hinted/ttf/NotoSerif/NotoSerif-Regular.ttf" \
            -o "$FONTS_DIR/NotoSerif-Regular.ttf" 2>/dev/null || \
        log_warn "Could not download NotoSerif font"
    fi
    log_success "Added minimal fonts"
fi

# Resolve artifact directory
ARTIFACT_DIR=""
if [ -f "instdir/program/soffice.wasm" ]; then
    ARTIFACT_DIR="instdir/program"
else
    WASM_IN_WORKDIR=$(find workdir -name "soffice.wasm" 2>/dev/null | head -1)
    if [ -n "$WASM_IN_WORKDIR" ]; then
        ARTIFACT_DIR=$(dirname "$WASM_IN_WORKDIR")
    fi
fi

if [ -z "$ARTIFACT_DIR" ]; then
    log_error "Could not find soffice.wasm output!"
    find . -name "*.wasm" -size +1M 2>/dev/null | head -10
    exit 1
fi

# Aux classic glue from emscripten (-o soffice.html). Required for packaging.
if [ ! -f "${ARTIFACT_DIR}/soffice.js" ]; then
    log_error "Missing ${ARTIFACT_DIR}/soffice.js (emscripten aux glue next to soffice.html)."
    if [ -f "${ARTIFACT_DIR}/soffice.html" ]; then
        log_error "soffice.html exists but soffice.js does not — link step incomplete."
    fi
    if [ -f "${ARTIFACT_DIR}/soffice.mjs" ]; then
        log_error "Found soffice.mjs — ES module primary output; not used by require/script loaders."
    fi
    ls -la "${ARTIFACT_DIR}"/soffice* 2>/dev/null || true
    exit 1
fi

if [ ! -f "${ARTIFACT_DIR}/soffice.data" ]; then
    log_error "Missing ${ARTIFACT_DIR}/soffice.data"
    exit 1
fi

# This build entry point packages only the frozen main-script pthread profile.
# Bootstrap mode comes from the glue bytes, never from the presence of an
# optional sidecar file. External-worker glue requires a separate profile,
# inventory, and candidate identity.
if ! grep -qF 'mainScriptUrlOrBlob' "${ARTIFACT_DIR}/soffice.js"; then
    log_error "soffice.js is not main-script pthread glue (mainScriptUrlOrBlob missing)."
    exit 1
fi
if grep -qF 'soffice.worker.js' "${ARTIFACT_DIR}/soffice.js"; then
    log_error "soffice.js requests a standalone worker; external-worker artifacts are not accepted by this profile."
    exit 1
fi

# Remove prior outputs so packaging never ships a mix of old and new files
log_info "Clearing previous outputs in ${OUTPUT_DIR}..."
rm -f "${OUTPUT_DIR}/soffice.wasm" \
      "${OUTPUT_DIR}/soffice.cjs" \
      "${OUTPUT_DIR}/soffice.js" \
      "${OUTPUT_DIR}/soffice.data" \
      "${OUTPUT_DIR}/soffice.data.js.metadata" \
      "${OUTPUT_DIR}/soffice.worker.cjs" \
      "${OUTPUT_DIR}/soffice.worker.js"

log_info "Copying from ${ARTIFACT_DIR} (fail on error)..."
cp "${ARTIFACT_DIR}/soffice.wasm" "${OUTPUT_DIR}/soffice.wasm"
cp "${ARTIFACT_DIR}/soffice.js"   "${OUTPUT_DIR}/soffice.cjs"
cp "${ARTIFACT_DIR}/soffice.data" "${OUTPUT_DIR}/soffice.data"
if [ -f "${ARTIFACT_DIR}/soffice.data.js.metadata" ]; then
    cp "${ARTIFACT_DIR}/soffice.data.js.metadata" "${OUTPUT_DIR}/"
fi
log_success "Copied WASM artifacts"

# Node compatibility patches on soffice.cjs
log_info "Applying patches to soffice.cjs..."
cd "${OUTPUT_DIR}"

# 1. Prepend a single Node global.Module bootstrap line.
#    Guard must scan the whole file: a short head -c N truncates inside the
#    token "global.Module" and re-inserts on every run.
#    If duplicates already exist, keep exactly one line.
PATCH_GLOBAL_MODULE='if(typeof global!=="undefined"){var Module=global.Module=global.Module||{}}'
if grep -qF "${PATCH_GLOBAL_MODULE}" soffice.cjs; then
    awk -v p="${PATCH_GLOBAL_MODULE}" 'BEGIN{first=1} {
        if ($0 == p) { if (first) { print; first=0 } }
        else print
    }' soffice.cjs > soffice.cjs.tmp && mv soffice.cjs.tmp soffice.cjs
    log_success "global.Module bootstrap present (deduped)"
else
    { printf '%s\n' "${PATCH_GLOBAL_MODULE}"; cat soffice.cjs; } > soffice.cjs.tmp
    mv soffice.cjs.tmp soffice.cjs
    log_success "Added global.Module bootstrap"
fi

PATCH_COUNT=$(grep -cF "${PATCH_GLOBAL_MODULE}" soffice.cjs || true)
if [ "${PATCH_COUNT}" != "1" ]; then
    log_error "global.Module bootstrap count is ${PATCH_COUNT}, expected 1"
    exit 1
fi

# 2. PACKAGE_NAME path → relative
sed -i 's|PACKAGE_NAME="[^"]*emscripten_fs_image/soffice\.data"|PACKAGE_NAME="soffice.data"|g' soffice.cjs
sed -i "s|PACKAGE_NAME='[^']*emscripten_fs_image/soffice\.data'|PACKAGE_NAME='soffice.data'|g" soffice.cjs

# 3. datafile_ reference
sed -i 's|datafile_[^"]*emscripten_fs_image/soffice\.data|datafile_soffice.data|g' soffice.cjs

# 4. Browser copy (same classic body)
cp soffice.cjs soffice.js
log_success "Created browser copies"

for req in soffice.wasm soffice.data soffice.cjs soffice.js; do
    if [ ! -f "$req" ]; then
        log_error "Packaging incomplete: missing ${OUTPUT_DIR}/${req}"
        exit 1
    fi
done

if find "${OUTPUT_DIR}" -type f \( -name 'soffice.worker.js' -o -name 'soffice.worker.cjs' \) -print -quit | grep -q .; then
    log_error "Packaging contract violation: standalone pthread worker present in main-script output."
    exit 1
fi

cd "${LO_DIR}"

echo ""
echo "=============================================="
echo "  Build Complete!"
echo "=============================================="
echo ""
echo "Output files in ${OUTPUT_DIR}:"
ls -lh "${OUTPUT_DIR}"/*.wasm "${OUTPUT_DIR}"/*.js "${OUTPUT_DIR}"/*.cjs "${OUTPUT_DIR}"/*.data 2>/dev/null || true

if command -v gzip &> /dev/null; then
    echo ""
    echo "Compressed sizes (gzip -9):"
    for f in "${OUTPUT_DIR}"/*.wasm "${OUTPUT_DIR}"/*.data; do
        if [ -f "$f" ]; then
            COMPRESSED=$(gzip -9 -c "$f" | wc -c)
            ORIGINAL=$(stat -c %s "$f" 2>/dev/null || stat -f %z "$f")
            RATIO=$((COMPRESSED * 100 / ORIGINAL))
            echo "  $(basename $f): $(numfmt --to=iec $COMPRESSED 2>/dev/null || echo $COMPRESSED) (${RATIO}% of original)"
        fi
    done
fi

echo ""
log_success "LibreOffice WASM build complete!"
echo ""
echo "To use the build:"
echo "  npm run build    # Build TypeScript API"
echo "  npm start        # Start test server"
echo ""
