-- Metodologia de aula do professor (aquecimento, técnicas, alongamento,
-- treinos...), escrita no app do professor, na aba "Mais".
--
-- Fica numa tabela separada (e não numa coluna de "professores") porque a
-- tabela "professores" é legível por qualquer usuário logado, inclusive
-- alunos. Aqui a RLS só deixa o próprio professor ler e escrever a própria
-- metodologia — aluno não enxerga nem pela API.
--
-- Rode este arquivo inteiro de uma vez no SQL Editor do Supabase
-- (Dashboard > SQL Editor > New query > colar > Run).
--
-- Idempotente: "if not exists" / "drop policy if exists" antes de recriar.

create table if not exists metodologias_professor (
  professor_id uuid primary key references professores(id) on delete cascade,
  texto text,
  atualizado_em timestamptz not null default now()
);

alter table metodologias_professor enable row level security;

drop policy if exists metodologias_select on metodologias_professor;
create policy metodologias_select on metodologias_professor for select
  using (professor_id = auth_professor_id());

drop policy if exists metodologias_insert on metodologias_professor;
create policy metodologias_insert on metodologias_professor for insert
  with check (professor_id = auth_professor_id());

drop policy if exists metodologias_update on metodologias_professor;
create policy metodologias_update on metodologias_professor for update
  using (professor_id = auth_professor_id())
  with check (professor_id = auth_professor_id());
