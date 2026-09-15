// Edge Function: limpar-fotos-treino
// Roda uma vez por dia (agendada via Supabase Cron, igual check-vencimentos e
// check-aniversarios). Apaga do storage e da tabela `fotos_treino` toda foto
// de treino publicada há 5 dias ou mais.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DIAS_PARA_EXPIRAR = 5;
const BUCKET = "fotos-treino";

Deno.serve(async () => {
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const limite = new Date(Date.now() - DIAS_PARA_EXPIRAR * 86400000).toISOString();

    const { data: expiradas, error: errSelect } = await supabase
      .from("fotos_treino")
      .select("id, foto_url")
      .lt("criado_em", limite);
    if (errSelect) throw errSelect;

    if (!expiradas || expiradas.length === 0) {
      return new Response(JSON.stringify({ removidas: 0 }), { headers: { "Content-Type": "application/json" } });
    }

    const nomesArquivos = expiradas
      .map((f) => {
        const marcador = `/object/public/${BUCKET}/`;
        const idx = (f.foto_url || "").indexOf(marcador);
        return idx === -1 ? null : f.foto_url.slice(idx + marcador.length);
      })
      .filter((n): n is string => !!n);

    if (nomesArquivos.length > 0) {
      await supabase.storage.from(BUCKET).remove(nomesArquivos);
    }

    const { error: errDelete } = await supabase
      .from("fotos_treino")
      .delete()
      .in("id", expiradas.map((f) => f.id));
    if (errDelete) throw errDelete;

    return new Response(JSON.stringify({ removidas: expiradas.length }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
