# Política de Privacidade — QG Cia Paulista

Última atualização: 13/09/2026

**Publicada em produção em `privacidade.html`** (linkada no rodapé das telas de login de admin/professor/aluno). Este arquivo é a fonte — se editar o conteúdo, replicar em `privacidade.html` também.

Esta Política de Privacidade descreve como o sistema de gestão da **Cia Paulista**, desenvolvido pela **TECBM**
(BRUNO MARTINS DA SILVA 39943134810, CNPJ 38.030.645/0001-40), trata os dados pessoais de alunos, professores e
responsáveis, em conformidade com a Lei Geral de Proteção de Dados Pessoais (Lei nº 13.709/2018 — LGPD).

## 1. Quem trata os seus dados

A **Cia Paulista** é a Controladora dos dados dos alunos cadastrados no sistema, responsável por decidir as
finalidades de uso e responder perante os titulares e a ANPD. A **TECBM**, como desenvolvedora do sistema, atua como
Operadora, tratando os dados apenas para viabilizar o funcionamento técnico da plataforma.

## 2. Dados que coletamos

- Identificação do aluno: nome completo, e-mail, telefone, data de nascimento, endereço, foto.
- Contato de emergência: nome e telefone.
- Graduação: faixa e grau.
- Dados financeiros: plano contratado, histórico de pagamentos, vencimentos.
- Frequência: registros de check-in nas aulas/turmas (inclusive geolocalização no momento do check-in, comparada
  contra o raio configurado da unidade).
- Termo de consentimento assinado digitalmente (assinatura com o dedo) no primeiro acesso ao aplicativo.

## 3. Alunos menores de idade

Quando o aluno for menor de 18 anos, o cadastro e o consentimento para tratamento de dados devem ser feitos pelo
responsável legal, conforme art. 14 da LGPD.

## 4. Para que usamos esses dados

- Gerenciar matrícula, graduação e frequência do aluno nas aulas.
- Controlar cobrança e pagamento de mensalidades/planos.
- Contatar o responsável em caso de emergência durante o treino.
- Confirmar presença física no local de treino (check-in por geolocalização).
- Comunicação sobre horários, turmas e avisos da academia (inclusive notificações push).

## 5. Base legal do tratamento

- Execução de contrato (art. 7º, V) — matrícula e prestação do serviço de ensino.
- Consentimento (art. 7º, I) — termo assinado digitalmente no primeiro acesso.
- Legítimo interesse (art. 7º, IX) para segurança (contato de emergência, check-in por localização).

## 6. Com quem compartilhamos dados

Provedor de infraestrutura que hospeda o sistema (Supabase), sob obrigação de segurança e confidencialidade. Não
compartilhamos dados com terceiros para fins de publicidade.

## 7. Por quanto tempo guardamos os dados

Os dados são mantidos enquanto o aluno estiver matriculado e pelo prazo adicional necessário para fins
fiscais/contábeis, após o que podem ser eliminados a pedido.

## 8. Seus direitos como titular

Você (ou o responsável legal, se menor) pode solicitar acesso, correção, exclusão ou portabilidade dos dados, e
revogar consentimento, entrando em contato com a academia ou pelo e-mail tecbmtecnologia@gmail.com.

## 9. Segurança

O sistema usa autenticação real via Supabase Auth (não senha em texto puro) e políticas de segurança em nível de
linha (RLS) no banco de dados, restringindo o que cada papel (admin/professor/aluno) pode ver e alterar — ver
`checklist-tecnico-lgpd.md` para o estado exato de implementação dessas políticas.

## 10. Encarregado de Proteção de Dados (DPO)

Bruno Martins da Silva — tecbmtecnologia@gmail.com

## 11. Foro

Fica eleito o foro da comarca de São Paulo/SP.
