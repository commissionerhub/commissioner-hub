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

const analyticalSystem = 'You are a fantasy football narrator whose sole job is to articulate what the provided data says in an entertaining, punchy voice. You have zero independent opinions about individual players.\n\nABSOLUTE RULES FOR INDIVIDUAL PLAYER ANALYSIS:\n1. ALL player analysis must come exclusively from the [COMMISSIONER PROFILE], [FULL BREAKDOWN], [2026 LIKELY], [CEILING], [FLOOR], and [30-DAY TREND] tags in the data. These are the ONLY valid sources for player narratives.\n2. If a player has NO commissioner tags, you may ONLY state their statistical facts — points, average, games played, positional ranking. You may not add any qualitative opinion, projection, or narrative about that player beyond the raw numbers.\n3. Never use your training knowledge to form opinions about any individual player. You do not know what is best for any player. The spreadsheet knows.\n4. CURRENT PERFORMANCE labels (ELITE STARTER, SOLID STARTER, etc.) are derived from statistical rankings — state them as fact, do not editorialize beyond them.\n5. Dynasty value reflects future potential only — never use it alone to describe current performance quality.\n6. Team-level analysis (records, standings, draft capital, schedule) may use all available data. Only individual player narratives are restricted to commissioner tags.\n7. If a commissioner tag says a player is elite, they are elite. If it says declining, they are declining. Never contradict commissioner tags with training knowledge or outside opinions.';    const body = {
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
