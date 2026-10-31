# 09. План исполнения P1 для агентов (hardening + надёжность + Chrome Web Store)

Дата составления: 2026-10-31. База: коммит `25085e6` — все P0 (C1–C7, V1–V4) закрыты и верифицированы (см. 08-verification-c1-followup.md).

Этот документ — **актуализированное единое ТЗ** на следующий раунд работ. Он заменяет порядок чтения документов 02/03/04: задачи ниже уже сверены с текущим кодом, скорректированы под внедрённую MEK-архитектуру, и из них исключено то, что уже сделано. Детали, не повторённые здесь, брать из указанных исходных пунктов.

## Уже сделано — повторно НЕ выполнять

- H9 (проверка `sender.id` в background/content) — реализовано в коммите `2b146b2`.
- Часть B8 — try/catch вокруг JSON.parse добавлен в `src/core/session.js` (но НЕ в `src/core/storage.js` — см. задачу B8 ниже).
- Из C5: внешние favicon-сервисы уже отключены по умолчанию (`useExternalServices=false` нигде не включается). Тумблер в настройках — опционально, задача E7 ниже.

## Глобальные правила (обязательны)

1. Выполнять задачи **в указанном порядке** — есть зависимости.
2. После каждой задачи: `node tests/test-core.mjs` зелёный, `npm run build` без ошибок. Новые/изменённые модули — покрывать тестами.
3. Один атомарный коммит на задачу: `fix(security): H1 ...`, `fix: B2 ...`, `chore(store): W2 ...`.
4. Формат хранилища (конверт v1/v2) обратно совместим; конфиг пользователей мигрируется, не сбрасывается.
5. Новые строки UI — только через `t()` + ключи во всех 8 языках `src/locales/translations.json`.
6. Не логировать секреты (пароли, MEK, recovery-фразу, расшифрованные данные).

---

# ЭТАП 1 — Security hardening

## E1 (=H1). Удалить строку мастер-пароля из памяти состояния

**Текущее состояние:** `state.masterPassword` присваивается в `src/sidepanel/index.js` строки ~488, 594, 675, 730, 4303; используется только как fallback в `persistVaultChanges()` (строки ~746-749) для unwrap MEK.

**Шаги:**
1. Во всех `updateState({ masterPassword: ... })` передавать `masterPassword: null` и затем удалить поле из `state` (`src/core/state.js`) полностью.
2. Fallback в `persistVaultChanges` удалить: после unlock `state.rawMek`/`state.keySlots` гарантированно заполнены; если их нет — это ошибка сессии: показать тост «Сессия повреждена, войдите заново» (через `t()`) и вызвать `lockVault()`. Молчаливый `return` (теряющий изменения) недопустим.
3. Проверка «введите текущий пароль» при смене мастер-пароля (строки ~4250+): уже должна работать через `unwrapMekWithPassword(envelope, oldPwd)` — убедиться, что сравнение со `state.masterPassword` нигде не осталось.
4. `state.rawMek`: при `lockVault()` выполнять `state.rawMek.fill(0)` перед обнулением ссылки (проверить, делается ли; если нет — добавить).

**Приёмка:** `grep -n "masterPassword" src/` — остаются только локальные переменные в формах ввода; все операции (сохранение, смена пароля, смена интервала, удаление проекта) работают после unlock и после restore-сессии.

## E2 (=H2). Автоблокировка по бездействию

**Текущее состояние:** автолока нет вообще (grep `idle|visibilitychange` по index.js пуст); `sessionExpiresAt` проверяется только при старте панели.

**Шаги:**
1. Новый модуль `src/sidepanel/autolock.js`: `startAutolock({ idleMinutes, onLock })` — сбрасывает таймер по `pointerdown`/`keydown`/`wheel` на `document`; по истечении вызывает `onLock`.
2. Настройка `autolockMinutes` в `DEFAULT_CONFIG` (`src/core/storage.js`): значения 1/5/15/30/0(выкл), по умолчанию 15. UI-селект в настройках рядом с интервалом сессии.
3. В sidepanel `setInterval` раз в 30 с: если `state.sessionExpiresAt > 0 && Date.now() > state.sessionExpiresAt` → `lockVault()`.
4. Permission `"idle"` в manifest; в `background.js`: `chrome.idle.onStateChanged.addListener(s => { if (s === 'locked') chrome.storage.session.remove('sp_active_session'); })` — очистка при блокировке ОС.
5. Запускать/останавливать автолок при unlock/lock.

**Приёмка:** без действий N минут панель блокируется; блокировка экрана ОС убивает session-ключ.

## E3 (=H3). Надёжная автоочистка буфера обмена

**Текущее состояние:** `src/core/state.js:190` — `setTimeout` в документе панели; умирает при её закрытии.

**Шаги:**
1. Permissions `"alarms"` и `"offscreen"` в manifest.
2. `copyToClipboard` после записи шлёт `chrome.runtime.sendMessage({ type: 'SCHEDULE_CLIPBOARD_CLEAR', seconds })`; текущий `setTimeout`-блок с `readText` удалить (чтение буфера убрать совсем).
3. В `background.js`: обработчик ставит `chrome.alarms.create('sp-clear-clipboard', { when: Date.now() + seconds*1000 })`; `onAlarm` создаёт offscreen-документ (`chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['CLIPBOARD'], justification: 'Clear copied password from clipboard' })`), который пишет в буфер пустую строку и закрывается. Добавить `offscreen.html`+`offscreen.js` во входы vite (`vite.config.js`) и копирование в dist.
4. Повторное копирование до срабатывания — пересоздаёт alarm (перезаписывает по имени).
5. `clipboardClearSeconds: 0` = не очищать.

**Приёмка:** скопировать пароль → закрыть панель → через интервал буфер пуст; в коде нет `navigator.clipboard.readText`.

## E4 (=H4). AAD-привязка слотов конверта (версия 3)

По тексту H4 из 02-security-hardening.md, с поправкой на MEK-архитектуру: AAD задаётся в `encryptVaultWithMek` (`'simplepass|v3|payload'`) и `wrapMek` (`'simplepass|v3|mek-pwd'` / `'mek-rec'` — передавать имя слота параметром). Конверты v1/v2 читаются по-старому; при успешной разблокировке пересохранять как v3 (это выполняет `persistVaultChanges` — поднять в нём `version: 3` только когда `state.keySlots` уже v3-формата; при первом открытии v2 перепаковать оба слота: MEK известен, пароль известен в момент unlock — **перепаковку слота recovery выполнять из rawMek напрямую, фраза не нужна**... ВНИМАНИЕ: слот recovery шифруется ключом из фразы, которой при unlock паролем нет → слот recovery при миграции v2→v3 переносить как есть с пометкой `aad: false` в слоте, и перепаковывать с AAD только при следующем вводе фразы или смене recovery-ключа). `decryptVault*`/`unwrapMek*` должны поддерживать оба варианта по флагу слота.

**Тесты:** подмена слотов местами в v3 → ошибка; v2 открывается и мигрирует; recovery работает до и после миграции.

## E5 (=H6+H5). Политика мастер-пароля, индикатор силы, честный recovery

1. `validateMasterPassword` (`src/core/crypto.js`): мин. длина 10; спецсимвол не требуется при длине ≥16; возвращать `errorCode`, а не русский текст (связано с B4).
2. Индикатор силы на экранах создания/смены мастер-пароля (используя `evaluatePasswordStrength`; замена на zxcvbn — отдельно, F7).
3. Recovery: убрать «BIP-39» из комментариев/README; при вводе фразы подсвечивать слова, отсутствующие в `RECOVERY_WORDLIST`, с подсказкой ближайшего (Левенштейн ≤2). Словарь не менять.

## E6 (=H7). Защита экспорта

По тексту H7 из 02: (1) модал-предупреждение перед plaintext CSV/JSON; (2) повторный ввод мастер-пароля, проверка `unwrapMekWithPassword`; (3) формат «Зашифрованный бэкап .spbackup» = конверт `encryptVault(data, exportPassword, null)` + импорт с расшифровкой; сделать его первым пунктом в селекте форматов.

## E7 (=H10 + хвост C5). Секреты в DOM и тумблер внешних иконок

1. `src/sidepanel/index.js` (~строка 1904): пароль не вставлять в `value="..."` шаблона — после рендера выставлять `el.value = item.password` программно; `autocomplete="new-password"`, `spellcheck="false"`.
2. Опциональный тумблер в настройках «Внешние сервисы иконок (Google/DuckDuckGo)» → `config.useExternalIcons` (по умолчанию `false`), пробрасывать в `resolveFavicon(..., { useExternalServices })`.

---

# ЭТАП 2 — Надёжность (из 03-bugs-reliability.md, сверено с кодом)

## B1. Очередь записи хранилища — как в 03/B1 (актуально; после MEK шифрование быстрое, но очередь обязательна).
## B2. Обработка `chrome.runtime.lastError` и квот во всех обёртках `src/core/storage.js`; `"unlimitedStorage"` уже в manifest — проверить и оставить.
## B3. LRU-лимит favicon-кэша — как в 03/B3.
## B4. i18n-зачистка. Актуальный объём: кириллица в `src/core/{categories,crypto,state,pass-native,i18n,storage}.js` и ~97 строк в `src/sidepanel/index.js`. Механика: core-модули возвращают `errorCode`, UI переводит; `LOCK_INTERVALS` уже на `labelKey` — остальное добить. Скрипт `tests/check-i18n.mjs` на полноту ключей по 8 языкам. Приёмка: `grep -n "[А-Яа-я]" src/core/*.js src/background.js src/content/*.js` пуст (кроме translations.json).
## B5. Автоопределение языка при первом запуске (`navigator.language`, маппинг `uk→ua`, fallback `en`) — как в 03/B5.
## B6. Убрать фоллбек на legacy-хранилище для не-default профилей — как в 03/B6.
## B7. Импорт CSV: не навязывать тег «Work», сохранять пробелы в тегах, отчёт об импорте — как в 03/B7 (`getItemTags` → `[]` вместо `['Work']`, обработать «Без метки» в UI).
## B8. Добить try/catch JSON.parse в фоллбек-ветке `src/core/storage.js` (в session.js уже сделано).
## B9. Удалить `popup.html` и `src/popup/popup.js` (подтверждено: мертвы, в manifest не объявлены).
## B10. `lastError` в messaging — в background уже обработан (коммит 2b146b2); осталось: `src/sidepanel/index.js:232` (`GET_ACTIVE_TAB_INFO` callback) и дизейбл кнопки заполнения на страницах без content script.
## B11. Генератор: гарантия классов + rejection sampling — как в 03/B11, с тестом.
## B12. CI: vitest-миграция тестов, `.github/workflows/ci.yml`, убрать из git `dist/`, `simplepass-chrome.zip`, `.DS_Store` (+ .gitignore). ВАЖНО: zip продолжает собираться `npm run pack`, просто не коммитится.

---

# ЭТАП 3 — Chrome Web Store (из 04-chrome-web-store.md, сверено с кодом)

Manifest сейчас НЕ тронут задачами P0: остаются `"tabs"`, `host_permissions: ["<all_urls>"]`, статический `content_scripts` на `<all_urls>` — всё это делается здесь.

## W1. Минимизация permissions — строго по тексту 04/W1, с уточнениями под текущий код:
   - удалить блок `content_scripts` из manifest; `content.js` остаётся во входах vite; инжект в `triggerAutofill`-пути: background при `AUTOFILL_LOGIN` сначала `chrome.scripting.executeScript({ target:{tabId}, files:['content.js'] })` (guard `window.__spContentLoaded` в начале content.js), затем `DO_AUTOFILL`;
   - `host_permissions` → `[]`;
   - `"tabs"` → `optional_permissions`; функция «пароли текущего сайта» при включении вызывает `chrome.permissions.request({permissions:['tabs']})`; `GET_ACTIVE_TAB_INFO` должен корректно работать при отсутствии гранта (вернуть `null`, UI скрывает блок «текущий сайт»);
   - `"nativeMessaging"` → `optional_permissions`, запрос при первом включении pass CLI;
   - добавить `"minimum_chrome_version": "116"`.
   - ВНИМАНИЕ: `GET_PAGE_FAVICON` в content.js после удаления статического инжекта перестаёт работать пассивно — допустимо: основной источник иконок уже `_favicon` (C5).
## W2. `_locales` + `default_locale: "en"` — по 04/W2; текущие name/description из manifest перенести в messages.json (8 языков).
## W3. PRIVACY.md — по 04/W3, с учётом фактов после P0: мастер-пароль не покидает устройство и не пишется на диск; MEK в storage.session (опц. 24ч в storage.local); сетевые запросы — только favicon сайтов записей (+ opt-in Google/DDG, см. E7).
## W4. Тексты justification — по 04/W4 (добавить `idle`, `alarms`, `offscreen`, `favicon`, `unlimitedStorage`).
## W5. Скриншоты/промо — по 04/W5 (делать ПОСЛЕ B4/B5, в EN-локали).
## W6. Синхронизация версии manifest ↔ package.json в `npm run pack` — по 04/W6.
## W7. Финальный pre-submit чек — по 04/W7.

---

# Финальный чек-лист раунда (прогнать перед сдачей)

1. `npm test` (vitest) и `npm run build` зелёные; расширение загружается unpacked и проходит смоук: создание хранилища → добавление записи → lock/unlock → autofill на тестовой странице → экспорт .spbackup → импорт.
2. `grep -rn "[А-Яа-я]" src/ --include=*.js | grep -v locales` — пусто.
3. `grep -n "masterPassword" src/` — только локальные переменные форм.
4. В manifest нет `<all_urls>`, нет статического content_scripts, есть `default_locale`, `minimum_chrome_version`.
5. DevTools → Network панели: ни одного стороннего запроса при дефолтных настройках.
6. Отчёт о выполнении записать в `review/10-p1-report.md` (таблица: задача → коммит → статус → отклонения).

После этого раунда остаются P2: 05-features.md, 06-ui-ux.md (начинать с U1 — рефакторинг монолита), 07-distribution-page.md.
