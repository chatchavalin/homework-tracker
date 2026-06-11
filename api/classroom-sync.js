// Sync Google Classroom assignments (via secret iCal feed) into Supabase
// Runs on Vercel cron. Imports as Miki's homework, skips duplicates.

const MIKI_ICAL_URL = 'https://calendar.google.com/calendar/ical/22510%40satitpatumwan.ac.th/private-8aeb0bf87df589fcff7515a3a244678f/basic.ics';

export default async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  try {
    // 1. Fetch the iCal feed
    const icsRes = await fetch(MIKI_ICAL_URL);
    if (!icsRes.ok) {
      return res.status(502).json({ error: `iCal fetch failed: HTTP ${icsRes.status}` });
    }
    const ics = await icsRes.text();

    // 2. Parse VEVENTs
    const events = parseICS(ics);

    // DEBUG MODE: ?debug=1 shows what's in the feed
    if (req.query && req.query.debug) {
      const allEvents = parseICSAll(ics);
      return res.status(200).json({
        feedBytes: ics.length,
        totalVEVENTs: (ics.match(/BEGIN:VEVENT/g) || []).length,
        parsedWithDates: events.length,
        sample: allEvents.slice(0, 15).map(e => ({
          summary: e.summary || '(no title)',
          dtstart: e.dtstart || null,
          dtend: e.dtend || null,
          due: e.due ? e.due.toISOString().slice(0,10) : null
        }))
      });
    }

    // 3. Keep only future or recent events (last 7 days onward)
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    const relevant = events.filter(e => e.due && e.due >= cutoff);

    if (!relevant.length) {
      return res.status(200).json({ success: true, imported: 0, message: 'No upcoming assignments' });
    }

    // 4. Fetch existing classroom-imported tasks to avoid duplicates
    const existRes = await fetch(
      `${SUPABASE_URL}/rest/v1/tasks?source=eq.classroom&select=original_text,due_date`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    const existing = await existRes.json();
    const existingKeys = new Set(existing.map(t => `${t.original_text}|${t.due_date}`));

    // 5. Build new tasks
    const newTasks = [];
    for (const ev of relevant) {
      const dueStr = ev.due.toISOString().slice(0, 10);
      const key = `${ev.summary}|${dueStr}`;
      if (existingKeys.has(key)) continue;

      const daysUntil = Math.round((ev.due - new Date()) / 86400000);
      newTasks.push({
        id: 'gc' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        type: 'homework',
        original_text: ev.summary,
        parsed_title: ev.summary.length > 80 ? ev.summary.slice(0, 77) + '...' : ev.summary,
        subject: guessSubject(ev.summary),
        due_date: dueStr,
        points: null,
        priority: daysUntil <= 2 ? 'high' : daysUntil <= 7 ? 'med' : 'low',
        is_done: false,
        source: 'classroom',
        kid_id: 'miki',
        created_at: new Date().toISOString()
      });
    }

    // 6. Insert
    if (newTasks.length) {
      const insRes = await fetch(`${SUPABASE_URL}/rest/v1/tasks`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(newTasks)
      });
      if (!insRes.ok) {
        const errTxt = await insRes.text();
        return res.status(502).json({ error: 'Supabase insert failed: ' + errTxt.slice(0, 200) });
      }
    }

    return res.status(200).json({
      success: true,
      imported: newTasks.length,
      skippedDuplicates: relevant.length - newTasks.length,
      tasks: newTasks.map(t => `${t.parsed_title} (${t.due_date})`)
    });

  } catch (err) {
    console.error('Classroom sync error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// ── Minimal ICS parser ──
function parseICSAll(ics) {
  const events = [];
  const unfolded = ics.replace(/\r?\n[ \t]/g, '');
  const lines = unfolded.split(/\r?\n/);
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { if (cur) events.push(finalize(cur)); cur = null; continue; }
    if (!cur) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const rawKey = line.slice(0, idx);
    const value = line.slice(idx + 1);
    const key = rawKey.split(';')[0];
    if (key === 'SUMMARY') cur.summary = unescapeICS(value);
    if (key === 'DTSTART') cur.dtstart = value;
    if (key === 'DTEND') cur.dtend = value;
    if (key === 'DESCRIPTION') cur.description = unescapeICS(value).slice(0, 300);
    if (key === 'UID') cur.uid = value;
  }
  return events;
}

function parseICS(ics) {
  return parseICSAll(ics).filter(e => e.summary && e.due);
}

function finalize(ev) {
  // Classroom due dates are usually DTEND (all-day, exclusive) or DTSTART
  const raw = ev.dtend || ev.dtstart || '';
  ev.due = parseICSDate(raw, !!ev.dtend);
  return ev;
}

function parseICSDate(v, isEnd) {
  if (!v) return null;
  // All-day: YYYYMMDD — DTEND is exclusive, so subtract 1 day
  const m1 = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m1) {
    const d = new Date(Date.UTC(+m1[1], +m1[2] - 1, +m1[3]));
    if (isEnd) d.setUTCDate(d.getUTCDate() - 1);
    return d;
  }
  // Timestamp: YYYYMMDDTHHMMSS(Z)
  const m2 = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  if (m2) return new Date(Date.UTC(+m2[1], +m2[2] - 1, +m2[3], +m2[4], +m2[5], +m2[6]));
  return null;
}

function unescapeICS(s) {
  return s.replace(/\\n/g, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\').trim();
}

function guessSubject(title) {
  const t = title.toLowerCase();
  if (/math|คณิต|เลข/.test(t)) return 'Math';
  if (/thai|ไทย/.test(t)) return 'Thai';
  if (/english|eng|อังกฤษ/.test(t)) return 'English';
  if (/science|วิทย|sci/.test(t)) return 'Science';
  if (/social|สังคม|history|ประวัติ/.test(t)) return 'Social';
  if (/chinese|จีน/.test(t)) return 'Chinese';
  if (/pe |พละ|sport|กีฬา/.test(t)) return 'PE';
  return 'Other';
}
