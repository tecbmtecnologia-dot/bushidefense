// Edge Function: send-push
// Envia notificações push de verdade (chegam mesmo com o app fechado) para todos os
// alunos inscritos, usando as chaves VAPID configuradas como secrets do projeto.
//
// Deploy: veja o arquivo qg-push-deploy-instrucoes.md

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

webpush.setVapidDetails("mailto:contato@qgciapaulista.com", VAPID_PUBLIC, VAPID_PRIVATE);

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const { titulo, mensagem, alunoId, professorId, professorAlunosId } = await req.json();
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    let query = supabase.from("push_subscriptions").select("*");
    if (alunoId) {
      query = query.eq("aluno_id", alunoId);
    } else if (professorId) {
      query = query.eq("professor_id", professorId);
    } else if (professorAlunosId) {
      const { data: alunosDoProfessor } = await supabase.from("alunos").select("id").eq("professor_id", professorAlunosId);
      const ids = (alunosDoProfessor || []).map((a) => a.id);
      if (ids.length === 0) {
        return new Response(JSON.stringify({ enviados: 0, falharam: 0 }), { headers: { ...cors, "Content-Type": "application/json" } });
      }
      query = query.in("aluno_id", ids);
    }
    const { data: subs, error } = await query;
    if (error) throw error;

    const payload = JSON.stringify({ titulo, mensagem });
    const resultados = await Promise.allSettled(
      (subs || []).map((s) =>
        webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload
        )
      )
    );

    const falharam = resultados.filter((r) => r.status === "rejected");
    // Remove inscrições que não são mais válidas (usuário desinstalou, etc.)
    for (let i = 0; i < resultados.length; i++) {
      if (resultados[i].status === "rejected") {
        await supabase.from("push_subscriptions").delete().eq("endpoint", subs[i].endpoint);
      }
    }

    return new Response(JSON.stringify({ enviados: resultados.length - falharam.length, falharam: falharam.length }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
