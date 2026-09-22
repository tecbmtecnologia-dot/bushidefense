-- Fase 2b da migração de segurança: liga RLS (Row Level Security) nas tabelas
-- do app e restringe QUAIS LINHAS cada papel (admin/professor/aluno) pode
-- ler e escrever, replicando o mesmo recorte que o app já aplica hoje no
-- cliente (professor só vê "seus alunos vinculados", aluno só o próprio
-- cadastro). Não trava quais CAMPOS dentro da própria linha cada um pode
-- mudar — isso ficou combinado como uma etapa futura, separada.
--
-- Rode este arquivo inteiro de uma vez no SQL Editor do Supabase
-- (Dashboard > SQL Editor > New query > colar > Run).
--
-- Idempotente: pode rodar de novo sem erro (usa "create or replace" nas
-- funções e "drop policy if exists" antes de cada política).
--
-- IMPORTANTE: o projeto já tinha, desde a criação das tabelas, uma política
-- "allow all - <tabela>" (ou "acesso publico produtos") em praticamente
-- toda tabela, liberando tudo pra todo mundo (using true / with check
-- true). Políticas RLS "somam" (OR) em vez de substituir — então enquanto
-- essa política antiga não for apagada, as novas abaixo não têm efeito
-- nenhum, mesmo com RLS ligada. Por isso cada bloco começa derrubando a
-- política antiga daquela tabela antes de criar as novas.

-- ============================================================
-- Funções auxiliares — quem está logado, em qual papel
-- ============================================================
-- security definer: rodam com privilégio do dono (bypassa RLS na própria
-- consulta interna), senão a política que as usa entraria em recursão
-- consultando a própria tabela que está protegendo.

create or replace function public.auth_is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from academia where admin_auth_user_id = auth.uid()
  );
$$;

create or replace function public.auth_professor_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select id from professores
  where auth_user_id = auth.uid() and ativo is distinct from false
  limit 1;
$$;

create or replace function public.auth_aluno_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select id from alunos
  where auth_user_id = auth.uid() and ativo is distinct from false
  limit 1;
$$;

grant execute on function public.auth_is_admin() to anon, authenticated;
grant execute on function public.auth_professor_id() to anon, authenticated;
grant execute on function public.auth_aluno_id() to anon, authenticated;

-- ============================================================
-- academia — pública pra leitura (tela de login precisa do logo/termos
-- antes de logar); só admin escreve.
-- ============================================================
alter table academia enable row level security;

drop policy if exists "allow all - academia" on academia;

drop policy if exists academia_select on academia;
create policy academia_select on academia for select using (true);

drop policy if exists academia_insert_admin on academia;
create policy academia_insert_admin on academia for insert with check (auth_is_admin());

drop policy if exists academia_update_admin on academia;
create policy academia_update_admin on academia for update using (auth_is_admin()) with check (auth_is_admin());

drop policy if exists academia_delete_admin on academia;
create policy academia_delete_admin on academia for delete using (auth_is_admin());

-- ============================================================
-- Referência compartilhada — leitura pra qualquer logado, escrita só admin
-- ("planos" saiu daqui em 2026-09-21: cada professor passou a ter os
-- próprios planos, ver 2026-09-21_planos_por_professor.sql)
-- ============================================================
do $$
declare
  tabela text;
begin
  foreach tabela in array array['faixas', 'unidades'] loop
    execute format('alter table %I enable row level security', tabela);
    execute format('drop policy if exists %I on %I', 'allow all - ' || tabela, tabela);
    execute format('drop policy if exists %I_select_auth on %I', tabela, tabela);
    execute format('create policy %I_select_auth on %I for select to authenticated using (true)', tabela, tabela);
    execute format('drop policy if exists %I_write_admin on %I', tabela, tabela);
    execute format('create policy %I_write_admin on %I for all using (auth_is_admin()) with check (auth_is_admin())', tabela, tabela);
  end loop;
end $$;

-- ============================================================
-- professores — leitura pra qualquer logado; escrita: admin, ou o próprio
-- professor editando a própria linha ("Meu perfil").
-- ============================================================
alter table professores enable row level security;

drop policy if exists "allow all - professores" on professores;

drop policy if exists professores_select_auth on professores;
create policy professores_select_auth on professores for select to authenticated using (true);

drop policy if exists professores_insert_admin on professores;
create policy professores_insert_admin on professores for insert with check (auth_is_admin());

drop policy if exists professores_update on professores;
create policy professores_update on professores for update
  using (auth_is_admin() or id = auth_professor_id())
  with check (auth_is_admin() or id = auth_professor_id());

drop policy if exists professores_delete_admin on professores;
create policy professores_delete_admin on professores for delete using (auth_is_admin());

-- ============================================================
-- Conteúdo de professor (avisos, videos, produtos, recados, turmas,
-- sessoes_checkin) — leitura pra qualquer logado; escrita: admin ou o
-- professor dono da linha (professor_id).
-- ============================================================
drop policy if exists "acesso publico produtos" on produtos;

do $$
declare
  tabela text;
begin
  foreach tabela in array array['avisos', 'videos', 'produtos', 'recados', 'turmas', 'sessoes_checkin'] loop
    execute format('alter table %I enable row level security', tabela);
    execute format('drop policy if exists %I on %I', 'allow all - ' || tabela, tabela);
    execute format('drop policy if exists %I_select_auth on %I', tabela, tabela);
    execute format('create policy %I_select_auth on %I for select to authenticated using (true)', tabela, tabela);
    execute format('drop policy if exists %I_write_admin_ou_dono on %I', tabela, tabela);
    -- professor_id::text: algumas dessas tabelas (ex: produtos) guardam o id como texto, não
    -- como uuid nativo — comparar sempre como texto funciona nos dois casos.
    execute format(
      'create policy %I_write_admin_ou_dono on %I for all using (auth_is_admin() or professor_id::text = auth_professor_id()::text) with check (auth_is_admin() or professor_id::text = auth_professor_id()::text)',
      tabela, tabela
    );
  end loop;
end $$;

-- ============================================================
-- alunos — a tabela mais sensível: admin tudo; professor só os seus
-- (professor_id = auth_professor_id()); aluno só a própria linha.
-- ============================================================
alter table alunos enable row level security;

drop policy if exists "allow all - alunos" on alunos;

-- ::text nas comparações: algumas tabelas guardam id/professor_id como texto, não uuid nativo —
-- comparar como texto funciona nos dois casos.
drop policy if exists alunos_select on alunos;
create policy alunos_select on alunos for select
  using (auth_is_admin() or professor_id::text = auth_professor_id()::text or id::text = auth_aluno_id()::text);

drop policy if exists alunos_insert on alunos;
create policy alunos_insert on alunos for insert
  with check (auth_is_admin() or professor_id::text = auth_professor_id()::text);

drop policy if exists alunos_update on alunos;
create policy alunos_update on alunos for update
  using (auth_is_admin() or professor_id::text = auth_professor_id()::text or id::text = auth_aluno_id()::text)
  with check (auth_is_admin() or professor_id::text = auth_professor_id()::text or id::text = auth_aluno_id()::text);

drop policy if exists alunos_delete on alunos;
create policy alunos_delete on alunos for delete
  using (auth_is_admin() or professor_id::text = auth_professor_id()::text);

-- ============================================================
-- pagamentos, checkins — sem coluna de professor própria; escopadas via
-- join em alunos. Aluno só os próprios (checkins também dá INSERT pro
-- aluno, usado no check-in por localização/manual feito por ele mesmo).
-- ============================================================
alter table pagamentos enable row level security;

drop policy if exists "allow all - pagamentos" on pagamentos;

drop policy if exists pagamentos_select on pagamentos;
create policy pagamentos_select on pagamentos for select
  using (
    auth_is_admin()
    or aluno_id::text in (select id::text from alunos where professor_id::text = auth_professor_id()::text)
    or aluno_id::text = auth_aluno_id()::text
  );

drop policy if exists pagamentos_write_admin_ou_professor on pagamentos;
create policy pagamentos_write_admin_ou_professor on pagamentos for all
  using (auth_is_admin() or aluno_id::text in (select id::text from alunos where professor_id::text = auth_professor_id()::text))
  with check (auth_is_admin() or aluno_id::text in (select id::text from alunos where professor_id::text = auth_professor_id()::text));

alter table checkins enable row level security;

drop policy if exists "allow all - checkins" on checkins;

drop policy if exists checkins_select on checkins;
create policy checkins_select on checkins for select
  using (
    auth_is_admin()
    or aluno_id::text in (select id::text from alunos where professor_id::text = auth_professor_id()::text)
    or aluno_id::text = auth_aluno_id()::text
  );

drop policy if exists checkins_write on checkins;
create policy checkins_write on checkins for all
  using (
    auth_is_admin()
    or aluno_id::text in (select id::text from alunos where professor_id::text = auth_professor_id()::text)
    or aluno_id::text = auth_aluno_id()::text
  )
  with check (
    auth_is_admin()
    or aluno_id::text in (select id::text from alunos where professor_id::text = auth_professor_id()::text)
    or aluno_id::text = auth_aluno_id()::text
  );

-- ============================================================
-- vendas — tem professor_id e aluno_id próprios.
-- ============================================================
alter table vendas enable row level security;

drop policy if exists "allow all - vendas" on vendas;

drop policy if exists vendas_select on vendas;
create policy vendas_select on vendas for select
  using (auth_is_admin() or professor_id::text = auth_professor_id()::text or aluno_id::text = auth_aluno_id()::text);

drop policy if exists vendas_write_admin_ou_professor on vendas;
create policy vendas_write_admin_ou_professor on vendas for all
  using (auth_is_admin() or professor_id::text = auth_professor_id()::text)
  with check (auth_is_admin() or professor_id::text = auth_professor_id()::text);

-- ============================================================
-- recados_visualizados — aluno marca os próprios recados como vistos;
-- professor lê via join em recados (os que ele mandou); admin tudo.
-- ============================================================
alter table recados_visualizados enable row level security;

drop policy if exists "allow all - recados_visualizados" on recados_visualizados;

drop policy if exists recados_visualizados_select on recados_visualizados;
create policy recados_visualizados_select on recados_visualizados for select
  using (
    auth_is_admin()
    or aluno_id::text = auth_aluno_id()::text
    or recado_id::text in (select id::text from recados where professor_id::text = auth_professor_id()::text)
  );

drop policy if exists recados_visualizados_insert on recados_visualizados;
create policy recados_visualizados_insert on recados_visualizados for insert
  with check (auth_is_admin() or aluno_id::text = auth_aluno_id()::text);

drop policy if exists recados_visualizados_delete on recados_visualizados;
create policy recados_visualizados_delete on recados_visualizados for delete
  using (auth_is_admin() or aluno_id::text = auth_aluno_id()::text);

-- ============================================================
-- push_subscriptions — cada um só grava a própria inscrição; ninguém
-- (além do admin) precisa ler de volta, só a Edge Function send-push lê
-- (com a service role key, que ignora RLS).
-- ============================================================
alter table push_subscriptions enable row level security;

drop policy if exists "allow all - push_subscriptions" on push_subscriptions;

drop policy if exists push_subscriptions_select_admin on push_subscriptions;
create policy push_subscriptions_select_admin on push_subscriptions for select using (auth_is_admin());

drop policy if exists push_subscriptions_insert on push_subscriptions;
create policy push_subscriptions_insert on push_subscriptions for insert
  with check (auth_is_admin() or aluno_id::text = auth_aluno_id()::text or professor_id::text = auth_professor_id()::text);

drop policy if exists push_subscriptions_update on push_subscriptions;
create policy push_subscriptions_update on push_subscriptions for update
  using (auth_is_admin() or aluno_id::text = auth_aluno_id()::text or professor_id::text = auth_professor_id()::text)
  with check (auth_is_admin() or aluno_id::text = auth_aluno_id()::text or professor_id::text = auth_professor_id()::text);

drop policy if exists push_subscriptions_delete_admin on push_subscriptions;
create policy push_subscriptions_delete_admin on push_subscriptions for delete using (auth_is_admin());

-- ============================================================
-- notificacoes_aniversario, notificacoes_vencimento — o app (cliente) nunca
-- lê/escreve essas tabelas; só as Edge Functions check-aniversarios e
-- check-vencimentos, com a service role key (ignora RLS). Fecha de vez pra
-- anon/authenticated: derruba a política antiga e não cria nenhuma nova —
-- sem política, RLS nega tudo por padrão pra quem não é service role.
-- ============================================================
do $$
declare
  tabela text;
begin
  foreach tabela in array array['notificacoes_aniversario', 'notificacoes_vencimento'] loop
    execute format('alter table %I enable row level security', tabela);
    execute format('drop policy if exists %I on %I', 'allow all - ' || tabela, tabela);
  end loop;
end $$;
