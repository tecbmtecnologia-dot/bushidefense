-- Professor principal (Felipe Rodrigues) pode também EDITAR e DESATIVAR/REATIVAR professores pelo
-- app do professor. Excluir continua só com o admin.
--
-- SÓ PARA A BUSHI DEFENSE — depende de auth_is_professor_principal()
-- (2026-11-07_principal_cadastra_professores.sql, rode aquele antes). Não rode na Cia Paulista.
--
-- Rode este arquivo inteiro de uma vez no SQL Editor do Supabase
-- (Dashboard > SQL Editor > New query > colar > Run).
--
-- Idempotente: "drop policy if exists" antes de recriar.

drop policy if exists professores_update on professores;
create policy professores_update on professores for update
  using (auth_is_admin() or id = auth_professor_id() or auth_is_professor_principal())
  with check (auth_is_admin() or id = auth_professor_id() or auth_is_professor_principal());
