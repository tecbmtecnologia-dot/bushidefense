-- Feature: "Foto do treino" — campo só do professor pra postar uma foto (tirada na
-- hora, pela câmera do celular, ou escolhida da galeria) que aparece pros alunos
-- vinculados a ele e some sozinha depois de 5 dias (limpeza real feita pela Edge
-- Function `limpar-fotos-treino`, agendada via Cron — veja instruções no final).
--
-- Rode este arquivo inteiro de uma vez no SQL Editor do Supabase
-- (Dashboard > SQL Editor > New query > colar > Run).
-- Idempotente: pode rodar de novo sem erro.

-- ============================================================
-- Tabela
-- ============================================================
create table if not exists fotos_treino (
  id uuid primary key default gen_random_uuid(),
  professor_id uuid not null references professores(id) on delete cascade,
  foto_url text not null,
  legenda text,
  criado_em timestamptz not null default now()
);

create index if not exists fotos_treino_professor_id_idx on fotos_treino(professor_id);
create index if not exists fotos_treino_criado_em_idx on fotos_treino(criado_em);

-- ============================================================
-- RLS — mesma regra das outras tabelas de conteúdo do professor (avisos,
-- videos, recados): leitura pra qualquer logado, escrita só admin ou o
-- professor dono da linha.
-- ============================================================
alter table fotos_treino enable row level security;

drop policy if exists fotos_treino_select_auth on fotos_treino;
create policy fotos_treino_select_auth on fotos_treino for select to authenticated using (true);

drop policy if exists fotos_treino_write_admin_ou_dono on fotos_treino;
create policy fotos_treino_write_admin_ou_dono on fotos_treino for all
  using (auth_is_admin() or professor_id::text = auth_professor_id()::text)
  with check (auth_is_admin() or professor_id::text = auth_professor_id()::text);

-- ============================================================
-- Storage — bucket público novo "fotos-treino", com o mesmo nível de acesso
-- que os buckets "videos"/"recados"/"produtos" já têm hoje (o app sobe
-- arquivo com a chave publicável, não com o token de sessão — por isso o
-- insert precisa ficar aberto pro papel "anon" também, não só "authenticated").
-- ============================================================
insert into storage.buckets (id, name, public)
values ('fotos-treino', 'fotos-treino', true)
on conflict (id) do nothing;

drop policy if exists "fotos_treino_storage_select" on storage.objects;
create policy "fotos_treino_storage_select" on storage.objects for select
  using (bucket_id = 'fotos-treino');

drop policy if exists "fotos_treino_storage_insert" on storage.objects;
create policy "fotos_treino_storage_insert" on storage.objects for insert
  with check (bucket_id = 'fotos-treino');

drop policy if exists "fotos_treino_storage_delete" on storage.objects;
create policy "fotos_treino_storage_delete" on storage.objects for delete
  using (bucket_id = 'fotos-treino');

-- ============================================================
-- Depois de rodar este SQL:
-- 1. Deploy da function:  supabase functions deploy limpar-fotos-treino
-- 2. Agende ela pra rodar 1x/dia: Dashboard > Edge Functions >
--    limpar-fotos-treino > Cron > Add cron schedule, ex: "0 6 * * *"
--    (mesmo jeito que check-vencimentos/check-aniversarios já estão agendadas).
-- ============================================================
