-- Tabela de pesos e categorias configurável pelo painel admin (Configurações):
-- link (ex: site da federação) e/ou arquivo (imagem ou PDF, guardado como data URL,
-- igual a golpes_proibidos_pdf / regras_tatame).
--
-- Rodar ANTES de publicar o código que usa essas colunas — sem elas, salvar as
-- configurações da academia falha.

alter table public.academia
  add column if not exists tabela_pesos_link text,
  add column if not exists tabela_pesos_arquivo text,
  add column if not exists tabela_pesos_arquivo_nome text;

-- Só na Cia Paulista: mantém o link que já aparecia fixo no app (FPJJ) como valor inicial.
-- (Na Bushi Defense NÃO rodar esta parte — lá a tabela começa vazia.)
-- update public.academia
--   set tabela_pesos_link = 'https://fpjjcompetidor.com.br/tabela-de-pesos/'
--   where tabela_pesos_link is null;
