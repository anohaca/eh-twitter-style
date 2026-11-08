#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [beforeDir, afterDir, outputPath = 'work/size-opt/style-diff.json'] = process.argv.slice(2);
if (!beforeDir || !afterDir) throw new Error('Usage: node tools/compare-style-snapshots.mjs BEFORE_DIR AFTER_DIR [DIFF_JSON]');
const beforeFiles = (await import('node:fs')).readdirSync(beforeDir).filter((x) => x.endsWith('.json') && !x.endsWith('.manifest.json'));
const afterFiles = new Set((await import('node:fs')).readdirSync(afterDir).filter((x) => x.endsWith('.json') && !x.endsWith('.manifest.json')));
const diffs = [];
const scenarioKey = (name) => name.match(/((?:desktop|iphone|webkit)[^.]+\..+)$/)?.[1] || name;
for (const beforeName of beforeFiles) {
  const key = scenarioKey(beforeName);
  const afterName = [...afterFiles].find((x) => scenarioKey(x) === key);
  if (!afterName) { diffs.push({ file: key, missingAfter: true }); continue; }
  const before = JSON.parse(readFileSync(path.join(beforeDir, beforeName), 'utf8'));
  const after = JSON.parse(readFileSync(path.join(afterDir, afterName), 'utf8'));
  if (before.elements.length !== after.elements.length) diffs.push({ file: key, path: '$.elements.length', before: before.elements.length, after: after.elements.length });
  const n = Math.min(before.elements.length, after.elements.length);
  for (let i = 0; i < n; i += 1) {
    const a = before.elements[i], b = after.elements[i];
    const base = `$.elements[${i}](${a.path})`;
    for (const prop of ['root', 'tag', 'id', 'cls', 'path']) if (a[prop] !== b[prop]) diffs.push({ file: key, path: `${base}.${prop}`, before: a[prop], after: b[prop] });
    for (let j = 0; j < 4; j += 1) if (Math.abs(a.rect[j] - b.rect[j]) > 0.5) diffs.push({ file: key, path: `${base}.rect[${j}]`, before: a.rect[j], after: b.rect[j] });
    const keys = new Set([...Object.keys(a.computed), ...Object.keys(b.computed)]);
    for (const prop of keys) if (a.computed[prop] !== b.computed[prop]) diffs.push({ file: key, path: `${base}.computed.${prop}`, before: a.computed[prop], after: b.computed[prop] });
  }
}
for (const name of afterFiles) if (![...beforeFiles].some((x) => scenarioKey(x) === scenarioKey(name))) diffs.push({ file: name, missingBefore: true });
const summary = { beforeDir, afterDir, pairedFiles: beforeFiles.length, zeroDiff: diffs.length === 0, diffCount: diffs.length, diffs: diffs.slice(0, 500) };
writeFileSync(outputPath, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ outputPath, pairedFiles: summary.pairedFiles, zeroDiff: summary.zeroDiff, diffCount: summary.diffCount, firstDiffs: summary.diffs.slice(0, 10) }, null, 2));
if (diffs.length) process.exitCode = 1;
