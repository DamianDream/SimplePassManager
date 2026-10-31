import fs from 'fs';
import path from 'path';

const pkgPath = path.resolve('package.json');
const manifestPath = path.resolve('src/manifest.json');

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

if (manifest.version !== pkg.version) {
  console.log(`Syncing manifest.json version (${manifest.version} -> ${pkg.version})`);
  manifest.version = pkg.version;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
} else {
  console.log(`Manifest version is already in sync: v${pkg.version}`);
}
