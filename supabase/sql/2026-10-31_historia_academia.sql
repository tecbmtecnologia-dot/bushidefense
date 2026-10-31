-- PDF "Sobre a Bushi Defense" (história da academia), enviado pelo professor principal no app do
-- professor e exibido pro aluno na aba "Mais".
--
-- SÓ PARA A BUSHI DEFENSE — não rode na base da Cia Paulista. Sem esta tabela o app simplesmente
-- não mostra o card (nem pro professor, nem pro aluno).
--
-- Fica numa tabela própria, com uma única linha (id = 1), em vez de colunas em "academia": a
-- tabela "academia" só aceita escrita do admin, e aqui quem escreve é um professor. A linha já
-- nasce com o professor dono (Felipe Rodrigues); a RLS só deixa ESSE professor alterar o PDF, e
-- ele não consegue trocar o dono da linha. Qualquer usuário logado (aluno/professor/admin) lê.
--
-- Pra trocar o professor principal no futuro (só o admin, pelo SQL Editor):
--   update historia_academia set professor_id = '<id do professor>' where id = 1;
--
-- Rode este arquivo inteiro de uma vez no SQL Editor do Supabase
-- (Dashboard > SQL Editor > New query > colar > Run).
--
-- Idempotente: "if not exists" / "on conflict do nothing" / "drop policy if exists".

create table if not exists historia_academia (
  id int primary key default 1 check (id = 1),
  professor_id uuid not null references professores(id) on delete cascade,
  pdf text,
  pdf_nome text,
  atualizado_em timestamptz not null default now()
);

-- Felipe Rodrigues (feliperm87@gmail.com), professor principal da Bushi Defense.
insert into historia_academia (id, professor_id)
values (1, '0cf1e178-f7fe-4175-9b0d-862e062983d0')
on conflict (id) do nothing;

alter table historia_academia enable row level security;

drop policy if exists historia_select on historia_academia;
create policy historia_select on historia_academia for select
  using (auth.uid() is not null);

drop policy if exists historia_update on historia_academia;
create policy historia_update on historia_academia for update
  using (auth_is_admin() or professor_id = auth_professor_id())
  with check (auth_is_admin() or professor_id = auth_professor_id());
