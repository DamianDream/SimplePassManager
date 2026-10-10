import assert from 'assert';
import {
  encryptVault,
  decryptVault,
  validateMasterPassword
} from '../src/core/crypto.js';
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

  // Test 6: Browser-to-Browser E2EE Tunnel (ECDH P-256 + AES-256-GCM)
  console.log('6. Testing Browser-to-Browser E2EE Tunnel (ECDH P-256 + AES-256-GCM)...');
  const {
    generateTunnelKeyPair,
    encryptTunnelPayload,
    decryptTunnelPayload
  } = await import('../src/core/crypto.js');

  // Party B creates receiving tunnel keypair and exports public key
  const receiverTunnel = await generateTunnelKeyPair();
  assert(receiverTunnel.publicKeyBase64, 'Receiver must produce public key base64');

  const secretItem = {
    title: 'Secret Server Access',
    username: 'admin',
    password: 'UltraSecretPassword2026!',
    url: 'https://vpn.corp.net',
    notes: 'Access token 999'
  };

  // Party A receives Party B's public key, derives shared secret, and encrypts payload
  const { tunnelPacket, envelope, senderPublicKeyBase64 } = await encryptTunnelPayload(secretItem, receiverTunnel.publicKeyBase64);
  assert(tunnelPacket.startsWith('SPTUN1:'), 'Tunnel packet must start with SPTUN1:');
  assert(envelope.spTunnel === true, 'Envelope must flag spTunnel');
  assert.strictEqual(envelope.senderPub, senderPublicKeyBase64);

  // Party B receives packet and decrypts using its private key
  const decryptedItem = await decryptTunnelPayload(tunnelPacket, receiverTunnel.keyPair.privateKey);
  assert.strictEqual(decryptedItem.title, secretItem.title);
  assert.strictEqual(decryptedItem.password, secretItem.password);
  assert.strictEqual(decryptedItem.username, secretItem.username);

  // Party C (attacker or wrong private key) tries to decrypt packet
  const fakeReceiver = await generateTunnelKeyPair();
  let attackerFailed = false;
  try {
    await decryptTunnelPayload(tunnelPacket, fakeReceiver.keyPair.privateKey);
  } catch (_) {
    attackerFailed = true;
  }
  assert(attackerFailed, 'Decryption with wrong private key must fail');
  console.log('   ✓ E2EE browser-to-browser tunnel handshake verified');

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
  const { isItemMatchingDomain, sortItemsByDomainMatch, extractCleanDomain } = await import('../src/core/domain.js');

  assert.strictEqual(extractCleanDomain('https://www.github.com/settings'), 'github.com');
  assert.strictEqual(extractCleanDomain('gist.github.com'), 'gist.github.com');
  assert.strictEqual(extractCleanDomain('chrome://extensions'), '');

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

  console.log('\nAll core unit tests passed successfully! ✅');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
