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

const splitParsedItemsForSave = new Function(
  `${extractFunction('normalizeParsedTag')}\n${extractFunction('splitParsedItemsForSave')}\nreturn splitParsedItemsForSave;`
)();

const items = [
  { record_type: 'task', parsed_tag: 'ต้องทำ', parsed_title: 'Pack sports kit' },
  { record_type: 'task', parsed_tag: 'การบ้าน', parsed_title: 'Math worksheet' },
  { record_type: 'task', parsed_tag: 'exam', parsed_title: 'Science exam' },
  { record_type: 'task', parsed_tag: 'QUIZ', parsed_title: 'English quiz' },
  { record_type: 'event', parsed_tag: 'exam', parsed_title: 'Assembly' },
  { record_type: 'info', parsed_tag: 'quiz', parsed_title: 'Reminder' },
];

const result = splitParsedItemsForSave(items);
assert.deepEqual(result.taskItems.map(item => item.parsed_title), ['Pack sports kit', 'Math worksheet']);
assert.deepEqual(result.examItems.map(item => item.parsed_title), ['Science exam', 'English quiz']);
assert.equal(result.examItems[0].parsed_tag, 'exam');
assert.equal(result.examItems[1].parsed_tag, 'quiz');
console.log('parsed-tag routing: passed');
