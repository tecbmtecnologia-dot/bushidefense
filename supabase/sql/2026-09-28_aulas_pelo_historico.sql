-- As "aulas p/ o próximo grau" passam a ser contadas direto do histórico de
-- check-ins do aluno (o mesmo que aparece em "Histórico de treinos"), em vez
-- do contador checkins_desde_graduacao, que ficava dessincronizado.
--
-- ultima_graduacao_em: quando o professor deu o último grau/faixa — só contam
--   os check-ins depois dessa data (null = conta o histórico inteiro).
-- ajuste_aulas: soma/subtrai aulas pelo botão de ajuste manual do professor.
--
-- RODE ANTES de publicar a versão nova do app: o app já envia essas colunas
-- ao salvar alunos e o salvamento falha se elas não existirem.
--
-- Rode este arquivo inteiro de uma vez no SQL Editor do Supabase
-- (Dashboard > SQL Editor > New query > colar > Run).
--
-- Idempotente: "add column if not exists".

alter table alunos add column if not exists ultima_graduacao_em timestamptz;
alter table alunos add column if not exists ajuste_aulas integer not null default 0;
