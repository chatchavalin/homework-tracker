export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { imageBase64, mimeType, prompt } = req.body;
  if (!imageBase64) {
    return res.status(400).json({ error: 'No image provided' });
  }

  const FALLBACK_PROMPT = `You are a homework parser for a Thai student. Extract ALL tasks, events, and info from this notebook image. Return ONLY a valid JSON array of objects with: record_type ("task"|"event"|"info"), original_text, parsed_title, type ("homework"|"todo"), subject, due_date (YYYY-MM-DD or null), points, priority ("high"|"med"|"low"). No markdown.`;

  const PROMPT = prompt || FALLBACK_PROMPT;
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  const OPENCODE_GO_API_KEY = process.env.OPENCODE_GO_API_KEY;
  const GROQ_API_KEY = process.env.GROQ_API_KEY;

  // ── Primary: Claude vision (best at Thai handwriting) ──
  if (ANTHROPIC_API_KEY) {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mimeType || 'image/jpeg', data: imageBase64 } },
              { type: 'text', text: PROMPT }
            ]
          }]
        })
      });
      if (response.ok) {
        const data = await response.json();
        const raw = data.content?.find(c => c.type === 'text')?.text || '[]';
        const clean = raw.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(clean);
        return res.status(200).json({ tasks: parsed, engine: 'claude' });
      }
      const err = await response.json().catch(() => ({}));
      console.error('Anthropic error, falling back to Groq:', err.error?.message);
      // fall through to Groq
    } catch (e) {
      console.error('Anthropic failed, falling back to Groq:', e.message);
    }
  }

  // ── Fallback 1: OpenCode Go MiMo V2.5 ──
  if (OPENCODE_GO_API_KEY) {
    try {
      const response = await fetch('https://opencode.ai/zen/go/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENCODE_GO_API_KEY}`
        },
        body: JSON.stringify({
          model: 'mimo-v2.5',
          max_tokens: 4096,
          temperature: 0.1,
          messages: [{
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${mimeType || 'image/jpeg'};base64,${imageBase64}` } },
              { type: 'text', text: PROMPT }
            ]
          }]
        })
      });
      if (response.ok) {
        const data = await response.json();
        const raw = data.choices?.[0]?.message?.content || '[]';
        const clean = raw.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(clean);
        return res.status(200).json({ tasks: parsed, engine: 'opencode-go' });
      }
      const err = await response.json().catch(() => ({}));
      console.error('OpenCode Go error, falling back to Groq:', err.error?.message || err.message || err);
    } catch (e) {
      console.error('OpenCode Go failed, falling back to Groq:', e.message);
    }
  }

  // ── Fallback 2: Groq Qwen 3.6 27B ──
  if (!GROQ_API_KEY) {
    return res.status(500).json({ error: 'No AI API key configured' });
  }
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'qwen/qwen3.6-27b',
        max_tokens: 4096,
        temperature: 0.1,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${mimeType || 'image/jpeg'};base64,${imageBase64}` } },
            { type: 'text', text: PROMPT }
          ]
        }]
      })
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: err.error?.message || 'Groq error' });
    }
    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || '[]';
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    return res.status(200).json({ tasks: parsed, engine: 'groq' });
  } catch (err) {
    console.error('Parse error:', err);
    return res.status(500).json({ error: err.message });
  }
}
