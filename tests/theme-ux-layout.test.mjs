import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const themes = ['calm', 'dense', 'playful', 'dark', 'hero', 'hermes', 'dbz'];
for (const id of themes) {
  assert.match(source, new RegExp(`html\\[data-theme=["']${id}["']\\]`), `${id} must have layout CSS`);
  assert.match(source, new RegExp(`/\\* UX-THEME:${id} \\*/`), `${id} must have UX layout marker`);
}

// Default keeps baseline layout (no forced UX block required beyond colors)
assert.match(source, /function applyAppTheme\(/);
assert.match(source, /renderExamBanner\(\)/);
// Theme switch should re-render shell pieces for layout themes
assert.match(source, /setAppTheme[\s\S]*renderAll\(/);

console.log('full UX themes layout markers: passed');
