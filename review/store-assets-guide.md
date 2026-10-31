# Chrome Web Store Assets Specification Guide

To submit SimplePass Manager to the Chrome Web Store, prepare the visual assets according to Google's official requirements:

## 1. Extension Icon
- **Size**: 128×128 pixels (PNG, transparent background).
- **Location**: `src/icons/icon-128.png` (already included in build).

## 2. Store Screenshots (1280×800 or 640×400 px)
Prepare 5 screenshots captured in **English (EN) interface locale**:
1. **Screenshot 1 — Unlock & Zero-Knowledge Screen**:
   - Shows the clean lock screen with AES-256 encryption badge, profile switcher, and recovery option.
2. **Screenshot 2 — Smart Vault & Matching Cards**:
   - Shows the side panel with auto-detected website credentials pinned to the top, clean domain badges, and search bar.
3. **Screenshot 3 — Credential Details & Multi-Tagging**:
   - Shows password view with color-coded category pills, copy shortcuts, and inline security indicators.
4. **Screenshot 4 — Password Generator**:
   - Shows configurable entropy slider, character group toggles, and instant copy/fill.
5. **Screenshot 5 — Settings & Encrypted Backup**:
   - Shows autolock intervals, UNIX pass CLI integration status, and `.spbackup` encrypted export dialog.

## 3. Small Promotional Tile
- **Size**: 440×280 pixels (PNG or JPEG).
- **Content**: SimplePass Manager logo + key tagline: *"Zero-Knowledge Local Password Manager"*.

## 4. Marquee Promotional Banner (Optional)
- **Size**: 1400×560 pixels (PNG or JPEG).
