// Edge Function: gerenciar-contas
// Operações de conta que exigem privilégio de administrador do Supabase Auth
// (criar usuário com senha definida por outra pessoa, redefinir senha de outra
// pessoa) — por isso não podem rodar no navegador com a chave anônima.
//
// Ainda não é chamada pelo app (Fase 1 da migração pra autenticação real) —
// fica pronta e implantada, e passa a ser usada quando o cadastro de aluno/
// professor e a redefinição de senha migrarem pro Supabase Auth de verdade.
//
// Deploy: npx supabase functions deploy gerenciar-contas

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { acao, email, senha, authUserId } = await req.json();
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    if (acao === "criar") {
      if (!email || !senha) {
        return new Response(JSON.stringify({ error: "email e senha são obrigatórios" }), {
          status: 400,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
      const { data, error } = await supabase.auth.admin.createUser({
        email: String(email).trim().toLowerCase(),
        password: senha,
        email_confirm: true,
      });
      if (error) throw error;
      return new Response(JSON.stringify({ authUserId: data.user.id }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    if (acao === "redefinir_senha") {
      if (!authUserId || !senha) {
        return new Response(JSON.stringify({ error: "authUserId e senha são obrigatórios" }), {
          status: 400,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
      const { error } = await supabase.auth.admin.updateUserById(authUserId, { password: senha });
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "ação desconhecida" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
