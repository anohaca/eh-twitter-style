#!/usr/bin/env node
// Build the installable userscript from the readable source of truth.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { minify } from '../tests/node_modules/terser/dist/bundle.min.js';
import postcss from '../tests/node_modules/postcss/lib/postcss.mjs';

const sourcePath = new URL('../src/eh-twitter-style.user.src.js', import.meta.url);
const outputPath = new URL('../eh-twitter-style_user.js', import.meta.url);
let source = readFileSync(sourcePath, 'utf8');
const headerEnd = source.indexOf('// ==/UserScript==');
if (headerEnd < 0 || !source.startsWith('// ==UserScript==')) throw new Error('Complete userscript metadata header is required at byte zero');
const headerEndLine = source.indexOf('\n', headerEnd);
const header = source.slice(0, headerEndLine + 1);
const version = source.match(/^\/\/ @version\s+(\S+)/m)?.[1];
if (!version) throw new Error('Userscript @version is missing');

function cssMinify(css) {
  const root = postcss.parse(css);
  const emit = (node) => {
    if (node.type === 'comment') return `/*${node.text}*/`;
    if (node.type === 'decl') return `${node.prop}:${node.raws.value?.raw ?? node.value}${node.important ? '!important' : ''};`;
    if (node.type === 'rule') return `${node.selector}{${node.nodes.map(emit).join('')}}`;
    if (node.type === 'atrule') return `@${node.name}${node.params ? ` ${node.params}` : ''}${node.nodes ? `{${node.nodes.map(emit).join('')}}` : ';'}`;
    throw new Error(`Unsupported CSS node type: ${node.type}`);
  };
  return root.nodes.map(emit).join('');
}

function templateEnd(input, start) {
  for (let i = start + 1; i < input.length; i += 1) {
    if (input[i] === '\\') { i += 1; continue; }
    if (input[i] === '`') return i;
    // CSS templates with JS interpolation are deliberately left byte-for-byte
    // intact; this avoids parsing or rewriting any expression inside ${...}.
    if (input[i] === '$' && input[i + 1] === '{') return -1;
  }
  throw new Error('Unterminated CSS template literal');
}

const targets = [];
const targetPattern = /(?:const\s+CSS|(?:earlyStyle|readerStyle)\.textContent)\s*=\s*`/g;
for (const match of source.matchAll(targetPattern)) {
  const tick = match.index + match[0].lastIndexOf('`');
  const end = templateEnd(source, tick);
  if (end < 0) continue;
  const original = source.slice(tick + 1, end);
  targets.push({ start: tick + 1, end, originalBytes: Buffer.byteLength(original), value: cssMinify(original) });
}
for (const target of targets.reverse()) source = `${source.slice(0, target.start)}${target.value}${source.slice(target.end)}`;

const bridgeStart = source.indexOf('const bridge = function');
const bridgeEnd = source.indexOf('const probeNonce =', bridgeStart);
if (bridgeStart < 0 || bridgeEnd < 0 || !source.includes('bridge.toString()')) throw new Error('Page-world bridge/toString injection not found');
const bridgeReserved = [...new Set((source.slice(bridgeStart, bridgeEnd).match(/[A-Za-z_$][\w$]*/g) || []))];
const body = source.slice(header.length);
const result = await minify(body, {
  compress: {
    defaults: true,
    unsafe: false,
    unsafe_comps: false,
    unsafe_math: false,
    unsafe_methods: false,
    unsafe_proto: false,
    unsafe_regexp: false,
    unsafe_undefined: false,
    pure_getters: false,
    keep_fnames: true,
    keep_classnames: true
  },
  mangle: { keep_fnames: true, keep_classnames: true, reserved: bridgeReserved },
  keep_fnames: true,
  keep_classnames: true,
  format: { comments: false, keep_numbers: true }
});
if (!result.code) throw new Error('Terser returned no output');
const digest = createHash('sha256').update(readFileSync(sourcePath)).digest('hex');
const install = `${header}// @ehtw-source-sha256 ${digest}\n${result.code}\n`;
if (!install.startsWith(header) || !install.includes('bridge.toString()')) throw new Error('Metadata or page-world bridge was lost during build');
if (!install.includes(`dataset.ehtwScriptVersion="${version}"`) && !install.includes(`dataset.ehtwScriptVersion='${version}'`)) throw new Error('Runtime version marker missing from generated install');
for (const marker of ['ehtw-navlog', 'navigation-log-enabled', '__EHTW_PAGE_WORLD_BRIDGE_V1__', 'safeReplaceHistoryState', 'flushPendingScrollHistoryStateWrite']) {
  if (!result.code.includes(marker)) throw new Error(`Required navigation diagnostics marker was lost: ${marker}`);
}
for (const method of ['warn', 'error']) {
  const count = (value) => (value.match(new RegExp(`console\\.${method}\\s*\\(`, 'g')) || []).length;
  if (count(source) !== count(result.code)) throw new Error(`console.${method} calls changed during build`);
}
writeFileSync(outputPath, install);
console.log(JSON.stringify({ source: sourcePath.pathname, output: outputPath.pathname, version, sourceBytes: Buffer.byteLength(readFileSync(sourcePath)), installBytes: Buffer.byteLength(install), cssTemplatesMinified: targets.length, cssTemplateBytesBefore: targets.reduce((sum, item) => sum + item.originalBytes, 0), cssTemplateBytesAfter: targets.reduce((sum, item) => sum + Buffer.byteLength(item.value), 0), sourceSha256: digest }, null, 2));
