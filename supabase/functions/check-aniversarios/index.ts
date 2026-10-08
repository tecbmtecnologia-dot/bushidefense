// Edge Function: check-aniversarios
// Roda uma vez por dia (agendada via Supabase Cron). Verifica quem faz
// aniversário hoje (alunos e professores) e envia notificação push. Cada
// pessoa só é notificada uma vez por ano, mesmo que a rotina rode mais de
// uma vez no mesmo dia.

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Contato da academia exigido pelo Web Push. Cada projeto Supabase (academia) define o seu
// no secret ACADEMIA_EMAIL; sem ele, usa o da Cia Paulista.
const ACADEMIA_EMAIL = Deno.env.get("ACADEMIA_EMAIL") || "contato@qgciapaulista.com";
webpush.setVapidDetails(`mailto:${ACADEMIA_EMAIL}`, VAPID_PUBLIC, VAPID_PRIVATE);

function hojeBrasilia() {
  // Brasil não tem mais horário de verão desde 2019: deslocamento fixo de -3h.
  const agora = new Date();
  const deslocado = new Date(agora.getTime() - 3 * 60 * 60 * 1000);
  return { mes: deslocado.getUTCMonth() + 1, dia: deslocado.getUTCDate(), ano: deslocado.getUTCFullYear() };
}

Deno.serve(async () => {
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { mes, dia, ano } = hojeBrasilia();

    const { data: academiaRows } = await supabase.from("academia").select("mensagem_aniversario").limit(1);
    const mensagemBase = academiaRows?.[0]?.mensagem_aniversario || `Toda a equipe do ${Deno.env.get("ACADEMIA_SEDE") || "QG"} deseja um ótimo dia. 🥋`;

    const { data: alunos, error: errAlunos } = await supabase.from("alunos").select("id, nome, data_nascimento");
    const { data: professores, error: errProfessores } = await supabase.from("professores").select("id, nome, data_nascimento");
    if (errAlunos) throw errAlunos;
    if (errProfessores) throw errProfessores;

    const aniversariantes = [
      ...(alunos || []).map((a: any) => ({ ...a, tipo: "aluno" })),
      ...(professores || []).map((p: any) => ({ ...p, tipo: "professor" })),
    ].filter((p) => {
      if (!p.data_nascimento) return false;
      const [, m, d] = p.data_nascimento.split("-").map(Number);
      return m === mes && d === dia;
    });

    let notificados = 0;
    for (const pessoa of aniversariantes) {
      const { data: jaEnviado } = await supabase
        .from("notificacoes_aniversario")
        .select("id")
        .eq("pessoa_id", pessoa.id)
        .eq("tipo", pessoa.tipo)
        .eq("ano", ano)
        .maybeSingle();
      if (jaEnviado) continue;

      const coluna = pessoa.tipo === "aluno" ? "aluno_id" : "professor_id";
      const { data: subs } = await supabase.from("push_subscriptions").select("*").eq(coluna, pessoa.id);

      const primeiroNome = String(pessoa.nome).split(" ")[0];
      const payload = JSON.stringify({
        titulo: `Feliz aniversário, ${primeiroNome}! 🎉`,
        mensagem: mensagemBase.split("{nome}").join(primeiroNome),
      });

      for (const s of subs || []) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
        } catch (_) {
          await supabase.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
        }
      }

      await supabase.from("notificacoes_aniversario").insert({ pessoa_id: pessoa.id, tipo: pessoa.tipo, ano });
      notificados++;
    }

    return new Response(JSON.stringify({ aniversariantesHoje: aniversariantes.length, notificados }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    const mensagem = e && typeof e === "object" ? (e.message || JSON.stringify(e)) : String(e);
    return new Response(JSON.stringify({ error: mensagem }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
