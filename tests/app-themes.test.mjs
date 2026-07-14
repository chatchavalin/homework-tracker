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
${extractFunction('normalizeThemeId')}
${extractFunction('getThemeVars')}
${extractFunction('listThemeIds')}
return { APP_THEMES, normalizeThemeId, getThemeVars, listThemeIds };
`)();

const { APP_THEMES, normalizeThemeId, getThemeVars, listThemeIds } = helpers;

const required = ['default', 'calm', 'dense', 'playful', 'dark', 'hero', 'hermes', 'dbz'];
assert.deepEqual(listThemeIds().sort(), required.slice().sort());
assert.equal(normalizeThemeId(null), 'default');
assert.equal(normalizeThemeId('nope'), 'default');
assert.equal(normalizeThemeId('dbz'), 'dbz');
assert.equal(normalizeThemeId('hermes'), 'hermes');

const def = getThemeVars('default');
assert.equal(def['--primary'], '#16a34a');
assert.equal(def['--navy'], '#166534');

const hermes = getThemeVars('hermes');
assert.ok(hermes['--bg']);
assert.notEqual(hermes['--primary'], def['--primary']);

const dbz = getThemeVars('dbz');
assert.match(dbz['--primary'], /#|rgb|orange|ff/i);
assert.ok(APP_THEMES.dbz.label);

console.log('app themes: passed');
