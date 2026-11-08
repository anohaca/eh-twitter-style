import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const sourceUrl = new URL('../src/eh-twitter-style.user.src.js', import.meta.url);
const installUrl = new URL('../eh-twitter-style_user.js', import.meta.url);
export function assertBuildCurrent() {
  const source = readFileSync(sourceUrl);
  const install = readFileSync(installUrl, 'utf8');
  const expected = createHash('sha256').update(source).digest('hex');
  const actual = install.match(/^\/\/ @ehtw-source-sha256 ([a-f0-9]{64})$/m)?.[1];
  if (actual !== expected) {
    throw new Error(`Install file is stale: expected source SHA-256 ${expected}, found ${actual || 'no build marker'}. Run node tools/build.mjs.`);
  }
  return { source: fileURLToPath(sourceUrl), install: fileURLToPath(installUrl), sha256: expected };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log(JSON.stringify(assertBuildCurrent(), null, 2));
}
