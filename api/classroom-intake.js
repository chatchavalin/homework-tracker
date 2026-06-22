// Intake endpoint for Google Classroom assignments (GET, so a scheduled job can call it).
// Adds a homework task for a kid, de-duplicated by the source Gmail message id.
// Protected by CLASSROOM_INTAKE_SECRET (if set): caller must pass ?key=<secret>.
// Example:
//   /api/classroom-intake?key=SECRET&kid=miki&title=Vocab%20Test&due=2026-06-24&subject=English&src=<gmailMsgId>

import { randomUUID } from 'node:crypto';

export default async function handler(req, res) {
  const url    = process.env.SUPABASE_URL;
  const key    = process.env.SUPABASE_ANON_KEY;
  const SECRET = process.env.CLASSROOM_INTAKE_SECRET || '';

  const q = req.query || {};
  if (SECRET && String(q.key || '') !== SECRET) {
    return res.status(200).json({ ok: false, reason: 'bad key' });
  }
  if (!url || !key) {
    return res.status(200).json({ ok: false, reason: 'missing supabase env' });
  }

  const kid   = q.kid === 'ryuji' ? 'ryuji' : q.kid === 'miki' ? 'miki' : null;
  const title = (q.title || '').toString().trim();
  if (!kid || !title) {
    return res.status(200).json({ ok: false, reason: 'need kid + title' });
  }
  const due     = /^\d{4}-\d{2}-\d{2}$/.test(q.due || '') ? q.due : null;
  const subject = (q.subject || '').toString().trim().slice(0, 80) || null;
  const src     = (q.src || '').toString().trim().slice(0, 120);

  const headers = { apikey: key, Authorization: `Bearer ${key}` };

  try {
    // De-dup: by source Gmail id if given, else by kid + exact title.
    const dupUrl = src
      ? `${url}/rest/v1/tasks?select=id&original_text=ilike.*${encodeURIComponent(src)}*`
      : `${url}/rest/v1/tasks?select=id&kid_id=eq.${kid}&parsed_title=eq.${encodeURIComponent(title)}`;
    const d = await fetch(dupUrl, { headers });
    if (d.ok) {
      const existing = await d.json();
      if (existing.length) {
        return res.status(200).json({ ok: true, skipped: 'duplicate', count: existing.length });
      }
    }

    const row = {
      id: randomUUID(),
      kid_id: kid,
      type: 'homework',
      parsed_title: title,
      original_text: (src ? `[Classroom:${src}] ` : '[Classroom] ') + title,
      subject,
      due_date: due,
      priority: 'med',
      record_type: 'task',
      is_done: false,
      created_at: new Date().toISOString(),
    };

    let r = await fetch(`${url}/rest/v1/tasks`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(row),
    });
    if (!r.ok) {
      const t2 = { ...row }; delete t2.record_type;
      r = await fetch(`${url}/rest/v1/tasks`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify(t2),
      });
    }
    if (!r.ok) {
      return res.status(200).json({ ok: false, reason: 'insert failed', detail: (await r.text()).slice(0, 160) });
    }
    return res.status(200).json({ ok: true, added: { kid, title, due, subject } });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e && e.message || e) });
  }
}
