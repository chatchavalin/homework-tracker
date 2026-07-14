import assert from 'node:assert/strict';
import {
  taskDayDiff,
  isUrgentNotifyTask,
  isPendingWithinTwoWeeks,
  buildKidNotifySection,
} from '../api/notify.js';

const today = new Date(Date.UTC(2026, 6, 15)); // 2026-07-15

assert.equal(taskDayDiff({ due_date: '2026-07-15' }, today), 0);
assert.equal(taskDayDiff({ due_date: '2026-07-29' }, today), 14);
assert.equal(taskDayDiff({ due_date: '2026-07-30' }, today), 15);
assert.equal(taskDayDiff({ due_date: null }, today), null);

const tasks = [
  { id: '1', type: 'homework', priority: 'high', due_date: '2026-08-20', parsed_title: 'Far but urgent priority' },
  { id: '2', type: 'homework', priority: 'med', due_date: '2026-07-14', parsed_title: 'Overdue Thai' },
  { id: '3', type: 'homework', priority: 'med', due_date: '2026-07-16', parsed_title: 'Due tomorrow social' },
  { id: '4', type: 'homework', priority: 'low', due_date: '2026-07-25', parsed_title: 'Within 2 weeks' },
  { id: '5', type: 'homework', priority: 'low', due_date: '2026-08-20', parsed_title: 'Too far' },
  { id: '6', type: 'todo', priority: 'med', due_date: null, parsed_title: 'Pack bag' },
];

assert.equal(isUrgentNotifyTask(tasks[0], today, true), true);
assert.equal(isUrgentNotifyTask(tasks[1], today, true), true);
assert.equal(isUrgentNotifyTask(tasks[4], today, true), false);

assert.equal(isPendingWithinTwoWeeks(tasks[3], today), true);
assert.equal(isPendingWithinTwoWeeks(tasks[4], today), false);
assert.equal(isPendingWithinTwoWeeks(tasks[1], today), true);

const section = buildKidNotifySection({
  kidLabel: 'Ryuji 👦',
  tasks,
  today,
  isMorning: true,
});

assert.match(section, /งานด่วน/);
assert.match(section, /Far but urgent priority/);
assert.match(section, /Overdue Thai/);
assert.match(section, /งานค้าง/);
assert.match(section, /Within 2 weeks/);
assert.doesNotMatch(section, /Too far/);
// Due tomorrow still appears in pending window list when not urgent
assert.match(section, /Due tomorrow social/);
// High priority still listed under งานด่วน even when other sections exist
assert.match(section, /⚡ งานด่วน:[\s\S]*Far but urgent priority/);

console.log('telegram notify filters: passed');
