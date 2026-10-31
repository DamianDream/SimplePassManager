# Chrome Web Store Permission Justifications

The following texts are prepared for entry in the Chrome Web Store Developer Dashboard under **Data Usage & Permissions Justification**:

### 1. `storage` & `unlimitedStorage`
> "SimplePass Manager stores the encrypted password vault, user preferences, and profile metadata locally on the user's device using Chrome's sandboxed storage."

### 2. `sidePanel`
> "Provides a dedicated, persistent side panel interface allowing users to view, search, and manage credentials alongside web pages without closing popup windows."

### 3. `activeTab` & `scripting`
> "Enables credential autofill by injecting a lightweight autofill script into the currently active tab strictly when the user clicks the autofill button. No code is executed without explicit user action."

### 4. `clipboardWrite`, `alarms`, and `offscreen`
> "Allows users to copy usernames and passwords to the system clipboard and uses chrome.alarms with an offscreen document to reliably clear the clipboard after a secure timeout."

### 5. `favicon`
> "Retrieves website favicons via Chrome's native favicon service to visually distinguish credentials in the vault without making third-party network requests."

### 6. `idle`
> "Monitors device idle state and OS screen lock to automatically lock the encrypted vault and wipe decryption keys from memory when the user steps away."

### 7. `tabs` (Optional Permission)
> "When enabled by the user, reads the active tab URL to suggest matching passwords for the current website. No browsing history or page content is stored or transmitted."

### 8. `nativeMessaging` (Optional Permission)
> "Enables optional two-way synchronization with the user's local UNIX `pass` password store (~/.password-store) through a locally installed native host."

---

### Single Purpose Declaration
> "SimplePass Manager serves a single purpose: secure local password management and credential autofill with zero-knowledge encryption."
