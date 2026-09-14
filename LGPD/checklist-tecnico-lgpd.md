# Checklist técnico LGPD — QG Cia Paulista (qg-jiujitsu-app)

Criado em 13/09/2026 cruzando com o código-fonte real do app em produção (`src/App.jsx`, `src/supabaseClient.js`, `supabase/sql/`). **Atualizado em 14/09/2026** — todos os itens que faltavam foram fechados nesse mesmo dia; ver histórico abaixo.

**Correção importante (13/09/2026)**: uma sessão anterior tinha escrito este checklist olhando pro arquivo `qg-jiujitsu.jsx` solto na raiz de `APP CIA PAULISTA/` — que é uma versão de referência/antiga, **não** o app que está em produção. O achado de "senha em texto puro" reportado antes **não se aplica** a este app real. Reavaliado do zero com o código certo.

## Segurança de acesso
- [x] Autenticação via **Supabase Auth** de verdade (`supabaseAuth.signInWithPassword`), não comparação manual de senha. Sessão com token JWT, refresh automático.
- [x] Toda leitura/escrita passa pelo token de sessão (`Authorization: Bearer <token>`), necessário pra RLS liberar as linhas certas por papel (admin/professor/aluno).
- [x] **RLS confirmada em produção em 14/09/2026**: `supabase/sql/2026-09-11_rls_fase2b.sql` rodado no Supabase. Bruno conferiu via `select tablename, policyname from pg_policies where schemaname='public'` — nenhuma política antiga "allow all" restante em nenhuma das 16 tabelas do app, políticas granulares por papel presentes em todas elas, e `rowsecurity = true` confirmado em academia/alunos/professores.
- [x] **Falha de segurança encontrada e corrigida em 14/09/2026**: a edge function `gerenciar-contas` não conferia quem chamava — qualquer um com a chave pública do app (exposta no bundle JS) podia criar contas ou redefinir senha de qualquer `authUserId`. Agora exige token de sessão real e valida contra `academia`/`professores` (admin ou professor) antes de qualquer ação. Redeployada em produção.
- [ ] Ainda não trava quais **campos** dentro da própria linha cada papel pode alterar (só quais linhas) — melhoria futura, não bloqueante, mencionada no próprio SQL da fase 2b.

## Consentimento — mais avançado que o do Clínicas Médicas
- [x] Fluxo de "Primeiro acesso" (`PrimeiroAcessoTermo` em `App.jsx`): aluno vê o texto do termo (e/ou PDF anexado pelo admin), marca "Li o termo de consentimento", **assina com o dedo** (`SignaturePad`) antes de conseguir usar o app.
- [x] Admin consegue reenviar/forçar nova assinatura de todo mundo depois de mudar o texto do termo (`PedirAssinaturaTodos`).
- [x] **Texto do termo preenchido em Configurações (14/09/2026)** — Bruno colou o texto sugerido (`texto-sugerido-termo-consentimento.md`), cobrindo risco físico do jiu-jitsu + consentimento LGPD + uso de imagem. Fluxo deixou de ficar pulado.
- [x] **Termo do professor implementado em produção (14/09/2026)**: mesmo padrão do aluno (termo + assinatura digital no primeiro acesso), componente `PrimeiroAcessoTermoProfessor`. Migração `supabase/sql/2026-09-14_termo_professor.sql` (colunas `primeiro_acesso`/`termo_aceito`/`termo_aceito_em`/`assinatura_termo` em `professores`) já rodada no Supabase. Como o default de `primeiro_acesso` é `true`, professores já cadastrados também veem o termo no próximo login (intencional).

## Direitos do titular
- [x] **Exportação e exclusão de dados do aluno implementadas em produção (14/09/2026)**: aluno baixa os próprios dados (perfil, pagamentos, checkins, compras) em JSON pelo painel ("Mais" > "Meus dados (LGPD)"); admin e professor também exportam dados de qualquer aluno pela lista. "Excluir cadastro" agora apaga de fato: linhas em checkins/vendas/push_subscriptions/recados_visualizados + a conta de login no Supabase Auth (antes só removia a linha de `alunos`, deixando histórico órfão).

## Página de privacidade
- [x] `privacidade.html`, linkada no rodapé das 3 telas de login (admin, professor, aluno). **URL de produção confirmada (14/09/2026)**: `https://qgciapaulistabjjbrasil.netlify.app/privacidade.html`.

## Governança
- [x] Encarregado (DPO) definido: Bruno Martins da Silva, tecbmtecnologia@gmail.com (documentado na política de privacidade).
- [x] Política de retenção de dados de ex-alunos e backup — documento criado em 14/09/2026 (`politica-retencao-backup.md`, nesta pasta). Backup confirmado: Supabase plano Pro, backup diário com retenção de 7 dias.

## Status
**Nenhum item pendente no checklist técnico.** Só resta assinar/formalizar qualquer termo comercial cabível com a academia — nada bloqueante, nada de código.
