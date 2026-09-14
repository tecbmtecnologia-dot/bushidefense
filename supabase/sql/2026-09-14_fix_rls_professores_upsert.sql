-- Corrige erro "new row violates row-level security policy for table
-- professores" que aparecia ao professor assinar o termo de consentimento
-- (primeiro acesso) — e voltava pra tela de assinatura em loop.
--
-- Causa: o app salva a tabela "professores" inteira com um upsert
-- (INSERT ... ON CONFLICT DO UPDATE). Quando o Postgres processa um upsert
-- assim, ele checa a política de RLS de INSERT em cima da linha proposta
-- mesmo quando na prática ela já existe e vai só atualizar (caminho do
-- ON CONFLICT DO UPDATE) — não dá pra saber de antemão qual caminho será
-- tomado. A política "professores_insert_admin" só permitia admin, então
-- o professor (não-admin) assinando o próprio termo era rejeitado nesse
-- checkpoint, mesmo a política de UPDATE já permitindo ele editar a
-- própria linha.
--
-- Fix: alinha a política de INSERT com a de UPDATE, permitindo também
-- quando a linha é a do próprio professor logado (id = auth_professor_id()).
-- Isso não abre brecha pra criar professores novos: auth_professor_id()
-- só retorna um id quando já existe uma linha em "professores" com
-- auth_user_id = auth.uid() — ou seja, só cobre o caso "essa linha já é
-- minha", nunca uma linha nova/de outra pessoa.
--
-- Rode este arquivo inteiro de uma vez no SQL Editor do Supabase
-- (Dashboard > SQL Editor > New query > colar > Run).
--
-- Idempotente: "drop policy if exists" antes de recriar.

drop policy if exists professores_insert_admin on professores;
create policy professores_insert_admin on professores for insert
  with check (auth_is_admin() or id = auth_professor_id());
