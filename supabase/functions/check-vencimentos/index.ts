// Edge Function: check-vencimentos
// Roda uma vez por dia (agendada via Supabase Cron). Para cada aluno, calcula
// a data de vencimento da mensalidade e envia notificação push quando faltar
// exatamente 5, 4, 3, 2 ou 1 dia. Cada combinação (aluno + vencimento + dias
// restantes) só é notificada uma vez, mesmo que a rotina rode mais de uma vez
// no mesmo dia.

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

webpush.setVapidDetails("mailto:contato@qgciapaulista.com", VAPID_PUBLIC, VAPID_PRIVATE);

const PERIOD_MESES: Record<string, number> = { mensal: 1, trimestral: 3, semestral: 6, anual: 12 };
const DIAS_AVISO = [5, 4, 3, 2, 1];

function addMeses(dataStr: string, n: number) {
  const [y, m, d] = dataStr.split("-").map(Number);
  const dt = new Date(y, m - 1 + n, d);
  return dt.toISOString().slice(0, 10);
}

function hojeStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function diffDias(alvo: string, base: string) {
  const da = new Date(alvo + "T00:00:00");
  const db = new Date(base + "T00:00:00");
  return Math.round((da.getTime() - db.getTime()) / 86400000);
}

Deno.serve(async () => {
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const hoje = hojeStr();

    const { data: alunos, error: errAlunos } = await supabase
      .from("alunos")
      .select("id, plano_id, ultimo_pagamento, dia_vencimento");
    const { data: planos, error: errPlanos } = await supabase
      .from("planos")
      .select("id, valor, periodicidade");
    if (errAlunos) throw errAlunos;
    if (errPlanos) throw errPlanos;

    const planosPorId = Object.fromEntries((planos || []).map((p: any) => [p.id, p]));
    const alvos: { alunoId: string; dias: number; vencimento: string }[] = [];

    for (const a of alunos || []) {
      const plano = planosPorId[a.plano_id];
      if (!plano || Number(plano.valor) === 0 || !a.ultimo_pagamento) continue;
      let vencimento = addMeses(a.ultimo_pagamento, PERIOD_MESES[plano.periodicidade] || 1);
      if (a.dia_vencimento) {
        const [y, m] = vencimento.split("-");
        vencimento = `${y}-${m}-${String(a.dia_vencimento).padStart(2, "0")}`;
      }
      const dias = diffDias(vencimento, hoje);
      if (DIAS_AVISO.includes(dias)) alvos.push({ alunoId: a.id, dias, vencimento });
    }

    let notificados = 0;
    for (const alvo of alvos) {
      const { data: jaEnviado } = await supabase
        .from("notificacoes_vencimento")
        .select("id")
        .eq("aluno_id", alvo.alunoId)
        .eq("vencimento", alvo.vencimento)
        .eq("dias_restantes", alvo.dias)
        .maybeSingle();
      if (jaEnviado) continue;

      const { data: subs } = await supabase.from("push_subscriptions").select("*").eq("aluno_id", alvo.alunoId);
      const titulo = "Mensalidade próxima do vencimento";
      const mensagem = alvo.dias === 1 ? "Sua mensalidade vence amanhã." : `Sua mensalidade vence em ${alvo.dias} dias.`;
      const payload = JSON.stringify({ titulo, mensagem });

      for (const s of subs || []) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
        } catch (_) {
          await supabase.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
        }
      }

      await supabase.from("notificacoes_vencimento").insert({ aluno_id: alvo.alunoId, vencimento: alvo.vencimento, dias_restantes: alvo.dias });
      notificados++;
    }

    return new Response(JSON.stringify({ verificados: alunos?.length || 0, notificados }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
