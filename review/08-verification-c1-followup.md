# 08. Результаты верификации фиксов C1–C7 и доработка C1 (P0)

Дата верификации: 2026-10-31, коммит `2b146b2` (fix(security): resolve critical findings C1-C7).

**Статус:** C2, C3, C4, C5, C6, C7 — приняты (проверены по коду, тесты 20/20, сборка проходит). **C1 — НЕ принят**: найдена регрессия, возвращающая исходную уязвимость обходным путём, плюс две связанные недоделки. Задачи ниже обязательны до релиза, выполнять по порядку.

---

## V1 (КРИТИЧНО). Смена интервала блокировки снова пишет мастер-пароль на диск

**Где:**
- `src/sidepanel/index.js:3953-3955` — обработчик выбора интервала блокировки в настройках:
  ```js
  if (state.masterPassword) {
    const session = await createSession(state.masterPassword, val);
  ```
  передаёт **строку мастер-пароля**.
- `src/core/session.js:createSession` — строковая ветка `else if (typeof rawMek === 'string') { tokenStr = btoa(rawMek); }` с `isRawMek: false`.

**Сценарий:** пользователь разблокировал хранилище → в настройках выбрал интервал `1day` (или 15m/1h/8h) → `btoa(мастер-пароль)` записывается в `chrome.storage.local` на срок интервала. Это ровно исходная уязвимость C1.

**Что сделать:**
1. В `src/sidepanel/index.js:3953` заменить на `createSession(state.rawMek, val)`; если `state.rawMek` отсутствует (не должен после unlock) — не пересоздавать сессию, а показать ошибку и предложить перелогин.
2. В `src/core/session.js` **удалить строковую ветку целиком**: `createSession` принимает только `Uint8Array(32)`; при любом другом типе — `throw new TypeError('createSession expects a raw MEK Uint8Array')`. Поле `isRawMek` из sessionData убрать (всегда true), но при чтении в `restoreSession` сохранить проверку для отбраковки старых записей (см. V3).
3. Проверить остальные вызовы: `grep -n "createSession(" src/` — все должны передавать Uint8Array (строки 500, 598, 677, 740, 4308 уже корректны).

**Критерии приёмки:** после смены интервала в `chrome.storage.local` ключ `sp_active_session` не содержит данных, из которых восстанавливается пароль; `grep -n "createSession(state.masterPassword" src/` пуст; unit-тест: `createSession('string')` бросает TypeError.

---

## V2 (СРЕДНЕ). MEK попадает на диск для короткоживущих интервалов

**Где:** `src/core/session.js:createSession` — в `chrome.storage.local` пишутся все интервалы кроме `session`, включая 15m/1h/8h, которым не нужно переживать перезапуск браузера.

**Что сделать:**
1. Интервалы `15m`, `1h`, `8h` хранить в `chrome.storage.session` (как `session`, но с полем `expiresAt > 0` — логика истечения в `restoreSession` уже это обрабатывает).
2. Только `1day` остаётся в `chrome.storage.local`. В настройках у пункта «1 день» добавить предупреждающую подпись (через `t()`): «Ключ хранилища будет сохранён на устройстве до истечения интервала».

**Критерии приёмки:** при интервалах 15m/1h/8h ключ `sp_active_session` отсутствует в `storage.local` и присутствует в `storage.session`; истечение по таймеру работает для обоих стораджей.

---

## V3 (СРЕДНЕ). Миграция: уничтожать легаси-сессии со старым форматом токена

**Где:** `src/core/session.js:restoreSession` — ветка `masterPassword = atob(data.token)` для записей с `isRawMek !== true`.

**Проблема:** у пользователей предыдущей версии в `storage.local` уже лежит `sp_active_session` с `btoa(encodeURIComponent(пароль))` сроком до 30 дней. Новый код не удаляет его, а декодирует `atob()` (без `decodeURIComponent` — для не-ASCII паролей даёт мусор) и продолжает использовать и хранить на диске.

**Что сделать:** в `restoreSession` при `data.isRawMek !== true` — немедленно `await destroySession()` и вернуть `null` (пользователь вводит пароль заново один раз). Убрать из `restoreSession` и вызывающего кода (`src/sidepanel/index.js:349-390`) все ветки работы с `session.masterPassword` — после V1/V3 сессия содержит только MEK. Ветку расшифровки v1-хранилища паролем при restore удалить (v1 разблокируется только ручным вводом пароля через `handleUnlock`, где уже есть миграция в v2).

**Критерии приёмки:** подложить в storage запись старого формата → при старте она удалена, показан экран ввода пароля; `grep -n "session.masterPassword" src/` пуст.

---

## V4 (НИЗКО). Мелкие остатки

1. `src/sidepanel/index.js:1302` — при переключении профиля хранилища остался `chrome.storage.local.set({ sp_failed_attempts: 0 })` — удалить (счётчик теперь в `storage.session`; сбрасывать `failedAttempts`/`lockoutUntil` и там).
2. `src/core/storage.js:17` — `DEFAULT_CONFIG.lockInterval: '3days'` → заменить на `'session'` (нормализация при чтении работает, но дефолт должен быть валидным значением).
3. `README.md` — обновить раздел безопасности (пункт C1.5 исходного ТЗ): мастер-пароль не сохраняется на диск никогда; MEK хранится в памяти браузера (storage.session), а при явно выбранном интервале «1 день» — на устройстве до истечения интервала; описать 12-словный ключ восстановления и dual-key конверт.

---

## Проверено и принято при верификации (для справки, повторно не делать)

- C2: MEK-архитектура (`encryptVaultWithMek`, слоты сохраняются при каждом сохранении, смена пароля перепаковывает только `keyByPassword`), тест №20.
- C3: eTLD+1 через tldts (`src/core/psl.js`), проверка домена вкладки в `background.js` при `AUTOFILL_LOGIN`, `forceFill`-подтверждение, guard'ы в content.js, анти-фишинг тесты.
- C4: шаблон манифеста с `__EXTENSION_ID__`, install.sh с обязательным ID, `sanitize_entry_path`, таймауты 15 с.
- C5: локальный `_favicon` API первым, permission `favicon`, внешние сервисы отключены по умолчанию.
- C6: экспоненциальный backoff в `storage.session`, очистка легаси-ключа.
- C7: инлайновый `onerror` удалён.
- Бонус: проверки `sender.id` в background/content (покрывает H9 из 02-security-hardening.md).

После выполнения V1–V4: прогнать `node tests/test-core.mjs` и `npm run build`, добавить тесты на V1 (TypeError) и V3 (отбраковка легаси-сессии), один атомарный коммит `fix(security): close C1 regression paths (V1-V4)`.
