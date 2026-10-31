-- PDF das regras do tatame, enviado pelo professor principal no app do professor e exibido pro
-- aluno na aba "Mais", no card "Regras do tatame" (junto da imagem que o admin envia em
-- Configurações, se houver).
--
-- SÓ PARA A BUSHI DEFENSE — não rode na base da Cia Paulista. Precisa do
-- 2026-10-31_historia_academia.sql rodado antes: usa a mesma linha (id = 1) e as mesmas regras de
-- acesso (só o professor dono da linha grava, qualquer usuário logado lê), que valem pra linha
-- inteira, então não precisa de policy nova.
--
-- Rode este arquivo inteiro de uma vez no SQL Editor do Supabase
-- (Dashboard > SQL Editor > New query > colar > Run).
--
-- Idempotente: "add column if not exists".

alter table historia_academia add column if not exists regras_pdf text;
alter table historia_academia add column if not exists regras_pdf_nome text;
