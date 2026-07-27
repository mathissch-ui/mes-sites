// Webhook Stripe -> active le plan Firestore correspondant après un paiement reussi.
//
// Deploiement (depuis un terminal, apres avoir installe et connecte la CLI Supabase) :
//   supabase functions deploy stripe-webhook --no-verify-jwt
//
// Secrets a definir AVANT le deploiement (jamais dans ce fichier ni dans le chat) :
//   supabase secrets set STRIPE_SECRET_KEY=sk_live_...
//   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
//   supabase secrets set FIREBASE_SERVICE_ACCOUNT='{"type":"service_account", ...}'
//     (le JSON complet telecharge depuis Firebase > Parametres du projet >
//      Comptes de service > Generer une nouvelle cle privee)
//
// Puis dans Stripe > Developpeurs > Webhooks : ajouter une destination pointant
// vers l'URL de cette fonction, ecoutant l'evenement "checkout.session.completed".

import Stripe from "npm:stripe@14";
import { cert, getApps, initializeApp } from "npm:firebase-admin@12/app";
import { getFirestore } from "npm:firebase-admin@12/firestore";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2023-10-16",
});

const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

const serviceAccount = JSON.parse(Deno.env.get("FIREBASE_SERVICE_ACCOUNT")!);
if (!getApps().length) {
  initializeApp({ credential: cert(serviceAccount) });
}
const db = getFirestore();

// A completer avec les Price ID Stripe reels (Stripe > Produits > cliquer sur un prix,
// l'identifiant commence par "price_"). Un Payment Link correspond a un seul prix.
const PRICE_TO_PLAN: Record<string, string> = {
  "price_REMPLACER_PRO_MENSUEL": "pro",
  "price_REMPLACER_PRO_ANNUEL": "pro",
  "price_REMPLACER_ILLIMITE_MENSUEL": "unlimited",
  "price_REMPLACER_ILLIMITE_ANNUEL": "unlimited",
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

    await db.collection("links").doc(uid).set({ plan }, { merge: true });
    console.log(`Plan "${plan}" active pour l'utilisateur ${uid}`);
  }

  return new Response("OK", { status: 200 });
});
