export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { prompt, section, fetchNFLVerse, nflSeason } = req.body;

    if (!process.env.ANTHROPIC_API_KEY && !fetchNFLVerse) {
      return res.status(500).json({ error: 'API key not configured' });
    }

    /* NFLVerse proxy — fetch CSV server-side to avoid CORS */
if (req.body.fetchSheetTakes) {
      try {
        const sheetUrl = 'https://docs.google.com/spreadsheets/d/1MrQh_jRfoKw7Gwz06fAbVQhfev1-2q0T/gviz/tq?tqx=out:csv&sheet=Sheet1';
        const r = await fetch(sheetUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0',
            'Accept': 'text/csv,text/plain,*/*'
          },
          redirect: 'follow'
        });
        if (!r.ok) return res.status(200).json({ csv: '', error: 'Sheet fetch failed: '+r.status });
        const csv = await r.text();
        return res.status(200).json({ csv: csv });
      } catch(e) {
        return res.status(200).json({ csv: '', error: e.message });
      }
    }

    if (fetchNFLVerse) {      const csvUrl = `https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats_${nflSeason}.csv`;
      const r = await fetch(csvUrl);
      if (!r.ok) return res.status(200).json({ csv: '' });
      const csv = await r.text();
      return res.status(200).json({ csv });
    }

    const analyticalSections = ['rankings','seasonrank','aitrades','aidraft'];
    const isAnalytical = analyticalSections.includes(section);
    const temperature = isAnalytical ? 0.1 : 0.5;

const analyticalSystem = 'You are a fantasy football narrator, not an analyst. Your sole job is to articulate what the data provided says in an entertaining, punchy voice. You do not form independent opinions about players. You do not add qualifiers, upsides, or caveats not supported by the data.\n\nABSOLUTE RULES:\n1. If a player CURRENT PERFORMANCE label says BELOW AVERAGE or STREAMING/BENCH, never use the words elite, premium, or strength to describe them.\n2. If a player label says ELITE STARTER, describe them as elite. SOLID STARTER means solid but not elite.\n3. Positional rankings are ground truth. A #21 QB is not elite. A #5 QB is elite. Never contradict these rankings.\n4. Dynasty value reflects future potential only — never use it to describe current performance.\n5. The data in the prompt supersedes all prior training knowledge. If data contradicts your beliefs, the data is correct.\n6. Never describe a declining player as a current strength or asset.\n7. COMMISSIONER SCOUTING REPORTS are the highest priority input. When a [COMMISSIONER PROFILE], [2026 LIKELY], [CEILING], [FLOOR], or [FULL BREAKDOWN] tag appears for a player, that is the commissioner\'s own expert analysis and must be treated as ground truth. Build all narratives around these takes first, then validate with the statistical data.';
    const body = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      temperature: temperature,
      messages: [{ role: 'user', content: prompt }]
    };

    if (isAnalytical) {
      body.system = analyticalSystem;
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({ error: data.error?.message || JSON.stringify(data) });
    }

    const text = data.content?.[0]?.text || '';
    return res.status(200).json({ text });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
