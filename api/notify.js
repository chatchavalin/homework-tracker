function getBangkokCalendar(now = new Date()) {
  const bangkok = new Date(now.getTime() + 7 * 3600 * 1000);
  return {
    year: bangkok.getUTCFullYear(),
    month: bangkok.getUTCMonth(),
    day: bangkok.getUTCDate(),
    dow: bangkok.getUTCDay(),
  };
}

export default async function handler(req, res) {
  const SUPABASE_URL  = process.env.SUPABASE_URL;
  const SUPABASE_KEY  = process.env.SUPABASE_ANON_KEY;
  const BOT_TOKEN     = process.env.TELEGRAM_BOT_TOKEN;
  const CHAT_DAD      = process.env.TELEGRAM_CHAT_DAD;
  const CHAT_MUM      = process.env.TELEGRAM_CHAT_MUM;

  const envState = { supabaseUrl: !!SUPABASE_URL, supabaseKey: !!SUPABASE_KEY, bot: !!BOT_TOKEN, dad: !!CHAT_DAD, mum: !!CHAT_MUM };
  if (!SUPABASE_URL || !SUPABASE_KEY || !BOT_TOKEN) {
    return res.status(200).json({ skipped: true, reason: 'missing env vars', env: envState });
  }

  try {
    // ── Weekly recurring reset ──────────────────────────────────────────────
    // On Monday morning (Bangkok), un-complete every repeat='weekly' task so it
    // reappears for the new week, and advance its due_date to this week's weekday.
    // Piggybacks on the existing morning cron (no extra workflow/cron needed).
    try {
      const bkkNow = getBangkokCalendar();
      const bkkDow = bkkNow.dow;                                 // 0=Sun..6=Sat (Bangkok)
      const mp0 = (req.query && req.query.mode) ? String(req.query.mode) : '';
      const morning0 = mp0 === 'morning' ? true
                     : mp0 === 'evening' ? false
                     : (new Date().getUTCHours() === 22);
      if (bkkDow === 1 && morning0) {                            // Monday morning
        const wr = await fetch(
          `${SUPABASE_URL}/rest/v1/tasks?repeat=eq.weekly&select=id,repeat_dow`,
          { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
        );
        if (wr.ok) {
          const wk = await wr.json();
          const t0 = Date.UTC(bkkNow.year, bkkNow.month, bkkNow.day);
          for (const t of wk) {
            const patch = { is_done: false };
            if (Number.isInteger(t.repeat_dow)) {
              const delta = ((t.repeat_dow - bkkDow) % 7 + 7) % 7;
              patch.due_date = new Date(t0 + delta * 86400000).toISOString().slice(0, 10);
            }
            await fetch(
              `${SUPABASE_URL}/rest/v1/tasks?id=eq.${encodeURIComponent(t.id)}`,
              { method: 'PATCH', headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(patch) }
            );
          }
        }
      }
    } catch (e) { /* reset is non-fatal; continue to the summary */ }

    // Fetch incomplete tasks from Supabase
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/tasks?is_done=eq.false&select=*&order=created_at.desc`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }}
    );
    const tasks = await r.json();

    // Fetch exams for countdown
    const re = await fetch(
      `${SUPABASE_URL}/rest/v1/exams?select=*&order=exam_date.asc`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }}
    );
    const exams = await re.json();

    const now      = new Date();
    const utcHour   = now.getUTCHours();
    const bkkNow    = getBangkokCalendar(now);
    const today     = new Date(Date.UTC(bkkNow.year, bkkNow.month, bkkNow.day)); // Bangkok midnight for task/exam dates
    // 22:30 UTC = 05:30 Bangkok (morning), 14:00 UTC = 21:00 Bangkok (evening)
    // Explicit override via ?mode=morning|evening (used by GitHub Actions cron, immune to scheduling delay)
  const modeParam = (req.query && req.query.mode) ? String(req.query.mode) : '';
  const isMorning = modeParam === 'morning' ? true
                  : modeParam === 'evening' ? false
                  : utcHour === 22;

    // Morning shows TODAY, evening shows TOMORROW
    const target   = new Date(today);
    if (!isMorning) target.setUTCDate(target.getUTCDate() + 1);
    const buddYear = target.getUTCFullYear() + 543;
    const dateStr  = `${target.getUTCDate()}/${target.getUTCMonth()+1}/${buddYear}`;
    const tDow     = target.getUTCDay();
    const DOW_TH   = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัส','ศุกร์','เสาร์'];

    // Uniform reminders
    let uniformMsg = '';
    const dayLabel = isMorning ? 'วันนี้' : 'พรุ่งนี้';
    if (tDow === 4) uniformMsg = `\n👘 ${dayLabel}ใส่ชุดลูกเสือ!`;
    if (tDow === 5) uniformMsg = `\n⚽ ${dayLabel}ใส่ชุดพลศึกษา!`;
    if (tDow === 1) uniformMsg = `\n👔 ${dayLabel}นำผ้ากันเปื้อนมาด้วย!`;

    // Split tasks per kid (legacy tasks without kid_id = Ryuji)
    const kidName = { ryuji: 'Ryuji 👦', miki: 'Miki 👧' };
    const byKid = {
      ryuji: tasks.filter(t => !t.kid_id || t.kid_id === 'ryuji'),
      miki:  tasks.filter(t => t.kid_id === 'miki'),
    };

    function kidSection(kidId) {
      const kt = byKid[kidId];
      if (!kt.length) return `\n\n${kidName[kidId]}: ✅ ไม่มีงานค้าง`;
      // due tomorrow (this runs at 9PM, so warn about tomorrow)
      const t0 = today;
      const tmrHw = kt.filter(t => {
        if (!t.due_date || t.type !== 'homework') return false;
        const d = new Date(t.due_date + 'T00:00:00');
        const diff = Math.round((d - t0) / 86400000);
        return isMorning ? diff === 0 : diff <= 1; // morning=today, evening=tomorrow+overdue
      });
      const urgent = kt.filter(t => t.type === 'homework' && t.priority === 'high');
      const todos  = kt.filter(t => t.type === 'todo').slice(0, 3);
      let s = `\n\n*${kidName[kidId]}* — ค้าง ${kt.length} ชิ้น`;
      if (tmrHw.length) {
        s += `\n🔴 ต้องส่งพรุ่งนี้:`;
        tmrHw.slice(0,5).forEach(t => { s += `\n  • ${t.parsed_title || t.original_text}`; });
      } else if (urgent.length) {
        s += `\n⚡ งานด่วน:`;
        urgent.slice(0,4).forEach(t => { s += `\n  • ${t.parsed_title || t.original_text}`; });
      }
      if (todos.length) {
        s += `\n📋 ต้องทำ:`;
        todos.forEach(t => { s += `\n  • ${t.parsed_title || t.original_text}`; });
      }
      return s;
    }

    // Exam countdown
    let examMsg = '';
    const upcoming = exams
      .filter(e => e.exam_date)
      .map(e => {
        const d = new Date(e.exam_date + 'T00:00:00');
        const diff = Math.round((d - today) / 86400000);
        return { ...e, diff };
      })
      .filter(e => e.diff >= 0)
      .sort((a,b) => a.diff - b.diff)[0];
    if (upcoming) {
      examMsg = `\n\n🎯 *${upcoming.name}* — อีก ${upcoming.diff} วัน!`;
    }

    // Compose message
    const greeting = isMorning ? '🌅 *สวัสดีตอนเช้า — สรุปการบ้านวันนี้*' : '🌙 *แผนสำหรับพรุ่งนี้*';
    let msg = `${greeting}\n`;
    msg += `วัน${DOW_TH[tDow]} ${dateStr}`;
    msg += uniformMsg;

    msg += kidSection('ryuji');
    msg += kidSection('miki');
    msg += examMsg;

    // Send to both parents via Telegram
    const chats = [CHAT_DAD, CHAT_MUM].filter(Boolean);
    const results = await Promise.all(chats.map(chatId =>
      fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: msg,
          parse_mode: 'Markdown'
        })
      }).then(r => r.json())
    ));

    return res.status(200).json({ success: true, sent: chats.length, results });

  } catch (err) {
    console.error('Notify error:', err);
    return res.status(200).json({ ok: false, error: String(err && err.message || err) });
  }
}
