function getBangkokCalendar(now = new Date()) {
  const bangkok = new Date(now.getTime() + 7 * 3600 * 1000);
  return {
    year: bangkok.getUTCFullYear(),
    month: bangkok.getUTCMonth(),
    day: bangkok.getUTCDate(),
    dow: bangkok.getUTCDay(),
  };
}

function taskDayDiff(task, today) {
  if (!task || !task.due_date) return null;
  const d = new Date(String(task.due_date) + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return null;
  const diff = Math.round((d - today) / 86400000);
  return Object.is(diff, -0) ? 0 : diff;
}

// งานด่วน: high priority, overdue, due today, or (evening) due tomorrow
function isUrgentNotifyTask(task, today, isMorning) {
  if (!task || task.is_done) return false;
  if (task.priority === 'high') return true;
  const diff = taskDayDiff(task, today);
  if (diff === null) return false;
  if (diff < 0) return true;                 // overdue
  if (diff === 0) return true;               // due today
  if (!isMorning && diff === 1) return true; // evening plan includes tomorrow
  return false;
}

// งานค้าง within two weeks ahead (and overdue still counts as pending window)
function isPendingWithinTwoWeeks(task, today) {
  if (!task || task.is_done) return false;
  if (task.type !== 'homework' && task.type !== 'todo') return false;
  const diff = taskDayDiff(task, today);
  if (diff === null) return false; // undated listed separately as ต้องทำ
  return diff <= 14;
}

function buildKidNotifySection({ kidLabel, tasks, today, isMorning }) {
  const kt = Array.isArray(tasks) ? tasks.filter(t => !t.is_done) : [];
  if (!kt.length) return `\n\n${kidLabel}: ✅ ไม่มีงานค้าง`;

  const urgent = kt.filter(t => isUrgentNotifyTask(t, today, isMorning));
  const dueSoonHw = kt.filter(t => {
    if (t.type !== 'homework' || !t.due_date) return false;
    const diff = taskDayDiff(t, today);
    if (diff === null) return false;
    return isMorning ? diff === 0 : diff <= 1;
  });
  const pendingWindow = kt.filter(t => isPendingWithinTwoWeeks(t, today));
  // งานค้าง list: homework in 2-week window that is not already in ด่วน (avoid dup noise)
  const pendingHw = pendingWindow
    .filter(t => t.type === 'homework')
    .filter(t => !urgent.some(u => u === t || (u.id && t.id && u.id === t.id)));
  const todos = kt.filter(t => t.type === 'todo').slice(0, 5);

  const countLabel = pendingWindow.length;
  let s = `\n\n*${kidLabel}* — ค้าง ${countLabel} ชิ้น (ใน 2 สัปดาห์)`;

  // Always show งานด่วน when present (not else-if)
  if (urgent.length) {
    s += `\n⚡ งานด่วน:`;
    urgent.slice(0, 6).forEach(t => { s += `\n  • ${t.parsed_title || t.original_text}`; });
  }

  if (dueSoonHw.length) {
    s += isMorning ? `\n🔴 ต้องส่งวันนี้:` : `\n🔴 ต้องส่งพรุ่งนี้:`;
    dueSoonHw.slice(0, 5).forEach(t => { s += `\n  • ${t.parsed_title || t.original_text}`; });
  }

  if (pendingHw.length) {
    s += `\n📌 งานค้าง (≤14 วัน):`;
    pendingHw.slice(0, 8).forEach(t => {
      const diff = taskDayDiff(t, today);
      const when = diff === null ? '' : diff < 0 ? ` (เกิน ${Math.abs(diff)} วัน)` : diff === 0 ? ' (วันนี้)' : ` (อีก ${diff} วัน)`;
      s += `\n  • ${t.parsed_title || t.original_text}${when}`;
    });
  }

  if (todos.length) {
    s += `\n📋 ต้องทำ:`;
    todos.forEach(t => { s += `\n  • ${t.parsed_title || t.original_text}`; });
  }

  if (!urgent.length && !dueSoonHw.length && !pendingHw.length && !todos.length) {
    s += `\n✅ ไม่มีงานใน 2 สัปดาห์นี้`;
  }
  return s;
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
      return buildKidNotifySection({
        kidLabel: kidName[kidId],
        tasks: byKid[kidId],
        today,
        isMorning,
      });
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

export {
  getBangkokCalendar,
  taskDayDiff,
  isUrgentNotifyTask,
  isPendingWithinTwoWeeks,
  buildKidNotifySection,
};
