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
  const OPENCODE_GO_API_KEY = process.env.OPENCODE_GO_API_KEY;

  if (!OPENCODE_GO_API_KEY) {
    return res.status(500).json({ error: 'OpenCode Go API key not configured' });
  }
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
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: err.error?.message || err.message || 'OpenCode Go error' });
    }
    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || '[]';
    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    return res.status(200).json({ tasks: parsed, engine: 'opencode-go' });
  } catch (err) {
    console.error('Parse error:', err);
    return res.status(500).json({ error: err.message });
  }
}
