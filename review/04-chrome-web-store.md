# 04. Соответствие требованиям Chrome Web Store (P1, блокирует публикацию)

Текущий manifest (`src/manifest.json`) почти гарантированно отправит расширение на углублённую проверку и с высокой вероятностью на отклонение: менеджер паролей с `<all_urls>` host-permissions, постоянным content-script на всех сайтах и permission `tabs` — максимально «красный» профиль. Задачи ниже сводят привилегии к минимуму и готовят листинг.

---

## W1. Минимизация permissions (ключевая задача)

**Текущее:** `storage, sidePanel, tabs, activeTab, scripting, clipboardWrite, nativeMessaging` + `host_permissions: <all_urls>` + `content_scripts: <all_urls>`.

**Целевой manifest:**
```json
"permissions": ["storage", "sidePanel", "activeTab", "scripting", "clipboardWrite", "alarms", "offscreen", "favicon", "unlimitedStorage", "idle"],
"optional_permissions": ["nativeMessaging", "tabs"],
"host_permissions": []
```

**Шаги:**
1. **Удалить статический `content_scripts` блок.** Вместо него инжектить `content.js` по требованию в момент автозаполнения: `chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] })` — работает по `activeTab`-гранту (пользовательский жест на расширении). После инжекта слать `DO_AUTOFILL`. Повторный инжект должен быть идемпотентным (guard `window.__spContentLoaded`).
2. **`tabs`:** для чтения URL активной вкладки держать открытой боковую панель недостаточно `activeTab` (grant появляется только после жеста). Решение без `tabs`: слушать в background `chrome.tabs.onActivated`/`onUpdated` нельзя без `tabs`… поэтому компромисс: оставить `tabs` в **optional_permissions** и запрашивать его при включении функции «Показывать пароли для текущего сайта» (runtime-запрос `chrome.permissions.request({permissions:['tabs']})` с объяснением). Если функция выключена — панель работает без определения домена. В листинге CWS дать justification: «читает URL активной вкладки для показа подходящих записей; содержимое страниц не читается».
3. **`nativeMessaging`** перевести в optional и запрашивать при первом включении интеграции с pass CLI (нишевая функция — не должна пугать всех пользователей варнингом установки).
4. `favicon`, `alarms`, `offscreen`, `unlimitedStorage`, `idle` — добавляются задачами C5/H3/B2/H2.
5. Добавить `"minimum_chrome_version": "116"` (стабильные sidePanel + storage.session setAccessLevel).

**Критерии приёмки:** установка расширения показывает только варнинг «Read your browsing history» при opt-in `tabs` (или вовсе без него до включения опции); автозаполнение работает через activeTab-инжект.

---

## W2. Локализация манифеста и листинга

1. Перейти на стандартную схему `_locales`: создать `src/_locales/en/messages.json`, `ru/…`, (+ остальные 6 языков) с ключами `appName`, `appDesc`; в manifest: `"name": "__MSG_appName__", "description": "__MSG_appDesc__", "default_locale": "en"`.
2. Описание ≤132 символа, без слов «военный уровень» (unverifiable claims — причина reject). Пример EN: "Open-source password manager with AES-256-GCM encrypted local vault, side panel UI, autofill and pass CLI sync."

## W3. Политика приватности и data disclosure (обязательно)

Для категории «обрабатывает аутентификационные данные» CWS требует: (а) URL политики приватности в Developer Dashboard; (б) заполненную форму Data Usage. Написать `PRIVACY.md` (и разместить на сайте из 07-distribution-page.md): какие данные хранятся (только локально, зашифрованно), что покидает устройство (ничего; favicon-запросы к сайтам записей и — при opt-in — к Google/DDG), отсутствие аналитики, контакт. Декларация в дашборде: «Authentication information — stored locally, not transmitted». Ложное «ничего не хранится на диске» из README убрать (связано с C1).

## W4. Single purpose и описание функций

CWS требует единственного назначения. Формулировка: «управление и автозаполнение паролей». Интеграция pass CLI и генератор укладываются; описать их в листинге как подфункции. В Developer Dashboard заполнить justification для каждого permission (подготовить тексты заранее, EN):
- `activeTab/scripting` — "fills credentials into the active page only after an explicit user click";
- `tabs` (optional) — "reads the active tab URL to suggest matching logins";
- `nativeMessaging` (optional) — "optional sync with the local UNIX pass store";
- `clipboardWrite/alarms/offscreen` — "copies a password and clears the clipboard after a timeout".

## W5. Артефакты листинга

Подготовить в `store-assets/`: иконка 128×128 (есть), скриншоты 1280×800 (5 шт.: экран разблокировки, список с совпадениями по сайту, форма записи, генератор, настройки/экспорт), промо-тайл 440×280. Скриншоты снимать в EN-локали.

## W6. Версионирование и упаковка

1. `npm run pack` уже собирает zip из `dist` — убедиться, что в zip не попадают sourcemaps и лишние файлы (`example/`, `native-host/` не попадают — ок).
2. Манифест: синхронизировать `version` с `package.json` автоматически (vite-плагин или скрипт в `pack`).
3. Не коммитить zip в git (см. B12.4).
4. После первой публикации зафиксировать extension ID и прописать его в `native-host/install.sh` как дефолт (см. C4).

## W7. Код-ревью триггеры CWS

Перед сабмитом проверить: нет `eval`/`new Function` (нет), нет удалённого кода (нет), нет обфускации (нет — но включить `minify: false` или оставить esbuild-минификацию: минификация разрешена, обфускация запрещена; оставить как есть), инлайновые обработчики убраны (C7). `tabs.query` в background для `GET_ACTIVE_TAB_INFO` без permission `tabs` вернёт вкладки без `url` — логика должна это переживать (связка с W1.2).

## W8. Firefox/Edge/Opera — отдельные требования (для 07-distribution-page.md)

- **Edge Addons:** принимает тот же MV3-пакет; отдельная регистрация в Partner Center.
- **Firefox (AMO):** требуется `browser_specific_settings.gecko.id`, `sidebar_action` вместо `side_panel`, `background.scripts` (event page) вместо service worker (FF поддерживает SW с 121 частично — надёжнее event page), API `browser.*`. Сделать отдельный build-таргет `npm run build:firefox` с трансформацией манифеста (vite define или скрипт `scripts/make-manifest.mjs` с параметром таргета).
- **Opera:** принимает CWS-пакет через addons.opera.com; Brave/Arc/Vivaldi ставят из CWS напрямую.
