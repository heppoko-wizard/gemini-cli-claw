#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ADAPTER_DIR="$SCRIPT_DIR"
ADAPTER_NAME="openclaw-gemini-cli-adapter"

echo "================================================="
echo " Packaging OpenClaw Gemini CLI Adapter Release"
echo "================================================="

# Get version from package.json
VERSION=$(node -p "require('$ADAPTER_DIR/package.json').version")
OUTPUT_DIR="/home/heppo/ドキュメント/tmp"
mkdir -p "$OUTPUT_DIR"
OUTPUT_ZIP="$OUTPUT_DIR/${ADAPTER_NAME}-v${VERSION}.zip"

echo "Creating release archive: $OUTPUT_ZIP"

# Create a temp staging directory
TMPDIR="$(mktemp -d)"
STAGE_ROOT="$TMPDIR/openclaw"
STAGE_ADAPTER="$STAGE_ROOT/$ADAPTER_NAME"

mkdir -p "$STAGE_ADAPTER"

# --- 1. Root level files (OpenClaw root) ---
echo "Copying root level scripts and READMEs..."
cp "$ADAPTER_DIR/setup.js" "$STAGE_ROOT/setup.js"
cp "$ADAPTER_DIR/install-adapter.sh" "$STAGE_ROOT/install-adapter.sh"
cp "$ADAPTER_DIR/install-adapter.bat" "$STAGE_ROOT/install-adapter.bat"
cp "$ADAPTER_DIR"/README*.md "$STAGE_ROOT/" 2>/dev/null || true

# --- 2. Adapter internal files (plugin folder) ---
echo "Copying adapter internal files..."
mkdir -p "$STAGE_ADAPTER/src"
# Copy src content but exclude any existing personal .gemini data
cp -r "$ADAPTER_DIR/src/"* "$STAGE_ADAPTER/src/"

mkdir -p "$STAGE_ADAPTER/gemini-home/.gemini"
cat <<EOF > "$STAGE_ADAPTER/gemini-home/.gemini/settings.json"
{
  "safetySettings": {
    "hate": "blockNone",
    "harassment": "blockNone",
    "sexuallyExplicit": "blockNone",
    "dangerousContent": "blockNone"
  }
}
EOF

# Scripts (needed by start.sh)
mkdir -p "$STAGE_ADAPTER/scripts"
cp -r "$ADAPTER_DIR/scripts/"* "$STAGE_ADAPTER/scripts/"

# Support files
cp "$ADAPTER_DIR/mcp-server.mjs" "$STAGE_ADAPTER/"
cp "$ADAPTER_DIR/package.json" "$STAGE_ADAPTER/"
cp "$ADAPTER_DIR/start.sh" "$STAGE_ADAPTER/"
cp "$ADAPTER_DIR/installer-gui.js" "$STAGE_ADAPTER/"
cp "$ADAPTER_DIR/relogin.js" "$STAGE_ADAPTER/"
cp "$ADAPTER_DIR/relogin.sh" "$STAGE_ADAPTER/"
cp "$ADAPTER_DIR/relogin.bat" "$STAGE_ADAPTER/"
cp "$ADAPTER_DIR/uninstall.sh" "$STAGE_ADAPTER/"
cp "$ADAPTER_DIR/uninstall.bat" "$STAGE_ADAPTER/"
cp "$ADAPTER_DIR/launch.sh" "$STAGE_ADAPTER/"
cp "$ADAPTER_DIR/launch.bat" "$STAGE_ADAPTER/"
cp -r "$ADAPTER_DIR/public" "$STAGE_ADAPTER/"

# --- 3. sensitive data double-check ---
echo "Cleaning up any potential sensitive data..."
find "$STAGE_ADAPTER" -name "oauth_creds.json" -delete 2>/dev/null || true
find "$STAGE_ADAPTER" -name "google_accounts.json" -delete 2>/dev/null || true
find "$STAGE_ADAPTER" -name "installation_id" -delete 2>/dev/null || true

# --- 4. Finalizing ---
echo "Creating release folder: $OUTPUT_DIR/openclaw"
# Ensure we can delete the previous folder
chmod -R u+w "$OUTPUT_DIR/openclaw" 2>/dev/null || true
rm -rf "$OUTPUT_DIR/openclaw"
cp -r "$STAGE_ROOT" "$OUTPUT_DIR/openclaw"

echo "Compressing into ZIP..."
cd "$TMPDIR"
zip -qr "$OUTPUT_ZIP" openclaw/

# Clean up staging
rm -rf "$TMPDIR"

echo "-------------------------------------------------"
echo "✓ Release package created successfully!"
ls -lh "$OUTPUT_ZIP"
echo "================================================="
