-- Estende pro professor o mesmo fluxo de consentimento LGPD que o aluno já
-- tem (termo + assinatura digital no primeiro acesso). Hoje só o aluno
-- assina; o professor nunca vê o termo.
--
-- Rode este arquivo inteiro de uma vez no SQL Editor do Supabase
-- (Dashboard > SQL Editor > New query > colar > Run).
--
-- Idempotente: "add column if not exists" não dá erro se rodar de novo.
--
-- IMPORTANTE: default de primeiro_acesso é true, então todo professor JÁ
-- CADASTRADO também vai ver o termo (com assinatura pendente) no próximo
-- login dele — é o comportamento certo aqui, porque nenhum professor
-- existente assinou nada ainda.

alter table professores add column if not exists primeiro_acesso boolean not null default true;
alter table professores add column if not exists termo_aceito boolean not null default false;
alter table professores add column if not exists termo_aceito_em timestamptz;
alter table professores add column if not exists assinatura_termo text;
