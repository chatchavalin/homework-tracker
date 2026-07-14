import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../api/notify.js', import.meta.url), 'utf8');

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must be defined`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index++) {
    if (source[index] === '{') depth++;
    if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

const getBangkokCalendar = new Function(
  `${extractFunction('getBangkokCalendar')}\nreturn getBangkokCalendar;`
)();

const bkk = getBangkokCalendar(new Date('2026-07-13T23:26:00.000Z'));
assert.deepEqual(bkk, { year: 2026, month: 6, day: 14, dow: 2 });
console.log('Bangkok notification date: passed');
