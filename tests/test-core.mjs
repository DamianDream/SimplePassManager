import assert from 'assert';
import {
  encryptVault,
  decryptVault,
  validateMasterPassword
} from '../src/core/crypto.js';
import { normalizeVaultData, passFormatToItem, itemToPassFormat, itemsToCsv, csvToItems, parseCsv } from '../src/core/storage.js';
import { LOCK_INTERVALS } from '../src/core/session.js';


async function runTests() {
  console.log('--- Running SimplePass Core Tests ---');

  // Test 1: Crypto encryption and decryption
  console.log('1. Testing AES-256-GCM + PBKDF2 encryption/decryption...');
  const testPayload = { secret: 'my-super-secret-password-12345', timestamp: Date.now() };
  const masterPassword = 'CorrectMasterPassword!2026';
  const encrypted = await encryptVault(testPayload, masterPassword);

  assert(encrypted.salt && encrypted.iv && encrypted.data, 'Envelope must contain salt, iv, and data');
  const decrypted = await decryptVault(encrypted, masterPassword);
  assert.strictEqual(decrypted.secret, testPayload.secret, 'Decrypted secret must match original');

  // Test wrong password
  let failed = false;
  try {
    await decryptVault(encrypted, 'WrongPassword!');
  } catch (_) {
    failed = true;
  }
  assert(failed, 'Decryption with wrong password must throw error');
  console.log('   ✓ Crypto verified');

  // Test 2: Multi-project normalization & cascade
  console.log('2. Testing Multi-project data schema and cascade isolation...');
  const legacyData = {
    items: [
      { id: '1', title: 'GitHub', username: 'dev@test.com', password: 'pwd' }
    ]
  };
  const normalized = normalizeVaultData(legacyData, 'Мой Проект');
  assert.strictEqual(normalized.projects.length, 1, 'Should create 1 default project');
  assert.strictEqual(normalized.projects[0].name, 'Мой Проект');
  assert.strictEqual(normalized.items[0].projectId, normalized.projects[0].id, 'Item must be bound to project');
  console.log('   ✓ Multi-project normalization verified');

  // Test 3: Lock intervals
  console.log('3. Testing Lock Intervals definitions...');
  assert.strictEqual(LOCK_INTERVALS['3days'].ms, 3 * 24 * 60 * 60 * 1000, '3days must equal 72h');
  assert.strictEqual(LOCK_INTERVALS['1day'].ms, 24 * 60 * 60 * 1000, '1day must equal 24h');
  assert.strictEqual(LOCK_INTERVALS['1week'].ms, 7 * 24 * 60 * 60 * 1000, '1week must equal 7d');
  console.log('   ✓ Lock intervals verified');

  // Test 4: UNIX pass format serialization & deserialization
  console.log('4. Testing UNIX pass format serialization & parsing...');
  const sampleItem = {
    title: 'test-service',
    password: 'super_secret_pass',
    username: 'myuser',
    url: 'https://example.com',
    category: 'Work',
    notes: 'Sample note 123'
  };
  const passText = itemToPassFormat(sampleItem);
  assert(passText.startsWith('super_secret_pass\n'), 'First line of pass file must be password');
  assert(passText.includes('login: myuser'), 'Must contain login');
  assert(passText.includes('url: https://example.com'), 'Must contain url');

  const parsed = passFormatToItem('test-service', passText, 'proj_test');
  assert.strictEqual(parsed.title, 'test-service');
  assert.strictEqual(parsed.password, 'super_secret_pass');
  assert.strictEqual(parsed.username, 'myuser');
  assert.strictEqual(parsed.url, 'https://example.com');
  assert.strictEqual(parsed.notes, 'Sample note 123');
  console.log('   ✓ UNIX pass format verified');

  // Test 5: Master password policy validation (> 8 chars + special character)
  console.log('5. Testing Master Password policy validation (>8 chars + special symbol)...');
  assert.strictEqual(validateMasterPassword('').valid, false, 'Should fail empty');
  assert.strictEqual(validateMasterPassword('short!').valid, false, 'Should fail length <= 8');
  assert.strictEqual(validateMasterPassword('12345678').valid, false, 'Should fail 8 chars');
  assert.strictEqual(validateMasterPassword('123456789').valid, false, 'Should fail no special char');
  assert.strictEqual(validateMasterPassword('longpasswordwithoutspecial').valid, false, 'Should fail without special char');
  assert.strictEqual(validateMasterPassword('validPass!').valid, true, 'Should pass: 10 chars + !');
  assert.strictEqual(validateMasterPassword('secure#2026').valid, true, 'Should pass: 11 chars + #');
  console.log('   ✓ Master password policy verified');

  // Test 6: Single-Item Unencrypted CSV Quick Export & Parsing
  console.log('6. Testing Single-Item Unencrypted CSV Quick Export & Parsing...');
  const quickExportItem = {
    title: 'Work Email Access',
    username: 'alice@company.com',
    password: 'SuperSecretPass2026!',
    tags: ['Work', 'Important'],
    url: 'https://mail.company.com',
    notes: 'Quick export item note'
  };

  const singleCsv = itemsToCsv([quickExportItem]);
  assert(singleCsv.includes('login,pass,name,tag,url,note'), 'CSV header must be present');
  assert(singleCsv.includes('alice@company.com'), 'Username must be in CSV');
  assert(singleCsv.includes('SuperSecretPass2026!'), 'Password must be in CSV');
  assert(singleCsv.includes('Work Email Access'), 'Title must be in CSV');

  const { items: parsedItems } = csvToItems(singleCsv);
  assert.strictEqual(parsedItems.length, 1, 'Should parse exactly 1 item');
  assert.strictEqual(parsedItems[0].title, quickExportItem.title);
  assert.strictEqual(parsedItems[0].username, quickExportItem.username);
  assert.strictEqual(parsedItems[0].password, quickExportItem.password);
  assert.strictEqual(parsedItems[0].url, quickExportItem.url);
  assert.strictEqual(parsedItems[0].notes, quickExportItem.notes);
  console.log('   ✓ Single-Item unencrypted CSV quick export & round-trip parsed successfully');

  // Test 7: 12-Word Recovery Key & Dual-Key Envelope Encryption
  console.log('7. Testing 12-word recovery key and Dual-Key envelope decryption/rekey...');
  const { generateRecoveryPhrase, decryptVaultWithRecovery, rekeyVault } = await import('../src/core/crypto.js');
  const phrase = generateRecoveryPhrase();
  assert.strictEqual(phrase.split(' ').length, 12, 'Phrase must contain exactly 12 words');

  const dualPayload = { secretData: 'important-vault-records', count: 42 };
  const dualPassword = 'MasterPassword#2026';
  const dualEnvelope = await encryptVault(dualPayload, dualPassword, phrase);

  assert.strictEqual(dualEnvelope.version, 2, 'Envelope must be v2');
  assert(dualEnvelope.keyByPassword && dualEnvelope.keyByRecovery, 'Must contain dual keys for password and recovery');

  // Decrypt with master password
  const decByPwd = await decryptVault(dualEnvelope, dualPassword);
  assert.strictEqual(decByPwd.secretData, dualPayload.secretData, 'Decrypt by password must match original');

  // Decrypt with 12-word recovery phrase
  const { vaultData: decByRec } = await decryptVaultWithRecovery(dualEnvelope, phrase);
  assert.strictEqual(decByRec.secretData, dualPayload.secretData, 'Decrypt by recovery phrase must match original');

  // Fail on wrong 12-word recovery phrase
  let wrongPhraseFailed = false;
  try {
    const wrongPhrase = generateRecoveryPhrase();
    await decryptVaultWithRecovery(dualEnvelope, wrongPhrase);
  } catch (_) {
    wrongPhraseFailed = true;
  }
  assert(wrongPhraseFailed, 'Decryption with wrong recovery phrase must fail');

  // Rekey vault with new password and new recovery phrase
  const newPhrase = generateRecoveryPhrase();
  const rekeyed = await rekeyVault(decByRec, 'NewSuperMasterKey!99', newPhrase);
  const decNew = await decryptVault(rekeyed, 'NewSuperMasterKey!99');
  assert.strictEqual(decNew.count, 42, 'Rekeyed vault must decrypt with new password');
  console.log('   ✓ 12-word recovery key & Dual-Key envelope verified');

  // Test 8: Active Tab Domain Auto-detection & Priority Sorting
  console.log('8. Testing Domain Auto-Detection & Priority Card Sorting...');
  const { isItemMatchingDomain, sortItemsByDomainMatch, extractCleanDomain, extractDomainName } = await import('../src/core/domain.js');

  assert.strictEqual(extractCleanDomain('https://www.github.com/settings'), 'github.com');
  assert.strictEqual(extractCleanDomain('gist.github.com'), 'gist.github.com');
  assert.strictEqual(extractCleanDomain('chrome://extensions'), '');

  // Verify pure domain name extraction without ports and breadcrumbs
  assert.strictEqual(extractDomainName('192.168.0.104:4321'), '192.168.0.104');
  assert.strictEqual(extractDomainName('http://192.168.0.104:4321/dashboard/items'), '192.168.0.104');
  assert.strictEqual(extractDomainName('https://www.github.com/user/repo/pulls?tab=files'), 'github.com');
  assert.strictEqual(extractDomainName('localhost:3000/app'), 'localhost');

  const itemsList = [
    { id: '1', title: 'Google Mail', url: 'https://mail.google.com' },
    { id: '2', title: 'GitHub', url: 'https://github.com/login' },
    { id: '3', title: 'AWS Console', url: 'https://aws.amazon.com' },
    { id: '4', title: 'Gist Snippets', url: 'https://gist.github.com' }
  ];

  assert(isItemMatchingDomain(itemsList[1], 'github.com'), 'GitHub must match github.com');
  assert(isItemMatchingDomain(itemsList[3], 'github.com'), 'Subdomain gist.github.com must match github.com');
  assert(!isItemMatchingDomain(itemsList[0], 'github.com'), 'Google must not match github.com');

  const sortedByDomain = sortItemsByDomainMatch(itemsList, 'github.com');
  assert.strictEqual(sortedByDomain[0].title, 'GitHub', 'Matched item must be first');
  assert.strictEqual(sortedByDomain[1].title, 'Gist Snippets', 'Matched item must be second');
  assert.strictEqual(sortedByDomain[2].title, 'Google Mail', 'Unmatched item must follow');
  console.log('   ✓ Domain Auto-detection & Priority Sorting verified');

  // Test 9: Multilingual Support (EN / RU / UA)
  console.log('9. Testing Multilingual Translations (EN / RU / UA / BE / KK / ZH / JA / HI)...');
  const { t, setLanguage, getLanguage, SUPPORTED_LANGUAGES } = await import('../src/core/i18n.js');

  assert.deepStrictEqual(SUPPORTED_LANGUAGES, ['en', 'ru', 'ua', 'be', 'kk', 'zh', 'ja', 'hi']);

  setLanguage('en');
  assert.strictEqual(getLanguage(), 'en');
  assert.strictEqual(t('nav.passwords'), 'Passwords');
  assert.strictEqual(t('settings.language_label'), 'Interface Language');
  assert.strictEqual(t('footer.items_count', { count: 10 }), '10 passwords in vault');

  setLanguage('ru');
  assert.strictEqual(getLanguage(), 'ru');
  assert.strictEqual(t('nav.passwords'), 'Пароли');
  assert.strictEqual(t('settings.language_label'), 'Язык интерфейса');
  assert.strictEqual(t('footer.items_count', { count: 10 }), '10 паролей в базе');

  setLanguage('ua');
  assert.strictEqual(getLanguage(), 'ua');
  assert.strictEqual(t('nav.passwords'), 'Паролі');
  assert.strictEqual(t('settings.language_label'), 'Мова інтерфейсу');
  assert.strictEqual(t('footer.items_count', { count: 10 }), '10 паролів у базі');

  setLanguage('be');
  assert.strictEqual(getLanguage(), 'be');
  assert.strictEqual(t('nav.passwords'), 'Паролі');
  assert.strictEqual(t('settings.language_label'), 'Мова інтэрфейсу');

  setLanguage('kk');
  assert.strictEqual(getLanguage(), 'kk');
  assert.strictEqual(t('nav.passwords'), 'Құпия сөздер');
  assert.strictEqual(t('settings.language_label'), 'Интерфейс тілі');

  setLanguage('zh');
  assert.strictEqual(getLanguage(), 'zh');
  assert.strictEqual(t('nav.passwords'), '密码');
  assert.strictEqual(t('settings.language_label'), '界面语言');

  setLanguage('ja');
  assert.strictEqual(getLanguage(), 'ja');
  assert.strictEqual(t('nav.passwords'), 'パスワード');
  assert.strictEqual(t('settings.language_label'), '表示言語');

  setLanguage('hi');
  assert.strictEqual(getLanguage(), 'hi');
  assert.strictEqual(t('nav.passwords'), 'पासवर्ड');
  assert.strictEqual(t('settings.language_label'), 'इंटरफ़ेस भाषा');

  // Verify CSV template translation link
  setLanguage('ru');
  assert.strictEqual(t('settings.csv_template_link'), 'Скачать шаблон CSV для импорта');

  console.log('   ✓ Multilingual Translations (EN / RU / UA / BE / KK / ZH / JA / HI) verified');

  // Test 10: Category Color Tone System
  console.log('10. Testing Category Color Tone System...');
  const {
    CATEGORY_COLORS,
    DEFAULT_CATEGORY_COLORS,
    getCategoryColorDef,
    getCategoryCssVars
  } = await import('../src/core/categories.js');

  assert(Object.keys(CATEGORY_COLORS).length >= 8, 'Must have at least 8 curated color tones');
  assert.strictEqual(getCategoryColorDef('Work').id, 'blue', 'Default Work category must be blue');
  assert.strictEqual(getCategoryColorDef('Personal').id, 'green', 'Default Personal category must be green');
  assert.strictEqual(CATEGORY_COLORS.green.color, '#BADC00', 'Green/Lime color tone must be #BADC00');

  // Custom assigned category color
  const customDefs = { Finance: 'amber', Crypto: 'purple' };
  assert.strictEqual(getCategoryColorDef('Finance', customDefs).id, 'amber');
  assert.strictEqual(getCategoryColorDef('Crypto', customDefs).id, 'purple');

  // CSS variables formatting
  const amberDef = CATEGORY_COLORS.amber;
  const varsStr = getCategoryCssVars(amberDef);
  assert(varsStr.includes('--pill-color:#F59E0B'), 'CSS vars must define pill-color');
  assert(varsStr.includes('--pill-bg-dark:'), 'CSS vars must define pill-bg-dark');
  // Test 11: Tag System Validation & Multi-tag Extraction
  console.log('11. Testing Tag System Validation & Multi-tag Extraction...');
  const { validateTagName, getItemTags } = await import('../src/core/categories.js');

  // Validation: empty / spaces
  assert.strictEqual(validateTagName('').valid, false);
  assert.strictEqual(validateTagName('   ').valid, false);

  // Validation: allowed letters and digits (EN, RU, UA, with spaces)
  assert.strictEqual(validateTagName('Work').valid, true);
  assert.strictEqual(validateTagName('Работа 2026').valid, true);
  assert.strictEqual(validateTagName('Банки та фінанси').valid, true);
  assert.strictEqual(validateTagName('Web3 100').valid, true);

  // Validation: max 30 chars
  assert.strictEqual(validateTagName('a'.repeat(30)).valid, true);
  assert.strictEqual(validateTagName('a'.repeat(31)).valid, false);

  // Validation: disallowed special characters
  assert.strictEqual(validateTagName('Work!').valid, false);
  assert.strictEqual(validateTagName('Work@Home').valid, false);
  assert.strictEqual(validateTagName('Tag-Name').valid, false);
  assert.strictEqual(validateTagName('Tag_Name').valid, false);
  assert.strictEqual(validateTagName('Tag#1').valid, false);

  // getItemTags
  assert.deepStrictEqual(getItemTags({ tags: ['Finance', 'Crypto'] }), ['Finance', 'Crypto']);
  assert.deepStrictEqual(getItemTags({ category: 'Personal' }), ['Personal']);
  assert.deepStrictEqual(getItemTags({ tags: [] }), []);
  assert.deepStrictEqual(getItemTags({}), ['Work']);
  assert.deepStrictEqual(getItemTags(null), ['Work']);
  console.log('   ✓ Tag System Validation & Multi-tag Extraction verified');

  // Test 12: CSV Export & Import with strict column order (login, pass, name, tag, url, note)
  console.log('12. Testing CSV Export & Import with strict column order (login, pass, name, tag, url, note)...');
  const sampleCsvItems = [
    {
      title: 'Google Account',
      username: 'user@gmail.com',
      password: 'password123!',
      category: 'Work',
      tags: ['Work', 'Cloud'],
      url: 'https://google.com',
      notes: 'Main work account'
    },
    {
      title: 'GitHub, Corp',
      username: 'octocat',
      password: 'p@$$"word"',
      category: 'Personal',
      tags: ['Personal'],
      url: 'https://github.com',
      notes: 'Line 1\nLine 2 with "quotes" and, comma'
    }
  ];

  // 1. Export to CSV
  const exportedCsv = itemsToCsv(sampleCsvItems);
  assert(exportedCsv.startsWith('login,pass,name,tag,url,note'), 'Header must be exactly: login,pass,name,tag,url,note');

  // Verify rows structure
  const parsedRows = parseCsv(exportedCsv);
  assert.strictEqual(parsedRows.length, 3, 'Must have header + 2 data rows');
  assert.deepStrictEqual(parsedRows[0], ['login', 'pass', 'name', 'tag', 'url', 'note']);

  // Check row 1
  assert.strictEqual(parsedRows[1][0], 'user@gmail.com'); // login
  assert.strictEqual(parsedRows[1][1], 'password123!');   // pass
  assert.strictEqual(parsedRows[1][2], 'Google Account');  // name
  assert.strictEqual(parsedRows[1][3], 'Work, Cloud');     // tag
  assert.strictEqual(parsedRows[1][4], 'https://google.com'); // url
  assert.strictEqual(parsedRows[1][5], 'Main work account');  // note

  // Check row 2 (escaped quotes, commas, multiline notes)
  assert.strictEqual(parsedRows[2][0], 'octocat');
  assert.strictEqual(parsedRows[2][1], 'p@$$"word"');
  assert.strictEqual(parsedRows[2][2], 'GitHub, Corp');
  assert.strictEqual(parsedRows[2][3], 'Personal');
  assert.strictEqual(parsedRows[2][4], 'https://github.com');
  assert.strictEqual(parsedRows[2][5], 'Line 1\nLine 2 with "quotes" and, comma');

  // 2. Import from CSV
  const { items: importedItems, newCategories } = csvToItems(exportedCsv, 'proj_test');
  assert.strictEqual(importedItems.length, 2);
  assert.strictEqual(importedItems[0].username, 'user@gmail.com');
  assert.strictEqual(importedItems[0].password, 'password123!');
  assert.strictEqual(importedItems[0].title, 'Google Account');
  assert.deepStrictEqual(importedItems[0].tags, ['Work', 'Cloud']);
  assert.strictEqual(importedItems[0].category, 'Work');
  assert.strictEqual(importedItems[0].url, 'https://google.com');
  assert.strictEqual(importedItems[0].notes, 'Main work account');

  assert.strictEqual(importedItems[1].username, 'octocat');
  assert.strictEqual(importedItems[1].password, 'p@$$"word"');
  assert.strictEqual(importedItems[1].title, 'GitHub, Corp');
  assert.deepStrictEqual(importedItems[1].tags, ['Personal']);
  assert.strictEqual(importedItems[1].category, 'Personal');
  assert.strictEqual(importedItems[1].url, 'https://github.com');
  assert.strictEqual(importedItems[1].notes, 'Line 1\nLine 2 with "quotes" and, comma');

  assert(newCategories.includes('Work'));
  assert(newCategories.includes('Cloud'));
  assert(newCategories.includes('Personal'));

  // 3. Import from CSV without header
  const rawCsvWithoutHeader = `bob,SecretPass99,Banking,Finance;Cards,https://bank.com,Card PIN 1234`;
  const importResultNoHeader = csvToItems(rawCsvWithoutHeader, 'proj_test');
  assert.strictEqual(importResultNoHeader.items.length, 1);
  assert.strictEqual(importResultNoHeader.items[0].username, 'bob');
  assert.strictEqual(importResultNoHeader.items[0].password, 'SecretPass99');
  assert.strictEqual(importResultNoHeader.items[0].title, 'Banking');
  assert.deepStrictEqual(importResultNoHeader.items[0].tags, ['Finance', 'Cards']);
  assert.strictEqual(importResultNoHeader.items[0].url, 'https://bank.com');
  assert.strictEqual(importResultNoHeader.items[0].notes, 'Card PIN 1234');

  console.log('   ✓ CSV Export & Import with strict column ordering verified');

  // Test 13: Multi-Vault Profiles, Isolation & Preservation
  console.log('13. Testing Multi-Vault Profiles & Retention on New Database Creation...');
  const {
    getVaultProfiles,
    getActiveVaultId,
    setActiveVaultId,
    getStoredVault,
    saveStoredVault,
    createVaultProfile,
    deleteVaultProfile,
    clearStoredVault
  } = await import('../src/core/storage.js');

  // Clear any existing test vault data
  await clearStoredVault();

  // 1. Initial vault creation
  const data1 = {
    version: 2,
    projects: [{ id: 'proj_1', name: 'Main Project' }],
    items: [{ id: 'item_1', title: 'Work Login', username: 'work@corp.com' }]
  };
  const env1 = await encryptVault(data1, 'MasterSecret123#');
  await saveStoredVault(env1, 'vault_first');

  let profiles = await getVaultProfiles();
  assert.strictEqual(profiles.length, 1, 'Should have 1 profile registered');
  assert.strictEqual(profiles[0].id, 'vault_first');

  // 2. Create second vault (simulating creation from recovery screen when forgotten master password)
  const data2 = {
    version: 2,
    projects: [{ id: 'proj_2', name: 'Personal Project' }],
    items: [{ id: 'item_2', title: 'Personal Email', username: 'me@home.org' }]
  };
  const env2 = await encryptVault(data2, 'NewMasterPass456!');
  const profile2 = await createVaultProfile('Вторая база', env2);

  profiles = await getVaultProfiles();
  assert.strictEqual(profiles.length, 2, 'Should now have 2 independent profiles registered');
  assert.strictEqual(await getActiveVaultId(), profile2.id, 'Active vault should be the newly created vault');

  // 3. Verify that old vault data was NOT deleted or overwritten!
  const retrievedEnv1 = await getStoredVault('vault_first');
  assert(retrievedEnv1 !== null, 'First vault envelope must still exist');
  const decrypted1 = await decryptVault(retrievedEnv1, 'MasterSecret123#');
  assert.strictEqual(decrypted1.items[0].username, 'work@corp.com', 'Original data in first vault must remain intact');

  // 4. Verify new vault data is decrypted with its own password
  const retrievedEnv2 = await getStoredVault(profile2.id);
  assert(retrievedEnv2 !== null, 'Second vault envelope must exist');
  const decrypted2 = await decryptVault(retrievedEnv2, 'NewMasterPass456!');
  assert.strictEqual(decrypted2.items[0].username, 'me@home.org', 'Data in second vault must match its own items');

  // 5. Switch active vault back to first vault and verify getStoredVault()
  await setActiveVaultId('vault_first');
  assert.strictEqual(await getActiveVaultId(), 'vault_first');
  const activeEnv = await getStoredVault();
  const decryptedActive = await decryptVault(activeEnv, 'MasterSecret123#');
  assert.strictEqual(decryptedActive.items[0].title, 'Work Login');

  // 6. Delete second vault and verify first vault remains completely intact
  await deleteVaultProfile(profile2.id);
  profiles = await getVaultProfiles();
  assert.strictEqual(profiles.length, 1);
  assert.strictEqual(profiles[0].id, 'vault_first');
  assert(await getStoredVault('vault_first') !== null, 'First vault remains safe after deleting second vault');

  console.log('   ✓ Multi-Vault Profiles & Retention on New Database Creation verified');

  // Test 14: Bitwarden JSON 2-Way Compatibility (Import & Export)
  console.log('14. Testing Bitwarden JSON 2-Way Compatibility (Import & Export)...');
  const { bitwardenJsonToItems, itemsToBitwardenJson } = await import('../src/core/storage.js');

  const sampleBwData = {
    encrypted: false,
    folders: [
      { id: 'f_work', name: 'Work' },
      { id: 'f_finance', name: 'Finance' }
    ],
    items: [
      {
        type: 1,
        name: 'accounts.google.com',
        favorite: true,
        folderId: 'f_work',
        login: {
          uris: [{ uri: 'https://accounts.google.com/signin' }],
          username: 'admin@google.com',
          password: 'PassWordGoogle123!'
        },
        notes: 'Main work account'
      },
      {
        type: 1,
        name: 'bank.example.com',
        favorite: false,
        folderId: 'f_finance',
        login: {
          uris: [{ uri: 'https://bank.example.com/login' }],
          username: 'client_777',
          password: 'SecureBankPass#999'
        },
        notes: 'Banking portal'
      }
    ]
  };

  const { items: importedFromBw, newCategories: bwCategories } = bitwardenJsonToItems(sampleBwData, 'proj_test');
  assert.strictEqual(importedFromBw.length, 2, 'Should parse 2 Bitwarden items');
  assert.strictEqual(importedFromBw[0].title, 'accounts.google.com');
  assert.strictEqual(importedFromBw[0].username, 'admin@google.com');
  assert.strictEqual(importedFromBw[0].password, 'PassWordGoogle123!');
  assert.strictEqual(importedFromBw[0].url, 'https://accounts.google.com/signin');
  assert.strictEqual(importedFromBw[0].notes, 'Main work account');
  assert.strictEqual(importedFromBw[0].tags[0], 'Work');
  assert.strictEqual(importedFromBw[0].favorite, true);

  assert.strictEqual(importedFromBw[1].title, 'bank.example.com');
  assert.strictEqual(importedFromBw[1].username, 'client_777');
  assert.strictEqual(importedFromBw[1].password, 'SecureBankPass#999');
  assert.strictEqual(importedFromBw[1].tags[0], 'Finance');
  assert(bwCategories.includes('Finance'), 'Discovered categories must contain Finance');

  // Test Exporting back to Bitwarden JSON format
  const exportedBwJsonStr = itemsToBitwardenJson(importedFromBw);
  const parsedExported = JSON.parse(exportedBwJsonStr);
  assert.strictEqual(parsedExported.encrypted, false, 'Must be unencrypted Bitwarden JSON');
  assert(Array.isArray(parsedExported.folders), 'Folders must be an array');
  assert(Array.isArray(parsedExported.items), 'Items must be an array');
  assert.strictEqual(parsedExported.items.length, 2);
  assert.strictEqual(parsedExported.items[0].name, 'accounts.google.com');
  assert.strictEqual(parsedExported.items[0].login.username, 'admin@google.com');
  assert.strictEqual(parsedExported.items[0].login.password, 'PassWordGoogle123!');
  assert.strictEqual(parsedExported.items[0].login.uris[0].uri, 'https://accounts.google.com/signin');
  console.log('   ✓ Bitwarden JSON 2-Way Compatibility verified');

  // Test 15: Show/Hide Card Tags Settings & State
  console.log('15. Testing Show/Hide Card Tags Setting & Translations...');
  const { DEFAULT_CONFIG } = await import('../src/core/storage.js');
  const { state } = await import('../src/core/state.js');
  assert.strictEqual(DEFAULT_CONFIG.showCardTags, false, 'DEFAULT_CONFIG.showCardTags must default to false');
  assert.strictEqual(state.showCardTags, false, 'state.showCardTags must default to false');
  assert(t('settings.show_card_tags_label'), 'Label translation must exist');
  assert(t('settings.show_card_tags_desc'), 'Desc translation must exist');
  assert(t('toasts.card_tags_shown'), 'Toast shown translation must exist');
  assert(t('toasts.card_tags_hidden'), 'Toast hidden translation must exist');
  console.log('   ✓ Show/Hide Card Tags Setting & Translations verified');

  // Test 16: Favicon Cache & Re-use across matching domains
  console.log('16. Testing Favicon Cache & Multi-Item Re-use for Same Domain...');
  const {
    getCachedFavicon,
    setCachedFavicon,
    getFaviconCache,
    resolveFavicon,
    parseUrlDetails
  } = await import('../src/core/favicon.js');
  const { isLocalOrPrivateHost } = await import('../src/core/domain.js');

  const testDomain = 'example-service.com';
  const dummyFavicon = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

  // 1. Initial state must be null for new domain
  assert.strictEqual(await getCachedFavicon(testDomain), null, 'Initial cached favicon must be null');

  // 2. Set cached favicon
  await setCachedFavicon(testDomain, dummyFavicon);
  assert.strictEqual(await getCachedFavicon(testDomain), dummyFavicon, 'Cached favicon must be saved');

  // 3. Resolve for identical domain URL (e.g. 2nd password item created for same domain)
  const resolvedItem1 = await resolveFavicon(`https://${testDomain}/login`, { forceRefresh: false });
  assert.strictEqual(resolvedItem1.domain, testDomain);
  assert.strictEqual(resolvedItem1.favicon, dummyFavicon);
  assert.strictEqual(resolvedItem1.fromCache, true, 'Second password item must reuse existing cached favicon');

  const resolvedItem2 = await resolveFavicon(`https://sub.${testDomain}/settings`, { forceRefresh: false });
  assert.strictEqual(resolvedItem2.domain, `sub.${testDomain}`);

  // 4. Test Local Network IPs and custom ports (e.g. 192.168.0.104:4321 / localhost:3000)
  assert.strictEqual(isLocalOrPrivateHost('192.168.0.104:4321'), true, '192.168.0.104:4321 must be recognized as local IP');
  assert.strictEqual(isLocalOrPrivateHost('http://192.168.0.104:4321/demo'), true);
  assert.strictEqual(isLocalOrPrivateHost('localhost:3000'), true);
  assert.strictEqual(isLocalOrPrivateHost('github.com'), false);

  const localDetails = parseUrlDetails('192.168.0.104:4321');
  assert.strictEqual(localDetails.origin, 'http://192.168.0.104:4321');
  assert.strictEqual(localDetails.host, '192.168.0.104:4321');
  assert.strictEqual(localDetails.isLocal, true);

  // 5. Test active tab favIconUrl resolution on local dev servers
  const localResolved = await resolveFavicon('192.168.0.104:4321', {
    forceRefresh: true,
    activeTabFavIconUrl: dummyFavicon
  });
  assert.strictEqual(localResolved.domain, '192.168.0.104:4321');
  assert.strictEqual(localResolved.favicon, dummyFavicon);
  assert.strictEqual(await getCachedFavicon('192.168.0.104:4321'), dummyFavicon);
  assert.strictEqual(await getCachedFavicon('192.168.0.104'), dummyFavicon);

  // 6. Verify translation keys for favicon features
  assert(t('form.refresh_favicon_title'), 'Refresh favicon title translation must exist');
  assert(t('toasts.favicon_updated'), 'Favicon updated toast must exist');
  assert(t('toasts.favicon_empty_url'), 'Favicon empty url toast must exist');
  assert(t('toasts.favicon_fetch_failed'), 'Favicon fetch failed toast must exist');
  console.log('   ✓ Favicon Cache, Local IP:Port & Multi-Item Re-use verified');

  // Test 17: Show/Hide Favicons Setting & Translations across all languages
  console.log('17. Testing Show/Hide Favicons Setting & Multilingual Translations...');
  assert.strictEqual(DEFAULT_CONFIG.showFavicons, true, 'DEFAULT_CONFIG.showFavicons must default to true');
  assert.strictEqual(state.showFavicons, true, 'state.showFavicons must default to true');
  assert(t('settings.show_favicons_label'), 'Favicons label translation must exist');
  assert(t('settings.show_favicons_desc'), 'Favicons desc translation must exist');
  assert(t('toasts.favicons_shown'), 'Favicons shown toast must exist');
  assert(t('toasts.favicons_hidden'), 'Favicons hidden toast must exist');

  const supportedLanguages = ['en', 'ru', 'ua', 'be', 'kk', 'zh', 'ja', 'hi'];
  for (const lang of supportedLanguages) {
    setLanguage(lang);
    assert(t('settings.show_favicons_label'), `show_favicons_label missing in lang: ${lang}`);
    assert(t('settings.show_favicons_desc'), `show_favicons_desc missing in lang: ${lang}`);
    assert(t('toasts.favicons_shown'), `favicons_shown missing in lang: ${lang}`);
    assert(t('toasts.favicons_hidden'), `favicons_hidden missing in lang: ${lang}`);
  }
  setLanguage('ru');
  console.log('   ✓ Show/Hide Favicons Setting & Multilingual Translations verified');

  // Test 18: Advanced Export with Tag Filtering & Translations
  console.log('18. Testing Advanced Export by Tags & Multilingual Translations...');
  assert(t('settings.export_advanced_link'), 'export_advanced_link translation must exist');
  assert(t('settings.export_by_tags_title'), 'export_by_tags_title translation must exist');
  assert(t('settings.export_select_all'), 'export_select_all translation must exist');
  assert(t('settings.export_clear_tags'), 'export_clear_tags translation must exist');
  assert(t('settings.export_tags_none_selected', { count: 5 }), 'export_tags_none_selected translation must exist');
  assert(t('settings.export_tags_selected_count', { count: 2, total: 5 }), 'export_tags_selected_count translation must exist');
  assert(t('settings.export_no_matching_items'), 'export_no_matching_items translation must exist');
  assert(t('settings.export_no_tags_available'), 'export_no_tags_available translation must exist');

  for (const lang of supportedLanguages) {
    setLanguage(lang);
    assert(t('settings.export_advanced_link'), `export_advanced_link missing in lang: ${lang}`);
    assert(t('settings.export_by_tags_title'), `export_by_tags_title missing in lang: ${lang}`);
    assert(t('settings.export_select_all'), `export_select_all missing in lang: ${lang}`);
    assert(t('settings.export_clear_tags'), `export_clear_tags missing in lang: ${lang}`);
  }
  setLanguage('ru');

  // Verify item tag filtering logic for export
  const sampleItems = [
    { id: '1', title: 'Work Tool', username: 'u1', password: 'p1', tags: ['Work'] },
    { id: '2', title: 'Crypto Wallet', username: 'u2', password: 'p2', tags: ['Personal', 'Crypto'] },
    { id: '3', title: 'Bank Account', username: 'u3', password: 'p3', tags: ['Finance'] }
  ];

  const filterByTags = (items, selectedTags) => {
    if (!selectedTags || selectedTags.size === 0) return items;
    return items.filter(item => {
      const tags = getItemTags(item);
      return tags.some(t => selectedTags.has(t));
    });
  };

  const workFiltered = filterByTags(sampleItems, new Set(['Work']));
  assert.strictEqual(workFiltered.length, 1);
  assert.strictEqual(workFiltered[0].title, 'Work Tool');

  const cryptoFiltered = filterByTags(sampleItems, new Set(['Crypto']));
  assert.strictEqual(cryptoFiltered.length, 1);
  assert.strictEqual(cryptoFiltered[0].title, 'Crypto Wallet');

  const multiFiltered = filterByTags(sampleItems, new Set(['Work', 'Finance']));
  assert.strictEqual(multiFiltered.length, 2);
  assert.deepStrictEqual(multiFiltered.map(i => i.title), ['Work Tool', 'Bank Account']);

  // CSV export with tag filter
  const filteredCsv = itemsToCsv(multiFiltered);
  assert(filteredCsv.includes('Work Tool'));
  assert(filteredCsv.includes('Bank Account'));
  assert(!filteredCsv.includes('Crypto Wallet'));

  // Bitwarden JSON export with tag filter
  const filteredBwJson = JSON.parse(itemsToBitwardenJson(cryptoFiltered));
  assert.strictEqual(filteredBwJson.items.length, 1);
  assert.strictEqual(filteredBwJson.items[0].name, 'Crypto Wallet');

  console.log('   ✓ Advanced Export by Tags & Multilingual Translations verified');

  console.log('\nAll core unit tests passed successfully! ✅');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
