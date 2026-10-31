# 03. Баги и надёжность (P1)

---

## B1. Гонки при сохранении хранилища

**Где:** `src/sidepanel/index.js:persistVaultChanges` — вызывается из ~20 мест; каждое выполняет асинхронное шифрование (PBKDF2 600k ≈ сотни мс) и затем запись. Два быстрых действия подряд (например, удаление + переключение проекта) могут записать конверты в порядке «новый, затем старый» — потеря изменения.

**Что сделать:** сериализовать записи очередью-промисом:
```js
let persistChain = Promise.resolve();
function persistVaultChanges() {
  persistChain = persistChain.then(() => doPersist()).catch(err => { showToast(t('errors.save_failed')); throw err; });
  return persistChain;
}
```
Где `doPersist()` — текущая логика. Также после C2 шифрование MEK-ом (без PBKDF2) станет быстрым, что сузит окно гонки.

**Критерии приёмки:** серия из 10 быстрых правок записывает конечное состояние целиком (тест на моке storage с искусственной задержкой).

---

## B2. Ошибки записи в chrome.storage не обрабатываются

**Где:** `src/core/storage.js` — все обёртки (`saveStoredVault`, `saveStoredConfig`, `saveFaviconCache`, …) резолвятся безусловно, `chrome.runtime.lastError` не проверяется.

**Риск:** превышение квоты `chrome.storage.local` (10 МБ без `unlimitedStorage`) молча «съедает» сохранение — пользователь теряет данные, думая, что они сохранены.

**Что сделать:** в каждой обёртке проверять `chrome.runtime.lastError` и реджектить промис; в UI на ошибку сохранения показывать блокирующий тост «Не удалось сохранить хранилище: …». Добавить permission `"unlimitedStorage"` в manifest (хранилище + favicon-кэш легко превышают лимит).

---

## B3. Favicon-кэш растёт неограниченно

**Где:** `src/core/storage.js:getFaviconCache/saveFaviconCache` — один объект со всеми data-URL (каждый до десятков КБ), перечитывается/перезаписывается целиком на каждую иконку.

**Что сделать:** (а) ограничить размер записи (пропускать dataUrl > 48 КБ); (б) LRU-лимит 300 доменов: хранить `{ dataUrl, usedAt }`, при превышении удалять самые старые; (в) писать кэш батчем с debounce 2 с, а не на каждый set. После C5 (локальный `_favicon`) кэш понадобится только для локальных/нестандартных хостов.

---

## B4. Хардкод русских строк при 8 поддерживаемых языках

**Где:** ~54 места: `src/sidepanel/index.js` (тосты и ошибки: «Неверный мастер-пароль…», «Пароль удалён», «Форма успешно заполнена!» и др.), `src/core/crypto.js:validateMasterPassword` и ошибки decrypt, `src/core/session.js:LOCK_INTERVALS[*].label`, `src/core/categories.js:validateTagName`, `src/core/state.js` (ошибки deleteProjectCascade, «Новая база»), `src/core/pass-native.js` (все ошибки), `src/core/storage.js` («Основная база», «База N»).

**Что сделать:** перенести все строки в `src/locales/translations.json` и вызывать `t()`. Для core-модулей, где `t()` недоступен без циклического импорта, возвращать коды ошибок (`{ valid:false, errorCode:'master_pwd.too_short' }`) и переводить в UI. `LOCK_INTERVALS` — хранить `labelKey`. Проверка полноты: скрипт `tests/check-i18n.mjs`, который падает, если какой-то ключ отсутствует для любого из `SUPPORTED_LANGUAGES`.

**Критерии приёмки:** при языке `en` в UI нет кириллицы; `grep -n "[А-Яа-я]" src/core/*.js src/background.js src/content/*.js` пуст.

---

## B5. Язык по умолчанию и автоопределение

**Где:** `src/core/i18n.js` — `DEFAULT_LANGUAGE = 'ru'`.

**Что сделать:** при первом запуске определять язык: `const nav = (navigator.language || 'en').slice(0,2)` c маппингом `uk→ua`; если нет в `SUPPORTED_LANGUAGES` — `en`. Сохранённый в конфиге выбор всегда приоритетнее. Для международной публикации дефолтный fallback в `t()` поменять с `ru` на `en` (сейчас `node['en'] || node['ru']` — уже так, ок, но дефолт текущего языка — ru).

---

## B6. Переключение vault-профилей: фоллбек на чужое хранилище

**Где:** `src/core/storage.js:getStoredVault` — если ключ целевого профиля пуст, функция молча возвращает legacy-хранилище `sp_encrypted_vault`. Пользователь, создавший второй профиль, при повреждении его ключа увидит запрос пароля от «не того» хранилища без объяснений.

**Что сделать:** фоллбек оставить только для `vaultId === 'vault_default'`; для остальных возвращать `null` и показывать в UI состояние «Хранилище профиля не найдено» с предложением удалить профиль.

---

## B7. Импорт CSV: навязанный тег «Work» и потеря пустых паролей

**Где:** `src/core/storage.js:csvToItems` — при отсутствии тега принудительно ставится `Work`; валидация тега вырезает пробелы/дефисы (`replace(/[^a-zA-Z0-9Ѐ-ӿ]/g,'')`), т.е. тег «My Bank» превращается в «MyBank», молча.

**Что сделать:** (а) вместо «Work» не задавать тег вовсе (пустой массив — `getItemTags` сейчас тоже возвращает `['Work']` при пустоте — изменить на `[]` и обработать в UI «Без метки»); (б) при нормализации тегов сохранять пробелы (регэксп как в `validateTagName`); (в) после импорта показывать отчёт: сколько строк импортировано/пропущено и какие теги переименованы.

---

## B8. `JSON.parse` без защиты в фоллбек-сторадже

**Где:** `src/core/storage.js:34-57` и `src/core/session.js:getStorage` — `JSON.parse(val)` на сыром localStorage упадёт на повреждённой записи и уронит весь вызов `get`.

**Что сделать:** обернуть каждую распаковку в try/catch, при ошибке — трактовать как отсутствие значения (ключ пропустить). Это не-chrome окружение (тесты/dev), но падать не должно.

---

## B9. Мёртвый popup.html и рассинхрон манифеста

**Где:** `popup.html` + `src/popup/popup.js` — manifest не объявляет `default_popup`, vite не собирает popup; файл ссылается на `/src/popup/popup.js`, что в собранном виде невалидно.

**Что сделать:** удалить `popup.html` и `src/popup/popup.js` (открытие панели уже по клику на иконку через `setPanelBehavior`), либо собрать popup и объявить в manifest — выбрать первое, если нет планов на popup-режим.

---

## B10. Необработанный `chrome.runtime.lastError` в messaging

**Где:** `src/background.js` — callback `chrome.tabs.sendMessage` в `AUTOFILL_LOGIN` не читает `lastError` (на страницах `chrome://`, PDF, Web Store content script отсутствует → «Receiving end does not exist» в консоли сервиса); `src/sidepanel/index.js:232` — аналогично для `GET_ACTIVE_TAB_INFO`.

**Что сделать:** во всех callbacks первым делом читать `chrome.runtime.lastError` и возвращать структурированную ошибку (`{success:false, reason:'no_content_script'}`); в UI для таких вкладок дизейблить кнопку автозаполнения с тултипом «Автозаполнение недоступно на этой странице».

---

## B11. Генератор паролей: нет гарантии классов символов

**Где:** `src/core/generator.js` — при включённых «цифры+символы» может выдать пароль без единой цифры; сайты с жёсткими правилами отвергнут.

**Что сделать:** после генерации проверять присутствие хотя бы одного символа каждого включённого класса; при отсутствии — заменить случайные позиции символами недостающих классов (позиции и символы — через `crypto.getRandomValues`). Использовать rejection sampling вместо `% charset.length` (смещение на Uint32 ничтожно, но исправление тривиально: отбрасывать значения ≥ `Math.floor(2**32/len)*len`).

**Тест:** 1000 генераций с всеми классами — каждый пароль содержит все 4 класса.

---

## B12. Тестовая инфраструктура и CI

**Что сделать:**
1. Перевести `tests/test-core.mjs` на `vitest` (devDependency), разбить по модулям: `crypto.test.mjs`, `storage.test.mjs`, `domain.test.mjs`, `generator.test.mjs`, `session.test.mjs`. Скрипт `npm test`.
2. Добавить тесты на найденные баги (C2-конверт, C3-матчинг, B11-классы).
3. GitHub Actions workflow `.github/workflows/ci.yml`: `npm ci && npm run build && npm test` на push/PR; job со сборкой zip-артефакта.
4. Убрать из git артефакты сборки: `dist/`, `simplepass-chrome.zip` (добавить в `.gitignore`, `git rm -r --cached dist simplepass-chrome.zip`), а также `example/.DS_Store` (и `.DS_Store` в .gitignore).
