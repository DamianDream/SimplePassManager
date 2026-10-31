import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const translationsPath = path.resolve(__dirname, '../src/locales/translations.json');

const raw = fs.readFileSync(translationsPath, 'utf8');
const translations = JSON.parse(raw);

const REQUIRED_LOCALES = ['en', 'ru', 'ua', 'be', 'kk', 'zh', 'ja', 'hi'];

let totalKeys = 0;
let missingCount = 0;

function checkObject(obj, currentPath = '') {
  for (const [key, value] of Object.entries(obj)) {
    const fullPath = currentPath ? `${currentPath}.${key}` : key;
    if (value && typeof value === 'object') {
      const keys = Object.keys(value);
      const isLeaf = REQUIRED_LOCALES.some(loc => keys.includes(loc));
      if (isLeaf) {
        totalKeys++;
        for (const loc of REQUIRED_LOCALES) {
          if (!value[loc] || typeof value[loc] !== 'string' || value[loc].trim() === '') {
            console.error(`❌ Missing or empty locale '${loc}' for key '${fullPath}'`);
            missingCount++;
          }
        }
      } else {
        checkObject(value, fullPath);
      }
    }
  }
}

checkObject(translations);

console.log(`\n--- i18n Completeness Verification ---`);
console.log(`Total verified translation keys: ${totalKeys}`);
console.log(`Missing translations: ${missingCount}`);

if (missingCount > 0) {
  console.error(`FAILED: ${missingCount} translations missing!`);
  process.exit(1);
} else {
  console.log(`✅ All ${totalKeys} keys are 100% complete across all 8 languages!`);
}
