export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { prompt, section } = req.body;

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'API key not configured' });
    }

    /* Analytical sections need near-deterministic output */
    /* Creative sections can have more variance */
    const analyticalSections = ['rankings','seasonrank','aitrades','aidraft'];
    const temperature = analyticalSections.includes(section) ? 0.1 : 0.5;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        temperature: temperature,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({ error: data.error?.message || JSON.stringify(data) });
    }

    const text = data.content?.[0]?.text || '';
    return res.status(200).json({ text: text });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
