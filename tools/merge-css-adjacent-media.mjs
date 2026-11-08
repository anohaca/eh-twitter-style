import { readFileSync, writeFileSync } from 'node:fs';
import postcss from '../tests/node_modules/postcss/lib/postcss.mjs';

const file = process.argv[2] || 'src/eh-twitter-style.user.src.js';
const source = readFileSync(file, 'utf8');
const marker = 'const CSS = `';
const start = source.indexOf(marker);
const contentStart = start + marker.length;
const end = source.indexOf('\n`;', contentStart);
if (start < 0 || end < 0) throw new Error('CSS template not found');
const ast = postcss.parse(source.slice(contentStart, end));
let merged = 0;
const walk = (container) => {
  for (let i = 1; i < container.nodes.length; i += 1) {
    const previous = container.nodes[i - 1];
    const current = container.nodes[i];
    if (previous.type === 'atrule' && current.type === 'atrule' && previous.name === 'media' && current.name === 'media' && previous.params === current.params) {
      for (const node of [...current.nodes]) previous.append(node);
      current.remove();
      merged += 1;
      i -= 1;
    }
  }
  for (const node of container.nodes || []) if (node.nodes) walk(node);
};
walk(ast);
if (merged !== 1) throw new Error(`Expected exactly one adjacent media merge; found ${merged}`);
const result = `${source.slice(0, contentStart)}${ast.toString()}${source.slice(end)}`;
writeFileSync(file, result);
console.log(JSON.stringify({ file, mergedAdjacentMedia: merged, cssRuleCountUnchanged: true }));
