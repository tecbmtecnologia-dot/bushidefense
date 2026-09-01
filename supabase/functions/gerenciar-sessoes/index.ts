// Edge Function: gerenciar-sessoes
// Roda a cada poucos minutos (agendada via Supabase Cron). Para cada turma,
// verifica se o horário atual (fuso de Brasília, UTC-3) está dentro da janela
// de aula: abre o check-in automaticamente perto do início e fecha depois do
// horário de término (ou 60 minutos após o início, se não houver término
// cadastrado). Não interfere quando um professor já abriu manualmente — só
// evita deixar aula aberta ou fechada fora da hora.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const TOLERANCIA_ANTES_MIN = 5; // abre até 5 min antes do horário de início
const DURACAO_PADRAO_MIN = 60; // se não tiver horário de término cadastrado

function agoraBrasilia() {
  // Brasil não tem mais horário de verão desde 2019: deslocamento fixo de -3h.
  const agora = new Date();
  const deslocado = new Date(agora.getTime() - 3 * 60 * 60 * 1000);
  return {
    dia: DIAS[deslocado.getUTCDay()],
    minutosDoDia: deslocado.getUTCHours() * 60 + deslocado.getUTCMinutes(),
  };
}

function paraMinutos(horaStr: string) {
  if (!horaStr || !/^\d{1,2}:\d{2}$/.test(horaStr)) return null;
  const [h, m] = horaStr.split(":").map(Number);
  return h * 60 + m;
}

function randomCode() {
  return (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).toUpperCase();
}

Deno.serve(async () => {
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { dia, minutosDoDia } = agoraBrasilia();

    const { data: turmas, error: errTurmas } = await supabase.from("turmas").select("id, dias, horario, horario_fim");
    const { data: sessoes, error: errSessoes } = await supabase.from("sessoes_checkin").select("id, turma_id, ativa");
    if (errTurmas) throw errTurmas;
    if (errSessoes) throw errSessoes;

    let abertas = 0;
    let fechadas = 0;

    for (const t of turmas || []) {
      const dias: string[] = t.dias || [];
      const inicio = paraMinutos(t.horario);
      if (inicio === null || !dias.includes(dia)) continue;
      const fim = paraMinutos(t.horario_fim) ?? inicio + DURACAO_PADRAO_MIN;

      const deveEstarAberta = minutosDoDia >= inicio - TOLERANCIA_ANTES_MIN && minutosDoDia <= fim;
      const sessaoAtiva = (sessoes || []).find((s: any) => s.turma_id === t.id && s.ativa);

      if (deveEstarAberta && !sessaoAtiva) {
        const { error: errInsert } = await supabase.from("sessoes_checkin").insert({
          turma_id: t.id,
          professor_id: null,
          codigo: randomCode(),
          ativa: true,
        });
        if (errInsert) throw errInsert;
        abertas++;
      } else if (!deveEstarAberta && sessaoAtiva) {
        const { error: errUpdate } = await supabase.from("sessoes_checkin").update({ ativa: false }).eq("id", sessaoAtiva.id);
        if (errUpdate) throw errUpdate;
        fechadas++;
      }
    }

    return new Response(JSON.stringify({ turmas: turmas?.length || 0, abertas, fechadas }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    const mensagem = e && typeof e === "object" ? (e.message || JSON.stringify(e)) : String(e);
    return new Response(JSON.stringify({ error: mensagem }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
