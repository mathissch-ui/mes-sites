// Webhook Stripe -> active le forfait Supabase correspondant après un paiement reussi.
//
// Deploiement (depuis un terminal, apres avoir installe et connecte la CLI Supabase) :
//   supabase functions deploy stripe-webhook --no-verify-jwt
//
// Secrets a definir AVANT le deploiement (jamais dans ce fichier ni dans le chat) :
//   supabase secrets set STRIPE_SECRET_KEY=sk_live_...
//   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
// (SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont fournis automatiquement a toute
// Edge Function par la plateforme, rien a definir pour ceux-la.)
//
// Puis dans Stripe > Developpeurs > Webhooks : ajouter une destination pointant
// vers l'URL de cette fonction, ecoutant l'evenement "checkout.session.completed".

import Stripe from "npm:stripe@14";
import { createClient } from "npm:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2023-10-16",
});

const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// A completer avec les Price ID Stripe reels (Stripe > Produits > cliquer sur un prix,
// l'identifiant commence par "price_"). Un Payment Link correspond a un seul prix.
const PRICE_TO_PLAN: Record<string, string> = {
  "price_1TytTUF7y5BccxXlmPBZgWx3": "pro",       // Pro mensuel, 2,99€
  "price_1TytVHF7y5BccxXlqWXX54tJ": "pro",       // Pro annuel, 29,90€
  "price_1TytX8F7y5BccxXl0657bgvE": "unlimited", // Illimite mensuel, 7,99€
  "price_1TytXlF7y5BccxXlfwBGAGBs": "unlimited", // Illimite annuel, 79,90€
};

Deno.serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature!, webhookSecret);
  } catch (err) {
    console.error("Signature Stripe invalide :", (err as Error).message);
    return new Response("Signature invalide", { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const uid = session.client_reference_id;

    if (!uid) {
      console.error("client_reference_id manquant sur la session", session.id);
      return new Response("OK (uid manquant)", { status: 200 });
    }

    const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
    const priceId = lineItems.data[0]?.price?.id;
    const plan = priceId ? PRICE_TO_PLAN[priceId] : undefined;

    if (!plan) {
      console.error("Price ID Stripe inconnu :", priceId);
      return new Response("OK (price inconnu)", { status: 200 });
    }

    const { error } = await supabaseAdmin.from("user_data").update({ plan }).eq("user_id", uid);
    if (error) {
      console.error(`Echec de l'activation du plan "${plan}" pour ${uid} :`, error.message);
      return new Response("Erreur base de donnees", { status: 500 });
    }
    console.log(`Plan "${plan}" active pour l'utilisateur ${uid}`);
  }

  return new Response("OK", { status: 200 });
});
