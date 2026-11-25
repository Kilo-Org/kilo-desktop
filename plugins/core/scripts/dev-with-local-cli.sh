#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# dev-with-local-cli.sh
#
# Build the Kilo v2 CLI (`kilo2`, kilocode's `v2` branch) from a local checkout
# and launch the Desktop app pointing at the freshly-built binary. Useful for testing CLI changes end-to-end without
# publishing a release.
#
# All options can be passed as CLI flags or environment variables. CLI flags take
# precedence over env vars, and env vars take precedence over the defaults below.
# ──────────────────────────────────────────────────────────────────────────────

# ── Defaults (tweak these for your setup) ─────────────────────────────────────

DEFAULT_KILO_SRC="$HOME/src/kilocode"
DEFAULT_KILO_ENV=""
DEFAULT_BUN="$(command -v bun 2>/dev/null || echo "$HOME/.bun/bin/bun")"

# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

usage() {
  cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Build the Kilo v2 CLI from a local source tree and launch the Kilo Desktop
with the custom binary. Skips the normal prestart plugin-asset preparation
since the CLI binary is provided directly.

Options:
  -s, --src PATH        Path to the kilocode repo checkout
                        [env: KILO_SRC, default: $DEFAULT_KILO_SRC]
  -e, --env VARS        Extra env vars for the CLI process (space-separated KEY=VAL pairs)
                        [env: KILO_ENV, default: $DEFAULT_KILO_ENV]
  -b, --bun PATH        Path to the bun binary
                        [env: BUN, default: auto-detected]
  --skip-build          Skip the CLI build step (reuse previous binary)
  -h, --help            Show this help message

Examples:
  # Build and run with defaults
  ./plugins/core/scripts/dev-with-local-cli.sh

  # Point at a different kilocode checkout
  ./plugins/core/scripts/dev-with-local-cli.sh --src ~/forks/kilocode

  # Pass extra env vars to the CLI process
  ./plugins/core/scripts/dev-with-local-cli.sh --env "KILO_DISABLE_MODELS_FETCH=true"

  # Skip build, just launch with the last-built binary
  ./plugins/core/scripts/dev-with-local-cli.sh --skip-build

  # Override via environment variables
  KILO_SRC=~/my-fork BUN=/opt/bun/bin/bun ./plugins/core/scripts/dev-with-local-cli.sh
EOF
  exit 0
}

# ── Parse CLI arguments ───────────────────────────────────────────────────────

SKIP_BUILD=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    -s|--src)
      KILO_SRC="$2"; shift 2 ;;
    -e|--env)
      KILO_ENV="$2"; shift 2 ;;
    -b|--bun)
      BUN="$2"; shift 2 ;;
    --skip-build)
      SKIP_BUILD=true; shift ;;
    -h|--help)
      usage ;;
    *)
      echo "error: unknown option '$1'" >&2
      echo "Run with --help for usage." >&2
      exit 1 ;;
  esac
done

# Apply env-var fallbacks for anything not set via CLI flags
KILO_SRC="${KILO_SRC:-$DEFAULT_KILO_SRC}"
KILO_ENV="${KILO_ENV:-$DEFAULT_KILO_ENV}"
BUN="${BUN:-$DEFAULT_BUN}"

# ── Derived paths ─────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64)  TARGET="darwin-arm64" ;;
  Darwin-x86_64) TARGET="darwin-x64"   ;;
  Linux-x86_64)  TARGET="linux-x64" ;;
  Linux-aarch64) TARGET="linux-arm64" ;;
  *)
    echo "error: unsupported platform $(uname -s)-$(uname -m)" >&2
    exit 1 ;;
esac

BUILT_BINARY="$KILO_SRC/packages/kilo-cli/dist/cli-$TARGET/bin/kilo2"

# ── Build step ────────────────────────────────────────────────────────────────

if [[ "$SKIP_BUILD" == false ]]; then
  if [[ ! -x "$BUN" ]]; then
    echo "error: bun not found at '$BUN'" >&2
    echo "  Install: curl -fsSL https://bun.sh/install | bash" >&2
    echo "  Or pass --bun /path/to/bun" >&2
    exit 1
  fi

  if [[ ! -d "$KILO_SRC/packages/kilo-cli" ]]; then
    echo "error: Kilo source not found at '$KILO_SRC'" >&2
    echo "  Pass --src /path/to/kilocode" >&2
    exit 1
  fi

  if [[ ! -d "$KILO_SRC/node_modules" ]]; then
    echo "==> Installing dependencies in $KILO_SRC ..."
    "$BUN" install --cwd "$KILO_SRC"
  fi

  echo "==> Building Kilo CLI from $KILO_SRC ..."
  "$BUN" run --cwd "$KILO_SRC/packages/kilo-cli" script/build.ts --single --skip-install
  echo "==> Built: $BUILT_BINARY"
else
  echo "==> Skipping build (--skip-build)"
fi

if [[ ! -f "$BUILT_BINARY" ]]; then
  echo "error: built binary not found at '$BUILT_BINARY'" >&2
  echo "  Did the build succeed? Check --src path and platform target ($TARGET)." >&2
  exit 1
fi

# ── Launch Desktop ────────────────────────────────────────────────────────────
# We bypass the normal `pnpm dev` → `prestart` → `prepare:plugins` chain because
# (a) we're injecting the CLI binary via KILO_CODE_CLI_PATH so fetch-cli is
# unnecessary, and (b) other plugins' prepare-assets (e.g. notebook) may fail in
# incomplete dev environments. Instead we run the web dev server + electron-forge
# directly, mirroring what `pnpm dev:desktop` does without lifecycle hooks.

# forge.config.ts validates notebook assets exist even during `start`. Stub them
# if missing so the config loads without running the full notebook prepare step.
stub_notebook_assets() {
  local notebook_dir="$WORKSPACE_ROOT/plugins/notebook"
  local platform arch forge_target
  platform="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"
  [[ "$platform" == "darwin" ]] || platform="linux"
  [[ "$arch" == "arm64" ]] && forge_target="${platform}-arm64" || forge_target="${platform}-x64"

  local stubs=(
    "$notebook_dir/build/notebook/index.html"
    "$notebook_dir/build/notebook/kilo-notebook-build.json"
    "$notebook_dir/resources/nteract-mcp/$forge_target/nteract-mcp"
    "$notebook_dir/resources/nteract-mcp/$forge_target/runt"
    "$notebook_dir/resources/nteract-mcp/$forge_target/staged.json"
    "$notebook_dir/resources/runtimed/$forge_target/runtimed"
    "$notebook_dir/resources/runtimed/$forge_target/staged.json"
  )

  local created=false
  for f in "${stubs[@]}"; do
    if [[ ! -f "$f" ]]; then
      mkdir -p "$(dirname "$f")"
      echo "{}" > "$f"
      created=true
    fi
  done
  if [[ "$created" == true ]]; then
    echo "==> Created notebook asset stubs (forge.config.ts validation)"
  fi
}

stub_notebook_assets

# Kill orphan relay processes holding port 9345 from previous runs so the new
# Desktop's relay can bind successfully.
orphan_pids=$(lsof -t -i :9345 2>/dev/null || true)
if [[ -n "$orphan_pids" ]]; then
  echo "==> Killing orphan relay process(es) on port 9345: $orphan_pids"
  kill $orphan_pids 2>/dev/null || true
  sleep 1
fi

echo "==> Launching Desktop with custom CLI binary"
echo "    Binary:    $BUILT_BINARY"
echo "    Extra env: $KILO_ENV"
echo ""

export KILO_CODE_CLI_PATH="$BUILT_BINARY"

for pair in $KILO_ENV; do
  export "$pair"
done

cd "$WORKSPACE_ROOT"

# Use workspace-local binaries directly to avoid npx overhead
BIN="$WORKSPACE_ROOT/node_modules/.bin"

exec "$BIN/concurrently" --kill-others --success first \
  "pnpm dev:web" \
  "$BIN/wait-on http://127.0.0.1:5173 && cd apps/desktop && $BIN/cross-env KILO_WEB_DEV_SERVER_URL=http://127.0.0.1:5173 $BIN/electron-forge start -- --remote-debugging-port=9222"
