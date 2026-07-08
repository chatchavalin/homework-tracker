// Intake endpoint for calendar-sourced exams (GET, so a scheduled job can call it).
// Adds/updates an exam card for a kid, de-duplicated + kept in sync by the Google Calendar event id.
// Protected by CLASSROOM_INTAKE_SECRET (if set): caller must pass ?key=<secret>.
// Example:
// /api/exam-intake?key=SECRET&kid=ryuji&name=Final%20Exam%20Math&date=2026-09-21&event_id=<calEventId>

import { randomUUID } from 'node:crypto';

export default async function handler(req, res) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  const SECRET = process.env.CLASSROOM_INTAKE_SECRET || '';

  const q = req.query || {};
  if (SECRET && String(q.key || '') !== SECRET) {
    return res.status(200).json({ ok: false, reason: 'bad key' });
  }
  if (!url || !key) {
    return res.status(200).json({ ok: false, reason: 'missing supabase env' });
  }

  const kid = q.kid === 'ryuji' ? 'ryuji' : q.kid === 'miki' ? 'miki' : null;
  const name = (q.name || '').toString().trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(q.date || '') ? q.date : null;
  const eventId = (q.event_id || '').toString().trim().slice(0, 200);

  if (!kid || !name || !date || !eventId) {
    return res.status(200).json({ ok: false, reason: 'need kid + name + date + event_id' });
  }

  const headers = { apikey: key, Authorization: `Bearer ${key}` };

  try {
    // Look up by calendar event id — this is what lets us update the card if the
    // date or title changes later on the calendar, instead of only inserting once.
    const lookupUrl = `${url}/rest/v1/exams?select=id,name,exam_date&cal_event_id=eq.${encodeURIComponent(eventId)}`;
    const d = await fetch(lookupUrl, { headers });
    const existing = d.ok ? await d.json() : [];

    if (existing.length) {
      const row = existing[0];
      if (row.name === name && row.exam_date === date) {
        return res.status(200).json({ ok: true, skipped: 'up-to-date' });
      }
      const r = await fetch(`${url}/rest/v1/exams?id=eq.${row.id}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ name, exam_date: date }),
      });
      if (!r.ok) {
        return res.status(200).json({ ok: false, reason: 'update failed', detail: (await r.text()).slice(0, 160) });
      }
      return res.status(200).json({ ok: true, updated: { kid, name, date } });
    }

    const row = {
      id: randomUUID(),
      kid_id: kid,
      name,
      exam_date: date,
      cal_event_id: eventId,
      created_at: new Date().toISOString(),
    };
    const r = await fetch(`${url}/rest/v1/exams`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(row),
    });
    if (!r.ok) {
      return res.status(200).json({ ok: false, reason: 'insert failed', detail: (await r.text()).slice(0, 160) });
    }
    return res.status(200).json({ ok: true, added: { kid, name, date } });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e && e.message || e) });
  }
}
