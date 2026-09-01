// Cada academia (deploy) pode ter seu próprio Supabase, configurado via variáveis de
// ambiente (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY) no Netlify. Sem essa configuração
// (ex: build local sem .env), cai no banco padrão da Cia Paulista — mantém tudo funcionando
// como já funcionava antes, sem precisar mexer em nada pro deploy atual.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://bzcvckrlettgnauvcmaz.supabase.co";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ6Y3Zja3JsZXR0Z25hdXZjbWF6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzODg4ODEsImV4cCI6MjEwMTk2NDg4MX0.QzUohc8ykAehZgRHTqFkM38HIBQemtd9godKDpVikCc";

export const SUPABASE_ANON_KEY_EXPORT = SUPABASE_ANON_KEY;
export const SUPABASE_URL_EXPORT = SUPABASE_URL;

const BASE = `${SUPABASE_URL}/rest/v1`;
const STORAGE_BASE = `${SUPABASE_URL}/storage/v1`;

async function pgFetch(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
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
  upsert: (table, rows) =>
    pgFetch(`/${table}`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows),
    }),
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
};

export async function uploadArquivo(bucket, file, onProgress) {
  const nomeArquivo = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${STORAGE_BASE}/object/${bucket}/${nomeArquivo}`);
    xhr.setRequestHeader("apikey", SUPABASE_ANON_KEY);
    xhr.setRequestHeader("Authorization", `Bearer ${SUPABASE_ANON_KEY}`);
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
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    });
  } catch (_) {
    // Se falhar, não é grave — o vídeo já foi marcado como visto e não vai mais aparecer no app.
  }
}
