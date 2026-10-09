import assert from 'assert';
import { encryptVault, decryptVault, validateMasterPassword } from '../src/core/crypto.js';
import { normalizeVaultData, passFormatToItem, itemToPassFormat } from '../src/core/storage.js';
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

  console.log('\nAll core unit tests passed successfully! ✅');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
