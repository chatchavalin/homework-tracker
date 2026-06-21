// Inbound Telegram webhook: kid texts "Name homework ... due <date>" -> auto-creates a task.
// Set webhook once (see deploy notes). Returns 200 always so Telegram doesn't retry-storm.

export default async function handler(req, res) {
  // Telegram only ever POSTs updates here.
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true, note: 'webhook alive' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
  const BOT_TOKEN    = process.env.TELEGRAM_BOT_TOKEN;
  const SECRET       = process.env.TELEGRAM_WEBHOOK_SECRET || '';      // optional
  const ALLOWED      = (process.env.TELEGRAM_ALLOWED_CHATS || '')      // optional: comma-sep chat ids
                        .split(',').map(s => s.trim()).filter(Boolean);
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const GROQ_KEY      = process.env.GROQ_API_KEY;

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
    const text = (msg.text || '').trim();
    if (!text) {
      await reply(chatId, '📷 ส่งข้อความการบ้านมาได้เลย / Send homework as text.');
      return res.status(200).json({ ok: true });
    }

    // /start or /id -> show the chat id so it can be added to the allowlist.
    if (/^\/(start|id|help)\b/i.test(text)) {
      await reply(chatId,
        `👋 *Homework bot*\nChat ID: \`${chatId}\`\n\nพิมพ์: *ชื่อ + การบ้าน + กำหนดส่ง*\ne.g. \`Ryuji math worksheet p.5 due Friday\``);
      return res.status(200).json({ ok: true, chatId });
    }

    // Restrict who can create tasks, if an allowlist is configured.
    if (ALLOWED.length && !ALLOWED.includes(String(chatId))) {
      await reply(chatId, `🔒 ยังไม่ได้รับอนุญาต / Not allowed yet.\nChat ID: \`${chatId}\``);
      return res.status(200).json({ ok: false, reason: 'chat not allowed', chatId });
    }

    if (!SUPABASE_URL || !SUPABASE_KEY) {
      await reply(chatId, '⚠️ Server not configured (Supabase).');
      return res.status(200).json({ ok: false, reason: 'missing supabase env' });
    }

    // Bangkok date context for relative due-dates.
    const bkk = new Date(Date.now() + 7 * 3600 * 1000);
    const todayISO = bkk.toISOString().slice(0, 10);
    const dowName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][bkk.getUTCDay()];

    const PROMPT =
`Today is ${todayISO} (${dowName}) in Bangkok. Parse this homework message into JSON.
Message: """${text}"""
Return ONLY a JSON object, no markdown:
{"kid_id":"ryuji"|"miki","parsed_title":string,"subject":string|null,"type":"homework"|"todo","due_date":"YYYY-MM-DD"|null,"priority":"high"|"med"|"low"}
Rules:
- kid_id from the first name in the message: "Ryuji"->ryuji, "Miki"->miki. If no name, use "ryuji".
- parsed_title: the assignment itself, without the name or the due-date words. Keep Thai as Thai.
- Resolve relative dates (today/tomorrow/Friday/พรุ่งนี้/ศุกร์ etc.) to absolute YYYY-MM-DD from today's date. If none, null.
- type "homework" if it's schoolwork with/needing a due date, else "todo".
- priority "high" only if it says urgent/ด่วน/พรุ่งนี้, else "med".`;

    const parsed = await parseMessage(PROMPT, { ANTHROPIC_KEY, GROQ_KEY });
    if (!parsed) {
      await reply(chatId, '❓ อ่านไม่ออก ลองพิมพ์ใหม่ / Could not parse, try again.');
      return res.status(200).json({ ok: false, reason: 'parse failed' });
    }

    const kid_id = parsed.kid_id === 'miki' ? 'miki' : 'ryuji';
    const title = parsed.parsed_title || text;

    // Defensive insert: full payload first, retry with core columns if a column is missing.
    const full = {
      kid_id,
      type: parsed.type === 'todo' ? 'todo' : 'homework',
      parsed_title: title,
      original_text: text,
      subject: parsed.subject || null,
      due_date: parsed.due_date || null,
      priority: parsed.priority || 'med',
      record_type: 'task',
      is_done: false,
      created_at: new Date().toISOString(),
    };

    let ins = await insertTask(SUPABASE_URL, SUPABASE_KEY, full);
    if (!ins.ok) {
      const core = {
        kid_id, type: full.type, parsed_title: title,
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
    await reply(chatId,
      `✅ *บันทึกแล้ว / Saved*\n${who}\n📝 ${title}\n📅 ${due}`);

    return res.status(200).json({ ok: true, saved: full });

  } catch (err) {
    console.error('telegram-webhook error:', err);
    return res.status(200).json({ ok: false, error: String(err && err.message || err) });
  }
}

// ── Parse free text -> structured task. Claude first if available, else Groq. ──
async function parseMessage(prompt, { ANTHROPIC_KEY, GROQ_KEY }) {
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

  if (GROQ_KEY) {
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_KEY}` },
        body: JSON.stringify({
          model: 'meta-llama/llama-4-scout-17b-16e-instruct',
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
