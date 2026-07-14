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

const getAssessmentEditTarget = new Function(
  `${extractFunction('getAssessmentEditTarget')}\nreturn getAssessmentEditTarget;`
)();

assert.deepEqual(getAssessmentEditTarget({ id: 'exam-1', source: 'exam' }), { record: 'exam', id: 'exam-1' });
assert.deepEqual(getAssessmentEditTarget({ id: 'task-1', source: 'task' }), { record: 'task', id: 'task-1' });
console.log('assessment popup edit routing: passed');
