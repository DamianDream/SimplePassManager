# Privacy Policy for SimplePass Manager

Last updated: October 2026

SimplePass Manager is an open-source, local-first password manager built with a Zero-Knowledge security architecture.

## 1. Information Collection and Storage
- **Local Storage Only**: All user passwords, logins, URLs, tags, notes, and profile configurations are stored strictly locally on your device within Chrome's sandboxed storage (`chrome.storage.local` and ephemeral in-memory `chrome.storage.session`).
- **Master Password Protection**: Your master password is never stored on disk and is never transmitted over any network. It is used solely to derive encryption keys locally using PBKDF2 (SHA-256 with 600,000 iterations). Master Encryption Keys (MEK) are held ephemerally in secure memory and wiped when locking.
- **Zero Telemetry**: SimplePass Manager contains no analytics, tracking pixels, diagnostic reporters, or third-party advertising SDKs.

## 2. Network Activity
- By default, SimplePass makes **no external network requests** other than direct favicon loading for sites already saved in your vault (via the native Chrome Favicon API or direct site origin).
- Optional fallback icon services (Google / DuckDuckGo) are strictly disabled by default and only operate if explicitly enabled by the user in Settings.

## 3. Permissions Justification
- `storage` & `unlimitedStorage`: To store your encrypted password vault locally in the browser.
- `sidePanel`: To provide a seamless, non-intrusive management interface alongside your web browsing.
- `activeTab` & `scripting`: To autofill credentials into form fields only upon your explicit user interaction.
- `clipboardWrite`, `alarms` & `offscreen`: To copy credentials to the clipboard and reliably wipe the clipboard after a secure timeout.
- `idle`: To automatically lock your vault when the device or operating system becomes idle or locked.
- `tabs` (optional): To detect the domain of your active tab for suggesting matching logins. No page content or browsing history is collected or transmitted.
- `nativeMessaging` (optional): To communicate with your local UNIX `pass` store via Native Messaging when enabled.

## 4. Data Sharing and Disclosure
SimplePass Manager does not sell, trade, rent, or transfer any user data to any external parties or cloud servers.

## 5. Contact & Open Source
SimplePass Manager is released under the MIT License. Source code, audits, and security issues can be reported at the official repository.
