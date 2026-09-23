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

test('notes expose separate edit/delete controls and persist edits', () => {
  const notesSource = extractFunction('renderNotes');
  const saveSource = extractFunction('saveNoteEdit');
  assert.match(notesSource, /class="note-actions"/);
  assert.match(notesSource, /class="task-edit"/);
  assert.match(notesSource, /class="task-delete"/);
  assert.match(saveSource, /ht_notes/);
  assert.match(saveSource, /parsed_title: text/);
  assert.match(saveSource, /original_text: text/);
});


test('task completion and deletion require confirmation', () => {
  const toggleSource = SOURCE.slice(SOURCE.indexOf('async function toggleTask'), SOURCE.indexOf('async function toggleTaskConfirmed'));
  assert.match(toggleSource, /askConfirm\(/);
  assert.match(toggleSource, /Mark this task as done/);
  const deleteSource = SOURCE.slice(SOURCE.indexOf('function confirmDeleteTask'), SOURCE.indexOf('function handleAttach'));
  assert.match(deleteSource, /askConfirm\(/);
  assert.match(deleteSource, /Delete this task/);
});

test('task swipe keeps completion only and has no delete gesture', () => {
  const cardSource = SOURCE.slice(SOURCE.indexOf('function taskCardHTML'), SOURCE.indexOf('function closeTaskMenus'));
  const swipeSource = SOURCE.slice(SOURCE.indexOf('SWIPE TO COMPLETE'), SOURCE.indexOf('UNDO DELETE'));
  assert.doesNotMatch(cardSource, /swipe-hint left/);
  assert.doesNotMatch(swipeSource, /swipe-hint\.left|lHint|swipe-to-delete/);
  assert.match(swipeSource, /if \(dx > 55\) \{ toggleTask\(taskId\)/);
});

test('exam area uses one compact summary and the existing popup for detail', () => {
  assert.match(SOURCE, /<div id="exam-banner-wrap"><\/div>/);
  assert.match(SOURCE, /class="exam-summary\$\{hasNearTerm \? ' soon' : ''\}"/);
  assert.match(SOURCE, /class="exam-summary-line"/);
  assert.match(SOURCE, /class="exam-summary-relative"/);
  assert.match(extractFunction('renderExamBanner'), /อีก \$\{current\.diff\} วัน/);
  assert.match(extractFunction('renderExamBanner'), /limitUpcomingAssessments\(allItems\)/);
  assert.match(extractFunction('renderExamBanner'), /setInterval\(/);
  assert.match(extractFunction('renderExamBanner'), /2500/);
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
  assert.match(cardSource, /const sourcePhotoHTML = t\.image_url/);
  assert.match(cardSource, /class="task-clip"/);
  assert.match(cardSource, /const duplicateLabel = currentLang === 'en'/);
  assert.match(cardSource, /taskMenuAction\(event,'\$\{t\.id\}','duplicate'\)/);
  assert.match(cardSource, /taskMenuAction\(event,'\$\{t\.id\}','attach'\)/);
  assert.doesNotMatch(cardSource, /class="task-edit-btn" onclick=/);
  assert.doesNotMatch(cardSource, /class="task-delete" onclick=/);
  assert.match(SOURCE, /\.task-row-actions\.is-open\{position:relative;z-index:190\}/);
  assert.match(SOURCE, /function toggleTaskMenu\(/);
  assert.match(SOURCE, /function taskMenuAction\(/);
  const actionSource = extractFunction('taskMenuAction');
  assert.match(actionSource, /currentTarget.*closest.*task-menu/);
  assert.match(actionSource, /clickedMenu\.style\.visibility = 'hidden'/);
  assert.match(SOURCE, /function closeTaskMenus\(/);
  const menuSource = SOURCE.slice(SOURCE.indexOf('function toggleTaskMenu'), SOURCE.indexOf('function taskMenuAction'));
  assert.match(menuSource, /if \(wasOpen\) \{ closeTaskMenu\(actions\); return; \}/);
  assert.doesNotMatch(menuSource, /closeTaskMenus\(\);/);
});

test('quiet task rows keep the title, exam badge, and due label on one line', () => {
  const quietStyles = SOURCE.slice(SOURCE.indexOf('/* Quiet list:'), SOURCE.indexOf('</style>', SOURCE.indexOf('/* Quiet list:')));
  assert.match(quietStyles, /\.quiet-task-row \.task-body\{display:flex/);
  assert.match(quietStyles, /\.quiet-task-row \.task-title\{[^}]*white-space:nowrap/);
  assert.match(quietStyles, /\.quiet-task-row \.task-meta\{[^}]*flex-wrap:nowrap/);
  assert.match(SOURCE, /class="type-chip chip-exam">📅 \$\{L\.examType/);
});

test('CUDSS homework gets a source tag from the OnSmart URL', () => {
  const { isCudssHomework } = loadFunctions(['isCudssHomework']);
  assert.equal(isCudssHomework({ original_text: 'https://cud.onsmart.school/lesson/123' }), true);
  assert.equal(isCudssHomework({ source_url: 'https://www.cud.onsmart.school/' }), true);
  assert.equal(isCudssHomework({ original_text: 'https://not-cud.onsmart.school.example/' }), false);
  assert.equal(isCudssHomework({ parsed_title: 'Math homework' }), false);
  const cardSource = SOURCE.slice(SOURCE.indexOf('function taskCardHTML'), SOURCE.indexOf('function closeTaskMenus'));
  assert.match(cardSource, /const cudssChip = isCudssHomework\(t\)/);
  assert.match(cardSource, /chip-cudss/);
});

test('composite scan schedules split into separate dated items and retain source image', () => {
  const { splitCompositeParsedItems } = loadFunctions(['inferCompositeDueDate', 'splitCompositeParsedItems']);
  const source = 'source-image-b64';
  const result = splitCompositeParsedItems([{
    record_type: 'task',
    parsed_title: 'Tue. 22 Sep 13:10-14:00 Math | Fri 25 Sep 11.20-12:10 Social | Mon 29 Sep 09:00-10:00 Thai',
    original_text: 'Tue. 22 Sep 13:10-14:00 Math | Fri 25 Sep 11.20-12:10 Social | Mon 29 Sep 09:00-10:00 Thai',
    due_date: '2026-09-22',
    _srcB64: source,
  }]);
  assert.deepEqual(result.map(item => item.parsed_title), [
    'Tue. 22 Sep 13:10-14:00 Math',
    'Fri 25 Sep 11.20-12:10 Social',
    'Mon 29 Sep 09:00-10:00 Thai',
  ]);
  assert.deepEqual(result.map(item => item.due_date), ['2026-09-22', '2026-09-25', '2026-09-29']);
  assert.ok(result.every(item => item._srcB64 === source));
  assert.equal(splitCompositeParsedItems([{ record_type: 'task', parsed_title: 'Parent | indented detail' }]).length, 1);
  assert.equal(splitCompositeParsedItems([{ record_type: 'task', parsed_title: 'Schedule', original_text: 'Tue 22 Sep 13:10-14:00 Math | Fri 25 Sep 11:20-12:10 Social' }]).length, 2);
  assert.match(SOURCE, /const photoUrlFor = r => \{/);
  assert.match(SOURCE, /image_url: photoUrlFor\(t\)/);
  assert.match(SOURCE, /const sourcePhotoHTML = t\.image_url/);
  assert.match(SOURCE, /openPhoto\('\$\{t\.image_url\}'\)/);
});

test('quiet homework rows stay in one vertical list on wide screens', () => {
  const quietStyles = SOURCE.slice(SOURCE.indexOf('/* Quiet list:'), SOURCE.indexOf('</style>', SOURCE.indexOf('/* Quiet list:')));
  assert.match(quietStyles, /#hw-list\{display:block\}/);
});

console.log('homework UX regression tests loaded');
