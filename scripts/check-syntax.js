/**
 * Syntax-check every first-party JavaScript file.
 * Replaces the previous eslint --fix script, which had no config and rewrote files.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const roots = ['src', 'test', 'scripts'];
const files = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js')) files.push(full);
  }
}

for (const root of roots) {
  if (fs.existsSync(root)) walk(root);
}

let failed = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    failed++;
    process.stderr.write(result.stderr || result.stdout || `${file} failed\n`);
  }
}

if (failed) {
  console.error(`Syntax check failed for ${failed} file(s).`);
  process.exit(1);
}
console.log(`Syntax OK (${files.length} files).`);
