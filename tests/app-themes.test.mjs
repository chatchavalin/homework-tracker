import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

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

function extractConstObject(name) {
  const start = source.indexOf(`const ${name} = {`);
  assert.notEqual(start, -1, `${name} must be defined`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index++) {
    if (source[index] === '{') depth++;
    if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

const helpers = new Function(`
${extractConstObject('APP_THEMES')}
const AVAILABLE_THEME_IDS = ['default', 'calm'];
${extractFunction('normalizeThemeId')}
${extractFunction('getThemeVars')}
${extractFunction('listThemeIds')}
return { APP_THEMES, normalizeThemeId, getThemeVars, listThemeIds };
`)();

const { APP_THEMES, normalizeThemeId, getThemeVars, listThemeIds } = helpers;

const required = ['default', 'calm'];
assert.deepEqual(listThemeIds().sort(), required.slice().sort());
assert.equal(normalizeThemeId(null), 'default');
assert.equal(normalizeThemeId('nope'), 'default');
assert.equal(normalizeThemeId('dbz'), 'default');
assert.equal(normalizeThemeId('hermes'), 'default');

const def = getThemeVars('default');
assert.equal(def['--primary'], '#16a34a');
assert.equal(def['--navy'], '#166534');

const calm = getThemeVars('calm');
assert.ok(calm['--bg']);
assert.notEqual(calm['--primary'], def['--primary']);

console.log('app themes: passed');
