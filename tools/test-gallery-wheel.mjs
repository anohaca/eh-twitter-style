import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/eh-twitter-style.user.src.js', import.meta.url), 'utf8');
const functionStart = source.indexOf('function makeHorizontalStripWheelHandler(');
assert.notEqual(functionStart, -1, 'gallery strip wheel handler exists');
const bodyStart = source.indexOf('{', functionStart);
let depth = 0;
let functionEnd = -1;
for (let i = bodyStart; i < source.length; i++) {
  if (source[i] === '{') depth++;
  else if (source[i] === '}' && --depth === 0) {
    functionEnd = i + 1;
    break;
  }
}
assert.notEqual(functionEnd, -1, 'gallery strip wheel handler is complete');

const makeHandler = vm.runInNewContext(
  `(${source.slice(functionStart, functionEnd)})`
);
const strip = { scrollWidth: 1000, clientWidth: 300, scrollLeft: 100, style: { scrollSnapType: '' } };
const handler = makeHandler(strip);
const wheelEvent = (deltaY, deltaX = 0, ctrlKey = false, deltaMode = 0) => ({
  deltaY,
  deltaX,
  ctrlKey,
  deltaMode,
  wheelDelta: 0,
  wheelDeltaY: 0,
  prevented: false,
  preventDefault() { this.prevented = true; }
});

const down = wheelEvent(120);
assert.equal(handler(down), true, 'vertical wheel is captured when the strip can scroll right');
assert.equal(strip.scrollLeft, 220, 'vertical wheel moves the thumbnail strip horizontally');
assert.equal(down.prevented, true, 'page vertical scrolling is prevented while the strip moves');
assert.equal(strip.style.scrollSnapType, '', 'wheel handling does not install temporary inline snapping');

const up = wheelEvent(-80);
assert.equal(handler(up), true, 'reverse vertical wheel is captured away from the strip edge');
assert.equal(strip.scrollLeft, 140, 'reverse wheel moves the strip back left');

strip.scrollLeft = 0;
const atStart = wheelEvent(-100);
assert.equal(handler(atStart), false, 'wheel passes through at the left edge');
assert.equal(atStart.prevented, false, 'page can scroll vertically at the left edge');

strip.scrollLeft = 700;
const atEnd = wheelEvent(100);
assert.equal(handler(atEnd), false, 'wheel passes through at the right edge');

const trackpad = wheelEvent(10, 50);
assert.equal(handler(trackpad), false, 'native horizontal trackpad gestures pass through');
strip.scrollLeft = 300;
const mixedWheel = wheelEvent(40, 10);
assert.equal(handler(mixedWheel), true, 'vertical wheel input is recognized with a small horizontal component');
const zoom = wheelEvent(100, 0, true);
assert.equal(handler(zoom), false, 'Ctrl+wheel browser zoom is preserved');

strip.scrollLeft = 100;
const lineWheel = wheelEvent(3, 0, false, 1);
assert.equal(handler(lineWheel), true, 'line-mode mouse wheels are captured');
assert.equal(strip.scrollLeft, 220, 'line-mode wheel deltas are scaled to a visible movement');
const legacyWheel = wheelEvent(0);
legacyWheel.wheelDeltaY = -120;
assert.equal(handler(legacyWheel), true, 'legacy wheel deltas are recognized');
assert.match(source, /const horizontalWheelOptions = \{\s*capture:\s*true,\s*passive:\s*false\s*\};[\s\S]*?addSpaPageEventListener\(\s*window,\s*'wheel',\s*horizontalWheelHandler,\s*horizontalWheelOptions\s*\)/, 'wheel input is captured before page handlers and cleaned on SPA route changes');
assert.doesNotMatch(source, /scroll-snap-type:\s*x proximity/, 'gallery strip no longer has proximity snapping');
assert.doesNotMatch(source, /scroll-snap-align:\s*start/, 'gallery thumbnails no longer snap back to item starts');

const card = {};
const scopedHandler = makeHandler(strip, { contains: (target) => target === card });
const insideCard = wheelEvent(20);
insideCard.target = card;
assert.equal(scopedHandler(insideCard), true, 'wheel over the card is handled');
const outsideCard = wheelEvent(20);
outsideCard.target = {};
assert.equal(scopedHandler(outsideCard), false, 'wheel outside the card is left untouched');

console.log('PASS gallery detail strip converts vertical wheel to horizontal scroll');
