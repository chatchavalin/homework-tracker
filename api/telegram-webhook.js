// Inbound Telegram webhook: a text message -> auto-creates a task.
// Kid is decided by SENDER first:
//   - message from Ryuji's chat  -> always Ryuji
//   - message from Miki's chat   -> always Miki
//   - message from a parent      -> the message MUST name Ryuji or Miki
// Weekly recurring tasks ("every week" / "ทุกสัปดาห์" / "every Monday") are supported:
//   they get repeat='weekly' (+ repeat_dow) and are auto-reset each week by /api/reset-weekly.
// Set webhook once (see deploy notes). Returns 200 always so Telegram doesn't retry-storm.

import { randomUUID } from 'node:crypto';

export default async function handler(req, res) {
  // Telegram only ever POSTs updates here.
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true, note: 'webhook alive' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
  const BOT_TOKEN    = process.env.TELEGRAM_BOT_TOKEN;
  const SECRET       = process.env.TELEGRAM_WEBHOOK_SECRET || '';      // optional
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const OPENCODE_GO_KEY = process.env.OPENCODE_GO_API_KEY;
  const GROQ_KEY      = process.env.GROQ_API_KEY;

  // Sender -> kid mapping (set these in Vercel once each kid /starts the bot).
  const CHAT_RYUJI = (process.env.TELEGRAM_CHAT_RYUJI || '').trim();
  const CHAT_MIKI  = (process.env.TELEGRAM_CHAT_MIKI  || '').trim();
  const CHAT_DAD   = (process.env.TELEGRAM_CHAT_DAD   || '').trim();
  const CHAT_MUM   = (process.env.TELEGRAM_CHAT_MUM   || '').trim();

  // Allowlist = every known chat, plus anything in TELEGRAM_ALLOWED_CHATS (back-compat).
  const ALLOWED = Array.from(new Set(
    [CHAT_RYUJI, CHAT_MIKI, CHAT_DAD, CHAT_MUM]
      .concat((process.env.TELEGRAM_ALLOWED_CHATS || '').split(','))
      .map(s => s.trim()).filter(Boolean)
  ));

  // Verify the request really came from Telegram (set when registering the webhook).
  if (SECRET) {
    const got = req.headers['x-telegram-bot-api-secret-token'];
    if (got !== SECRET) return res.status(200).json({ ok: false, reason: 'bad secret' });
  }

  async function reply(chatId, text) {
    if (!BOT_TOKEN || !chatId) return;
    try {
      await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' })
      });
    } catch (e) { /* swallow */ }
  }

  try {
    const update = req.body || {};
    const msg = update.message || update.edited_message;
    if (!msg || !msg.chat) return res.status(200).json({ ok: true, skip: 'no message' });

    const chatId = msg.chat.id;
    const idStr  = String(chatId);
    let text = (msg.text || '').trim();

    // Who is this chat?
    let forcedKid = null;     // kid locked by sender identity
    let isParent  = false;
    if (CHAT_RYUJI && idStr === CHAT_RYUJI) forcedKid = 'ryuji';
    else if (CHAT_MIKI && idStr === CHAT_MIKI) forcedKid = 'miki';
    else if ((CHAT_DAD && idStr === CHAT_DAD) || (CHAT_MUM && idStr === CHAT_MUM)) isParent = true;

    if (!text) {
      await reply(chatId, '📷 ส่งข้อความการบ้านมาได้เลย / Send homework as text.');
      return res.status(200).json({ ok: true });
    }

    // /start, /id, /help -> show the chat id so it can be added to the allowlist / kid mapping.
    if (/^\/(start|id|help)\b/i.test(text)) {
      const whoLine = forcedKid ? `\nคุณคือ: *${forcedKid === 'miki' ? 'Miki 👧' : 'Ryuji 👦'}*`
                    : isParent  ? `\nคุณคือ: *ผู้ปกครอง* (ต้องระบุชื่อลูกในข้อความ)`
                    : '';
      await reply(chatId,
        `👋 *Homework bot*\nChat ID: \`${chatId}\`${whoLine}\n\n` +
        `พิมพ์: *การบ้าน + กำหนดส่ง*\n` +
        `ลูกพิมพ์: \`math worksheet p.5 due Friday\`\n` +
        `พ่อแม่พิมพ์: \`Ryuji math worksheet p.5 due Friday\`\n` +
        `งานประจำสัปดาห์: \`Miki piano ทุกวันจันทร์\``);
      return res.status(200).json({ ok: true, chatId, forcedKid, isParent });
    }

    // Restrict who can create tasks, if an allowlist is configured.
    if (ALLOWED.length && !ALLOWED.includes(idStr)) {
      await reply(chatId, `🔒 ยังไม่ไดบับอนุบัญาต / Not allowed yet.\nChat ID: \`${chatId}\``);
      return res.status(200).json({ ok: false, reason: 'chat not allowed', chatId });
    }

    if (!SUPABASE_URL || !SUPABASE_KEY) {
      await reply(chatId, '⚠️ Server not configured (Supabase).');
      return res.status(200).json({ ok: false, reason: 'missing supabase env' });
    }

    // Bangkok date context for relative due-dates.
    // If the user replied with just a kid name, attach it to the pending item above.
    if (/^(r|ryuji|m|miki)$/i.test(text)) {
      const kidFromName = /^(r|ryuji)$/i.test(text) ? 'ryuji' : 'miki';
      const pend = await popPending(SUPABASE_URL, SUPABASE_KEY, idStr);
      if (!pend) {
        await reply(chatId, 'Send the task or exam first, then reply R or M.');
        return res.status(200).json({ ok: true, note: 'name only, no pending' });
      }
      forcedKid = kidFromName;
      text = pend;
    }

    const bkk = new Date(Date.now() + 7 * 3600 * 1000);
    const todayISO = bkk.toISOString().slice(0, 10);
    const dowName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][bkk.getUTCDay()];

    const PROMPT =
`Today is ${todayISO} (${dowName}) in Bangkok. Parse this homework message into JSON.
Message: """${text}"""
Return ONLY a JSON object, no markdown:
{"kid_id":"ryuji"|"miki"|null,"record":"task"|"exam","parsed_title":string,"subject":string|null,"type":"homework"|"todo","due_date":"YYYY-MM-DD"|null,"priority":"high"|"med"|"low","repeat":"weekly"|null,"repeat_dow":0|1|2|3|4|5|6|null}
Rules:
- kid_id from the FIRST token (case-insensitive): "R" or "Ryuji" -> ryuji; "M" or "Miki" -> miki. If neither and no kid name appears, kid_id MUST be null (do not guess).
- record: "exam" if the message refers to an exam/test (keywords: exam, pretest, midterm, final, quiz), otherwise "task".
- Dates written as DD/MM or DD/MM/YYYY are day/month(/year). If the year is missing use the nearest future occurrence. For an exam, due_date is the exam date.
- parsed_title: the assignment itself, without the name or the due-date/recurrence words. Keep Thai as Thai.
- Resolve relative dates (today/tomorrow/Friday/พรุ่งนี้/ศุกร์ etc.) to absolute YYYY-MM-DD from today's date. If none, null.
- repeat: "weekly" if it recurs every week (every week/weekly/ทุกสัปดาห์/ทุกอาทิตย์/every Monday/ทุกวันจันทร์ etc.), else null.
- repeat_dow: if a specific weekday is given for the recurrence, 0=Sunday..6=Saturday; else null.
- If repeat is "weekly" and repeat_dow is set, set due_date to the NEXT occurrence of that weekday on/after today.
- type "homework" if it's schoolwork with/needing a due date, else "todo".
- priority "high" only if it says urgent/ด่วน/พรุ่งนี้, else "med".`;

    const parsed = await parseMessage(PROMPT, { ANTHROPIC_KEY, OPENCODE_GO_KEY, GROQ_KEY });
    if (!parsed) {
      await reply(chatId, '❓ อ่านไม่ออก ลองพิมพ์ใหม่ / Could not parse, try again.');
      return res.status(200).json({ ok: false, reason: 'parse failed' });
    }

    // Decide the kid.
    let kid_id;
    if (forcedKid) {
      kid_id = forcedKid;                       // sender is a kid -> locked
    } else {
      const named = parsed.kid_id === 'ryuji' || parsed.kid_id === 'miki';
      if (!named) {
        // Parent (or unknown sender) without a name -> must specify.
        await reply(chatId,
          '🙋 ใครเอ่ย? ระบุ *Ryuji* หรือ *Miki* ในข้อความด้วย\n' +
          '_Whose task? Start the message with Ryuji or Miki._\n' +
          'e.g. `Ryuji math worksheet p.5 due Friday`');
        await setPending(SUPABASE_URL, SUPABASE_KEY, idStr, text);
        return res.status(200).json({ ok: false, reason: 'kid not specified, pending stored' });
      }
      kid_id = parsed.kid_id;
    }

    const title  = parsed.parsed_title || text;
    // Exam -> separate exams table.
    if (parsed.record === 'exam') {
      const whoE = kid_id === 'miki' ? 'Miki' : 'Ryuji';
      const examRow = { id: randomUUID(), kid_id, name: title, exam_date: parsed.due_date || null, created_at: new Date().toISOString() };
      const ei = await insertExam(SUPABASE_URL, SUPABASE_KEY, examRow);
      if (!ei.ok) { await reply(chatId, 'Exam save failed. ' + (ei.error || '')); return res.status(200).json({ ok:false, reason:'exam insert failed', detail: ei.error }); }
      await reply(chatId, 'Exam saved: ' + whoE + ' / ' + title + ' / ' + (examRow.exam_date || '-')); 
      return res.status(200).json({ ok:true, exam: examRow });
    }

    const repeat = parsed.repeat === 'weekly' ? 'weekly' : null;
    const repeat_dow = (repeat && Number.isInteger(parsed.repeat_dow) &&
                        parsed.repeat_dow >= 0 && parsed.repeat_dow <= 6) ? parsed.repeat_dow : null;

    // Defensive insert: full payload first, retry with core columns if a column is missing.
    const full = {
      id: randomUUID(),
      kid_id,
      type: parsed.type === 'todo' ? 'todo' : 'homework',
      parsed_title: title,
      original_text: text,
      subject: parsed.subject || null,
      due_date: parsed.due_date || null,
      priority: parsed.priority || 'med',
      repeat,
      repeat_dow,
      record_type: 'task',
      is_done: false,
      created_at: new Date().toISOString(),
    };

    let ins = await insertTask(SUPABASE_URL, SUPABASE_KEY, full);
    if (!ins.ok) {
      // retry without the newest columns (repeat/repeat_dow) in case migration hasn't run
      const noRepeat = { ...full }; delete noRepeat.repeat; delete noRepeat.repeat_dow;
      ins = await insertTask(SUPABASE_URL, SUPABASE_KEY, noRepeat);
    }
    if (!ins.ok) {
      const core = {
        id: full.id, kid_id, type: full.type, parsed_title: title,
        original_text: text, due_date: full.due_date, is_done: false,
      };
      ins = await insertTask(SUPABASE_URL, SUPABASE_KEY, core);
    }
    if (!ins.ok) {
      await reply(chatId, `⚠️ บันทึกไม่สำเร็จ / Save failed.\n${ins.error || ''}`);
      return res.status(200).json({ ok: false, reason: 'insert failed', detail: ins.error });
    }

    const who = kid_id === 'miki' ? 'Miki 👧' : 'Ryuji 👦';
    const due = full.due_date || '—';
    const DOW_TH = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัส','ศุกร์','เสาร์'];
    const repeatLine = repeat
      ? `\n🔁 ทุกสัปดาห์${repeat_dow != null ? ` (วัน${DOW_TH[repeat_dow]})` : ''}`
      : '';
    await reply(chatId,
      `✅ *บันทึกแล้ว / Saved*\n${who}\n📝 ${title}\n📅 ${due}${repeatLine}`);

    return res.status(200).json({ ok: true, saved: full });

  } catch (err) {
    console.error('telegram-webhook error:', err);
    return res.status(200).json({ ok: false, error: String(err && err.message || err) });
  }
}

// ── Parse free text -> structured task. Claude first, then OpenCode Go, then Groq. ──
async function parseMessage(prompt, { ANTHROPIC_KEY, OPENCODE_GO_KEY, GROQ_KEY }) {
  const tryParse = (raw) => {
    try { return JSON.parse(String(raw).replace(/```json|```/g, '').trim()); }
    catch { return null; }
  };

  if (ANTHROPIC_KEY) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 512,
          messages: [{ role: 'user', content: prompt }]
        })
      });
      if (r.ok) {
        const d = await r.json();
        const out = tryParse(d.content?.find(c => c.type === 'text')?.text || '');
        if (out) return out;
      }
    } catch (e) { /* fall through to Groq */ }
  }

  if (OPENCODE_GO_KEY) {
    try {
      const r = await fetch('https://opencode.ai/zen/go/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENCODE_GO_KEY}` },
        body: JSON.stringify({
          model: 'mimo-v2.5',
          max_tokens: 512,
          temperature: 0.1,
          messages: [{ role: 'user', content: prompt }]
        })
      });
      if (r.ok) {
        const d = await r.json();
        const out = tryParse(d.choices?.[0]?.message?.content || '');
        if (out) return out;
      }
    } catch (e) { /* fall through to Groq */ }
  }

  if (GROQ_KEY) {
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_KEY}` },
        body: JSON.stringify({
          model: 'qwen/qwen3.6-27b',
          max_tokens: 512,
          temperature: 0.1,
          messages: [{ role: 'user', content: prompt }]
        })
      });
      if (r.ok) {
        const d = await r.json();
        return tryParse(d.choices?.[0]?.message?.content || '');
      }
    } catch (e) { /* give up */ }
  }
  return null;
}

async function setPending(url, key, chatId, message) {
  try {
    await fetch(url + '/rest/v1/pending_intake?chat_id=eq.' + encodeURIComponent(chatId), { method: 'DELETE', headers: { 'apikey': key, 'Authorization': 'Bearer ' + key } });
    await fetch(url + '/rest/v1/pending_intake', { method: 'POST', headers: { 'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' }, body: JSON.stringify({ chat_id: String(chatId), message: message, updated_at: new Date().toISOString() }) });
  } catch (e) { /* ignore */ }
}

async function popPending(url, key, chatId) {
  try {
    const r = await fetch(url + '/rest/v1/pending_intake?chat_id=eq.' + encodeURIComponent(chatId) + '&select=message', { headers: { 'apikey': key, 'Authorization': 'Bearer ' + key } });
    if (!r.ok) return null;
    const rows = await r.json();
    if (!rows.length) return null;
    await fetch(url + '/rest/v1/pending_intake?chat_id=eq.' + encodeURIComponent(chatId), { method: 'DELETE', headers: { 'apikey': key, 'Authorization': 'Bearer ' + key } });
    return rows[0].message;
  } catch (e) { return null; }
}

async function insertExam(url, key, payload) {
  try {
    const r = await fetch(url + '/rest/v1/exams', { method: 'POST', headers: { 'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' }, body: JSON.stringify(payload) });
    if (r.ok) return { ok: true };
    const txt = await r.text().catch(() => '');
    return { ok: false, error: txt.slice(0, 200) };
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}

async function insertTask(url, key, payload) {
  try {
    const r = await fetch(`${url}/rest/v1/tasks`, {
      method: 'POST',
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(payload)
    });
    if (r.ok) return { ok: true };
    const txt = await r.text().catch(() => '');
    return { ok: false, error: txt.slice(0, 200) };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}
