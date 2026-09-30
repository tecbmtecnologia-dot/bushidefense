import { pg, supabaseAuth, SUPABASE_URL_EXPORT, SUPABASE_KEY_EXPORT } from "./supabaseClient.js";

/* Mapas de campo: chave usada na interface -> coluna no banco. */
const MAPS = {
  academia: {
    nome: "nome", chavePix: "chave_pix", logo: "logo", termoPadrao: "termo_padrao",
    termoPdf: "termo_pdf", termoPdfNome: "termo_pdf_nome", senhaAdmin: "senha_admin",
    endereco: "endereco", latitude: "latitude", longitude: "longitude", raioCheckin: "raio_checkin",
    instagram: "instagram", facebook: "facebook", whatsapp: "whatsapp",
    mensagemAniversario: "mensagem_aniversario", regrasTatame: "regras_tatame", sobreEquipe: "sobre_equipe", marcaDagua: "marca_dagua",
    golpesProibidosPdf: "golpes_proibidos_pdf", golpesProibidosPdfNome: "golpes_proibidos_pdf_nome",
    adminAuthUserId: "admin_auth_user_id", emailAdmin: "email_admin",
  },
  faixas: {
    id: "id", nome: "nome", cor: "cor", texto: "texto", borda: "borda", corPonta: "cor_ponta",
    grausMax: "graus_max", tempoMinimoAnos: "tempo_minimo_anos", aulasPorGrau: "aulas_por_grau",
    categoria: "categoria", observacoes: "observacoes", ordem: "ordem",
  },
  planos: { id: "id", nome: "nome", valor: "valor", valorHora: "valor_hora", periodicidade: "periodicidade", unidadeId: "unidade_id", professorId: "professor_id" },
  turmas: { id: "id", nome: "nome", dias: "dias", horario: "horario", horarioFim: "horario_fim", unidadeId: "unidade_id", professorId: "professor_id" },
  professores: {
    id: "id", nome: "nome", email: "email", especialidade: "especialidade",
    telefone: "telefone", endereco: "endereco", faixaId: "faixa_id", grau: "grau", foto: "foto", senha: "senha",
    dataNascimento: "data_nascimento", unidadeId: "unidade_id", ativo: "ativo", authUserId: "auth_user_id",
    primeiroAcesso: "primeiro_acesso", termoAceito: "termo_aceito", termoAceitoEm: "termo_aceito_em",
    assinaturaTermo: "assinatura_termo",
  },
  alunos: {
    id: "id", nome: "nome", email: "email", senha: "senha", primeiroAcesso: "primeiro_acesso",
    telefone: "telefone", endereco: "endereco", contatoEmergenciaNome: "contato_emergencia_nome",
    contatoEmergenciaTelefone: "contato_emergencia_telefone", foto: "foto", faixaId: "faixa_id",
    grau: "grau", dataNascimento: "data_nascimento", matricula: "matricula", planoId: "plano_id",
    diaVencimento: "dia_vencimento", ultimoPagamento: "ultimo_pagamento",
    checkinsDesdeGraduacao: "checkins_desde_graduacao", ultimaGraduacaoEm: "ultima_graduacao_em", ajusteAulas: "ajuste_aulas", termoAceito: "termo_aceito",
    termoAceitoEm: "termo_aceito_em", termoAssinadoManual: "termo_assinado_manual", professorId: "professor_id", peso: "peso", apelido: "apelido", unidadeId: "unidade_id", ativo: "ativo", turmaId: "turma_id", assinaturaTermo: "assinatura_termo", codigo: "codigo", authUserId: "auth_user_id",
  },
  pagamentos: { id: "id", alunoId: "aluno_id", data: "data", valor: "valor" },
  sessoes_checkin: {
    id: "id", treinoId: "turma_id", professorId: "professor_id", codigo: "codigo",
    criadoEm: "criado_em", ativa: "ativa",
  },
  checkins: { id: "id", sessaoId: "sessao_id", alunoId: "aluno_id", dataHora: "data_hora" },
  avisos: { id: "id", titulo: "titulo", mensagem: "mensagem", tipo: "tipo", dataEvento: "data_evento", criadoEm: "criado_em", professorId: "professor_id" },
  videos: { id: "id", titulo: "titulo", url: "url", legenda: "legenda", criadoEm: "criado_em", professorId: "professor_id", unidadeId: "unidade_id" },
  unidades: { id: "id", nome: "nome", endereco: "endereco", latitude: "latitude", longitude: "longitude", raioCheckin: "raio_checkin", chavePix: "chave_pix" },
  produtos: { id: "id", nome: "nome", valor: "valor", fotos: "fotos", ativo: "ativo", criadoEm: "criado_em", professorId: "professor_id" },
  vendas: { id: "id", alunoId: "aluno_id", professorId: "professor_id", produtoId: "produto_id", produtoNome: "produto_nome", valor: "valor", data: "data", criadoEm: "criado_em" },
};

/* Colunas NOT NULL (com default no banco) — nunca podem ir como null. Um cadastro novo criado
   pela interface não tem esses campos, e mandar null explícito fura o default e o banco rejeita
   ("null value in column ... violates not-null constraint"). */
const PADROES = {
  alunos: { ajusteAulas: 0 },
  professores: { primeiroAcesso: true, termoAceito: false },
};

/* `omitirIndefinidos`: campos que o objeto não tem (undefined) ficam FORA da linha, pro banco
   usar o default da coluna (ver `missing=default` em pg.upsert) — em vez de forçar null. */
function toDb(entity, obj, { omitirIndefinidos = false } = {}) {
  const map = MAPS[entity];
  const padroes = PADROES[entity] || {};
  const row = {};
  for (const [jsKey, dbKey] of Object.entries(map)) {
    let valor = obj[jsKey];
    if ((valor === undefined || valor === null) && jsKey in padroes) valor = padroes[jsKey];
    if (valor === undefined && omitirIndefinidos) continue;
    const vazio = valor === "" && ["email", "faixaId", "planoId", "professorId", "dataNascimento", "unidadeId", "turmaId"].includes(jsKey);
    // "planos" também usa unidadeId como vínculo opcional (plano vale pra unidade específica ou pra todas se vazio).
    row[dbKey] = valor === undefined || vazio ? null : valor;
  }
  return row;
}

function fromDb(entity, row) {
  const map = MAPS[entity];
  const obj = {};
  for (const [jsKey, dbKey] of Object.entries(map)) obj[jsKey] = row[dbKey];
  return obj;
}

/*
 * Upsert das linhas em `items` + remoção das que não existem mais em `todosOsItens` (cobre
 * criar, editar e excluir). `todosOsItens` é a lista completa da entidade (default: `items`) —
 * só existe como parâmetro separado pra permitir mandar um upsert PARCIAL (ex: só a linha que
 * mudou) sem perder o cálculo de exclusão, que precisa saber o conjunto completo de ids válidos.
 */
async function syncTable(entity, items, todosOsItens) {
  const rows = items.map((it) => toDb(entity, it, { omitirIndefinidos: true }));
  const existing = await pg.select(entity, "select=id");
  const existingIds = (existing || []).map((r) => r.id);
  const nextIds = (todosOsItens || items).map((it) => it.id);
  const toDelete = existingIds.filter((id) => !nextIds.includes(id));

  if (rows.length) await pg.upsert(entity, rows);
  if (toDelete.length) await pg.deleteIn(entity, toDelete);
}

// Antes do login (ou pra papel sem acesso a uma tabela) a RLS nega a leitura — trata isso como
// "nada disponível ainda" em vez de erro de conexão. Só `academia` (pública) é obrigatória.
async function selectSafe(table, params) {
  try {
    return await pg.select(table, params);
  } catch (_) {
    return [];
  }
}

export async function loadAll() {
  const [academiaRows, faixasRows, planosRows, turmasRows, professoresRows, alunosRows, pagamentosRows, sessoesRows, checkinsRows, avisosRows, videosRows, unidadesRows, produtosRows, vendasRows] = await Promise.all([
    pg.select("academia", "select=*&limit=1"),
    selectSafe("faixas", "select=*&order=ordem.asc"),
    selectSafe("planos"),
    selectSafe("turmas"),
    selectSafe("professores"),
    selectSafe("alunos"),
    selectSafe("pagamentos"),
    selectSafe("sessoes_checkin"),
    selectSafe("checkins"),
    selectSafe("avisos", "select=*&order=criado_em.desc"),
    selectSafe("videos", "select=*&order=criado_em.desc"),
    selectSafe("unidades", "select=*&order=nome.asc"),
    selectSafe("produtos", "select=*&order=criado_em.desc"),
    selectSafe("vendas", "select=*&order=criado_em.desc"),
  ]);

  if (!academiaRows || academiaRows.length === 0) {
    throw new Error("Tabela 'academia' está vazia — rode o script SQL no Supabase antes de conectar o app.");
  }

  const academia = fromDb("academia", academiaRows[0]);
  academia.id = academiaRows[0].id;
  academia.latitude = academia.latitude === null || academia.latitude === undefined ? null : Number(academia.latitude);
  academia.longitude = academia.longitude === null || academia.longitude === undefined ? null : Number(academia.longitude);
  academia.raioCheckin = academia.raioCheckin ? Number(academia.raioCheckin) : 150;

  const pagamentosPorAluno = {};
  (pagamentosRows || []).forEach((row) => {
    const p = fromDb("pagamentos", row);
    if (!pagamentosPorAluno[p.alunoId]) pagamentosPorAluno[p.alunoId] = [];
    pagamentosPorAluno[p.alunoId].push({ id: p.id, data: p.data, valor: Number(p.valor) });
  });

  const alunos = (alunosRows || []).map((row) => {
    const a = fromDb("alunos", row);
    a.grau = Number(a.grau) || 0;
    a.diaVencimento = a.diaVencimento === null ? null : Number(a.diaVencimento);
    a.checkinsDesdeGraduacao = Number(a.checkinsDesdeGraduacao) || 0;
    a.ajusteAulas = Number(a.ajusteAulas) || 0;
    a.codigo = a.codigo === null || a.codigo === undefined ? null : Number(a.codigo);
    a.pagamentos = pagamentosPorAluno[a.id] || [];
    return a;
  });

  const faixas = (faixasRows || []).map((row) => {
    const f = fromDb("faixas", row);
    f.grausMax = Number(f.grausMax) || 0;
    f.tempoMinimoAnos = f.tempoMinimoAnos === null ? null : Number(f.tempoMinimoAnos);
    f.aulasPorGrau = f.aulasPorGrau === null ? null : Number(f.aulasPorGrau);
    return f;
  });

  const planos = (planosRows || []).map((row) => { const p = fromDb("planos", row); p.valor = Number(p.valor); return p; });
  const turmas = (turmasRows || []).map((row) => fromDb("turmas", row));
  const professores = (professoresRows || []).map((row) => { const p = fromDb("professores", row); p.grau = Number(p.grau) || 0; return p; });
  const sessoes = (sessoesRows || []).map((row) => fromDb("sessoes_checkin", row));
  const checkins = (checkinsRows || []).map((row) => fromDb("checkins", row));
  const avisos = (avisosRows || []).map((row) => fromDb("avisos", row));
  const videos = (videosRows || []).map((row) => fromDb("videos", row));
  const produtos = (produtosRows || []).map((row) => {
    const p = fromDb("produtos", row);
    p.valor = Number(p.valor) || 0;
    p.fotos = p.fotos || [];
    return p;
  });
  const unidades = (unidadesRows || []).map((row) => {
    const u = fromDb("unidades", row);
    u.latitude = u.latitude === null || u.latitude === undefined ? null : Number(u.latitude);
    u.longitude = u.longitude === null || u.longitude === undefined ? null : Number(u.longitude);
    u.raioCheckin = u.raioCheckin === null || u.raioCheckin === undefined ? null : Number(u.raioCheckin);
    return u;
  });
  const vendas = (vendasRows || []).map((row) => { const v = fromDb("vendas", row); v.valor = Number(v.valor) || 0; return v; });

  return { academia, faixas, planos, turmas, professores, alunos, sessoes, checkins, avisos, videos, unidades, produtos, vendas };
}

/*
 * Só sincroniza no banco as partes de `next` que realmente mudaram em relação a `anterior`.
 * Cada tela do app sempre chama save({ ...data, algumaCoisa }) — ou seja, todo campo que não
 * foi tocado continua sendo a MESMA referência de array/objeto de antes. Por isso dá pra usar
 * comparação de referência (!==) pra saber o que mudou, sem precisar alterar nenhuma das telas.
 * Isso evita mandar ~13 tabelas inteiras pro banco toda vez que qualquer coisa é salva.
 */
export async function saveAll(next, anterior) {
  const mudou = (chave) => !anterior || next[chave] !== anterior[chave];
  // Linhas novas ou alteradas (por referência) — ver comentário em "professores" abaixo.
  const soAlterados = (lista, listaAnterior) => {
    const anterioresPorId = new Map((listaAnterior || []).map((it) => [it.id, it]));
    return lista.filter((it) => anterioresPorId.get(it.id) !== it);
  };

  const tarefas = [];
  if (mudou("academia")) {
    tarefas.push({ nome: "academia", fn: () => pg.update("academia", next.academia.id, toDb("academia", next.academia)) });
  }
  if (mudou("faixas")) {
    const faixasComOrdem = next.faixas.map((f, i) => ({ ...f, ordem: i }));
    tarefas.push({ nome: "faixas", fn: () => syncTable("faixas", faixasComOrdem) });
  }
  if (mudou("planos")) tarefas.push({ nome: "planos", fn: () => syncTable("planos", next.planos) });
  // turmas, sessoes_checkin, avisos, videos e produtos têm a mesma RLS "admin ou professor dono"
  // (2026-09-11_rls_fase2b.sql) — mesmo motivo de "professores" abaixo: só as linhas alteradas.
  if (mudou("turmas")) tarefas.push({ nome: "turmas", fn: () => syncTable("turmas", soAlterados(next.turmas, anterior?.turmas), next.turmas) });
  if (mudou("professores")) {
    // Manda pro banco só as linhas de professor que de fato mudaram (não a tabela inteira): um
    // professor sem ser admin só tem permissão (RLS) pra escrever a própria linha, e o upsert é
    // um único INSERT ... ON CONFLICT DO UPDATE — se ele incluir a linha de outro professor sem
    // ter mudado nada nela, o Postgres AINDA testa a política daquela linha e rejeita a operação
    // inteira. Comparação por referência funciona pelo mesmo motivo do `mudou` acima.
    tarefas.push({ nome: "professores", fn: () => syncTable("professores", soAlterados(next.professores, anterior?.professores), next.professores) });
  }
  if (mudou("alunos")) {
    tarefas.push({ nome: "alunos", fn: () => syncTable("alunos", next.alunos) });
    // Pagamentos ficam dentro de cada aluno, então reenviamos junto sempre que o array de alunos mudar.
    const todosPagamentos = next.alunos.flatMap((a) => (a.pagamentos || []).map((p) => ({ ...p, alunoId: a.id })));
    tarefas.push({ nome: "pagamentos", fn: () => syncTable("pagamentos", todosPagamentos) });
  }
  if (mudou("sessoes")) tarefas.push({ nome: "sessoes_checkin", fn: () => syncTable("sessoes_checkin", soAlterados(next.sessoes, anterior?.sessoes), next.sessoes) });
  if (mudou("checkins")) tarefas.push({ nome: "checkins", fn: () => syncTable("checkins", next.checkins) });
  if (mudou("avisos")) tarefas.push({ nome: "avisos", fn: () => syncTable("avisos", soAlterados(next.avisos || [], anterior?.avisos), next.avisos || []) });
  if (mudou("videos")) tarefas.push({ nome: "videos", fn: () => syncTable("videos", soAlterados(next.videos || [], anterior?.videos), next.videos || []) });
  if (mudou("unidades")) tarefas.push({ nome: "unidades", fn: () => syncTable("unidades", next.unidades || []) });
  if (mudou("produtos")) tarefas.push({ nome: "produtos", fn: () => syncTable("produtos", soAlterados(next.produtos || [], anterior?.produtos), next.produtos || []) });
  if (mudou("vendas")) tarefas.push({ nome: "vendas", fn: () => syncTable("vendas", next.vendas || []) });

  if (!tarefas.length) return;

  const resultados = await Promise.allSettled(tarefas.map((t) => t.fn()));
  const erros = resultados
    .map((r, i) => (r.status === "rejected" ? `${tarefas[i].nome}: ${r.reason?.message || r.reason}` : null))
    .filter(Boolean);

  if (erros.length) throw new Error(erros.join(" | "));
}

// Usado só pra migração automática do número de cadastro (atribuirCodigosFaltantes) — sincroniza
// apenas a tabela "alunos", sem disparar o resync geral das outras ~12 tabelas.
export async function saveAlunos(alunos) {
  await syncTable("alunos", alunos);
}

export async function salvarInscricaoPush({ alunoId, professorId }, subscription) {
  const json = subscription.toJSON();
  const row = {
    aluno_id: alunoId || null,
    professor_id: professorId || null,
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
  };
  await pg.upsert("push_subscriptions", [row]);
}

export async function notificarPush(titulo, mensagem, destinatario) {
  try {
    await fetch(`${SUPABASE_URL_EXPORT}/functions/v1/send-push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_KEY_EXPORT}`, apikey: SUPABASE_KEY_EXPORT },
      body: JSON.stringify({ titulo, mensagem, ...(destinatario || {}) }),
    });
  } catch (_) {
    // A função de envio pode ainda não estar publicada — não bloqueia o resto do app.
  }
}

async function chamarGerenciarContas(body) {
  // Manda o token da SESSÃO LOGADA (admin ou professor), não a chave pública — a function do
  // lado do servidor confere esse token contra `academia`/`professores` antes de executar
  // qualquer ação. Sem sessão (não deveria acontecer, essas ações exigem estar logado), cai
  // pra chave pública mesmo, que a function vai rejeitar com 401.
  let token = SUPABASE_KEY_EXPORT;
  try {
    const { data } = await supabaseAuth.getSession();
    if (data?.session?.access_token) token = data.session.access_token;
  } catch (_) {}
  const res = await fetch(`${SUPABASE_URL_EXPORT}/functions/v1/gerenciar-contas`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: SUPABASE_KEY_EXPORT },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(json.error || `Falha ao gerenciar conta (${res.status})`);
  return json;
}

/* Cria o usuário real no Supabase Auth pra um aluno/professor novo e devolve o authUserId a salvar no registro. */
export async function criarContaAuth(email, senha) {
  const { authUserId } = await chamarGerenciarContas({ acao: "criar", email, senha });
  return authUserId;
}

/* Redefine a senha de um aluno/professor já migrado pro Supabase Auth. */
export async function redefinirSenhaAuth(authUserId, senha) {
  await chamarGerenciarContas({ acao: "redefinir_senha", authUserId, senha });
}

/* Atualiza o e-mail de login (Supabase Auth) de um aluno/professor já migrado — necessário
   sempre que o e-mail do cadastro é corrigido/editado, senão a conta de login fica presa no
   e-mail antigo pra sempre e nenhuma redefinição de senha resolve. */
export async function atualizarEmailAuth(authUserId, email) {
  await chamarGerenciarContas({ acao: "atualizar_email", authUserId, email });
}

/* Exclui de vez a conta de login (Supabase Auth) de um aluno/professor — parte do direito de
   exclusão da LGPD. Não falha o fluxo de exclusão do cadastro se a conta já não existir mais. */
export async function excluirContaAuth(authUserId) {
  if (!authUserId) return;
  try {
    await chamarGerenciarContas({ acao: "excluir", authUserId });
  } catch (_) {
    // segue mesmo assim — o cadastro no app ainda vai ser removido das tabelas.
  }
}

/* Direito de exclusão da LGPD: apaga o histórico do aluno espalhado pelas tabelas que não fazem
   parte do array `alunos` sincronizado por syncTable (pagamentos já é coberto ali). Best-effort:
   RLS pode negar algumas dessas linhas pra quem não é admin (ex: professor apagando aluno
   próprio não consegue limpar push_subscriptions/recados_visualizados, só admin consegue) — cada
   delete falha isolado sem travar os outros.
   `alunoId` já não fica em nenhuma dessas linhas depois, então nenhuma sobra referenciando um
   cadastro apagado. */
export async function excluirDadosRelacionadosAluno(alunoId) {
  const tabelas = [
    ["checkins", "aluno_id"],
    ["vendas", "aluno_id"],
    ["push_subscriptions", "aluno_id"],
    ["recados_visualizados", "aluno_id"],
  ];
  await Promise.allSettled(tabelas.map(([tabela, coluna]) => pg.deleteWhere(tabela, coluna, alunoId)));
}
