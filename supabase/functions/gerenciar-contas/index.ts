// Edge Function: gerenciar-contas
// Operações de conta que exigem privilégio de administrador do Supabase Auth
// (criar usuário com senha definida por outra pessoa, redefinir senha de outra
// pessoa, excluir conta) — por isso não podem rodar no navegador com a chave
// anônima.
//
// SEGURANÇA (corrigido 2026-09-14): até então esta function não conferia quem
// estava chamando — qualquer um com a chave pública do app (exposta no bundle
// JS, é pública por definição) podia criar contas ou redefinir a senha de
// QUALQUER authUserId. Agora exige um token de sessão real (de admin ou
// professor logado) no header Authorization, e valida contra as tabelas
// `academia`/`professores` antes de executar qualquer ação. O app (db.js,
// chamarGerenciarContas) já manda o token da sessão atual, não mais a chave
// pública.
//
// SEGURANÇA (corrigido 2026-11-07): ainda assim, qualquer professor logado podia
// redefinir senha / trocar e-mail / excluir a conta de QUALQUER authUserId
// (inclusive a do admin) chamando a function direto. Agora, pra quem não é
// admin, as ações sobre uma conta existente passam por podeMexerNaConta():
//   - conta do admin: nunca;
//   - conta de professor: só a própria, ou o professor principal (Bushi:
//     dono da linha em historia_academia) mexendo em outro professor;
//   - conta de aluno: só se TODAS as linhas de aluno com esse login forem do
//     professor que chama;
//   - conta sem cadastro (a linha já foi apagada antes): só "excluir".
// "criar" continua liberado pra professor (só cria login novo).
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
    // service role: só usado DEPOIS de confirmar que quem chamou é admin ou professor.
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) {
      return new Response(JSON.stringify({ error: "não autenticado" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    const { data: quemChama, error: erroAuth } = await supabase.auth.getUser(token);
    if (erroAuth || !quemChama?.user) {
      return new Response(JSON.stringify({ error: "sessão inválida" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    const chamadorId = quemChama.user.id;
    const [{ data: academiaRows }, { data: profRows }] = await Promise.all([
      supabase.from("academia").select("id").eq("admin_auth_user_id", chamadorId).limit(1),
      supabase.from("professores").select("id").eq("auth_user_id", chamadorId).neq("ativo", false).limit(1),
    ]);
    const ehAdmin = (academiaRows || []).length > 0;
    const ehProfessor = (profRows || []).length > 0;
    const chamadorProfId = profRows?.[0]?.id ?? null;
    if (!ehAdmin && !ehProfessor) {
      return new Response(JSON.stringify({ error: "sem permissão pra gerenciar contas" }), {
        status: 403,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const negar = () =>
      new Response(JSON.stringify({ error: "sem permissão pra mexer nesta conta" }), {
        status: 403,
        headers: { ...cors, "Content-Type": "application/json" },
      });

    // Quem não é admin só mexe em contas que estão sob a responsabilidade dele (ver topo).
    const podeMexerNaConta = async (alvo: string): Promise<boolean> => {
      if (ehAdmin) return true;
      if (!alvo) return false;
      const [{ data: alvoAdmin }, { data: alvoProf }, { data: alvoAlunos }] = await Promise.all([
        supabase.from("academia").select("id").eq("admin_auth_user_id", alvo).limit(1),
        supabase.from("professores").select("id").eq("auth_user_id", alvo),
        supabase.from("alunos").select("professor_id").eq("auth_user_id", alvo),
      ]);
      if ((alvoAdmin || []).length) return false;
      if ((alvoProf || []).length) {
        if (alvo === chamadorId) return true;
        // historia_academia só existe na Bushi; sem a tabela, ninguém é principal.
        const { data: principal, error: erroPrincipal } = await supabase
          .from("historia_academia").select("professor_id").eq("id", 1).limit(1);
        return !erroPrincipal && !!chamadorProfId && String(principal?.[0]?.professor_id) === String(chamadorProfId);
      }
      if ((alvoAlunos || []).length) {
        return !!chamadorProfId && alvoAlunos!.every((a) => String(a.professor_id) === String(chamadorProfId));
      }
      return acao === "excluir";
    };
    if (acao === "excluir" || acao === "redefinir_senha" || acao === "atualizar_email") {
      if (authUserId && !(await podeMexerNaConta(String(authUserId)))) return negar();
    }

    if (acao === "excluir") {
      if (!authUserId) {
        return new Response(JSON.stringify({ error: "authUserId é obrigatório" }), {
          status: 400,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
      const { error } = await supabase.auth.admin.deleteUser(authUserId);
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

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

    if (acao === "atualizar_email") {
      if (!authUserId || !email) {
        return new Response(JSON.stringify({ error: "authUserId e email são obrigatórios" }), {
          status: 400,
          headers: { ...cors, "Content-Type": "application/json" },
        });
      }
      const { error } = await supabase.auth.admin.updateUserById(authUserId, {
        email: String(email).trim().toLowerCase(),
        email_confirm: true,
      });
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
