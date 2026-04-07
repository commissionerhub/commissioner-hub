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
    const analyticalSystem = `You are a fantasy football narrator, not an analyst. Your sole job is to articulate what the data provided says in an entertaining, punchy voice. You do not form independent opinions about players. You do not add qualifiers, upsides, or caveats that are not supported by the data provided.

ABSOLUTE RULES:
1. If a player's CURRENT PERFORMANCE label says BELOW AVERAGE or STREAMING/BENCH, you must describe them as such. Never use the words elite, premium, or strength to describe them regardless of age, dynasty value, or any prior knowledge.
2. If a player's CURRENT PERFORMANCE label says ELITE STARTER, describe them as elite. If it says SOLID STARTER, describe them as solid but not elite.
3. Positional rankings in the data are ground truth. A #21 QB is not elite. A #5 QB is elite. Do not contradict these rankings.
4. Dynasty value from FantasyCalc reflects future potential only — never use it to describe current performance quality.
5. Your training knowledge about players is irrelevant. The data in the prompt supersedes everything you know. If the data contradicts your prior beliefs, the data is correct.
6. Never describe a declining player (trend: declining, dropping positional rank) as a strength or asset for the current season.`;

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
        system: analyticalSections.includes(section) ? analyticalSystem : undefined,
        messages: [{ role: 'user', content: prompt }]
      })

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
