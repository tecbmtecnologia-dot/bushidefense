-- Adiciona o texto "Sobre a equipe", editado pelo admin em Configurações
-- e exibido pro aluno na aba "Mais" do app.
--
-- Rode este arquivo inteiro de uma vez no SQL Editor do Supabase
-- (Dashboard > SQL Editor > New query > colar > Run).
--
-- Idempotente: "add column if not exists".

alter table academia add column if not exists sobre_equipe text;
