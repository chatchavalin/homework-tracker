import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const path = new URL('../.github/workflows/notify.yml', import.meta.url);
assert.ok(existsSync(path), 'notify workflow must be staged locally');
const workflow = readFileSync(path, 'utf8');
assert.match(workflow, /cron:\s*'0 22 \* \* \*'/, 'morning summary must run at 05:00 Bangkok (22:00 UTC)');
assert.match(workflow, /cron:\s*'30 13 \* \* \*'/, 'evening plan must run at 20:30 Bangkok (13:30 UTC)');
console.log('Telegram notification schedule: passed');
