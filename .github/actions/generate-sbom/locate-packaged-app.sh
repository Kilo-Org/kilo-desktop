#!/usr/bin/env bash
# Locates the Electron Forge packaged app under OUT_DIR and prints the
# generate-sbom inputs as GITHUB_OUTPUT lines (app-dir, platform, sbom-name,
# asar-path). The platform comes from the Forge output directory name
# (<product>-<platform>-<arch>), not the runner OS, so a Linux runner can
# describe a macOS or Windows build.
#
# Usage: APP_VERSION=<version> locate-packaged-app.sh <out-dir>
set -euo pipefail

OUT_DIR="${1:?usage: APP_VERSION=<version> locate-packaged-app.sh <out-dir>}"
: "${APP_VERSION:?APP_VERSION is required}"
# Hardcoded rather than derived from productName: this names the shipped
# desktop product, not the bundled kilo CLI, and must be stable for S3 keys.
PRODUCT=kilo-desktop

PACKAGED_DIR=$(find "$OUT_DIR" -mindepth 1 -maxdepth 1 -type d \
	\( -name "*-darwin-*" -o -name "*-win32-*" -o -name "*-linux-*" \) | head -n1)
[[ -n "$PACKAGED_DIR" ]] || { echo "::error::no packaged app directory found under $OUT_DIR" >&2; exit 1; }

PACKAGED_NAME=$(basename "$PACKAGED_DIR")
PLATFORM_ARCH="${PACKAGED_NAME##*-}"
case "$PACKAGED_NAME" in
	*-darwin-*)
		APP_DIR=$(find "$PACKAGED_DIR" -mindepth 1 -maxdepth 1 -name "*.app" -type d | head -n1)
		[[ -n "$APP_DIR" ]] || { echo "::error::no .app bundle found under $PACKAGED_DIR" >&2; exit 1; }
		PLATFORM="darwin-${PLATFORM_ARCH}"
		ASAR_PATH="$APP_DIR/Contents/Resources/app.asar"
		;;
	*-win32-*)
		APP_DIR="$PACKAGED_DIR"
		PLATFORM="win32-${PLATFORM_ARCH}"
		ASAR_PATH=$(find "$APP_DIR" -maxdepth 2 -name "app.asar" | head -n1 || true)
		;;
	*-linux-*)
		APP_DIR="$PACKAGED_DIR"
		PLATFORM="linux-${PLATFORM_ARCH}"
		ASAR_PATH=$(find "$APP_DIR" -maxdepth 2 -name "app.asar" | head -n1 || true)
		;;
esac

echo "app-dir=$APP_DIR"
echo "platform=$PLATFORM"
echo "sbom-name=${PRODUCT}_${APP_VERSION}_${PLATFORM}"
if [[ -n "$ASAR_PATH" && -f "$ASAR_PATH" ]]; then
	echo "asar-path=$ASAR_PATH"
fi
