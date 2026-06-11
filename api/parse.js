export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { imageBase64, mimeType, prompt } = req.body;
  if (!imageBase64) {
    return res.status(400).json({ error: 'No image provided' });
  }

  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_API_KEY) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  const PROMPT = `You are a homework parser for a Thai P.6 student preparing for ม.1 entrance exams.
Extract ALL tasks AND school events from this notebook image.

For each TASK return JSON with:
- record_type: "task"
- original_text: exact text as written (preserve Thai and English exactly)
- parsed_title: clean concise English/Thai summary (max 80 chars)
- type: "homework" or "todo"
- subject: Math | Thai | English | Science | Social | Chinese | PE | Other
- due_date: YYYY-MM-DD if a date is mentioned, else null
- points: integer if points/marks mentioned, else null
- priority: "high" if has points OR due within 2 days, "med" if due this week, "low" otherwise

For each SCHOOL EVENT return:
- record_type: "event"
- name: event name
- type: "holiday" | "break" | "event" | "uniform"
- date: YYYY-MM-DD or null
- start: YYYY-MM-DD or null
- end: YYYY-MM-DD or null

Return ONLY a valid JSON array. No markdown, no backticks, no explanation.`;

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'meta-llama/llama-4-maverick-17b-128e-instruct',
        max_tokens: 4096,
        temperature: 0.1,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:${mimeType || 'image/jpeg'};base64,${imageBase64}` }
            },
            { type: 'text', text: prompt || PROMPT }
          ]
        }]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: err.error?.message || 'Groq error' });
    }

    const data   = await response.json();
    const raw    = data.choices?.[0]?.message?.content || '[]';
    const clean  = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    return res.status(200).json({ tasks: parsed });

  } catch (err) {
    console.error('Parse error:', err);
    return res.status(500).json({ error: err.message });
  }
}
