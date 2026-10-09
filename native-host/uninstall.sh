#!/bin/bash
HOST_NAME="com.simplepass.pass_host"

echo "=== SimplePass Native Host Uninstaller ==="

TARGET_DIRS=(
  "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
  "$HOME/Library/Application Support/Chromium/NativeMessagingHosts"
  "$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"
  "$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts"
  "$HOME/Library/Application Support/Arc/User Data/NativeMessagingHosts"
  "$HOME/.config/google-chrome/NativeMessagingHosts"
  "$HOME/.config/chromium/NativeMessagingHosts"
  "$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts"
  "$HOME/.config/microsoft-edge/NativeMessagingHosts"
)

for TARGET in "${TARGET_DIRS[@]}"; do
  if [ -f "$TARGET/$HOST_NAME.json" ]; then
    rm -f "$TARGET/$HOST_NAME.json"
    echo "✓ Removed: $TARGET/$HOST_NAME.json"
  fi
done

echo "Uninstallation complete."
