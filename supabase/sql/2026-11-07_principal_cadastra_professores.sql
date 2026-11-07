-- Professor principal (Felipe Rodrigues, dono da linha em historia_academia) pode CADASTRAR
-- professores novos pelo app do professor. Editar/excluir professores continua só com o admin.
--
-- SÓ PARA A BUSHI DEFENSE — depende da tabela historia_academia (2026-10-31_historia_academia.sql).
-- Não rode na base da Cia Paulista.
--
-- Rode este arquivo inteiro de uma vez no SQL Editor do Supabase
-- (Dashboard > SQL Editor > New query > colar > Run).
--
-- Idempotente: "create or replace" / "drop policy if exists".

create or replace function public.auth_is_professor_principal()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from historia_academia
    where id = 1 and professor_id = auth_professor_id()
  );
$$;

drop policy if exists professores_insert_admin on professores;
create policy professores_insert_admin on professores for insert
  with check (auth_is_admin() or id = auth_professor_id() or auth_is_professor_principal());
