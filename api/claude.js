import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;

    /* ── COMMISSIONER VERIFICATION ── */
    if (body.verifyCommissioner) {
      const { leagueId, username } = body;
      if (!leagueId || !username) {
        return res.status(200).json({ isCommissioner: false, error: 'Missing fields' });
      }

      const lowerUsername = username.toLowerCase().trim();

      /* Permanent admin whitelist — always full Pro access */
      const whitelist = ['skolsplitter', 'wolfgang22'];
      const isAdmin = whitelist.includes(lowerUsername);

      /* Fetch league users from Sleeper */
      const sleeperRes = await fetch(`https://api.sleeper.app/v1/league/${leagueId}/users`);
      if (!sleeperRes.ok) return res.status(200).json({ isCommissioner: false, error: 'League not found' });
      const users = await sleeperRes.json();

      /* Fetch league to get owner_id */
      const leagueRes = await fetch(`https://api.sleeper.app/v1/league/${leagueId}`);
      const league = await leagueRes.json();

      /* Match username to Sleeper user */
      const matchedUser = users.find(u => (u.display_name || '').toLowerCase() === lowerUsername);
      const isCommissioner = isAdmin || (matchedUser && matchedUser.user_id === league.owner_id);

      if (!isCommissioner) {
        return res.status(200).json({ isCommissioner: false });
      }

      /* Check or create league record in Supabase */
      let { data: record } = await supabase
        .from('leagues')
        .select('*')
        .eq('league_id', leagueId)
        .single();

      if (!record) {
        await supabase.from('leagues').insert({
          league_id: leagueId,
          commissioner_username: lowerUsername,
          trial_start_date: new Date().toISOString(),
          is_paid: false
        });
        const result = await supabase
          .from('leagues')
          .select('*')
          .eq('league_id', leagueId)
          .single();
        record = result.data;
      }

      /* Trial logic — 14 days from activation */
      const now = new Date();
      const trialActivated = record.trial_activated || false;
      const trialEnd = record.trial_end_date ? new Date(record.trial_end_date) : null;
      const trialActive = trialActivated && trialEnd && now < trialEnd;
      const trialDaysLeft = trialActive ? Math.max(0, Math.ceil(
        (trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      )) : 0;

      return res.status(200).json({
        isCommissioner: true,
        isPaid: isAdmin ? true : record.is_paid,
        paidUntil: isAdmin ? '2099-01-01' : record.paid_until,
        trialActive: isAdmin ? true : trialActive,
        trialDaysLeft: isAdmin ? 999 : trialDaysLeft
      });
    }

    /* ── CREATE CHECKOUT SESSION ── */
    if (body.createCheckout) {
      const { leagueId, username } = body;
      const stripe = new (await import('stripe')).default(process.env.STRIPE_SECRET_KEY);
      try {
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ['card'],
          line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
          mode: 'subscription',
          success_url: 'https://commissioner-hub.vercel.app?paid=true&league=' + leagueId,
          cancel_url: 'https://commissioner-hub.vercel.app',
          subscription_data: {
            metadata: { league_id: leagueId, commissioner_username: username }
          },
          metadata: { league_id: leagueId, commissioner_username: username }
        });
        return res.status(200).json({ url: session.url });
      } catch(stripeErr) {
        console.error('Stripe checkout error:', stripeErr.message);
        return res.status(500).json({ error: stripeErr.message });
      }
    }

    /* ── TRIAL ACTIVATION ── */
    if (body.activateTrial) {
      const { leagueId } = body;
      const trialEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      await supabase.from('leagues').update({
        trial_activated: true,
        trial_end_date: trialEnd.toISOString()
      }).eq('league_id', leagueId);
      return res.status(200).json({ success: true, trialEnd: trialEnd.toISOString(), trialDaysLeft: 14 });
    }

    /* ── SHEET TAKES PROXY ── */
    if (body.fetchSheetTakes) {
      try {
        const sheetUrl = 'https://docs.google.com/spreadsheets/d/1MrQh_jRfoKw7Gwz06fAbVQhfev1-2q0T/gviz/tq?tqx=out:csv&sheet=Sheet1';
        const r = await fetch(sheetUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/csv,text/plain,*/*' },
          redirect: 'follow'
        });
        if (!r.ok) return res.status(200).json({ csv: '', error: 'Sheet fetch failed: ' + r.status });
        const csv = await r.text();
        return res.status(200).json({ csv });
      } catch(e) {
        return res.status(200).json({ csv: '', error: e.message });
      }
    }

    /* ── NFLVERSE PROXY ── */
    if (body.fetchNFLVerse) {
      const csvUrl = `https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats_${body.nflSeason}.csv`;
      const r = await fetch(csvUrl);
      if (!r.ok) return res.status(200).json({ csv: '' });
      const csv = await r.text();
      return res.status(200).json({ csv });
    }

    /* ── CLAUDE AI ── */
    const analyticalSections = ['rankings','seasonrank','aitrades','aidraft'];
    const isAnalytical = analyticalSections.includes(body.section);
    const temperature = isAnalytical ? 0.1 : 0.5;

8. When using commissioner tag content, write it as direct analysis — do NOT say "the commissioner profile says" or "according to the commissioner profile." Just state it as fact in your own voice.
9. NEVER show uncertainty, self-correction, or second-guessing in your output. Never write phrases like "wait —", "actually —", "let me be precise", "no —", or any mid-sentence correction. If you are unsure which team a player belongs to, consult the VERIFIED FANTASY ROSTER ASSIGNMENTS at the top of the prompt — those assignments are always correct and final. Write with complete confidence at all times.
10. A player listed on Team A's roster IS on Team A. Their NFL team is irrelevant. Fantasy ownership is determined solely by the roster data provided.
    const requestBody = {
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      temperature,
      system: analyticalSystem,
      messages: [{ role: 'user', content: body.prompt }]
    };

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(requestBody)
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(500).json({ error: data.error?.message || JSON.stringify(data) });
    }

    return res.status(200).json({ text: data.content?.[0]?.text || '' });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
