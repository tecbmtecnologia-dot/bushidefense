#!/usr/bin/env node
// Migra os cadastros existentes (alunos, professores e o admin) para o Supabase Auth de
// verdade — cria um usuário em auth.users pra cada um, com a MESMA senha que já está
// cadastrada hoje, e salva o id retornado na coluna auth_user_id (ou admin_auth_user_id,
// no caso do admin) do registro correspondente.
//
// Roda local, nunca no navegador — usa a SERVICE ROLE KEY (Supabase > Project Settings >
// API > service_role), que nunca deve ir pro código do app nem ser commitada.
//
// Antes de rodar de verdade, roda com --dry-run pra conferir o que seria feito.
//
// Uso (PowerShell):
//   $env:SUPABASE_URL="https://SEU-PROJETO.supabase.co"
//   $env:SUPABASE_SERVICE_ROLE_KEY="a chave service_role"
//   $env:ADMIN_EMAIL="seu-email@exemplo.com"
//   node scripts/migrar-auth.mjs --dry-run
//   node scripts/migrar-auth.mjs
//
// Uso (bash):
//   SUPABASE_URL="https://SEU-PROJETO.supabase.co" SUPABASE_SERVICE_ROLE_KEY="..." ADMIN_EMAIL="voce@email.com" node scripts/migrar-auth.mjs --dry-run

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const DRY_RUN = process.argv.includes("--dry-run");

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Faltou SUPABASE_URL e/ou SUPABASE_SERVICE_ROLE_KEY nas variáveis de ambiente.");
  process.exit(1);
}
if (!/^eyJ/.test(SERVICE_ROLE_KEY.trim())) {
  console.error(
    "SUPABASE_SERVICE_ROLE_KEY não parece uma chave válida (deveria começar com \"eyJ\").\n" +
    "Confira se copiou a chave 'service_role' (não a 'anon') em Project Settings > API,\n" +
    "e se não sobrou aspas ou espaço a mais ao colar no $env:."
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function migrarTabela(tabela) {
  const { data: linhas, error } = await supabase.from(tabela).select("id, nome, email, senha, auth_user_id");
  if (error) throw new Error(`Erro lendo ${tabela}: ${error.message}`);

  const pendentes = (linhas || []).filter((l) => l.email && l.email.trim() && !l.auth_user_id);
  console.log(`\n${tabela}: ${linhas.length} no total, ${pendentes.length} pendente(s) de migração.`);

  let ok = 0;
  const erros = [];
  for (const l of pendentes) {
    const email = l.email.trim().toLowerCase();
    const senha = (l.senha || "").trim();
    if (!senha) { erros.push(`${l.nome} (${email}): sem senha cadastrada, pulado.`); continue; }

    if (DRY_RUN) { console.log(`  [dry-run] criaria auth.users para ${l.nome} <${email}>`); ok++; continue; }

    const { data: criado, error: errCriar } = await supabase.auth.admin.createUser({
      email,
      password: senha,
      email_confirm: true,
      user_metadata: { nome: l.nome, tabela },
    });
    if (errCriar) { erros.push(`${l.nome} (${email}): ${errCriar.message}`); continue; }

    const { error: errUpdate } = await supabase.from(tabela).update({ auth_user_id: criado.user.id }).eq("id", l.id);
    if (errUpdate) { erros.push(`${l.nome} (${email}): criado no Auth mas falhou salvar auth_user_id — ${errUpdate.message}`); continue; }

    ok++;
    console.log(`  ✓ ${l.nome} <${email}>`);
  }

  console.log(`${tabela}: ${ok} migrado(s), ${erros.length} erro(s)/aviso(s).`);
  erros.forEach((e) => console.log(`  ! ${e}`));
  return { ok, erros };
}

async function migrarAdmin() {
  if (!ADMIN_EMAIL) {
    console.log("\nadmin: ADMIN_EMAIL não informado — pulando (defina ADMIN_EMAIL=voce@email.com pra migrar o admin também).");
    return;
  }
  const { data: academiaRows, error } = await supabase.from("academia").select("id, senha_admin, admin_auth_user_id").limit(1);
  if (error) throw new Error(`Erro lendo academia: ${error.message}`);
  const academia = academiaRows && academiaRows[0];
  if (!academia) { console.log("\nadmin: tabela academia vazia, pulando."); return; }
  if (academia.admin_auth_user_id) { console.log("\nadmin: já migrado."); return; }
  if (!academia.senha_admin) { console.log("\nadmin: sem senha_admin cadastrada, pulando."); return; }

  console.log(`\nadmin: migrando <${ADMIN_EMAIL}>...`);
  if (DRY_RUN) { console.log(`  [dry-run] criaria auth.users para o admin <${ADMIN_EMAIL}>`); return; }

  const { data: criado, error: errCriar } = await supabase.auth.admin.createUser({
    email: ADMIN_EMAIL.trim().toLowerCase(),
    password: academia.senha_admin,
    email_confirm: true,
    user_metadata: { papel: "admin" },
  });
  if (errCriar) { console.log(`  ! ${errCriar.message}`); return; }

  const { error: errUpdate } = await supabase.from("academia").update({ admin_auth_user_id: criado.user.id }).eq("id", academia.id);
  if (errUpdate) { console.log(`  ! criado no Auth mas falhou salvar admin_auth_user_id — ${errUpdate.message}`); return; }

  console.log(`  ✓ admin <${ADMIN_EMAIL}>`);
}

async function main() {
  console.log(DRY_RUN ? "=== MODO DRY-RUN (nada será criado de verdade) ===" : "=== Migrando para o Supabase Auth ===");
  await migrarTabela("alunos");
  await migrarTabela("professores");
  await migrarAdmin();
  console.log("\nConcluído.");
}

main().catch((e) => {
  console.error("Falha:", e.message);
  process.exitCode = 1;
});
