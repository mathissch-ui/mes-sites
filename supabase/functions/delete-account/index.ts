// Supprime le compte de l'utilisateur qui appelle cette fonction (auth + toutes ses
// donnees, grâce au "on delete cascade" sur user_data.user_id).
//
// Deploiement :
//   supabase functions deploy delete-account
// (SANS --no-verify-jwt : Supabase verifie l'identite de l'appelant avant meme
// d'executer cette fonction, en plus de la verification faite ici.)
//
// SUPABASE_URL, SUPABASE_ANON_KEY et SUPABASE_SERVICE_ROLE_KEY sont fournis
// automatiquement a toute Edge Function par la plateforme, aucun secret a definir.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response("Non authentifie", { status: 401, headers: corsHeaders });
  }

  const callerClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: { user }, error: userError } = await callerClient.auth.getUser();
  if (userError || !user) {
    return new Response("Non authentifie", { status: 401, headers: corsHeaders });
  }

  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const { error: deleteError } = await adminClient.auth.admin.deleteUser(user.id);
  if (deleteError) {
    console.error("Suppression du compte " + user.id + " echouee :", deleteError.message);
    return new Response("Echec de la suppression", { status: 500, headers: corsHeaders });
  }

  return new Response("OK", { status: 200, headers: corsHeaders });
});
