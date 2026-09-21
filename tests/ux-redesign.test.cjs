const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const SOURCE = fs.readFileSync('C:/Users/chatc/Git/homework-tracker/index.html', 'utf8');

function extractFunction(name) {
  const start = SOURCE.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must be defined`);
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
    if (ch === '}' && --depth === 0) return SOURCE.slice(start, i + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

function loadFunctions(names, globals = {}) {
  const context = { ...globals };
  vm.createContext(context);
  vm.runInContext(`${names.map(extractFunction).join('\n')}; this.result = { ${names.join(', ')} };`, context);
  return context.result;
}

const fixtures = [
  { id: 'high', kid_id: 'ryuji', parsed_title: 'High priority', priority: 'high', due_date: '2026-09-22', is_done: false, type: 'homework' },
  { id: 'today', kid_id: 'ryuji', parsed_title: 'Today quiz', priority: 'low', due_date: '2026-09-20', is_done: false, type: 'exam' },
  { id: 'later', kid_id: 'ryuji', parsed_title: 'Later', priority: 'med', due_date: '2026-09-24', is_done: false, type: 'homework' },
  { id: 'nodate', kid_id: 'ryuji', parsed_title: 'No date', priority: 'low', due_date: null, is_done: false, type: 'homework' },
  { id: 'miki', kid_id: 'miki', parsed_title: 'Miki task', priority: 'high', due_date: '2026-09-20', is_done: false, type: 'homework' },
  { id: 'done', kid_id: 'ryuji', parsed_title: 'Done', priority: 'high', due_date: '2026-09-20', is_done: true, type: 'homework' },
  { id: 'legacy', kid_id: null, parsed_title: 'Legacy Ryuji', priority: 'low', due_date: '2026-09-23', is_done: false, type: 'homework' },
];

const now = new Date('2026-09-20T09:00:00');

test('priority rank keeps high priority ahead of medium and low', () => {
  const { taskPriorityRank, sortTasksForDisplay } = loadFunctions(['taskPriorityRank', 'sortTasksForDisplay']);
  assert.equal(taskPriorityRank('high'), 0);
  assert.equal(taskPriorityRank('med'), 1);
  assert.equal(taskPriorityRank('low'), 2);
  assert.deepEqual(Array.from(sortTasksForDisplay([fixtures[2], fixtures[0], fixtures[3]], now), t => t.id), ['high', 'later', 'nodate']);
});

test('urgent scope includes open exam tasks and overdue items', () => {
  const { taskMatchesFilter, filterTasksForKid } = loadFunctions(['taskMatchesFilter', 'filterTasksForKid']);
  const ryuji = filterTasksForKid(fixtures, 'ryuji');
  assert.deepEqual(Array.from(ryuji.filter(t => taskMatchesFilter(t, 'urgent', now)), t => t.id), ['high', 'today']);
  assert.equal(taskMatchesFilter(fixtures[5], 'urgent', now), false);
});

test('filter scopes compose open, this-week, no-date, done, and all', () => {
  const { taskMatchesFilter } = loadFunctions(['taskMatchesFilter']);
  assert.deepEqual(fixtures.filter(t => taskMatchesFilter(t, 'open', now)).map(t => t.id), ['high', 'today', 'later', 'nodate', 'miki', 'legacy']);
  assert.deepEqual(fixtures.filter(t => taskMatchesFilter(t, 'week', now)).map(t => t.id), ['high', 'today', 'later', 'miki', 'legacy']);
  assert.deepEqual(fixtures.filter(t => taskMatchesFilter(t, 'undated', now)).map(t => t.id), ['nodate']);
  assert.deepEqual(fixtures.filter(t => taskMatchesFilter(t, 'done', now)).map(t => t.id), ['done']);
  assert.equal(fixtures.filter(t => taskMatchesFilter(t, 'all', now)).length, fixtures.length);
});

test('child scope keeps legacy rows with Ryuji and excludes them for Miki', () => {
  const { filterTasksForKid } = loadFunctions(['filterTasksForKid']);
  assert.deepEqual(filterTasksForKid(fixtures, 'ryuji').map(t => t.id), ['high', 'today', 'later', 'nodate', 'done', 'legacy']);
  assert.deepEqual(filterTasksForKid(fixtures, 'miki').map(t => t.id), ['miki']);
});

test('task cards expose visible accessible completion and edit actions', () => {
  assert.match(SOURCE, /<button[^>]+class="check"[^>]+aria-pressed=/);
  assert.match(SOURCE, /aria-label="[^"]*edit/i);
});

test('exam area uses one compact summary and the existing popup for detail', () => {
  assert.match(SOURCE, /<div id="exam-banner-wrap"><\/div>/);
  assert.match(SOURCE, /class="exam-summary\$\{first\.diff <= 5 \? ' soon' : ''\}"/);
  assert.match(extractFunction('renderExamBanner'), /limitUpcomingAssessments\(allItems\)/);
  assert.match(extractFunction('openAssessmentPopup'), /limitUpcomingAssessments\(getAssessmentPopupItems/);
  assert.match(extractFunction('renderExamBanner'), /openAssessmentPopup\(\)/);
  assert.doesNotMatch(SOURCE, /id="exam-strip-wrap"|function renderExamStrip|class="a-exam-row/);
});

test('near-term assessments are capped at the three nearest within seven days', () => {
  const { limitUpcomingAssessments } = loadFunctions(['limitUpcomingAssessments']);
  const near = [0, 2, 5, 6, 8].map((days) => ({ name: `exam-${days}`, days }));
  assert.deepEqual(limitUpcomingAssessments(near).map(item => item.name), ['exam-0', 'exam-2', 'exam-5']);

  const later = [8, 14, 21, 30].map((days) => ({ name: `exam-${days}`, days }));
  assert.deepEqual(limitUpcomingAssessments(later).map(item => item.name), ['exam-8', 'exam-14', 'exam-21']);
});

test('task filters remain available without the removed focus card shell', () => {
  assert.doesNotMatch(SOURCE, /class="task-toolbar"/);
  assert.doesNotMatch(SOURCE, /id="task-focus-title"/);
  assert.match(SOURCE, /class="filter-row focus-filters"/);
  assert.match(SOURCE, /id="nav-add"/);
});

test('quiet task rows use a three-dot menu for secondary actions', () => {
  const cardSource = SOURCE.slice(SOURCE.indexOf('function taskCardHTML'), SOURCE.indexOf('function closeTaskMenus'));
  assert.match(cardSource, /const cardClass = `task-card quiet-task-row/);
  assert.match(cardSource, /class="task-menu-btn"[^>]+aria-haspopup="menu"/);
  assert.match(cardSource, /class="task-menu"[^>]+role="menu"/);
  assert.doesNotMatch(cardSource, /class="task-edit-btn" onclick=/);
  assert.doesNotMatch(cardSource, /class="task-delete" onclick=/);
  assert.match(SOURCE, /function toggleTaskMenu\(/);
  assert.match(SOURCE, /function taskMenuAction\(/);
  assert.match(SOURCE, /function closeTaskMenus\(/);
});

console.log('homework UX regression tests loaded');
