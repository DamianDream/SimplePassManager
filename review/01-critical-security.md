# 01. Критические уязвимости безопасности (P0)

Все задачи этого файла блокируют публикацию в Chrome Web Store. Выполнять по порядку: C2 → C1 → C3 → C4 → C5 → C6 (C2 меняет формат работы с ключами, от него зависит реализация C1).

---

## C2. Сохранение записи уничтожает ключ восстановления (деградация конверта v2 → v1)

**Серьёзность:** Critical (потеря доступа к данным).

**Где:**
- `src/sidepanel/index.js:649-666` — `persistVaultChanges()` вызывает `encryptVault(vaultData, state.masterPassword)` **без** recovery-фразы.
- `src/core/crypto.js` — `encryptVault(data, masterPassword, recoveryPhrase = null)`: без третьего аргумента возвращает конверт `version: 1` без `keyByPassword`/`keyByRecovery`.

**Сценарий отказа:** пользователь создаёт хранилище, записывает 12 слов → добавляет/редактирует любую запись → `persistVaultChanges()` перезаписывает конверт как v1 → при утере мастер-пароля `decryptVaultWithRecovery()` бросает «Восстановление по 12 словам не поддерживается…». Ключ восстановления, который пользователь сохранил на бумаге, безвозвратно бесполезен.

**Что сделать (архитектурное исправление):**
1. В `src/core/crypto.js` добавить функции, работающие с MEK напрямую:
   - `generateMek(): Uint8Array(32)` — обёртка над `crypto.getRandomValues`.
   - `encryptVaultWithMek(data, rawMek, existingKeySlots)` — шифрует payload новым случайным IV ключом MEK и возвращает конверт v2, **копируя без изменений** `keyByPassword` и `keyByRecovery` из `existingKeySlots`.
   - `unwrapMekWithPassword(envelope, masterPassword): Uint8Array` — выделить из текущего `decryptVault` шаг расшифровки MEK (вернуть rawMek, не только payload).
   - `wrapMek(rawMek, secret): {salt, iv, data}` — единая функция для создания слота ключа (используется и для пароля, и для recovery-фразы).
2. В состоянии приложения (`src/core/state.js` / `src/sidepanel/index.js`) после разблокировки хранить `state.rawMek` (Uint8Array) и `state.keySlots = { keyByPassword, keyByRecovery }` из конверта. (После выполнения C1 вместо rawMek хранить non-extractable `CryptoKey` — импортировать rawMek через `crypto.subtle.importKey('raw', ..., extractable: false)` и сразу обнулять массив.)
3. `persistVaultChanges()` переписать: `encryptVaultWithMek(vaultData, state.mekKey, state.keySlots)` — слоты ключей не трогаются, recovery продолжает работать.
4. Разблокировка хранилища v1 (legacy): при успешном `decryptVault` v1-конверта немедленно мигрировать — сгенерировать MEK, предложить пользователю создать recovery-фразу, сохранить конверт v2.
5. Смена мастер-пароля (`src/sidepanel/index.js:4100-4160`): перезаписывать **только** слот `keyByPassword` (`wrapMek(rawMek, newPassword)`), payload и `keyByRecovery` не трогать. Текущая реализация с `persistVaultChanges()` после подмены `state.masterPassword` также деградировала конверт.
6. Поток «восстановление по 12 словам» (`decryptVaultWithRecovery` уже возвращает `rawMek`) — после задания нового мастер-пароля перезаписывать только слот `keyByPassword`.

**Тесты (обязательно, в `tests/test-core.mjs` или новый `tests/test-envelope.mjs`):**
- создать v2-конверт → `encryptVaultWithMek` с изменёнными данными → `decryptVaultWithRecovery` исходной фразой успешно расшифровывает новые данные;
- смена пароля → старый пароль не подходит, новый подходит, recovery-фраза подходит;
- v1-конверт расшифровывается и мигрирует в v2.

**Критерии приёмки:** ни один путь сохранения (`saveItem`, удаление, импорт CSV/Bitwarden/pass-sync, смена пароля, переименование проекта) не теряет `keyByRecovery`. Grep по коду: `encryptVault(` без MEK должен остаться только в местах первичного создания хранилища.

---

## C1. Мастер-пароль хранится на диске в base64 до 30 дней

**Серьёзность:** Critical.

**Где:**
- `src/core/session.js:44-52` — `simpleScramble(str) { return btoa(encodeURIComponent(str)); }` — это кодирование, не шифрование.
- `src/core/session.js:60-90` — `createSession()` кладёт `token: simpleScramble(masterPassword)` в `chrome.storage.local` при любом интервале кроме `session` (по умолчанию `3days`, доступно до `1month`).
- `README.md` при этом утверждает: «Мастер-пароль … никогда не сохраняется на диск» — ложное заявление, недопустимое для листинга в CWS.

**Риск:** любой процесс/пользователь с доступом к профилю браузера (malware, бэкап, другой пользователь ПК, синхронизация папки профиля) читает файл LevelDB `chrome.storage.local` и получает мастер-пароль одной командой `atob()`. Это обнуляет PBKDF2/AES полностью.

**Что сделать:**
1. **Запретить запись мастер-пароля (и rawMek) в `chrome.storage.local` в любом виде.** Удалить `simpleScramble`/`simpleUnscramble`.
2. Персистентная сессия реализуется только через **MEK, а не мастер-пароль** (зависит от C2):
   - Интервал `session` (сделать его значением по умолчанию вместо `3days`): хранить `rawMek` в `chrome.storage.session` (очищается при выходе из браузера, недоступно content-скриптам; вызвать `chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })` в background).
   - Таймерные интервалы: сократить набор до `15m / 1h / 8h / session / 1day`. Интервалы `3days/1week/1month` удалить из `LOCK_INTERVALS` c миграцией существующего конфига на `1day`. Для интервалов, переживающих перезапуск браузера (`1day`), допускается хранение **rawMek** (не пароля) в `chrome.storage.local` с явным предупреждением в UI («ключ хранилища хранится на устройстве в открытом виде до истечения интервала»); по умолчанию выключено.
3. `restoreSession()` возвращает MEK, а не пароль. Все места, которым нужен пароль (`state.masterPassword`), перевести на MEK: проверка старого пароля при смене — через `unwrapMekWithPassword` на актуальном конверте; `verifyMasterPassword` в `storage.js` уже делает полную расшифровку — оставить.
4. `destroySession()` — удалять ключ из обоих стораджей и обнулять `Uint8Array` (fill(0)) перед потерей ссылки.
5. Обновить README и будущий privacy-текст: честно описать, что и где хранится.

**Критерии приёмки:** в `chrome.storage.local` ни при каком интервале не появляется строка, из которой восстанавливается мастер-пароль; `grep -rn "simpleScramble\|btoa(encodeURIComponent" src/` пуст; разблокировка по сессии и по интервалу работает; после "Lock" повторная разблокировка требует пароль.

---

## C3. Автозаполнение без проверки домена + фишинго-уязвимый матчинг доменов

**Серьёзность:** Critical (целевой фишинг).

**Где:**
- `src/sidepanel/index.js:766-787` — `triggerAutofill(item)` отправляет логин/пароль в активную вкладку без какой-либо сверки `item.url` с URL вкладки.
- `src/background.js:55-64` — `AUTOFILL_LOGIN` пересылает креды в `tabId` из сообщения, не проверяя URL вкладки в момент заполнения.
- `src/core/domain.js:96-140` — `isItemMatchingDomain()`: (а) подстрочный матч `item.url.toLowerCase().includes(targetHost)`; (б) матч по title: `titleLower.includes(targetHost)` и `titleLower.startsWith(targetBase)`, где `targetBase` — первый сегмент hostname. Пример атаки: страница `https://github.phish-login.io/` → `targetBase = "github"` → запись с title «GitHub» помечается как совпадение и показывается в блоке «текущий сайт» с кнопкой заполнения в 1 клик.
- `src/content/content.js` — заполняет первое видимое поле пароля на странице без ограничений.

**Что сделать:**
1. **Строгий матчинг по eTLD+1.** Добавить `src/core/psl.js` с компактным Public Suffix List (использовать пакет `tldts` — он работает офлайн и собирается vite, ~30КБ gzip; добавить в `devDependencies`/bundle). Новая функция `getRegistrableDomain(host)`. `isItemMatchingDomain` переписать: совпадение ⇔ `getRegistrableDomain(itemHost) === getRegistrableDomain(targetHost)` (для IP/localhost — точное сравнение host). Удалить матчи по подстроке URL и по title. Матч по title допустим только для **сортировки поиска**, никогда — для блока «текущий сайт» и автозаполнения.
2. **Проверка в момент заполнения.** В `background.js` обработчик `AUTOFILL_LOGIN`: получить `chrome.tabs.get(tabId)`, вычислить registrable domain URL вкладки и сравнить с доменом записи (`message.itemUrl` передавать вместо «слепых» кредов); при несовпадении — не заполнять, вернуть `{ success:false, reason:'domain_mismatch' }`.
3. **Подтверждение при несовпадении.** В sidepanel: если пользователь нажал «заполнить» на записи, чей домен не совпадает с активной вкладкой, показать модальное предупреждение с обоими доменами («Запись для github.com, а вкладка — evil.io. Заполнить всё равно?»). По умолчанию — отмена.
4. **HTTP-страницы:** если вкладка `http:` (и не локальная сеть по `isLocalOrPrivateHost`), показывать предупреждение перед заполнением.
5. В `content.js`: не заполнять поля в документах с `document.visibilityState !== 'visible'`; игнорировать поля с `autocomplete="one-time-code"`.

**Тесты:** unit для `isItemMatchingDomain` (gist.github.com↔github.com = match; github.phish.io vs запись github.com = no match; title «GitHub» vs github.phish.io = no match; 192.168.0.104:4321 точное совпадение).

**Критерии приёмки:** сценарий «запись GitHub + вкладка github.<anything>.io» не показывает запись как совпадение и не заполняет без явного предупреждения.

---

## C4. Native Messaging Host: wildcard origin и path traversal

**Серьёзность:** High/Critical (локальная поверхность атаки).

**Где:**
- `native-host/com.simplepass.pass_host.json` и `native-host/install.sh` — `"allowed_origins": ["chrome-extension://*"]`. Chrome не поддерживает wildcard — хост просто не подключится; а если бы поддерживал, любой вредоносный extension получил бы полный доступ к `~/.password-store` (чтение/запись/удаление всех паролей GPG).
- `native-host/simplepass_host.py:96-118` — `handle_get`: fallback `os.path.join(PASSWORD_STORE_DIR, f"{entry_path}.gpg")` — `entry_path="../../Users/x/secret"` выходит за пределы стора; `handle_insert`/`handle_delete` передают произвольный путь в `pass`.

**Что сделать:**
1. В `install.sh` принимать ID расширения параметром (`./install.sh <EXTENSION_ID>`; если не передан — интерактивный запрос с подсказкой, где его взять: chrome://extensions). Генерировать `"allowed_origins": ["chrome-extension://<ID>/"]`. Из шаблонного json в репозитории wildcard убрать, оставить плейсхолдер `chrome-extension://__EXTENSION_ID__/` и пометить, что файл — шаблон.
2. В `simplepass_host.py` добавить валидацию путей для всех действий:
   ```python
   def sanitize_entry_path(entry_path: str) -> str | None:
       if not entry_path or entry_path.startswith(('/', '~')) or '\\' in entry_path:
           return None
       p = (Path(PASSWORD_STORE_DIR) / entry_path).resolve()
       store = Path(PASSWORD_STORE_DIR).resolve()
       if store not in p.parents and p != store:
           return None
       return entry_path
   ```
   Применить в `handle_get`, `handle_insert`, `handle_delete`, при невалидном пути возвращать `{'ok': False, 'error': 'Invalid entry path'}`.
3. Добавить таймаут subprocess-вызовов (`timeout=15`) и обработку `subprocess.TimeoutExpired` (gpg-pinentry может зависнуть) — иначе хост виснет навечно при залоченном GPG-агенте.
4. `sync_all` расшифровывает весь стор одним запросом — оставить, но задокументировать в UI, что операция требует разблокированного GPG-ключа и читает все записи.
5. Убрать из `com.simplepass.pass_host.json` абсолютный путь `/Users/dima/...` (личные данные в публичном репозитории).

**Критерии приёмки:** `handle_get('../../../etc/passwd')` возвращает ошибку; установленный манифест содержит конкретный extension ID; subprocess не зависает дольше 15 с.

---

## C5. Утечка доменов хранилища третьим сторонам через favicon-сервисы

**Серьёзность:** High (приватность; также вопрос для CWS privacy disclosure).

**Где:** `src/core/favicon.js:238-247` — для каждого публичного домена записи выполняются запросы к `https://www.google.com/s2/favicons?...` и `https://icons.duckduckgo.com/ip3/...`. Так Google/DDG узнают полный список сайтов, на которых у пользователя есть аккаунты, с привязкой к IP.

**Что сделать:**
1. Основным источником сделать **локальный** favicon-API Chrome: добавить в manifest permission `"favicon"`, получать иконку как `chrome.runtime.getURL('/_favicon/?pageUrl=' + encodeURIComponent(url) + '&size=32')` — без сетевых запросов, работает для всех посещённых сайтов.
2. Запросы к сайту записи напрямую (`origin/favicon.ico` и т.д.) — допустимы, оставить вторым уровнем.
3. Запросы к Google/DuckDuckGo вынести за отдельный opt-in тумблер в настройках «Использовать внешние сервисы иконок (Google/DuckDuckGo)» = **выключен по умолчанию**. Существующий тумблер `showFavicons` оставить как общий выключатель.
4. Ограничить размер favicon-кэша (см. B7).

**Критерии приёмки:** при дефолтных настройках в DevTools Network панели sidepanel нет ни одного запроса к `google.com` / `duckduckgo.com`.

---

## C6. Блокировка после 3 попыток: обходится и наказывает владельца

**Серьёзность:** Medium (ложная защита + отказ в обслуживании владельцу).

**Где:** `src/sidepanel/index.js:302, 390-443` — `failedAttempts` хранится в `chrome.storage.local` (`sp_failed_attempts`) открытым числом; после 3 ошибок ввод пароля блокируется **навсегда** (до восстановления по 12 словам).

**Проблемы:** (а) атакующий с доступом к storage просто обнуляет счётчик (а после C1 брутфорс оффлайн вообще не требует UI); (б) легитимный пользователь с опечатками намертво теряет вход, а при сломанном recovery (C2) — и данные.

**Что сделать:** заменить жёсткую блокировку на экспоненциальную задержку: после 3 неудач — пауза 30 с, далее ×2 до максимума 10 мин (таймер и счётчик держать в памяти + `chrome.storage.session`); показывать обратный отсчёт; ссылку «забыл пароль → восстановление по 12 словам» показывать всегда. Удалить постоянный ключ `sp_failed_attempts` из `storage.local` (и вычистить при миграции).

**Критерии приёмки:** после 10 неверных попыток ввод остаётся возможным после задержки; перезапуск браузера сбрасывает только задержку, данные не блокируются навсегда.

---

## C7. Инлайновый `onerror` в шаблоне (мертвый код из-за CSP + анти-паттерн)

**Серьёзность:** Low-Medium (сейчас это баг отображения; станет XSS-поверхностью при ослаблении CSP).

**Где:** `src/sidepanel/index.js:1381` — `<img ... onerror="this.style.display='none'; ...">` вставляется через `innerHTML`. MV3 CSP (`script-src 'self'`) блокирует инлайновые обработчики — фоллбек-буква при битой иконке никогда не срабатывает.

**Что сделать:** убрать атрибут `onerror`; после рендера списка навешивать обработчик делегированием: `rootEl.addEventListener('error', e => { if (e.target.matches('.sp-card-favicon')) {...} }, true)`. Проверить аналогичные инлайновые обработчики по всему файлу (`grep -n 'on[a-z]*="' src/sidepanel/index.js`).

**Критерии приёмки:** при недоступном favicon показывается буква-заглушка; в консоли sidepanel нет CSP-ошибок.
