# Bushi Defense Jiu-Jitsu — Sistema de Gestão de Academia

Instância **white-label** do meu sistema de gestão de academias de jiu-jitsu, **em produção** na academia Bushi Defense Jiu Jitsu (Itajaí/SC). O código é o mesmo da [QG Cia Paulista](https://github.com/tecbmtecnologia-dot/ciapaulistabjj.app), com outra identidade visual e um banco de dados próprio e isolado. Assim, uma academia nunca enxerga os dados da outra.

São três aplicativos PWA, que se instalam no celular ou no computador sem loja de aplicativos:

| App | Quem usa | Para quê |
|---|---|---|
| **Painel administrativo** | Dono / administração | Alunos, professores, turmas, financeiro e relatórios |
| **App do professor** | Professores | Chamada, alunos, vídeos de técnicas, fotos do treino |
| **App do aluno** | Alunos | Check-in, graduação, mensalidades, grade de horários e avisos |

🔗 **Em produção:** https://bushidefense.netlify.app  
_O acesso exige login: os dados são de alunos reais. Posso apresentar o sistema funcionando em uma chamada._

---

## O que este projeto mostra

**Um produto, várias academias.** Transformei um sistema feito para um cliente em um produto que atende vários clientes:

- Toda a identidade da academia (nome, logo, cores, ícones do app instalado, marca d'água, e-mail e foro da política de privacidade, chave de notificação VAPID) fica em `marcas/<academia>/` e é escolhida no build pela variável `VITE_MARCA`
- Cada academia tem seu próprio projeto Supabase, configurado por variáveis de ambiente no Netlify
- Se o banco não estiver configurado, o app se recusa a subir, de propósito, para nunca conectar no banco de outra academia
- Correções e funcionalidades novas são feitas uma vez e levadas para as duas academias pelo Git

**Recursos exclusivos desta academia:** grade de horários em imagem (com zoom) no app do aluno e marca d'água do samurai da Bushi Defense nas telas.

## Funcionalidades

- Cadastro de alunos com faixa, grau e professor, histórico de graduações e anamnese em PDF
- Check-in pelo app com validação por localização
- Financeiro: planos por professor, personal por hora-aula, pagamento retroativo e relatórios mensais e anual em PDF
- Notificações push de avisos, aulas e vencimento de mensalidade, além de mensagem de aniversário automática
- Vídeos de técnicas publicados pelos professores, fotos do treino que somem em 5 dias e cronômetro de treino
- Golpes proibidos, tabela de pesos e regras de tatame

## Segurança e LGPD

- Supabase Auth com três papéis: admin, professor e aluno
- **Row Level Security** no Postgres: cada papel só acessa o que é seu
- Storage restrito a usuários autenticados
- Criação e remoção de contas só no servidor (Edge Function `gerenciar-contas`)
- Consentimento LGPD no primeiro acesso, política de privacidade, exportação e exclusão dos dados do aluno

## Tecnologias

- **Front-end:** React 18, Vite 5, Recharts, Lucide Icons
- **PWA:** Service Worker próprio, três manifests e Web Push (VAPID)
- **Back-end:** Supabase — Postgres com RLS, Auth, Storage e Edge Functions (Deno/TypeScript)
- **Deploy:** Netlify com deploy contínuo a partir do GitHub

## Rodando localmente

```bash
npm install
cp .env.example .env   # URL e chave publishable do projeto Supabase; VITE_MARCA=bushidefense
npm run dev
```

---

Desenvolvido por **Bruno Martins da Silva** — [TEC BM Tecnologia](https://github.com/tecbmtecnologia-dot)
