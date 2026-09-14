# Checklist técnico LGPD — QG Cia Paulista (qg-jiujitsu-app)

Cruzado com o código-fonte real do app em produção (`src/App.jsx`, `src/supabaseClient.js`, `supabase/sql/`) em 13/09/2026.

**Correção importante**: uma sessão anterior tinha escrito este checklist olhando pro arquivo `qg-jiujitsu.jsx` solto na raiz de `APP CIA PAULISTA/` — que é uma versão de referência/antiga, **não** o app que está em produção. O achado de "senha em texto puro" reportado antes **não se aplica** a este app real. Reavaliado do zero com o código certo.

## Segurança de acesso
- [x] Autenticação via **Supabase Auth** de verdade (`supabaseAuth.signInWithPassword`), não comparação manual de senha. Sessão com token JWT, refresh automático.
- [x] Toda leitura/escrita passa pelo token de sessão (`Authorization: Bearer <token>`), necessário pra RLS liberar as linhas certas por papel (admin/professor/aluno).
- [~] **RLS em andamento**: `supabase/sql/2026-09-11_rls_fase2b.sql` já implementa políticas por papel (admin vê tudo da própria academia, professor só seus alunos vinculados, aluno só o próprio cadastro). O próprio arquivo documenta que havia uma política antiga "allow all" liberando tudo pra todo mundo, e que ela precisa ser derrubada pra essas políticas novas terem efeito — **confirmar com Bruno se esse script já foi executado em produção** (o arquivo por si só, existindo no repo, não garante que rodou no banco).
- [ ] Falta (mencionado no próprio SQL como etapa futura): RLS não trava ainda quais **campos** dentro da própria linha cada papel pode alterar (só quais linhas).

## Consentimento — já existe, mais avançado que o do Clínicas Médicas
- [x] Fluxo de "Primeiro acesso" (`PrimeiroAcessoTermo` em `App.jsx`): aluno vê o texto do termo (e/ou PDF anexado pelo admin), marca "Li o termo de consentimento", **assina com o dedo** (`SignaturePad`) antes de conseguir usar o app.
- [x] Admin consegue reenviar/forçar nova assinatura de todo mundo depois de mudar o texto do termo (`PedirAssinaturaTodos`).
- [ ] **Esse fluxo só roda se a academia tiver cadastrado um texto de termo ou PDF** (`data.academia.termoPadrao || data.academia.termoPdf`) — por padrão vem vazio. Ou seja, o mecanismo existe mas **a academia (Bruno/Cia Paulista) precisa preencher esse campo em Configurações** com um texto que cubra tanto o termo de risco físico (comum em academia de luta) quanto o consentimento de tratamento de dados (LGPD) — ver sugestão de texto em `texto-sugerido-termo-consentimento.md` nesta pasta.
- [ ] O termo de consentimento hoje é só pro **aluno**. Não existe fluxo equivalente pro **professor** no primeiro acesso dele.

## Direitos do titular
- [ ] Falta: forma de exportar ou excluir dados de um aluno específico a pedido.

## Página de privacidade
- [x] **Adicionado nesta sessão**: `privacidade.html`, linkada no rodapé das 3 telas de login (admin, professor, aluno).

## Governança
- [x] Encarregado (DPO) definido: Bruno Martins da Silva, tecbmtecnologia@gmail.com (documentado na política de privacidade).
- [ ] Falta: política de retenção de dados de ex-alunos.

## Prioridade sugerida
1. Confirmar com Bruno se o script de RLS (fase 2b) já rodou em produção, e derrubar de vez a política antiga "allow all" se ainda não foi feito.
2. Preencher o texto do termo de consentimento em Configurações (mecanismo já existe, só falta o conteúdo).
3. Exportação/exclusão de dados de aluno a pedido.
