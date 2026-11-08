import { readFileSync } from 'node:fs';
import postcss from '../tests/node_modules/postcss/lib/postcss.mjs';

const file = process.argv[2] || 'src/eh-twitter-style.user.src.js';
const source = readFileSync(file, 'utf8');
const marker = 'const CSS = `';
const start = source.indexOf(marker);
if (start < 0) throw new Error('CSS template not found');
const contentStart = start + marker.length;
const end = source.indexOf('\n`;', contentStart);
if (end < 0) throw new Error('CSS template end not found');
const css = source.slice(contentStart, end);
const ast = postcss.parse(css);
let adjacentDuplicateRules = 0;
let adjacentDuplicateMedia = 0;
let duplicateRulesSameParent = 0;
let ruleCount = 0;
ast.walkRules(() => { ruleCount += 1; });
const signature = (node) => node.toString().replace(/\s+/g, ' ').trim();
const walk = (container) => {
  const seen = new Set();
  for (const node of container.nodes) {
    if (node.type !== 'rule') continue;
    const key = `${node.selector}\n${signature(node)}`;
    if (seen.has(key)) duplicateRulesSameParent += 1;
    else seen.add(key);
  }
  for (let i = 1; i < container.nodes.length; i += 1) {
    const prev = container.nodes[i - 1], curr = container.nodes[i];
    if (prev.type === 'rule' && curr.type === 'rule' && prev.selector === curr.selector && signature(prev) === signature(curr)) adjacentDuplicateRules += 1;
    if (prev.type === 'atrule' && curr.type === 'atrule' && prev.name === 'media' && curr.name === 'media' && prev.params === curr.params) adjacentDuplicateMedia += 1;
  }
  for (const node of container.nodes || []) if (node.nodes) walk(node);
};
walk(ast);
console.log(JSON.stringify({ file, cssBytes: Buffer.byteLength(css), interpolationCount: (css.match(/\$\{/g) || []).length, ruleCount, adjacentDuplicateRules, duplicateRulesSameParent, adjacentDuplicateMedia }, null, 2));
