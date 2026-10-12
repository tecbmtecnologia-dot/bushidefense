-- Excluir turma pelo painel falhava com:
--   409 update or delete on table "turmas" violates foreign key constraint
--   "sessoes_checkin_turma_id_fkey" on table "sessoes_checkin"
-- Toda turma que já teve aula iniciada tem sessões de check-in apontando pra ela,
-- e a FK não tinha ação de exclusão (NO ACTION) — o banco travava o delete.
--
-- Solução: as FKs que apontam pra turmas passam a ser ON DELETE SET NULL. A turma
-- some, mas as sessões e os check-ins dos alunos (histórico de presença, contagem
-- de aulas pra graduação, relatórios) continuam intactos, só sem turma vinculada.
-- O app já trata sessão sem turma (mostra o check-in sem o nome do treino).
-- Vale também pra alunos.turma_id (aula particular vinculada), se essa FK existir:
-- o aluno só perde o vínculo com a turma excluída.
--
-- Idempotente. Rodar nas duas bases (Bushi Defense e Cia Paulista).

do $$
declare
  fk record;
begin
  for fk in
    select c.conname, c.conrelid::regclass as tabela, a.attname as coluna
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f'
      and c.confrelid = 'public.turmas'::regclass
      and array_length(c.conkey, 1) = 1
      and c.confdeltype <> 'n' -- 'n' = já é SET NULL
  loop
    execute format('alter table %s alter column %I drop not null', fk.tabela, fk.coluna);
    execute format('alter table %s drop constraint %I', fk.tabela, fk.conname);
    execute format(
      'alter table %s add constraint %I foreign key (%I) references public.turmas(id) on delete set null',
      fk.tabela, fk.conname, fk.coluna
    );
  end loop;
end $$;
