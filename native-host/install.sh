#!/bin/bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
HOST_NAME="com.simplepass.pass_host"
SCRIPT_PATH="$DIR/simplepass_host.py"
MANIFEST_TEMPLATE="$DIR/com.simplepass.pass_host.json"

chmod +x "$SCRIPT_PATH"

echo "=== SimplePass Manager Native Host Installer ==="
echo "Script path: $SCRIPT_PATH"

EXTENSION_ID="$1"
if [ -z "$EXTENSION_ID" ]; then
  echo "Notice: Chrome requires the explicit Extension ID for allowed_origins."
  echo "You can find your ID at chrome://extensions with Developer mode enabled."
  read -p "Enter Chrome Extension ID: " EXTENSION_ID
fi

if [ -z "$EXTENSION_ID" ]; then
  echo "Error: Extension ID is required. Example: ./install.sh <EXTENSION_ID>"
  exit 1
fi

echo "Registering host for extension ID: $EXTENSION_ID"

# Prepare JSON manifest with absolute script path and scoped extension origin
MANIFEST_CONTENT=$(cat <<EOF
{
  "name": "$HOST_NAME",
  "description": "SimplePass Manager Native Messaging Host for UNIX pass CLI",
  "path": "$SCRIPT_PATH",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXTENSION_ID/"
  ]
}
EOF
)

# Detect OS and target directories
TARGET_DIRS=()

if [[ "$OSTYPE" == "darwin"* ]]; then
  echo "Detected macOS"
  TARGET_DIRS+=(
    "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
    "$HOME/Library/Application Support/Chromium/NativeMessagingHosts"
    "$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"
    "$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts"
    "$HOME/Library/Application Support/Arc/User Data/NativeMessagingHosts"
  )
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
  echo "Detected Linux"
  TARGET_DIRS+=(
    "$HOME/.config/google-chrome/NativeMessagingHosts"
    "$HOME/.config/chromium/NativeMessagingHosts"
    "$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts"
    "$HOME/.config/microsoft-edge/NativeMessagingHosts"
  )
fi

INSTALLED_COUNT=0

for TARGET in "${TARGET_DIRS[@]}"; do
  PARENT_DIR=$(dirname "$TARGET")
  # Only install if browser parent folder exists or can be created
  if [ -d "$PARENT_DIR" ] || [ -d "$TARGET" ]; then
    mkdir -p "$TARGET"
    echo "$MANIFEST_CONTENT" > "$TARGET/$HOST_NAME.json"
    echo "✓ Installed manifest in: $TARGET/$HOST_NAME.json"
    INSTALLED_COUNT=$((INSTALLED_COUNT+1))
  fi
done

# Also ensure default Chrome location is created even if directory didn't exist yet
if [ $INSTALLED_COUNT -eq 0 ]; then
  DEFAULT_DIR="${TARGET_DIRS[0]}"
  mkdir -p "$DEFAULT_DIR"
  echo "$MANIFEST_CONTENT" > "$DEFAULT_DIR/$HOST_NAME.json"
  echo "✓ Created default directory and installed manifest: $DEFAULT_DIR/$HOST_NAME.json"
fi

echo ""
echo "=== Environment Check ==="
if command -v pass >/dev/null 2>&1; then
  echo "✓ pass CLI found: $(which pass)"
else
  echo "⚠ pass CLI not found in PATH. You can install it via 'brew install pass' (macOS) or 'apt install pass' (Linux)."
fi

if command -v gpg >/dev/null 2>&1; then
  echo "✓ gpg found: $(which gpg)"
else
  echo "⚠ gpg not found in PATH. You can install it via 'brew install gnupg'."
fi

STORE_DIR="${PASSWORD_STORE_DIR:-$HOME/.password-store}"
if [ -d "$STORE_DIR" ]; then
  echo "✓ Password store found: $STORE_DIR"
else
  echo "ℹ Password store not yet created at $STORE_DIR (will be initialized with 'pass init <gpg-id>')"
fi

echo ""
echo "=== Installation Completed Successfully! ==="
echo "Restart your browser or reload SimplePass extension to activate the connection."
