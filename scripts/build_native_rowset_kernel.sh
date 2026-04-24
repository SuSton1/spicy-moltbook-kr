#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
SRC_FILE="$ROOT_DIR/native/perfect_prototype_rowset_kernel/src/kernel.cc"
OUT_DIR="${PERFECT_PROTO_NATIVE_ROWSET_KERNEL_BUILD_DIR:-$ROOT_DIR/native/perfect_prototype_rowset_kernel/build/Release}"
OUT_FILE="$OUT_DIR/perfect_prototype_rowset_kernel.node"
MANIFEST_FILE="$OUT_DIR/perfect_prototype_rowset_kernel.build.json"
REQUIRED_CPU_FEATURES=(avx2 popcnt)
SIMD_KERNEL_MODE="avx2_exact_bitset"
SPARSE_KERNEL_MODE="adaptive_exact_v4"

hash_file() {
  local file_path="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file_path" | awk '{print $1}'
    return 0
  fi
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file_path" | awk '{print $1}'
    return 0
  fi
  node --input-type=module -e '
    import crypto from "node:crypto"
    import fs from "node:fs"
    const filePath = process.argv[1]
    const digest = crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")
    process.stdout.write(digest)
  ' "$file_path"
}

resolve_node_include_dir() {
  local candidates=()
  mapfile -t candidates < <(
    node --input-type=module <<'EOF'
import path from "node:path"

const candidates = new Set()
candidates.add(path.resolve(path.dirname(process.execPath), "..", "include", "node"))
const configuredNodeDir = process.config?.variables?.nodedir
if (typeof configuredNodeDir === "string" && configuredNodeDir.length > 0) {
  candidates.add(path.resolve(configuredNodeDir))
  candidates.add(path.resolve(configuredNodeDir, "include", "node"))
}
for (const candidate of [
  process.env.npm_config_nodedir,
  process.env.NODE_INCLUDE_DIR,
  "/usr/include/node",
  "/usr/local/include/node",
  "/opt/homebrew/include/node",
]) {
  if (typeof candidate === "string" && candidate.length > 0) {
    candidates.add(path.resolve(candidate))
  }
}
for (const candidate of candidates) {
  console.log(candidate)
}
EOF
  )
  local candidate=""
  for candidate in "${candidates[@]}"; do
    if [[ -f "$candidate/node_api.h" ]]; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  return 1
}

resolve_cpu_flags() {
  if [[ "$(node -p 'process.platform')" == "linux" ]]; then
    if command -v lscpu >/dev/null 2>&1; then
      lscpu | awk -F: '/Flags:/ {print tolower($2)}' | tr -s '[:space:]' ' ' | sed 's/^ //'
      return 0
    fi
    if [[ -f /proc/cpuinfo ]]; then
      awk -F: '/^flags[[:space:]]*:/ {print tolower($2); exit}' /proc/cpuinfo | tr -s '[:space:]' ' ' | sed 's/^ //'
      return 0
    fi
  fi
  if [[ "$(node -p 'process.platform')" == "darwin" ]] && command -v sysctl >/dev/null 2>&1; then
    {
      sysctl -n machdep.cpu.features 2>/dev/null || true
      sysctl -n machdep.cpu.leaf7_features 2>/dev/null || true
    } | tr '[:upper:]' '[:lower:]' | tr '\n' ' ' | tr -s '[:space:]' ' ' | sed 's/^ //; s/ $//'
    return 0
  fi
  return 1
}

cpu_flags_contain() {
  local flags="$1"
  local needle="$2"
  [[ " $flags " == *" ${needle,,} "* ]]
}

if [[ ! -f "$SRC_FILE" ]]; then
  echo "[fatal] native rowset kernel source missing: $SRC_FILE" >&2
  exit 4
fi

if ! command -v c++ >/dev/null 2>&1; then
  echo "[fatal] required compiler not found: c++" >&2
  exit 4
fi

if ! NODE_INCLUDE_DIR="$(resolve_node_include_dir)"; then
  echo "[fatal] Node-API headers not found in known header locations" >&2
  echo "[fatal] remediation: install a Node distribution that includes headers for $(node -v) or set NODE_INCLUDE_DIR/npm_config_nodedir" >&2
  exit 4
fi
if [[ ! -f "$NODE_INCLUDE_DIR/node_api.h" ]]; then
  echo "[fatal] Node-API headers not found: $NODE_INCLUDE_DIR/node_api.h" >&2
  echo "[fatal] remediation: install a Node distribution that includes headers for $(node -v)" >&2
  exit 4
fi

mkdir -p "$OUT_DIR"

PLATFORM="$(node -p 'process.platform')"
ARCH="$(node -p 'process.arch')"
NODE_VERSION="$(node -p 'process.version')"
NODE_API_VERSION="$(node -p 'String(process.versions.napi ?? "")')"
NODE_EXEC_PATH="$(node -p 'process.execPath')"
COMPILER_VERSION="$(c++ --version | head -n1 | tr -d '\r')"
if [[ "$ARCH" != "x64" ]]; then
  echo "[fatal] native rowset kernel requires x64/AVX2 runtime: arch=$ARCH" >&2
  exit 4
fi
if ! CPU_FLAGS="$(resolve_cpu_flags)"; then
  echo "[fatal] unable to resolve CPU flags for AVX2 native rowset kernel preflight" >&2
  exit 4
fi
for required_feature in "${REQUIRED_CPU_FEATURES[@]}"; do
  if ! cpu_flags_contain "$CPU_FLAGS" "$required_feature"; then
    echo "[fatal] native rowset kernel requires CPU feature '$required_feature'" >&2
    echo "[fatal] detected CPU flags: $CPU_FLAGS" >&2
    exit 4
  fi
done
SOURCE_SHA256="$(hash_file "$SRC_FILE")"
COMPILER_FLAGS="-O3 -std=c++20 -shared -fPIC -mavx2 -mpopcnt"
BUILD_INPUTS_HASH="$(
  SOURCE_SHA256="$SOURCE_SHA256" \
  NODE_VERSION="$NODE_VERSION" \
  NODE_API_VERSION="$NODE_API_VERSION" \
  PLATFORM="$PLATFORM" \
  ARCH="$ARCH" \
  NODE_INCLUDE_DIR="$NODE_INCLUDE_DIR" \
  NODE_EXEC_PATH="$NODE_EXEC_PATH" \
  COMPILER_VERSION="$COMPILER_VERSION" \
  CPU_FLAGS="$CPU_FLAGS" \
  COMPILER_FLAGS="$COMPILER_FLAGS" \
  SIMD_KERNEL_MODE="$SIMD_KERNEL_MODE" \
  SPARSE_KERNEL_MODE="$SPARSE_KERNEL_MODE" \
  node --input-type=module <<'EOF'
import crypto from "node:crypto"

const payload = JSON.stringify({
  sourceSha256: process.env.SOURCE_SHA256,
  nodeVersion: process.env.NODE_VERSION,
  nodeApiVersion: process.env.NODE_API_VERSION,
  platform: process.env.PLATFORM,
  arch: process.env.ARCH,
  nodeIncludeDir: process.env.NODE_INCLUDE_DIR,
  nodeExecPath: process.env.NODE_EXEC_PATH,
  compilerVersion: process.env.COMPILER_VERSION,
  compilerFlags: process.env.COMPILER_FLAGS,
  cpuFlags: process.env.CPU_FLAGS,
  simdKernelMode: process.env.SIMD_KERNEL_MODE,
  sparseKernelMode: process.env.SPARSE_KERNEL_MODE,
})
process.stdout.write(crypto.createHash("sha256").update(payload).digest("hex"))
EOF
)"

if [[ -f "$OUT_FILE" && -f "$MANIFEST_FILE" ]]; then
  EXISTING_MANIFEST_FIELDS="$(
    node --input-type=module - "$MANIFEST_FILE" <<'EOF' 2>/dev/null || true
import fs from "node:fs"

const manifestPath = process.argv[2]
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
const requiredCpuFeatures = Array.isArray(manifest.requiredCpuFeatures)
  ? manifest.requiredCpuFeatures.map((value) => String(value)).sort().join(",")
  : ""
process.stdout.write(
  [
    String(manifest.buildInputsHash ?? ""),
    String(manifest.sourceSha256 ?? ""),
    String(manifest.outputSha256 ?? ""),
    String(manifest.nodeApiVersion ?? ""),
    String(manifest.platform ?? ""),
    String(manifest.arch ?? ""),
    String(manifest.simdRequired ?? ""),
    String(manifest.simdKernelMode ?? ""),
    String(manifest.sparseKernelMode ?? ""),
    requiredCpuFeatures,
  ].join("\t"),
)
EOF
  )"
  IFS=$'\t' read -r \
    EXISTING_INPUT_HASH \
    EXISTING_SOURCE_SHA256 \
    EXISTING_OUTPUT_SHA256 \
    EXISTING_NODE_API_VERSION \
    EXISTING_PLATFORM \
    EXISTING_ARCH \
    EXISTING_SIMD_REQUIRED \
    EXISTING_SIMD_KERNEL_MODE \
    EXISTING_SPARSE_KERNEL_MODE \
    EXISTING_REQUIRED_CPU_FEATURES <<<"$EXISTING_MANIFEST_FIELDS"
  EXISTING_BINARY_OK="false"
  EXISTING_BINARY_SHA256=""
  if EXISTING_BINARY_SHA256="$(hash_file "$OUT_FILE" 2>/dev/null)"; then
    EXISTING_BINARY_OK="true"
  fi
  if [[ "$EXISTING_INPUT_HASH" == "$BUILD_INPUTS_HASH" ]] \
    && [[ "$EXISTING_SOURCE_SHA256" == "$SOURCE_SHA256" ]] \
    && [[ "$EXISTING_BINARY_OK" == "true" ]] \
    && [[ "$EXISTING_OUTPUT_SHA256" == "$EXISTING_BINARY_SHA256" ]] \
    && [[ "$EXISTING_NODE_API_VERSION" == "$NODE_API_VERSION" ]] \
    && [[ "$EXISTING_PLATFORM" == "$PLATFORM" ]] \
    && [[ "$EXISTING_ARCH" == "$ARCH" ]] \
    && [[ "$EXISTING_SIMD_REQUIRED" == "true" ]] \
    && [[ "$EXISTING_SIMD_KERNEL_MODE" == "$SIMD_KERNEL_MODE" ]] \
    && [[ "$EXISTING_SPARSE_KERNEL_MODE" == "$SPARSE_KERNEL_MODE" ]] \
    && [[ "$EXISTING_REQUIRED_CPU_FEATURES" == "avx2,popcnt" ]]; then
    echo "[ok] native rowset kernel already up to date: $OUT_FILE"
    exit 0
  fi
fi

COMMON_FLAGS=(
  "-O3"
  "-std=c++20"
  "-shared"
  "-fPIC"
  "-mavx2"
  "-mpopcnt"
  "-DNAPI_VERSION=$NODE_API_VERSION"
  "-DPERFECT_PROTO_SIMD_KERNEL_MODE=\"$SIMD_KERNEL_MODE\""
  "-I$NODE_INCLUDE_DIR"
  "$SRC_FILE"
  "-o"
  "$OUT_FILE"
)

if [[ "$PLATFORM" == "Darwin" ]]; then
  c++ "${COMMON_FLAGS[@]}" -undefined dynamic_lookup
else
  c++ "${COMMON_FLAGS[@]}"
fi

OUTPUT_SHA256="$(hash_file "$OUT_FILE")"
TMP_MANIFEST="$(mktemp "$OUT_DIR/perfect_prototype_rowset_kernel.build.XXXXXX.json")"
trap 'rm -f "$TMP_MANIFEST"' EXIT
BUILD_INPUTS_HASH="$BUILD_INPUTS_HASH" \
SOURCE_SHA256="$SOURCE_SHA256" \
OUTPUT_SHA256="$OUTPUT_SHA256" \
NODE_VERSION="$NODE_VERSION" \
NODE_API_VERSION="$NODE_API_VERSION" \
PLATFORM="$PLATFORM" \
ARCH="$ARCH" \
NODE_INCLUDE_DIR="$NODE_INCLUDE_DIR" \
NODE_EXEC_PATH="$NODE_EXEC_PATH" \
COMPILER_VERSION="$COMPILER_VERSION" \
CPU_FLAGS="$CPU_FLAGS" \
COMPILER_FLAGS="$COMPILER_FLAGS" \
SIMD_KERNEL_MODE="$SIMD_KERNEL_MODE" \
SPARSE_KERNEL_MODE="$SPARSE_KERNEL_MODE" \
node --input-type=module <<'EOF' > "$TMP_MANIFEST"
const manifest = {
  buildInputsHash: process.env.BUILD_INPUTS_HASH,
  sourceSha256: process.env.SOURCE_SHA256,
  outputSha256: process.env.OUTPUT_SHA256,
  nodeVersion: process.env.NODE_VERSION,
  nodeApiVersion: process.env.NODE_API_VERSION,
  platform: process.env.PLATFORM,
  arch: process.env.ARCH,
  nodeIncludeDir: process.env.NODE_INCLUDE_DIR,
  nodeExecPath: process.env.NODE_EXEC_PATH,
  compilerVersion: process.env.COMPILER_VERSION,
  compilerFlags: process.env.COMPILER_FLAGS,
  cpuFlags: process.env.CPU_FLAGS,
  simdRequired: true,
  simdKernelMode: process.env.SIMD_KERNEL_MODE,
  sparseKernelMode: process.env.SPARSE_KERNEL_MODE,
  requiredCpuFeatures: ["avx2", "popcnt"],
  builtAt: new Date().toISOString(),
}
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`)
EOF
mv "$TMP_MANIFEST" "$MANIFEST_FILE"
trap - EXIT

echo "[ok] built native rowset kernel: $OUT_FILE"
