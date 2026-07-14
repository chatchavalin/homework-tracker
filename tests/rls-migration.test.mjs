import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../migration_rls_family_app.sql', import.meta.url), 'utf8');

for (const table of ['tasks', 'exams', 'exam_topics', 'pending_intake']) {
  assert.match(sql, new RegExp(`public\\.${table}`), `must cover ${table}`);
}
assert.match(sql, /ENABLE ROW LEVEL SECURITY/i);
assert.match(sql, /FORCE ROW LEVEL SECURITY/i);
assert.match(sql, /TO anon/);
assert.match(sql, /TO authenticated/);
assert.match(sql, /ht_family_anon_all/);
assert.match(sql, /USING \(true\) WITH CHECK \(true\)/);
console.log('rls migration coverage: passed');
