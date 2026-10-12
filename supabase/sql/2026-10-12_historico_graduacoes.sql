-- Histórico de graduações do aluno. O cadastro (alunos.faixa_id / alunos.grau) só guarda a
-- faixa ATUAL — ao graduar, a anterior era sobrescrita e se perdia. Agora cada grau/faixa
-- recebido vira uma linha aqui (faixa e grau de antes e de depois, data, quantas aulas ele fez
-- naquela etapa e quem graduou). O app do aluno mostra essa linha do tempo na página Evolução
-- e separa o histórico de treinos pela faixa que ele tinha em cada dia.
--
-- tipo: 'grau' | 'faixa' (botões de graduar) ou 'ajuste' (faixa/grau mudados na edição do cadastro).
-- Os nomes das faixas vão copiados na linha pra o histórico continuar legível mesmo se a faixa
-- for renomeada ou removida depois (por isso faixa_*_id não tem FK).
--
-- Quem já está graduado não tem histórico anterior (ele nunca foi gravado): a linha do tempo
-- desses alunos começa na faixa atual e vai crescendo a partir da próxima graduação.
--
-- Rodar ANTES de publicar o código que usa essa tabela — sem ela, o botão de graduar falha ao
-- salvar. Idempotente. Rodar nas duas bases (Bushi Defense e Cia Paulista).

-- aluno_id com o mesmo tipo de alunos.id (a FK exige), seja uuid ou text.
do $$
declare
  tipo_id text;
begin
  select format_type(a.atttypid, a.atttypmod) into tipo_id
  from pg_attribute a
  where a.attrelid = 'public.alunos'::regclass and a.attname = 'id';

  execute format($f$
    create table if not exists public.graduacoes (
      id %1$s primary key,
      aluno_id %1$s not null references public.alunos(id) on delete cascade,
      data timestamptz not null default now(),
      tipo text not null default 'grau',
      faixa_anterior_id text,
      faixa_anterior_nome text,
      grau_anterior integer,
      faixa_nova_id text,
      faixa_nova_nome text,
      grau_novo integer not null default 0,
      aulas integer,
      professor_id text,
      registrado_por text
    )$f$, tipo_id);
end $$;

create index if not exists graduacoes_aluno_id_idx on public.graduacoes(aluno_id);

-- Mesma regra de pagamentos/checkins (2026-09-11_rls_fase2b.sql): admin vê e grava tudo;
-- professor só dos alunos vinculados a ele; aluno só lê o próprio histórico.
alter table public.graduacoes enable row level security;

drop policy if exists graduacoes_select on public.graduacoes;
create policy graduacoes_select on public.graduacoes for select
  using (
    auth_is_admin()
    or aluno_id::text in (select id::text from alunos where professor_id::text = auth_professor_id()::text)
    or aluno_id::text = auth_aluno_id()::text
  );

drop policy if exists graduacoes_write_admin_ou_professor on public.graduacoes;
create policy graduacoes_write_admin_ou_professor on public.graduacoes for all
  using (auth_is_admin() or aluno_id::text in (select id::text from alunos where professor_id::text = auth_professor_id()::text))
  with check (auth_is_admin() or aluno_id::text in (select id::text from alunos where professor_id::text = auth_professor_id()::text));
