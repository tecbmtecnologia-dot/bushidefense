-- Cada professor passa a cadastrar seus próprios planos financeiros, vinculados a ele
-- (coluna professor_id). Um professor não vê mais planos criados por outro professor —
-- só os dele e os "globais" (sem professor_id, cadastrados pelo admin), do mesmo jeito
-- que já funciona hoje pra avisos/vídeos/produtos (ver 2026-09-11_rls_fase2b.sql).
--
-- Aproveita e adiciona a coluna valor_hora, que o app já usa (plano de personal) mas
-- nunca foi persistida no banco — ver PlanoForm/PlanosAdmin em src/App.jsx.
--
-- Rode este arquivo inteiro de uma vez no SQL Editor do Supabase
-- (Dashboard > SQL Editor > New query > colar > Run). Idempotente.

alter table planos add column if not exists professor_id uuid references professores(id) on delete set null;
alter table planos add column if not exists valor_hora numeric;

create index if not exists planos_professor_id_idx on planos(professor_id);

-- A migração 2026-09-11_rls_fase2b.sql tinha colocado "planos" no grupo de tabelas de
-- "referência compartilhada" (leitura livre pra qualquer logado, escrita só admin).
-- Isso não vale mais: agora cada professor escreve os próprios planos e não lê os dos
-- outros. Derruba as duas políticas genéricas daquele bloco antes de criar as novas.
drop policy if exists planos_select_auth on planos;
drop policy if exists planos_write_admin on planos;

alter table planos enable row level security;

-- leitura: admin vê tudo; professor vê os globais (professor_id nulo) + os dele; aluno
-- também precisa enxergar o próprio plano (FinanceiroAluno mostra vencimento/valor),
-- mesmo que o plano pertença a outro professor que não o dele.
drop policy if exists planos_select on planos;
create policy planos_select on planos for select
  using (
    auth_is_admin()
    or professor_id is null
    or professor_id::text = auth_professor_id()::text
    or id::text in (select plano_id::text from alunos where id::text = auth_aluno_id()::text)
  );

drop policy if exists planos_insert on planos;
create policy planos_insert on planos for insert
  with check (auth_is_admin() or professor_id::text = auth_professor_id()::text);

drop policy if exists planos_update on planos;
create policy planos_update on planos for update
  using (auth_is_admin() or professor_id::text = auth_professor_id()::text)
  with check (auth_is_admin() or professor_id::text = auth_professor_id()::text);

drop policy if exists planos_delete on planos;
create policy planos_delete on planos for delete
  using (auth_is_admin() or professor_id::text = auth_professor_id()::text);
