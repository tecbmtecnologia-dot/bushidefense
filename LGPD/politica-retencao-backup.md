# Política de Retenção de Dados e Backup — QG Cia Paulista (TECBM)

Última atualização: 14/09/2026

Este documento define, para o sistema de gestão da **Cia Paulista** desenvolvido pela **TECBM** (BRUNO MARTINS DA SILVA 39943134810, CNPJ 38.030.645/0001-40), por quanto tempo cada tipo de dado é mantido e como é feito o backup, em conformidade com a Lei Geral de Proteção de Dados Pessoais (Lei nº 13.709/2018 — LGPD), em especial o princípio da necessidade (art. 6º, III) e o direito de eliminação do titular (art. 18, VI).

## 1. Prazos de retenção por tipo de dado

| Tipo de dado | Prazo de retenção | Base do prazo |
|---|---|---|
| Cadastro do aluno (nome, e-mail, telefone, data de nascimento, endereço, foto, contato de emergência) | Enquanto o aluno estiver matriculado; a pedido, pode ser exportado/excluído pelo próprio app a qualquer momento | LGPD art. 18, VI — direito de eliminação, sem retenção legal obrigatória equivalente à de saúde |
| Dados financeiros (histórico de pagamentos, planos, vendas) | 5 anos após o desligamento do aluno | Prazo decadencial/prescricional fiscal (CTN art. 173/174) |
| Registros de check-in (frequência, geolocalização no momento do check-in) | Enquanto o aluno estiver matriculado; após desligamento, mantido pelo mesmo prazo dos dados financeiros se vinculado a cobrança, senão pode ser excluído junto com o cadastro | Finalidade é controle de frequência corrente, não há obrigação legal de guarda longa isolada |
| Termo de consentimento assinado digitalmente (assinatura + texto aceito) | Durante toda a vigência da matrícula + 5 anos após o desligamento | Prova de consentimento válido em caso de disputa (mesmo prazo prescricional geral do Código Civil, art. 206) |
| Dados de professores (cadastro, termo de consentimento) | Duração do vínculo + 5 anos (prazo prescricional trabalhista) | CLT art. 11 |
| Recados/avisos visualizados | Enquanto o aluno estiver matriculado; excluídos junto com o cadastro no desligamento | Sem finalidade após o desligamento |

## 2. Como a eliminação é feita na prática

- **Aluno**: o próprio aluno pode excluir o cadastro pelo painel ("Mais" > "Meus dados (LGPD)"), ou admin/professor pode fazer isso pela lista de alunos. A exclusão hoje é **completa** (não anonimização como no Clínicas): apaga linhas em checkins/vendas/push_subscriptions/recados_visualizados e a conta de login no Supabase Auth. Isso é adequado porque, diferente de prontuário médico, não há retenção legal equivalente obrigando a manter o histórico de frequência de academia.
- **Ressalva**: se um aluno excluído tiver pagamentos vinculados relevantes para a contabilidade da academia (nota fiscal emitida, por exemplo), a academia deve avaliar, antes de confirmar a exclusão, se precisa preservar esse registro financeiro por conta própria (fora do app) para cumprir o prazo fiscal de 5 anos — o app hoje não bloqueia a exclusão nesse caso.
- **Professor**: não há hoje fluxo de autoexclusão de professor pelo app (diferente do aluno); desligamento de professor é tratado administrativamente pela academia.

## 3. Backup

- O banco de dados de produção roda no **Supabase** (Postgres gerenciado), no plano **Pro**, **confirmado em 14/09/2026**.
- O plano Pro inclui **backup automático diário, com retenção de 7 dias** (rotativo).
- **Point-in-Time Recovery (PITR)** é um add-on pago separado, não incluído por padrão no Pro. Não confirmado se está contratado para este projeto.
- Retenção de 7 dias é considerada suficiente para o porte atual do sistema (uma academia).

## 4. Revisão

Revisar este documento sempre que: (a) a academia passar a tratar novo tipo de dado, (b) a legislação fiscal/trabalhista aplicável mudar, ou (c) o plano de Supabase/infraestrutura mudar.

## 5. Encarregado (DPO)

**Bruno Martins da Silva** — tecbmtecnologia@gmail.com

## 6. Foro

Fica eleito o foro da comarca de **São Paulo/SP** para dirimir eventuais controvérsias decorrentes deste documento, com renúncia a qualquer outro, por mais privilegiado que seja.
