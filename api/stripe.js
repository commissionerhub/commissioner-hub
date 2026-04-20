import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).json({ error: 'Webhook signature verification failed' });
  }

  try {
    if (event.type === 'invoice.payment_succeeded') {
      const invoice = event.data.object;
      const customerId = invoice.customer;
      const subscriptionId = invoice.subscription;

      /* Get league_id from invoice metadata first, then fall back to subscription */
      let leagueId = invoice.metadata && invoice.metadata.league_id;
      let username = invoice.metadata && invoice.metadata.commissioner_username;

      /* If not on invoice, try subscription */
      if (!leagueId && subscriptionId) {
        try {
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          leagueId = subscription.metadata.league_id;
          username = subscription.metadata.commissioner_username;
        } catch(e) {
          console.error('Could not retrieve subscription:', e.message);
        }
      }

      /* If still no leagueId, try customer metadata */
      if (!leagueId) {
        try {
          const customer = await stripe.customers.retrieve(customerId);
          leagueId = customer.metadata && customer.metadata.league_id;
          username = customer.metadata && customer.metadata.commissioner_username;
        } catch(e) {
          console.error('Could not retrieve customer:', e.message);
        }
      }

      if (!leagueId) {
        console.error('No league_id in subscription metadata');
        return res.status(200).json({ received: true });
      }

      /* Set paid_until to one year from now */
      const paidUntil = new Date();
      paidUntil.setFullYear(paidUntil.getFullYear() + 1);

      /* Update or insert league record */
      const { data: existing } = await supabase
        .from('leagues')
        .select('*')
        .eq('league_id', leagueId)
        .single();

      if (existing) {
        await supabase.from('leagues').update({
          is_paid: true,
          paid_until: paidUntil.toISOString(),
          commissioner_username: username || existing.commissioner_username
        }).eq('league_id', leagueId);
      } else {
        await supabase.from('leagues').insert({
          league_id: leagueId,
          commissioner_username: username || 'unknown',
          is_paid: true,
          paid_until: paidUntil.toISOString(),
          trial_activated: false
        });
      }

      console.log('Payment succeeded for league:', leagueId, 'paid until:', paidUntil);
    }

    if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object;
      const leagueId = subscription.metadata.league_id;

      if (leagueId) {
        /* Don't revoke immediately — let paid_until expire naturally */
        console.log('Subscription cancelled for league:', leagueId);
      }
    }

    return res.status(200).json({ received: true });

  } catch (err) {
    console.error('Webhook handler error:', err);
    return res.status(500).json({ error: err.message });
  }
}
