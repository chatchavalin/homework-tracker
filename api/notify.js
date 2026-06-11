export default async function handler(req, res) {
  const SUPABASE_URL  = process.env.SUPABASE_URL;
  const SUPABASE_KEY  = process.env.SUPABASE_ANON_KEY;
  const BOT_TOKEN     = process.env.TELEGRAM_BOT_TOKEN;
  const CHAT_DAD      = process.env.TELEGRAM_CHAT_DAD;
  const CHAT_MUM      = process.env.TELEGRAM_CHAT_MUM;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }
  if (!BOT_TOKEN) {
    return res.status(500).json({ error: 'Telegram bot not configured' });
  }

  try {
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

    // Build date string (Thai Buddhist year)
    const today    = new Date();
    const dow      = today.getDay();
    const DOW_EN   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const MON_EN   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const dateStr  = `${DOW_EN[dow]} ${today.getDate()} ${MON_EN[today.getMonth()]} ${today.getFullYear()}`;

    // Uniform reminders
    let uniformMsg = '';
    if (dow === 4) uniformMsg = '\n👘 Tomorrow is Scout uniform day!';
    if (dow === 5) uniformMsg = '\n⚽ Tomorrow is PE uniform day!';
    if (dow === 3) uniformMsg = '\n👔 Bring apron tomorrow!';

    // Split tasks per kid (legacy tasks without kid_id = Ryuji)
    const kidName = { ryuji: 'Ryuji 👦', miki: 'Miki 👧' };
    const byKid = {
      ryuji: tasks.filter(t => !t.kid_id || t.kid_id === 'ryuji'),
      miki:  tasks.filter(t => t.kid_id === 'miki'),
    };

    function kidSection(kidId) {
      const kt = byKid[kidId];
      if (!kt.length) return `\n\n${kidName[kidId]}: ✅ All done!`;
      // due tomorrow (this runs at 9PM, so warn about tomorrow)
      const tmrHw = kt.filter(t => {
        if (!t.due_date || t.type !== 'homework') return false;
        const d = new Date(t.due_date + 'T00:00:00');
        const diff = Math.round((d - today) / 86400000);
        return diff <= 1 && diff >= 0;
      });
      const urgent = kt.filter(t => t.type === 'homework' && t.priority === 'high');
      const todos  = kt.filter(t => t.type === 'todo').slice(0, 3);
      let s = `\n\n*${kidName[kidId]}* — ${kt.length} pending`;
      if (tmrHw.length) {
        s += `\n🔴 Due today/tomorrow:`;
        tmrHw.slice(0,5).forEach(t => { s += `\n  • ${t.parsed_title || t.original_text}`; });
      } else if (urgent.length) {
        s += `\n⚡ Urgent:`;
        urgent.slice(0,4).forEach(t => { s += `\n  • ${t.parsed_title || t.original_text}`; });
      }
      if (todos.length) {
        s += `\n📋 To-do:`;
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
      examMsg = `\n\n🎯 *${upcoming.name}* — ${upcoming.diff} days to go!`;
    }

    // Compose message
    let msg = `🌙 *Evening Homework Summary — get ready for tomorrow\\!*\n`;
    msg += dateStr;
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
    return res.status(500).json({ error: err.message });
  }
}
