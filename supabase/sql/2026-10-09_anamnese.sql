-- Anamnese (questionário de saúde) que o aluno preenche no app, logo depois do
-- termo de consentimento. Fica salva no cadastro dele e o professor abre como
-- documento (imprimir / salvar em PDF), igual ao termo assinado.
--
-- anamnese: respostas + assinatura (jsonb). anamnese_em: quando foi preenchida.
-- Aluno sem anamnese_em vê a tela da anamnese no próximo login (inclusive quem
-- já está cadastrado).
--
-- Rodar ANTES de publicar o código que usa essas colunas — sem elas, salvar
-- alunos falha. Idempotente. Rodar nas duas bases (Bushi Defense e Cia Paulista).

alter table public.alunos
  add column if not exists anamnese jsonb,
  add column if not exists anamnese_em timestamptz;
