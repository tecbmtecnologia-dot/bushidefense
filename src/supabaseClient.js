// Cada academia (deploy) pode ter seu próprio Supabase, configurado via variáveis de
// ambiente (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY) no Netlify ou no arquivo .env local.
// Sem essa configuração o app não sobe — de propósito: este projeto NUNCA pode cair no banco
// de outra academia.
//
// VITE_SUPABASE_ANON_KEY aceita tanto a chave legada "anon" (eyJ...) quanto a "publishable
// key" nova do Supabase (sb_publishable_...) — as duas funcionam do mesmo jeito nos headers
// apikey/Authorization abaixo.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error("Supabase não configurado: defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY (Netlify ou .env).");
}

export const SUPABASE_KEY_EXPORT = SUPABASE_KEY;
export const SUPABASE_URL_EXPORT = SUPABASE_URL;

// Cliente oficial, usado pra autenticação real (Supabase Auth) — login, sessão e refresh de
// token. `pg` abaixo usa a sessão daqui pra anexar o token de quem está logado nas leituras/
// escritas (necessário pra RLS liberar as linhas certas pra cada papel).
//
// index.html, alunos.html e professores.html são 3 páginas separadas do mesmo site (mesma
// origem), mas cada uma loga um papel diferente (admin/aluno/professor) — por isso a chave de
// armazenamento da sessão inclui o pathname: sem isso, logar como aluno numa aba derrubaria a
// sessão do professor lembrada em outra aba do mesmo navegador, já que as duas dividiriam a
// mesma entrada no localStorage.
const STORAGE_KEY = `qg-auth-session-${typeof window !== "undefined" ? window.location.pathname : "default"}`;

// Onde a sessão é gravada quando a pessoa loga: localStorage (sobrevive fechar o navegador,
// "lembrar" marcado) ou sessionStorage (some ao fechar a aba, "lembrar" desmarcado). As telas de
// login chamam definirLembrarSessao(lembrar) logo antes de supabaseAuth.signInWithPassword.
let storageAtiva = (() => { try { return window.localStorage; } catch (_) { return undefined; } })();

export function definirLembrarSessao(lembrar) {
  try { storageAtiva = lembrar ? window.localStorage : window.sessionStorage; } catch (_) {}
}

const storageAdapter = {
  getItem: (key) => {
    try { return window.localStorage.getItem(key) ?? window.sessionStorage.getItem(key); } catch (_) { return null; }
  },
  setItem: (key, value) => {
    try {
      storageAtiva.setItem(key, value);
      const outra = storageAtiva === window.localStorage ? window.sessionStorage : window.localStorage;
      outra.removeItem(key);
    } catch (_) {}
  },
  removeItem: (key) => {
    try { window.localStorage.removeItem(key); window.sessionStorage.removeItem(key); } catch (_) {}
  },
};

export const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: STORAGE_KEY, storage: storageAdapter },
}).auth;

const BASE = `${SUPABASE_URL}/rest/v1`;
const STORAGE_BASE = `${SUPABASE_URL}/storage/v1`;

async function pgFetch(path, options = {}) {
  // apikey é sempre a chave publicável; Authorization leva o token de quem está logado (papel
  // "authenticated" no Postgres, o que a RLS usa pra decidir o que cada um pode ver) — ou, sem
  // sessão, a própria chave publicável (papel "anon", só o que a RLS libera publicamente).
  let token = SUPABASE_KEY;
  try {
    const { data } = await supabaseAuth.getSession();
    if (data?.session?.access_token) token = data.session.access_token;
  } catch (_) {}
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = await res.json();
      msg = j.message || j.error_description || msg;
    } catch (_) {}
    throw new Error(`Supabase ${res.status}: ${msg}`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export const pg = {
  select: (table, params = "select=*") => pgFetch(`/${table}?${params}`),
  // O Supabase corta cada resposta em "max rows" (1000 por padrão) — sem paginar, uma tabela que
  // cresce sem parar (check-ins, graduações) vinha pela metade: o histórico do aluno sumia e, pior,
  // o syncTable achava que as linhas que não vieram tinham sido excluídas. Busca página por página
  // até vir uma página vazia, então funciona com qualquer limite do servidor. Só pra tabelas com
  // coluna `id` (desempate da ordem — sem ordem total, a mesma linha poderia cair em duas páginas
  // ou em nenhuma).
  selectAll: async (table, params = "select=*") => {
    const comOrdem = /(^|&)order=/.test(params) ? params.replace(/((?:^|&)order=[^&]*)/, "$1,id.asc") : `${params}&order=id.asc`;
    const todas = [];
    for (;;) {
      const pagina = await pgFetch(`/${table}?${comOrdem}&limit=1000&offset=${todas.length}`);
      if (!pagina || pagina.length === 0) return todas;
      todas.push(...pagina);
    }
  },
  // As linhas podem vir com chaves diferentes (campo ausente = "use o default da coluna"):
  // `columns` lista a união de todas as chaves e `missing=default` faz o Postgres preencher as
  // que faltam numa linha com o DEFAULT da coluna em vez de null — senão uma coluna NOT NULL
  // com default (ex: alunos.ajuste_aulas) quebra o cadastro inteiro.
  upsert: (table, rows) => {
    const colunas = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    return pgFetch(`/${table}?columns=${colunas.join(",")}`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,missing=default,return=minimal" },
      body: JSON.stringify(rows),
    });
  },
  update: (table, id, patch) =>
    pgFetch(`/${table}?id=eq.${id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(patch),
    }),
  deleteIn: (table, ids) =>
    pgFetch(`/${table}?id=in.(${ids.join(",")})`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    }),
  deleteWhere: (table, coluna, valor) =>
    pgFetch(`/${table}?${coluna}=eq.${valor}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    }),
};

// Token de quem está logado (papel "authenticated"). O Storage só aceita upload/remoção de
// usuários logados — com a chave publicável (papel "anon") qualquer um conseguiria apagar arquivos.
async function tokenAtual() {
  try {
    const { data } = await supabaseAuth.getSession();
    if (data?.session?.access_token) return data.session.access_token;
  } catch (_) {}
  return SUPABASE_KEY;
}

export async function uploadArquivo(bucket, file, onProgress) {
  const nomeArquivo = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const token = await tokenAtual();
  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${STORAGE_BASE}/object/${bucket}/${nomeArquivo}`);
    xhr.setRequestHeader("apikey", SUPABASE_KEY);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => { if (onProgress && e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => { if (xhr.status >= 200 && xhr.status < 300) resolve(); else reject(new Error(`Falha no upload (${xhr.status}): ${xhr.responseText}`)); };
    xhr.onerror = () => reject(new Error("Falha de rede no upload."));
    xhr.send(file);
  });
  return `${STORAGE_BASE}/object/public/${bucket}/${nomeArquivo}`;
}

export async function removerArquivo(bucket, urlPublica) {
  try {
    const marcador = `/object/public/${bucket}/`;
    const idx = urlPublica.indexOf(marcador);
    if (idx === -1) return;
    const nomeArquivo = urlPublica.slice(idx + marcador.length);
    await fetch(`${STORAGE_BASE}/object/${bucket}/${nomeArquivo}`, {
      method: "DELETE",
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${await tokenAtual()}` },
    });
  } catch (_) {
    // Se falhar, não é grave — o vídeo já foi marcado como visto e não vai mais aparecer no app.
  }
}
