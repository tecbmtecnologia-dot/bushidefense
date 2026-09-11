import { pg, SUPABASE_URL_EXPORT, SUPABASE_KEY_EXPORT } from "./supabaseClient.js";

/* Mapas de campo: chave usada na interface -> coluna no banco. */
const MAPS = {
  academia: {
    nome: "nome", chavePix: "chave_pix", logo: "logo", termoPadrao: "termo_padrao",
    termoPdf: "termo_pdf", termoPdfNome: "termo_pdf_nome", senhaAdmin: "senha_admin",
    endereco: "endereco", latitude: "latitude", longitude: "longitude", raioCheckin: "raio_checkin",
    instagram: "instagram", facebook: "facebook", whatsapp: "whatsapp",
    mensagemAniversario: "mensagem_aniversario", regrasTatame: "regras_tatame", marcaDagua: "marca_dagua",
    golpesProibidosPdf: "golpes_proibidos_pdf", golpesProibidosPdfNome: "golpes_proibidos_pdf_nome",
  },
  faixas: {
    id: "id", nome: "nome", cor: "cor", texto: "texto", borda: "borda", corPonta: "cor_ponta",
    grausMax: "graus_max", tempoMinimoAnos: "tempo_minimo_anos", aulasPorGrau: "aulas_por_grau",
    categoria: "categoria", observacoes: "observacoes", ordem: "ordem",
  },
  planos: { id: "id", nome: "nome", valor: "valor", periodicidade: "periodicidade", unidadeId: "unidade_id" },
  turmas: { id: "id", nome: "nome", dias: "dias", horario: "horario", horarioFim: "horario_fim", unidadeId: "unidade_id", professorId: "professor_id" },
  professores: {
    id: "id", nome: "nome", email: "email", especialidade: "especialidade",
    telefone: "telefone", endereco: "endereco", faixaId: "faixa_id", grau: "grau", foto: "foto", senha: "senha",
    dataNascimento: "data_nascimento", unidadeId: "unidade_id", ativo: "ativo",
  },
  alunos: {
    id: "id", nome: "nome", email: "email", senha: "senha", primeiroAcesso: "primeiro_acesso",
    telefone: "telefone", endereco: "endereco", contatoEmergenciaNome: "contato_emergencia_nome",
    contatoEmergenciaTelefone: "contato_emergencia_telefone", foto: "foto", faixaId: "faixa_id",
    grau: "grau", dataNascimento: "data_nascimento", matricula: "matricula", planoId: "plano_id",
    diaVencimento: "dia_vencimento", ultimoPagamento: "ultimo_pagamento",
    checkinsDesdeGraduacao: "checkins_desde_graduacao", termoAceito: "termo_aceito",
    termoAceitoEm: "termo_aceito_em", termoAssinadoManual: "termo_assinado_manual", professorId: "professor_id", peso: "peso", apelido: "apelido", unidadeId: "unidade_id", ativo: "ativo", turmaId: "turma_id", assinaturaTermo: "assinatura_termo", codigo: "codigo",
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

function toDb(entity, obj) {
  const map = MAPS[entity];
  const row = {};
  for (const [jsKey, dbKey] of Object.entries(map)) {
    const valor = obj[jsKey];
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

/* Upsert de todas as linhas atuais + remoção das que não existem mais na lista (cobre criar, editar e excluir). */
async function syncTable(entity, items) {
  const rows = items.map((it) => toDb(entity, it));
  const existing = await pg.select(entity, "select=id");
  const existingIds = (existing || []).map((r) => r.id);
  const nextIds = items.map((it) => it.id);
  const toDelete = existingIds.filter((id) => !nextIds.includes(id));

  if (rows.length) await pg.upsert(entity, rows);
  if (toDelete.length) await pg.deleteIn(entity, toDelete);
}

export async function loadAll() {
  const [academiaRows, faixasRows, planosRows, turmasRows, professoresRows, alunosRows, pagamentosRows, sessoesRows, checkinsRows, avisosRows, videosRows, unidadesRows, produtosRows, vendasRows] = await Promise.all([
    pg.select("academia", "select=*&limit=1"),
    pg.select("faixas", "select=*&order=ordem.asc"),
    pg.select("planos"),
    pg.select("turmas"),
    pg.select("professores"),
    pg.select("alunos"),
    pg.select("pagamentos"),
    pg.select("sessoes_checkin"),
    pg.select("checkins"),
    pg.select("avisos", "select=*&order=criado_em.desc"),
    pg.select("videos", "select=*&order=criado_em.desc"),
    pg.select("unidades", "select=*&order=nome.asc"),
    pg.select("produtos", "select=*&order=criado_em.desc"),
    pg.select("vendas", "select=*&order=criado_em.desc"),
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

  const tarefas = [];
  if (mudou("academia")) {
    tarefas.push({ nome: "academia", fn: () => pg.update("academia", next.academia.id, toDb("academia", next.academia)) });
  }
  if (mudou("faixas")) {
    const faixasComOrdem = next.faixas.map((f, i) => ({ ...f, ordem: i }));
    tarefas.push({ nome: "faixas", fn: () => syncTable("faixas", faixasComOrdem) });
  }
  if (mudou("planos")) tarefas.push({ nome: "planos", fn: () => syncTable("planos", next.planos) });
  if (mudou("turmas")) tarefas.push({ nome: "turmas", fn: () => syncTable("turmas", next.turmas) });
  if (mudou("professores")) tarefas.push({ nome: "professores", fn: () => syncTable("professores", next.professores) });
  if (mudou("alunos")) {
    tarefas.push({ nome: "alunos", fn: () => syncTable("alunos", next.alunos) });
    // Pagamentos ficam dentro de cada aluno, então reenviamos junto sempre que o array de alunos mudar.
    const todosPagamentos = next.alunos.flatMap((a) => (a.pagamentos || []).map((p) => ({ ...p, alunoId: a.id })));
    tarefas.push({ nome: "pagamentos", fn: () => syncTable("pagamentos", todosPagamentos) });
  }
  if (mudou("sessoes")) tarefas.push({ nome: "sessoes_checkin", fn: () => syncTable("sessoes_checkin", next.sessoes) });
  if (mudou("checkins")) tarefas.push({ nome: "checkins", fn: () => syncTable("checkins", next.checkins) });
  if (mudou("avisos")) tarefas.push({ nome: "avisos", fn: () => syncTable("avisos", next.avisos || []) });
  if (mudou("videos")) tarefas.push({ nome: "videos", fn: () => syncTable("videos", next.videos || []) });
  if (mudou("unidades")) tarefas.push({ nome: "unidades", fn: () => syncTable("unidades", next.unidades || []) });
  if (mudou("produtos")) tarefas.push({ nome: "produtos", fn: () => syncTable("produtos", next.produtos || []) });
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
