-- Professor principal (Felipe Rodrigues) pode também EXCLUIR professores pelo app do professor.
-- Ele não pode excluir a si mesmo: isso apagaria em cascata a linha de historia_academia (PDFs).
--
-- SÓ PARA A BUSHI DEFENSE — depende de auth_is_professor_principal()
-- (2026-11-07_principal_cadastra_professores.sql). Não rode na Cia Paulista.
--
-- Rode este arquivo inteiro de uma vez no SQL Editor do Supabase
-- (Dashboard > SQL Editor > New query > colar > Run).
--
-- Idempotente: "drop policy if exists" antes de recriar.

drop policy if exists professores_delete_admin on professores;
create policy professores_delete_admin on professores for delete
  using (auth_is_admin() or (auth_is_professor_principal() and id <> auth_professor_id()));
