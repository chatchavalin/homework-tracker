// Weekly reset for recurring tasks.
// Run once a week (Monday early AM Bangkok) via GitHub Actions.
// For every task with repeat='weekly': flip is_done back to false so it reappears,
// and (if a weekday is set) advance due_date to that weekday's next occurrence.
// Optional protection: if CRON_SECRET is set in env, the caller must pass ?key=<CRON_SECRET>.

export default async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
  const CRON_SECRET  = process.env.CRON_SECRET || '';

  if (CRON_SECRET) {
    const key = (req.query && req.query.key) ? String(req.query.key) : '';
    if (key !== CRON_SECRET) {
      return res.status(200).json({ ok: false, reason: 'bad key' });
    }
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(200).json({ ok: false, reason: 'missing supabase env' });
  }

  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  };

  // Bangkok "today" for due-date math.
  const bkk = new Date(Date.now() + 7 * 3600 * 1000);
  const todayDow = bkk.getUTCDay();                 // 0..6 in Bangkok
  const todayMs  = Date.UTC(bkk.getUTCFullYear(), bkk.getUTCMonth(), bkk.getUTCDate());

  // Next date (YYYY-MM-DD) on/after Bangkok-today matching the target weekday.
  const nextDow = (dow) => {
    const delta = ((dow - todayDow) % 7 + 7) % 7;   // 0..6
    const d = new Date(todayMs + delta * 86400000);
    return d.toISOString().slice(0, 10);
  };

  try {
    // Pull all weekly recurring tasks.
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/tasks?repeat=eq.weekly&select=id,repeat_dow`,
      { headers }
    );
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      return res.status(200).json({ ok: false, reason: 'fetch failed', detail: txt.slice(0, 200) });
    }
    const tasks = await r.json();

    let reset = 0;
    const errors = [];
    for (const t of tasks) {
      const patch = { is_done: false };
      if (Number.isInteger(t.repeat_dow)) patch.due_date = nextDow(t.repeat_dow);
      const pr = await fetch(
        `${SUPABASE_URL}/rest/v1/tasks?id=eq.${encodeURIComponent(t.id)}`,
        { method: 'PATCH', headers: { ...headers, 'Prefer': 'return=minimal' }, body: JSON.stringify(patch) }
      );
      if (pr.ok) reset++;
      else errors.push(await pr.text().catch(() => 'err'));
    }

    return res.status(200).json({ ok: true, weekly: tasks.length, reset, errors: errors.slice(0, 3) });
  } catch (err) {
    console.error('reset-weekly error:', err);
    return res.status(200).json({ ok: false, error: String(err && err.message || err) });
  }
}
