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

const getAssessmentPopupItems = new Function(
  `${extractFunction('getAssessmentPopupItems')}\nreturn getAssessmentPopupItems;`
)();

const items = getAssessmentPopupItems(
  [
    { id: 'exam-1', name: 'Science exam', exam_date: '2026-07-21' },
    { id: 'quiz-1', name: 'English quiz', exam_date: '2026-07-16' },
    { id: 'old', name: 'Past exam', exam_date: '2026-07-10' },
  ],
  [
    { id: 'legacy-exam', type: 'exam', is_done: false, parsed_title: 'Math quiz', due_date: '2026-07-20' },
    { id: 'done-exam', type: 'exam', is_done: true, parsed_title: 'Done exam', due_date: '2026-07-18' },
    { id: 'homework', type: 'homework', is_done: false, parsed_title: 'Worksheet', due_date: '2026-07-18' },
  ],
  '2026-07-14'
);

assert.deepEqual(items.map(item => item.name), ['English quiz', 'Math quiz', 'Science exam']);
assert.deepEqual(items.map(item => item.days), [2, 6, 7]);
assert.deepEqual(items.map(item => item.source), ['exam', 'task', 'exam']);
console.log('assessment popup items: passed');
