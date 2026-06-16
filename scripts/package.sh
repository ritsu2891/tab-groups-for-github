#!/usr/bin/env bash
# Build a Chrome Web Store distribution zip (macOS / Linux).
# Includes only the files the extension needs to run; output goes to dist/.
#   Usage:  ./scripts/package.sh        (runs from zsh or bash)
#           bash scripts/package.sh
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
name='tab-groups-for-github'
version="$(grep -m1 '"version"' "$root/manifest.json" \
  | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
dist="$root/dist"
stage="$dist/pkg"
zip_path="$dist/$name-$version.zip"

# Fresh staging dir (dist/pkg).
rm -rf "$stage"
mkdir -p "$stage/icons"

# Allowlist: copy only the runtime files, preserving structure.
cp "$root/manifest.json" "$root/popup.html" "$root/popup.js" "$root/popup.css" "$root/LICENSE" "$stage/"
cp -R "$root/_locales" "$stage/_locales"
cp -R "$root/src" "$stage/src"
for i in 16 32 48 128; do
  cp "$root/icons/icon$i.png" "$stage/icons/"
done

# Zip the staging contents (manifest.json at the archive root).
rm -f "$zip_path"
( cd "$stage" && zip -r -X -q "$zip_path" . )
rm -rf "$stage"

echo "Created $zip_path ($(du -h "$zip_path" | cut -f1))"
