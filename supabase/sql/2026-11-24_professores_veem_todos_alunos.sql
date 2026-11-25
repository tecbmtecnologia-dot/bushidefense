-- SÓ BUSHI DEFENSE — não rodar na Cia Paulista.
--
-- Todo professor ativo passa a ver e alterar TODOS os alunos da academia (antes: só os
-- vinculados a ele), a pedido do dono da academia. Vale para o cadastro do aluno e o que
-- pertence a ele: pagamentos, check-ins e histórico de graduações. Também passa a LER os
-- planos e as vendas dos outros professores (sem ler o plano, a mensalidade do aluno apareceria
-- como "sem plano"); alterar plano/venda continua só com o dono e o admin.
--
-- Não muda nada para o aluno: ele segue vendo só os próprios dados.
--
-- As políticas antigas ficam como estão: políticas RLS somam (OR), então aqui só se acrescenta
-- uma por tabela. auth_professor_id() só devolve id para professor ATIVO — desativado não vê nada.
--
-- Também cria professores_veem_todos_alunos(), que a Edge Function gerenciar-contas consulta
-- para deixar o professor redefinir senha / trocar e-mail / excluir o login de qualquer aluno.
-- Onde essa função não existe (Cia Paulista), continua valendo só para os alunos dele.
--
-- Rode este arquivo inteiro de uma vez no SQL Editor do Supabase
-- (Dashboard > SQL Editor > New query > colar > Run).
--
-- Idempotente: "create or replace" / "drop policy if exists".
--
-- Para desfazer: rode só os seis "drop policy" abaixo e
--   drop function if exists public.professores_veem_todos_alunos();

create or replace function public.professores_veem_todos_alunos()
returns boolean
language sql
immutable
set search_path = public
as $$ select true $$;

drop policy if exists alunos_professor_todos on public.alunos;
create policy alunos_professor_todos on public.alunos for all to authenticated
  using ((select auth_professor_id()) is not null)
  with check ((select auth_professor_id()) is not null);

drop policy if exists pagamentos_professor_todos on public.pagamentos;
create policy pagamentos_professor_todos on public.pagamentos for all to authenticated
  using ((select auth_professor_id()) is not null)
  with check ((select auth_professor_id()) is not null);

drop policy if exists checkins_professor_todos on public.checkins;
create policy checkins_professor_todos on public.checkins for all to authenticated
  using ((select auth_professor_id()) is not null)
  with check ((select auth_professor_id()) is not null);

drop policy if exists graduacoes_professor_todos on public.graduacoes;
create policy graduacoes_professor_todos on public.graduacoes for all to authenticated
  using ((select auth_professor_id()) is not null)
  with check ((select auth_professor_id()) is not null);

drop policy if exists planos_professor_le_todos on public.planos;
create policy planos_professor_le_todos on public.planos for select to authenticated
  using ((select auth_professor_id()) is not null);

drop policy if exists vendas_professor_le_todas on public.vendas;
create policy vendas_professor_le_todas on public.vendas for select to authenticated
  using ((select auth_professor_id()) is not null);
