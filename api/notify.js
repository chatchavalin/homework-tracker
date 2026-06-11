export default async function handler(req, res) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
  const DAD_TOKEN    = process.env.LINE_TOKEN_DAD;
  const MUM_TOKEN    = process.env.LINE_TOKEN_MUM;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  try {
    // Fetch tasks from Supabase
    const r = await fetch(`${SUPABASE_URL}/rest/v1/tasks?is_done=eq.false&select=*`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    });
    const tasks = await r.json();

    // Build message
    const today = new Date();
    const dateStr = `${today.getDate()}/${today.getMonth()+1}/${today.getFullYear()+543}`;
    const urgent  = tasks.filter(t => t.priority === 'high' && t.type === 'homework');
    const todos   = tasks.filter(t => t.type === 'todo');
    const done    = 0; // we only fetched undone
    const total   = tasks.length;

    let msg = `\n🌅 สวัสดีตอนเช้า Ryuji! ${dateStr}\n`;
    if (urgent.length) {
      msg += `\n📚 การบ้านด่วน:\n`;
      urgent.forEach(t => { msg += `• ${t.parsed_title || t.original_text}\n`; });
    } else {
      msg += `\n✅ ไม่มีการบ้านด่วน\n`;
    }
    if (todos.length) {
      msg += `\n📋 สิ่งที่ต้องทำ:\n`;
      todos.slice(0,5).forEach(t => { msg += `• ${t.parsed_title || t.original_text}\n`; });
    }
    msg += `\n📊 งานค้างอยู่ ${total} ชิ้น`;

    // Send to both parents
    const tokens = [DAD_TOKEN, MUM_TOKEN].filter(Boolean);
    if (!tokens.length) return res.status(200).json({ message: 'No tokens configured' });

    await Promise.all(tokens.map(token =>
      fetch('https://notify-api.line.me/api/notify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Bearer ${token}`
        },
        body: `message=${encodeURIComponent(msg)}`
      })
    ));

    return res.status(200).json({ success: true, sent: tokens.length });

  } catch (err) {
    console.error('Notify error:', err);
    return res.status(500).json({ error: err.message });
  }
}
