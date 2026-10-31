# 11. Верификация раунда P1: приняты E1–E7, B1–B12, W2–W7; две доработки по W1/W2 (P1, блокируют публикацию)

Дата: 2026-10-31, база: коммит `660ebd3`. Проверено: тесты 37/37 ✅, i18n 309/309 ✅, `npm run build` ✅, git-гигиена (dist/zip удалены из индекса, .gitignore, CI) ✅, манифест минимизирован ✅, E1 (нет `state.masterPassword`) ✅, B1 (persistChain) ✅, E2 (autolock.js + idle) ✅, E3 (alarms+offscreen) ✅, E4 (AAD v3 со слотовыми флагами) ✅, E6 (.spbackup) ✅, B10 (executeScript с guard) ✅. Эмпирически проверена загрузка собранного dist в Chrome (headless, CDP) — расширение загружается, sidepanel.html открывается.

**Обновление (повторная верификация, коммит `1523e14`): P1-A и P1-B выполнены и ПРИНЯТЫ.** Раунд P1 закрыт полностью (тесты 38/38, i18n 316/316, сборка и zip чистые, `_locales` = en/hi/ja/ru/uk/zh_CN). Следующий этап — P2: 05-features.md, 06-ui-ux.md (начиная с U1), 07-distribution-page.md.

Исходный текст доработок сохранён ниже для истории.

---

## P1-A (блокер функциональности). Optional permissions объявлены, но никогда не запрашиваются

**Факт:** `tabs` и `nativeMessaging` перенесены в `optional_permissions`, однако `grep -rn "chrome.permissions" src/` — 0 совпадений. Ни одна строка кода не вызывает `chrome.permissions.request()` / `contains()`.

**Последствия в текущем виде:**
1. `GET_ACTIVE_TAB_INFO` → `chrome.tabs.query` без гранта `tabs` возвращает вкладки с `url: undefined` (кроме короткого activeTab-гранта сразу после клика по иконке). Блок «пароли текущего сайта», доменная сортировка и favicon активной вкладки не работают после первого же переключения вкладки — и у пользователя НЕТ способа это включить.
2. `chrome.scripting.executeScript` требует host-доступ: он есть только через activeTab (жест на расширении, действует на одну вкладку до навигации). Автозаполнение будет падать с `cannot access contents of the page` в большинстве сценариев (панель открыта, пользователь переключил вкладку). Анти-фишинг проверка при `tab.url === undefined` пропускается, но инжект тоже падает — fail-safe, однако функция мертва.
3. `chrome.runtime.sendNativeMessage` без гранта `nativeMessaging` недоступен → интеграция pass CLI отключена навсегда, UI не предлагает её включить.

**Что сделать:**
1. Новый модуль `src/core/permissions.js`:
   - `hasPermission(perm): Promise<boolean>` — обёртка `chrome.permissions.contains({ permissions: [perm] })`;
   - `requestPermission(perm): Promise<boolean>` — `chrome.permissions.request(...)`; вызывать ТОЛЬКО из обработчика пользовательского жеста (клик), иначе Chrome отклонит.
2. **tabs.** В настройках тумблер «Показывать пароли для текущего сайта» (`config.currentSiteEnabled`, по умолчанию `true` в конфиге, но активен только при наличии гранта):
   - при включении тумблера → `requestPermission('tabs')`; отказ → тумблер остаётся выключенным с пояснением;
   - при старте панели: `hasPermission('tabs')` → если нет, скрыть блок «текущий сайт» и показать в нём компактный CTA «Включить определение сайта» (кнопка = жест = можно вызывать request прямо из неё);
   - onboarding: после создания/разблокировки хранилища при первом открытии, если гранта нет — одноразовый баннер с кнопкой включения.
3. **Автозаполнение.** Кнопка «заполнить» на карточке — это жест, но он происходит в side panel, а activeTab-грант от него НЕ распространяется на вкладку. Решение: при `permissions.request({ permissions: ['tabs'], origins: [] })` URL вкладки станет доступен, но host-доступ для executeScript это не даёт. Поэтому дополнительно:
   - в `optional_host_permissions` манифеста добавить `"<all_urls>"`;
   - при первом использовании автозаполнения запрашивать `chrome.permissions.request({ origins: ['<all_urls>'] })` с поясняющим модалом ДО запроса («разрешение нужно, чтобы вставить пароль в форму на сайте; страницы не читаются»); отказ → fallback на копирование в буфер (текущее поведение);
   - альтернатива с меньшим скоупом — запрашивать origin конкретного сайта записи (`origins: [ 'https://' + registrableDomain + '/*', 'https://*.' + registrableDomain + '/*' ]`) — предпочтительно; реализовать именно её, `<all_urls>` не использовать.
   - в `AUTOFILL_LOGIN` (background): если `tab.url` недоступен (нет гранта) — НЕ пропускать анти-фишинг проверку молча, а возвращать `{ success:false, reason:'no_tab_access' }`; sidepanel в ответ показывает модал запроса разрешения.
4. **nativeMessaging.** В секции pass CLI настроек: кнопка «Подключить pass CLI» → `requestPermission('nativeMessaging')` → затем `checkPassHostStatus()`. Все вызовы `sendNativeRequest` предварять `hasPermission('nativeMessaging')` с кодом ошибки `permission_required` для UI.
5. Тесты: unit для обёрток (мок chrome.permissions); ручной смоук по чек-листу ниже.

**Приёмка:** свежеустановленное расширение: блок «текущий сайт» предлагает включение и работает после согласия; автозаполнение запрашивает доступ к сайту записи один раз и далее работает при переключениях вкладок; отказ от любого разрешения не ломает остальной функционал; `AUTOFILL_LOGIN` без доступа к URL вкладки не заполняет форму.

---

## P1-B (блокер публикации CWS). Невалидные коды локалей в `_locales`

**Факт:** `src/_locales/` содержит каталоги `ua`, `be`, `kk`. В списке локалей Chrome (проверено по ресурсам установленного Chrome и chrome.i18n docs) украинский = `uk`; кодов `ua`, `be` (белорусский), `kk` (казахский) в списке поддерживаемых НЕТ.

**Последствия:** распакованная загрузка в текущем Chrome проходит (проверено эмпирически), НО: (а) перевод `ua` никогда не будет выбран браузером — украинские пользователи (локаль `uk`) увидят английские name/description; (б) `be`/`kk` — мёртвые каталоги, и при загрузке пакета в Chrome Web Store валидатор магазина может отклонить архив с нераспознанными локалями.

**Что сделать:**
1. Переименовать `src/_locales/ua` → `src/_locales/uk` (содержимое не менять).
2. Каталоги `src/_locales/be` и `src/_locales/kk` удалить из `_locales` (внутренний переключатель языка UI работает через `translations.json` и НЕ зависит от `_locales` — белорусский и казахский остаются в приложении).
3. Внутренний код языка `ua` в `i18n.js`/`translations.json` можно не трогать (он не связан с `_locales`), но маппинг `navigator.language 'uk' → 'ua'` должен сохраниться (проверить B5-код).
4. Пересобрать, проверить `dist/_locales` и zip.

**Приёмка:** `ls src/_locales` = `en ru uk hi ja zh_CN`; Chrome с локалью uk показывает украинское имя расширения; zip не содержит `ua/be/kk`.

---

## Замечания без действий (зафиксировано, не блокирует)

- 26 строк кириллицы в `src/sidepanel/index.js` — это `data-search`-атрибуты (многоязычные ключевые слова поиска по настройкам), не UI-строки; допустимо.
- `GET_PAGE_FAVICON` в content.js стал пассивно недоступен после удаления статического инжекта — осознанно (основной источник `_favicon`).
- После P1-A и P1-B повторить финальный чек-лист из 09-p1-execution-plan.md, включая ручной смоук unpacked.

---

## Статус исполнения P1-A и P1-B (Выполнено ✅)

### P1-A: Runtime-запросы optional permissions
1. **Модуль `src/core/permissions.js`**:
   - `hasPermission(perm)`: обёртка над `chrome.permissions.contains({ permissions: [perm] })`.
   - `requestPermission(perm)`: обёртка над `chrome.permissions.request({ permissions: [perm] })` для вызова по жесту пользователя.
   - `hasOriginPermissions(origins)` и `requestOriginPermissions(origins)`: обёртки для запроса host permissions под конкретный сайт.
   - `getDomainOriginPatterns(domain)`: генерация специфичных origin-шаблонов (`https://domain/*`, `https://*.domain/*`, `http://domain/*`).
2. **Манифест `src/manifest.json`**:
   - Добавлены `"optional_host_permissions": ["https://*/*", "http://*/*"]` без опасных прав при установке.
3. **Безопасность автозаполнения**:
   - В `src/background.js` обработчик `AUTOFILL_LOGIN` при отсутствии `tab.url` возвращает `{ success: false, reason: 'no_tab_access' }` вместо неявного пропуска проверки.
   - В `src/sidepanel/index.js` `triggerAutofill` запрашивает origin-доступ к целевому домену и `tabs`-разрешение. При отказе делает fallback на безопасное копирование пароля в буфер.
4. **Управление детекцией текущего сайта**:
   - В настройках добавлен тумблер `sp-current-site-toggle` (`settings.current_site_label` & `desc`). При включении инициирует `requestPermission('tabs')`.
   - В хранилище при отсутствии разрешения выводится интерактивный баннер-CTA `sp-btn-enable-tabs` («Включить определение сайта»).
5. **Pass CLI & nativeMessaging**:
   - В `src/core/pass-native.js` вызов `sendNativeRequest` защищён проверкой `hasPermission('nativeMessaging')` с возвратом `{ ok: false, permissionRequired: true, errorCode: 'permission_required' }`.
   - В настройках кнопка «Подключить pass CLI» / «Проверить статус» (`sp-btn-check-pass-host`) и синхронизация запрашивают `requestPermission('nativeMessaging')` по жесту.
6. **Тестирование**:
   - В `tests/test-core.mjs` добавлен Тест №38 с моками `chrome.permissions` (`contains`, `request`, обработка ошибок `lastError`) и валидацией `getDomainOriginPatterns`. 38/38 тестов зелёные.

### P1-B: Валидные коды локалей в `_locales`
1. Каталог `src/_locales/ua` переименован в `src/_locales/uk`.
2. Удалены несовместимые с CWS каталоги `src/_locales/be` и `src/_locales/kk`.
3. В `src/_locales/` ровно 6 валидных директорий: `en`, `hi`, `ja`, `ru`, `uk`, `zh_CN`.
4. Внутренний i18n в приложении продолжает поддерживать все 8 языков (включая белорусский и казахский через `translations.json`, 316/316 ключей проверены скриптом `tests/check-i18n.mjs`).
5. Проверено содержимое собранного архива `simplepass-chrome.zip`: каталоги `ua`, `be`, `kk` отсутствуют.

