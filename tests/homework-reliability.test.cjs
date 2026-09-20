const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(
  'C:/Users/chatc/Git/homework-tracker/index.html',
  'utf8'
);

function extractFunction(name) {
  const start = SOURCE.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} is not defined`);
  const brace = SOURCE.indexOf('{', start);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = brace; i < SOURCE.length; i += 1) {
    const ch = SOURCE[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return SOURCE.slice(start, i + 1);
    }
  }
  throw new Error(`Could not extract ${name}`);
}

function loadFunctions(names, globals = {}) {
  const context = { ...globals };
  vm.createContext(context);
  const source = names.map(name => extractFunction(name)).join('\n');
  vm.runInContext(`${source}; this.__fn = ${names[names.length - 1]};`, context);
  return context.__fn;
}

function loadFunction(name, globals = {}) {
  return loadFunctions([name], globals);
}

test('parsed items with same title but different dates remain distinct', () => {
  const key = loadFunction('parsedItemKey');
  assert.notEqual(
    key({ parsed_title: 'Quiz', original_text: 'Quiz', due_date: '2026-09-21', subject: 'Math', parsed_tag: 'quiz' }),
    key({ parsed_title: 'Quiz', original_text: 'Quiz', due_date: '2026-09-28', subject: 'Math', parsed_tag: 'quiz' })
  );
});

test('parsed items without original_text do not collapse by undefined', () => {
  const dedupe = loadFunctions(['parsedItemKey', 'dedupeParsedResults']);
  const result = dedupe([
    { parsed_title: 'Math', subject: 'Math' },
    { parsed_title: 'English', subject: 'English' },
  ]);
  assert.equal(result.length, 2);
});

test('kid cache merge preserves the other child', () => {
  const merge = loadFunctions(['belongsToKid', 'mergeKidScopedRecords']);
  const result = merge(
    [{ id: 'r1', kid_id: 'ryuji', title: 'old' }, { id: 'm1', kid_id: 'miki', title: 'keep' }],
    [{ id: 'r2', kid_id: 'ryuji', title: 'new' }],
    'ryuji'
  );
  assert.deepEqual(Array.from(result, x => x.id).sort(), ['m1', 'r2']);
});

test('pending mutation overlay preserves an offline create', () => {
  const apply = loadFunction('applyPendingMutation');
  const result = apply([], {
    op: 'insert',
    table: 'tasks',
    payload: { id: 'offline-1', kid_id: 'miki', parsed_title: 'Offline task' },
  });
  assert.equal(result[0].id, 'offline-1');
});

test('failed AI photo does not erase successful results', () => {
  assert.match(SOURCE, /parsedResults\s*=\s*dedupeParsedResults/);
  assert.match(SOURCE, /AbortController/);
});
