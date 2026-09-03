import { useState, useEffect, useRef, useLayoutEffect } from "react";
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid } from "recharts";
import { Shield, User, Users, QrCode, Camera, Check, Plus, Trash2, X, Award, CalendarCheck, CreditCard, ChevronRight, LogOut, Gift, RefreshCw, Download, Share } from "lucide-react";
import { loadAll, saveAll, salvarInscricaoPush, notificarPush } from "./db.js";
import { uploadArquivo, removerArquivo, pg } from "./supabaseClient.js";

const VAPID_PUBLIC_KEY = "BGKxQaeijzD265ey6QLdzFQDzzl9zZMthYYjlkAFKvsr-AtpsqrcanHs96CePRDF9wU6_N0z8-IU1PFVg3IpB6I";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

async function inscreverPush({ alunoId, professorId }) {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }
    await salvarInscricaoPush({ alunoId, professorId }, subscription);
  } catch (_) {
    // Notificação push é um recurso opcional — se falhar, o resto do app continua normal.
  }
}

const STORAGE_KEY = "qg-data-v3";
const REMEMBER_KEY = "qg-aluno-lembrado";
const REMEMBER_PROF_KEY = "qg-professor-lembrado";
const PERIOD_MESES = { mensal: 1, trimestral: 3, semestral: 6, anual: 12 };
const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const formatDias = (dias) => (Array.isArray(dias) ? dias.join("/") : (dias || ""));

const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : "id-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
// Navegadores modernos bloqueiam abrir um link "data:" direto em nova aba (por segurança).
// Como PDFs enviados no admin ficam guardados como data URL, convertemos pra um blob antes de abrir.
function abrirPdfDataUrl(dataUrl) {
  try {
    const [meta, base64] = dataUrl.split(",");
    const mimeMatch = meta.match(/data:([^;]+)/);
    const mime = mimeMatch ? mimeMatch[1] : "application/pdf";
    const binario = atob(base64);
    const bytes = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
    const blob = new Blob([bytes], { type: mime });
    window.open(URL.createObjectURL(blob), "_blank");
  } catch (_) {
    window.open(dataUrl, "_blank");
  }
}
const randomCode = () => (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).toUpperCase();
const hoje = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const dataLocalDe = (isoString) => { const d = new Date(isoString); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const randomSenha = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const normalizarTexto = (s) => (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

function addMeses(dataStr, n) {
  if (!dataStr) return null;
  const [y, m, d] = dataStr.split("-").map(Number);
  const dt = new Date(y, (m - 1) + n, d);
  return dt.toISOString().slice(0, 10);
}

function statusPagamento(aluno, planos) {
  const plano = (planos || []).find((p) => p.id === aluno.planoId);
  if (plano && Number(plano.valor) === 0) return { emDia: true, vencimento: null, plano };
  if (!aluno.ultimoPagamento || !plano) return { emDia: false, vencimento: null, plano };
  let vencimento = addMeses(aluno.ultimoPagamento, PERIOD_MESES[plano.periodicidade] || 1);
  if (aluno.diaVencimento) {
    const [y, m] = vencimento.split("-");
    vencimento = `${y}-${m}-${String(aluno.diaVencimento).padStart(2, "0")}`;
  }
  return { emDia: vencimento >= hoje(), vencimento, plano };
}

async function darBaixaEm(data, save, alunoId) {
  const alunos = data.alunos.map((a) => {
    if (a.id !== alunoId) return a;
    const plano = data.planos.find((p) => p.id === a.planoId);
    const pagamentos = [...(a.pagamentos || []), { id: uid(), data: hoje(), valor: plano?.valor || 0 }];
    return { ...a, ultimoPagamento: hoje(), pagamentos };
  });
  await save({ ...data, alunos });
  notificarPush("Pagamento confirmado!", "Sua mensalidade foi confirmada. Obrigado! 🥋", { alunoId });
}

async function desfazerBaixaEm(data, save, alunoId) {
  const alunos = data.alunos.map((a) => {
    if (a.id !== alunoId) return a;
    const pagamentos = [...(a.pagamentos || [])].sort((x, y) => x.data.localeCompare(y.data));
    pagamentos.pop();
    const ultimoPagamento = pagamentos.length ? pagamentos[pagamentos.length - 1].data : null;
    return { ...a, pagamentos, ultimoPagamento };
  });
  await save({ ...data, alunos });
}

async function marcarPresencaEm(data, save, sessaoId, alunoId) {
  const jaFez = data.checkins.some((c) => c.sessaoId === sessaoId && c.alunoId === alunoId);
  if (jaFez) return;
  const checkin = { id: uid(), sessaoId, alunoId, dataHora: new Date().toISOString() };
  const alunos = data.alunos.map((a) => (a.id === alunoId ? { ...a, checkinsDesdeGraduacao: (a.checkinsDesdeGraduacao || 0) + 1 } : a));
  await save({ ...data, checkins: [...data.checkins, checkin], alunos });
}

async function removerPresencaEm(data, save, sessaoId, alunoId) {
  const checkin = data.checkins.find((c) => c.sessaoId === sessaoId && c.alunoId === alunoId);
  if (!checkin) return;
  const checkins = data.checkins.filter((c) => c.id !== checkin.id);
  const alunos = data.alunos.map((a) => (a.id === alunoId ? { ...a, checkinsDesdeGraduacao: Math.max(0, (a.checkinsDesdeGraduacao || 0) - 1) } : a));
  await save({ ...data, checkins, alunos });
}

function distanciaMetros(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// Resolve qual local vale para o check-in do aluno: a unidade vinculada a ele, ou o QG por padrão.
// Se a unidade não tiver latitude/longitude cadastrada (ex: Personal), o check-in não exige localização.
function localCheckinDe(aluno, data) {
  if (aluno.unidadeId) {
    const u = (data.unidades || []).find((x) => x.id === aluno.unidadeId);
    if (u) {
      return {
        nome: u.nome,
        exigeLocalizacao: u.latitude != null && u.longitude != null,
        latitude: u.latitude, longitude: u.longitude, raioCheckin: u.raioCheckin || 150,
      };
    }
  }
  return {
    nome: data.academia.nome,
    exigeLocalizacao: true,
    latitude: data.academia.latitude, longitude: data.academia.longitude, raioCheckin: data.academia.raioCheckin || 150,
  };
}

function proximaTurmaId(turmas, agora = new Date(), turmasFeitasHojeIds = null) {
  const diasIdx = { "Dom": 0, "Seg": 1, "Ter": 2, "Qua": 3, "Qui": 4, "Sex": 5, "Sáb": 6 };
  const hojeStr = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}-${String(agora.getDate()).padStart(2, "0")}`;
  let melhorId = null;
  let menorDistancia = Infinity;
  (turmas || []).forEach((t) => {
    if (!t.horario || !/^\d{1,2}:\d{2}$/.test(t.horario)) return;
    const [hh, mm] = t.horario.split(":").map(Number);
    (t.dias || []).forEach((dia) => {
      const alvoDia = diasIdx[dia];
      if (alvoDia === undefined) return;
      for (let offset = -1; offset <= 7; offset++) {
        const candidato = new Date(agora);
        candidato.setDate(agora.getDate() + offset);
        if (candidato.getDay() !== alvoDia) continue;
        candidato.setHours(hh, mm, 0, 0);
        const candidatoStr = `${candidato.getFullYear()}-${String(candidato.getMonth() + 1).padStart(2, "0")}-${String(candidato.getDate()).padStart(2, "0")}`;
        // Se o aluno já fez check-in nessa turma hoje, não conta essa ocorrência de hoje como "próximo treino".
        if (turmasFeitasHojeIds && turmasFeitasHojeIds.has(t.id) && candidatoStr === hojeStr) continue;
        const diffMin = (candidato - agora) / 60000;
        if (diffMin < -120) continue; // aula terminou há muito tempo, ignora
        const distancia = Math.abs(diffMin); // a mais perto no tempo vence, seja ela passada (dentro da margem) ou futura
        if (distancia < menorDistancia) {
          menorDistancia = distancia;
          melhorId = t.id;
        }
      }
    });
  });
  return melhorId;
}

// Categorias etárias seguindo os cortes de idade da tabela de graduação da IBJJF (4-15 infantil, 16-17 infanto-juvenil, 18-29 adulto, 30+ master).
function categoriaEtaria(dataNascimento) {
  if (!dataNascimento) return null;
  const nasc = new Date(dataNascimento + "T00:00:00");
  if (isNaN(nasc.getTime())) return null;
  const hojeD = new Date();
  let idade = hojeD.getFullYear() - nasc.getFullYear();
  const m = hojeD.getMonth() - nasc.getMonth();
  if (m < 0 || (m === 0 && hojeD.getDate() < nasc.getDate())) idade--;
  if (idade < 16) return "Kids";
  if (idade < 18) return "Infanto-juvenil";
  if (idade < 30) return "Adulto";
  return "Master";
}

function ehAniversarioHoje(dataNascimento) {
  if (!dataNascimento) return false;
  const nasc = new Date(dataNascimento + "T00:00:00");
  if (isNaN(nasc.getTime())) return false;
  const hojeD = new Date();
  return nasc.getMonth() === hojeD.getMonth() && nasc.getDate() === hojeD.getDate();
}

function RecadoMestreAluno({ recado, aluno, nomeProfessor, onVisto }) {
  const [marcando, setMarcando] = useState(false);

  const marcarVisto = async () => {
    if (marcando) return;
    setMarcando(true);
    try {
      await pg.upsert("recados_visualizados", [{ recado_id: recado.id, aluno_id: aluno.id }]);
    } catch (_) {
      // Se der erro (ex: já tinha marcado antes), segue em frente do mesmo jeito.
    }
    try {
      const vistos = await pg.select("recados_visualizados", `recado_id=eq.${recado.id}`);
      if ((vistos || []).length >= recado.destinatariosTotal) {
        await removerArquivo("recados", recado.videoUrl);
        await pg.deleteIn("recados", [recado.id]);
      }
    } catch (_) {}
    onVisto(recado.id);
  };

  return (
    <div style={{ background: "linear-gradient(165deg, #1A1D24 0%, #0D0F13 100%)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 16, padding: 16, marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 20 }}>🎥</span>
        <div>
          <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 14, color: "#FFFFFF" }}>Recado do Mestre</div>
          <div style={{ fontSize: 11.5, color: "#9B9891" }}>{nomeProfessor ? `De: ${nomeProfessor}` : ""} · some depois que você assistir</div>
        </div>
      </div>
      <video
        controls autoPlay playsInline
        controlsList="nodownload noremoteplayback"
        onContextMenu={(e) => e.preventDefault()}
        style={{ width: "100%", borderRadius: 8, background: "#000", WebkitTouchCallout: "none" }}
        src={recado.videoUrl}
        onEnded={marcarVisto}
      />
      <div style={{ marginTop: 10 }}>
        <Button variant="vermelho" onClick={marcarVisto} disabled={marcando}>{marcando ? "..." : "Já vi, mestrão"}</Button>
      </div>
    </div>
  );
}

function BannerAniversario({ nome, mensagemPersonalizada }) {
  const primeiroNome = nome.split(" ")[0];
  const mensagem = (mensagemPersonalizada || "Toda a equipe do QG deseja um ótimo dia. 🥋").split("{nome}").join(primeiroNome);
  return (
    <div style={{
      background: "linear-gradient(90deg, #C9A227, #E4C765, #C9A227)",
      borderRadius: 14, padding: "14px 18px", marginBottom: 14,
      display: "flex", alignItems: "center", gap: 10, boxShadow: "0 2px 10px rgba(201,162,39,0.3)",
    }}>
      <span style={{ fontSize: 24 }}>🎉</span>
      <div>
        <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 15, color: "#17181B" }}>Feliz aniversário, {primeiroNome}!</div>
        <div style={{ fontSize: 12, color: "#3A3010" }}>{mensagem}</div>
      </div>
    </div>
  );
}

// Para quem já está na fase adulta/master, pula as faixas só-infantis ao calcular a próxima faixa (ex: da branca vai direto para a azul).
function proximaFaixaIndex(faixas, idxAtual, categoria) {
  const pulaInfantil = categoria === "Adulto" || categoria === "Master" || categoria === "Infanto-juvenil";
  for (let i = idxAtual + 1; i < faixas.length; i++) {
    if (pulaInfantil && faixas[i].categoria === "Infantil") continue;
    return i;
  }
  return -1;
}

// Resumo curto do progresso de graduação — usado no controle do professor.
function progressoGraduacaoInfo(faixas, faixaId, grau, checkinsDesdeGraduacao, categoria) {
  const idx = faixas.findIndex((f) => f.id === faixaId);
  const atual = faixas[idx];
  if (!atual) return { texto: "—", restantes: null };

  if (grau < (atual.grausMax || 0)) {
    const proximoGrau = grau + 1;
    if (atual.aulasPorGrau == null) return { texto: `Próximo: ${proximoGrau}º grau (sem critério de aulas)`, restantes: null };
    const restantes = Math.max(0, atual.aulasPorGrau - (checkinsDesdeGraduacao || 0));
    return { texto: restantes === 0 ? `Pronto para o ${proximoGrau}º grau` : `Faltam ${restantes} aula(s) p/ ${proximoGrau}º grau`, restantes };
  }

  const idxProxima = proximaFaixaIndex(faixas, idx, categoria);
  const proxima = idxProxima >= 0 ? faixas[idxProxima] : null;
  if (!proxima) return { texto: "Faixa máxima atingida", restantes: null };
  if (atual.aulasPorGrau == null) return { texto: `Graus completos — próxima: ${proxima.nome}`, restantes: null };
  const falta = Math.max(0, atual.aulasPorGrau - (checkinsDesdeGraduacao || 0));
  return { texto: falta === 0 ? `Elegível p/ avaliação da faixa ${proxima.nome}` : `Faltam ${falta} aula(s) p/ avaliação da faixa ${proxima.nome}`, restantes: falta };
}

function progressoGraduacaoTexto(faixas, faixaId, grau, checkinsDesdeGraduacao, categoria) {
  return progressoGraduacaoInfo(faixas, faixaId, grau, checkinsDesdeGraduacao, categoria).texto;
}

const FAIXAS_IBJJF = [
  { id: "branca", nome: "Branca", cor: "#F5F3EC", texto: "#1B2027", borda: "#D8D3C4", grausMax: 4, tempoMinimoAnos: null, aulasPorGrau: null, categoria: "Infantil" },
  { id: "cinza-branca", nome: "Cinza e Branca", cor: "#D9D9D6", texto: "#1B2027", borda: "#B9B9B4", grausMax: 4, tempoMinimoAnos: null, aulasPorGrau: null, categoria: "Infantil" },
  { id: "cinza", nome: "Cinza", cor: "#A9A9A5", texto: "#1B2027", borda: "#8B8B87", grausMax: 4, tempoMinimoAnos: null, aulasPorGrau: null, categoria: "Infantil" },
  { id: "cinza-preta", nome: "Cinza e Preta", cor: "#6E6E6B", texto: "#FFFFFF", borda: "#4E4E4C", grausMax: 4, tempoMinimoAnos: null, aulasPorGrau: null, categoria: "Infantil" },
  { id: "amarela-branca", nome: "Amarela e Branca", cor: "#F5E28A", texto: "#1B2027", borda: "#D9C55F", grausMax: 4, tempoMinimoAnos: null, aulasPorGrau: null, categoria: "Infantil" },
  { id: "amarela", nome: "Amarela", cor: "#F2C927", texto: "#1B2027", borda: "#C9A227", grausMax: 4, tempoMinimoAnos: null, aulasPorGrau: null, categoria: "Infantil" },
  { id: "amarela-preta", nome: "Amarela e Preta", cor: "#C9A227", texto: "#1B2027", borda: "#8C7016", grausMax: 4, tempoMinimoAnos: null, aulasPorGrau: null, categoria: "Infantil" },
  { id: "laranja-branca", nome: "Laranja e Branca", cor: "#F5B26B", texto: "#1B2027", borda: "#D98E3D", grausMax: 4, tempoMinimoAnos: null, aulasPorGrau: null, categoria: "Infantil" },
  { id: "laranja", nome: "Laranja", cor: "#E8791D", texto: "#FFFFFF", borda: "#B85E14", grausMax: 4, tempoMinimoAnos: null, aulasPorGrau: null, categoria: "Infantil" },
  { id: "laranja-preta", nome: "Laranja e Preta", cor: "#B85E14", texto: "#FFFFFF", borda: "#7E3E0C", grausMax: 4, tempoMinimoAnos: null, aulasPorGrau: null, categoria: "Infantil" },
  { id: "verde-branca", nome: "Verde e Branca", cor: "#A8D5A2", texto: "#1B2027", borda: "#7CB876", grausMax: 4, tempoMinimoAnos: null, aulasPorGrau: null, categoria: "Infantil" },
  { id: "verde", nome: "Verde", cor: "#2E8B3D", texto: "#FFFFFF", borda: "#1F5C2A", grausMax: 4, tempoMinimoAnos: null, aulasPorGrau: null, categoria: "Infantil" },
  { id: "verde-preta", nome: "Verde e Preta", cor: "#1F5C2A", texto: "#FFFFFF", borda: "#123A1A", grausMax: 4, tempoMinimoAnos: null, aulasPorGrau: null, categoria: "Infantil" },
  { id: "azul", nome: "Azul", cor: "#1959AE", texto: "#FFFFFF", borda: "#123E7C", grausMax: 4, tempoMinimoAnos: 2, aulasPorGrau: 40, categoria: "Adulto" },
  { id: "roxa", nome: "Roxa", cor: "#6B2D8C", texto: "#FFFFFF", borda: "#4E2166", grausMax: 4, tempoMinimoAnos: 1.5, aulasPorGrau: null, categoria: "Adulto" },
  { id: "marrom", nome: "Marrom", cor: "#5A3A22", texto: "#FFFFFF", borda: "#402913", grausMax: 4, tempoMinimoAnos: 1, aulasPorGrau: null, categoria: "Adulto" },
  { id: "preta", nome: "Preta", cor: "#17181B", texto: "#FFFFFF", borda: "#000000", corPonta: "#C81E1E", grausMax: 6, tempoMinimoAnos: 3, aulasPorGrau: null, categoria: "Adulto", observacoes: "IBJJF: 3 anos entre o 1º e o 3º grau, 5 anos a partir do 4º grau." },
  { id: "vermelha-preta", nome: "Vermelha e Preta (7º grau)", cor: "#8C1414", texto: "#FFFFFF", borda: "#5C0D0D", grausMax: 0, tempoMinimoAnos: 7, aulasPorGrau: null, categoria: "Mestre" },
  { id: "vermelha-branca", nome: "Vermelha e Branca (8º grau)", cor: "#B5251F", texto: "#FFFFFF", borda: "#7C1915", grausMax: 0, tempoMinimoAnos: 7, aulasPorGrau: null, categoria: "Mestre" },
  { id: "vermelha", nome: "Vermelha (9º grau)", cor: "#C81E1E", texto: "#FFFFFF", borda: "#8C1414", grausMax: 0, tempoMinimoAnos: 10, aulasPorGrau: null, categoria: "Mestre" },
];

const PLANOS_PADRAO = [
  { id: "mensal", nome: "Mensal", valor: 150, periodicidade: "mensal" },
  { id: "trimestral", nome: "Trimestral", valor: 405, periodicidade: "trimestral" },
  { id: "anual", nome: "Anual", valor: 1440, periodicidade: "anual" },
  { id: "policial", nome: "Policial", valor: 100, periodicidade: "mensal" },
  { id: "vip", nome: "VIP", valor: 250, periodicidade: "mensal" },
];

const LOGO_PADRAO = "data:image/png;base64,data:image/png;base64,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";

function seed() {
  const p1 = { id: uid(), tipo: "professor", nome: "Mestre Rafael Souza", email: "rafael@qg.com", especialidade: "Fundamentos e Competição" };
  const a1 = {
    id: uid(), tipo: "aluno", nome: "João Pedro Lima", email: "joao@aluno.com", senha: "123456", primeiroAcesso: false,
    telefone: "", endereco: "", contatoEmergenciaNome: "", contatoEmergenciaTelefone: "", foto: null,
    faixaId: "azul", grau: 2, dataNascimento: "1998-08-15", matricula: hoje(), planoId: "mensal", diaVencimento: 10,
    ultimoPagamento: hoje(), pagamentos: [{ id: uid(), data: hoje(), valor: 150 }], checkinsDesdeGraduacao: 12,
    termoAceito: true, termoAceitoEm: new Date().toISOString(), termoAssinadoManual: false,
  };
  const a2 = {
    id: uid(), tipo: "aluno", nome: "Marina Alves", email: "marina@aluno.com", senha: "123456", primeiroAcesso: true,
    telefone: "", endereco: "", contatoEmergenciaNome: "", contatoEmergenciaTelefone: "", foto: null,
    faixaId: "branca", grau: 0, dataNascimento: "2001-03-02", matricula: hoje(), planoId: "vip", diaVencimento: 5,
    ultimoPagamento: null, pagamentos: [], checkinsDesdeGraduacao: 0,
    termoAceito: false, termoAceitoEm: null, termoAssinadoManual: false,
  };
  const t1 = { id: uid(), nome: "Fundamentos", dias: ["Seg", "Qua", "Sex"], horario: "19:00" };
  const t2 = { id: uid(), nome: "Competição", dias: ["Ter", "Qui"], horario: "20:30" };
  return {
    academia: {
      nome: "QG Cia Paulista", chavePix: "", logo: LOGO_PADRAO, termoPdf: null, termoPdfNome: "", senhaAdmin: "admin123",
      termoPadrao: "Declaro estar ciente dos riscos inerentes à prática de Jiu-Jitsu e libero a equipe QG de responsabilidade por lesões decorrentes do treino, comprometendo-me a seguir as normas de segurança da academia.",
    },
    professores: [p1],
    alunos: [a1, a2],
    turmas: [t1, t2],
    faixas: FAIXAS_IBJJF,
    planos: PLANOS_PADRAO,
    sessoes: [],
    checkins: [],
  };
}

function useFonts() {
  useEffect(() => {
    if (document.getElementById("qg-fonts")) return;
    const link = document.createElement("link");
    link.id = "qg-fonts";
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Oswald:wght@500;700&family=Inter:wght@400;500;600;700&display=swap";
    document.head.appendChild(link);
  }, []);
}

function BeltBar({ faixas, faixaId, grau, size = "md", textColor = "#1B2027" }) {
  const f = (faixas || []).find((x) => x.id === faixaId) || (faixas || [])[0] || { cor: "#F5F3EC", borda: "#D8D3C4", grausMax: 4, nome: "—" };
  const h = size === "lg" ? 40 : 24;
  const w = size === "lg" ? 220 : 140;
  const tipW = w * 0.22;
  const slots = Array.from({ length: f.grausMax || 0 });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <div style={{ position: "relative", width: w, height: h, borderRadius: 4, background: f.cor, border: `2px solid ${f.borda}`, overflow: "hidden", display: "flex", alignItems: "center" }}>
        <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: tipW, background: f.corPonta || "#17181B" }}>
          <div style={{ display: "flex", gap: 3, position: "absolute", left: 4, top: 0, bottom: 0, alignItems: "center" }}>
            {slots.map((_, i) => (
              <div key={i} style={{ width: 3, height: "70%", background: i < grau ? "#FFFFFF" : "rgba(255,255,255,0.18)", borderRadius: 1 }} />
            ))}
          </div>
        </div>
      </div>
      <span style={{ fontFamily: "Inter", fontSize: size === "lg" ? 15 : 13, fontWeight: 600, color: textColor }}>
        Faixa {f.nome}{f.grausMax > 0 ? ` · ${grau}º grau` : ""}
      </span>
    </div>
  );
}

function Avatar({ foto, nome, size = 36, borderColor = "#12213B" }) {
  const iniciais = nome.split(" ").slice(0, 2).map((p) => p[0]).join("").toUpperCase();
  return foto ? (
    <img src={foto} alt={nome} style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", border: `2px solid ${borderColor}` }} />
  ) : (
    <div style={{ width: size, height: size, borderRadius: "50%", background: "#12213B", color: "#C9A227", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Inter", fontWeight: 700, fontSize: size * 0.38, border: `2px solid ${borderColor}` }}>
      {iniciais}
    </div>
  );
}

function CropperFoto({ arquivo, onSave, onCancel }) {
  const VIEWPORT = 240;
  const [src, setSrc] = useState(null);
  const [natural, setNatural] = useState({ w: 1, h: 1 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef(null);
  const imgRef = useRef(null);

  useEffect(() => {
    const reader = new FileReader();
    reader.onload = () => setSrc(reader.result);
    reader.readAsDataURL(arquivo);
  }, [arquivo]);

  const onImgLoad = (e) => { setNatural({ w: e.target.naturalWidth, h: e.target.naturalHeight }); setZoom(1); setPan({ x: 0, y: 0 }); };

  const baseScale = VIEWPORT / Math.min(natural.w, natural.h);
  const displayScale = baseScale * zoom;
  const displayW = natural.w * displayScale;
  const displayH = natural.h * displayScale;

  const iniciarArraste = (clientX, clientY) => { dragRef.current = { startX: clientX, startY: clientY, origX: pan.x, origY: pan.y }; };
  const moverArraste = (clientX, clientY) => {
    if (!dragRef.current) return;
    setPan({ x: dragRef.current.origX + (clientX - dragRef.current.startX), y: dragRef.current.origY + (clientY - dragRef.current.startY) });
  };
  const pararArraste = () => { dragRef.current = null; };

  const salvar = () => {
    const img = new Image();
    img.onload = () => {
      const OUT = 480;
      const canvas = document.createElement("canvas");
      canvas.width = OUT; canvas.height = OUT;
      const ctx = canvas.getContext("2d");
      const outScale = displayScale * (OUT / VIEWPORT);
      const w = natural.w * outScale;
      const h = natural.h * outScale;
      const dx = OUT / 2 - w / 2 + pan.x * (OUT / VIEWPORT);
      const dy = OUT / 2 - h / 2 + pan.y * (OUT / VIEWPORT);
      ctx.drawImage(img, dx, dy, w, h);
      onSave(canvas.toDataURL("image/jpeg", 0.92));
    };
    img.src = src;
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(20,20,20,0.85)", zIndex: 1000, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "#fff", borderRadius: 14, padding: 20, width: "100%", maxWidth: 340, textAlign: "center" }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: "#12213B", marginBottom: 10 }}>Ajustar foto</div>
        {src && (
          <div
            style={{ width: VIEWPORT, height: VIEWPORT, borderRadius: "50%", overflow: "hidden", position: "relative", margin: "0 auto", background: "#EDE8DC", cursor: "grab", touchAction: "none" }}
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); iniciarArraste(e.clientX, e.clientY); }}
            onPointerMove={(e) => moverArraste(e.clientX, e.clientY)}
            onPointerUp={pararArraste}
            onPointerLeave={pararArraste}
          >
            <img
              ref={imgRef}
              src={src}
              onLoad={onImgLoad}
              alt=""
              draggable={false}
              style={{ position: "absolute", width: displayW, height: displayH, left: `calc(50% - ${displayW / 2}px + ${pan.x}px)`, top: `calc(50% - ${displayH / 2}px + ${pan.y}px)`, userSelect: "none", pointerEvents: "none" }}
            />
          </div>
        )}
        <div style={{ marginTop: 14 }}>
          <input type="range" min="1" max="3" step="0.01" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} style={{ width: "100%" }} />
          <div style={{ fontSize: 11.5, color: "#8A8574" }}>Arraste a foto para posicionar, use a régua para dar zoom</div>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 14 }}>
          <Button icon={Check} variant="gold" onClick={salvar}>Salvar foto</Button>
          <Button variant="ghost" icon={X} onClick={onCancel}>Cancelar</Button>
        </div>
      </div>
    </div>
  );
}

function Card({ children, style, dark }) {
  return <div style={{
    background: dark ? "#1A1D24" : "#FFFFFF",
    border: dark ? "1px solid rgba(255,255,255,0.06)" : "1px solid #EFEBDF",
    borderRadius: 14, padding: 18,
    boxShadow: dark ? "0 1px 3px rgba(0,0,0,0.25)" : "0 1px 3px rgba(23,24,27,0.05)",
    ...style,
  }}>{children}</div>;
}

function StatTile({ numero, label }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.07)", borderRadius: 12, padding: "12px 14px" }}>
      <div style={{ fontFamily: "Oswald", fontSize: 24, fontWeight: 700, color: "#C9A227" }}>{numero}</div>
      <div style={{ fontSize: 11, color: "#C9C4B4", marginTop: 2 }}>{label}</div>
    </div>
  );
}

function ActionPill({ children, variant = "outline", onClick, corFundo, corTexto, disabled }) {
  const primary = variant === "primary";
  return (
    <button onClick={onClick} disabled={disabled} style={{
      flex: 1, textAlign: "center", padding: "11px 0", borderRadius: 24, fontSize: 12.5, fontWeight: 700,
      fontFamily: "Inter", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.7 : 1,
      border: primary ? "none" : "1px solid rgba(255,255,255,0.14)",
      background: primary ? (corFundo || "#C81E1E") : "rgba(255,255,255,0.05)",
      color: primary ? (corTexto || "#FFFFFF") : "#F5F3EC",
    }}>{children}</button>
  );
}

function Button({ children, onClick, variant = "primary", icon: Icon, style, type = "button", disabled }) {
  const variants = {
    primary: { background: "#12213B", color: "#FFFFFF" },
    gold: { background: "#C9A227", color: "#17181B" },
    vermelho: { background: "#C81E1E", color: "#FFFFFF" },
    ghost: { background: "transparent", color: "#12213B", border: "1px solid #C7C1B0" },
    danger: { background: "#FFF3F0", color: "#B3261E", border: "1px solid #F3C9C0" },
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 8, fontFamily: "Inter", fontWeight: 600, fontSize: 13.5, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, border: "none", ...variants[variant], ...style }}>
      {Icon && <Icon size={15} />}
      {children}
    </button>
  );
}

function Field({ label, children, labelColor = "#5A5648" }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5, fontFamily: "Inter", minWidth: 0, width: "100%" }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: labelColor, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</span>
      {children}
    </label>
  );
}

const inputStyle = { padding: "9px 11px", borderRadius: 7, border: "1px solid #D8D3C4", fontFamily: "Inter", fontSize: 14, outline: "none", background: "#FBFAF7", width: "100%", boxSizing: "border-box", minWidth: 0 };
const iconBtnStyle = { border: "1px solid #D8D3C4", background: "#fff", borderRadius: 6, width: 26, height: 26, cursor: "pointer", fontSize: 13 };
const blockTitleStyle = { fontWeight: 700, fontSize: 14, marginBottom: 10, fontFamily: "Oswald", textTransform: "uppercase", color: "#12213B" };

function Tag({ ok, children }) {
  return <span style={{ fontSize: 11.5, fontWeight: 700, padding: "4px 9px", borderRadius: 20, background: ok ? "#E7F4E8" : "#FFF3F0", color: ok ? "#1E7A34" : "#B3261E" }}>{children}</span>;
}

function Empty({ children, dark = false }) {
  return <div style={{ padding: 24, textAlign: "center", color: dark ? "#C9C4B4" : "#8A8574", fontSize: 13.5, border: `1px dashed ${dark ? "rgba(255,255,255,0.25)" : "#D8D3C4"}`, borderRadius: 10 }}>{children}</div>;
}

function EvolucaoFaixas({ faixas, faixaId, grau, checkinsDesdeGraduacao, categoria }) {
  const idx = faixas.findIndex((f) => f.id === faixaId);
  const atual = faixas[idx];
  if (!atual) return null;

  const aindaTemGrauNaFaixa = grau < (atual.grausMax || 0);

  if (aindaTemGrauNaFaixa) {
    const proximoGrau = grau + 1;
    const aulasRestantes = atual.aulasPorGrau != null ? Math.max(0, atual.aulasPorGrau - (checkinsDesdeGraduacao || 0)) : null;
    const progresso = atual.aulasPorGrau ? Math.min(100, Math.round(((checkinsDesdeGraduacao || 0) / atual.aulasPorGrau) * 100)) : null;
    return (
      <Card style={{ background: "#1A1D24", border: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ ...blockTitleStyle, color: "#F5F3EC" }}>Sua evolução</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 6, flexWrap: "wrap" }}>
          <BeltBar faixas={faixas} faixaId={atual.id} grau={grau} size="lg" textColor="#FFFFFF" />
          <span style={{ fontSize: 18, color: "#6B6862" }}>→</span>
          <BeltBar faixas={faixas} faixaId={atual.id} grau={proximoGrau} size="lg" textColor="#FFFFFF" />
        </div>
        {progresso !== null ? (
          <div style={{ marginTop: 14 }}>
            <div style={{ height: 10, background: "rgba(255,255,255,0.08)", borderRadius: 6, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${progresso}%`, background: "#C9A227" }} />
            </div>
            <div style={{ fontSize: 11.5, color: "#9B9891", marginTop: 4 }}>{progresso}% ({checkinsDesdeGraduacao || 0}/{atual.aulasPorGrau} aulas)</div>
            <div style={{ fontSize: 13, color: "#C4C0B4", marginTop: 8 }}>Faltam aproximadamente <b style={{ color: "#F5F3EC" }}>{aulasRestantes}</b> aula(s) para o <b style={{ color: "#F5F3EC" }}>{proximoGrau}º grau</b>.</div>
          </div>
        ) : (
          <div style={{ fontSize: 12, color: "#9B9891", marginTop: 10 }}>Critério de aulas ainda não definido — a graduação de grau fica a critério do seu professor.</div>
        )}
      </Card>
    );
  }

  const idxProxima = proximaFaixaIndex(faixas, idx, categoria);
  const proxima = idxProxima >= 0 ? faixas[idxProxima] : null;

  if (proxima && atual.aulasPorGrau != null) {
    const faltamAvaliacao = Math.max(0, atual.aulasPorGrau - (checkinsDesdeGraduacao || 0));
    const progresso = Math.min(100, Math.round(((checkinsDesdeGraduacao || 0) / atual.aulasPorGrau) * 100));
    const elegivel = faltamAvaliacao === 0;
    return (
      <Card style={{ background: "#1A1D24", border: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ ...blockTitleStyle, color: "#F5F3EC" }}>Sua evolução</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 6, flexWrap: "wrap" }}>
          <BeltBar faixas={faixas} faixaId={atual.id} grau={grau} size="lg" textColor="#FFFFFF" />
          <span style={{ fontSize: 18, color: "#6B6862" }}>→</span>
          <BeltBar faixas={faixas} faixaId={proxima.id} grau={0} textColor="#FFFFFF" />
        </div>
        <div style={{ marginTop: 14 }}>
          <div style={{ height: 10, background: "rgba(255,255,255,0.08)", borderRadius: 6, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${progresso}%`, background: "#C9A227" }} />
          </div>
          <div style={{ fontSize: 11.5, color: "#9B9891", marginTop: 4 }}>{progresso}% ({checkinsDesdeGraduacao || 0}/{atual.aulasPorGrau} aulas)</div>
        </div>
        {elegivel ? (
          <div style={{ fontSize: 13, color: "#4ADE80", fontWeight: 600, marginTop: 8 }}>Você já está elegível para avaliação da faixa {proxima.nome}! Fale com seu professor.</div>
        ) : (
          <div style={{ fontSize: 13, color: "#C4C0B4", marginTop: 8 }}>Faltam aproximadamente <b style={{ color: "#F5F3EC" }}>{faltamAvaliacao}</b> aula(s) para ficar elegível para avaliação da faixa <b style={{ color: "#F5F3EC" }}>{proxima.nome}</b>.</div>
        )}
      </Card>
    );
  }

  return (
    <Card style={{ background: "#1A1D24", border: "1px solid rgba(255,255,255,0.06)" }}>
      <div style={{ ...blockTitleStyle, color: "#F5F3EC" }}>Sua evolução</div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 6, flexWrap: "wrap" }}>
        <BeltBar faixas={faixas} faixaId={atual.id} grau={grau} size="lg" textColor="#FFFFFF" />
        {proxima && (
          <>
            <span style={{ fontSize: 18, color: "#6B6862" }}>→</span>
            <BeltBar faixas={faixas} faixaId={proxima.id} grau={0} textColor="#FFFFFF" />
          </>
        )}
      </div>
      {proxima ? (
        <div style={{ fontSize: 13, color: "#C4C0B4", marginTop: 10 }}>Você completou todos os graus da faixa atual — a próxima graduação é a faixa <b style={{ color: "#F5F3EC" }}>{proxima.nome}</b>, a critério do seu professor.</div>
      ) : (
        <div style={{ fontSize: 13, color: "#C4C0B4", marginTop: 10 }}>Você está na faixa mais alta da graduação — parabéns!</div>
      )}
    </Card>
  );
}

function GradeHorarios({ turmas }) {
  const [aberto, setAberto] = useState(false);
  const dias = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
  const comAula = dias.filter((dia) => turmas.some((t) => (t.dias || []).includes(dia)));
  return (
    <Card style={{ marginBottom: 14, background: "#1A1D24", border: "1px solid rgba(255,255,255,0.06)" }}>
      <button onClick={() => setAberto((v) => !v)} style={{ width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ ...blockTitleStyle, color: "#FFFFFF" }}>Grade de horários</span>
        <span style={{ fontSize: 18, color: "#C9A227" }}>{aberto ? "−" : "+"}</span>
      </button>
      {aberto && (
        comAula.length === 0 ? (
          <div style={{ marginTop: 10 }}><Empty dark>Nenhuma turma cadastrada ainda.</Empty></div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
            {comAula.map((dia) => (
              <div key={dia}>
                <div style={{ fontWeight: 700, fontSize: 12.5, color: "#C9A227", marginBottom: 4 }}>{dia}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {turmas.filter((t) => (t.dias || []).includes(dia)).sort((a, b) => (a.horario || "").localeCompare(b.horario || "")).map((t) => (
                    <div key={t.id} style={{ fontSize: 12.5, color: "#5A5648", display: "flex", justifyContent: "space-between", background: "#FBFAF7", borderRadius: 6, padding: "6px 10px", border: "1px solid #E7E2D6" }}>
                      <span>{t.nome}</span><span>{t.horario}{t.horarioFim ? ` - ${t.horarioFim}` : ""}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </Card>
  );
}

function FinanceiroAluno({ aluno, planos, chavePix }) {
  const [aberto, setAberto] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const { emDia, vencimento, plano } = statusPagamento(aluno, planos);
  const pagamentos = [...(aluno.pagamentos || [])].sort((a, b) => b.data.localeCompare(a.data));

  const copiarPix = async () => {
    try { await navigator.clipboard.writeText(chavePix); setCopiado(true); setTimeout(() => setCopiado(false), 2000); } catch (_) {}
  };

  return (
    <Card style={{ marginBottom: 14, background: "#1A1D24", border: "1px solid rgba(255,255,255,0.06)" }}>
      <button onClick={() => setAberto((v) => !v)} style={{ width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ ...blockTitleStyle, color: "#FFFFFF" }}>Financeiro</span>
        <span style={{ fontSize: 18, color: "#C9A227" }}>{aberto ? "−" : "+"}</span>
      </button>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8, flexWrap: "wrap", gap: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#FFFFFF" }}>Plano: {plano?.nome || "—"}</span>
        <Tag ok={emDia}>{emDia ? "Em dia" : "Pendente"}</Tag>
      </div>
      {vencimento && <div style={{ fontSize: 12, color: "#C9C4B4", marginTop: 2 }}>Próximo vencimento: {new Date(vencimento + "T00:00:00").toLocaleDateString("pt-BR")}</div>}

      {chavePix && !emDia && (
        <div style={{ marginTop: 10, padding: 10, background: "#FBFAF7", border: "1px solid #E7E2D6", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <div style={{ fontSize: 12, color: "#5A5648" }}>Chave PIX do QG: <b>{chavePix}</b></div>
          <Button variant="gold" onClick={copiarPix}>{copiado ? "Copiado!" : "Copiar chave PIX"}</Button>
        </div>
      )}

      {aberto && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.15)" }}>
          <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 6, color: "#FFFFFF" }}>Histórico de pagamentos</div>
          {pagamentos.length === 0 ? (
            <Empty dark>Nenhum pagamento registrado ainda.</Empty>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {pagamentos.map((p) => (
                <div key={p.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, background: "#FBFAF7", borderRadius: 6, padding: "6px 10px", border: "1px solid #E7E2D6", color: "#1B2027" }}>
                  <span>{new Date(p.data + "T00:00:00").toLocaleDateString("pt-BR")}</span>
                  <span>R$ {p.valor.toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function VideoPlayer({ video }) {
  const embed = youtubeEmbedUrl(video.url);
  const isArquivo = /\.(mp4|webm|ogg)(\?.*)?$/i.test(video.url) || video.url.includes("/storage/v1/object/public/");
  return (
    <div>
      <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 4, color: "#FFFFFF" }}>{video.titulo}</div>
      {video.legenda && <div style={{ fontSize: 12, color: "#C9C4B4", marginBottom: 6 }}>{video.legenda}</div>}
      {embed ? (
        <div style={{ position: "relative", paddingTop: "56.25%", borderRadius: 8, overflow: "hidden" }}>
          <iframe src={embed} title={video.titulo} allowFullScreen style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: "none" }} />
        </div>
      ) : isArquivo ? (
        <video controls playsInline style={{ width: "100%", borderRadius: 8, background: "#000" }} src={video.url} />
      ) : (
        <a href={video.url} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: "#C9A227", fontWeight: 600 }}>Assistir vídeo</a>
      )}
    </div>
  );
}

function VideosAluno({ videos }) {
  const [aberto, setAberto] = useState(false);
  const [selecionadoId, setSelecionadoId] = useState(null);
  const lista = [...videos].sort((a, b) => (b.criadoEm || "").localeCompare(a.criadoEm || ""));
  const selecionado = lista.find((v) => v.id === selecionadoId);

  return (
    <Card style={{ marginBottom: 14, background: "#1A1D24", border: "1px solid rgba(255,255,255,0.06)" }}>
      <button onClick={() => setAberto((v) => !v)} style={{ width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ ...blockTitleStyle, color: "#FFFFFF" }}>Vídeos de técnicas</span>
        <span style={{ fontSize: 18, color: "#C9A227" }}>{aberto ? "−" : "+"}</span>
      </button>
      {aberto && (
        <div style={{ marginTop: 10 }}>
          {selecionado ? (
            <div>
              <button onClick={() => setSelecionadoId(null)} style={{ background: "none", border: "none", color: "#C9A227", fontSize: 12.5, fontWeight: 600, cursor: "pointer", marginBottom: 10, padding: 0 }}>← Voltar para a lista</button>
              <VideoPlayer video={selecionado} />
            </div>
          ) : lista.length === 0 ? (
            <Empty dark>Nenhum vídeo publicado ainda.</Empty>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {lista.map((v) => (
                <button key={v.id} onClick={() => setSelecionadoId(v.id)} style={{ textAlign: "left", background: "#FBFAF7", border: "1px solid #E7E2D6", borderRadius: 8, padding: "10px 12px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13.5, color: "#1B2027" }}>{v.titulo}</div>
                    {v.legenda && <div style={{ fontSize: 11.5, color: "#8A8574" }}>{v.legenda}</div>}
                  </div>
                  <ChevronRight size={16} color="#8A8574" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function ConfirmDelete({ onConfirm, size = 16 }) {
  const [confirmando, setConfirmando] = useState(false);
  if (confirmando) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 11.5, color: "#B3261E", fontWeight: 700 }}>Confirmar?</span>
        <button onClick={() => { onConfirm(); setConfirmando(false); }} style={{ border: "none", background: "#B3261E", color: "#fff", borderRadius: 6, padding: "3px 9px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>Sim</button>
        <button onClick={() => setConfirmando(false)} style={{ border: "1px solid #D8D3C4", background: "#fff", borderRadius: 6, padding: "3px 9px", fontSize: 11.5, cursor: "pointer" }}>Não</button>
      </span>
    );
  }
  return (
    <button onClick={() => setConfirmando(true)} style={{ border: "none", background: "none", cursor: "pointer", color: "#B3261E" }}>
      <Trash2 size={size} />
    </button>
  );
}

function ConfirmButton({ onConfirm, children, icon = Check, variant = "primary", dark = false }) {
  const [confirmando, setConfirmando] = useState(false);
  if (confirmando) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12.5, color: dark ? "#C9C4B4" : "#5A5648", fontWeight: 600 }}>Confirma salvar?</span>
        <Button variant="gold" onClick={() => { onConfirm(); setConfirmando(false); }}>Sim</Button>
        <Button variant="ghost" style={dark ? { color: "#FFFFFF", border: "1px solid rgba(255,255,255,0.35)" } : undefined} onClick={() => setConfirmando(false)}>Não</Button>
      </span>
    );
  }
  return (
    <Button icon={icon} variant={variant} onClick={() => setConfirmando(true)}>{children}</Button>
  );
}

function useDeslizarAbas(pagerRef, totalPaginas, irParaPagina) {
  useEffect(() => {
    const el = pagerRef.current;
    if (!el) return;
    let startX = 0, startY = 0, startScrollLeft = 0, startTime = 0, eixo = null, arrastando = false;

    const aoComecar = (e) => {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      startScrollLeft = el.scrollLeft;
      startTime = Date.now();
      eixo = null;
      arrastando = false;
    };
    const aoMover = (e) => {
      if (e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (eixo === null) {
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
          eixo = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
          if (eixo === "x") arrastando = true;
        }
      }
      if (eixo === "x") {
        e.preventDefault();
        el.scrollLeft = startScrollLeft - dx;
      }
    };
    const aoSoltar = () => {
      if (arrastando) {
        const largura = el.clientWidth;
        const paginaInicial = Math.round(startScrollLeft / largura);
        const dxTotal = startScrollLeft - el.scrollLeft; // positivo = arrastou pra esquerda (avança)
        const tempoDecorrido = Math.max(1, Date.now() - startTime);
        const velocidade = Math.abs(dxTotal) / tempoDecorrido; // px por ms
        const distanciaMinima = largura * 0.12; // 12% da largura já basta
        const foiUmToqueRapido = velocidade > 0.35; // "tapa" rápido, mesmo curto
        let alvo = paginaInicial;
        if (Math.abs(dxTotal) > distanciaMinima || foiUmToqueRapido) {
          alvo = dxTotal > 0 ? paginaInicial + 1 : paginaInicial - 1;
        }
        alvo = Math.max(0, Math.min(totalPaginas - 1, alvo));
        irParaPagina(alvo);
      }
      eixo = null;
      arrastando = false;
    };

    el.addEventListener("touchstart", aoComecar, { passive: true });
    el.addEventListener("touchmove", aoMover, { passive: false });
    el.addEventListener("touchend", aoSoltar, { passive: true });
    return () => {
      el.removeEventListener("touchstart", aoComecar);
      el.removeEventListener("touchmove", aoMover);
      el.removeEventListener("touchend", aoSoltar);
    };
  }, [pagerRef, totalPaginas, irParaPagina]);
}

export default function App({ modo = "admin" }) {
  useFonts();
  const ehDesktopTop = useEhDesktop();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [erroConexao, setErroConexao] = useState(null);
  const [role, setRole] = useState(modo === "aluno" ? "aluno" : modo === "professor" ? "professor" : "admin");
  const [adminDesbloqueado, setAdminDesbloqueado] = useState(false);
  const [activeProfId, setActiveProfId] = useState(null);
  const [activeAlunoId, setActiveAlunoId] = useState(null);
  const lembrancaChecada = useRef(false);

  useEffect(() => {
    // Bloqueia pinça/zoom de vez — o Safari às vezes ignora o viewport meta
    const bloquear = (e) => e.preventDefault();
    const bloquearMultiToque = (e) => { if (e.touches && e.touches.length > 1) e.preventDefault(); };
    document.addEventListener("gesturestart", bloquear, { passive: false });
    document.addEventListener("gesturechange", bloquear, { passive: false });
    document.addEventListener("touchmove", bloquearMultiToque, { passive: false });
    let ultimoToque = 0;
    const bloquearDuploToque = (e) => {
      const agora = Date.now();
      if (agora - ultimoToque < 350) e.preventDefault();
      ultimoToque = agora;
    };
    document.addEventListener("touchend", bloquearDuploToque, { passive: false });
    return () => {
      document.removeEventListener("gesturestart", bloquear);
      document.removeEventListener("gesturechange", bloquear);
      document.removeEventListener("touchmove", bloquearMultiToque);
      document.removeEventListener("touchend", bloquearDuploToque);
    };
  }, []);

  useEffect(() => {
    try { setAdminDesbloqueado(sessionStorage.getItem("qg-admin-ok") === "1"); } catch (_) {}
  }, []);

  const carregar = async () => {
    setLoading(true);
    setErroConexao(null);
    try {
      const fresh = await loadAll();
      setData(fresh);
    } catch (e) {
      setErroConexao(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { carregar(); }, []);

  useEffect(() => {
    if (!data || lembrancaChecada.current) return;
    lembrancaChecada.current = true;
    try {
      const lembrado = localStorage.getItem(REMEMBER_KEY);
      if (lembrado && data.alunos.some((a) => a.id === lembrado)) setActiveAlunoId(lembrado);
      const lembradoProf = localStorage.getItem(REMEMBER_PROF_KEY);
      if (lembradoProf && data.professores.some((p) => p.id === lembradoProf)) setActiveProfId(lembradoProf);
    } catch (_) {}
  }, [data]);

  const save = async (next) => {
    setData(next);
    try {
      await saveAll(next);
    } catch (e) {
      setErroConexao(e?.message || String(e));
    }
  };

  const desbloquearAdmin = () => {
    try { sessionStorage.setItem("qg-admin-ok", "1"); } catch (_) {}
    setAdminDesbloqueado(true);
  };
  const sairAdmin = () => {
    try { sessionStorage.removeItem("qg-admin-ok"); } catch (_) {}
    setAdminDesbloqueado(false);
  };

  if (loading) return <div style={{ padding: 40, fontFamily: "Inter", color: "#5A5648" }}>Carregando dados do banco…</div>;

  if (erroConexao && !data) {
    return (
      <div style={{ maxWidth: 420, margin: "60px auto", padding: 20, fontFamily: "Inter" }}>
        <Card>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#B3261E", marginBottom: 8 }}>Não foi possível conectar ao banco de dados</div>
          <div style={{ fontSize: 12.5, color: "#5A5648", marginBottom: 12 }}>{erroConexao}</div>
          <Button onClick={carregar}>Tentar de novo</Button>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  const emTelaLoginPreta = (role === "professor" && !activeProfId) || (role === "aluno" && !activeAlunoId);
  const alunoAtivo = role === "aluno" ? data.alunos.find((a) => a.id === activeAlunoId) : null;
  const profAtivo = role === "professor" ? data.professores.find((p) => p.id === activeProfId) : null;
  const alunoNoDashboardProprio = role === "aluno" && alunoAtivo && alunoAtivo.ativo !== false && !(alunoAtivo.primeiroAcesso && (data.academia.termoPadrao || data.academia.termoPdf));
  const professorNoDashboardMobileProprio = role === "professor" && !!profAtivo && !ehDesktopTop;
  const temRodapeProprio = alunoNoDashboardProprio || professorNoDashboardMobileProprio;

  return (
    <div style={{ minHeight: "100vh", background: "#F5F1E8", fontFamily: "Inter", display: "flex", flexDirection: "column" }}>
      <style>{".qg-sem-barra{scrollbar-width:none;-ms-overflow-style:none;}.qg-sem-barra::-webkit-scrollbar{display:none;width:0;height:0;}"}</style>
      {erroConexao && (
        <div style={{ background: "#FFF3F0", color: "#B3261E", fontSize: 12.5, textAlign: "center", padding: "6px 10px" }}>
          Última ação pode não ter sido salva no banco: {erroConexao}
        </div>
      )}
      <TopNav role={role} setRole={(r) => { setRole(r); setActiveProfId(null); setActiveAlunoId(null); }} academia={data.academia} modo={modo} onAtualizar={carregar} />
      <div style={{ flex: ehDesktopTop ? 1 : "initial", display: "flex", flexDirection: "column", background: role === "aluno" && !emTelaLoginPreta && ehDesktopTop ? "#0B0D12" : undefined }}>
        {role === "admin" && (
          <div style={{ maxWidth: 980, margin: "0 auto", padding: "22px 20px 60px", width: "100%", boxSizing: "border-box" }}>
            {adminDesbloqueado ? <AdminView data={data} save={save} onSairAdmin={sairAdmin} /> : <AdminGate senhaCorreta={data.academia.senhaAdmin} onUnlock={desbloquearAdmin} />}
          </div>
        )}
        {role === "professor" && (
          <div style={{ maxWidth: emTelaLoginPreta && ehDesktopTop ? "none" : 980, margin: "0 auto", width: "100%", padding: !emTelaLoginPreta && ehDesktopTop ? "22px 20px 60px" : undefined, boxSizing: "border-box" }}>
            <ProfessorView data={data} save={save} activeProfId={activeProfId} setActiveProfId={setActiveProfId} />
          </div>
        )}
        {role === "aluno" && (
          <div style={{ maxWidth: emTelaLoginPreta && ehDesktopTop ? "none" : 980, margin: "0 auto", width: "100%" }}>
            <AlunoView data={data} save={save} activeAlunoId={activeAlunoId} setActiveAlunoId={setActiveAlunoId} />
          </div>
        )}
      </div>
      {!emTelaLoginPreta && !temRodapeProprio && (
        ehDesktopTop ? (
          <div style={{ textAlign: "center", padding: "14px 20px 24px", fontSize: 11.5, color: "#9B9891", fontFamily: "Inter", background: "#0B0D12", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, flexShrink: 0 }}>
            <span>Desenvolvido por TECBM - Bruno Martins Tecnologia</span>
            <img src={LOGO_TECBM} alt="" style={{ height: 14, width: "auto", verticalAlign: "middle" }} />
          </div>
        ) : (
          <div style={{ textAlign: "center", padding: "14px 20px 24px", fontSize: 11.5, color: "#9B9891", fontFamily: "Inter", background: "#0B0D12", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            <span>Desenvolvido por TECBM - Bruno Martins Tecnologia</span>
            <img src={LOGO_TECBM} alt="" style={{ height: 14, width: "auto", verticalAlign: "middle" }} />
          </div>
        )
      )}
    </div>
  );
}

function AdminGate({ senhaCorreta, onUnlock }) {
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const entrar = () => {
    if (senha.trim() === (senhaCorreta || "").trim()) { setErro(""); onUnlock(); }
    else setErro("Senha incorreta.");
  };
  return (
    <div style={{ maxWidth: 360, margin: "40px auto" }}>
      <SectionTitle sub="Acesso restrito ao administrador">Painel administrador</SectionTitle>
      <Card>
        <Field label="Senha de administrador">
          <input type="password" style={inputStyle} value={senha} onChange={(e) => setSenha(e.target.value)} onKeyDown={(e) => e.key === "Enter" && entrar()} />
        </Field>
        {erro && <div style={{ fontSize: 12.5, color: "#B3261E", marginTop: 6 }}>{erro}</div>}
        <div style={{ marginTop: 12 }}><Button icon={Check} onClick={entrar}>Entrar</Button></div>
      </Card>
      <p style={{ fontSize: 11.5, color: "#8A8574", marginTop: 10 }}>Essa senha é uma proteção básica no navegador (não substitui um login seguro de verdade). Troque em Configurações.</p>
    </div>
  );
}

function TopNav({ role, setRole, academia, modo, onAtualizar }) {
  const tabs = [
    { id: "admin", label: "Administrador", icon: Shield },
    { id: "professor", label: "Professores", icon: Award },
    { id: "aluno", label: "Alunos", icon: User },
  ];
  const mostrarTabs = modo === "admin";
  const [girando, setGirando] = useState(false);
  const atualizar = async () => {
    if (girando) return;
    setGirando(true);
    try { await onAtualizar(); } finally { setTimeout(() => setGirando(false), 400); }
  };
  return (
    <div style={{ background: "#000000", padding: "0 20px", paddingTop: "env(safe-area-inset-top)" }}>
      <div style={{ maxWidth: 980, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 0" }}>
          {academia.logo ? (
            <img src={academia.logo} alt="logo" style={{ width: 34, height: 34, borderRadius: 8, objectFit: "cover" }} />
          ) : (
            <div style={{ width: 34, height: 34, borderRadius: 8, background: "#C9A227", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Oswald", fontWeight: 700, color: "#12213B" }}>{academia.nome[0]}</div>
          )}
          <span style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 20, letterSpacing: 0.5, color: "#FFFFFF", textTransform: "uppercase" }}>{academia.nome}</span>
          <button onClick={atualizar} title="Atualizar dados" style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", padding: 4 }}>
            <RefreshCw size={16} color="#C9C4B4" style={{ animation: girando ? "qg-spin 0.6s linear infinite" : "none" }} />
          </button>
          <style>{"@keyframes qg-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }"}</style>
        </div>
        {mostrarTabs && (
          <div style={{ display: "flex", gap: 4 }}>
            {tabs.map((t) => {
              const Icon = t.icon;
              const active = role === t.id;
              return (
                <button key={t.id} onClick={() => setRole(t.id)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 13px", borderRadius: 7, border: "none", cursor: "pointer", fontFamily: "Inter", fontWeight: 600, fontSize: 13, background: active ? "#C9A227" : "transparent", color: active ? "#17181B" : "#C9C4B4" }}>
                  <Icon size={15} /> {t.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function SectionTitle({ children, sub }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h2 style={{ fontFamily: "Oswald", fontSize: 22, fontWeight: 700, color: "#12213B", textTransform: "uppercase", letterSpacing: 0.3, margin: 0 }}>{children}</h2>
      {sub && <p style={{ margin: "3px 0 0", color: "#5A5648", fontSize: 13.5 }}>{sub}</p>}
    </div>
  );
}

/* ---------------- ADMIN ---------------- */
function CartaoRelatorio({ corIcone, icone, tag, titulo, descricao, children, botao, onClick, dark }) {
  return (
    <Card dark={dark} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ width: 38, height: 38, borderRadius: 10, background: corIcone, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, marginBottom: 2 }}>{icone}</div>
      <span style={{ display: "inline-block", alignSelf: "flex-start", fontSize: 9, fontWeight: 700, textTransform: "uppercase", padding: "3px 8px", borderRadius: 20, background: dark ? "rgba(255,255,255,0.08)" : "#F0EDE4", color: dark ? "#C9C4B4" : "#8A8574" }}>{tag}</span>
      <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 14, color: dark ? "#F5F3EC" : "#12213B" }}>{titulo}</div>
      <div style={{ fontSize: 11.5, color: dark ? "#9B9891" : "#5A5648", lineHeight: 1.4, flex: 1 }}>{descricao}</div>
      {children}
      <Button variant={botao?.variant || "primary"} onClick={onClick} style={{ marginTop: 6, justifyContent: "center" }}>{botao?.texto || "Gerar PDF"}</Button>
    </Card>
  );
}

function RelatoriosProfessor({ data, prof, meusAlunos }) {
  const [busca, setBusca] = useState("");
  const [categoria, setCategoria] = useState("todos");
  const [secaoExpandida, setSecaoExpandida] = useState(null);
  const [ordemFrequencia, setOrdemFrequencia] = useState("mais");
  const [dataCheckins, setDataCheckins] = useState(hoje());
  const [mesFinanceiro, setMesFinanceiro] = useState(() => new Date().toISOString().slice(0, 7));
  const [mesAniversario, setMesAniversario] = useState(new Date().getMonth());
  const [erro, setErro] = useState("");
  const secaoRef = useRef(null);
  useEffect(() => {
    if (secaoExpandida) setTimeout(() => secaoRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }, [secaoExpandida]);

  const categorias = [
    { id: "todos", label: "Todos" },
    { id: "alunos", label: "Alunos" },
    { id: "checkins", label: "Check-ins" },
    { id: "financeiro", label: "Financeiro" },
    { id: "graduacao", label: "Graduação" },
  ];

  const visivel = (cat, titulo) => {
    if (categoria !== "todos" && categoria !== cat) return false;
    if (busca.trim() && !titulo.toLowerCase().includes(busca.trim().toLowerCase())) return false;
    return true;
  };

  const aniversariantesDoMes = meusAlunos.filter((a) => a.dataNascimento && Number(a.dataNascimento.split("-")[1]) - 1 === mesAniversario).sort((x, y) => Number(x.dataNascimento.split("-")[2]) - Number(y.dataNascimento.split("-")[2]));

  return (
    <div>
      <div style={{ fontSize: 12.5, color: "#9B9891", marginBottom: 12 }}>Todos os relatórios abaixo consideram só os seus {meusAlunos.length} aluno(s) vinculado(s).</div>
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <input style={{ ...inputStyle, flex: 1, minWidth: 200 }} placeholder="🔍 Buscar relatório..." value={busca} onChange={(e) => setBusca(e.target.value)} />
        {categorias.map((c) => (
          <button key={c.id} onClick={() => setCategoria(c.id)} style={{
            padding: "7px 14px", borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: "pointer",
            border: "1px solid rgba(255,255,255,0.14)", background: categoria === c.id ? "#C9A227" : "rgba(255,255,255,0.05)",
            color: categoria === c.id ? "#17181B" : "#C9C4B4",
          }}>{c.label}</button>
        ))}
      </div>
      {erro && <div style={{ marginBottom: 12, fontSize: 12.5, color: "#FF8A80", fontWeight: 600 }}>{erro}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px,1fr))", gap: 14 }}>

        {visivel("alunos", "Lista de alunos") && (
          <CartaoRelatorio dark corIcone="#EAF2FF" icone="📋" tag="Alunos" titulo="Lista de alunos"
            descricao="Cadastro completo dos seus alunos: faixa, contato, plano e status de pagamento." botao={{ variant: "gold" }}
            onClick={() => { setErro(""); gerarRelatorioListaAlunos(data, setErro, meusAlunos, prof.nome); }} />
        )}

        {visivel("alunos", "Frequência de alunos") && (
          <CartaoRelatorio dark corIcone="#FFF3E0" icone="🏆" tag="Alunos" titulo="Frequência de alunos"
            descricao="Ranking de quem mais e menos treina entre os seus alunos." botao={{ variant: "gold" }}
            onClick={() => { setErro(""); gerarRelatorioFrequencia(data, setErro, ordemFrequencia, meusAlunos, prof.nome); }}>
            <select style={inputStyle} value={ordemFrequencia} onChange={(e) => setOrdemFrequencia(e.target.value)}>
              <option value="mais">Ordenar: mais frequentes</option>
              <option value="menos">Ordenar: menos frequentes</option>
            </select>
          </CartaoRelatorio>
        )}

        {visivel("alunos", "Alunos desativados") && (
          <CartaoRelatorio dark corIcone="#FFEAEA" icone="🚫" tag="Alunos" titulo="Alunos desativados"
            descricao="Seus alunos com acesso ao app bloqueado no momento." botao={{ variant: "gold" }}
            onClick={() => { setErro(""); gerarRelatorioDesativados(data, setErro, meusAlunos, prof.nome); }} />
        )}

        {visivel("checkins", "Check-ins por data") && (
          <CartaoRelatorio dark corIcone="#EAF7EE" icone="📍" tag="Check-ins" titulo="Check-ins por data"
            descricao="Quais dos seus alunos fizeram check-in em um dia específico." botao={{ variant: "gold" }}
            onClick={() => { setErro(""); gerarRelatorioCheckins(data, dataCheckins, setErro, meusAlunos, prof.nome); }}>
            <input type="date" style={{ ...inputStyle, maxWidth: "100%" }} value={dataCheckins} onChange={(e) => setDataCheckins(e.target.value)} />
          </CartaoRelatorio>
        )}

        {visivel("financeiro", "Relatório mensal") && (
          <CartaoRelatorio dark corIcone="#F1EAFF" icone="💰" tag="Financeiro" titulo="Relatório mensal"
            descricao="Pagamentos confirmados e pendências dos seus alunos no mês." botao={{ variant: "gold" }}
            onClick={() => { setErro(""); gerarRelatorioMensal(data, mesFinanceiro, setErro, meusAlunos, prof.nome); }}>
            <input type="month" style={{ ...inputStyle, maxWidth: "100%" }} value={mesFinanceiro} onChange={(e) => setMesFinanceiro(e.target.value)} />
          </CartaoRelatorio>
        )}

        {visivel("financeiro", "Pagamentos: confirmados x pendentes") && (
          <CartaoRelatorio dark corIcone="#F1EAFF" icone="📈" tag="Financeiro" titulo="Pagamentos: confirmados x pendentes"
            descricao="Gráfico comparando os dois grupos, só dos seus alunos." botao={{ variant: "gold", texto: "Ver gráfico" }}
            onClick={() => setSecaoExpandida(secaoExpandida === "pagamentos" ? null : "pagamentos")} />
        )}

        {visivel("graduacao", "Alunos por faixa") && (
          <CartaoRelatorio dark corIcone="#FFF9E0" icone="🎖️" tag="Graduação" titulo="Alunos por faixa"
            descricao="Distribuição dos seus alunos por faixa atual." botao={{ variant: "gold", texto: "Ver gráfico" }}
            onClick={() => setSecaoExpandida(secaoExpandida === "faixas" ? null : "faixas")} />
        )}

        {visivel("graduacao", "Perto de graduar") && (
          <CartaoRelatorio dark corIcone="#FFF9E0" icone="⭐" tag="Graduação" titulo="Perto de graduar"
            descricao="Seus alunos a poucas aulas do próximo grau ou faixa." botao={{ variant: "gold", texto: "Ver lista" }}
            onClick={() => setSecaoExpandida(secaoExpandida === "perto" ? null : "perto")} />
        )}

        {visivel("alunos", "Aniversariantes") && (
          <CartaoRelatorio dark corIcone="#FFEAF3" icone="🎂" tag="Alunos" titulo="Aniversariantes"
            descricao="Filtra por mês quem está de aniversário entre os seus alunos." botao={{ variant: "gold", texto: "Ver lista" }}
            onClick={() => setSecaoExpandida(secaoExpandida === "aniversario" ? null : "aniversario")}>
            <select style={inputStyle} value={mesAniversario} onChange={(e) => setMesAniversario(Number(e.target.value))}>
              {MESES.map((m, i) => <option key={i} value={i}>{m}</option>)}
            </select>
          </CartaoRelatorio>
        )}

      </div>

      <div ref={secaoRef}>
        {secaoExpandida === "pagamentos" && <div style={{ marginTop: 18 }}><PagamentosChart data={data} alunosFiltro={meusAlunos} dark /></div>}
        {secaoExpandida === "faixas" && <div style={{ marginTop: 18 }}><AlunosPorFaixaChart alunos={meusAlunos} faixas={data.faixas} titulo="Meus alunos por faixa" dark /></div>}
        {secaoExpandida === "perto" && <div style={{ marginTop: 18 }}><AlunosPertoDeGraduar data={data} prof={prof} dark={true} /></div>}

        {secaoExpandida === "aniversario" && (
        <Card dark style={{ marginTop: 18 }}>
          <div style={{ ...blockTitleStyle, color: "#F5F3EC" }}>Aniversariantes de {MESES[mesAniversario]}</div>
          {aniversariantesDoMes.length === 0 ? (
            <Empty dark>Nenhum aniversariante em {MESES[mesAniversario]}.</Empty>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {aniversariantesDoMes.map((a) => (
                <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13.5 }}>
                  <Gift size={15} color="#C9A227" />
                  <span style={{ fontWeight: 600, color: "#F5F3EC" }}>{a.nome}</span>
                  <span style={{ color: "#9B9891" }}>dia {a.dataNascimento.split("-")[2]}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
        )}
      </div>
    </div>
  );
}

function RelatoriosAdmin({ data }) {
  const [busca, setBusca] = useState("");
  const [categoria, setCategoria] = useState("todos");
  const [secaoExpandida, setSecaoExpandida] = useState(null);
  const [ordemFrequencia, setOrdemFrequencia] = useState("mais");
  const [dataCheckins, setDataCheckins] = useState(hoje());
  const [mesFinanceiro, setMesFinanceiro] = useState(() => new Date().toISOString().slice(0, 7));
  const [mesAniversario, setMesAniversario] = useState(new Date().getMonth());
  const [erro, setErro] = useState("");
  const [tipoPeriodoResumo, setTipoPeriodoResumo] = useState("dia");
  const [diaResumo, setDiaResumo] = useState(hoje());
  const [mesResumo, setMesResumo] = useState(() => new Date().toISOString().slice(0, 7));
  const [anoResumo, setAnoResumo] = useState(() => String(new Date().getFullYear()));
  const secaoRef = useRef(null);
  useEffect(() => {
    if (secaoExpandida) setTimeout(() => secaoRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }, [secaoExpandida]);

  const categorias = [
    { id: "todos", label: "Todos" },
    { id: "alunos", label: "Alunos" },
    { id: "checkins", label: "Check-ins" },
    { id: "financeiro", label: "Financeiro" },
    { id: "graduacao", label: "Graduação" },
  ];

  const visivel = (cat, titulo) => {
    if (categoria !== "todos" && categoria !== cat) return false;
    if (busca.trim() && !titulo.toLowerCase().includes(busca.trim().toLowerCase())) return false;
    return true;
  };

  const alunosPertoDeGraduar = data.alunos
    .map((a) => ({ aluno: a, info: progressoGraduacaoInfo(data.faixas, a.faixaId, a.grau, a.checkinsDesdeGraduacao, categoriaEtaria(a.dataNascimento)) }))
    .filter((c) => c.info.restantes !== null && c.info.restantes <= 5)
    .sort((a, b) => a.info.restantes - b.info.restantes);

  const checkinsNoPeriodo = data.checkins.filter((c) => {
    const dataDoCheckin = dataLocalDe(c.dataHora);
    if (tipoPeriodoResumo === "dia") return dataDoCheckin === diaResumo;
    if (tipoPeriodoResumo === "mes") return dataDoCheckin.slice(0, 7) === mesResumo;
    if (tipoPeriodoResumo === "ano") return dataDoCheckin.slice(0, 4) === anoResumo;
    return false;
  });
  const porUnidade = {};
  const porProfessor = {};
  checkinsNoPeriodo.forEach((c) => {
    const aluno = data.alunos.find((a) => a.id === c.alunoId);
    if (!aluno) return;
    const unidade = (data.unidades || []).find((u) => u.id === aluno.unidadeId);
    const nomeUnidade = unidade ? unidade.nome : "QG (padrão)";
    porUnidade[nomeUnidade] = (porUnidade[nomeUnidade] || 0) + 1;
    const professor = data.professores.find((p) => p.id === aluno.professorId);
    const nomeProfessor = professor ? professor.nome : "Sem professor vinculado";
    porProfessor[nomeProfessor] = (porProfessor[nomeProfessor] || 0) + 1;
  });
  const listaPorUnidade = Object.entries(porUnidade).sort((a, b) => b[1] - a[1]);
  const listaPorProfessor = Object.entries(porProfessor).sort((a, b) => b[1] - a[1]);
  const rotuloPeriodoResumo = tipoPeriodoResumo === "dia" ? new Date(diaResumo + "T00:00:00").toLocaleDateString("pt-BR") : tipoPeriodoResumo === "mes" ? mesResumo : anoResumo;

  return (
    <div>
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <input style={{ ...inputStyle, flex: 1, minWidth: 200 }} placeholder="🔍 Buscar relatório..." value={busca} onChange={(e) => setBusca(e.target.value)} />
        {categorias.map((c) => (
          <button key={c.id} onClick={() => setCategoria(c.id)} style={{
            padding: "7px 14px", borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: "pointer",
            border: "1px solid #D8D3C4", background: categoria === c.id ? "#C9A227" : "#fff",
            color: categoria === c.id ? "#17181B" : "#5A5648",
          }}>{c.label}</button>
        ))}
      </div>
      {erro && <div style={{ marginBottom: 12, fontSize: 12.5, color: "#B3261E", fontWeight: 600 }}>{erro}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px,1fr))", gap: 14 }}>

        {visivel("alunos", "Lista de alunos") && (
          <CartaoRelatorio corIcone="#EAF2FF" icone="📋" tag="Alunos" titulo="Lista de alunos"
            descricao="Cadastro completo: faixa, contato, professor, plano e status de pagamento."
            onClick={() => { setErro(""); gerarRelatorioListaAlunos(data, setErro); }} />
        )}

        {visivel("alunos", "Total de alunos por unidade") && (
          <CartaoRelatorio corIcone="#EAF2FF" icone="🏢" tag="Alunos" titulo="Total de alunos por unidade"
            descricao="Total geral de todas as unidades, mais o total individual de cada uma."
            onClick={() => { setErro(""); gerarRelatorioAlunosPorUnidade(data, setErro); }} />
        )}

        {visivel("alunos", "Frequência de alunos") && (
          <CartaoRelatorio corIcone="#FFF3E0" icone="🏆" tag="Alunos" titulo="Frequência de alunos"
            descricao="Ranking de quem mais e menos treina — ajuda a identificar quem pode estar se afastando."
            onClick={() => { setErro(""); gerarRelatorioFrequencia(data, setErro, ordemFrequencia); }}>
            <select style={inputStyle} value={ordemFrequencia} onChange={(e) => setOrdemFrequencia(e.target.value)}>
              <option value="mais">Ordenar: mais frequentes</option>
              <option value="menos">Ordenar: menos frequentes</option>
            </select>
          </CartaoRelatorio>
        )}

        {visivel("alunos", "Alunos desativados") && (
          <CartaoRelatorio corIcone="#FFEAEA" icone="🚫" tag="Alunos" titulo="Alunos desativados"
            descricao="Lista de todos com acesso ao app bloqueado no momento."
            onClick={() => { setErro(""); gerarRelatorioDesativados(data, setErro); }} />
        )}

        {visivel("checkins", "Check-ins por data") && (
          <CartaoRelatorio corIcone="#EAF7EE" icone="📍" tag="Check-ins" titulo="Check-ins por data"
            descricao="Quem fez check-in em um dia específico, de todas as turmas."
            onClick={() => { setErro(""); gerarRelatorioCheckins(data, dataCheckins, setErro); }}>
            <input type="date" style={{ ...inputStyle, maxWidth: "100%" }} value={dataCheckins} onChange={(e) => setDataCheckins(e.target.value)} />
          </CartaoRelatorio>
        )}

        {visivel("checkins", "Check-ins por unidade e professor") && (
          <CartaoRelatorio corIcone="#EAF7EE" icone="📊" tag="Check-ins" titulo="Check-ins por unidade e professor"
            descricao="Total de check-ins agrupado por unidade e por professor, no período que escolher." botao={{ variant: "gold", texto: "Ver relatório" }}
            onClick={() => setSecaoExpandida(secaoExpandida === "resumoCheckins" ? null : "resumoCheckins")}>
            <select style={inputStyle} value={tipoPeriodoResumo} onChange={(e) => setTipoPeriodoResumo(e.target.value)}>
              <option value="dia">Por dia</option>
              <option value="mes">Por mês</option>
              <option value="ano">Por ano</option>
            </select>
            {tipoPeriodoResumo === "dia" && <input type="date" style={inputStyle} value={diaResumo} onChange={(e) => setDiaResumo(e.target.value)} />}
            {tipoPeriodoResumo === "mes" && <input type="month" style={inputStyle} value={mesResumo} onChange={(e) => setMesResumo(e.target.value)} />}
            {tipoPeriodoResumo === "ano" && <input type="number" style={inputStyle} value={anoResumo} onChange={(e) => setAnoResumo(e.target.value)} placeholder="2026" />}
          </CartaoRelatorio>
        )}

        {visivel("financeiro", "Relatório mensal") && (
          <CartaoRelatorio corIcone="#F1EAFF" icone="💰" tag="Financeiro" titulo="Relatório mensal"
            descricao="Pagamentos confirmados e pendências do mês selecionado." botao={{ variant: "gold" }}
            onClick={() => { setErro(""); gerarRelatorioMensal(data, mesFinanceiro, setErro); }}>
            <input type="month" style={{ ...inputStyle, maxWidth: "100%" }} value={mesFinanceiro} onChange={(e) => setMesFinanceiro(e.target.value)} />
          </CartaoRelatorio>
        )}

        {visivel("financeiro", "Pagamentos: confirmados x pendentes") && (
          <CartaoRelatorio corIcone="#F1EAFF" icone="📈" tag="Financeiro" titulo="Pagamentos: confirmados x pendentes"
            descricao="Gráfico visual comparando os dois grupos no mês." botao={{ variant: "gold", texto: "Ver gráfico" }}
            onClick={() => setSecaoExpandida(secaoExpandida === "pagamentos" ? null : "pagamentos")} />
        )}

        {visivel("graduacao", "Alunos por faixa") && (
          <CartaoRelatorio corIcone="#FFF9E0" icone="🎖️" tag="Graduação" titulo="Alunos por faixa"
            descricao="Distribuição visual de todos os alunos por faixa atual." botao={{ variant: "gold", texto: "Ver gráfico" }}
            onClick={() => setSecaoExpandida(secaoExpandida === "faixas" ? null : "faixas")} />
        )}

        {visivel("graduacao", "Perto de graduar") && (
          <CartaoRelatorio corIcone="#FFF9E0" icone="⭐" tag="Graduação" titulo="Perto de graduar"
            descricao="Todos os alunos a poucas aulas do próximo grau ou faixa." botao={{ variant: "gold", texto: "Ver lista" }}
            onClick={() => setSecaoExpandida(secaoExpandida === "perto" ? null : "perto")} />
        )}

        {visivel("alunos", "Aniversariantes") && (
          <CartaoRelatorio corIcone="#FFEAF3" icone="🎂" tag="Alunos" titulo="Aniversariantes"
            descricao="Filtra por mês quem está de aniversário na academia." botao={{ variant: "gold", texto: "Ver lista" }}
            onClick={() => setSecaoExpandida(secaoExpandida === "aniversario" ? null : "aniversario")}>
            <select style={inputStyle} value={mesAniversario} onChange={(e) => setMesAniversario(Number(e.target.value))}>
              {MESES.map((m, i) => <option key={i} value={i}>{m}</option>)}
            </select>
          </CartaoRelatorio>
        )}

      </div>

      <div ref={secaoRef}>
      {secaoExpandida === "pagamentos" && <div style={{ marginTop: 18 }}><PagamentosChart data={data} /></div>}
      {secaoExpandida === "faixas" && <div style={{ marginTop: 18 }}><AlunosPorFaixaChart alunos={data.alunos} faixas={data.faixas} /></div>}

      {secaoExpandida === "resumoCheckins" && (
        <Card style={{ marginTop: 18 }}>
          <div style={blockTitleStyle}>Check-ins por unidade e professor — {rotuloPeriodoResumo}</div>
          <div style={{ fontSize: 12.5, color: "#5A5648", marginBottom: 14 }}>Total no período: <b>{checkinsNoPeriodo.length}</b> check-in(s)</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px,1fr))", gap: 16 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8, textTransform: "uppercase", color: "#12213B" }}>Por unidade</div>
              {listaPorUnidade.length === 0 ? <Empty>Nenhum check-in no período.</Empty> : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {listaPorUnidade.map(([nome, total]) => (
                    <div key={nome} style={{ display: "flex", justifyContent: "space-between", background: "#FBFAF7", borderRadius: 8, padding: "8px 12px", border: "1px solid #E7E2D6", fontSize: 13, color: "#1B2027" }}>
                      <span>{nome}</span><span style={{ fontWeight: 700 }}>{total}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8, textTransform: "uppercase", color: "#12213B" }}>Por professor</div>
              {listaPorProfessor.length === 0 ? <Empty>Nenhum check-in no período.</Empty> : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {listaPorProfessor.map(([nome, total]) => (
                    <div key={nome} style={{ display: "flex", justifyContent: "space-between", background: "#FBFAF7", borderRadius: 8, padding: "8px 12px", border: "1px solid #E7E2D6", fontSize: 13, color: "#1B2027" }}>
                      <span>{nome}</span><span style={{ fontWeight: 700 }}>{total}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {secaoExpandida === "perto" && (
        <Card style={{ marginTop: 18 }}>
          <div style={blockTitleStyle}>Alunos perto de graduar</div>
          {alunosPertoDeGraduar.length === 0 ? (
            <Empty>Ninguém está perto de graduar no momento.</Empty>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {alunosPertoDeGraduar.map(({ aluno: a, info }) => (
                <div key={a.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#FBFAF7", borderRadius: 8, padding: "8px 12px", border: "1px solid #E7E2D6", gap: 8, flexWrap: "wrap", color: "#1B2027" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Avatar foto={a.foto} nome={a.nome} size={30} />
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{a.nome}</span>
                  </div>
                  <Tag ok={info.restantes === 0}>{info.texto}</Tag>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {secaoExpandida === "aniversario" && (
        <Card style={{ marginTop: 18 }}>
          <div style={blockTitleStyle}>Aniversariantes de {MESES[mesAniversario]}</div>
          {(() => {
            const lista = data.alunos.filter((a) => a.dataNascimento && Number(a.dataNascimento.split("-")[1]) - 1 === mesAniversario).sort((x, y) => Number(x.dataNascimento.split("-")[2]) - Number(y.dataNascimento.split("-")[2]));
            if (lista.length === 0) return <Empty>Nenhum aniversariante em {MESES[mesAniversario]}.</Empty>;
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {lista.map((a) => (
                  <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13.5 }}>
                    <Gift size={15} color="#C9A227" />
                    <span style={{ fontWeight: 600, color: "#1B2027" }}>{a.nome}</span>
                    <span style={{ color: "#8A8574" }}>dia {a.dataNascimento.split("-")[2]}</span>
                  </div>
                ))}
              </div>
            );
          })()}
        </Card>
      )}
      </div>
    </div>
  );
}

function AdminView({ data, save, onSairAdmin }) {
  const [tab, setTab] = useState("dashboard");
  const [novoAluno, setNovoAluno] = useState(false);
  const [editandoAluno, setEditandoAluno] = useState(null);
  const [novoProf, setNovoProf] = useState(false);
  const [editandoProf, setEditandoProf] = useState(null);
  const [novaTurma, setNovaTurma] = useState(false);
  const [editandoTurma, setEditandoTurma] = useState(null);
  const [senhaGerada, setSenhaGerada] = useState(null);
  const [senhaGeradaProf, setSenhaGeradaProf] = useState(null);
  const [buscaAluno, setBuscaAluno] = useState("");
  const [filtroFaixaAluno, setFiltroFaixaAluno] = useState("");

  const checkinsHoje = data.checkins.filter((c) => dataLocalDe(c.dataHora) === hoje()).length;
  const pendentes = data.alunos.filter((a) => !statusPagamento(a, data.planos).emDia).length;
  const termosPendentes = data.alunos.filter((a) => !a.termoAceito && !a.termoAssinadoManual).length;

  const addAluno = async (form) => {
    const a = { id: uid(), tipo: "aluno", matricula: hoje(), ultimoPagamento: null, foto: null, pagamentos: [], checkinsDesdeGraduacao: 0, primeiroAcesso: true, termoAceito: false, termoAceitoEm: null, ativo: true, ...form };
    await save({ ...data, alunos: [...data.alunos, a] });
    setNovoAluno(false);
  };
  const editarAluno = async (id, form) => { const alunos = data.alunos.map((a) => (a.id === id ? { ...a, ...form } : a)); await save({ ...data, alunos }); setEditandoAluno(null); };
  const removerAluno = async (id) => { await save({ ...data, alunos: data.alunos.filter((a) => a.id !== id) }); };
  const resetarSenha = async (id) => {
    const nova = randomSenha();
    const alunos = data.alunos.map((a) => (a.id === id ? { ...a, senha: nova } : a));
    await save({ ...data, alunos });
    setSenhaGerada({ id, senha: nova });
  };
  const alternarAtivoAluno = async (id) => {
    const alunos = data.alunos.map((a) => (a.id === id ? { ...a, ativo: a.ativo === false ? true : false } : a));
    await save({ ...data, alunos });
  };

  const addProf = async (form) => { const p = { id: uid(), tipo: "professor", ...form }; await save({ ...data, professores: [...data.professores, p] }); setNovoProf(false); };
  const editarProf = async (id, form) => { const professores = data.professores.map((p) => (p.id === id ? { ...p, ...form } : p)); await save({ ...data, professores }); setEditandoProf(null); };
  const removerProf = async (id) => { await save({ ...data, professores: data.professores.filter((p) => p.id !== id) }); };
  const resetarSenhaProf = async (id) => {
    const nova = randomSenha();
    const professores = data.professores.map((p) => (p.id === id ? { ...p, senha: nova } : p));
    await save({ ...data, professores });
    setSenhaGeradaProf({ id, senha: nova });
  };

  const addTurma = async (form) => { const t = { id: uid(), ...form }; await save({ ...data, turmas: [...data.turmas, t] }); setNovaTurma(false); };
  const editarTurma = async (id, form) => { const turmas = data.turmas.map((t) => (t.id === id ? { ...t, ...form } : t)); await save({ ...data, turmas }); setEditandoTurma(null); };
  const removerTurma = async (id) => { await save({ ...data, turmas: data.turmas.filter((t) => t.id !== id) }); };

  const tabs = [
    { id: "dashboard", label: "Visão geral" },
    { id: "alunos", label: "Alunos" },
    { id: "professores", label: "Professores" },
    { id: "turmas", label: "Turmas" },
    { id: "graduacao", label: "Graduação" },
    { id: "planos", label: "Planos" },
    { id: "financeiro", label: "Financeiro" },
    { id: "relatorios", label: "Relatórios" },
    { id: "avisos", label: "Avisos" },
    { id: "unidades", label: "Unidades" },
    { id: "videos", label: "Vídeos" },
    { id: "config", label: "Configurações" },
  ];

  const iconesTabs = {
    dashboard: "📊", alunos: "🧑‍🤝‍🧑", professores: "🥋", turmas: "📅", graduacao: "🎖️",
    planos: "💳", financeiro: "💰", relatorios: "📑", avisos: "🔔", unidades: "📍", videos: "🎬", config: "⚙️",
  };

  const [refFullBleed, estiloFullBleed] = useFullBleed();

  return (
    <div ref={refFullBleed} style={{
      backgroundImage: "radial-gradient(circle at 15% 15%, rgba(201,162,39,0.05), transparent 40%), linear-gradient(160deg, #14171F 0%, #0B0C10 100%)",
      minHeight: "calc(100vh - 66px)",
      ...estiloFullBleed,
      position: "relative",
      marginTop: -22,
      marginBottom: -60,
      display: "flex",
      overflow: "hidden",
    }}>
      <img src={LOGO_CACHORRO} alt="" style={{ position: "absolute", width: 420, right: -110, bottom: -70, opacity: 0.05, pointerEvents: "none", zIndex: 0 }} />
      <div style={{ width: 220, flexShrink: 0, background: "#000", borderRight: "1px solid rgba(255,255,255,0.06)", boxSizing: "border-box", zIndex: 1 }}>
        <div style={{ position: "sticky", top: 0, padding: "20px 12px" }}>
          <div style={{ padding: "0 6px 16px", marginBottom: 10, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ fontFamily: "Oswald", fontWeight: 700, color: "#fff", fontSize: 13, textTransform: "uppercase", letterSpacing: 0.4 }}>{data.academia.nome}</div>
            <div style={{ fontSize: 10.5, color: "#9B9891", marginTop: 2 }}>Painel administrador</div>
          </div>
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
              padding: "10px 12px", borderRadius: 8, border: "none", cursor: "pointer", marginBottom: 2,
              background: tab === t.id ? "rgba(201,162,39,0.12)" : "transparent",
              color: tab === t.id ? "#C9A227" : "#9B9891", fontSize: 13, fontWeight: 600,
            }}>
              <span style={{ fontSize: 15, width: 18, textAlign: "center" }}>{iconesTabs[t.id]}</span>
              {t.label}
            </button>
          ))}
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
            <Button variant="ghost" icon={LogOut} style={{ color: "#F5F3EC", border: "1px solid rgba(255,255,255,0.2)", width: "100%", justifyContent: "center" }} onClick={onSairAdmin}>Sair</Button>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, padding: "24px 28px 40px", minWidth: 0, color: "#F5F3EC" }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 21, color: "#C9A227", textTransform: "uppercase" }}>{tabs.find((t) => t.id === tab)?.label}</div>
          <div style={{ fontSize: 12, color: "#9B9891", marginTop: 2 }}>Cadastro central de alunos, professores, graduação e financeiro do QG</div>
        </div>

      {tab === "dashboard" && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 12, marginBottom: 14 }}>
            <StatCard label="Alunos ativos" value={data.alunos.length} icon={Users} dark />
            <StatCard label="Professores" value={data.professores.length} icon={Award} dark />
            <StatCard label="Turmas" value={data.turmas.length} icon={CalendarCheck} dark />
            <StatCard label="Check-ins hoje" value={checkinsHoje} icon={QrCode} dark />
            <StatCard label="Pagamentos pendentes" value={pendentes} icon={CreditCard} dark />
            <StatCard label="Termos pendentes" value={termosPendentes} icon={Shield} dark />
          </div>

          <AlunosPorFaixaChart alunos={data.alunos} faixas={data.faixas} dark />

          <PagamentosChart data={data} dark />
          <AlunosPorMesChart data={data} dark />

          <AniversariantesCard alunos={data.alunos} dark />
        </div>
      )}

      {tab === "alunos" && (
        <div>
          <PresencaManualAdmin data={data} save={save} />
          <RelatorioListaAlunos data={data} />
          <RelatorioCheckins data={data} />
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
            <Button icon={Plus} onClick={() => setNovoAluno(true)}>Novo aluno</Button>
          </div>
          {novoAluno && <PersonForm tipo="aluno" planos={data.planos} faixas={data.faixas} professores={data.professores} unidades={data.unidades} turmas={data.turmas} onCancel={() => setNovoAluno(false)} onSave={addAluno} />}
          {editandoAluno && <PersonForm tipo="aluno" planos={data.planos} faixas={data.faixas} professores={data.professores} unidades={data.unidades} turmas={data.turmas} initial={editandoAluno} onCancel={() => setEditandoAluno(null)} onSave={(form) => editarAluno(editandoAluno.id, form)} />}
          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <input style={{ ...inputStyle, flex: 1, minWidth: 160 }} placeholder="Buscar por nome ou apelido..." value={buscaAluno} onChange={(e) => setBuscaAluno(e.target.value)} />
            <select style={{ ...inputStyle, width: 180 }} value={filtroFaixaAluno} onChange={(e) => setFiltroFaixaAluno(e.target.value)}>
              <option value="">Todas as faixas</option>
              {data.faixas.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {data.alunos
              .filter((a) => !filtroFaixaAluno || a.faixaId === filtroFaixaAluno)
              .filter((a) => {
                const termo = buscaAluno.trim().toLowerCase();
                if (!termo) return true;
                return a.nome.toLowerCase().includes(termo) || (a.apelido || "").toLowerCase().includes(termo);
              })
              .map((a) => {
              const { emDia, plano } = statusPagamento(a, data.planos);
              const professorVinculado = data.professores.find((p) => p.id === a.professorId);
              const unidadeVinculada = (data.unidades || []).find((u) => u.id === a.unidadeId);
              const categoria = categoriaEtaria(a.dataNascimento);
              return (
                <Card dark key={a.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 12, flexWrap: "wrap", gap: 8, opacity: a.ativo === false ? 0.6 : 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Avatar foto={a.foto} nome={a.nome} />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14, color: "#F5F3EC" }}>{a.nome}{a.apelido && <span style={{ fontWeight: 400, color: "#9B9891" }}> "{a.apelido}"</span>}</div>
                      <BeltBar faixas={data.faixas} faixaId={a.faixaId} grau={a.grau} textColor="#F5F3EC" />
                      <div style={{ fontSize: 11, color: "#9B9891" }}>
                        {professorVinculado && `Professor: ${professorVinculado.nome}`}
                        {professorVinculado && unidadeVinculada ? " · " : ""}
                        {unidadeVinculada && `Unidade: ${unidadeVinculada.nome}`}
                        {(professorVinculado || unidadeVinculada) && (categoria || a.peso) ? " · " : ""}
                        {categoria && `${categoria}`}
                        {categoria && a.peso ? " · " : ""}
                        {a.peso && `${a.peso}kg`}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11.5, color: "#9B9891" }}>{plano?.nome || "sem plano"}</span>
                    <Tag ok={emDia}>{emDia ? "Pagamento em dia" : "Pagamento pendente"}</Tag>
                    <Tag ok={a.termoAceito || a.termoAssinadoManual}>{a.termoAceito || a.termoAssinadoManual ? "Termo OK" : "Termo pendente"}</Tag>
                    {a.ativo === false && <Tag ok={false}>Acesso desativado</Tag>}
                    {senhaGerada?.id === a.id && <span style={{ fontSize: 11.5, fontWeight: 700, color: "#1E7A34" }}>Nova senha: {senhaGerada.senha}</span>}
                    <Button variant="ghost" style={{ color: "#F5F3EC", border: "1px solid rgba(255,255,255,0.2)" }} onClick={() => resetarSenha(a.id)}>Redefinir senha</Button>
                    <Button variant={a.ativo === false ? "gold" : "ghost"} style={a.ativo === false ? undefined : { color: "#F5F3EC", border: "1px solid rgba(255,255,255,0.2)" }} onClick={() => alternarAtivoAluno(a.id)}>{a.ativo === false ? "Reativar acesso" : "Desativar acesso"}</Button>
                    <Button variant="ghost" style={{ color: "#F5F3EC", border: "1px solid rgba(255,255,255,0.2)" }} onClick={() => setEditandoAluno(a)}>Editar</Button>
                    <ConfirmDelete onConfirm={() => removerAluno(a.id)} />
                  </div>
                </Card>
              );
            })}
            {(() => {
              const filtrados = data.alunos
                .filter((a) => !filtroFaixaAluno || a.faixaId === filtroFaixaAluno)
                .filter((a) => {
                  const termo = buscaAluno.trim().toLowerCase();
                  if (!termo) return true;
                  return a.nome.toLowerCase().includes(termo) || (a.apelido || "").toLowerCase().includes(termo);
                });
              if (data.alunos.length === 0) return <Empty dark>Nenhum aluno cadastrado ainda.</Empty>;
              if (filtrados.length === 0) return <Empty dark>Nenhum aluno encontrado com esse filtro.</Empty>;
              return null;
            })()}
          </div>
        </div>
      )}

      {tab === "professores" && (
        <div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
            <Button icon={Plus} onClick={() => setNovoProf(true)}>Novo professor</Button>
          </div>
          {novoProf && <PersonForm tipo="professor" faixas={data.faixas} unidades={data.unidades} onCancel={() => setNovoProf(false)} onSave={addProf} />}
          {editandoProf && <PersonForm tipo="professor" faixas={data.faixas} unidades={data.unidades} initial={editandoProf} onCancel={() => setEditandoProf(null)} onSave={(form) => editarProf(editandoProf.id, form)} />}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {data.professores.map((p) => (
              <Card dark key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 12, flexWrap: "wrap", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Avatar foto={p.foto} nome={p.nome} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14, color: "#F5F3EC" }}>{p.nome}</div>
                    <div style={{ fontSize: 12.5, color: "#9B9891" }}>{p.especialidade || "—"} {p.email && `· ${p.email}`} {p.telefone && `· ${p.telefone}`}</div>
                    {p.faixaId && <div style={{ marginTop: 4 }}><BeltBar faixas={data.faixas} faixaId={p.faixaId} grau={p.grau || 0} textColor="#F5F3EC" /></div>}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  {senhaGeradaProf?.id === p.id && <span style={{ fontSize: 11.5, fontWeight: 700, color: "#6FCF7A" }}>Nova senha: {senhaGeradaProf.senha}</span>}
                  <Button variant="ghost" onClick={() => resetarSenhaProf(p.id)} style={{ color: "#F5F3EC", border: "1px solid rgba(255,255,255,0.2)" }}>Redefinir senha</Button>
                  <Button variant="ghost" onClick={() => setEditandoProf(p)} style={{ color: "#F5F3EC", border: "1px solid rgba(255,255,255,0.2)" }}>Editar</Button>
                  <ConfirmDelete onConfirm={() => removerProf(p.id)} />
                </div>
              </Card>
            ))}
            {data.professores.length === 0 && <Empty dark>Nenhum professor cadastrado ainda.</Empty>}
          </div>
        </div>
      )}

      {tab === "turmas" && (
        <div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
            <Button icon={Plus} onClick={() => setNovaTurma(true)}>Nova turma</Button>
          </div>
          {novaTurma && <TurmaForm unidades={data.unidades} onCancel={() => setNovaTurma(false)} onSave={addTurma} />}
          {editandoTurma && <TurmaForm unidades={data.unidades} initial={editandoTurma} onCancel={() => setEditandoTurma(null)} onSave={(form) => editarTurma(editandoTurma.id, form)} />}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {data.turmas.map((t) => {
              const unidadeDaTurma = (data.unidades || []).find((u) => u.id === t.unidadeId);
              return (
              <Card dark key={t.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 12, flexWrap: "wrap", gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: "#F5F3EC" }}>{t.nome}</div>
                  <div style={{ fontSize: 12.5, color: "#9B9891" }}>{formatDias(t.dias)} · {t.horario}{t.horarioFim ? ` às ${t.horarioFim}` : ""}</div>
                  <div style={{ fontSize: 11.5, color: "#9B9891" }}>Unidade: {unidadeDaTurma ? unidadeDaTurma.nome : "QG (padrão)"}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Button variant="ghost" onClick={() => setEditandoTurma(t)} style={{ color: "#F5F3EC", border: "1px solid rgba(255,255,255,0.2)" }}>Editar</Button>
                  <ConfirmDelete onConfirm={() => removerTurma(t.id)} />
                </div>
              </Card>
              );
            })}
            {data.turmas.length === 0 && <Empty dark>Nenhuma turma cadastrada ainda.</Empty>}
          </div>
        </div>
      )}

      {tab === "graduacao" && <GraduacaoAdmin data={data} save={save} />}
      {tab === "planos" && <PlanosAdmin data={data} save={save} />}
      {tab === "financeiro" && <FinanceiroAdmin data={data} save={save} />}
      {tab === "relatorios" && <RelatoriosAdmin data={data} />}
      {tab === "avisos" && <AvisosAdmin data={data} save={save} />}
      {tab === "unidades" && <UnidadesAdmin data={data} save={save} />}
      {tab === "videos" && <VideosAdmin data={data} save={save} />}
      {tab === "config" && <ConfiguracoesAdmin data={data} save={save} />}
      </div>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, dark = false, accent }) {
  return (
    <Card style={{ display: "flex", flexDirection: "column", gap: 8, position: "relative", overflow: "hidden", ...(dark ? { background: "#1A1D24", border: "1px solid rgba(255,255,255,0.06)" } : {}) }}>
      {accent && <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: accent }} />}
      <Icon size={18} color="#C9A227" />
      <div style={{ fontFamily: "Oswald", fontSize: 28, fontWeight: 700, color: dark ? "#F5F3EC" : "#12213B" }}>{value}</div>
      <div style={{ fontSize: 12.5, color: dark ? "#9B9891" : "#5A5648", fontWeight: 600 }}>{label}</div>
    </Card>
  );
}

function PersonForm({ tipo, initial, planos, faixas, professores, unidades, turmas, onSave, onCancel }) {
  const i = initial || {};
  const [nome, setNome] = useState(i.nome || "");
  const [email, setEmail] = useState(i.email || "");
  const [telefone, setTelefone] = useState(i.telefone || "");
  const [especialidade, setEspecialidade] = useState(i.especialidade || "");
  const [endereco, setEndereco] = useState(i.endereco || "");
  const [contatoEmergenciaNome, setCEN] = useState(i.contatoEmergenciaNome || "");
  const [contatoEmergenciaTelefone, setCET] = useState(i.contatoEmergenciaTelefone || "");
  const [planoId, setPlanoId] = useState(i.planoId || (planos && planos[0]?.id) || "");
  const [diaVencimento, setDiaVencimento] = useState(i.diaVencimento ?? "");
  const [dataNascimento, setDataNascimento] = useState(i.dataNascimento || "");
  const [faixaId, setFaixaId] = useState(i.faixaId || (faixas && faixas[0]?.id) || "");
  const [grau, setGrau] = useState(i.grau ?? 0);
  const [senha, setSenha] = useState(i.senha || (tipo === "aluno" && !initial ? "cpjj@123" : ""));
  const [termoAssinadoManual, setTAM] = useState(i.termoAssinadoManual || false);
  const [professorId, setProfessorId] = useState(i.professorId || "");
  const [peso, setPeso] = useState(i.peso ?? "");
  const [apelido, setApelido] = useState(i.apelido || "");
  const [unidadeId, setUnidadeId] = useState(i.unidadeId || "");
  const [turmaId, setTurmaId] = useState(i.turmaId || "");

  const faixaSelecionada = (faixas || []).find((f) => f.id === faixaId);
  const grausMaxSelecionado = faixaSelecionada?.grausMax ?? 0;
  const categoriaCalculada = categoriaEtaria(dataNascimento);

  const submit = () => {
    if (!nome.trim()) return;
    if (tipo === "aluno") {
      onSave({
        nome, email, telefone, endereco, contatoEmergenciaNome, contatoEmergenciaTelefone, planoId,
        diaVencimento: diaVencimento === "" ? null : Number(diaVencimento), dataNascimento, faixaId,
        grau: Math.min(Number(grau) || 0, grausMaxSelecionado), senha: senha || "cpjj@123", termoAssinadoManual,
        professorId, peso: peso === "" ? null : Number(peso), apelido, unidadeId, turmaId,
      });
    } else {
      onSave({
        nome, email, especialidade, telefone, endereco, faixaId, dataNascimento,
        grau: Math.min(Number(grau) || 0, grausMaxSelecionado), senha: senha || randomSenha(), unidadeId,
      });
    }
  };

  return (
    <Card style={{ marginBottom: 12 }}>
      {tipo === "aluno" && i.foto && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
          <img src={i.foto} alt={i.nome} style={{ width: 96, height: 96, borderRadius: 14, objectFit: "cover", border: "2px solid #12213B" }} />
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 10 }}>
        <Field label="Nome completo"><input style={inputStyle} value={nome} onChange={(e) => setNome(e.target.value)} /></Field>
        <Field label="E-mail"><input style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        {tipo === "aluno" ? (
          <>
            <Field label="Telefone"><input style={inputStyle} value={telefone} onChange={(e) => setTelefone(e.target.value)} /></Field>
            <Field label="Apelido"><input style={inputStyle} value={apelido} onChange={(e) => setApelido(e.target.value)} /></Field>
            <Field label="Endereço"><input style={inputStyle} value={endereco} onChange={(e) => setEndereco(e.target.value)} /></Field>
            <Field label="Contato de emergência (nome)"><input style={inputStyle} value={contatoEmergenciaNome} onChange={(e) => setCEN(e.target.value)} /></Field>
            <Field label="Contato de emergência (telefone)"><input style={inputStyle} value={contatoEmergenciaTelefone} onChange={(e) => setCET(e.target.value)} /></Field>
            <Field label="Data de nascimento">
              <input type="date" style={inputStyle} value={dataNascimento} onChange={(e) => setDataNascimento(e.target.value)} />
              {categoriaCalculada && <div style={{ fontSize: 11.5, color: "#1E7A34", fontWeight: 600, marginTop: 4 }}>Categoria: {categoriaCalculada}</div>}
            </Field>
            <Field label="Peso (kg)"><input type="number" min="0" step="0.1" style={inputStyle} value={peso} onChange={(e) => setPeso(e.target.value)} /></Field>
            <Field label="Plano">
              <select style={inputStyle} value={planoId} onChange={(e) => setPlanoId(e.target.value)}>
                {(planos || []).filter((p) => !p.unidadeId || p.unidadeId === unidadeId).map((p) => <option key={p.id} value={p.id}>{p.nome} — R$ {p.valor}</option>)}
              </select>
              <p style={{ fontSize: 11, color: "#8A8574", marginTop: 4 }}>Mostrando planos da unidade selecionada abaixo, mais os que valem pra todas.</p>
            </Field>
            <Field label="Dia de vencimento (1-31)"><input type="number" min="1" max="31" style={inputStyle} value={diaVencimento} onChange={(e) => setDiaVencimento(e.target.value)} /></Field>
            <Field label="Professor responsável">
              <select style={inputStyle} value={professorId} onChange={(e) => setProfessorId(e.target.value)}>
                <option value="">Nenhum específico</option>
                {(professores || []).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </Field>
            <Field label="Unidade de treino">
              <select style={inputStyle} value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)}>
                <option value="">QG (padrão)</option>
                {(unidades || []).map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
              </select>
            </Field>
            <Field label="Turma vinculada (aula particular)">
              <select style={inputStyle} value={turmaId} onChange={(e) => setTurmaId(e.target.value)}>
                <option value="">Nenhuma — segue a grade normal</option>
                {(turmas || []).map((t) => <option key={t.id} value={t.id}>{t.nome} — {t.horario}</option>)}
              </select>
            </Field>
            <Field label="Faixa">
              <select style={inputStyle} value={faixaId} onChange={(e) => setFaixaId(e.target.value)}>
                {(faixas || []).map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
              </select>
            </Field>
            <Field label={`Grau (máx. ${grausMaxSelecionado})`}><input type="number" min="0" max={grausMaxSelecionado} style={inputStyle} value={grau} onChange={(e) => setGrau(e.target.value)} /></Field>
            <Field label="Senha de acesso">
              <div style={{ display: "flex", gap: 6 }}>
                <input style={{ ...inputStyle, flex: 1 }} value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="será gerada se vazio" />
                <Button variant="ghost" onClick={() => setSenha(randomSenha())}>Gerar</Button>
              </div>
            </Field>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#5A5648", marginTop: 22 }}>
              <input type="checkbox" checked={termoAssinadoManual} onChange={(e) => setTAM(e.target.checked)} /> Termo assinado fisicamente
            </label>
          </>
        ) : (
          <>
            <Field label="Telefone / contato"><input style={inputStyle} value={telefone} onChange={(e) => setTelefone(e.target.value)} /></Field>
            <Field label="Endereço"><input style={inputStyle} value={endereco} onChange={(e) => setEndereco(e.target.value)} /></Field>
            <Field label="Especialidade"><input style={inputStyle} value={especialidade} onChange={(e) => setEspecialidade(e.target.value)} /></Field>
            <Field label="Unidade onde dá aula">
              <select style={inputStyle} value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)}>
                <option value="">QG (padrão)</option>
                {(unidades || []).map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
              </select>
              <p style={{ fontSize: 11, color: "#8A8574", marginTop: 4 }}>Ao criar turmas, esse professor só vai poder cadastrar pra essa unidade.</p>
            </Field>
            <Field label="Data de nascimento"><input type="date" style={inputStyle} value={dataNascimento} onChange={(e) => setDataNascimento(e.target.value)} /></Field>
            <Field label="Faixa">
              <select style={inputStyle} value={faixaId} onChange={(e) => setFaixaId(e.target.value)}>
                {(faixas || []).map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
              </select>
            </Field>
            <Field label={`Grau (máx. ${grausMaxSelecionado})`}><input type="number" min="0" max={grausMaxSelecionado} style={inputStyle} value={grau} onChange={(e) => setGrau(e.target.value)} /></Field>
            <Field label="Senha de acesso">
              <div style={{ display: "flex", gap: 6 }}>
                <input style={{ ...inputStyle, flex: 1 }} value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="será gerada se vazio" />
                <Button variant="ghost" onClick={() => setSenha(randomSenha())}>Gerar</Button>
              </div>
            </Field>
          </>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
        <ConfirmButton onConfirm={submit}>Salvar</ConfirmButton>
        <Button variant="ghost" icon={X} onClick={onCancel}>Cancelar</Button>
      </div>
    </Card>
  );
}

function TurmaForm({ initial, unidades, unidadeFixa, onSave, onCancel }) {
  const i = initial || {};
  const [nome, setNome] = useState(i.nome || "");
  const [dias, setDias] = useState(Array.isArray(i.dias) ? i.dias : (i.dias ? String(i.dias).split("/") : []));
  const [horario, setHorario] = useState(i.horario || "");
  const [horarioFim, setHorarioFim] = useState(i.horarioFim || "");
  const [unidadeId, setUnidadeId] = useState(unidadeFixa ? (unidadeFixa.id || "") : (i.unidadeId || ""));
  const toggleDia = (d) => setDias((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  const submit = () => { if (!nome.trim()) return; onSave({ nome, dias, horario, horarioFim, unidadeId }); };
  return (
    <Card style={{ marginBottom: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)", gap: 10 }}>
        <Field label="Nome da turma"><input style={inputStyle} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Fundamentos" /></Field>
        <Field label="Horário de início"><input style={inputStyle} value={horario} onChange={(e) => setHorario(e.target.value)} placeholder="19:00" /></Field>
        <Field label="Horário de término"><input style={inputStyle} value={horarioFim} onChange={(e) => setHorarioFim(e.target.value)} placeholder="20:00" /></Field>
      </div>
      <div style={{ marginTop: 10 }}>
        {unidadeFixa !== undefined ? (
          <Field label="Unidade">
            <div style={{ ...inputStyle, background: "#F0EDE3", color: "#5A5648", display: "flex", alignItems: "center" }}>{unidadeFixa ? unidadeFixa.nome : "QG (padrão)"}</div>
            <p style={{ fontSize: 11, color: "#8A8574", marginTop: 4 }}>Você só pode cadastrar turmas pra sua própria unidade. Se isso estiver errado, peça pra administração ajustar a unidade no seu cadastro.</p>
          </Field>
        ) : (
          <Field label="Unidade (deixe em branco para QG padrão)">
            <select style={inputStyle} value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)}>
              <option value="">QG (padrão)</option>
              {(unidades || []).map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </select>
          </Field>
        )}
      </div>
      <div style={{ marginTop: 10 }}>
        <Field label="Dias da semana">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
            {DIAS_SEMANA.map((d) => (
              <button key={d} type="button" onClick={() => toggleDia(d)} style={{ padding: "6px 12px", borderRadius: 20, border: dias.includes(d) ? "1px solid #12213B" : "1px solid #D8D3C4", background: dias.includes(d) ? "#12213B" : "#fff", color: dias.includes(d) ? "#fff" : "#5A5648", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>{d}</button>
            ))}
          </div>
        </Field>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <ConfirmButton onConfirm={submit}>Salvar</ConfirmButton>
        <Button variant="ghost" icon={X} onClick={onCancel}>Cancelar</Button>
      </div>
    </Card>
  );
}

function FaixaForm({ onSave, onCancel }) {
  const [nome, setNome] = useState("");
  const [categoria, setCategoria] = useState("Adulto");
  const [grausMax, setGrausMax] = useState(4);
  const [tempoMinimoAnos, setTempoMinimoAnos] = useState("");
  const [aulasPorGrau, setAulasPorGrau] = useState("");
  const submit = () => { if (!nome.trim()) return; onSave({ nome, categoria, grausMax: Number(grausMax), tempoMinimoAnos: tempoMinimoAnos === "" ? null : Number(tempoMinimoAnos), aulasPorGrau: aulasPorGrau === "" ? null : Number(aulasPorGrau) }); };
  return (
    <Card style={{ marginBottom: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 10 }}>
        <Field label="Nome da faixa"><input style={inputStyle} value={nome} onChange={(e) => setNome(e.target.value)} /></Field>
        <Field label="Categoria">
          <select style={inputStyle} value={categoria} onChange={(e) => setCategoria(e.target.value)}>
            <option>Infantil</option><option>Adulto</option><option>Mestre</option>
          </select>
        </Field>
        <Field label="Graus máx."><input type="number" min="0" max="10" style={inputStyle} value={grausMax} onChange={(e) => setGrausMax(e.target.value)} /></Field>
        <Field label="Tempo mínimo (anos)"><input type="number" min="0" step="0.5" style={inputStyle} value={tempoMinimoAnos} onChange={(e) => setTempoMinimoAnos(e.target.value)} /></Field>
        <Field label="Aulas por grau"><input type="number" min="0" style={inputStyle} value={aulasPorGrau} onChange={(e) => setAulasPorGrau(e.target.value)} /></Field>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <ConfirmButton onConfirm={submit}>Salvar</ConfirmButton>
        <Button variant="ghost" icon={X} onClick={onCancel}>Cancelar</Button>
      </div>
    </Card>
  );
}

function GraduacaoAdmin({ data, save }) {
  const [novo, setNovo] = useState(false);
  const [aviso, setAviso] = useState("");
  const moverFaixa = async (idx, dir) => {
    const faixas = [...data.faixas];
    const novoIdx = idx + dir;
    if (novoIdx < 0 || novoIdx >= faixas.length) return;
    [faixas[idx], faixas[novoIdx]] = [faixas[novoIdx], faixas[idx]];
    await save({ ...data, faixas });
  };
  const atualizarFaixa = async (id, campo, valor) => { const faixas = data.faixas.map((f) => (f.id === id ? { ...f, [campo]: valor } : f)); await save({ ...data, faixas }); };
  const removerFaixa = async (id) => {
    const emUso = data.alunos.some((a) => a.faixaId === id);
    if (emUso) { setAviso("Não é possível remover: há alunos nesta faixa. Gradue-os para outra faixa antes de remover."); return; }
    setAviso("");
    await save({ ...data, faixas: data.faixas.filter((f) => f.id !== id) });
  };
  const adicionarFaixa = async (form) => { const f = { id: uid(), cor: "#CCCCCC", texto: "#1B2027", borda: "#999999", ...form }; await save({ ...data, faixas: [...data.faixas, f] }); setNovo(false); };

  return (
    <div>
      <p style={{ fontSize: 12.5, color: "#9B9891", marginTop: 0 }}>Baseado no sistema de graduação da IBJJF. Edite nomes, cores, graus, tempo mínimo e quantas aulas valem um novo grau. Use as setas para reordenar a sequência.</p>
      {aviso && <div style={{ fontSize: 12.5, color: "#FF8A80", fontWeight: 600, marginBottom: 10 }}>{aviso}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <Button icon={Plus} onClick={() => setNovo(true)}>Nova faixa</Button>
      </div>
      {novo && <FaixaForm onCancel={() => setNovo(false)} onSave={adicionarFaixa} />}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {data.faixas.map((f, idx) => (
          <Card dark key={f.id} style={{ padding: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <BeltBar faixas={data.faixas} faixaId={f.id} grau={0} textColor="#F5F3EC" />
                <span style={{ fontSize: 11.5, color: "#9B9891" }}>{f.categoria}</span>
              </div>
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <button onClick={() => moverFaixa(idx, -1)} style={{ ...iconBtnStyle, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)", color: "#F5F3EC" }} disabled={idx === 0}>↑</button>
                <button onClick={() => moverFaixa(idx, 1)} style={{ ...iconBtnStyle, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)", color: "#F5F3EC" }} disabled={idx === data.faixas.length - 1}>↓</button>
                <ConfirmDelete size={14} onConfirm={() => removerFaixa(f.id)} />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px,1fr))", gap: 8, marginTop: 10 }}>
              <Field label="Nome" labelColor="#9B9891"><input style={inputStyle} value={f.nome} onChange={(e) => atualizarFaixa(f.id, "nome", e.target.value)} /></Field>
              <Field label="Graus máx." labelColor="#9B9891"><input type="number" min="0" max="10" style={inputStyle} value={f.grausMax} onChange={(e) => atualizarFaixa(f.id, "grausMax", Number(e.target.value))} /></Field>
              <Field label="Tempo mínimo (anos)" labelColor="#9B9891"><input type="number" min="0" step="0.5" style={inputStyle} value={f.tempoMinimoAnos ?? ""} onChange={(e) => atualizarFaixa(f.id, "tempoMinimoAnos", e.target.value === "" ? null : Number(e.target.value))} /></Field>
              <Field label="Aulas por grau" labelColor="#9B9891"><input type="number" min="0" style={inputStyle} value={f.aulasPorGrau ?? ""} onChange={(e) => atualizarFaixa(f.id, "aulasPorGrau", e.target.value === "" ? null : Number(e.target.value))} /></Field>
              <Field label="Cor da faixa" labelColor="#9B9891"><input type="color" style={{ ...inputStyle, padding: 2, height: 36 }} value={f.cor} onChange={(e) => atualizarFaixa(f.id, "cor", e.target.value)} /></Field>
              <Field label="Cor da ponta (riscos)" labelColor="#9B9891"><input type="color" style={{ ...inputStyle, padding: 2, height: 36 }} value={f.corPonta || "#17181B"} onChange={(e) => atualizarFaixa(f.id, "corPonta", e.target.value)} /></Field>
            </div>
            {f.observacoes && <div style={{ fontSize: 11.5, color: "#9B9891", marginTop: 6 }}>{f.observacoes}</div>}
          </Card>
        ))}
      </div>
    </div>
  );
}

function PlanoForm({ unidades, onSave, onCancel }) {
  const [nome, setNome] = useState("");
  const [valor, setValor] = useState("");
  const [periodicidade, setPeriodicidade] = useState("mensal");
  const [unidadeId, setUnidadeId] = useState("");
  const submit = () => { if (!nome.trim()) return; onSave({ nome, valor: Number(valor) || 0, periodicidade, unidadeId }); };
  return (
    <Card style={{ marginBottom: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
        <Field label="Nome do plano"><input style={inputStyle} value={nome} onChange={(e) => setNome(e.target.value)} /></Field>
        <Field label="Valor (R$)"><input type="number" min="0" style={inputStyle} value={valor} onChange={(e) => setValor(e.target.value)} /></Field>
        <Field label="Periodicidade">
          <select style={inputStyle} value={periodicidade} onChange={(e) => setPeriodicidade(e.target.value)}>
            <option value="mensal">Mensal</option><option value="trimestral">Trimestral</option><option value="semestral">Semestral</option><option value="anual">Anual</option>
          </select>
        </Field>
        <Field label="Unidade">
          <select style={inputStyle} value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)}>
            <option value="">Todas as unidades</option>
            {(unidades || []).map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </select>
        </Field>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <ConfirmButton onConfirm={submit}>Salvar</ConfirmButton>
        <Button variant="ghost" icon={X} onClick={onCancel}>Cancelar</Button>
      </div>
    </Card>
  );
}

function PlanosAdmin({ data, save }) {
  const [novo, setNovo] = useState(false);
  const [aviso, setAviso] = useState("");
  const atualizar = async (id, campo, valor) => { const planos = data.planos.map((p) => (p.id === id ? { ...p, [campo]: valor } : p)); await save({ ...data, planos }); };
  const remover = async (id) => {
    const emUso = data.alunos.some((a) => a.planoId === id);
    if (emUso) { setAviso("Não é possível remover: há alunos usando este plano."); return; }
    setAviso("");
    await save({ ...data, planos: data.planos.filter((p) => p.id !== id) });
  };
  const adicionar = async (form) => { const p = { id: uid(), ...form }; await save({ ...data, planos: [...data.planos, p] }); setNovo(false); };
  return (
    <div>
      <p style={{ fontSize: 12.5, color: "#9B9891", marginTop: 0 }}>O status "em dia / pendente" de cada aluno é calculado automaticamente comparando a data do último pagamento e o dia de vencimento com a periodicidade do plano. Vincule um plano a uma unidade quando o valor for diferente por local — planos sem unidade ficam disponíveis pra todas.</p>
      {aviso && <div style={{ fontSize: 12.5, color: "#FF8A80", fontWeight: 600, marginBottom: 10 }}>{aviso}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <Button icon={Plus} onClick={() => setNovo(true)}>Novo plano</Button>
      </div>
      {novo && <PlanoForm unidades={data.unidades} onCancel={() => setNovo(false)} onSave={adicionar} />}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {data.planos.map((p) => (
          <Card dark key={p.id} style={{ padding: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1.4fr auto", gap: 10, alignItems: "end" }}>
              <Field label="Nome" labelColor="#9B9891"><input style={inputStyle} value={p.nome} onChange={(e) => atualizar(p.id, "nome", e.target.value)} /></Field>
              <Field label="Valor (R$)" labelColor="#9B9891"><input type="number" style={inputStyle} value={p.valor} onChange={(e) => atualizar(p.id, "valor", Number(e.target.value))} /></Field>
              <Field label="Periodicidade" labelColor="#9B9891">
                <select style={inputStyle} value={p.periodicidade} onChange={(e) => atualizar(p.id, "periodicidade", e.target.value)}>
                  <option value="mensal">Mensal</option><option value="trimestral">Trimestral</option><option value="semestral">Semestral</option><option value="anual">Anual</option>
                </select>
              </Field>
              <Field label="Unidade" labelColor="#9B9891">
                <select style={inputStyle} value={p.unidadeId || ""} onChange={(e) => atualizar(p.id, "unidadeId", e.target.value)}>
                  <option value="">Todas as unidades</option>
                  {(data.unidades || []).map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
                </select>
              </Field>
              <ConfirmDelete onConfirm={() => remover(p.id)} />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function AlunosPorFaixaChart({ alunos, faixas, titulo, dark = false }) {
  const porFaixa = faixas.map((f) => ({ name: f.nome, value: alunos.filter((a) => a.faixaId === f.id).length, color: f.cor })).filter((d) => d.value > 0);
  if (porFaixa.length === 0) return null;
  return (
    <Card style={{ marginBottom: 14, ...(dark ? { background: "#1A1D24", border: "1px solid rgba(255,255,255,0.06)" } : {}) }}>
      <div style={dark ? { ...blockTitleStyle, color: "#F5F3EC" } : blockTitleStyle}>{titulo || "Alunos por faixa"}</div>
      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie data={porFaixa} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={95} label={(e) => <text x={e.x} y={e.y} textAnchor={e.textAnchor} fill={dark ? "#F5F3EC" : "#1B2027"} fontSize={12}>{`${e.name}: ${e.value}`}</text>} labelLine={{ stroke: dark ? "#9B9891" : "#8A8574" }}>
            {porFaixa.map((entry, i) => <Cell key={i} fill={entry.color} stroke={dark ? "#1A1D24" : "#fff"} strokeWidth={2} />)}
          </Pie>
          <Tooltip contentStyle={dark ? { background: "#1A1D24", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, color: "#F5F3EC" } : undefined} labelStyle={dark ? { color: "#F5F3EC" } : undefined} itemStyle={dark ? { color: "#F5F3EC" } : undefined} />
          <Legend wrapperStyle={dark ? { color: "#F5F3EC" } : undefined} />
        </PieChart>
      </ResponsiveContainer>
    </Card>
  );
}

function AniversariantesCard({ alunos, dark = false }) {
  const [mesSelecionado, setMesSelecionado] = useState(new Date().getMonth());
  const aniversariantes = alunos.filter((a) => a.dataNascimento && Number(a.dataNascimento.split("-")[1]) - 1 === mesSelecionado).sort((x, y) => Number(x.dataNascimento.split("-")[2]) - Number(y.dataNascimento.split("-")[2]));
  return (
    <Card style={{ marginBottom: 14, ...(dark ? { background: "#1A1D24", border: "1px solid rgba(255,255,255,0.06)" } : {}) }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={dark ? { ...blockTitleStyle, color: "#F5F3EC" } : blockTitleStyle}>Aniversariantes</div>
        <select style={dark ? inputStyleDark : inputStyle} value={mesSelecionado} onChange={(e) => setMesSelecionado(Number(e.target.value))}>
          {MESES.map((m, i) => <option key={i} value={i} style={dark ? { background: "#1A1D24", color: "#F5F3EC" } : undefined}>{m}</option>)}
        </select>
      </div>
      {aniversariantes.length === 0 ? (
        <Empty dark={dark}>Nenhum aniversariante em {MESES[mesSelecionado]}.</Empty>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {aniversariantes.map((a) => (
            <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13.5 }}>
              <Gift size={15} color="#C9A227" />
              <span style={{ fontWeight: 600, color: dark ? "#F5F3EC" : undefined }}>{a.nome}</span>
              <span style={{ color: dark ? "#9B9891" : "#8A8574" }}>dia {a.dataNascimento.split("-")[2]}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function PagamentosChart({ data, alunosFiltro, dark = false }) {
  const alunosBase = alunosFiltro || data.alunos;
  const [mes, setMes] = useState(() => new Date().toISOString().slice(0, 7));
  const confirmadosMes = alunosBase.flatMap((a) => (a.pagamentos || []).filter((p) => p.data.slice(0, 7) === mes));
  const totalConfirmado = confirmadosMes.reduce((s, p) => s + (p.valor || 0), 0);
  // Pendente = qualquer aluno em atraso agora, independente do mês selecionado (uma pendência não some se venceu num mês anterior)
  const pendentesAtuais = alunosBase.filter((a) => !statusPagamento(a, data.planos).emDia);
  const totalPendente = pendentesAtuais.reduce((s, a) => s + (data.planos.find((p) => p.id === a.planoId)?.valor || 0), 0);
  const dadosGrafico = [
    { name: "Confirmados no mês", value: confirmadosMes.length, color: "#4ADE80" },
    { name: "Pendentes agora", value: pendentesAtuais.length, color: "#FF6B6B" },
  ].filter((d) => d.value > 0);

  return (
    <Card style={{ marginBottom: 14, ...(dark ? { background: "#1A1D24", border: "1px solid rgba(255,255,255,0.06)" } : {}) }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
        <div style={dark ? { ...blockTitleStyle, color: "#F5F3EC" } : blockTitleStyle}>Pagamentos confirmados x pendentes</div>
        <input type="month" style={{ ...(dark ? inputStyleDark : inputStyle), maxWidth: 170 }} value={mes} onChange={(e) => setMes(e.target.value)} />
      </div>
      {dadosGrafico.length > 0 ? (
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie data={dadosGrafico} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={(e) => <text x={e.x} y={e.y} textAnchor={e.textAnchor} fill={dark ? "#F5F3EC" : "#1B2027"} fontSize={12}>{`${e.name}: ${e.value}`}</text>}>
              {dadosGrafico.map((entry, i) => <Cell key={i} fill={entry.color} stroke={dark ? "#1A1D24" : "#fff"} strokeWidth={2} />)}
            </Pie>
            <Tooltip contentStyle={dark ? { background: "#1A1D24", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, color: "#F5F3EC" } : undefined} labelStyle={dark ? { color: "#F5F3EC" } : undefined} itemStyle={dark ? { color: "#F5F3EC" } : undefined} />
            <Legend wrapperStyle={dark ? { color: "#F5F3EC" } : undefined} />
          </PieChart>
        </ResponsiveContainer>
      ) : (
        <Empty dark={dark}>Sem pagamentos confirmados neste mês nem pendências no momento.</Empty>
      )}
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginTop: 10, paddingTop: 12, borderTop: dark ? "1px solid rgba(255,255,255,0.1)" : "1px solid #E7E2D6" }}>
        <div>
          <div style={{ fontSize: 11.5, color: dark ? "#9B9891" : "#8A8574", fontWeight: 600, textTransform: "uppercase" }}>Total confirmado no mês</div>
          <div style={{ fontFamily: "Oswald", fontSize: 22, fontWeight: 700, color: "#4ADE80" }}>R$ {totalConfirmado.toFixed(2)}</div>
        </div>
        <div>
          <div style={{ fontSize: 11.5, color: dark ? "#9B9891" : "#8A8574", fontWeight: 600, textTransform: "uppercase" }}>Total pendente agora</div>
          <div style={{ fontFamily: "Oswald", fontSize: 22, fontWeight: 700, color: "#FF6B6B" }}>R$ {totalPendente.toFixed(2)}</div>
        </div>
      </div>
    </Card>
  );
}

function AlunosPorMesChart({ data, dark = false }) {
  const contagem = {};
  data.alunos.forEach((a) => { if (!a.matricula) return; const chave = a.matricula.slice(0, 7); contagem[chave] = (contagem[chave] || 0) + 1; });
  const chaves = Object.keys(contagem).sort();
  const dados = chaves.map((k) => { const [y, m] = k.split("-"); return { mes: `${m}/${y.slice(2)}`, alunos: contagem[k] }; });
  return (
    <Card style={{ marginBottom: 14, ...(dark ? { background: "#1A1D24", border: "1px solid rgba(255,255,255,0.06)" } : {}) }}>
      <div style={dark ? { ...blockTitleStyle, color: "#F5F3EC" } : blockTitleStyle}>Novos alunos por mês (matrícula)</div>
      {dados.length > 0 ? (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={dados}>
            <CartesianGrid strokeDasharray="3 3" stroke={dark ? "rgba(255,255,255,0.08)" : "#E7E2D6"} />
            <XAxis dataKey="mes" tick={{ fontSize: 12, fill: dark ? "#D9D5C8" : "#5A5648" }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: dark ? "#D9D5C8" : "#5A5648" }} />
            <Tooltip contentStyle={dark ? { background: "#1A1D24", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, color: "#F5F3EC" } : undefined} labelStyle={dark ? { color: "#F5F3EC" } : undefined} itemStyle={dark ? { color: "#F5F3EC" } : undefined} />
            <Bar dataKey="alunos" fill={dark ? "#C9A227" : "#12213B"} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <Empty dark={dark}>Sem dados de matrícula suficientes ainda.</Empty>
      )}
    </Card>
  );
}

function AlunosPorMesLineChart({ data, alunosFiltro, dark = false, titulo }) {
  const alunosBase = alunosFiltro || data.alunos;
  const contagem = {};
  alunosBase.forEach((a) => { if (!a.matricula) return; const chave = a.matricula.slice(0, 7); contagem[chave] = (contagem[chave] || 0) + 1; });
  const chaves = Object.keys(contagem).sort();
  const dados = chaves.map((k) => { const [y, m] = k.split("-"); return { mes: `${m}/${y.slice(2)}`, alunos: contagem[k] }; });
  return (
    <Card style={{ marginBottom: 14, ...(dark ? { background: "#1A1D24", border: "1px solid rgba(255,255,255,0.06)" } : {}) }}>
      <div style={dark ? { ...blockTitleStyle, color: "#F5F3EC" } : blockTitleStyle}>{titulo || "Novos alunos por mês (matrícula)"}</div>
      {dados.length > 0 ? (
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={dados}>
            <CartesianGrid strokeDasharray="3 3" stroke={dark ? "rgba(255,255,255,0.08)" : "#E7E2D6"} />
            <XAxis dataKey="mes" tick={{ fontSize: 12, fill: dark ? "#D9D5C8" : "#5A5648" }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: dark ? "#D9D5C8" : "#5A5648" }} />
            <Tooltip contentStyle={dark ? { background: "#1A1D24", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, color: "#F5F3EC" } : undefined} labelStyle={dark ? { color: "#F5F3EC" } : undefined} itemStyle={dark ? { color: "#F5F3EC" } : undefined} />
            <Line type="monotone" dataKey="alunos" stroke={dark ? "#C9A227" : "#12213B"} strokeWidth={2.5} dot={{ r: 4, fill: dark ? "#C9A227" : "#12213B" }} />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <Empty dark={dark}>Sem dados de matrícula suficientes ainda.</Empty>
      )}
    </Card>
  );
}

// ---------- Helpers compartilhados para os relatórios em PDF (visual moderno com marca) ----------
function estiloRelatorioModerno() {
  return `
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; }
    body{font-family:'Segoe UI',Arial,Helvetica,sans-serif;color:#1B2027;margin:0;padding:14mm;background:#fff;}
    .marca-dagua-grande{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:160mm;opacity:0.08;filter:invert(1);pointer-events:none;z-index:0;}
    .cabecalho{position:relative;display:flex;align-items:center;gap:14px;padding-bottom:14px;margin-bottom:6px;}
    .cabecalho::after{content:"";position:absolute;left:0;right:0;bottom:0;height:3px;background:linear-gradient(90deg,#C9A227,#F5D67D 50%,#C9A227);border-radius:2px;}
    .cabecalho img.logo{width:52px;height:52px;object-fit:contain;flex-shrink:0;border-radius:50%;}
    .cabecalho .titulos h1{font-size:21px;margin:0;letter-spacing:0.3px;color:#12213B;}
    .cabecalho .titulos h2{font-size:12px;color:#8A8574;margin:3px 0 0;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;}
    .stats{display:flex;gap:12px;margin:22px 0 24px;flex-wrap:wrap;}
    .stat{position:relative;background:#FBFAF5;border:1px solid #EFEBDF;border-radius:10px;padding:14px 18px 14px 20px;min-width:130px;overflow:hidden;}
    .stat::before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:linear-gradient(180deg,#C9A227,#E8C766);}
    .stat .label{font-size:9.5px;color:#8A8574;text-transform:uppercase;letter-spacing:0.3px;font-weight:800;}
    .stat .value{font-size:21px;font-weight:800;color:#12213B;margin-top:2px;}
    .section-title{font-size:12.5px;font-weight:800;margin-top:26px;margin-bottom:8px;color:#12213B;text-transform:uppercase;letter-spacing:0.3px;padding-bottom:6px;border-bottom:2px solid #EFEBDF;}
    table{width:100%;border-collapse:separate;border-spacing:0;margin-top:6px;font-size:11.5px;border-radius:10px;overflow:hidden;border:1px solid #EFEBDF;}
    th{background:#12213B;color:#F5D67D;text-align:left;padding:9px 10px;font-size:10px;text-transform:uppercase;letter-spacing:0.3px;font-weight:700;}
    td{padding:8px 10px;border-bottom:1px solid #EFEBDF;}
    tbody tr:last-child td{border-bottom:none;}
    tbody tr:nth-child(even){background:#FBFAF5;}
    .pill{display:inline-block;padding:2px 10px;border-radius:20px;font-size:10.5px;font-weight:700;white-space:nowrap;}
    .pill-ok{background:#E4F6E8;color:#1E7A34;}
    .pill-pendente{background:#FDEAE4;color:#B3401E;}
    .grafico-faixas{display:flex;align-items:center;gap:28px;margin:14px 0 4px;flex-wrap:wrap;}
    .legenda-pizza{display:flex;flex-direction:column;gap:7px;}
    .legenda-item{display:flex;align-items:center;gap:8px;font-size:11.5px;color:#12213B;}
    .legenda-cor{width:11px;height:11px;border-radius:3px;flex-shrink:0;}
    .legenda-valor{font-weight:800;}
    .rodape{margin-top:36px;padding-top:12px;border-top:1px solid #EFEBDF;font-size:10px;color:#8A8574;display:flex;align-items:center;gap:6px;}
    .rodape img{height:12px;width:auto;vertical-align:middle;}
    .voltar-btn{position:fixed;top:12px;left:12px;background:#12213B;color:#F5D67D;border:none;border-radius:8px;padding:10px 16px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;cursor:pointer;z-index:999;box-shadow:0 2px 8px rgba(0,0,0,0.18);}
    @media print { body{padding:14mm;} .voltar-btn{display:none;} }
  `;
}

function cabecalhoRelatorioModerno(data, titulo, subtitulo) {
  return `
    <div class="cabecalho">
      <img class="logo" src="${data.academia.logo || LOGO_CIRCULAR}" alt="" />
      <div class="titulos">
        <h1>${data.academia.nome}</h1>
        <h2>${titulo}${subtitulo ? " — " + subtitulo : ""}</h2>
      </div>
    </div>
  `;
}

function rodapeRelatorioModerno() {
  return `<div class="rodape"><span>Gerado em ${new Date().toLocaleString("pt-BR")} · Desenvolvido por TECBM - Bruno Martins Tecnologia</span><img src="${LOGO_TECBM}" alt="" /><span style="margin-left:auto;">Para voltar, use o botão no topo ou feche esta aba.</span></div>`;
}

function marcaDaguaRelatorio(data) {
  return data.academia.marcaDagua ? `<img class="marca-dagua-grande" src="${data.academia.marcaDagua}" alt="" />` : "";
}

function abrirJanelaRelatorio(html, onErro) {
  const win = window.open("", "_blank");
  if (!win) { onErro && onErro("Não foi possível abrir a janela do relatório. Permita pop-ups para este site e tente de novo."); return; }
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => { try { win.print(); } catch (_) {} }, 400);
}
// ---------- Fim dos helpers ----------

function gerarDocumentoTermoAssinado(data, aluno, onErro) {
  if (!aluno.termoAceito && !aluno.termoAssinadoManual) { onErro && onErro("Este aluno ainda não assinou o termo."); return; }

  const pdfLink = data.academia.termoPdf
    ? `<p style="font-size:12px;"><a href="${data.academia.termoPdf}" target="_blank" onclick="event.preventDefault();try{var p=this.href.split(',');var mime=(p[0].match(/data:([^;]+)/)||[])[1]||'application/pdf';var bin=atob(p[1]);var by=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)by[i]=bin.charCodeAt(i);window.open(URL.createObjectURL(new Blob([by],{type:mime})),'_blank');}catch(e){window.open(this.href,'_blank');}">📄 Ver termo em PDF (${data.academia.termoPdfNome || "termo.pdf"})</a></p>`
    : "";
  const termoHtml = data.academia.termoPadrao
    ? `<div style="white-space:pre-wrap;font-size:12.5px;line-height:1.6;border:1px solid #EFEBDF;border-radius:8px;padding:14px;margin:14px 0;">${data.academia.termoPadrao}</div>`
    : "";
  const assinaturaHtml = aluno.termoAssinadoManual
    ? `<p style="font-size:12.5px;color:#5A5648;margin-top:16px;">Assinado fisicamente em papel — registrado manualmente pela administração, sem assinatura digital.</p>`
    : aluno.assinaturaTermo
      ? `<div style="margin-top:20px;"><img src="${aluno.assinaturaTermo}" style="max-width:280px;display:block;" /><div style="border-top:1px solid #1B2027;width:280px;margin-top:2px;"></div><div style="font-size:11px;color:#8A8574;margin-top:4px;">Assinatura de ${aluno.nome}</div></div>`
      : `<p style="font-size:12.5px;color:#B3401E;font-weight:700;margin-top:16px;">Sem assinatura registrada (aceito antes dessa funcionalidade existir).</p>`;

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Termo assinado - ${aluno.nome}</title>
    <style>${estiloRelatorioModerno()}</style></head>
    <body>
      ${marcaDaguaRelatorio(data)}
      <button class="voltar-btn" onclick="window.close()">← Voltar para o app</button>
      ${cabecalhoRelatorioModerno(data, "Termo de consentimento assinado", aluno.nome)}
      <div class="stats">
        <div class="stat"><div class="label">Aluno</div><div class="value" style="font-size:15px;">${aluno.nome}</div></div>
        <div class="stat"><div class="label">Aceito em</div><div class="value" style="font-size:15px;">${aluno.termoAceitoEm ? new Date(aluno.termoAceitoEm).toLocaleString("pt-BR") : "—"}</div></div>
      </div>
      ${pdfLink}
      ${termoHtml}
      ${assinaturaHtml}
      ${rodapeRelatorioModerno()}
    </body></html>`;

  abrirJanelaRelatorio(html, onErro);
}

function gerarRelatorioMensal(data, mes, onErro, alunosFiltro, tituloExtra) {
  const alunosBase = alunosFiltro || data.alunos;
  const confirmadosMes = alunosBase.flatMap((a) => (a.pagamentos || []).filter((p) => p.data.slice(0, 7) === mes).map((p) => ({ ...p, alunoNome: a.nome })));
  const totalConfirmado = confirmadosMes.reduce((s, p) => s + (p.valor || 0), 0);
  const pendentesAtuais = alunosBase.filter((a) => !statusPagamento(a, data.planos).emDia);
  const totalPendente = pendentesAtuais.reduce((s, a) => s + (data.planos.find((p) => p.id === a.planoId)?.valor || 0), 0);
  const [ano, mesNum] = mes.split("-");
  const nomeMes = MESES[Number(mesNum) - 1];

  const linhasConfirmados = confirmadosMes
    .map((p) => `<tr><td>${p.alunoNome}</td><td>${new Date(p.data + "T00:00:00").toLocaleDateString("pt-BR")}</td><td>R$ ${p.valor.toFixed(2)}</td></tr>`)
    .join("") || `<tr><td colspan="3">Nenhum pagamento confirmado neste mês.</td></tr>`;

  const linhasPendentes = pendentesAtuais
    .map((a) => { const plano = data.planos.find((p) => p.id === a.planoId); return `<tr><td>${a.nome}</td><td>${plano?.nome || "—"}</td><td>R$ ${(plano?.valor || 0).toFixed(2)}</td></tr>`; })
    .join("") || `<tr><td colspan="3">Nenhuma pendência no momento.</td></tr>`;

  const dadosPagamentos = [
    { nome: "Confirmados no mês", valor: confirmadosMes.length, cor: "#4ADE80" },
    { nome: "Pendentes agora", valor: pendentesAtuais.length, cor: "#FF6B6B" },
  ].filter((d) => d.valor > 0);
  const graficoPagamentosHtml = dadosPagamentos.length
    ? `<div class="section-title">Pagamentos confirmados x pendentes</div>
       <div class="grafico-faixas">${svgPizza(dadosPagamentos)}${legendaPizzaHtml(dadosPagamentos)}</div>`
    : "";

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Relatório ${nomeMes} ${ano}</title>
    <style>${estiloRelatorioModerno()}</style></head>
    <body>
      ${marcaDaguaRelatorio(data)}
      <button class="voltar-btn" onclick="window.close()">← Voltar para o app</button>
      ${cabecalhoRelatorioModerno(data, "Relatório financeiro" + (tituloExtra ? " — " + tituloExtra : ""), `${nomeMes} de ${ano}`)}
      <div class="conteudo">
        <div class="stats">
          <div class="stat"><div class="label">Alunos</div><div class="value">${alunosBase.length}</div></div>
          <div class="stat"><div class="label">Pagamentos confirmados</div><div class="value">${confirmadosMes.length}</div></div>
          <div class="stat"><div class="label">Pagamentos pendentes</div><div class="value">${pendentesAtuais.length}</div></div>
          <div class="stat"><div class="label">Receita recebida no mês</div><div class="value">R$ ${totalConfirmado.toFixed(2)}</div></div>
          <div class="stat"><div class="label">Receita pendente agora</div><div class="value">R$ ${totalPendente.toFixed(2)}</div></div>
        </div>
        ${graficoPagamentosHtml}
        <div class="section-title">Pagamentos confirmados no mês</div>
        <table><thead><tr><th>Aluno</th><th>Data</th><th>Valor</th></tr></thead><tbody>${linhasConfirmados}</tbody></table>
        <div class="section-title">Pagamentos pendentes atualmente</div>
        <table><thead><tr><th>Aluno</th><th>Plano</th><th>Valor</th></tr></thead><tbody>${linhasPendentes}</tbody></table>
        ${rodapeRelatorioModerno()}
      </div>
    </body></html>`;

  abrirJanelaRelatorio(html, onErro);
}

function RelatorioMensal({ data }) {
  const [mes, setMes] = useState(() => new Date().toISOString().slice(0, 7));
  const [erro, setErro] = useState("");
  return (
    <Card dark style={{ marginBottom: 14 }}>
      <div style={{ ...blockTitleStyle, color: "#F5F3EC" }}>Relatório mensal</div>
      <p style={{ fontSize: 12.5, color: "#9B9891", marginTop: 0 }}>Gera um relatório com total de alunos, pagamentos confirmados e pendentes do mês escolhido — abre em uma nova aba pronta para salvar como PDF (ou imprimir).</p>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ flex: "0 1 180px", minWidth: 140 }}><Field label="Mês do relatório" labelColor="#9B9891"><input type="month" style={{ ...inputStyle, maxWidth: 170, background: "#0F1116", border: "1px solid rgba(255,255,255,0.14)", color: "#F5F3EC", colorScheme: "dark" }} value={mes} onChange={(e) => setMes(e.target.value)} /></Field></div>
        <Button icon={CreditCard} variant="gold" onClick={() => { setErro(""); gerarRelatorioMensal(data, mes, setErro); }}>Gerar relatório (PDF)</Button>
      </div>
      {erro && <div style={{ marginTop: 8, fontSize: 12.5, color: "#FF8A80", fontWeight: 600 }}>{erro}</div>}
    </Card>
  );
}

function gerarRelatorioCheckins(data, dataSelecionada, onErro, alunosFiltro, tituloExtra) {
  const idsPermitidos = alunosFiltro ? new Set(alunosFiltro.map((a) => a.id)) : null;
  const checkinsDoDia = data.checkins
    .filter((c) => dataLocalDe(c.dataHora) === dataSelecionada)
    .filter((c) => !idsPermitidos || idsPermitidos.has(c.alunoId))
    .map((c) => {
      const aluno = data.alunos.find((a) => a.id === c.alunoId);
      const sessao = data.sessoes.find((s) => s.id === c.sessaoId);
      const turma = sessao && data.turmas.find((t) => t.id === sessao.treinoId);
      return { alunoNome: aluno?.nome || "—", turmaNome: turma?.nome || "—", hora: new Date(c.dataHora).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) };
    })
    .sort((a, b) => a.hora.localeCompare(b.hora));

  const [ano, mes, dia] = dataSelecionada.split("-");
  const dataFormatada = `${dia}/${mes}/${ano}`;

  const linhas = checkinsDoDia
    .map((c) => `<tr><td>${c.alunoNome}</td><td>${c.turmaNome}</td><td>${c.hora}</td></tr>`)
    .join("") || `<tr><td colspan="3">Nenhum check-in registrado nesta data.</td></tr>`;

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Check-ins ${dataFormatada}</title>
    <style>${estiloRelatorioModerno()}</style></head>
    <body>
      ${marcaDaguaRelatorio(data)}
      <button class="voltar-btn" onclick="window.close()">← Voltar para o app</button>
      ${cabecalhoRelatorioModerno(data, "Relatório de check-ins" + (tituloExtra ? " — " + tituloExtra : ""), dataFormatada)}
      <div class="stats">
        <div class="stat"><div class="label">Check-ins na data</div><div class="value">${checkinsDoDia.length}</div></div>
      </div>
      <table><thead><tr><th>Aluno</th><th>Turma</th><th>Horário</th></tr></thead><tbody>${linhas}</tbody></table>
      ${rodapeRelatorioModerno()}
    </body></html>`;

  abrirJanelaRelatorio(html, onErro);
}

function svgPizza(dados, size = 190) {
  const total = dados.reduce((s, d) => s + d.valor, 0);
  if (!total) return "";
  const cx = size / 2, cy = size / 2, r = size / 2 - 4;
  let anguloAtual = -Math.PI / 2;
  const fatias = dados
    .map((d) => {
      const fracao = d.valor / total;
      const anguloFim = anguloAtual + fracao * Math.PI * 2;
      const x1 = cx + r * Math.cos(anguloAtual), y1 = cy + r * Math.sin(anguloAtual);
      const x2 = cx + r * Math.cos(anguloFim), y2 = cy + r * Math.sin(anguloFim);
      const largeArc = fracao > 0.5 ? 1 : 0;
      const path = fracao >= 0.999
        ? `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z`
        : `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
      anguloAtual = anguloFim;
      return `<path d="${path}" fill="${d.cor}" stroke="#fff" stroke-width="2"/>`;
    })
    .join("");
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${fatias}</svg>`;
}

function gerarRelatorioListaAlunos(data, onErro, alunosFiltro, tituloExtra) {
  const alunosBase = alunosFiltro || data.alunos;
  const linhas = [...alunosBase]
    .sort((a, b) => a.nome.localeCompare(b.nome))
    .map((a) => {
      const faixa = data.faixas.find((f) => f.id === a.faixaId);
      const plano = data.planos.find((p) => p.id === a.planoId);
      const professor = data.professores.find((p) => p.id === a.professorId);
      const { emDia } = statusPagamento(a, data.planos);
      const categoria = categoriaEtaria(a.dataNascimento) || "—";
      return `<tr>
        <td>${a.nome}${a.apelido ? ` "${a.apelido}"` : ""}</td>
        <td>${faixa ? `${faixa.nome}${faixa.grausMax > 0 ? ` (${a.grau}º)` : ""}` : "—"}</td>
        <td>${categoria}</td>
        <td>${a.telefone || "—"}</td>
        <td>${professor?.nome || "—"}</td>
        <td>${plano?.nome || "—"}</td>
        <td>${emDia ? '<span class="pill pill-ok">Em dia</span>' : '<span class="pill pill-pendente">Pendente</span>'}</td>
      </tr>`;
    })
    .join("") || `<tr><td colspan="7">Nenhum aluno cadastrado.</td></tr>`;

  const porFaixa = data.faixas
    .map((f) => ({ nome: f.nome, cor: f.cor, valor: alunosBase.filter((a) => a.faixaId === f.id).length }))
    .filter((f) => f.valor > 0);
  const graficoFaixasHtml = porFaixa.length
    ? `<div class="section-title">Alunos por faixa</div>
       <div class="grafico-faixas">
         ${svgPizza(porFaixa)}
         <div class="legenda-pizza">
           ${porFaixa
             .map(
               (f) => `<div class="legenda-item"><span class="legenda-cor" style="background:${f.cor};border:1px solid rgba(0,0,0,0.15);"></span>${f.nome}: <span class="legenda-valor">${f.valor}</span></div>`
             )
             .join("")}
         </div>
       </div>`
    : "";

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Lista de alunos</title>
    <style>${estiloRelatorioModerno()}</style></head>
    <body>
      ${marcaDaguaRelatorio(data)}
      <button class="voltar-btn" onclick="window.close()">← Voltar para o app</button>
      ${cabecalhoRelatorioModerno(data, "Lista de alunos", tituloExtra)}
      <div class="stats">
        <div class="stat"><div class="label">Total de alunos</div><div class="value">${alunosBase.length}</div></div>
      </div>
      ${graficoFaixasHtml}
      <div class="section-title">Cadastro completo</div>
      <table><thead><tr><th>Aluno</th><th>Faixa</th><th>Categoria</th><th>Telefone</th><th>Professor</th><th>Plano</th><th>Pagamento</th></tr></thead><tbody>${linhas}</tbody></table>
      ${rodapeRelatorioModerno()}
    </body></html>`;

  abrirJanelaRelatorio(html, onErro);
}

function gerarRelatorioFrequencia(data, onErro, ordem, alunosFiltro, tituloExtra) {
  const alunosBase = alunosFiltro || data.alunos;
  const linhas = alunosBase
    .map((a) => ({ aluno: a, total: data.checkins.filter((c) => c.alunoId === a.id).length }))
    .sort((x, y) => (ordem === "menos" ? x.total - y.total : y.total - x.total))
    .map(({ aluno: a, total }, i) => {
      const faixa = data.faixas.find((f) => f.id === a.faixaId);
      const professor = data.professores.find((p) => p.id === a.professorId);
      return `<tr>
        <td>${i + 1}º</td>
        <td>${a.nome}${a.apelido ? ` "${a.apelido}"` : ""}</td>
        <td>${faixa ? faixa.nome : "—"}</td>
        <td>${professor?.nome || "—"}</td>
        <td style="text-align:right;font-weight:bold;">${total}</td>
      </tr>`;
    })
    .join("") || `<tr><td colspan="5">Nenhum aluno cadastrado.</td></tr>`;

  const tituloOrdem = ordem === "menos" ? "menos frequentes" : "mais frequentes";

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Frequência de alunos</title>
    <style>${estiloRelatorioModerno()}</style></head>
    <body>
      ${marcaDaguaRelatorio(data)}
      <button class="voltar-btn" onclick="window.close()">← Voltar para o app</button>
      ${cabecalhoRelatorioModerno(data, "Frequência de alunos" + (tituloExtra ? " — " + tituloExtra : ""), tituloOrdem)}
      <table><thead><tr><th>Posição</th><th>Aluno</th><th>Faixa</th><th>Professor</th><th style="text-align:right;">Check-ins (total)</th></tr></thead><tbody>${linhas}</tbody></table>
      ${rodapeRelatorioModerno()}
    </body></html>`;

  abrirJanelaRelatorio(html, onErro);
}

function gerarRelatorioDesativados(data, onErro, alunosFiltro, tituloExtra) {
  const alunosBase = alunosFiltro || data.alunos;
  const desativados = alunosBase.filter((a) => a.ativo === false);
  const linhas = [...desativados]
    .sort((a, b) => a.nome.localeCompare(b.nome))
    .map((a) => {
      const faixa = data.faixas.find((f) => f.id === a.faixaId);
      const professor = data.professores.find((p) => p.id === a.professorId);
      return `<tr>
        <td>${a.nome}${a.apelido ? ` "${a.apelido}"` : ""}</td>
        <td>${faixa ? faixa.nome : "—"}</td>
        <td>${a.telefone || "—"}</td>
        <td>${professor?.nome || "—"}</td>
      </tr>`;
    })
    .join("") || `<tr><td colspan="4">Nenhum aluno desativado no momento.</td></tr>`;

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Alunos desativados</title>
    <style>${estiloRelatorioModerno()}</style></head>
    <body>
      ${marcaDaguaRelatorio(data)}
      <button class="voltar-btn" onclick="window.close()">← Voltar para o app</button>
      ${cabecalhoRelatorioModerno(data, "Alunos com acesso desativado", tituloExtra)}
      <div class="stats">
        <div class="stat"><div class="label">Total desativados</div><div class="value">${desativados.length}</div></div>
      </div>
      <table><thead><tr><th>Aluno</th><th>Faixa</th><th>Telefone</th><th>Professor</th></tr></thead><tbody>${linhas}</tbody></table>
      ${rodapeRelatorioModerno()}
    </body></html>`;

  abrirJanelaRelatorio(html, onErro);
}

const CORES_UNIDADES = ["#C9A227", "#1B4F9C", "#2E7D46", "#8E44AD", "#D9534F", "#17A2B8", "#E67E22", "#6C757D", "#B5179E", "#118AB2"];

function legendaPizzaHtml(itens) {
  return `<div class="legenda-pizza">${itens
    .map((it) => `<div class="legenda-item"><span class="legenda-cor" style="background:${it.cor};border:1px solid rgba(0,0,0,0.15);"></span>${it.nome}: <span class="legenda-valor">${it.valor}</span></div>`)
    .join("")}</div>`;
}

function gerarRelatorioAlunosPorUnidade(data, onErro) {
  const grupos = {};
  data.alunos.forEach((a) => {
    const unidade = (data.unidades || []).find((u) => u.id === a.unidadeId);
    const nomeUnidade = unidade ? unidade.nome : "QG (padrão)";
    if (!grupos[nomeUnidade]) grupos[nomeUnidade] = { total: 0, ativos: 0, inativos: 0, alunos: [] };
    grupos[nomeUnidade].total += 1;
    if (a.ativo === false) grupos[nomeUnidade].inativos += 1; else grupos[nomeUnidade].ativos += 1;
    grupos[nomeUnidade].alunos.push(a);
  });
  const listaUnidades = Object.entries(grupos).sort((a, b) => b[1].total - a[1].total);
  const porUnidadePizza = listaUnidades.map(([nome, g], i) => ({ nome, valor: g.total, cor: CORES_UNIDADES[i % CORES_UNIDADES.length] }));
  const linhas = listaUnidades
    .map(([nome, g]) => `<tr>
      <td>${nome}</td>
      <td style="text-align:right;font-weight:bold;">${g.total}</td>
      <td style="text-align:right;">${g.ativos}</td>
      <td style="text-align:right;">${g.inativos}</td>
    </tr>`)
    .join("") || `<tr><td colspan="4">Nenhum aluno cadastrado.</td></tr>`;

  const porFaixa = data.faixas
    .map((f) => ({ nome: f.nome, cor: f.cor, valor: data.alunos.filter((a) => a.faixaId === f.id).length }))
    .filter((f) => f.valor > 0);

  const graficoUnidadeHtml = porUnidadePizza.length
    ? `<div class="section-title">Alunos por unidade</div>
       <div class="grafico-faixas">${svgPizza(porUnidadePizza)}${legendaPizzaHtml(porUnidadePizza)}</div>`
    : "";
  const graficoFaixaHtml = porFaixa.length
    ? `<div class="section-title">Alunos por faixa (todas as unidades)</div>
       <div class="grafico-faixas">${svgPizza(porFaixa)}${legendaPizzaHtml(porFaixa)}</div>`
    : "";

  const graficosFaixaPorUnidadeHtml = listaUnidades
    .map(([nome, g]) => {
      const porFaixaDaUnidade = data.faixas
        .map((f) => ({ nome: f.nome, cor: f.cor, valor: g.alunos.filter((a) => a.faixaId === f.id).length }))
        .filter((f) => f.valor > 0);
      if (!porFaixaDaUnidade.length) return "";
      return `<div class="section-title">Alunos por faixa — ${nome}</div>
        <div class="grafico-faixas">${svgPizza(porFaixaDaUnidade)}${legendaPizzaHtml(porFaixaDaUnidade)}</div>`;
    })
    .join("");

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Total de alunos por unidade</title>
    <style>${estiloRelatorioModerno()}</style></head>
    <body>
      ${marcaDaguaRelatorio(data)}
      <button class="voltar-btn" onclick="window.close()">← Voltar para o app</button>
      ${cabecalhoRelatorioModerno(data, "Total de alunos por unidade")}
      <div class="stats">
        <div class="stat"><div class="label">Total geral (todas as unidades)</div><div class="value">${data.alunos.length}</div></div>
        <div class="stat"><div class="label">Unidades com aluno</div><div class="value">${Object.keys(grupos).length}</div></div>
      </div>
      ${graficoUnidadeHtml}
      <div class="section-title">Detalhamento por unidade</div>
      <table><thead><tr><th>Unidade</th><th style="text-align:right;">Total</th><th style="text-align:right;">Ativos</th><th style="text-align:right;">Inativos</th></tr></thead><tbody>${linhas}</tbody></table>
      ${graficoFaixaHtml}
      ${graficosFaixaPorUnidadeHtml}
      ${rodapeRelatorioModerno()}
    </body></html>`;

  abrirJanelaRelatorio(html, onErro);
}


function PresencaManualAdmin({ data, save }) {
  const [turmaId, setTurmaId] = useState(data.turmas[0]?.id || "");
  const [msg, setMsg] = useState("");
  const sessaoAtiva = data.sessoes.find((s) => s.treinoId === turmaId && s.ativa);

  const abrirSessao = async () => {
    const sessao = { id: uid(), treinoId: turmaId, professorId: null, codigo: randomCode(), criadoEm: new Date().toISOString(), ativa: true };
    await save({ ...data, sessoes: [...data.sessoes, sessao] });
  };
  const encerrarSessao = async () => {
    const sessoes = data.sessoes.map((s) => (s.id === sessaoAtiva.id ? { ...s, ativa: false } : s));
    await save({ ...data, sessoes });
  };
  const alternarPresenca = async (alunoId, presente) => {
    setMsg("");
    if (presente) await removerPresencaEm(data, save, sessaoAtiva.id, alunoId);
    else await marcarPresencaEm(data, save, sessaoAtiva.id, alunoId);
  };

  return (
    <Card dark style={{ marginBottom: 14 }}>
      <div style={{ ...blockTitleStyle, color: "#F5F3EC" }}>Marcar presença manual</div>
      <p style={{ fontSize: 12.5, color: "#9B9891", marginTop: 0 }}>Para quando o aluno esqueceu o celular ou não conseguiu fazer o check-in por localização.</p>
      <Field label="Turma" labelColor="#9B9891"><select style={{ ...inputStyle, background: "#0F1116", border: "1px solid rgba(255,255,255,0.14)", color: "#F5F3EC", colorScheme: "dark" }} value={turmaId} onChange={(e) => setTurmaId(e.target.value)}>{data.turmas.map((t) => <option key={t.id} value={t.id} style={{ background: "#1A1D24", color: "#F5F3EC" }}>{t.nome} — {t.horario}{t.horarioFim ? ` às ${t.horarioFim}` : ""}</option>)}</select></Field>
      {!sessaoAtiva ? (
        <div style={{ marginTop: 10 }}><Button variant="gold" icon={CalendarCheck} onClick={abrirSessao}>Abrir check-in desta turma hoje</Button></div>
      ) : (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflowY: "auto" }}>
            {data.alunos.map((a) => {
              const presente = data.checkins.some((c) => c.sessaoId === sessaoAtiva.id && c.alunoId === a.id);
              return (
                <div key={a.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", background: "#12151B", borderRadius: 6, border: "1px solid rgba(255,255,255,0.08)", color: "#F5F3EC" }}>
                  <span style={{ fontSize: 13 }}>{a.nome}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Tag ok={presente}>{presente ? "Presente" : "Ausente"}</Tag>
                    <Button variant="ghost" onClick={() => alternarPresenca(a.id, presente)} style={{ color: "#F5F3EC", border: "1px solid rgba(255,255,255,0.2)" }}>{presente ? "Remover" : "Marcar presença"}</Button>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 10 }}><Button variant="danger" onClick={encerrarSessao}>Encerrar check-in desta turma</Button></div>
        </div>
      )}
      {msg && <div style={{ marginTop: 8, fontSize: 12.5, color: "#FF8A80" }}>{msg}</div>}
    </Card>
  );
}

function RelatorioListaAlunosProfessor({ data, prof }) {
  const [erro, setErro] = useState("");
  const meusAlunos = data.alunos.filter((a) => a.professorId === prof.id);
  return (
    <Card style={{ marginBottom: 16, background: "#1A1D24", border: "1px solid rgba(255,255,255,0.06)" }}>
      <div style={{ ...blockTitleStyle, color: "#F5F3EC" }}>Lista de alunos</div>
      <p style={{ fontSize: 12.5, color: "#C9C4B4", marginTop: 0 }}>Gera um PDF com o total e a lista de todos os seus {meusAlunos.length} aluno(s) vinculado(s).</p>
      {meusAlunos.length === 0 ? (
        <Empty dark>Nenhum aluno vinculado a você ainda.</Empty>
      ) : (
        <Button icon={Users} variant="gold" onClick={() => { setErro(""); gerarRelatorioListaAlunos(data, setErro, meusAlunos, prof.nome); }}>Gerar lista de alunos (PDF)</Button>
      )}
      {erro && <div style={{ marginTop: 8, fontSize: 12.5, color: "#FF8A80", fontWeight: 600 }}>{erro}</div>}
    </Card>
  );
}

function RelatorioListaAlunos({ data }) {
  const [erro, setErro] = useState("");
  return (
    <Card dark style={{ marginBottom: 14 }}>
      <div style={{ ...blockTitleStyle, color: "#F5F3EC" }}>Lista de alunos</div>
      <p style={{ fontSize: 12.5, color: "#9B9891", marginTop: 0 }}>Gera um PDF com todos os alunos cadastrados: faixa, categoria, telefone, professor, plano e status de pagamento.</p>
      <Button icon={Users} variant="gold" onClick={() => { setErro(""); gerarRelatorioListaAlunos(data, setErro); }}>Gerar lista de alunos (PDF)</Button>
      {erro && <div style={{ marginTop: 8, fontSize: 12.5, color: "#FF8A80", fontWeight: 600 }}>{erro}</div>}
    </Card>
  );
}

function RelatorioCheckins({ data }) {
  const [dataSel, setDataSel] = useState(hoje());
  const [erro, setErro] = useState("");
  return (
    <Card dark style={{ marginBottom: 14 }}>
      <div style={{ ...blockTitleStyle, color: "#F5F3EC" }}>Relatório de check-ins por data</div>
      <p style={{ fontSize: 12.5, color: "#9B9891", marginTop: 0 }}>Escolha uma data e veja todos os alunos que fizeram check-in naquele dia — abre pronto para salvar como PDF.</p>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ flex: "0 1 180px", minWidth: 140 }}><Field label="Data" labelColor="#9B9891"><input type="date" style={{ ...inputStyle, maxWidth: 170, background: "#0F1116", border: "1px solid rgba(255,255,255,0.14)", color: "#F5F3EC", colorScheme: "dark" }} value={dataSel} onChange={(e) => setDataSel(e.target.value)} /></Field></div>
        <Button icon={CalendarCheck} variant="gold" onClick={() => { setErro(""); gerarRelatorioCheckins(data, dataSel, setErro); }}>Gerar relatório (PDF)</Button>
      </div>
      {erro && <div style={{ marginTop: 8, fontSize: 12.5, color: "#FF8A80", fontWeight: 600 }}>{erro}</div>}
    </Card>
  );
}

function BuscaAluno({ alunos, alunoId, onSelecionar, dark = true, disabled = false }) {
  const alunoSelecionado = alunos.find((a) => a.id === alunoId);
  const [texto, setTexto] = useState(alunoSelecionado?.nome || "");
  const [aberto, setAberto] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    setTexto(alunoSelecionado?.nome || "");
  }, [alunoId]);

  const termoBusca = normalizarTexto(texto);
  const filtrados = termoBusca ? alunos.filter((a) => normalizarTexto(a.nome).includes(termoBusca)) : alunos;

  const escolher = (a) => {
    onSelecionar(a.id);
    setTexto(a.nome);
    setAberto(false);
  };

  const destacar = (nome) => {
    if (!termoBusca) return nome;
    const idx = normalizarTexto(nome).indexOf(termoBusca);
    if (idx === -1) return nome;
    return (
      <>
        {nome.slice(0, idx)}
        <span style={{ color: "#C9A227", fontWeight: 700 }}>{nome.slice(idx, idx + texto.trim().length)}</span>
        {nome.slice(idx + texto.trim().length)}
      </>
    );
  };

  const corInput = dark ? inputStyleDark : inputStyle;

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <input
        type="text"
        style={{ ...corInput, width: "100%", boxSizing: "border-box" }}
        placeholder="Digite o nome do aluno..."
        value={texto}
        disabled={disabled}
        onChange={(e) => { setTexto(e.target.value); setAberto(true); if (!e.target.value) onSelecionar(""); }}
        onFocus={() => setAberto(true)}
        onBlur={() => setTimeout(() => setAberto(false), 150)}
      />
      {aberto && filtrados.length > 0 && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 20,
          background: dark ? "#1A1D24" : "#FFFFFF",
          border: dark ? "1px solid rgba(255,255,255,0.14)" : "1px solid #E7E2D6",
          borderRadius: 8, overflow: "hidden", maxHeight: 220, overflowY: "auto",
          boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
        }}>
          {filtrados.map((a) => (
            <div
              key={a.id}
              onMouseDown={(e) => { e.preventDefault(); escolher(a); }}
              style={{
                padding: "9px 12px", fontSize: 13.5, cursor: "pointer",
                color: dark ? "#F5F3EC" : "#1B2027",
                background: a.id === alunoId ? (dark ? "rgba(201,162,39,0.15)" : "rgba(201,162,39,0.10)") : "transparent",
              }}
            >
              {destacar(a.nome)}
            </div>
          ))}
        </div>
      )}
      {aberto && termoBusca && filtrados.length === 0 && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 20,
          background: dark ? "#1A1D24" : "#FFFFFF",
          border: dark ? "1px solid rgba(255,255,255,0.14)" : "1px solid #E7E2D6",
          borderRadius: 8, padding: "9px 12px", fontSize: 12.5,
          color: dark ? "#9B9891" : "#5A5648",
        }}>
          Nenhum aluno encontrado.
        </div>
      )}
    </div>
  );
}

function CheckinRetroativoProfessor({ data, save, prof, dark = true }) {
  const meusAlunos = data.alunos.filter((a) => a.professorId === prof.id);
  const [alunoId, setAlunoId] = useState(meusAlunos[0]?.id || "");
  const [dataSel, setDataSel] = useState(hoje());
  const [acao, setAcao] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState("");
  const [removendoId, setRemovendoId] = useState(null);
  const [confirmandoRemocaoId, setConfirmandoRemocaoId] = useState(null);

  const lancar = async () => {
    if (!alunoId || !dataSel || enviando) return;
    setEnviando(true);
    const agora = new Date();
    const [ano, mes, dia] = dataSel.split("-").map(Number);
    const dataHoraCheckin = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate(), agora.getHours(), agora.getMinutes(), agora.getSeconds());
    dataHoraCheckin.setFullYear(ano, mes - 1, dia);
    const checkin = { id: uid(), sessaoId: null, alunoId, dataHora: dataHoraCheckin.toISOString() };
    const alunos = data.alunos.map((a) => (a.id === alunoId ? { ...a, checkinsDesdeGraduacao: (a.checkinsDesdeGraduacao || 0) + 1 } : a));
    await save({ ...data, checkins: [...data.checkins, checkin], alunos });
    const dataFormatada = new Date(dataSel + "T00:00:00").toLocaleDateString("pt-BR");
    notificarPush("Check-in registrado!", `Seu professor confirmou sua presença do dia ${dataFormatada}.`, { alunoId });
    setEnviando(false);
    setAcao(false);
    setMsg("Check-in lançado com sucesso.");
    setTimeout(() => setMsg(""), 3000);
  };

  const removerCheckin = async (checkinId) => {
    if (removendoId) return;
    setRemovendoId(checkinId);
    const checkins = data.checkins.filter((c) => c.id !== checkinId);
    const alunos = data.alunos.map((a) => (a.id === alunoId ? { ...a, checkinsDesdeGraduacao: Math.max(0, (a.checkinsDesdeGraduacao || 0) - 1) } : a));
    await save({ ...data, checkins, alunos });
    setRemovendoId(null);
    setConfirmandoRemocaoId(null);
  };

  const checkinsDoAluno = [...data.checkins].filter((c) => c.alunoId === alunoId).sort((a, b) => b.dataHora.localeCompare(a.dataHora)).slice(0, 10);
  const corMuted = dark ? "#C9C4B4" : "#5A5648";
  const ghostBtn = dark ? { color: "#FFFFFF", border: "1px solid rgba(255,255,255,0.35)" } : undefined;

  return (
    <Card style={{ marginBottom: 16, ...(dark ? { background: "#1A1D24", border: "1px solid rgba(255,255,255,0.06)" } : {}) }}>
      <div style={dark ? { ...blockTitleStyle, color: "#FFFFFF" } : blockTitleStyle}>Gerenciar check-ins do aluno</div>
      <p style={{ fontSize: 12.5, color: corMuted, marginTop: 0 }}>Lance um check-in esquecido de um dia anterior, ou remova algum lançado por engano — os dois contam pra graduação e aparecem no histórico dele.</p>
      {meusAlunos.length === 0 ? (
        <Empty dark={dark}>Nenhum aluno vinculado a você ainda.</Empty>
      ) : (
        <>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 180px", minWidth: 160 }}>
              <Field label="Aluno" labelColor={dark ? "#C9C4B4" : undefined}>
                <BuscaAluno
                  alunos={meusAlunos}
                  alunoId={alunoId}
                  onSelecionar={(id) => { setAlunoId(id); setConfirmandoRemocaoId(null); }}
                  dark={dark}
                  disabled={enviando}
                />
              </Field>
            </div>
            <div style={{ flex: "0 1 170px", minWidth: 140 }}>
              <Field label="Data" labelColor={dark ? "#C9C4B4" : undefined}><input type="date" max={hoje()} style={{ ...(dark ? inputStyleDark : inputStyle), maxWidth: 170 }} value={dataSel} onChange={(e) => setDataSel(e.target.value)} disabled={enviando} /></Field>
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            {!acao ? (
              <Button variant="gold" icon={CalendarCheck} onClick={() => setAcao(true)}>Lançar check-in</Button>
            ) : (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12.5, color: corMuted, fontWeight: 600 }}>Confirma o lançamento?</span>
                <Button variant="gold" onClick={lancar} disabled={enviando}>{enviando ? "Enviando..." : "Sim"}</Button>
                <Button variant="ghost" style={ghostBtn} onClick={() => setAcao(false)} disabled={enviando}>Não</Button>
              </span>
            )}
          </div>
          {msg && <div style={{ marginTop: 8, fontSize: 12.5, color: dark ? "#7CD992" : "#1E7A34", fontWeight: 600 }}>{msg}</div>}

          <div style={{ marginTop: 16, paddingTop: 14, borderTop: dark ? "1px solid rgba(255,255,255,0.15)" : "1px solid #E7E2D6" }}>
            <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 8, color: dark ? "#FFFFFF" : "#12213B" }}>Check-ins recentes deste aluno</div>
            {checkinsDoAluno.length === 0 ? (
              <Empty dark={dark}>Nenhum check-in registrado ainda.</Empty>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {checkinsDoAluno.map((c) => (
                  <div key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#FBFAF7", borderRadius: 6, padding: "6px 10px", border: "1px solid #E7E2D6", color: "#1B2027" }}>
                    <span style={{ fontSize: 12.5 }}>{new Date(c.dataHora).toLocaleString("pt-BR")}</span>
                    {confirmandoRemocaoId === c.id ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 11.5, color: "#5A5648" }}>Remover?</span>
                        <Button variant="danger" onClick={() => removerCheckin(c.id)} disabled={removendoId === c.id}>{removendoId === c.id ? "..." : "Sim"}</Button>
                        <Button variant="ghost" onClick={() => setConfirmandoRemocaoId(null)} disabled={removendoId === c.id}>Não</Button>
                      </span>
                    ) : (
                      <Button variant="ghost" onClick={() => setConfirmandoRemocaoId(c.id)}>Remover</Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

function PresencaManualProfessor({ data, save, prof, dark = true }) {
  const turmasDisponiveis = data.turmas.filter((t) => !t.professorId || t.professorId === prof.id);
  const [turmaId, setTurmaId] = useState(turmasDisponiveis[0]?.id || "");
  const meusAlunos = data.alunos.filter((a) => a.professorId === prof.id);
  const sessaoAtiva = data.sessoes.find((s) => s.treinoId === turmaId && s.professorId === prof.id && s.ativa);

  const abrirSessao = async () => {
    const codigo = randomCode();
    const sessao = { id: uid(), treinoId: turmaId, professorId: prof.id, codigo, criadoEm: new Date().toISOString(), ativa: true };
    const sessoes = data.sessoes.map((s) => (s.professorId === prof.id && s.treinoId === turmaId ? { ...s, ativa: false } : s));
    await save({ ...data, sessoes: [...sessoes, sessao] });
  };
  const encerrarSessao = async () => {
    const sessoes = data.sessoes.map((s) => (s.id === sessaoAtiva.id ? { ...s, ativa: false } : s));
    await save({ ...data, sessoes });
  };
  const alternarPresenca = async (alunoId, presente) => {
    if (!sessaoAtiva) return;
    if (presente) await removerPresencaEm(data, save, sessaoAtiva.id, alunoId);
    else await marcarPresencaEm(data, save, sessaoAtiva.id, alunoId);
  };

  return (
    <Card style={{ marginBottom: 16, ...(dark ? { background: "#1A1D24", border: "1px solid rgba(255,255,255,0.06)" } : {}) }}>
      <div style={dark ? { ...blockTitleStyle, color: "#FFFFFF" } : blockTitleStyle}>Marcar presença manual</div>
      <p style={{ fontSize: 12.5, color: dark ? "#C9C4B4" : "#5A5648", marginTop: 0 }}>Para quando o aluno esqueceu o celular ou não conseguiu fazer o check-in por localização.</p>
      <Field label="Turma" labelColor={dark ? "#C9C4B4" : undefined}><select style={dark ? inputStyleDark : inputStyle} value={turmaId} onChange={(e) => setTurmaId(e.target.value)}>{turmasDisponiveis.map((t) => <option key={t.id} value={t.id} style={dark ? { background: "#1A1D24", color: "#F5F3EC" } : undefined}>{t.nome} — {t.horario}{t.horarioFim ? ` às ${t.horarioFim}` : ""}</option>)}</select></Field>
      {!sessaoAtiva ? (
        <div style={{ marginTop: 10 }}><Button variant="gold" icon={CalendarCheck} onClick={abrirSessao}>Abrir check-in desta turma agora</Button></div>
      ) : meusAlunos.length === 0 ? (
        <div style={{ marginTop: 10 }}><Empty dark={dark}>Nenhum aluno vinculado a você ainda.</Empty></div>
      ) : (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflowY: "auto" }}>
            {meusAlunos.map((a) => {
              const presente = data.checkins.some((c) => c.sessaoId === sessaoAtiva.id && c.alunoId === a.id);
              return (
                <div key={a.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", background: "#FBFAF7", borderRadius: 6, border: "1px solid #E7E2D6", color: "#1B2027" }}>
                  <span style={{ fontSize: 13 }}>{a.nome}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Tag ok={presente}>{presente ? "Presente" : "Ausente"}</Tag>
                    <Button variant="ghost" onClick={() => alternarPresenca(a.id, presente)}>{presente ? "Remover" : "Marcar presença"}</Button>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 10 }}><Button variant="danger" onClick={encerrarSessao}>Encerrar check-in desta turma</Button></div>
        </div>
      )}
    </Card>
  );
}

function AjustarAulasInline({ onAjustar }) {
  const [valor, setValor] = useState("");
  const [acao, setAcao] = useState(null);

  const pedirConfirmacao = (tipo) => { if (valor) setAcao(tipo); };
  const confirmar = () => {
    onAjustar(acao === "add" ? Number(valor) : -Number(valor));
    setValor("");
    setAcao(null);
  };

  if (acao) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 11.5, color: "#C9C4B4", fontWeight: 600 }}>{acao === "add" ? "Adicionar" : "Remover"} {valor} aula(s)?</span>
        <Button variant="gold" onClick={confirmar}>Sim</Button>
        <Button variant="ghost" style={{ color: "#FFFFFF", border: "1px solid rgba(255,255,255,0.2)" }} onClick={() => setAcao(null)}>Não</Button>
      </span>
    );
  }

  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      <input type="number" min="1" style={{ ...inputStyle, width: 64, padding: "6px 8px" }} value={valor} onChange={(e) => setValor(e.target.value)} placeholder="nº aulas" />
      <Button variant="ghost" style={{ color: "#FFFFFF", border: "1px solid rgba(255,255,255,0.2)" }} onClick={() => pedirConfirmacao("add")}>+ Aulas</Button>
      <Button variant="ghost" style={{ color: "#FFFFFF", border: "1px solid rgba(255,255,255,0.2)" }} onClick={() => pedirConfirmacao("remove")}>− Aulas</Button>
    </div>
  );
}

function RecadoMestreProfessor({ data, prof, dark = true }) {
  const [arquivo, setArquivo] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [msg, setMsg] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const inputCameraRef = useRef(null);
  const inputGaleriaRef = useRef(null);
  const meusAlunos = data.alunos.filter((a) => a.professorId === prof.id);

  const onArquivo = (e) => {
    const f = e.target.files?.[0];
    if (f) { setArquivo(f); setMsg(""); }
    e.target.value = "";
  };

  const enviar = async () => {
    if (!arquivo || meusAlunos.length === 0) return;
    setEnviando(true);
    setConfirmando(false);
    setMsg("");
    try {
      const url = await uploadArquivo("recados", arquivo, setProgresso);
      await pg.upsert("recados", [{ professor_id: prof.id, video_url: url, destinatarios_total: meusAlunos.length }]);
      notificarPush("Recado do Mestre 🥋", `Seu professor ${prof.nome} gravou uma mensagem pra você. Assista antes que suma!`, { professorAlunosId: prof.id });
      setMsg("Recado enviado! Cada aluno recebe a notificação, e o vídeo some assim que todos assistirem.");
      setArquivo(null);
    } catch (e) {
      setMsg("Não foi possível enviar: " + (e?.message || "tenta de novo."));
    }
    setEnviando(false);
    setProgresso(0);
  };

  const corTexto = dark ? "#F5F3EC" : undefined;
  const corMuted = dark ? "#C9C4B4" : "#5A5648";
  const corBadge = dark ? "rgba(255,255,255,0.04)" : "#FBFAF7";
  const corBorda = dark ? "1px solid rgba(255,255,255,0.06)" : "1px solid #E7E2D6";

  return (
    <Card style={{ marginBottom: 16, ...(dark ? { background: "#1A1D24", border: "1px solid rgba(255,255,255,0.06)" } : {}) }}>
      <div style={dark ? { ...blockTitleStyle, color: corTexto } : blockTitleStyle}>🎥 Recado do Mestre</div>
      <p style={{ fontSize: 12.5, color: corMuted, marginTop: 0 }}>
        Grave (ou escolha) um vídeo curto — chega como notificação pra todos os seus {meusAlunos.length} aluno(s), e some assim que cada um assistir. Ninguém consegue salvar de propósito, mas lembre que não existe forma de impedir 100% que alguém grave a tela.
      </p>
      {meusAlunos.length === 0 ? (
        <Empty dark={dark}>Nenhum aluno vinculado a você ainda.</Empty>
      ) : arquivo ? (
        <div>
          <div style={{ background: corBadge, border: corBorda, borderRadius: 8, padding: "8px 12px", fontSize: 12.5, color: corTexto, marginBottom: 10 }}>{arquivo.name}</div>
          {enviando ? (
            <div style={{ fontSize: 13, color: corMuted }}>Enviando... {progresso}%</div>
          ) : confirmando ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12.5, color: corMuted, fontWeight: 600 }}>Enviar pra {meusAlunos.length} aluno(s)?</span>
              <Button variant="vermelho" onClick={enviar}>Sim, enviar</Button>
              <Button variant="ghost" style={dark ? { color: "#FFFFFF", border: "1px solid rgba(255,255,255,0.2)" } : undefined} onClick={() => setConfirmando(false)}>Não</Button>
            </span>
          ) : (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button variant="vermelho" onClick={() => setConfirmando(true)}>Enviar recado</Button>
              <Button variant="ghost" style={dark ? { color: "#FFFFFF", border: "1px solid rgba(255,255,255,0.2)" } : undefined} onClick={() => setArquivo(null)}>Trocar vídeo</Button>
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button variant="vermelho" onClick={() => inputCameraRef.current?.click()}>🎥 Gravar agora</Button>
          <Button variant="ghost" style={dark ? { color: "#FFFFFF", border: "1px solid rgba(255,255,255,0.2)" } : undefined} onClick={() => inputGaleriaRef.current?.click()}>🖼️ Escolher da galeria</Button>
        </div>
      )}
      <input ref={inputCameraRef} type="file" accept="video/*" capture="user" hidden onChange={onArquivo} />
      <input ref={inputGaleriaRef} type="file" accept="video/*" hidden onChange={onArquivo} />
      {msg && <div style={{ marginTop: 8, fontSize: 12.5, fontWeight: 600, color: msg.includes("enviado") ? (dark ? "#4ADE80" : "#1E7A34") : (dark ? "#FF8A80" : "#B3261E") }}>{msg}</div>}
    </Card>
  );
}

function AlunosPertoDeGraduar({ data, prof, dark = true }) {
  const LIMITE_AULAS = 5;
  const candidatos = data.alunos
    .filter((a) => a.professorId === prof.id)
    .map((a) => ({ aluno: a, info: progressoGraduacaoInfo(data.faixas, a.faixaId, a.grau, a.checkinsDesdeGraduacao, categoriaEtaria(a.dataNascimento)) }))
    .filter((c) => c.info.restantes !== null && c.info.restantes <= LIMITE_AULAS)
    .sort((a, b) => a.info.restantes - b.info.restantes);

  if (candidatos.length === 0) return null;

  return (
    <Card style={{ marginBottom: 16, ...(dark ? { background: "#1A1D24", border: "1px solid rgba(255,255,255,0.06)" } : {}) }}>
      <div style={dark ? { ...blockTitleStyle, color: "#FFFFFF" } : blockTitleStyle}>Alunos perto de graduar</div>
      <p style={{ fontSize: 12.5, color: dark ? "#C9C4B4" : "#5A5648", marginTop: 0 }}>Faltam {LIMITE_AULAS} aula(s) ou menos para o próximo grau/faixa.</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {candidatos.map(({ aluno: a, info }) => (
          <div key={a.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#FBFAF7", borderRadius: 8, padding: "8px 12px", border: "1px solid #E7E2D6", gap: 8, flexWrap: "wrap", color: "#1B2027" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Avatar foto={a.foto} nome={a.nome} size={30} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>{a.nome}</span>
            </div>
            <Tag ok={info.restantes === 0}>{info.texto}</Tag>
          </div>
        ))}
      </div>
    </Card>
  );
}

function ContadorCheckinsAula({ data, dark = true, prof = null }) {
  const turmasDisponiveis = prof ? data.turmas.filter((t) => !t.professorId || t.professorId === prof.id) : data.turmas;
  const [turmaId, setTurmaId] = useState(turmasDisponiveis[0]?.id || "");
  const idsSessoesDaTurma = new Set(data.sessoes.filter((s) => s.treinoId === turmaId).map((s) => s.id));
  const total = data.checkins.filter((c) => idsSessoesDaTurma.has(c.sessaoId) && dataLocalDe(c.dataHora) === hoje()).length;
  return (
    <Card style={{ marginBottom: 16, ...(dark ? { background: "#1A1D24", border: "1px solid rgba(255,255,255,0.06)" } : {}) }}>
      <div style={dark ? { ...blockTitleStyle, color: "#FFFFFF" } : blockTitleStyle}>Check-ins da aula (hoje)</div>
      <div style={{ display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ flex: "0 1 220px", minWidth: 160 }}>
          <Field label="Selecionar turma" labelColor={dark ? "#C9C4B4" : undefined}>
            <select style={dark ? inputStyleDark : inputStyle} value={turmaId} onChange={(e) => setTurmaId(e.target.value)}>
              {turmasDisponiveis.map((t) => <option key={t.id} value={t.id} style={{ background: "#1A1D24", color: "#F5F3EC" }}>{t.nome} — {t.horario}{t.horarioFim ? ` às ${t.horarioFim}` : ""}</option>)}
            </select>
          </Field>
        </div>
        <div style={{ fontFamily: "Oswald", fontSize: 32, fontWeight: 700, color: dark ? "#C9A227" : "#12213B" }}>{total}</div>
      </div>
    </Card>
  );
}

function RelatorioCheckinsProfessor({ data, prof, dark = true }) {
  const [dataSel, setDataSel] = useState(hoje());
  const [erro, setErro] = useState("");
  const meusAlunos = data.alunos.filter((a) => a.professorId === prof.id);
  return (
    <Card style={{ marginBottom: 16, ...(dark ? { background: "#1A1D24", border: "1px solid rgba(255,255,255,0.06)" } : {}) }}>
      <div style={dark ? { ...blockTitleStyle, color: "#FFFFFF" } : blockTitleStyle}>Relatório de check-ins por data</div>
      <p style={{ fontSize: 12.5, color: dark ? "#C9C4B4" : "#5A5648", marginTop: 0 }}>Escolha uma data e veja quais dos seus alunos fizeram check-in naquele dia — abre pronto para salvar como PDF.</p>
      {meusAlunos.length === 0 ? (
        <Empty dark={dark}>Nenhum aluno vinculado a você ainda. Peça para a administração te vincular no cadastro do aluno.</Empty>
      ) : (
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ flex: "0 1 180px", minWidth: 140 }}>
            <Field label="Data" labelColor={dark ? "#C9C4B4" : undefined}><input type="date" style={{ ...(dark ? inputStyleDark : inputStyle), maxWidth: 170 }} value={dataSel} onChange={(e) => setDataSel(e.target.value)} /></Field>
          </div>
          <Button icon={CalendarCheck} variant="gold" onClick={() => { setErro(""); gerarRelatorioCheckins(data, dataSel, setErro, meusAlunos, prof.nome); }}>Gerar relatório (PDF)</Button>
        </div>
      )}
      {erro && <div style={{ marginTop: 8, fontSize: 12.5, color: dark ? "#FF8A80" : "#B3261E", fontWeight: 600 }}>{erro}</div>}
    </Card>
  );
}

function RelatorioMensalProfessor({ data, prof, dark = true }) {
  const [mes, setMes] = useState(() => new Date().toISOString().slice(0, 7));
  const [erro, setErro] = useState("");
  const meusAlunos = data.alunos.filter((a) => a.professorId === prof.id);
  return (
    <Card style={{ marginBottom: 16, ...(dark ? { background: "#1A1D24", border: "1px solid rgba(255,255,255,0.06)" } : {}) }}>
      <div style={dark ? { ...blockTitleStyle, color: "#FFFFFF" } : blockTitleStyle}>Meu relatório financeiro</div>
      <p style={{ fontSize: 12.5, color: dark ? "#C9C4B4" : "#5A5648", marginTop: 0 }}>
        Gera o relatório em PDF só dos seus {meusAlunos.length} aluno(s) vinculado(s) — nenhum outro professor vê este relatório.
      </p>
      {meusAlunos.length === 0 ? (
        <Empty dark={dark}>Nenhum aluno vinculado a você ainda. Peça para a administração te vincular no cadastro do aluno.</Empty>
      ) : (
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ flex: "0 1 180px", minWidth: 140 }}>
            <Field label="Mês do relatório" labelColor={dark ? "#C9C4B4" : undefined}><input type="month" style={{ ...(dark ? inputStyleDark : inputStyle), maxWidth: 170 }} value={mes} onChange={(e) => setMes(e.target.value)} /></Field>
          </div>
          <Button icon={CreditCard} variant="gold" onClick={() => { setErro(""); gerarRelatorioMensal(data, mes, setErro, meusAlunos, prof.nome); }}>Gerar relatório (PDF)</Button>
        </div>
      )}
      {erro && <div style={{ marginTop: 8, fontSize: 12.5, color: "#FF8A80", fontWeight: 600 }}>{erro}</div>}
    </Card>
  );
}

function FinanceiroAdmin({ data, save }) {
  const darBaixa = (alunoId) => darBaixaEm(data, save, alunoId);
  const desfazerBaixa = (alunoId) => desfazerBaixaEm(data, save, alunoId);
  const pendentes = data.alunos.filter((a) => !statusPagamento(a, data.planos).emDia);
  const pagamentosRecentes = data.alunos.flatMap((a) => (a.pagamentos || []).map((p) => ({ ...p, alunoId: a.id, alunoNome: a.nome }))).sort((x, y) => y.data.localeCompare(x.data)).slice(0, 40);
  const ultimoPagamentoIdPorAluno = {};
  data.alunos.forEach((a) => {
    const pags = [...(a.pagamentos || [])].sort((x, y) => x.data.localeCompare(y.data));
    if (pags.length) ultimoPagamentoIdPorAluno[a.id] = pags[pags.length - 1].id;
  });

  return (
    <div>
      <RelatorioMensal data={data} />
      <PagamentosChart data={data} dark />

      <div style={{ ...blockTitleStyle, color: "#F5F3EC" }}>Pagamentos pendentes</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
        {pendentes.map((a) => {
          const { plano, vencimento } = statusPagamento(a, data.planos);
          return (
            <Card dark key={a.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 12, flexWrap: "wrap", gap: 8 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, color: "#F5F3EC" }}>{a.nome}</div>
                <div style={{ fontSize: 12, color: "#9B9891" }}>{plano?.nome || "sem plano"} · R$ {plano?.valor ?? 0} {vencimento && `· venceu em ${new Date(vencimento + "T00:00:00").toLocaleDateString("pt-BR")}`}</div>
              </div>
              <Button variant="gold" onClick={() => darBaixa(a.id)}>Dar baixa</Button>
            </Card>
          );
        })}
        {pendentes.length === 0 && <Empty dark>Nenhum pagamento pendente 🎉</Empty>}
      </div>

      <div style={{ ...blockTitleStyle, color: "#F5F3EC" }}>Pagamentos realizados (recentes)</div>
      <p style={{ fontSize: 12, color: "#9B9891", marginTop: 0 }}>Deu baixa por engano? Só o pagamento mais recente de cada aluno pode ser desfeito.</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {pagamentosRecentes.map((p) => (
          <Card dark key={p.id} style={{ padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <div>
              <span style={{ fontWeight: 600, fontSize: 13.5, color: "#F5F3EC" }}>{p.alunoNome}</span>
              <span style={{ fontSize: 13, color: "#9B9891" }}> · R$ {p.valor} · {new Date(p.data + "T00:00:00").toLocaleDateString("pt-BR")}</span>
            </div>
            {ultimoPagamentoIdPorAluno[p.alunoId] === p.id && (
              <ConfirmDelete onConfirm={() => desfazerBaixa(p.alunoId)} />
            )}
          </Card>
        ))}
        {pagamentosRecentes.length === 0 && <Empty dark>Nenhum pagamento registrado ainda.</Empty>}
      </div>
    </div>
  );
}

function AvisoForm({ onSave, onCancel }) {
  const [titulo, setTitulo] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [tipo, setTipo] = useState("Aviso");
  const [dataEvento, setDataEvento] = useState("");
  const submit = () => { if (!titulo.trim()) return; onSave({ titulo, mensagem, tipo, dataEvento: dataEvento || null }); };
  return (
    <Card style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 10 }}>
          <Field label="Tipo">
            <select style={inputStyle} value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option>Aviso</option><option>Notícia</option><option>Evento</option>
            </select>
          </Field>
          {tipo === "Evento" && <Field label="Data do evento"><input type="date" style={inputStyle} value={dataEvento} onChange={(e) => setDataEvento(e.target.value)} /></Field>}
        </div>
        <Field label="Título"><input style={inputStyle} value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex: Não haverá aula na sexta-feira" /></Field>
        <Field label="Mensagem"><textarea style={{ ...inputStyle, minHeight: 90, resize: "vertical" }} value={mensagem} onChange={(e) => setMensagem(e.target.value)} /></Field>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <ConfirmButton onConfirm={submit}>Publicar</ConfirmButton>
        <Button variant="ghost" icon={X} onClick={onCancel}>Cancelar</Button>
      </div>
    </Card>
  );
}

function AvisosProfessor({ data, save, prof, dark = false }) {
  const [novo, setNovo] = useState(false);
  const avisosVisiveis = [...(data.avisos || [])]
    .filter((a) => !a.professorId || a.professorId === prof.id)
    .sort((a, b) => (b.criadoEm || "").localeCompare(a.criadoEm || ""));

  const adicionar = async (form) => {
    const aviso = { id: uid(), criadoEm: new Date().toISOString(), professorId: prof.id, ...form };
    await save({ ...data, avisos: [...(data.avisos || []), aviso] });
    notificarPush(aviso.titulo, aviso.mensagem || "", { professorAlunosId: prof.id });
    setNovo(false);
  };
  const remover = async (id) => { await save({ ...data, avisos: (data.avisos || []).filter((a) => a.id !== id) }); };

  return (
    <div>
      <p style={{ fontSize: 12.5, color: dark ? "#C9C4B4" : "#5A5648", marginTop: 0 }}>Avisos que você publicar aqui vão só pros seus alunos vinculados — alunos de outros professores não recebem.</p>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <Button icon={Plus} variant={dark ? "vermelho" : "primary"} onClick={() => setNovo(true)}>Novo aviso</Button>
      </div>
      {novo && <AvisoForm onCancel={() => setNovo(false)} onSave={adicionar} />}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {avisosVisiveis.map((a) => (
          <Card key={a.id} style={{ padding: 12, ...(dark ? { background: "#1A1D24", border: "1px solid rgba(255,255,255,0.06)" } : {}) }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
              <div>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: "#C9A227", textTransform: "uppercase" }}>
                  {a.tipo || "Aviso"}{!a.professorId ? " · Geral (todos)" : a.professorId === prof.id ? " · Só seus alunos" : ""}
                </span>
                <div style={{ fontWeight: 700, fontSize: 14, color: dark ? "#FFFFFF" : undefined }}>{a.titulo}</div>
                {a.mensagem && <div style={{ fontSize: 12.5, color: dark ? "#C9C4B4" : "#5A5648", marginTop: 2 }}>{a.mensagem}</div>}
                {a.dataEvento && <div style={{ fontSize: 12, color: dark ? "#C9A227" : "#12213B", fontWeight: 600, marginTop: 4 }}>Data do evento: {new Date(a.dataEvento + "T00:00:00").toLocaleDateString("pt-BR")}</div>}
                <div style={{ fontSize: 11, color: "#8A8574", marginTop: 4 }}>{new Date(a.criadoEm).toLocaleString("pt-BR")}</div>
              </div>
              {a.professorId === prof.id && <ConfirmDelete onConfirm={() => remover(a.id)} />}
            </div>
          </Card>
        ))}
        {avisosVisiveis.length === 0 && <Empty dark={dark}>Nenhum aviso publicado ainda.</Empty>}
      </div>
    </div>
  );
}

function AvisosAdmin({ data, save }) {
  const [novo, setNovo] = useState(false);
  const avisos = [...(data.avisos || [])].sort((a, b) => (b.criadoEm || "").localeCompare(a.criadoEm || ""));

  const adicionar = async (form) => {
    const aviso = { id: uid(), criadoEm: new Date().toISOString(), ...form };
    await save({ ...data, avisos: [...(data.avisos || []), aviso] });
    notificarPush(aviso.titulo, aviso.mensagem || "");
    setNovo(false);
  };
  const remover = async (id) => { await save({ ...data, avisos: (data.avisos || []).filter((a) => a.id !== id) }); };

  return (
    <div>
      <p style={{ fontSize: 12.5, color: "#9B9891", marginTop: 0 }}>Avisos, notícias e próximos eventos publicados aqui aparecem na área do aluno, com notificação no aparelho quando o app é aberto.</p>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <Button icon={Plus} onClick={() => setNovo(true)}>Novo aviso</Button>
      </div>
      {novo && <AvisoForm onCancel={() => setNovo(false)} onSave={adicionar} />}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {avisos.map((a) => (
          <Card dark key={a.id} style={{ padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
              <div>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: "#C9A227", textTransform: "uppercase" }}>
                  {a.tipo || "Aviso"}{a.professorId ? ` · Prof. ${data.professores.find((p) => p.id === a.professorId)?.nome || "?"}` : " · Todos"}
                </span>
                <div style={{ fontWeight: 700, fontSize: 14, color: "#F5F3EC" }}>{a.titulo}</div>
                {a.mensagem && <div style={{ fontSize: 12.5, color: "#9B9891", marginTop: 2 }}>{a.mensagem}</div>}
                {a.dataEvento && <div style={{ fontSize: 12, color: "#C9A227", fontWeight: 600, marginTop: 4 }}>Data do evento: {new Date(a.dataEvento + "T00:00:00").toLocaleDateString("pt-BR")}</div>}
                <div style={{ fontSize: 11, color: "#9B9891", marginTop: 4 }}>{new Date(a.criadoEm).toLocaleString("pt-BR")}</div>
              </div>
              <ConfirmDelete onConfirm={() => remover(a.id)} />
            </div>
          </Card>
        ))}
        {avisos.length === 0 && <Empty dark>Nenhum aviso publicado ainda.</Empty>}
      </div>
    </div>
  );
}

function youtubeEmbedUrl(url) {
  if (!url) return null;
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([\w-]{11})/);
  return match ? `https://www.youtube.com/embed/${match[1]}` : null;
}

function VideoForm({ unidades, onSave, onCancel }) {
  const [titulo, setTitulo] = useState("");
  const [legenda, setLegenda] = useState("");
  const [url, setUrl] = useState("");
  const [unidadeId, setUnidadeId] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [erro, setErro] = useState("");
  const fileRef = useRef(null);

  const onArquivo = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErro("");
    setEnviando(true);
    setProgresso(0);
    try {
      const publicUrl = await uploadArquivo("videos", file, setProgresso);
      setUrl(publicUrl);
    } catch (err) {
      setErro(err?.message || "Falha ao enviar o vídeo.");
    } finally {
      setEnviando(false);
    }
  };

  const submit = () => { if (!titulo.trim() || !url.trim()) return; onSave({ titulo, legenda, url, unidadeId }); };

  return (
    <Card style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Field label="Título"><input style={inputStyle} value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex: Raspagem básica da guarda fechada" /></Field>
        <Field label="Legenda (opcional)"><input style={inputStyle} value={legenda} onChange={(e) => setLegenda(e.target.value)} placeholder="Ex: Atenção ao ângulo do quadril" /></Field>
        <Field label="Unidade">
          <select style={inputStyle} value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)}>
            <option value="">Todas as unidades</option>
            {(unidades || []).map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </select>
        </Field>
        <Field label="Link do YouTube">
          <input style={inputStyle} value={url.startsWith("http") && !url.includes("/storage/v1/") ? url : ""} onChange={(e) => setUrl(e.target.value)} placeholder="https://youtube.com/watch?v=..." />
        </Field>
        <div style={{ textAlign: "center", fontSize: 11.5, color: "#8A8574" }}>— ou —</div>
        <Field label="Enviar arquivo MP4">
          <Button variant="ghost" onClick={() => fileRef.current?.click()} disabled={enviando}>{enviando ? `Enviando... ${progresso}%` : "Escolher arquivo MP4"}</Button>
          <input ref={fileRef} type="file" accept="video/mp4,video/webm,video/ogg" hidden onChange={onArquivo} />
        </Field>
        {url.includes("/storage/v1/") && <div style={{ fontSize: 12, color: "#1E7A34", fontWeight: 600 }}>Vídeo enviado com sucesso ✓</div>}
        {erro && <div style={{ fontSize: 12, color: "#B3261E" }}>{erro}</div>}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <ConfirmButton onConfirm={submit}>Publicar</ConfirmButton>
        <Button variant="ghost" icon={X} onClick={onCancel}>Cancelar</Button>
      </div>
    </Card>
  );
}

function VideosProfessor({ data, save, prof }) {
  const [novo, setNovo] = useState(false);
  const videosVisiveis = [...(data.videos || [])]
    .filter((v) => !v.professorId || v.professorId === prof.id)
    .sort((a, b) => (b.criadoEm || "").localeCompare(a.criadoEm || ""));

  const adicionar = async (form) => {
    const video = { id: uid(), criadoEm: new Date().toISOString(), professorId: prof.id, ...form };
    await save({ ...data, videos: [...(data.videos || []), video] });
    setNovo(false);
  };
  const remover = async (id) => { await save({ ...data, videos: (data.videos || []).filter((v) => v.id !== id) }); };

  return (
    <div>
      <p style={{ fontSize: 12.5, color: "#9B9891", marginTop: 0 }}>Vídeos que você publicar aqui aparecem só pros seus alunos vinculados — cole um link do YouTube ou envie um arquivo MP4 direto. Também dá pra vincular a uma unidade específica.</p>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <Button icon={Plus} onClick={() => setNovo(true)}>Novo vídeo</Button>
      </div>
      {novo && <VideoForm unidades={data.unidades} onCancel={() => setNovo(false)} onSave={adicionar} />}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {videosVisiveis.map((v) => {
          const unidadeDoVideo = (data.unidades || []).find((u) => u.id === v.unidadeId);
          return (
          <Card dark key={v.id} style={{ padding: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#C9A227", textTransform: "uppercase" }}>{!v.professorId ? "Geral (todos)" : "Só seus alunos"}{unidadeDoVideo ? ` · ${unidadeDoVideo.nome}` : ""}</span>
              <div style={{ fontWeight: 700, fontSize: 14, color: "#F5F3EC" }}>{v.titulo}</div>
              {v.legenda && <div style={{ fontSize: 12, color: "#9B9891" }}>{v.legenda}</div>}
              <a href={v.url} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, color: "#C9A227" }}>{v.url.includes("/storage/v1/") ? "Arquivo enviado" : v.url}</a>
            </div>
            {v.professorId === prof.id && <ConfirmDelete onConfirm={() => remover(v.id)} />}
          </Card>
          );
        })}
        {videosVisiveis.length === 0 && <Empty dark>Nenhum vídeo publicado ainda.</Empty>}
      </div>
    </div>
  );
}

function VideosAdmin({ data, save }) {
  const [novo, setNovo] = useState(false);
  const videos = [...(data.videos || [])].sort((a, b) => (b.criadoEm || "").localeCompare(a.criadoEm || ""));

  const adicionar = async (form) => {
    const video = { id: uid(), criadoEm: new Date().toISOString(), ...form };
    await save({ ...data, videos: [...(data.videos || []), video] });
    setNovo(false);
  };
  const remover = async (id) => { await save({ ...data, videos: (data.videos || []).filter((v) => v.id !== id) }); };
  const atualizarUnidade = async (id, unidadeId) => { const videos = data.videos.map((v) => (v.id === id ? { ...v, unidadeId } : v)); await save({ ...data, videos }); };

  return (
    <div>
      <p style={{ fontSize: 12.5, color: "#9B9891", marginTop: 0 }}>Vídeos de técnicas e posições para os alunos assistirem dentro do próprio app — cole um link do YouTube ou envie um arquivo MP4 direto. Vincule a uma unidade pra ele aparecer só pros alunos de lá.</p>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <Button icon={Plus} onClick={() => setNovo(true)}>Novo vídeo</Button>
      </div>
      {novo && <VideoForm unidades={data.unidades} onCancel={() => setNovo(false)} onSave={adicionar} />}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {videos.map((v) => (
          <Card dark key={v.id} style={{ padding: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#C9A227", textTransform: "uppercase" }}>
                {v.professorId ? `Prof. ${data.professores.find((p) => p.id === v.professorId)?.nome || "?"}` : "Todos"}
              </span>
              <div style={{ fontWeight: 700, fontSize: 14, color: "#F5F3EC" }}>{v.titulo}</div>
              {v.legenda && <div style={{ fontSize: 12, color: "#9B9891" }}>{v.legenda}</div>}
              <a href={v.url} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, color: "#C9A227" }}>{v.url.includes("/storage/v1/") ? "Arquivo enviado" : v.url}</a>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <select style={{ ...inputStyleDark, width: 160 }} value={v.unidadeId || ""} onChange={(e) => atualizarUnidade(v.id, e.target.value)}>
                <option value="" style={{ background: "#1A1D24", color: "#F5F3EC" }}>Todas as unidades</option>
                {(data.unidades || []).map((u) => <option key={u.id} value={u.id} style={{ background: "#1A1D24", color: "#F5F3EC" }}>{u.nome}</option>)}
              </select>
              <ConfirmDelete onConfirm={() => remover(v.id)} />
            </div>
          </Card>
        ))}
        {videos.length === 0 && <Empty dark>Nenhum vídeo publicado ainda.</Empty>}
      </div>
    </div>
  );
}

function ProdutoForm({ onSave, onCancel }) {
  const [nome, setNome] = useState("");
  const [valor, setValor] = useState("");
  const [fotos, setFotos] = useState([]);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const inputCameraRef = useRef(null);
  const inputGaleriaRef = useRef(null);

  const enviarArquivos = async (files) => {
    setErro("");
    setEnviando(true);
    try {
      for (const file of files) {
        const url = await uploadArquivo("produtos", file);
        setFotos((prev) => [...prev, url]);
      }
    } catch (err) {
      setErro(err?.message || "Falha ao enviar a foto.");
    }
    setEnviando(false);
  };

  const onArquivo = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (files.length) enviarArquivos(files);
  };

  const removerFoto = (url) => {
    setFotos((prev) => prev.filter((f) => f !== url));
    removerArquivo("produtos", url);
  };

  const submit = () => {
    if (!nome.trim() || !valor || Number(valor) <= 0) return;
    onSave({ nome: nome.trim(), valor: Number(valor), fotos, ativo: true });
  };

  return (
    <Card dark style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Field label="Nome do produto" labelColor="#C9C4B4"><input style={inputStyleDark} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Kimono Cia Paulista A2" /></Field>
        <Field label="Valor (R$)" labelColor="#C9C4B4"><input type="number" min="0" step="0.01" style={inputStyleDark} value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" /></Field>
        <div>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#C9C4B4", textTransform: "uppercase", letterSpacing: 0.4 }}>Fotos</span>
          {fotos.length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              {fotos.map((url) => (
                <div key={url} style={{ position: "relative" }}>
                  <img src={url} alt="" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)" }} />
                  <button onClick={() => removerFoto(url)} style={{ position: "absolute", top: -6, right: -6, background: "#B3261E", border: "2px solid #1A1D24", borderRadius: "50%", width: 20, height: 20, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <Button variant="ghost" style={{ color: "#FFFFFF", border: "1px solid rgba(255,255,255,0.2)" }} onClick={() => inputCameraRef.current?.click()} disabled={enviando}>📷 Tirar foto</Button>
            <Button variant="ghost" style={{ color: "#FFFFFF", border: "1px solid rgba(255,255,255,0.2)" }} onClick={() => inputGaleriaRef.current?.click()} disabled={enviando}>🖼️ Escolher da galeria</Button>
          </div>
          <input ref={inputCameraRef} type="file" accept="image/*" capture="environment" hidden onChange={onArquivo} />
          <input ref={inputGaleriaRef} type="file" accept="image/*" multiple hidden onChange={onArquivo} />
          {enviando && <div style={{ fontSize: 12, color: "#C9C4B4", marginTop: 6 }}>Enviando foto...</div>}
        </div>
        {erro && <div style={{ fontSize: 12, color: "#FF8A80" }}>{erro}</div>}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <ConfirmButton dark onConfirm={submit}>Publicar</ConfirmButton>
        <Button variant="ghost" icon={X} style={{ color: "#FFFFFF", border: "1px solid rgba(255,255,255,0.2)" }} onClick={onCancel}>Cancelar</Button>
      </div>
    </Card>
  );
}

function ProdutosProfessor({ data, save, prof }) {
  const [novo, setNovo] = useState(false);
  const meusProdutos = [...(data.produtos || [])]
    .filter((p) => p.professorId === prof.id)
    .sort((a, b) => (b.criadoEm || "").localeCompare(a.criadoEm || ""));

  const adicionar = async (form) => {
    const produto = { id: uid(), criadoEm: new Date().toISOString(), professorId: prof.id, ...form };
    await save({ ...data, produtos: [...(data.produtos || []), produto] });
    setNovo(false);
  };
  const remover = async (id) => {
    const produto = (data.produtos || []).find((p) => p.id === id);
    (produto?.fotos || []).forEach((url) => removerArquivo("produtos", url));
    await save({ ...data, produtos: (data.produtos || []).filter((p) => p.id !== id) });
  };

  return (
    <div>
      <p style={{ fontSize: 12.5, color: "#9B9891", marginTop: 0 }}>Produtos que você cadastrar aqui aparecem pros seus alunos vinculados verem (kimonos, bonés, patches etc.) — é só pra divulgar, a venda combina direto com o aluno.</p>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <Button icon={Plus} onClick={() => setNovo(true)}>Novo produto</Button>
      </div>
      {novo && <ProdutoForm onCancel={() => setNovo(false)} onSave={adicionar} />}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {meusProdutos.map((p) => (
          <Card dark key={p.id} style={{ padding: 12, display: "flex", alignItems: "center", gap: 10 }}>
            {p.fotos?.[0] ? (
              <img src={p.fotos[0]} alt="" style={{ width: 52, height: 52, objectFit: "cover", borderRadius: 8, flexShrink: 0 }} />
            ) : (
              <div style={{ width: 52, height: 52, borderRadius: 8, background: "rgba(255,255,255,0.06)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>🛍️</div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: "#F5F3EC" }}>{p.nome}</div>
              <div style={{ fontSize: 13, color: "#C9A227", fontWeight: 600 }}>R$ {p.valor.toFixed(2)}</div>
            </div>
            <ConfirmDelete onConfirm={() => remover(p.id)} />
          </Card>
        ))}
        {meusProdutos.length === 0 && <Empty dark>Nenhum produto cadastrado ainda.</Empty>}
      </div>
    </div>
  );
}

function TurmasProfessor({ data, save, prof }) {
  const [nova, setNova] = useState(false);
  const [editando, setEditando] = useState(null);
  const minhasTurmas = data.turmas.filter((t) => t.professorId === prof.id);
  const unidadeDoProfessor = (data.unidades || []).find((u) => u.id === prof.unidadeId) || null;

  const adicionar = async (form) => {
    const turma = { id: uid(), ...form, professorId: prof.id };
    await save({ ...data, turmas: [...data.turmas, turma] });
    setNova(false);
  };
  const editar = async (id, form) => {
    const turmas = data.turmas.map((t) => (t.id === id ? { ...t, ...form } : t));
    await save({ ...data, turmas });
    setEditando(null);
  };
  const remover = async (id) => {
    await save({ ...data, turmas: data.turmas.filter((t) => t.id !== id) });
  };

  return (
    <div>
      <p style={{ fontSize: 12.5, color: "#9B9891", marginTop: 0 }}>Turmas que você cadastrar aqui aparecem na grade de horários dos seus alunos vinculados, e você pode iniciar o check-in delas normalmente.</p>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <Button icon={Plus} onClick={() => setNova(true)}>Nova turma</Button>
      </div>
      {nova && <TurmaForm unidadeFixa={unidadeDoProfessor} onCancel={() => setNova(false)} onSave={adicionar} />}
      {editando && <TurmaForm unidadeFixa={unidadeDoProfessor} initial={editando} onCancel={() => setEditando(null)} onSave={(form) => editar(editando.id, form)} />}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {minhasTurmas.map((t) => {
          const unidadeDaTurma = (data.unidades || []).find((u) => u.id === t.unidadeId);
          return (
            <Card dark key={t.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 12, flexWrap: "wrap", gap: 8 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, color: "#F5F3EC" }}>{t.nome}</div>
                <div style={{ fontSize: 12.5, color: "#9B9891" }}>{formatDias(t.dias)} · {t.horario}{t.horarioFim ? ` às ${t.horarioFim}` : ""}</div>
                <div style={{ fontSize: 11.5, color: "#9B9891" }}>Unidade: {unidadeDaTurma ? unidadeDaTurma.nome : "QG (padrão)"}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Button variant="ghost" onClick={() => setEditando(t)} style={{ color: "#F5F3EC", border: "1px solid rgba(255,255,255,0.2)" }}>Editar</Button>
                <ConfirmDelete onConfirm={() => remover(t.id)} />
              </div>
            </Card>
          );
        })}
        {minhasTurmas.length === 0 && <Empty dark>Nenhuma turma cadastrada ainda.</Empty>}
      </div>
    </div>
  );
}

function ProdutosAluno({ produtos }) {
  const [aberto, setAberto] = useState(false);
  const [selecionadoId, setSelecionadoId] = useState(null);
  const lista = [...produtos].sort((a, b) => (b.criadoEm || "").localeCompare(a.criadoEm || ""));
  const selecionado = lista.find((p) => p.id === selecionadoId);

  return (
    <Card style={{ marginBottom: 14, background: "#1A1D24", border: "1px solid rgba(255,255,255,0.06)" }}>
      <button onClick={() => setAberto((v) => !v)} style={{ width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ ...blockTitleStyle, color: "#FFFFFF" }}>🛍️ Produtos à venda</span>
        <span style={{ fontSize: 18, color: "#C9A227" }}>{aberto ? "−" : "+"}</span>
      </button>
      {aberto && (
        <div style={{ marginTop: 10 }}>
          {selecionado ? (
            <div>
              <button onClick={() => setSelecionadoId(null)} style={{ background: "none", border: "none", color: "#C9A227", fontSize: 12.5, fontWeight: 600, cursor: "pointer", marginBottom: 10, padding: 0 }}>← Voltar para a lista</button>
              {selecionado.fotos?.length > 0 && (
                <div style={{ display: "flex", gap: 8, overflowX: "auto", marginBottom: 10 }}>
                  {selecionado.fotos.map((url) => (
                    <img key={url} src={url} alt="" style={{ width: 140, height: 140, objectFit: "cover", borderRadius: 10, flexShrink: 0 }} />
                  ))}
                </div>
              )}
              <div style={{ fontWeight: 700, fontSize: 15, color: "#F5F3EC" }}>{selecionado.nome}</div>
              <div style={{ fontSize: 15, color: "#C9A227", fontWeight: 700, marginTop: 2 }}>R$ {selecionado.valor.toFixed(2)}</div>
            </div>
          ) : lista.length === 0 ? (
            <Empty dark>Nenhum produto à venda no momento.</Empty>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {lista.map((p) => (
                <button key={p.id} onClick={() => setSelecionadoId(p.id)} style={{ textAlign: "left", background: "#FBFAF7", border: "1px solid #E7E2D6", borderRadius: 8, padding: "10px 12px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}>
                  {p.fotos?.[0] ? (
                    <img src={p.fotos[0]} alt="" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6, flexShrink: 0 }} />
                  ) : (
                    <div style={{ width: 40, height: 40, borderRadius: 6, background: "#EFEBDF", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🛍️</div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13.5, color: "#1B2027" }}>{p.nome}</div>
                    <div style={{ fontSize: 12, color: "#8A8574", fontWeight: 600 }}>R$ {p.valor.toFixed(2)}</div>
                  </div>
                  <ChevronRight size={16} color="#8A8574" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function RegrasTatameAluno({ imagem }) {
  const [aberto, setAberto] = useState(false);
  if (!imagem) return null;
  return (
    <Card style={{ marginBottom: 14, background: "#1A1D24", border: "1px solid rgba(255,255,255,0.06)" }}>
      <button onClick={() => setAberto((v) => !v)} style={{ width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ ...blockTitleStyle, color: "#FFFFFF" }}>📜 Regras do tatame</span>
        <span style={{ fontSize: 18, color: "#C9A227" }}>{aberto ? "−" : "+"}</span>
      </button>
      {aberto && (
        <div style={{ marginTop: 10 }}>
          <img src={imagem} alt="Regras do tatame" style={{ width: "100%", borderRadius: 10, display: "block" }} />
        </div>
      )}
    </Card>
  );
}

function GolpesProibidosCard({ pdf, pdfNome }) {
  if (!pdf) return null;
  return (
    <Card style={{ marginBottom: 14, background: "#1A1D24", border: "1px solid rgba(255,255,255,0.06)" }}>
      <div style={{ ...blockTitleStyle, color: "#FFFFFF" }}>🚫 Golpes proibidos</div>
      <a href={pdf} target="_blank" rel="noreferrer" onClick={(e) => { e.preventDefault(); abrirPdfDataUrl(pdf); }} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "#C9A227" }}>
        📄 Abrir PDF ({pdfNome || "golpes-proibidos.pdf"})
      </a>
    </Card>
  );
}

function UnidadeForm({ initial, onSave, onCancel }) {
  const i = initial || {};
  const [nome, setNome] = useState(i.nome || "");
  const [endereco, setEndereco] = useState(i.endereco || "");
  const [latitude, setLatitude] = useState(i.latitude ?? "");
  const [longitude, setLongitude] = useState(i.longitude ?? "");
  const [raioCheckin, setRaioCheckin] = useState(i.raioCheckin ?? 150);
  const [chavePix, setChavePix] = useState(i.chavePix || "");

  const usarLocalizacaoAtual = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      setLatitude(pos.coords.latitude);
      setLongitude(pos.coords.longitude);
    });
  };

  const submit = () => {
    if (!nome.trim()) return;
    onSave({
      nome, endereco, chavePix,
      latitude: latitude === "" ? null : Number(latitude),
      longitude: longitude === "" ? null : Number(longitude),
      raioCheckin: raioCheckin === "" ? null : Number(raioCheckin),
    });
  };

  return (
    <Card style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Field label="Nome da unidade"><input style={inputStyle} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Unidade Norte, Personal, Aula na academia X" /></Field>
        <Field label="Endereço (opcional)"><input style={inputStyle} value={endereco} onChange={(e) => setEndereco(e.target.value)} /></Field>
        <Field label="Chave PIX desta unidade (opcional)"><input style={inputStyle} value={chavePix} onChange={(e) => setChavePix(e.target.value)} placeholder="Se vazio, usa a chave PIX geral da academia" /></Field>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)", gap: 10 }}>
          <Field label="Latitude"><input type="number" step="any" style={inputStyle} value={latitude} onChange={(e) => setLatitude(e.target.value)} /></Field>
          <Field label="Longitude"><input type="number" step="any" style={inputStyle} value={longitude} onChange={(e) => setLongitude(e.target.value)} /></Field>
          <Field label="Raio permitido (m)"><input type="number" min="10" style={inputStyle} value={raioCheckin} onChange={(e) => setRaioCheckin(e.target.value)} /></Field>
        </div>
        <div>
          <Button variant="ghost" onClick={usarLocalizacaoAtual}>Usar minha localização atual</Button>
          <p style={{ fontSize: 11.5, color: "#8A8574", marginTop: 6 }}>Deixe latitude e longitude em branco para uma unidade sem local fixo (ex: Personal) — nesse caso o check-in não vai exigir localização, só confirma a aula certa no horário.</p>
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <ConfirmButton onConfirm={submit}>Salvar</ConfirmButton>
        <Button variant="ghost" icon={X} onClick={onCancel}>Cancelar</Button>
      </div>
    </Card>
  );
}

function UnidadesAdmin({ data, save }) {
  const [novo, setNovo] = useState(false);
  const [editando, setEditando] = useState(null);

  const adicionar = async (form) => {
    const u = { id: uid(), ...form };
    await save({ ...data, unidades: [...(data.unidades || []), u] });
    setNovo(false);
  };
  const editar = async (id, form) => {
    const unidades = (data.unidades || []).map((u) => (u.id === id ? { ...u, ...form } : u));
    await save({ ...data, unidades });
    setEditando(null);
  };
  const remover = async (id) => {
    const emUso = data.alunos.some((a) => a.unidadeId === id);
    if (emUso) { alert("Não é possível remover: há alunos vinculados a essa unidade."); return; }
    await save({ ...data, unidades: (data.unidades || []).filter((u) => u.id !== id) });
  };

  return (
    <div>
      <p style={{ fontSize: 12.5, color: "#9B9891", marginTop: 0 }}>Cadastre aqui outros locais onde o professor dá aula (ou "Personal", sem endereço fixo). Depois é só vincular cada aluno à unidade certa no cadastro dele — o check-in por localização passa a considerar o local daquela unidade, em vez do QG.</p>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <Button icon={Plus} onClick={() => setNovo(true)}>Nova unidade</Button>
      </div>
      {novo && <UnidadeForm onCancel={() => setNovo(false)} onSave={adicionar} />}
      {editando && <UnidadeForm initial={editando} onCancel={() => setEditando(null)} onSave={(form) => editar(editando.id, form)} />}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {(data.unidades || []).map((u) => (
          <Card dark key={u.id} style={{ padding: 12, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: "#F5F3EC" }}>{u.nome}</div>
              <div style={{ fontSize: 12, color: "#9B9891" }}>
                {u.latitude != null ? `${u.endereco || "Local cadastrado"} · raio ${u.raioCheckin || 150}m` : "Sem localização fixa (não exige geolocalização)"}
              </div>
              <div style={{ fontSize: 11.5, color: "#9B9891" }}>PIX: {u.chavePix || "usa a chave geral da academia"}</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Button variant="ghost" onClick={() => setEditando(u)} style={{ color: "#F5F3EC", border: "1px solid rgba(255,255,255,0.2)" }}>Editar</Button>
              <ConfirmDelete onConfirm={() => remover(u.id)} />
            </div>
          </Card>
        ))}
        {(data.unidades || []).length === 0 && <Empty dark>Nenhuma unidade cadastrada ainda. O QG continua sendo o local padrão para quem não tiver unidade selecionada.</Empty>}
      </div>
    </div>
  );
}

function PedirAssinaturaTodos({ data, save }) {
  const [confirmando, setConfirmando] = useState(false);
  const [feito, setFeito] = useState(false);
  const pedir = async () => {
    const alunos = data.alunos.map((a) => ({ ...a, termoAceito: false, primeiroAcesso: true, assinaturaTermo: null }));
    await save({ ...data, alunos });
    setConfirmando(false);
    setFeito(true);
  };
  return (
    <div>
      {confirmando ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, color: "#FF8A80", fontWeight: 600 }}>Isso vai pedir a assinatura de novo pra TODOS os {data.alunos.length} alunos (mesmo quem já assinou antes) na próxima vez que abrirem o app. Confirma?</span>
          <Button variant="vermelho" onClick={pedir}>Sim, pedir de novo</Button>
          <Button variant="ghost" style={{ color: "#F5F3EC", border: "1px solid rgba(255,255,255,0.2)" }} onClick={() => setConfirmando(false)}>Cancelar</Button>
        </div>
      ) : (
        <Button variant="ghost" onClick={() => { setConfirmando(true); setFeito(false); }} style={{ color: "#F5F3EC", border: "1px solid rgba(255,255,255,0.2)" }}>Pedir nova assinatura de todos os alunos</Button>
      )}
      {feito && <div style={{ fontSize: 12, color: "#4ADE80", fontWeight: 600, marginTop: 6 }}>Pronto — na próxima vez que cada aluno abrir o app, ele vai precisar assinar de novo (com o dedo, na tela).</div>}
    </div>
  );
}

function ConfiguracoesAdmin({ data, save }) {
  const [nome, setNome] = useState(data.academia.nome);
  const [chavePix, setChavePix] = useState(data.academia.chavePix || "");
  const [termo, setTermo] = useState(data.academia.termoPadrao || "");
  const [logo, setLogo] = useState(data.academia.logo || null);
  const [termoPdf, setTermoPdf] = useState(data.academia.termoPdf || null);
  const [termoPdfNome, setTermoPdfNome] = useState(data.academia.termoPdfNome || "");
  const [senhaAdmin, setSenhaAdmin] = useState(data.academia.senhaAdmin || "");
  const [endereco, setEndereco] = useState(data.academia.endereco || "");
  const [latitude, setLatitude] = useState(data.academia.latitude ?? "");
  const [longitude, setLongitude] = useState(data.academia.longitude ?? "");
  const [raioCheckin, setRaioCheckin] = useState(data.academia.raioCheckin ?? 150);
  const [instagram, setInstagram] = useState(data.academia.instagram || "");
  const [facebook, setFacebook] = useState(data.academia.facebook || "");
  const [whatsapp, setWhatsapp] = useState(data.academia.whatsapp || "");
  const [mensagemAniversario, setMensagemAniversario] = useState(data.academia.mensagemAniversario || "");
  const [regrasTatame, setRegrasTatame] = useState(data.academia.regrasTatame || null);
  const [marcaDagua, setMarcaDagua] = useState(data.academia.marcaDagua || null);
  const [golpesProibidosPdf, setGolpesProibidosPdf] = useState(data.academia.golpesProibidosPdf || null);
  const [golpesProibidosPdfNome, setGolpesProibidosPdfNome] = useState(data.academia.golpesProibidosPdfNome || "");
  const logoRef = useRef(null);
  const pdfRef = useRef(null);
  const regrasRef = useRef(null);
  const marcaDaguaRef = useRef(null);
  const golpesProibidosRef = useRef(null);

  const onLogo = (e) => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => setLogo(r.result); r.readAsDataURL(f); };
  const onPdf = (e) => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => { setTermoPdf(r.result); setTermoPdfNome(f.name); }; r.readAsDataURL(f); };
  const onRegras = (e) => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => setRegrasTatame(r.result); r.readAsDataURL(f); };
  const onMarcaDagua = (e) => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => setMarcaDagua(r.result); r.readAsDataURL(f); };
  const onGolpesProibidos = (e) => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => { setGolpesProibidosPdf(r.result); setGolpesProibidosPdfNome(f.name); }; r.readAsDataURL(f); };
  const usarLocalizacaoAtual = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      setLatitude(pos.coords.latitude);
      setLongitude(pos.coords.longitude);
    });
  };
  const salvar = async () => {
    await save({
      ...data,
      academia: {
        ...data.academia, nome, chavePix, termoPadrao: termo, logo, termoPdf, termoPdfNome, senhaAdmin,
        endereco, latitude: latitude === "" ? null : Number(latitude), longitude: longitude === "" ? null : Number(longitude),
        raioCheckin: Number(raioCheckin) || 150, instagram, facebook, whatsapp, mensagemAniversario, regrasTatame, marcaDagua, golpesProibidosPdf, golpesProibidosPdfNome,
      },
    });
  };

  return (
    <Card dark>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field label="Logo da equipe" labelColor="#9B9891">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {logo ? <img src={logo} alt="logo" style={{ width: 56, height: 56, borderRadius: 10, objectFit: "cover", border: "1px solid rgba(255,255,255,0.14)" }} /> : <div style={{ width: 56, height: 56, borderRadius: 10, background: "rgba(255,255,255,0.06)" }} />}
            <Button variant="ghost" icon={Camera} onClick={() => logoRef.current?.click()} style={{ color: "#F5F3EC", border: "1px solid rgba(255,255,255,0.2)" }}>Enviar logo</Button>
            <input ref={logoRef} type="file" accept="image/*" hidden onChange={onLogo} />
          </div>
        </Field>
        <Field label="Nome da academia/equipe" labelColor="#9B9891"><input style={inputStyle} value={nome} onChange={(e) => setNome(e.target.value)} /></Field>
        <Field label="Chave PIX para pagamentos" labelColor="#9B9891"><input style={inputStyle} value={chavePix} onChange={(e) => setChavePix(e.target.value)} placeholder="ex: e-mail, telefone ou chave aleatória" /></Field>
        <Field label="Senha de acesso ao painel administrador" labelColor="#9B9891"><input style={inputStyle} value={senhaAdmin} onChange={(e) => setSenhaAdmin(e.target.value)} /></Field>
        <Field label="Endereço do QG" labelColor="#9B9891"><input style={inputStyle} value={endereco} onChange={(e) => setEndereco(e.target.value)} placeholder="Rua, número, bairro, cidade" /></Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <Field label="Latitude" labelColor="#9B9891"><input type="number" step="any" style={inputStyle} value={latitude} onChange={(e) => setLatitude(e.target.value)} /></Field>
          <Field label="Longitude" labelColor="#9B9891"><input type="number" step="any" style={inputStyle} value={longitude} onChange={(e) => setLongitude(e.target.value)} /></Field>
          <Field label="Raio permitido (metros)" labelColor="#9B9891"><input type="number" min="10" style={inputStyle} value={raioCheckin} onChange={(e) => setRaioCheckin(e.target.value)} /></Field>
        </div>
        <div>
          <Button variant="ghost" onClick={usarLocalizacaoAtual} style={{ color: "#F5F3EC", border: "1px solid rgba(255,255,255,0.2)" }}>Usar minha localização atual (se você estiver no QG agora)</Button>
          <p style={{ fontSize: 11.5, color: "#9B9891", marginTop: 6 }}>Isso preenche latitude/longitude com base em onde este aparelho está agora. Se preferir, pegue as coordenadas pelo Google Maps: toque e segure o local no mapa e copie os números que aparecem.</p>
        </div>
        <Field label="Mensagem de aniversário (opcional)" labelColor="#9B9891">
          <input style={inputStyle} value={mensagemAniversario} onChange={(e) => setMensagemAniversario(e.target.value)} placeholder="Toda a equipe do QG deseja um ótimo dia. 🥋" />
          <p style={{ fontSize: 11.5, color: "#9B9891", marginTop: 4 }}>Use <b>{"{nome}"}</b> em qualquer lugar do texto pra ele virar o primeiro nome da pessoa automaticamente. Se deixar em branco, usamos a mensagem padrão.</p>
        </Field>
        <Field label="Termo de consentimento (texto exibido no app)" labelColor="#9B9891">
          <textarea style={{ ...inputStyle, minHeight: 120, fontFamily: "Inter", resize: "vertical" }} value={termo} onChange={(e) => setTermo(e.target.value)} />
        </Field>
        <Field label="Termo de consentimento (arquivo PDF, opcional)" labelColor="#9B9891">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Button variant="ghost" onClick={() => pdfRef.current?.click()} style={{ color: "#F5F3EC", border: "1px solid rgba(255,255,255,0.2)" }}>{termoPdf ? "Trocar PDF" : "Enviar PDF"}</Button>
            <input ref={pdfRef} type="file" accept="application/pdf" hidden onChange={onPdf} />
            {termoPdfNome && <span style={{ fontSize: 12.5, color: "#9B9891" }}>{termoPdfNome}</span>}
          </div>
        </Field>
        <Field label="Assinatura do termo" labelColor="#9B9891">
          <PedirAssinaturaTodos data={data} save={save} />
          <p style={{ fontSize: 11.5, color: "#9B9891", marginTop: 4 }}>Use isso depois de mudar o texto do termo, ou pra fazer todo mundo assinar com o dedo pela primeira vez (inclusive quem já tinha aceitado antes, sem assinatura).</p>
        </Field>
        <Field label="Regras do tatame (imagem, opcional)" labelColor="#9B9891">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {regrasTatame && <img src={regrasTatame} alt="regras do tatame" style={{ width: 56, height: 56, borderRadius: 10, objectFit: "cover", border: "1px solid rgba(255,255,255,0.14)" }} />}
            <Button variant="ghost" icon={Camera} onClick={() => regrasRef.current?.click()} style={{ color: "#F5F3EC", border: "1px solid rgba(255,255,255,0.2)" }}>{regrasTatame ? "Trocar imagem" : "Enviar imagem"}</Button>
            {regrasTatame && <Button variant="ghost" icon={X} onClick={() => setRegrasTatame(null)} style={{ color: "#F5F3EC", border: "1px solid rgba(255,255,255,0.2)" }}>Remover</Button>}
            <input ref={regrasRef} type="file" accept="image/*" hidden onChange={onRegras} />
          </div>
          <p style={{ fontSize: 11.5, color: "#9B9891", marginTop: 4 }}>Se preenchida, aparece no app do aluno, na aba "Mais", em um card "Regras do tatame" que ele pode expandir.</p>
        </Field>
        <Field label="Marca d'água dos relatórios em PDF (imagem, opcional)" labelColor="#9B9891">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {marcaDagua && <img src={marcaDagua} alt="marca d'água" style={{ width: 56, height: 56, borderRadius: 10, objectFit: "cover", border: "1px solid rgba(255,255,255,0.14)", background: "#333" }} />}
            <Button variant="ghost" icon={Camera} onClick={() => marcaDaguaRef.current?.click()} style={{ color: "#F5F3EC", border: "1px solid rgba(255,255,255,0.2)" }}>{marcaDagua ? "Trocar imagem" : "Enviar imagem"}</Button>
            {marcaDagua && <Button variant="ghost" icon={X} onClick={() => setMarcaDagua(null)} style={{ color: "#F5F3EC", border: "1px solid rgba(255,255,255,0.2)" }}>Remover</Button>}
            <input ref={marcaDaguaRef} type="file" accept="image/*" hidden onChange={onMarcaDagua} />
          </div>
          <p style={{ fontSize: 11.5, color: "#9B9891", marginTop: 4 }}>Aparece grande, no centro, bem clarinha, atrás do conteúdo de todo relatório em PDF. Funciona melhor com uma imagem clara/transparente (tipo um desenho de linha) — ela é invertida automaticamente pra ficar visível no papel branco. Se não enviar nada aqui, usamos o "Logo da equipe" pequeno no canto, como já era antes.</p>
        </Field>
        <Field label="Golpes proibidos (arquivo PDF, opcional)" labelColor="#9B9891">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Button variant="ghost" onClick={() => golpesProibidosRef.current?.click()} style={{ color: "#F5F3EC", border: "1px solid rgba(255,255,255,0.2)" }}>{golpesProibidosPdf ? "Trocar PDF" : "Enviar PDF"}</Button>
            <input ref={golpesProibidosRef} type="file" accept="application/pdf" hidden onChange={onGolpesProibidos} />
            {golpesProibidosPdfNome && <span style={{ fontSize: 12.5, color: "#9B9891" }}>{golpesProibidosPdfNome}</span>}
            {golpesProibidosPdf && <Button variant="ghost" icon={X} onClick={() => { setGolpesProibidosPdf(null); setGolpesProibidosPdfNome(""); }} style={{ color: "#F5F3EC", border: "1px solid rgba(255,255,255,0.2)" }}>Remover</Button>}
          </div>
          <p style={{ fontSize: 11.5, color: "#9B9891", marginTop: 4 }}>Se enviado, aparece pro aluno na aba "Mais" e também no app do professor, como um link pra abrir o PDF.</p>
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <Field label="Instagram" labelColor="#9B9891"><input style={inputStyle} value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="https://instagram.com/..." /></Field>
          <Field label="Facebook" labelColor="#9B9891"><input style={inputStyle} value={facebook} onChange={(e) => setFacebook(e.target.value)} placeholder="https://facebook.com/..." /></Field>
          <Field label="WhatsApp" labelColor="#9B9891"><input style={inputStyle} value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="https://wa.me/55..." /></Field>
        </div>
        <div><ConfirmButton onConfirm={salvar}>Salvar configurações</ConfirmButton></div>
      </div>
    </Card>
  );
}

/* ---------------- PROFESSOR ---------------- */
const FUNDO_APP = "data:image/jpeg;base64,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AlFFFMApKWkNABRRRSASkpaMUwEooooEJSUtFAxtFKaSgQGkNLSUDEpKXFJQAhFJTqaaBCGkpaSgAooooGFJS0lACUUtJQIKKKKACiiigAooooAKKKKBhRRRQIKKKKACiiigAooooAKM0UUALRSUUALS0lFAxaKBRQAUtJRQIdQDSUtADqWmiloGOFKKaKUUAOpRTacKAFFOpop1AC0tJS0gFFFAooAKWiimAUUUUgCiiigAooooAKKKKACiiigAooooAKKKKAEopaSmAlFLSUAFJS0GgBKKKKQCUUtJTAKKKKQCUhpTRTASiiigQ2ilNJQAlFLSUDEpKcaSgBtIRTqSgBtIacaSgBKSlxSUCCiiigYlFLSUAJRS4pKBBRRRQAUUUUAFFFFAwooooAKKKKACiiigAooooEFFFFABRRRQAUUUUALSim0tAC0UUUDClFJSigQop1NpRQMcKUUgpRQAtLSUooAcKdTRTqAFpaSlpAKKKBRTAUUUCigAooooAM0ZpKKAFzRSUuaACiiikAUUUUALRigUtMBKSloxQAlFLSUgEopcUlACUUtJTASilpKACkpaSgAooopAJRQaKYCUUtJigQUlLRQA2ilooGNopcUlACUlOpKAG0hFOpKAG0lOIpKBDaKXFJQAUUUUDEopaSgBKKWkoEFFFFABRRRQMKKKKACiiigAooooAKKKKACiiigAooooEFFFFABQKKKAFpaSlFAwooooELThTacKAFFOFNFOFAxaUUlKKAHCnU0U6gBRS0gpaQC0UUUwFopKKAFzSUUUAFFGaM0AFFGaKAClpKKAFooopALS0lLQAUUUUAJRilooAbRSmkpgJQaWkoASkpaSgApKU0lABSUtJQAUUlFAC0UUUAFJiloxQAlJTqTFACYpKdSYoAbRS0lACUlOpKAG0mKdSUANpMU4ikoENopaSgAooooGGKSloxQAhpKWigQlFFFAwooooAKKKKACiiigAooooAKKKKACiiigAooooEFFFFACilFIKUUDCiiigBRThTRThQIUU4U0U4UDFpaSloAcKdTRThQAtLSUtACiigUUgCiijNMAozSUUgCijNJmmAtFJmloAWikpaAFopKWgBRS0lFIBaKKKACiiigBKSnU2mAGkpTSUAJSUtJQAhooNFACGkoooEFFFFABS0lFACilpBS0hhRRRQAmKQinUlMBtJTjSUANopaSgBKSnUhoAbSGnUlADaSnEUlAhKSlpKACiiigYUUUUgG0UUUxBRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQAUUUUALSikpaBhRRRQAopwptKKBDhThTRThQMWlFIKUUAOp1MFOFADqWmiloAWijNGaACijNJQAtJRRmgAopKKAFopKKAFpaSigB1FJS0ALS0lFIB1FJRmgBaKSjNABSUuaSmAGkNFBpAJSUppKAEpDS000wCikooEFLSZooAWikpaAFFLTRTqBhRRRQAUUUUAIaSnU00AIaQ0tJQAlJS0UANNBpaSgBKaacaKAG0lKaKBDaKWkoAKKKKBjaKKKBBRRRQAUUuKTFABRS4pKACilooASilxRQAlFLiigBKKXFFABRS4oxQAYooooGFFFLQIKcKSlFACilFIKUUDHClFIKKAHClFNp1ADqXNNBpaAFopKM0ALRmkooAKKTNJmgBc0ZpKKAFzRmkooAdS5pmadmgBaWm5paAHUUlGaAHUUmaKQC0UlFMBaSijNABSUUlABSUUhNAATSUUlABSUUUCCikooAWlpM0UAOopM0tADqKbmlzQMWiikzSAWmmlpKYBSUUlAgNJS0lACUhpaDQMQ0lLSUAIaSlNJQIQ0lKaSgAooooGJRRilxQITFFLiigYlFLRQAlLiiigAxRiiigAxRiiigAooooAKKKKACiiigAoopaBCUtGKWgApRSAU6gYClFIKWgBRS0lLQAopabS0AOpc03NLQIXNGaSigYuaTNFJQIWkzRSUDFpKM0ZoELRSZozQAtLTaWgY4GlpmaXNAD80U3NLQA7NFNzS5oAWikzRmgBc0lJmjNAC5pKTNJmgBSaSkooAKSikoEFFFGaBhRRmjNABRRmigBaWm0tAC5pabmigQ7NGaTNGaAFpKKSgBaSikoGFFFFACUlLSUAFJSmkoAQ0lBooEIaSlNJQAUUUUDCiiigAoopaBCUUuKMUAJRS4oxQAlFLRQAlFOpKAEop1FADaXFLRQAmKMUuKMUAJiilxS4oASjFLiloATFLRS0DClFJS0AFLRRQAUtJS0CClpKKAFzRmkooAXNJRRQAUlFFABRRRQAUUUUDClzSUUCHUZptLmgBc0uabmigB2aXNNozQA7NGabmjNAC5ozSUmaAFzRmkzSUALmkoozQAUZpKKBhRSZooAXNGaSigBaKSigB2aKTNFAC0UlLmgBc0ZpM0ZoAXNJRmjNABRSZooAXNJRmkoAKKSigApCaDSGgApKWkNAgpKKKACiiigYtGKWigQmKKXFLigYlGKXFLQIbilxS0UDExRilxRigBMUYp2KKAExRilxRigBMUUtGKAEopcUYoASjFLilxQA3FLilxRigBKKWigAopcUUAFFFFABS0lLQIKKKKACiiigAoNFFAxKKU0lAgooooGFFFFABRRRQAUUUUAFFFFAgooooAKKKM0AFFGaM0DCjNJRQAUUmaKADNFFJQAuaTNFFABRRRQAUZoooAXNFJRQAtGaSjNADs0ZpuaM0AOzSZpM0ZoAWikooAXNJSZozQAtITSZooAKSiigApKKKBBRRRQMKKKM0APxRilooAKKWigBMUtLiigBKXFLijFACYoxS0UAJijFLRQAYoxRS4oATFGKXFGKAExRilxRigQmKMUuKMUAJiilxRigBKKXFGKAEopcUtACYopcUYoASilxRQAlLilooATFGKWigBtFLRQAlFLiigBtFLRigBKKXFJQAUUUUDCiiigAozRSUAFFFFABRRRQAUUUlMAooopAFFFJTAKKKKQBSZoopgFFFFAgpM0tJQAZpc0lFIBc0ZpKKAFzRmkpKAHZpM0lGaAFzRmkzRmgBaSikoAXNFJRQMWkoooAKKKKACikooAWkopKBE9FLiigYUUuKKACilxRQAYoxS4pcUANxRinYoxQAmKMUuKXFADcUYp2KMUANxRinYpcUAMxRin4oxQIbijFOxRQA3FGKdijFADcUYp1FAxuKMU6jFADcUYp2KMUAJijFLijFACYpcUYoxQAmKMU7FJigBMUYpcUYoAbijFOxRQAyjFOxRigQ3FJTsUUANxRilxRimA2inUlACUUuKKBiYpKWigBKKXFJQAUYoooASilpKACiiigQlFLSUDEopaSgQUUUUAFJS0hoAKSiikAZopKKAFpKKKACiiigAooooGFFFFABRRmjNABRmkozQAUUGkoELmkoooAKKKKALFLRS0DCiiloAKWjFLQAmKXFLRQAmKXFLiigBMUYp2KMUAJijFLRigBMUYpcUuKAExRilxRigBMUYpcUYoATFGKXFGKAExSYp2KMUAJijFLijFACYoxS4oxQAmKMUuKMUAJijFLRQAmKMUtF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";
const LOGO_CIRCULAR = "data:image/png;base64,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JhMhtpCTlqbHzGj6N9KsWbP45ptvuPfee5k6daqRoepBJS8vjwcffJA5c+YwZcoU/vOf/9TL7E/HAV966SUyMzPp2LmTz0pSkowMRcesSktL/1I/Wv3n6lzLyy67jIcffpikZsl4XO6jf+/20Ovcc3j77bd58803+eyzzzhy5AhmszmoEjjVRsjBgwcpKioiLCL8lInFQc02P768f/9+9u7de4wW3uDBgxk4cGCd2TVgjB+KssQ3X33NzJkzOXjwoBH4/m7YRA/QiqJgtVp58MEH2bJlC59++qkxPBA4DtqlSxfGjBnDY489RklJiUF61puHt9x6C+cPGYzXL00XHh5O4yaN8Xo9QdCUIPisR1VVJTcnl+z92cbzkmUZq9WKw+GgVevWjBo1KggnDMThRVFk3rx57Ny5wwjWxwt+DodDTc9IFwYMGrABWKRpmiCK4mkpzZ7JblD8zZA5rdq0PnjRRReJNTU16skwKK/XS2JiIjfeeCMms9nPXD16GtbU1DBt2jQ2btxIVFQU+/fv57nnnuO+++5j5syZLF68GJfLZZw2p7K4Akff9ACnq8U88cQTXHbZZQwdOjSo46sTsVeuXMn//vc/rrrqKsaOHRtEkK4vWaCOr+zZs4eHH36YvXv2IpvrPojsfjL52f7s+gJ2u93U1NQQGxvL1KlTefrpp0lKTsbr9hyd9dabW16FpslJTJs2jffff9+XYcXE4HA4fLaop5Ad6feel5dHVlaWkRWfzrPzeHyfzVFj5+2336agoMAIgLpJ0xVXXOH3WAlujmiqits/dunxeHjtlVd54IEHOHjwIGaz+agp+j8kduByubj55ptJSEjgmWeeCaKH6VBSWFgY9957Lz///LMxCaQHv5oaOz179uSmm2829obFYmHnzp088dRTOJxOQ/Sh9qFqMpkICQkhJCQEm81mYIJut5sLLriAli1bGutGD6y6xWV2djbvf/DBCQn5+n93uVyMHn2x0Kljp5cFQfAC4uk+b/EMHq4GiIIgVABvXDfxOiE0NFRTArTCjrdYi4uLWbNmDegcPp+UBLIk8eorrzDv62+w+U8Rs9kcBIrabLaghsSJUErRPzytb0o9u9AfeEhICN988w0LFy7k0UcfpUmTJng8niD+oMVi4d1332XBggXMmDEjSEK/vuGBVquVVatWcestt7B+7TpDKCDwOQUq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";
const LOGO_TECBM = "data:image/png;base64,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";
const LOGO_CACHORRO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAlgAAANPCAYAAAAGwqFLAAEAAElEQVR42uzdd3hVRfo48HfOOffehBR67whIE1QEsQK29WsvG0RddVf9wYrr2tay6HqJrgW7Iiq6q66A5QIKKgKKBBAQNPSEFggQSkKA1FtOm3l/f2TmekQ66byf5+ERISS3nDvnnXfeeYcBIYQQQqoTAwDs2rVraseOHU/Rdd1XVlYW03VdOI6DnHOLMYaapmEkEnH9fj/3+/28uLiYa5qGsViMAwDouo4+n0/ouo7FxcVC13VMSEgQmzdvRgBwAACP8XHpffv2TdA0rYHf709GxAYpKSlJKSkpDQKBQIPU1NSGzZo1a96oUaOmSUlJKampqSlNmzZtmZqa2ujjjz9+a+bMmd/k5+dH6e0lhBBCCKkcOr0Ev4+iCSGEEEKOKl5A/H1ijDGG9BIRQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCHkxLCD/WHHjh0TdF0PxGIxJz8/3wQAQS8VIYQQQsiJB17aoQIwQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYSQkxaTvwghhBBCCCEHRsqEEEIIqWH9+/f3AUCz5ORkfcGCBbsAAOlVqbs0egkIIYSQmrd8+XKhaZptmqZDrwYhhBBCCCGEEEIIqbWoyJ0QQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEnACNHjAhhBBCSCXp2LFjwqmnnppEARYhhBBCSCVJSkoSnHObXglCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQgghhBBCCCGEEEIIIYQQQggAQ0RGLwMhhBBCSGVHWYwBImoAQMEWIYQQQsjxUFkrREz+5ptvungDrVAopFOgRQghhBBy7AGWDgDa9u3bR2/evBmnTp16/9KlS/sBQAIAgK7rBwZaFHARQgghhBwG03UdACCQkZHxLiI6iIjbtm3js2fPfmvy5MnnA4AhAzFNBloavWyEEEIIIYcJsBhj0KZNm6aLFi36knOO4XA4yjl3ERE3bdoUXbp06fixY8cOVv8AEX3BYJCCLEIIIYSQg1GBUvfu3TsvXrx4KSKiaZou51zEYjEbEQUi4vr16/euW7fuzdtuu+0cgIplwwkTJvjoFSSEEEIIOYBc8oNgMNh39erVuYiIjuO4KFmWJaLRqKn+f9OmTblLly59vUOHDp0BKJtFCCGEEHLIAGvq1Knnbdy40UJEdF1XICJGIhF03YpYyzRN27ZtSwVaOTk5K19//fW/AgDTNI2yWYQQQgghitxBCD/99NOlJSUlAhEdzjm6rouu6wrTNHH16tV5Mq7i5eXlLiK6iIh79+6N/fLLL7OHDh16qvd7HYYGVCBPCCGEkPouIyPDAAAoKiq6WgZRphAChRBYUlLCOec4duzYh996662/O46DiIhFRUWirKzMRkQUQmA0Gt09adKkpz3flto4EEIIIeTkJTu2Q1ZW1l/k8qCFiCizWC7nHB988MFBAABjx469defOnaZaRuScC0TkiIixWEwsXbp0WVpaWmeAiialhBBCCCEnI6ZpGgCAPnPmzBdl4GSrDBYiutFoFLds2dJSBUyhUOi03NzcUkTEsrIybpomcs6Fym7t27fPfuqpp+7wBHAUaRFC6t/gSZNIQsiheIKfxjNnzpwuAywHEbG8vFy4riu2bNkSzcjIaCa/XgMA+Pvf/95hyZIlK+WOQ+44jnBdVwVlaJomvvXWW+kgO8GrQnpCCKknEmgCSWqSQS9B3XDNNdckJiYmtpSzMoaIkJycDK7rssLCwl2rVq1y5d9hKBTShw0blteqVaub/H7/p2eeeeaZjDERi8UgEAgwRAS/3w/33nvvU+3atev8888/PzZs2LB8TdNACMEAAOkVJ4TUVWlpaXpCQsLVqampZYyxOWlpafqUKVM4vTKEkDjVvyoYDHZZvHjxJrVT0LIsNE2TIyJOnTp1Rrt27RK9/86TkWqRkZHxheM4GIlEXFmXha7rIuecIyL+/PPPy996663TAUCXGTDaRUgIqdNeeeWVf2/evHnLE088cYqu6xAMBg+WUGBAG34IObkDrIkTJ/bKzs4uRUTBOedCCLQsy0VE/OCDD96Ag2Qjg8GgIdPjDb///vuJMjhzTdMUqkjetm0XEXHNmjWF99xzTxpAvJUDDTqEkDrrrbfe+jci4qJFi+YCQFNE1A7RcJkmlIScjFRN1dq1aweUl5cjItqqsajruo4QAt96663/d6h/HwqFdBlkNf7uu+/+h4ho27ajGpXato3RaNSVjUm3PfbYY7cAAENEg4IsQkhdNHjwYGP69OnfxmIxHo1G+fTp098FgERE1OlUC0LIbwKs0tLScxFRuK5rWpalitVtRMSFCxeeLb/2oAFRWlqabhgGyCBrksxkObFYTLiui6ZpxrNhO3bs2CeDLKAgixBSF11++eWBJUuWrDVNE23bdqLRqPPOO++MAQA/jWuEEPAGTbNnz75JCIGu69qcc5T9rdy9e/diTk5O18MFWAcEWU1nzpwZ4pyjZVmubduodheWlZXZnHNRUFCQ/9xzz90MEK/losGIEFJnjBgxwrdo0aLV8jgx13Ecp6ioKPrLL79cK8dKP71KhJzcmOzjYkycOHGsrJty5H85IuLy5ct3jx8/vv1hAqz4nwWDQY0xBsnJyc1CodCX6vtEo1FU5xqGw2EHETE3N3f/ww8/fMORAjdCCKltQqFQcl5eXti2bZSlEC4i8lgstmP9+vX9GWPxEzIIqUp69+7dm9HLUDsDLPnfpKlTp34q+1e53v/+8MMPS6666qpmRxsIqfqDfv36NQqFQp8hIlqWJWKxmKrrwtLSUhcRcevWrUX33nvvVfQ2EELqyv1MjoUBREQ1eZT9AB1ExF9++WX1E0880RERmSrBIKTKbuKDBw+mSL4WB1j9+vVr9M0338xVgZVt28g5dxERZ8yY8U3jxo0bHhCQHZYnEEv58ssvP1XNSG3bRsdxkHMeL3xfv3594T/+8Y9W9FYQQurKmHnfffddrjbxOI6DQgh1tJjDOccZM2ZMBoDko52YEnI8NADABQsWuPRS1D6IFf0+r7jiikCjRo1aqwEEEUHTNAQAsCwrr7i42DymEYgxlJms8rfffvv+H3/8MdMwDE3Xda7rOoTDYZQzO+zRo0fzm266aXavXr2oZoEQUuuHTQAAv9/fAQBA13U15oGmaaBpmiGEcK+88spbPvzww3QA0Blj1FiZkJMwwGIAAN98803HTZs2hRFRWJYlZJbJRkT8+uuv/x8AgDyv8Li+/5133tnmxx9/XCYPhHbVcmF5eTmqlhChUOhjORjRG0MIqdXGjh07BhFRbgxSdVhoWVZ8yXD37t1i7Nixo7xjISHkJAuwCgoKusigx3FdF2UpgSnHifPl1x7XWYKq4/vMmTNP27Bhwx5Zk8U55/HUumlW/Khx48Y9DQCMzi0khNRmEydO/EA1UxZCoGzMjKrFTXFxMXddl1uWhc8//3x/CrIIOUkDrHXr1vWRg4Xtuq6akdmmaeL69evP9QZKx/lzdACATz755OwdO3aUyCDLVQdDq0J427Zx9OjRt5/ozyOEkKr0/fffz5XjFqpMlvp/TxZLWJbl/PLLLxsuuuiilgC/bgIihNRzajnu9ddfv0O1aJCZJYGIuGrVqqL//Oc/fWSQdLwDA/P++48++mhkWVlZDBHdWCzGZUE9cs55JBKxt2/fvqNt27btEFGjGR8hpDYOndnZ2TneAEstEaolQ5WVLywstOVu7LkA0Fj2CqRxjZCTxZtvvhmULRRc7yHNixcvXv2nP/2p8wnOvNRgoo7H8X300Ucvl5WVcUR0w+GwcBwHY7GY2L9/f8y2bfvLL7/8BAAayswXzfgIIbXKvn37yuTu6HhQJY8Fi9diqb+zbZvLHdkfA0BKKBTyU5BFyMnB+PDDD8fLDJbLOcdYLKZ6YH3btWvX5gCVUz8QDAY1GWQ1+uabbz7bv38/IqKLiPE+WbKdgzV37twH5M/10VtECKktTj/99OamTFGp+ivHcdB1XbQsC03TRE8tK8pzWVX7hpfkuEa7pgk5CQRCodBUFdwIITASidiIiHPmzHkdAAy5g7BSZlzycGjt+uuvb7do0aJlslGfUOl12REZCwsLC95+++3+iMioIzIhpBZgAAAXXHDBuaqpaLzYSgZZ3myWKoJXGXpEdEzTtJYvXz6cMQbffvttgF5SQuqxYDCY/OOPP66RAZaQRe6mEAJ37tz5ZznbqtSC8xEjRvg0TYO33nrr9G3bthU6jsNV3ZdaqoxGo7ho0aIpAJAifz6l1AkhNUZl8W+77bYb1ERQ7SJU5OHPvwm6VMAlyyJwy5Ytex999NFBhmFAMBikySMh9VVeXl6TwsJCh1f4TYuGvXv3XgcAVXKmlvqeTz/99Ai5VCg45xiJRFSRvWWaZuyXX34ZKQc3GogIITU5GdUAAJ566qmHPct/8QJ3tTTIOf/dMqEQAktKStCyLJdzjpmZmUsaNmzYGRGpLQ0h9XhW1lQ2AOVyYBCI6O7atQvnzZv3B/k1ehX9bB0AtDfffPM5NRNUuwrVWYhr1qzJvvXWW09ljFHrBkJIjQdY77zzzmveLJXKVKkeWIiI4XA4Hmx56kuxpKQEbdt2OOf4008/fQkATRlj1L6BHAu6VupQgNVENf+UMzKOiJidnb3/jTfeGARQtT2pZKsIfc6cOd8dWM/gOI7tOA7OmjVrHFRyLRghhBzjWKkBAHzzzTdfqADrwGVClb3ylmhZlvWbICsajQpEdIQQ+MMPP7wLAD555A6NbeSwt0sAgL59+7bo27dvEkVadcBjjz12NgCAYRjAOQd1blY4HN6dkZFRCgCQnZ1dZWdpyfMQ+RtvvHF7bm5uKQAA5xwMwwDXdQ3DMLB79+7/78MPPzxbCAGhUIiuKUJItZsyZQoDAOjYsWNnn88XH7+EEMAYA9u2wXVd0HUdDMOAgoICOxKJgN/vB03TgHMOtm1DQkICi0ajuuu6eMYZZ4ycMGHCKM55/PxXQg51uwQAcF23pLS0lFNAXgeMHTt2tDzmQcgdfQ4i4rx5874DgGrtPvzPf/7zj5FIxFFH6XDO0bZtR7WMGDhwYKo3kieEkGq7u8lSiYKCgp2/JttFvKjdNE2MRCKq9Qx+/fXXn/zwww/fyGyWKC8vV02V1dcJWfRuTZo0aaj8GTSBJEeLrpXabuLEiZNlMaaQRe42ImJmZua7AJAgd85UV0CjffDBBy8KIbC8vNxRNQzqMX3//feXA4BGgxAhpAYCLAYAifv379/rDbBc1423ZwiHwxiNRu1IJCLWr19/FgDA999/H5JlD25paakwTZPLmi2uak1Xrly5Y+TIkf2oHouQ+oOFQqFparCQDdxNRMSCggK1e69aGn0iIkNE9sYbbzRfsWLFBkTEkpISFxExGo1yRHSXLl265pZbbmksAz7KYhFCqm2s1DQNUlJSukej0WJvgCXrRX+Tvfr+++9/euCBB1rLrFfKwoULF8gsl1VYWGgJIbC0tNQqKSmxOedCnpyxDABSZD0WIaQuCwaD2oIFC35Wg4XccmwhIm7cuHFEdQZYnhkiPPfcc9cUFhYWI6Ktju2JxWIOIuJ77713FyIydY4iIYRUx1jJGIMhQ4ZcHIvFyr0bclSrBtmuwUJEnDt3rpqgMl3XoW/fvp23b9++Sn6Zc+AZhpZlqUzWO/LfUZRFjohSnbXY1VdfrZ9yyik91QxNprqN4uJid+vWraUAAMuXL6/WxxQKhfTRo0fPmjt37tvRaNQnt0FDLBbTHcfhF154YXrr1q2bPfXUU3RtEUKqDSJCjx492gkhfOr/GWOg6zogIliWhQCg79y50/L5fGuhIsuucc7Z2rVrt95www3Dc3NzswHA4Jw7sVgsXhRvmqbOOeenn376X7/77runGWOc2tIQUofpug6qfkBuIVa9p3b94x//OE8FPNU9UzQMA1599dXWWVlZP8sZnuM4DqpU+mefffYGZbAIIdVFNUYeN27c05FIRHh7YKn2DJZlOYiIGRkZM2+++eZmjLF4Vj4tLU1njMEtt9xy+oYNGzLleGtFIpH44dCRSARN07TLy8tx2rRpf5fjITVYJqQuuu66606xbVuonS2qfmDFihUr+vTp00MFPDUwU9QBACZMmDB869atEc6569mxw/fv32+3a9euKxWDEkKqM8CaNWvWRG93dm+A5bquiYgiLy/vb95xTFGT1dtuu63n5s2bl8mGpLbq+O498D4/Pz+alpZ2vq7r1GCZkDqGAQCMGjXqNjVAWJYVn4FlZmYuAoD2NbijhWVlZfnbtWuXuGTJkrfU+YSu6wr1eL/77rvpNRUAEkJOLpmZmT4AgO+//36Kt7mop/5KOI7jhMNh3Lp1680AwA5Wv6oCtTvvvLPP2rVrV6uaLPV95FmwQtbBZiUnJ/fUNI3GOULqWoD15JNPPqxGB7kEZ8kzCN8EAKMmz/8LBoMGYwyGDh3aLycnJ9e7hGlZligvL7fOPffcc+RARuuFhJAqg4h+AIBoNLpcNXD3ZK4QEV0hBK5Zs2bbgw8+OBDgkOUVTAVZw4cP771u3bp4kCV3IcazWIiIq1atWgwAHRCRUZBFSN0YLBgAwPjx419VGSHZc8pCRCwtLU33Dio1ZcKECT4AYG+//fbfCwsLbSGEOmZCICKuXbv2R/k4qU6BEFKVY6YqbF/nPVJMBVmccwcRcdmyZQsBoIOcJGqH+X46AMD555/fNzs7e538Pnz37t1R2fqBFxYWliMi/vjjj+97xjmaTBJSFwKs2bNnfytrr1RXYbesrAyXLl36IABAVlaWv4YfKpNNRdmGDRvmy8fpqmL3srKy6MiRI/8IUFFESu8sIaQqxiHDMAAAWoXD4W2ybYw4oFWDLetXPwQAXX79YYMhleHq1KlTv7y8vE1yQ4+rDo12HEcgIrdtG5ctW/akN9AjhNTyAGvVqlVrPLMwgYi4ffv22H/+85/hAPEMUo0aMWKETwZQl+7bt69Ips+F67puOBzGWCyWDQB+mt0RQqqC2gE4YMCAC4uLi/epMoUDMlgWIuKOHTtGH0sg5Mlydc7JydmoMlmxWEwdFcYREbdu3Vr20ksv/VF+b8rYE1LbA6wtW7bkqRmYaZocETEnJ2fnnXfeOVR++Gvqg8zA00NNZdIyMzNDsgBUmKYpEFEUFxdb48ePf1T+Pc3uCCGVSmWaRowYcUtxcXG5XCKMt2qQk1MeDofxxx9/HHGsY5EKstq2bdsvLy9vs6rBKi0tVUGWyznnGzZs2Hr33XdfoII+emcIqb0Blm/v3r3FapBQnYRzcnJWtWrVqidjrDZ9iNVS4Sn79+8v5JwL13WFbN+AeXl5mf369WskZ3ZUCEoIqTSqKP211157ZN++fc6B5xCqYGvLli2RcePGXQ9wXNl/xhiD5OTkXhs3blyvdk5Ho1EUQuD+/fsjjuPgxo0b16SlpZ3mDczIyYsugNqHaZqGbdq06ZKamuqXn2zQtIq3ynGcooKCgnxd16FXr15YW2LC+fPna5qmbZk/f/40IQTTdZ0hoi6EEMnJyX2feuqp+xhjLh0ETQipTCkpKQwAoGPHjm38fr/hmaSqyAjl2Fm8adOmIgCA3bt3H+vYiYjIotHour59+161efPm9bqu64mJibZlWdCoUaMGjuM43bt3P+3ee+99HQAajhkzBoHKIgipXQEWAMDll19+sWmapqdFgy2EwIKCgs+gImOk17IPr9qm3HbLli156oxCV+6R3rp16+Znn322l2EY1P2YEFJpVInCypUrP5NnCArv7mu1ozA7Ozt74MCB/WS0dFwTvWAwqGmaBn379u2zbt06tbvQVpuRYrGYW15ejp9//vnL8ufo1KaGkFpCpZVHjRr1Z9M0XXnCOyKig4hYWFj4JgDApk2bArXtsSMi0zQNnn322Udl7YMqMnWLi4vxhx9+GKsGHXqnCSGVNO4EAIAVFRXN8554Ieuj0JGt3bOzsxcDQPsTbQyqgqwrrrji9A0bNnwilyQt13UxFouhaZpuUVERjh8//i8Av+m3RYEWIbUhwHr77bdfkD2l1HZgUVpaKmbMmPEYQK0uGNcaNmzYaO3atTtt2xZyN4+LiGLt2rUbn3zyyZ50vAQhpJIw1Q/QNM0f1S4/lb2ybTveomHr1q1TASBBZq9OqFTBM34Ffvzxx5AMrBzXdTEajYrS0tLojh07Su66667LZXkHBVeE1DRVsDlnzpxptm3/pkXDjh07ws8+++wt3q+rlSMeY/Diiy/eK7NvQj4PJxKJ4BdffPEsAOhUi0UIqYwJqVyCa1ZcXLxGBVgqgy6XCm1ExOLi4nEAldegORQK6YiodenSpeGKFSs+l5ksUwiBJSUlNiLizp07d7Vs2bK36hdI79jJhW5ytVSbNm3a+nwVSSpERAAAIUT5xo0b9wEAzJ8/v9Y+dkRkkydPnrx69epcn88HjuOA67pagwYN8NRTTx3xv//9r6+maSIUCuldu3YN0MBDCDkevXv3Zpqm4VlnndXdsqzGAACccwYAoGkaMPbr0NKoUSOu5oCV8bOHDRvGp0yZwrZt21a6efPmEVlZWV8JIQKO4/CGDRv6HMfBtm3btlmyZEmIMaYCQRrrCKnB4MQAAMjNzc1W241Vynvz5s0bGjdu3EfTtFrdZ0UNai+//PI96uguOaO0hRD45ZdfPgcVWSxGQT4h5HipDTMjRoy4Yffu3UXeHliKWiIsLS2tkvpVRNQYY/DII4+krFy58iPV39Tbv3DZsmVT5ddSaQQhNRhg6QAARUVF271H5CAi5ufnL4KKGoLaPhNiAADXXXdd0wULFmTKIya4HPj4hg0bzNmzZ5/Qbh5CCFH9rF5++eURBQUFMW9JhSfY4pFIBH/66acnAKrmiDHVTf6+++4LLFy4cKpnB6OwbVtEIhH8z3/+86QMCv30zhFSA4GJrusQCAQ6R6PRverIB3VQaSwWmyGDkkCtfyIyi/Xee+/dJxNwtvdMsKlTp74UDAY1+XWUNieEHDO12Wfy5MmP7927V3gmpcg5VwGWKCkpwdmzZz8MABAKhaokwEFEployrFu3bpb6+ZZlCSEE7t27NzJ69Og7AWp3DS2pPJQ9qEXS0tI0zjlcfvnlfYQQAQAAv98PmqZpiAi5ubklAAA5OTm1/rk89dRTGgBAYWHhF8uWLcsGAINzzhljBgDwQYMG/aNnz569EBFkiRkhhByThIQEBgDQtWvXto0bN2YgG4ICVNRg6Xr1rcgxxpAxBowx6NWr1/Vff/31JMYY8/v9rLS0VDRr1qzBiBEjnrn22muHDB061KV+gBRgkRrQsmXLhgccGKqVlpbC9u3bCwAAbNuu9RFJeno6IiJ78sknd5WVlU0AABaLxYQsQMW2bduCbdv3yiwWRViEkGPm9/sZAECbNm0ay2BKeAvbhRAAAMA5B8dxeDU8JJT9AM3rrrvuvvnz50+PRqPQqFEjZlmW27FjxzYvv/zy6yNGjGj973//26XjdCjAItWkV69eDACgS5cu7QHArwYGAIBoNGpmZ2dvBQBYvHhxXQhIcMqUKRoAgOM4C9etW7c/JSVF8/l8QghhcM7xoosu+jMA9KDdNYSQ49GtWzcXAFhSUlJjNe4c5MtYLBazdu7cWSLH16oeP1EIAZqmlVx88cW3zJ8/PxSLxRhjjNm2LU455ZR+w4cPf2PkyJHJY8aMoYOhKcAi1WHIkCFq0GhvGIYup0MAAKDrenjRokV5AMd1jlaNuOmmmzgialdfffX6kpKS9wBAF0JwxhjILcwJDRs2vF1msCiLRQg5Fszn83EAaGSaZmMAACHEQSdqruuGc3JyigAAysvLq2WsEUIwRDSvvPLKUZmZmSv8fr9umia3bZv369cv7aKLLnqIMQahUIgmmBRgkaq2d+9eTQZYnf1+v5qNIQCAz+crnzdvXo6u65Cenl4nghFEhPnz52uMMXvbtm1zdu/evV/Wk6Gu6xrnHK+//vo/nX/++b0oVU4IOcbxhXHOoWXLlm1N02wEUFF3deCXAQAwxrhpmi7AYXsIVnagg4wx0DRt/4QJE/6anZ29NjU11ec4jtukSRP33HPPffCFF164jTHmhkIhjc4sJKQKye3DWllZWabqpaIOKi0pKVkOAP5aeMjzEWeZshVDamZm5ieyZYMljwdDRMT//ve/73rrJggh5EhUkXhaWtpFubm5O73H5Cjq/7du3Vo4atSoK7z/7lBBW2WPr2ryeOWVV/bfsGFDNiJiNBqNISJu27at4OGHH76yqn42qVmUNahFevfuzQBApKSkIEBF/ZXaBWOapgkAdk5OjgF1azkN5XVWVlBQ8ENeXp7DGDMMw4CioiLHsiy89tprhzdt2rQbDS6EkKOlSipatGjRQNO0AMBBM1jxcch1XXG4e2Hbtm3bMcYSDMPAyhyL0tPTRSgU0mfOnLl83Lhxt61bt255YmJigm3bZseOHVtee+21z5577rmnjhkzhtGOakKqZjamIaLWq1evXvv379/mmX0Jy7Jw3rx5H8hZjq+uPrc77rijUU5Ozlz53JxYLMb37dvHERG///77EADQIdCEkKOiemCFQqG/FRQUOLL/VbzJqOy758oM1sZu3br1Y4z9rqhc9eJ76qmn0hYsWPAFADSpilMmVO+r6667rr86qcOqgN9+++13UJHtpywWIZVNfegHDx58ye7du/epDDciYllZmXjvvffSvR/SukYFhgsXLnyirKwMOefCcRyUB0GLbdu2FXfu3LkvIjKqxyKEHInqyL5s2bJ0GUe5nHP0rhKqAGv79u0rAaCLrutw4Piiap/eeuutrllZWZiVlfUNACQZhgGDBw8+3Hh7rOMUU+P3TTfddPH27dtzZZDlRKNRnDRp0nh6VwmpAqouYOTIkX/cs2dPiffIh9LS0tjjjz8+wvt1dfD5aYjIOnbs2HP79u3rEBEjkYirBkLLssSXX375UV0OIgkh1TppCwAA7Nmz5w05jNiye/pvjiJERNyyZcsaAOh+qHNcVQ3op59+OhoRcenSpV8DQEvGGFT2hE+Nb/fff/81eXl5e4WoaDwfi8Vw9OjRd9M7S0glU2dqvfbaaw8VFhba3gCrpKSkePDgwZcAQJ3umaIGxIKCgs/loOKobBYi4p49e/aeccYZ5xwsjU8IIQcbTzjnb6kAC39PZbAWA0BjwzAOGjCpP3vxxRdPWbt2bQEi4jfffDMVAJp5/74SH7shx/2/7dq1y0FELC4uFmVlZdaNN944RMV99C4TUgnU+VizZ89+IxKJoDfA2r9//y4AaC0L3uvsh27ChAk+xhiMGTPm5sLCwnJExKKiIqFS+pZl4XffffcuwK/1FYQQchDM5/MBAPi2bds2HRHRNE3HW3/lOA6qc1wR8TNvUHaw7yf/G/j888/flN8Pv/766y/bt2/fpiomt2qMmzlz5r9LS0vjZyguX7587WmnndZOZtWoXIKQE7Vp06YAALCcnJxpnvorgYi4e/fujd5ZT10eFGXLBmP//v0/CSGQc85lHRZHRNy7d29O165d28m6CMpiEUJ+Jy0tTWeMQdOmTXtkZ2evUiUHMjOOnqVCBxHRcZzPjxBggWyBA+vWrRtcVlZmImIEEfHbb7+dAQANAaouk7VixYr3ZFDHo9Eozp07dzrUzbY8hNQ+W7duTQAAiEajMz2pbSF3wKzyznjqMpWpmzlz5viysjJRMdkU6DiOOvWeT5s27fl6ElASQqqAqkX95z//OXTFihW7ZRDFVYDl6bPnuK6LO3bsmHwUAZbaxZe6cOHCD+W/j9i2jV988cWzvXr1Sq6KZqBqA1B+fv6C4uJiRES3rKzMGT9+/BOev6cgqw6i9GPtwDp16sRbtmyZhIjJAL8eUoqIUFxcvL++PNEpU6Zwxhh88skn3yJiOQAwx3FQCME45yI1NVU7//zzr73ttts6AACnWixCyIFUD6wOHTqkGoaRAgBgGAZ4Gxa7rgsAoJeUlOCWLVvyAACys7MP2WhKHtllMMbKOnXqNKOkpMS2bdvQdZ0PHjx49N133/0YYwwre0xijDkZGRlG69atb83Pz98MAHpKSgq7++67H3v99deHM8YclV0jhByjtLQ0XdZXdc3Pz98gu51zIQSGw2F87733XgaoN7vr1DJhwp49e1bLtLhQs07TNHlxcbH45ptvnpUBJg0shJDfUJuCQqHQLXl5ea7aiexdIoxGowIRMT8/3x4/fvx9AEdeBVC7nc8444w2q1atmivHJQsR3W3bthU//vjjl6hxrLKfk2EYMGzYsPNycnJ2yP6HoqSkZO9//vOfcxhjtLuakOMNsDRNg3PPPfecgoKC7bJ/CxdCYElJifvUU0/dL4ONepFxVMXus2bN+kil8r0pfUTE9evXZ910003dEZFRFosQ4qWW1RYtWnRPeXl5vGbVdV30LBMKRMSCgoKyJ5544jYAgBEjRviO4nsbAAALFix4oKioCBHRNU2TIyKuWrVqa//+/U+rirFY1Xc9+OCDN+bl5ZVYlmUhIq5cuXLta6+91knugKQgi5DjmY098sgjN23btq1Ezsa4zO7ELr300stUt+H68Hxlt3b2/PPPPxYOh10hBMqCd5Q7KJ2ysjJn8eLFf/cOpoQQIscEPwBAfn7+Y94WDd4eWLZtq/Yv27t37z7gUD2wDhboGIYBf/vb3zrn5OSskrWwbnl5uZABz3I1Ma6isRH+85//jJZPwzRNE0Oh0Cenn35684yMDIMaMRNybB8qPwDAhx9+eN+OHTtc77KZaZpFAJBcn05aDwaDGmMMLrzwwqHRaLRMzjiF67poWRbGYjEbEXHNmjXzunXr1hYRNRpUCCGeAMsHAFBaWvq0DKwslblSLV845y4iYnl5+S8AkCCzTkc1jqou8fPmzQuWlZWh4zgiGo3GdztPnDhxjDcgqkyapsFVV13VYMmSJdNkoBjZt2+f+9VXXz0in/tRPw9CTnrqw7xkyZIXZFaYx2IxIYTAffv2FXo+VPVpgNSgYhvybm/PLzmgoOM4VjgcdlauXPkn+fWUGieEAPx6Zp9v3bp1H8gAy1aZcBlUxYOhvLy8bxljqhXO0U4CDcMwYOjQoafu2LFjozrXUAiBtm3zwsLC2D333HPD0WbFjnUCCgAwfPjw3itWrNgmd5Q7O3fuLH3ppZf+TwVhhJCjCzb8AADZ2dkTDmxDvHbt2jXwa2F4fXrOOgDA/v37d6gCVVU/wTlHWzbHWrx48VcA0KwqjqwghNQ9ahxISEhov3z58oVyUvab83FM00TZGwu/+OKLVwGOvc2NypItX758vFx6FMXFxei6rupPmAMA7Q92vmElPEcDAOCDDz64Nicnx1Y1uWvWrNkzderULvVx0k1IlVBp5qeffvqaF1544fl33nnnjQULFiz56aefskOh0ETvoFLfnvPKlSt/Urt+vCl++XvLsiy+du3ay7xBGSGExstbbrnl9JUrV26QBe3xAEueDCFk42IzPT39b96g5ViCHMYY3HXXXVcXFBTsV4Xzsk6UCyFw7dq1nwP8ugpRiZhhVDzc7777Tp21GEVE/PLLLz8HgAbq6+iKIOQ4PmCeX/V2kPz5558XqEGRcx6feUajUQyHw67spPxD//79m8kgiwYUQijAgkcffXTQmjVrdiAixmIxzjlHy7LQ07gYy8vLdwJA9+PNMqllxdzc3JmxWAwRkVuWFa+R3bNnj/niiy+OBPh1s1JlUUuPCQkJHTIzMxfL7L6FiPj+++8/Q+MhIeSwg+TcuXNnxk9ldV2UhaRo2zZaliUQ0dmzZw9OmzZtkBxQKC1OyElM9YN65513Ls3JySnzdnFX55qqDFNBQcFaOW4cVw2nymLdc889NxQVFYVVOYOcFKrWDSt79+7d3ufzVXrRe2Zmpo8xBlOnTr1u586dUfXcSktL8emnn779gCCr3k7ICSHHQAVKkyZN+u9Bdv/ED2s1TdNFRJwyZcoHlT1DJITU3QBryZIlw0pKStRxOMJ1XbRtO15qYJqmmDZt2n8BTii7xFRpws6dO1fLYnchhMBIJCIQUZSXl+OMGTOeAQBWFceZqeN9duzY8aJt21zWp4rt27eXjxgxooMnuCKEkF9ryiZOnDhBzTq9PWxU89FwOIyu64q8vDzz2Wef7XHAjI0QcpJRQUxxcfGfVU272iDjum58HIlGo5G0tLTBsofgcWe+Q6GQjojsueeee8CyLEdlymKxGDqOwxGR5+fnbxkxYsRZjLFKrxVNS0vTMzIyjJSUlFM3bdq0VgiBlmVxIQQuXLjwZwBoLies1L6BEPLrEuGcOXOme7NXqsDdm9Vy5Yj58ccfv4mImve8MULIyUUt9+3bt+9vMtNteidmaglv165dW+TXa5XwMxkApBQUFOxU+3Acx0GZNXMQEX/66adJHTt2bCQfX6UOUpmZmT5d12HSpEm3hcPhGCKKcDjMZY3qZDmm+gGANgIRQgFWRTf3TZs2rfMGU6rgXQ1eruuiLF7lu3fvjjz00EPtaZZGyEmLyXNbjSVLlryuemCpjLfnVAhn3LhxzweDwUppUhwMBjVd1+G99957yXVdxztWua4rOOd2QUFBeMqUKVd5g8AqCCzZggULvozFYq7sl+jati2++OKLh+TXUIBFCM1CUWeMgW3b+aqTu0x9x7NYjuOg4zgqHc8REV966aUnaYmQkJN23GAyg500b968ibLWyjmw1Us4HHZbtmzZorKDOwBoHg6HUQgR35Ajf7aNiLho0aJZ//znP5sjolbZ45Q8iFpPS0s7NRwOh1X/L8dxREFBQewf//jHOT6fj84rJORkHyQRkTVu3Lh9LBYr/LX1lfAe+vwbQggMh8MiPz9/X69evfz0KhJy8lHZqKFDh3ZcsmTJEtmiwfXuICwvL3enTZs2rSp+PmMMpk+f/ollWcJxHIzFYur8VCwvL3cKCwtxxowZd6hxDio5265KK6ZOnfqGZVmOPGKMO44jVq5cuQQA2iOiTk2ZCTlJqeXBv/3tb/+vtLTUVgWqR6KCr8cee+zPQFuSCTkZJ2caAMDDDz/cZ/HixVtkMTtXhe0qi3Xbbbd1qIogIxgMahdffPEZcmlQ1WCht5v8jz/+uPKtt95qVVWnT8hdlKn79+8vV7saTdN0XdfFhQsXfggAPjqvkJCTlNoF9MMPP3ymslZqkDoUNTu1bVtkZWVt8s5mCSEn1eQMvvzyy3M3btwYQ0Ru27aQx+JwRMSpU6e+V5WPIRgM+n/66adsVdpgWVY8ixWJROxYLIbTpk37I0CVnRnIAABeeumlRzyF/RwRxb59+9xPPvnkT95xlhByklDdiQcPHnz+jh079qgVQNXB/VBc143XZ5mm6d58881XU5BFyMlFFXEvWbLkkrKyMkREYdt2vDXDrl27cOzYsW0AQKvKWs1nn312uMpaqWyWPEPVRUScM2fO/MsvvzxVPuaqeBwMALQtW7YUqh3YMsjCDRs2bB01atTZcnykeixCThJM7a5ZtGjRx7J+Qhwpe6XIoypQdk9eDPBr00FCyMkTYM2ePXtofn5+FBGjlmWJ8vJy4bouTpgw4R8AFbVSVfTzmfz5TTZt2lSOiIJzLtTpE3Ii6MRiMXzzzTfPq8rHAgDw5JNP3q5aU8hNQg4iYmZm5peNGzduqGkaTUIJOQkGRqYGpxdeeOHve/fujcilP6HOITwSOUMUsu6idODAgRcgIlNZMULIyTVh69GjR5/nn39+9LRp0ya+/vrrr6SlpTVUf1fFP1v/73//+6y39kpNAm3b5oiIn3/++bT+/ftX6TJdKBRK3Lx5cxnnXJSWlqpx1EREXL58+V/l2EuTUEJqC03TKjWtHQqFdFmLoL344ov37tmzJyy3OXNVlCp3HR8xwFL1Wo7j4IIFCyYDUK0BIaR6J4sAAHPnzu0bjUZFxf6bih5cpmmqTLsoKCjAl19+uRmcQBf5owkyx40b9w+5i5GHw2E1rooVK1asPe+883p7HzMhpCanhJ50tlx+O5EPJvM0vkuYNGnSw/n5+S4iimg0yi3LwqNdHlS7COWB0FwIgaWlpbueffbZPpTFIuTkHbJkfyitupbCVLBy1113tfz++++XyqU51zTNeH8sWXAvXn/99b9BFXVXV4+jpKSk8ZYtW/Yhous4DlqWVRHxIeLSpUunTZgwoYEc1ynIIqSmZ2ZTp0697ZlnnrlQ/pnvIMHLET+oEyZM8KnU9HXXXdf9m2++eWfv3r02InLXdTkeJ7Vbx3VdjEQi+N13330oHyelwQkh1TlW+r/55pu71Ea+WCwWrxMtLS0VQghctWpVXrt27RKreELsf/fdd0errvaecgsbEfG99967Ny0tTacsFiE1JBgMGojIHn300d4bNmwozcvLW//222//n/r7jIyMBNW/6hABFktLS9OzsrL8iBhvBDpu3Li0zMzMVWqVz3VdcTyBleqTpWaJiCgQUaxYsWLlNddccyplsQgh1UW1i5g/f/4Zu3fvNhHRtSxLyOxRfNyKRqN45513XgdVlD1SQdP06dPPKigoMDnnjsr0ywJ8e/369fm33nprO5npoyCLkBqYkekAAN99993TJSUlDiJibm5uyZo1a17q0qVLH/V1Pp8PEDGQlZXlD4VC/qysLP+mTZsCB35wX3nlleuLi4vH5+bmhuXyni3rFY6LakZ6wJIiLy0tFdOnT39OPgfKYhFCqgNjjEFaWlrz7777bpZs+Omo4748p1KIadOmTWOMVVkdFGMMRo0alfz9999/LMsvbM+ZjBwRMRQKvc4Yq9IdjYSQg0hLS9M1TYO///3v3VatWpUtd8NYagaWm5ubtXv37vcGDRp0HgAkH+LbJJ5++unn/vDDD/8qKyubtGXLlhIVBZWXl7vRaPSourUfKcBS30P2nnFl35d1t912W09E1NTMkhBCqmNSumrVqjvlmGSpMUoGXCiEwKKiosKkpCR1LiKrgsehAQDMmTPnsn379qHjOK53Z7Zt23zv3r1WWlpaf8ryE1LNMzFPb5cHwuGw4JzbpaWlaNs2tz0po127duXt379/mWVZM1euXPnxF1988cIPP/zw1o4dO74sLCz8adu2bduKioq8favsWCwmVCO+EwmwDvy3tm2rw1adSCTC58+f/5QcbGhHISGkyskmnuzrr78esmvXrhgicpWl9y4Tuq7rjhw58nb5b6rk+B5N0+Dxxx9vumjRotlyfHRUkKcey6xZs76ld42Q6h0kNMYYXHbZZe2XLFmyWH04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7JWvL6NNch6a/KyWZcWK++VMN0SMLUR5eTnOmTMna/To0R8vWrTolgkTJnR+++23zwGAVuvXr89xFlnXl1cmZytmZGQsv+eee05ughEsIkcVnXfeeSeMHj3649zcXJ8sALcsC8PhcOzZrGo2Y03XUH7Juq709PT2sL8rtNbWUTZprFixYuFBhG8PeP4UFBRqb4/LDIVpmjYi4po1a6YAQAvRPa/ShLUZoldLcCACgUCljGBJCYOm7k3369ePer1ezTCMwm7duj3bq1evR3NycnaYpgkJCQkg65WEcCkwxmK1U4gYq58CACIOQpaYmMhuuummCx999NE3r7vuulmdOnVaef/990+dPn36qLZt27b3+Xz7Q6Sirsa27TotWhaRFwQACAaDxQsXLjSb2G0ihmHgDTfcQL///vvLP//88xGPPvrom+eff35zkbrTZGG6877Yth2LstZ0faPRKFiWFRu1pGka3759ew9CCFaj0eEIbxcmXnrppReIGjHUNC0W7QSAA+rDFBQU6sReyg12RteuXU9njIGSalAEq05RUVFRKQnVsdTF1K9fP04pJenp6e7JkydnvP76649PnTp1ZFlZGREF0lwWGGuaBowx2ZUHHo8H5HxGsh+62+3WOefctm3KObfOO+88z9VXX33e7bfffseJJ56Y7PF4gHMOpmnGDsq6PDDFPUMAgFAoFPD5fLSu37O2kJqaqhuGgZTShDlz5vzfdddd99vtt99+O+ecUkoxISGBAAA4U66ICAkJCTEl/tpIZctUruws5ZxrqampryBirWmKeb1ejRDC77jjjpssy0qUhF52uOq6HiONSgdLQaGWvTgRMPD7/ShtOufc3a5dOwMA4MILL1QESxGsukNCQkKC88BpajVYh+MhPXr0sNLT0/WZM2cu69Gjx+tLlix5Y9euXVG3261FIhFmGAbYtg2GYUCzZs1i4pQyoiU3qTiINV3XDc6527ZtME2TSx0tWQ8kD06Xy1WnZEdcDwIA6LqeDwDRpkCuvF6vMX78eEYpTR4zZsxHl1xyybhzzz23LQBQTdMMTdMI5xxcLhckJibGfo9zHnMA5P2o6VgZGUWSrwcA0KFDh9M/+eST52QKvabo3r27BgDk2WefvVvX9SRJ2h0kWUFBoY7hdrul2Ci2bNnypJtuuqmNWhVFsOoMffv2RQCASCTik/pN8oA+1jzpHj16MK/Xa2iaVnLfffcNmjZtWu/8/Hx/SkqKHgwGqWEYQAiBcDgMnHNwu90xcuWMLMiD2DAMcLlcxOPxaC6Xy5AaK5qmgYOv1hmkxpeu6xwA4Oyzz14DAJRz3qjnEKalpbn69+9PGWMnzpo1a+i99977auvWrRnbr1NgOElPvBfqdrtrfU6fmFkY+14owPOrrrrqGTGTsMaMtXv37oQQghdddNFFiYmJBADQOR8RYH+xfV02QygoHNeHvqZBUlISkVH/Fi1atOrYsWNrAIATTzxRRbAUwap9SOO+fv36HEIIOoU5j8VakH79+tGHHnpIR0TjhRde+GHkyJFPb926tSAxMVG3LIuK8TmxqIlch8a6FsJYEM45tGrVqhQAYNy4cY32+U5LS3P16tXLvvXWW89csmTJ6JtvvvnJxMRExhgjmqY1iKKys+5Jpu08Ho928cUXn92tW7dLnfvkKO8RAQCKiG3btGlzmrI6CgoND8uy0DRNqlZCEaw6PaMBAPLz8zfruo7ONMmxKn4oVOGxZ8+eSe+///6E77777uX8/PyShIQEPRAIMNk2b5omaJoGoVCoUUbzRHoMAYAEg0GQ9VeN9kFDJL169bJfe+21Gz/99NOp11577c2EEO7z+TRtv3ZGg1yXs+ZQpBAAAKBFixYpf//73/8BADh27Fi9Bs+bpmka3n333Ve43e5WyuQoKDSK4AIhqqOkTqDi8HFgjG0AAEoIccvOrIYclVMfH7miosJERIMQMlnXdc+LL76YduKJJ7YKBAK0efPmhoxcJCcn17mW1dHCNE3weDxGWVmZvX37dgsAIDU1tdHdNETUCCF8+PDh1915552/nHDCCa1s2+Yul4s0a9aMiO69BokUOiOUstHBtm10uVyka9euNwNA+9TU1F0gVKCP9PUrKio0RGTdu3c/NxqNJrVo0UIZHAUFhWMWKoIVhwULFtBAICAPw+NibIdjvqE+cODAcV9++eULJSUlFc2aNTPC4TDXNA2CwSDout5oa2OE1ASprKwsWr9+vR8AoG/fvo3NUwRCCP/3v/998+WXXz7B5XK1AACu7Q8LkmAw2KBpWNlVJOvtRFchAQBISkpq+e67794rIp5H9RC0atWKAABccskl5yYkJLjksiiro6CgoAjWcYI9e/bscR6KtaEx1ATuPwqS5f7www/To9HoOEIIRKNRRinFxMTEWF1OY4RhGBwAoLy8fPMnn3xSIQhWo7lYMbsRnnjiiXvuueeery+66KITRH2bZpomlJWVQXJyMkQikQYl9TJyJTXgZCF9UlKScffdd98OAKRnz55H9dqXXnopAQC4+OKLO4rolRo6qKCgoAjW8YSdO3fmSWkChy7QsfhR/8AaCSEWIhrnnHNOr1WrVv3SunVrl2VZsZo0MUmoUcEpMsoYyw+FQr7GJFQptJ+wV69et/Tu3fvfl1xyydmMMXS5XJogL9CmTRsghEBKSkqDPGuMsZgchzNKKURiERHhnHPOuf6pp56678orr7S7det2xFGsc889FwHAOOGEEwz52gpNG0ciY3OMSd7U6fo5xIORMRabKgKO1Lzz9440CCCbuGQQQdVgKYJVnwQr1zAMYIyhVHQ/HlKFEn379uWIqF111VV/3717986kpCSNUoqEkHqRXaiJkXK73RUA0GjmEHq9Xq1fv3588ODBV7788ssju3bteomQlPiDTatKkqG+4Ez/6roeuw4hw0Gi0Si0adOm+QsvvJCKiDB//nxypOug67rlcrk67d27t53k88raNP7Dv6oveUCLOr3Y4S5tpW3bEI1GYz8nf0dOClCAA9YLAGLryIXCMCGEa5pGdF0nuq4Tka4nnHNqWRYPhUKxdXWu7eGIlpBfkRM6UNM0cLlcOgBA9+7d1U2pRagi9yqwe/fuTQCATk/+eDIKQvPI0HW9YMKECf95+umnv0pJSQHOOUSj0RoPFa51L0HTwO12cwCAs846a+P+gAwzCCEN2k3o9Xq1/v3786effvr0Bx54YHabNm1aUEpRDNluMs8DIQQSExM5AGinnHJK1yuvvPI8l8uVBwA6VDPNl5OTQxARunbt2kLTNLeyMk0X0umUmngyWixHLEkNNefhr+t6TL9NBUsOJFjSmTFNk7tcLubxeFyapmmWZUFZWVlUDFvXAQASEhJSWrZsaei6Dh6PhyKizhgjclC7rJ88lKMmHWVBxLRgMMjKysqiAADz589XN0URrDp/6DOEd40OEcvjag369etH09PT9R49enx9+eWXP3LVVVd1MwwDXS5Xo7OOIkWoUUohEAhEGsM1paam6h988AE74YQTTnnmmWdGnH766S0IIej3+0nz5s2b3PPAGNMIIbxNmzZnfPzxx0/eeOON70+bNs248847q0WwOnXqRBARLrnkkraapiWpCFbThbSHch6m0EsDgP3yHvKgF1mAA5onamPiwLG0jnJqBmOMpaSk6ACgFRQUVOq6vnTnzp05K1eu3LJnzx5fUlKSixCiX3rppe0uu+yyLoSQ604//fQTAQAsy+KEEM2yLPB4PIddX0nqhLSNFo1GK7Zv3+5Xd0QRrHrBBx98sHPv3r3RU045xSPD4MejUejRowdHRP36669/ZfTo0UtPPfXUJGksGxNs20a3223s3bvXkoaigT0xLT09nRBCUkaPHv3Zdddd1w0ROaWUNMYU6xE4HrxZs2bGxRdf3BURW9xxxx0hqKZkw6mnnkoAAM4777yTASBZWZmmDZnWkgPiLcsCxphsNuGibk+jlOoJCQmAiEqdPw4iooeEEKrrumvLli1B0zR/nTRp0qT3339/wqF+980337zzwQcffKVt27Y3tG/f3s0Yo0lJScbhzisZVdQ0DSzLklM6yleuXFkJADB06FCVv63Ng0AtwR/x+uuvky1btmyWh0djJBX15WQRQtjixYs3LFy48Gdd1xtlLRpjjAMAKS8vL1qwYEGpIFgNVUFNpNbVuHHj+t54440Pc86pbdvEMAwiPfymeBgYhqEDAI9Go1ekpaXdpWka9Xq91docsvPwnHPOOTkxMdEloo4qgtVUDw4RiRIF2IwxZosaO83lchlJSUkut9utO8sJCCEH1Gsd74hEIpwQQnRdd61du3ZZRkbGXzp37vz0+++/PwERtaysLHdaWporIyPDkH+mp6e7EdH473//O61r166PzZ49+8m1a9cWGoZhWJbFbds+ZDBANmyJe8ABACilxbNnz65Q21GhvqCPHDnyO0REy7IYNhAopdirV69H5d5oqMVITU3Vb7vttjP37dtnCc+0UYFSaiMirlixYvHJJ598JsD++qcGYaSIOiEEhg8f3jsQCFiUUoaIjHOO0WgUGWMYiUSwqYExFltrzjlu2bLlRwDQELFa65yXl+cBAMjNzf2eMYaUUsY5R4XGC875H74opdy2bcYYs23bNqPRKHX+zpo1a3bOmjVr2s8///zNunXrljHGeDAYZJZlxZ4jdd8RKaUUETE/P983adKkjy+++OKzhP3QMjIyjMPYe+L1eg1JpN59991rli1bNgcRMRKJULnWh9vPpmnanHPcuHHjKABwiwijYlm1CBWzPUhQZM+ePfki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978P79atW/qiRYueWrhw4bxoNGqkpqbqycnJjhCCJ1qlnBDC0XVdmz179oJ77rnn3405vPayyy7jQghj2LBhP7Vp02YVAEBqaqpgjDVq2w+i+eA9W7IJsa3r+kF5Yxlj3t57DADAMIzWp512WhKtOClYCX0eXNc1GGMRn8+30nEcxuohA9jbAFP9HL/f3/q4445LBgBIT09vtA+oftYFF1zQ9ogjjugAAKhpGpOHFgEAIpFITaI8kMzMTO3hhx/+c/fu3Z9wHIczxnzKEygV1oO2BPe3jNpTIi0AgPl8vsxXX311AwBojLFE6IGA5557rvPcc89pwWDQr2na5j59+rx+ySWX3PbLL788MH/+/PlCCJ9hGDoAuDLkuksovC5rUCv0DXtT1oQQ8eR61XNN9S2zLAsikQgAgK1pmm/p0qUbxowZM7CysnJbZmYmb8x1W7duna5pmr1x48YV0WhUyVikpqMtV0Hak3xwHCd+Bmr3EVSFJbIYRiCiLYtP/BUVFYbjOFy9vmma3l6JdVKwEBEcx4kbe4iot23blvQBUrASm8WLFzNEZCtXrlyzY8cOS9M0vT68WOowyQOEAGCkpqYesud3wgknpLVp06adVCqZt02DECJRzHXWr18//pe//CVw6qmntkVEXdf1eAdj7wV/CDwtQtd1ffPmzYXBYHAmAPBEy30YMmSI6Nevn/38889rubm5fsuyNl199dUZ999//61Tp069b+bMmVmIaOi6rmua5iKicF03flG4rguWZe2iQHkvgNptMbztHxzHAdM0433k1FQDXdfjjX2FEBAOhwERRatWrRwA8P/yyy9TR40alT5u3Lglf//73/XGXrNx48ZxIQT77LPPloRCoZimaZoQAuq7mpho+oqXJ/9p52Xs6TenaRpwzrGystLRduLPycnJz8rKenr16tXXuK5bIRV3ZIzFe+rty8Crbdj4/X4GANCqVat2Xbt2TQU4NBERgqgTgUBA0zQNzjrrrFNWr169VFZauQdT7WFZFtaaTehUVVXhkiVLrgbYOeqksT6f+lnTpk37y5YtWwQictM0hazGE4iIo0eP/iBRnsd///vfu6PRqCsrB9FxHBRCYCwWO+jKroOs8rEREdesWfM5ACSpWYCJvre977Nbt27HZWRk9M/KypobiUTihYWu6wpVYWjbNlqWFa829K4N5xyj0SjG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ous6+Hy+XZ4FjSuq+10AAA4AGDU1NUcCALiuS5dAI+1fmavDAAB69ux58RVXXHEuGWkHR/fu3e8AAOjQoUOnt99++y5E1AOBQKPLA+9zRMRWUl+gXlikYBG7IxgMAiLCwIEDH2nTpo2+u4RUEo6Nj1eplVYmhsPhKlqZOhkNmqZpon379t2i0ajKvyJDoRFwXTc+CBoA4JRTTukwcODAQYio5kES+8mFF17Y+uqrr+4vmw9jly5d/v7CCy9c0717dxsRG3wEgbc9gwwDMwCAaDR6ZJs2bTobhsEDgQBdEqRgEbt51uL888//w+GHH34ELcehVahU1SZjLJ4D59Vzt23bNolWat907dqVISLccsstxzLG2smLgZGh0PCoPEJvRez5559/+UUXXXTm4MGD6X7Zf7nALr300ttOOOGEw2KxGDiO4x511FFH3HfffQ9eddVVbQCgwRVXT8uYeFW5VLxan3feeZ0457Bq1So6XKRgEV5yc3MNTdPw5ZdffhQADt95npGpzu1UQdi4eBUqJdRUyGXz5s2RN954I4dWad9ceumlAABw5JFHJpum6VcXA9HwRoKu67t4sFzXhSOPPLL10KFDA9R49ICUG7ztttseEkKgruvg9/sNx3E4Y+zSW2655R7GGL/uuuv0Bn4Ptb9W30g+44wzDldGDT0tUrAIzznp1q2bQMT255577oVyphiqS50Uq8a/nHY5hJoGsou+AADx66+//kCDVfcPx3E4IlJyeyMbCLU8sejz+eC888677LzzzjtV3i90x9RBPgcCAe2666676NRTTz1D0zSWlJQEiMhs24aOHTvql19++SNffPFF1969eztZWVkNGircQ3g9rVu3bh0BALp160bPtI7QWPkWQCAQ8GmaZg8fPvwfpmke06pVK2CMaaqTuNfiV4KTvAANaNXINa+dK+Q4Dndd17dly5Z3Vq1aZauB3LRidVtWXdcZAIBpmuD3+2kPN4KSZRgGMMbANE1QDV51XW/91ltvBRhjtyGijzFGiu/eFRpN0zT+888/D5JyAFXhQEpKih6LxZxjjz32xGOPPXYg5/zxSy+91GlI2eCVS67rMr/fD61bt/Yfd9xx7elp7adQoiVo/tbR4MGDXUT03Xjjjde3a9cuRQghVIuA2peQ+j5Rf8Kqdmd89bW3ezvn3PX5fL5p06aNffbZZ+fTLL26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N998c0BhYaHKmBa1RpO0xGpCBxExGAxOad269RFyuRp1HwWDQd0wDDjzzDO7bd26dX0iy9zdyWDXddFxnLgCqAZQq+R127bjCe2u66JlWfGRP2VlZcUjRox4ThlKBNEiFKxbbrnllHnz5i1TJc2JWinoPeicczcWi7mTJ0/+CgAOk9YondrEhinFqF+/fufNnTt3uef5img0irZtx5UA13UxHA6jaZqubL1R+cUXXwy94447TvYoWfTMf3+uDQCAW2+99dpt27aVynMtvM0dm/Nsuz0pB9FoVCAiX7duXdGUKVNOPhSKOiIaAMBmzJjx38rKyl28O02hElCdT+8ZlYpUXKmqrq7GWCzG1RzIkpISJzs7O3juuedeqJRMOqVEi1GwTjvttBOzs7PnIWL8MktEAWmaO5vMx2IxFxFx+/bt63v37n0KIjLqndIklCsdAODhhx++KScnZ5VqC+I4jlCWsHrWtm3HPZau62IkEonvy/nz568YNmzYP+SFpQMV1exCenq6rmkadOnSpWthYeEGuYZcnZ/m2GepTvFB00THcSxExF9//fXSxlawAoGAoes6PPHEE103btyYj4jCbYKt9jnnaJomeveT+r70jtrq682bN6967733HlVeK0rhIFqcggUAHWbPnj1FWikJ25iwurpaHWAeDodjkyZNehmARuA0ATSVZPz222/ftW7dum1yr3HLsrx9cdBxHDRNM/490zSxpqYGI5EIOo4jlPAuLCysHDFixD3yktQoZLhbZTappqZmrrzsuDfE3hIVLBnCchBRjB8//uP09PSURn4mBgBos2fPHhyLxeINUJuacmVZFqp8MWUMcc7Rtm3uuq6NiLht27Zwdnb2iPPPP7+HMoTICCZanCCWVSu+uXPnvi+FkJ2oHiwZ++cyWXIzABwtlSu6XBPYm6K8TI8++uhtmzdvrkBErKysdGvPJlPPWIWDHcdBrwJmWRZaloWxWMzhnOOOHTvCH3300RMA4KcQ8a4UFBQkAwBUV1dPV0vsbfboDbm3kGajSqkUlmXxoqKiyNq1a49tLC9WVlaWoes6fPLJJ93Wr19fgIhuU2vqrDxXXoPINE2MxWJChQOj0SiuWLFifDAYvF55reTsRzqb9Qi5AZsG6Lquzhhzjj/++NUAgLquJ2S5rOwPgwDAKisr7aysrM8AoMg0TR9Q2X7Cekhf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rKio6PHtt99enZGR8fSoUaPefP/995+cOnXqFWvXrj3j/vvvP9Z7/lQLiOYus1RY9YYbbjhj1qxZWYiIS5cuXXLDDTec3AKUTIIgmhqIyGRSaJ2EtKZpgIi6/PdkLRJEAylaHn7X4qSl5hqpz/yPf/zjxBdffPG/Tz31VB8AoEplgiAS30qUCtduf5FCRRCNZ/R4+zip2Z3e9istVkjV6m9F/a4IgiAIgiAIgiAIgiCIhILcVUS9Qj09CIIgCIIULIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgCIIgEgKtS5cuSQDgBwBGy0E0Zf4fnOAOd/0V90kAAAAASUVORK5CYII=";
const inputStyleDark = { padding: "9px 11px", borderRadius: 7, border: "1px solid rgba(255,255,255,0.35)", fontFamily: "Inter", fontSize: 14, outline: "none", background: "rgba(255,255,255,0.08)", color: "#FFFFFF", width: "100%", boxSizing: "border-box", minWidth: 0, colorScheme: "dark" };

function useInstalarApp() {
  const [promptEvento, setPromptEvento] = useState(null);
  const [instalado, setInstalado] = useState(false);

  useEffect(() => {
    const jaInstalado = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
    setInstalado(jaInstalado);
    const aoFicarInstalavel = (e) => { e.preventDefault(); setPromptEvento(e); };
    const aoInstalar = () => { setInstalado(true); setPromptEvento(null); };
    window.addEventListener("beforeinstallprompt", aoFicarInstalavel);
    window.addEventListener("appinstalled", aoInstalar);
    return () => {
      window.removeEventListener("beforeinstallprompt", aoFicarInstalavel);
      window.removeEventListener("appinstalled", aoInstalar);
    };
  }, []);

  const ehIOS = typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent) && !window.MSStream;

  const instalar = async () => {
    if (!promptEvento) return;
    promptEvento.prompt();
    await promptEvento.userChoice;
    setPromptEvento(null);
  };

  return { podeInstalar: !!promptEvento, ehIOS, instalado, instalar };
}

function BotaoInstalarApp() {
  const { podeInstalar, ehIOS, instalado, instalar } = useInstalarApp();
  const [mostrarPassoIOS, setMostrarPassoIOS] = useState(false);
  if (instalado) return null;
  if (!podeInstalar && !ehIOS) return null;

  return (
    <div style={{ marginTop: 18, paddingTop: 18, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
      {podeInstalar && (
        <Button icon={Download} variant="gold" onClick={instalar} style={{ width: "100%", justifyContent: "center" }}>Instalar app neste aparelho</Button>
      )}
      {ehIOS && !podeInstalar && (
        <>
          <Button icon={Share} variant="ghost" onClick={() => setMostrarPassoIOS((v) => !v)} style={{ width: "100%", justifyContent: "center", color: "#FFFFFF", border: "1px solid rgba(255,255,255,0.25)" }}>Instalar app neste iPhone</Button>
          {mostrarPassoIOS && (
            <p style={{ fontSize: 11.5, color: "#C9C4B4", marginTop: 10, textAlign: "left" }}>
              No Safari: toque no ícone de compartilhar <b>⬆️</b> na barra inferior e depois em <b>"Adicionar à Tela de Início"</b>.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function LoginPreto({ logo, titulo, subtitulo, children }) {
  return (
    <div style={{
      background: "#0A0B10",
      width: "100%",
      minHeight: "calc(100vh - 66px)",
      position: "relative",
      boxSizing: "border-box",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "40px 20px",
    }}>
      <div style={{ maxWidth: 380, width: "100%", textAlign: "center" }}>
        <img src={logo || LOGO_CIRCULAR} alt="" style={{ width: 130, height: 130, objectFit: "contain", marginBottom: 18, borderRadius: "50%" }} />
        <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 18, color: "#FFFFFF", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>{titulo}</div>
        {subtitulo && <div style={{ fontSize: 12.5, color: "#8F97A8", marginBottom: 20 }}>{subtitulo}</div>}
        <div style={{ textAlign: "left" }}>{children}</div>
        <BotaoInstalarApp />
        <div style={{ marginTop: 40, paddingTop: 18, borderTop: "1px solid rgba(255,255,255,0.08)", fontSize: 10.5, color: "#FFFFFF", opacity: 0.7, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, flexWrap: "wrap" }}>
          <span>Desenvolvido por TECBM - Bruno Martins Tecnologia</span>
          <img src={LOGO_TECBM} alt="" style={{ height: 13, width: "auto", verticalAlign: "middle" }} />
        </div>
      </div>
    </div>
  );
}

function useEhDesktop() {
  const [ehDesktop, setEhDesktop] = useState(() => (typeof window !== "undefined" ? window.matchMedia("(min-width: 900px)").matches : false));
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 900px)");
    const ouvir = (e) => setEhDesktop(e.matches);
    mq.addEventListener ? mq.addEventListener("change", ouvir) : mq.addListener(ouvir);
    return () => { mq.removeEventListener ? mq.removeEventListener("change", ouvir) : mq.removeListener(ouvir); };
  }, []);
  return ehDesktop;
}

// Faz um elemento cobrir 100% da largura real da tela, saindo de dentro de um container centralizado
// (tipo maxWidth:980), sem depender de vw/% (que divergem sutilmente quando a barra de rolagem aparece).
// Mede a posição de verdade via JS e corrige com pixels exatos. Reagora sempre que o layout mudar
// (dados carregando depois do primeiro render, fotos, fontes chegando, giro de tela etc.), não só no resize.
function useFullBleed() {
  const ref = useRef(null);
  const [estilo, setEstilo] = useState({});
  const anteriorRef = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let quadro = null;
    const medir = () => {
      if (!el.isConnected) return;
      // Guarda o que já estava aplicado — se a medição abaixo concluir que nada mudou,
      // precisamos devolver isso ao elemento, já que o reset a seguir o apaga na hora de medir.
      const mlAntes = el.style.marginLeft, mrAntes = el.style.marginRight, wAntes = el.style.width;
      el.style.marginLeft = "0px";
      el.style.marginRight = "0px";
      el.style.width = "auto";
      const rect = el.getBoundingClientRect();
      const larguraTela = document.documentElement.clientWidth;
      const novo = {
        width: larguraTela + 2,
        marginLeft: -(rect.left + 1),
        marginRight: -(larguraTela - rect.right + 1),
        boxSizing: "border-box",
      };
      const anterior = anteriorRef.current;
      if (anterior && anterior.width === novo.width && anterior.marginLeft === novo.marginLeft && anterior.marginRight === novo.marginRight) {
        // nada mudou de verdade — não re-renderiza (evita loop com o ResizeObserver),
        // mas o reset acima apagou o estilo aplicado; devolve pro elemento antes de sair.
        el.style.marginLeft = mlAntes;
        el.style.marginRight = mrAntes;
        el.style.width = wAntes;
        return;
      }
      anteriorRef.current = novo;
      setEstilo(novo);
    };
    const agendarMedicao = () => {
      if (quadro) cancelAnimationFrame(quadro);
      quadro = requestAnimationFrame(medir);
    };
    agendarMedicao();
    window.addEventListener("resize", agendarMedicao);
    window.addEventListener("orientationchange", agendarMedicao);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(agendarMedicao);
    // Qualquer mudança de tamanho no elemento pai (dados chegando, fotos carregando, etc.) remede sozinho.
    const ro = new ResizeObserver(agendarMedicao);
    if (el.parentElement) ro.observe(el.parentElement);
    ro.observe(document.body);
    return () => {
      window.removeEventListener("resize", agendarMedicao);
      window.removeEventListener("orientationchange", agendarMedicao);
      ro.disconnect();
      if (quadro) cancelAnimationFrame(quadro);
    };
  }, []);
  return [ref, estilo];
}

function ProfessorDashboardDesktop({ data, save, prof, onSair, ctx }) {
  const [tab, setTab] = useState("dashboard");
  const [erroRelatorioAlunos, setErroRelatorioAlunos] = useState("");
  const {
    sessaoAtiva, turmaId, setTurmaId, turma, checkinsSessao, iniciarAula, encerrarSessao,
    editandoPerfil, setEditandoPerfil, nome, setNome, email, setEmail, telefone, setTelefone,
    endereco, setEndereco, especialidade, setEspecialidade, fileRef, onFotoProf, arquivoFotoProf,
    setArquivoFotoProf, salvarFotoProfCortada, salvarPerfilProf,
    editandoAluno, setEditandoAluno, novoAluno, setNovoAluno, senhaGeradaAluno,
    buscaAluno, setBuscaAluno, filtroFaixaAluno, setFiltroFaixaAluno, ordenarPor, setOrdenarPor,
    addAlunoProf, editarAlunoProf, resetarSenhaAlunoProf, alternarPresenca, ajustarAulasManualmente,
    graduar, darBaixaPagamento, desfazerBaixaPagamento, alternarAtivoAlunoProf, removerAlunoProf,
    alunosExpandidos, alternarExpandido,
  } = ctx;

  const tabs = [
    { id: "dashboard", label: "Dashboard" },
    { id: "inicio", label: "Início" },
    { id: "alunos", label: "Meus Alunos" },
    { id: "checkins", label: "Check-ins" },
    { id: "turmas", label: "Turmas" },
    { id: "financeiro", label: "Financeiro" },
    { id: "relatorios", label: "Relatórios" },
    { id: "avisos", label: "Avisos" },
    { id: "videos", label: "Vídeos" },
    { id: "produtos", label: "Produtos" },
    { id: "perfil", label: "Meu Perfil" },
  ];

  const meusAlunos = data.alunos.filter((a) => a.professorId === prof.id);
  const alunosFiltrados = meusAlunos
    .filter((a) => !filtroFaixaAluno || a.faixaId === filtroFaixaAluno)
    .filter((a) => {
      const termo = buscaAluno.trim().toLowerCase();
      if (!termo) return true;
      return a.nome.toLowerCase().includes(termo) || (a.apelido || "").toLowerCase().includes(termo);
    })
    .sort((a, b) => {
      if (ordenarPor === "frequencia") return (b.checkinsDesdeGraduacao || 0) - (a.checkinsDesdeGraduacao || 0);
      if (ordenarPor === "graduar") {
        const ra = progressoGraduacaoInfo(data.faixas, a.faixaId, a.grau, a.checkinsDesdeGraduacao, categoriaEtaria(a.dataNascimento)).restantes;
        const rb = progressoGraduacaoInfo(data.faixas, b.faixaId, b.grau, b.checkinsDesdeGraduacao, categoriaEtaria(b.dataNascimento)).restantes;
        if (ra === null && rb === null) return 0;
        if (ra === null) return 1;
        if (rb === null) return -1;
        return ra - rb;
      }
      return a.nome.localeCompare(b.nome);
    });

  const iconesTabs = {
    dashboard: "📊", inicio: "🏠", alunos: "🤼", checkins: "📍", turmas: "📅", financeiro: "💰", relatorios: "📑", avisos: "🔔", videos: "🎬", produtos: "🛍️", perfil: "👤",
  };

  const [refFullBleed, estiloFullBleed] = useFullBleed();

  return (
    <div ref={refFullBleed} style={{
      backgroundImage: "radial-gradient(circle at 15% 15%, rgba(201,162,39,0.05), transparent 40%), linear-gradient(160deg, #14171F 0%, #0B0C10 100%)",
      minHeight: "calc(100vh - 66px)",
      ...estiloFullBleed,
      position: "relative",
      marginTop: -22,
      marginBottom: -60,
      display: "flex",
      overflow: "hidden",
    }}>
      <img src={LOGO_CACHORRO} alt="" style={{ position: "absolute", width: 420, right: -110, bottom: -70, opacity: 0.05, pointerEvents: "none", zIndex: 0 }} />
      <div style={{ width: 220, flexShrink: 0, background: "#000", borderRight: "1px solid rgba(255,255,255,0.06)", boxSizing: "border-box", zIndex: 1 }}>
        <div style={{ position: "sticky", top: 0, padding: "20px 12px" }}>
          <div style={{ padding: "0 6px 16px", marginBottom: 10, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ fontFamily: "Oswald", fontWeight: 700, color: "#fff", fontSize: 13, textTransform: "uppercase", letterSpacing: 0.4 }}>{data.academia.nome}</div>
            <div style={{ fontSize: 10.5, color: "#9B9891", marginTop: 2 }}>Área do professor</div>
          </div>
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
              padding: "10px 12px", borderRadius: 8, border: "none", cursor: "pointer", marginBottom: 2,
              background: tab === t.id ? "rgba(201,162,39,0.12)" : "transparent",
              color: tab === t.id ? "#C9A227" : "#9B9891", fontSize: 13, fontWeight: 600,
            }}>
              <span style={{ fontSize: 15, width: 18, textAlign: "center" }}>{iconesTabs[t.id]}</span>
              {t.label}
            </button>
          ))}
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
            <Button variant="ghost" icon={LogOut} style={{ color: "#F5F3EC", border: "1px solid rgba(255,255,255,0.2)", width: "100%", justifyContent: "center" }} onClick={onSair}>Sair</Button>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, padding: "24px 28px 40px", minWidth: 0, color: "#F5F3EC" }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 21, color: "#C9A227", textTransform: "uppercase" }}>{tabs.find((t) => t.id === tab)?.label}</div>
          <div style={{ fontSize: 12, color: "#9B9891", marginTop: 2 }}>Logado como professor · {prof.nome} · só os seus alunos vinculados</div>
        </div>

      {tab === "dashboard" && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 12, marginBottom: 14 }}>
            <StatCard label="Alunos ativos" value={meusAlunos.filter((a) => a.ativo !== false).length} icon={Users} dark />
            <StatCard label="Turmas" value={data.turmas.length} icon={CalendarCheck} dark />
            <StatCard label="Check-ins hoje" value={data.checkins.filter((c) => { const al = data.alunos.find((a) => a.id === c.alunoId); return al && al.professorId === prof.id && dataLocalDe(c.dataHora) === hoje(); }).length} icon={QrCode} dark />
          </div>

          <AlunosPorFaixaChart alunos={meusAlunos} faixas={data.faixas} titulo="Meus alunos por faixa" dark />
          <PagamentosChart data={data} alunosFiltro={meusAlunos} dark />
          <AlunosPorMesLineChart data={data} alunosFiltro={meusAlunos} titulo="Meus alunos por mês (matrícula)" dark />
          <AniversariantesCard alunos={meusAlunos} dark />
        </div>
      )}

      {tab === "inicio" && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 12, marginBottom: 14 }}>
            <StatCard label="Meus alunos" value={meusAlunos.length} icon={Users} dark />
            <StatCard label="Aula ativa" value={sessaoAtiva ? "Sim" : "Não"} icon={CalendarCheck} dark />
          </div>

          <Card style={{ marginBottom: 16, background: "#171C27", border: "1px solid rgba(255,255,255,0.07)" }}>
            <div style={{ ...blockTitleStyle, color: "#F0EEE8" }}>Aula do dia</div>
            {!sessaoAtiva ? (
              <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
                <div style={{ flex: "0 1 260px", minWidth: 160 }}>
                  <Field label="Selecionar treino" labelColor="#9B9891">
                    <select style={{ ...inputStyle, background: "#0F1218", border: "1px solid rgba(255,255,255,0.12)", color: "#F0EEE8", colorScheme: "dark" }} value={turmaId} onChange={(e) => setTurmaId(e.target.value)}>
                      {data.turmas.filter((t) => !t.professorId || t.professorId === prof.id).map((t) => <option key={t.id} value={t.id} style={{ background: "#1A1D24", color: "#F5F3EC" }}>{t.nome} — {t.horario}{t.horarioFim ? ` às ${t.horarioFim}` : ""}</option>)}
                    </select>
                  </Field>
                </div>
                <Button icon={CalendarCheck} variant="gold" onClick={iniciarAula}>Iniciar aula</Button>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 13, color: "#9B9891", marginBottom: 4 }}>Aula ativa — os alunos já podem fazer check-in por localização</div>
                <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8, color: "#F0EEE8" }}>{turma?.nome}</div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: "#F0EEE8" }}>{checkinsSessao.length} aluno(s) fizeram check-in</div>
                <Button variant="danger" onClick={encerrarSessao}>Encerrar aula</Button>
              </div>
            )}
          </Card>

          <RecadoMestreProfessor data={data} prof={prof} dark />

          <AlunosPorFaixaChart alunos={meusAlunos} faixas={data.faixas} titulo="Meus alunos por faixa" dark />

          <AlunosPertoDeGraduar data={data} prof={prof} dark />
        </div>
      )}

      {tab === "alunos" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
            <div style={{ fontSize: 13, color: "#9B9891" }}>{meusAlunos.length} aluno(s) vinculados a você</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button icon={Users} variant="gold" onClick={() => { setErroRelatorioAlunos(""); if (meusAlunos.length === 0) { setErroRelatorioAlunos("Nenhum aluno vinculado a você ainda."); return; } gerarRelatorioListaAlunos(data, setErroRelatorioAlunos, meusAlunos, prof.nome); }}>Lista de alunos (PDF)</Button>
              <Button icon={Plus} onClick={() => setNovoAluno(true)}>Novo aluno</Button>
            </div>
          </div>
          {erroRelatorioAlunos && <div style={{ marginBottom: 10, fontSize: 12.5, color: "#FF8A80", fontWeight: 600 }}>{erroRelatorioAlunos}</div>}
          {!sessaoAtiva && <p style={{ fontSize: 12, color: "#9B9891", marginTop: 0 }}>Inicie a aula na aba Início para poder marcar presença manualmente.</p>}
          {novoAluno && (
            <PersonForm tipo="aluno" planos={data.planos} faixas={data.faixas} professores={data.professores} unidades={data.unidades} turmas={data.turmas} initial={{ professorId: prof.id }} onCancel={() => setNovoAluno(false)} onSave={addAlunoProf} />
          )}
          {editandoAluno && (
            <PersonForm tipo="aluno" planos={data.planos} faixas={data.faixas} professores={data.professores} unidades={data.unidades} turmas={data.turmas} initial={editandoAluno} onCancel={() => setEditandoAluno(null)} onSave={(form) => editarAlunoProf(editandoAluno.id, form)} />
          )}
          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <input style={{ ...inputStyle, flex: 1, minWidth: 160 }} placeholder="Buscar por nome ou apelido..." value={buscaAluno} onChange={(e) => setBuscaAluno(e.target.value)} />
            <select style={{ ...inputStyle, width: 180 }} value={filtroFaixaAluno} onChange={(e) => setFiltroFaixaAluno(e.target.value)}>
              <option value="">Todas as faixas</option>
              {data.faixas.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select>
            <select style={{ ...inputStyle, width: 220 }} value={ordenarPor} onChange={(e) => setOrdenarPor(e.target.value)}>
              <option value="nome">Ordenar por nome</option>
              <option value="graduar">Mais perto de graduar</option>
              <option value="frequencia">Mais frequência (aulas)</option>
            </select>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {alunosFiltrados.map((a) => {
              const { emDia, plano } = statusPagamento(a, data.planos);
              const idx = data.faixas.findIndex((f) => f.id === a.faixaId);
              const faixaAtual = data.faixas[idx] || data.faixas[0];
              const presente = sessaoAtiva ? data.checkins.some((c) => c.sessaoId === sessaoAtiva.id && c.alunoId === a.id) : false;
              const aberto = !!alunosExpandidos[a.id];
              const tituloSecaoStyle = { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: "#B0AA98", marginBottom: 7 };
              const secaoStyle = { borderTop: "1px solid #EFEBDF", paddingTop: 10, marginTop: 10 };
              return (
                <Card dark key={a.id} style={{ padding: 12, opacity: a.ativo === false ? 0.6 : 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }} onClick={() => alternarExpandido(a.id)}>
                    <Avatar foto={a.foto} nome={a.nome} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, color: "#F5F3EC" }}>{a.nome}{a.apelido && <span style={{ fontWeight: 400, color: "#9B9891" }}> "{a.apelido}"</span>}</div>
                      <BeltBar faixas={data.faixas} faixaId={a.faixaId} grau={a.grau} textColor="#F5F3EC" />
                      {!aberto && (
                        <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                          {!emDia && <Tag ok={false}>Pendente</Tag>}
                          {a.ativo === false && <Tag ok={false}>Acesso desativado</Tag>}
                        </div>
                      )}
                    </div>
                    <div style={{ width: 28, height: 28, borderRadius: "50%", background: "rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transform: aberto ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>
                      <ChevronRight size={15} color="#9B9891" />
                    </div>
                  </div>

                  {aberto && (
                    <div>
                      {senhaGeradaAluno?.id === a.id && <div style={{ fontSize: 11, fontWeight: 700, color: "#6FCF7A", marginTop: 10 }}>Nova senha: {senhaGeradaAluno.senha}</div>}

                      <div style={secaoStyle}>
                        <div style={tituloSecaoStyle}>💰 Financeiro — {plano?.nome || "sem plano"}</div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <Tag ok={emDia}>{emDia ? "Em dia" : "Pendente"}</Tag>
                          {!emDia && <Button variant="gold" onClick={() => darBaixaPagamento(a.id)}>Dar baixa</Button>}
                          {emDia && (a.pagamentos || []).length > 0 && <Button variant="ghost" onClick={() => desfazerBaixaPagamento(a.id)} style={{ color: "#F5F3EC", border: "1px solid rgba(255,255,255,0.2)" }}>Desfazer baixa</Button>}
                        </div>
                      </div>

                      <div style={secaoStyle}>
                        <div style={tituloSecaoStyle}>🥋 Graduação</div>
                        <div style={{ fontSize: 11.5, color: "#9B9891", marginBottom: 8 }}>{progressoGraduacaoTexto(data.faixas, a.faixaId, a.grau, a.checkinsDesdeGraduacao, categoriaEtaria(a.dataNascimento))} · {a.checkinsDesdeGraduacao || 0} aula(s) desde a última graduação</div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                          {faixaAtual?.grausMax > 0 && <Button variant="ghost" onClick={() => graduar(a.id, "grau")} disabled={a.grau >= faixaAtual.grausMax} style={{ color: "#F5F3EC", border: "1px solid rgba(255,255,255,0.2)" }}>+1 grau</Button>}
                          <Button variant="ghost" onClick={() => graduar(a.id, "faixa")} disabled={idx >= data.faixas.length - 1} style={{ color: "#F5F3EC", border: "1px solid rgba(255,255,255,0.2)" }}>Graduar faixa</Button>
                        </div>
                        <AjustarAulasInline onAjustar={(delta) => ajustarAulasManualmente(a.id, delta)} />
                      </div>

                      {sessaoAtiva && (
                        <div style={secaoStyle}>
                          <div style={tituloSecaoStyle}>📍 Presença na aula de hoje</div>
                          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <Tag ok={presente}>{presente ? "Presente" : "Ausente"}</Tag>
                            <Button variant="ghost" onClick={() => alternarPresenca(a.id, presente)} style={{ color: "#F5F3EC", border: "1px solid rgba(255,255,255,0.2)" }}>{presente ? "Remover presença" : "Marcar presença"}</Button>
                          </div>
                        </div>
                      )}

                      <div style={secaoStyle}>
                        <div style={tituloSecaoStyle}>👤 Conta</div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                          <Button variant="ghost" onClick={() => resetarSenhaAlunoProf(a.id)} style={{ color: "#F5F3EC", border: "1px solid rgba(255,255,255,0.2)" }}>Redefinir senha</Button>
                          <Button variant="ghost" onClick={() => setEditandoAluno(a)} style={{ color: "#F5F3EC", border: "1px solid rgba(255,255,255,0.2)" }}>Editar</Button>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                          <Button variant={a.ativo === false ? "gold" : "vermelho"} onClick={() => alternarAtivoAlunoProf(a.id)}>{a.ativo === false ? "Reativar acesso" : "Desativar acesso"}</Button>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#FF8A80", fontWeight: 600 }}>
                            <ConfirmDelete onConfirm={() => removerAlunoProf(a.id)} /> Excluir cadastro
                          </span>
                        </div>
                      </div>

                      <div style={secaoStyle}>
                        <div style={tituloSecaoStyle}>📝 Termo de consentimento</div>
                        {a.termoAceito ? (
                          <div>
                            <div style={{ fontSize: 12.5, color: "#4ADE80", fontWeight: 600, marginBottom: 8 }}>Aceito em {new Date(a.termoAceitoEm).toLocaleDateString("pt-BR")}</div>
                            {a.assinaturaTermo ? (
                              <img src={a.assinaturaTermo} alt="Assinatura do termo" style={{ background: "#fff", borderRadius: 8, border: "1px solid rgba(255,255,255,0.14)", maxWidth: 240, display: "block", marginBottom: 8 }} />
                            ) : (
                              <div style={{ fontSize: 11.5, color: "#9B9891", marginBottom: 8 }}>Sem assinatura registrada (aceito antes dessa funcionalidade existir).</div>
                            )}
                            <Button variant="ghost" onClick={() => gerarDocumentoTermoAssinado(data, a, (msg) => alert(msg))} style={{ color: "#F5F3EC", border: "1px solid rgba(255,255,255,0.2)" }}>Ver documento assinado</Button>
                          </div>
                        ) : a.termoAssinadoManual ? (
                          <div>
                            <div style={{ fontSize: 12.5, color: "#9B9891", marginBottom: 8 }}>Assinado fisicamente (registrado pela administração).</div>
                            <Button variant="ghost" onClick={() => gerarDocumentoTermoAssinado(data, a, (msg) => alert(msg))} style={{ color: "#F5F3EC", border: "1px solid rgba(255,255,255,0.2)" }}>Ver documento</Button>
                          </div>
                        ) : (
                          <div style={{ fontSize: 12.5, color: "#FF8A80", fontWeight: 600 }}>Pendente — o aluno ainda não assinou.</div>
                        )}
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
            {meusAlunos.length === 0 && <Empty dark>Nenhum aluno vinculado a você ainda. Peça para a administração te vincular no cadastro do aluno.</Empty>}
            {meusAlunos.length > 0 && alunosFiltrados.length === 0 && <Empty dark>Nenhum aluno encontrado com esse filtro.</Empty>}
          </div>
        </div>
      )}

      {tab === "checkins" && (
        <div>
          <ContadorCheckinsAula data={data} dark prof={prof} />
          <CheckinRetroativoProfessor data={data} save={save} prof={prof} dark />
          <RelatorioCheckinsProfessor data={data} prof={prof} dark />
        </div>
      )}

      {tab === "turmas" && <TurmasProfessor data={data} save={save} prof={prof} />}

      {tab === "financeiro" && (
        <div>
          <RelatorioMensalProfessor data={data} prof={prof} dark />
          <PagamentosChart data={data} alunosFiltro={meusAlunos} dark />
        </div>
      )}

      {tab === "relatorios" && (
        <RelatoriosProfessor data={data} prof={prof} meusAlunos={meusAlunos} />
      )}

      {tab === "avisos" && (
        <div>
          <AvisosProfessor data={data} save={save} prof={prof} dark />
          <GolpesProibidosCard pdf={data.academia.golpesProibidosPdf} pdfNome={data.academia.golpesProibidosPdfNome} />
        </div>
      )}

      {tab === "videos" && <VideosProfessor data={data} save={save} prof={prof} />}

      {tab === "produtos" && <ProdutosProfessor data={data} save={save} prof={prof} />}

      {tab === "perfil" && (
        <Card dark>
          <div style={{ ...blockTitleStyle, color: "#F5F3EC" }}>Meu perfil</div>
          <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
            <div style={{ position: "relative", flexShrink: 0 }}>
              <Avatar foto={prof.foto} nome={prof.nome} size={72} />
              <button onClick={() => fileRef.current?.click()} style={{ position: "absolute", bottom: -2, right: -2, background: "#C9A227", border: "2px solid #0B0B0B", borderRadius: "50%", width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                <Camera size={13} color="#17181B" />
              </button>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFotoProf} />
              {arquivoFotoProf && <CropperFoto arquivo={arquivoFotoProf} onSave={salvarFotoProfCortada} onCancel={() => setArquivoFotoProf(null)} />}
            </div>
            {!editandoPerfil ? (
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: "#F5F3EC" }}>{prof.nome}</div>
                <div style={{ fontSize: 12.5, color: "#9B9891" }}>{prof.especialidade || "—"} {prof.email && `· ${prof.email}`} {prof.telefone && `· ${prof.telefone}`}</div>
                {prof.endereco && <div style={{ fontSize: 11.5, color: "#9B9891" }}>{prof.endereco}</div>}
                {prof.faixaId && <div style={{ marginTop: 8 }}><BeltBar faixas={data.faixas} faixaId={prof.faixaId} grau={prof.grau} textColor="#F5F3EC" /></div>}
                <div style={{ marginTop: 8 }}><Button variant="ghost" onClick={() => setEditandoPerfil(true)} style={{ color: "#F5F3EC", border: "1px solid rgba(255,255,255,0.2)" }}>Editar meus dados</Button></div>
              </div>
            ) : (
              <div style={{ flex: 1, minWidth: 220, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 8 }}>
                  <Field label="Nome" labelColor="#9B9891"><input style={inputStyle} value={nome} onChange={(e) => setNome(e.target.value)} /></Field>
                  <Field label="E-mail" labelColor="#9B9891"><input style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
                  <Field label="Telefone" labelColor="#9B9891"><input style={inputStyle} value={telefone} onChange={(e) => setTelefone(e.target.value)} /></Field>
                  <Field label="Especialidade" labelColor="#9B9891"><input style={inputStyle} value={especialidade} onChange={(e) => setEspecialidade(e.target.value)} /></Field>
                  <Field label="Endereço" labelColor="#9B9891"><input style={inputStyle} value={endereco} onChange={(e) => setEndereco(e.target.value)} /></Field>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <ConfirmButton onConfirm={salvarPerfilProf}>Salvar</ConfirmButton>
                  <Button variant="ghost" icon={X} onClick={() => setEditandoPerfil(false)} style={{ color: "#F5F3EC", border: "1px solid rgba(255,255,255,0.2)" }}>Cancelar</Button>
                </div>
              </div>
            )}
          </div>
        </Card>
      )}
      </div>
    </div>
  );
}

function ProfessorLogin({ data, onLogin }) {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [lembrar, setLembrar] = useState(true);
  const [erro, setErro] = useState("");

  const entrar = () => {
    const prof = data.professores.find((p) => p.email && p.email.toLowerCase() === email.trim().toLowerCase() && (p.senha || "").trim() === senha.trim());
    if (!prof) { setErro("E-mail ou senha incorretos."); return; }
    setErro("");
    onLogin(prof.id, lembrar);
  };

  return (
    <LoginPreto logo={data.academia.logo} titulo="Área do professor" subtitulo="Faça login para acessar sua área">
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#C9C4B4", textTransform: "uppercase", letterSpacing: 0.4 }}>E-mail</span>
          <input style={inputStyleDark} value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "#C9C4B4", textTransform: "uppercase", letterSpacing: 0.4 }}>Senha</span>
          <input type="password" style={inputStyleDark} value={senha} onChange={(e) => setSenha(e.target.value)} onKeyDown={(e) => e.key === "Enter" && entrar()} />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#C9C4B4" }}>
          <input type="checkbox" checked={lembrar} onChange={(e) => setLembrar(e.target.checked)} /> Lembrar minha senha neste aparelho
        </label>
        {erro && <div style={{ fontSize: 12.5, color: "#FF8A80", fontWeight: 600 }}>{erro}</div>}
        <Button icon={Check} variant="gold" onClick={entrar}>Entrar</Button>
      </div>
      <p style={{ fontSize: 11.5, color: "#8A8574", marginTop: 14 }}>Esqueceu a senha? Peça para a administração redefinir no cadastro do professor.</p>
    </LoginPreto>
  );
}

function ProfessorView({ data, save, activeProfId, setActiveProfId }) {
  const prof = data.professores.find((p) => p.id === activeProfId);
  const handleLogin = (id, lembrar) => {
    try { if (lembrar) localStorage.setItem(REMEMBER_PROF_KEY, id); else localStorage.removeItem(REMEMBER_PROF_KEY); } catch (_) {}
    setActiveProfId(id);
  };
  const handleSair = () => {
    try { localStorage.removeItem(REMEMBER_PROF_KEY); } catch (_) {}
    setActiveProfId(null);
  };
  if (!prof) return <ProfessorLogin data={data} onLogin={handleLogin} />;
  return <ProfessorDashboard data={data} save={save} prof={prof} onSair={handleSair} />;
}

function ProfessorDashboard({ data, save, prof, onSair }) {
  const pagerRef = useRef(null);
  const [paginaAtiva, setPaginaAtiva] = useState(0);
  const irParaPagina = (idx) => { pagerRef.current?.scrollTo({ left: pagerRef.current.clientWidth * idx, behavior: "smooth" }); };
  useDeslizarAbas(pagerRef, 6, irParaPagina);
  // O navegador às vezes "ajusta" o scroll horizontal sozinho (scroll anchoring) quando
  // conteúdo carrega depois (avisos, aniversário etc.), tirando a 1ª página do lugar sem gesto do usuário.
  useLayoutEffect(() => { if (pagerRef.current) pagerRef.current.scrollLeft = 0; }, []);
  const aoRolarPaginas = () => {
    if (!pagerRef.current) return;
    const idx = Math.round(pagerRef.current.scrollLeft / pagerRef.current.clientWidth);
    setPaginaAtiva(idx);
  };
  const [turmaId, setTurmaId] = useState(() => {
    const minhaOuGeral = data.turmas.find((t) => !t.professorId || t.professorId === prof.id);
    return (minhaOuGeral || data.turmas[0])?.id || "";
  });
  const sessaoAtiva = data.sessoes.find((s) => s.professorId === prof.id && s.treinoId === turmaId && s.ativa);
  const fileRef = useRef(null);
  const [editandoPerfil, setEditandoPerfil] = useState(false);
  const [nome, setNome] = useState(prof.nome);
  const [email, setEmail] = useState(prof.email || "");
  const [telefone, setTelefone] = useState(prof.telefone || "");
  const [endereco, setEndereco] = useState(prof.endereco || "");
  const [especialidade, setEspecialidade] = useState(prof.especialidade || "");

  useEffect(() => {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "granted") { inscreverPush({ professorId: prof.id }); return; }
    if (Notification.permission !== "denied") {
      Notification.requestPermission().then((perm) => { if (perm === "granted") inscreverPush({ professorId: prof.id }); });
    }
  }, [prof.id]);

  useEffect(() => {
    if (!data.avisos || data.avisos.length === 0) return;
    const chaveVistos = `qg-avisos-vistos-prof-${prof.id}`;
    let vistos = [];
    try { vistos = JSON.parse(localStorage.getItem(chaveVistos) || "[]"); } catch (_) {}
    const novos = data.avisos.filter((a) => !vistos.includes(a.id));
    if (novos.length > 0) {
      if (typeof Notification !== "undefined") {
        const notificar = () => novos.forEach((a) => { try { new Notification(a.titulo, { body: a.mensagem || "", icon: data.academia.logo || undefined }); } catch (_) {} });
        if (Notification.permission === "granted") notificar();
        else if (Notification.permission !== "denied") Notification.requestPermission().then((perm) => { if (perm === "granted") notificar(); });
      }
      try { localStorage.setItem(chaveVistos, JSON.stringify(data.avisos.map((a) => a.id))); } catch (_) {}
    }
  }, [data.avisos, prof.id]);

  const salvarPerfilProf = async () => {
    const professores = data.professores.map((p) => (p.id === prof.id ? { ...p, nome, email, telefone, endereco, especialidade } : p));
    await save({ ...data, professores });
    setEditandoPerfil(false);
  };

  const [arquivoFotoProf, setArquivoFotoProf] = useState(null);
  const onFotoProf = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setArquivoFotoProf(file);
    e.target.value = "";
  };
  const salvarFotoProfCortada = async (dataUrl) => {
    const professores = data.professores.map((p) => (p.id === prof.id ? { ...p, foto: dataUrl } : p));
    await save({ ...data, professores });
    setArquivoFotoProf(null);
  };

  const iniciarAula = async () => {
    if (!turmaId) return;
    const codigo = randomCode();
    const sessao = { id: uid(), treinoId: turmaId, professorId: prof.id, codigo, criadoEm: new Date().toISOString(), ativa: true };
    // Só encerra sessões da MESMA turma — outra turma do mesmo professor (ex: aula particular
    // no mesmo horário) pode continuar com a sessão dela ativa em paralelo.
    const sessoes = data.sessoes.map((s) => (s.professorId === prof.id && s.treinoId === turmaId ? { ...s, ativa: false } : s));
    await save({ ...data, sessoes: [...sessoes, sessao] });
  };
  const encerrarSessao = async () => { const sessoes = data.sessoes.map((s) => (s.id === sessaoAtiva.id ? { ...s, ativa: false } : s)); await save({ ...data, sessoes }); };

  const [editandoAluno, setEditandoAluno] = useState(null);
  const [novoAluno, setNovoAluno] = useState(false);
  const [senhaGeradaAluno, setSenhaGeradaAluno] = useState(null);
  const [buscaAluno, setBuscaAluno] = useState("");
  const [filtroFaixaAluno, setFiltroFaixaAluno] = useState("");
  const [ordenarPor, setOrdenarPor] = useState("nome");
  const [alunosExpandidos, setAlunosExpandidos] = useState({});
  const alternarExpandido = (id) => setAlunosExpandidos((prev) => ({ ...prev, [id]: !prev[id] }));
  const addAlunoProf = async (form) => {
    const a = { id: uid(), tipo: "aluno", matricula: hoje(), ultimoPagamento: null, foto: null, pagamentos: [], checkinsDesdeGraduacao: 0, primeiroAcesso: true, termoAceito: false, termoAceitoEm: null, ativo: true, ...form, professorId: prof.id };
    await save({ ...data, alunos: [...data.alunos, a] });
    setNovoAluno(false);
  };
  const editarAlunoProf = async (id, form) => {
    const alunos = data.alunos.map((a) => (a.id === id ? { ...a, ...form } : a));
    await save({ ...data, alunos });
    setEditandoAluno(null);
  };
  const resetarSenhaAlunoProf = async (id) => {
    const nova = randomSenha();
    const alunos = data.alunos.map((a) => (a.id === id ? { ...a, senha: nova } : a));
    await save({ ...data, alunos });
    setSenhaGeradaAluno({ id, senha: nova });
  };
  const alternarAtivoAlunoProf = async (id) => {
    const alunos = data.alunos.map((a) => (a.id === id ? { ...a, ativo: a.ativo === false ? true : false } : a));
    await save({ ...data, alunos });
  };
  const removerAlunoProf = async (id) => {
    const alunos = data.alunos.filter((a) => !(a.id === id && a.professorId === prof.id));
    await save({ ...data, alunos });
  };
  const alternarPresenca = async (alunoId, presente) => {
    if (!sessaoAtiva) return;
    if (presente) await removerPresencaEm(data, save, sessaoAtiva.id, alunoId);
    else await marcarPresencaEm(data, save, sessaoAtiva.id, alunoId);
  };
  const ajustarAulasManualmente = async (alunoId, delta) => {
    if (!delta) return;
    const alunos = data.alunos.map((a) => (a.id === alunoId ? { ...a, checkinsDesdeGraduacao: Math.max(0, (a.checkinsDesdeGraduacao || 0) + delta) } : a));
    await save({ ...data, alunos });
    if (delta > 0) {
      notificarPush("Aula adicionada!", `Seu professor incluiu ${delta} aula(s) no seu progresso de graduação.`, { alunoId });
    }
  };

  const graduar = async (alunoId, tipo) => {
    const alunos = data.alunos.map((a) => {
      if (a.id !== alunoId) return a;
      const idx = data.faixas.findIndex((f) => f.id === a.faixaId);
      const faixaAtual = data.faixas[idx] || data.faixas[0];
      if (tipo === "grau") {
        if (!faixaAtual.grausMax) return a;
        return { ...a, grau: Math.min(a.grau + 1, faixaAtual.grausMax), checkinsDesdeGraduacao: 0 };
      }
      const proxima = data.faixas[idx + 1];
      if (!proxima) return a;
      return { ...a, faixaId: proxima.id, grau: 0, checkinsDesdeGraduacao: 0 };
    });
    await save({ ...data, alunos });
  };
  const darBaixaPagamento = (alunoId) => darBaixaEm(data, save, alunoId);
  const desfazerBaixaPagamento = (alunoId) => desfazerBaixaEm(data, save, alunoId);

  const checkinsSessao = sessaoAtiva ? data.checkins.filter((c) => c.sessaoId === sessaoAtiva.id) : [];
  const turma = data.turmas.find((t) => t.id === turmaId);

  const ehDesktop = useEhDesktop();
  if (ehDesktop) {
    return (
      <ProfessorDashboardDesktop
        data={data} save={save} prof={prof} onSair={onSair}
        ctx={{
          sessaoAtiva, turmaId, setTurmaId, turma, checkinsSessao, iniciarAula, encerrarSessao,
          editandoPerfil, setEditandoPerfil, nome, setNome, email, setEmail, telefone, setTelefone,
          endereco, setEndereco, especialidade, setEspecialidade, fileRef, onFotoProf, arquivoFotoProf,
          setArquivoFotoProf, salvarFotoProfCortada, salvarPerfilProf,
          editandoAluno, setEditandoAluno, novoAluno, setNovoAluno, senhaGeradaAluno,
          buscaAluno, setBuscaAluno, filtroFaixaAluno, setFiltroFaixaAluno, ordenarPor, setOrdenarPor,
          addAlunoProf, editarAlunoProf, resetarSenhaAlunoProf, alternarPresenca, ajustarAulasManualmente,
          graduar, darBaixaPagamento, desfazerBaixaPagamento, alternarAtivoAlunoProf, removerAlunoProf,
          alunosExpandidos, alternarExpandido,
        }}
      />
    );
  }

  return (
    <div style={{
      background: "linear-gradient(160deg, #161B26 0%, #0B0D12 100%)",
      width: "100%",
      height: "calc(100vh - 66px)",
      boxSizing: "border-box",
      color: "#F5F3EC",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      position: "relative",
    }}>
      <img src={LOGO_CACHORRO} alt="" style={{ position: "absolute", width: 320, right: -70, bottom: -50, opacity: 0.06, pointerEvents: "none", zIndex: 0 }} />
      <div ref={pagerRef} onScroll={aoRolarPaginas} className="qg-sem-barra" style={{ flex: 1, display: "flex", overflowX: "auto", overflowAnchor: "none", scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch", touchAction: "pan-x", position: "relative", zIndex: 1 }}>

        {/* PÁGINA 1 — INÍCIO (perfil + aula do dia + destaque de graduação) */}
        <div className="qg-sem-barra" style={{ flex: "0 0 100%", width: "100%", boxSizing: "border-box", scrollSnapAlign: "start", scrollSnapStop: "always", overflowY: "auto", touchAction: "pan-y", padding: "20px 20px 24px" }}>
          {ehAniversarioHoje(prof.dataNascimento) && <BannerAniversario nome={prof.nome} mensagemPersonalizada={data.academia.mensagemAniversario} />}
          <div style={{ background: "linear-gradient(165deg, #1A1D24 0%, #0D0F13 100%)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: "18px 20px 20px", marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
              <button onClick={onSair} style={{ background: "none", border: "none", color: "#C9C4B4", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, padding: 0 }}>
                <LogOut size={13} /> Sair
              </button>
            </div>

            {!editandoPerfil ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                  <div style={{ position: "relative", flexShrink: 0 }}>
                    <Avatar foto={prof.foto} nome={prof.nome} size={68} borderColor="#C9A227" />
                    <button onClick={() => fileRef.current?.click()} style={{ position: "absolute", bottom: -2, right: -2, background: "#C9A227", border: "2px solid #0B0B0B", borderRadius: "50%", width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                      <Camera size={12} color="#17181B" />
                    </button>
                    <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFotoProf} />
                    {arquivoFotoProf && <CropperFoto arquivo={arquivoFotoProf} onSave={salvarFotoProfCortada} onCancel={() => setArquivoFotoProf(null)} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#C9A227", textTransform: "uppercase", letterSpacing: 0.5 }}>Área do professor</div>
                    <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 18, color: "#fff" }}>{prof.nome}</div>
                    <div style={{ fontSize: 12, color: "#B8B2A0", marginTop: 2 }}>{prof.especialidade || "—"}{prof.email ? ` · ${prof.email}` : ""}</div>
                  </div>
                </div>

                {prof.faixaId && <div style={{ marginTop: 16 }}><BeltBar faixas={data.faixas} faixaId={prof.faixaId} grau={prof.grau} size="lg" textColor="#FFFFFF" /></div>}

                <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 10, marginTop: 14 }}>
                  <StatTile numero={data.alunos.filter((a) => a.professorId === prof.id).length} label="alunos vinculados" />
                  <StatTile numero={sessaoAtiva ? "Ativa" : "—"} label={sessaoAtiva ? "aula em andamento" : "nenhuma aula ativa"} />
                </div>
              </>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 8 }}>
                  <Field label="Nome" labelColor="#C9C4B4"><input style={inputStyle} value={nome} onChange={(e) => setNome(e.target.value)} /></Field>
                  <Field label="E-mail" labelColor="#C9C4B4"><input style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
                  <Field label="Telefone" labelColor="#C9C4B4"><input style={inputStyle} value={telefone} onChange={(e) => setTelefone(e.target.value)} /></Field>
                  <Field label="Especialidade" labelColor="#C9C4B4"><input style={inputStyle} value={especialidade} onChange={(e) => setEspecialidade(e.target.value)} /></Field>
                  <Field label="Endereço" labelColor="#C9C4B4"><input style={inputStyle} value={endereco} onChange={(e) => setEndereco(e.target.value)} /></Field>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <ConfirmButton dark onConfirm={salvarPerfilProf}>Salvar</ConfirmButton>
                  <Button variant="ghost" icon={X} style={{ color: "#FFFFFF", border: "1px solid rgba(255,255,255,0.35)" }} onClick={() => setEditandoPerfil(false)}>Cancelar</Button>
                </div>
              </div>
            )}
          </div>

          {!editandoPerfil && (
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              <ActionPill onClick={() => irParaPagina(1)}>Meus alunos</ActionPill>
              <ActionPill onClick={() => irParaPagina(3)}>Financeiro</ActionPill>
              <ActionPill onClick={() => setEditandoPerfil(true)}>Editar</ActionPill>
            </div>
          )}

          <Card style={{ marginBottom: 16, background: "#1A1D24", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div style={{ ...blockTitleStyle, color: "#F5F3EC" }}>Aula do dia</div>
            {!sessaoAtiva ? (
              <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
                <div style={{ flex: "0 1 220px", minWidth: 160 }}>
                  <Field label="Selecionar treino" labelColor="#C9C4B4">
                    <select style={inputStyleDark} value={turmaId} onChange={(e) => setTurmaId(e.target.value)}>
                      {data.turmas.filter((t) => !t.professorId || t.professorId === prof.id).map((t) => <option key={t.id} value={t.id} style={{ background: "#1A1D24", color: "#F5F3EC" }}>{t.nome} — {t.horario}{t.horarioFim ? ` às ${t.horarioFim}` : ""}</option>)}
                    </select>
                  </Field>
                </div>
                <Button icon={CalendarCheck} variant="vermelho" onClick={iniciarAula}>Iniciar aula</Button>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 13, color: "#C4C0B4", marginBottom: 4 }}>Aula ativa — os alunos já podem fazer check-in por localização</div>
                <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8, color: "#F5F3EC" }}>{turma?.nome}</div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: "#F5F3EC" }}>{checkinsSessao.length} aluno(s) fizeram check-in</div>
                <Button variant="danger" onClick={encerrarSessao}>Encerrar aula</Button>
              </div>
            )}
          </Card>

          <RecadoMestreProfessor data={data} prof={prof} dark={true} />

          <AlunosPorFaixaChart alunos={data.alunos.filter((a) => a.professorId === prof.id)} faixas={data.faixas} titulo="Meus alunos por faixa" dark />

          <AlunosPertoDeGraduar data={data} prof={prof} />
        </div>

        {/* PÁGINA 2 — MEUS ALUNOS */}
        <div className="qg-sem-barra" style={{ flex: "0 0 100%", width: "100%", boxSizing: "border-box", scrollSnapAlign: "start", scrollSnapStop: "always", overflowY: "auto", touchAction: "pan-y", padding: "20px 20px 24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
            <div>
              <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 20, color: "#fff", textTransform: "uppercase" }}>🤼 Meus alunos</div>
              <div style={{ fontSize: 12.5, color: "#9B9891" }}>{data.alunos.filter((a) => a.professorId === prof.id).length} aluno(s) vinculados a você</div>
            </div>
            <Button icon={Plus} variant="vermelho" onClick={() => setNovoAluno(true)}>Novo aluno</Button>
          </div>
          {!sessaoAtiva && <p style={{ fontSize: 12, color: "#9B9891", marginTop: 0 }}>Inicie a aula na página Início para poder marcar presença manualmente.</p>}
          <RelatorioListaAlunosProfessor data={data} prof={prof} />
          {novoAluno && (
            <PersonForm tipo="aluno" planos={data.planos} faixas={data.faixas} professores={data.professores} unidades={data.unidades} turmas={data.turmas} initial={{ professorId: prof.id }} onCancel={() => setNovoAluno(false)} onSave={addAlunoProf} />
          )}
          {editandoAluno && (
            <PersonForm tipo="aluno" planos={data.planos} faixas={data.faixas} professores={data.professores} unidades={data.unidades} turmas={data.turmas} initial={editandoAluno} onCancel={() => setEditandoAluno(null)} onSave={(form) => editarAlunoProf(editandoAluno.id, form)} />
          )}
          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            <input style={{ ...inputStyleDark, flex: 1, minWidth: 160 }} placeholder="Buscar por nome ou apelido..." value={buscaAluno} onChange={(e) => setBuscaAluno(e.target.value)} />
            <select style={{ ...inputStyleDark, width: 180 }} value={filtroFaixaAluno} onChange={(e) => setFiltroFaixaAluno(e.target.value)}>
              <option value="">Todas as faixas</option>
              {data.faixas.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </select>
            <select style={{ ...inputStyleDark, width: 220 }} value={ordenarPor} onChange={(e) => setOrdenarPor(e.target.value)}>
              <option value="nome">Ordenar por nome</option>
              <option value="graduar">Mais perto de graduar</option>
              <option value="frequencia">Mais frequência (aulas)</option>
            </select>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {data.alunos
              .filter((a) => a.professorId === prof.id)
              .filter((a) => !filtroFaixaAluno || a.faixaId === filtroFaixaAluno)
              .filter((a) => {
                const termo = buscaAluno.trim().toLowerCase();
                if (!termo) return true;
                return a.nome.toLowerCase().includes(termo) || (a.apelido || "").toLowerCase().includes(termo);
              })
              .sort((a, b) => {
                if (ordenarPor === "frequencia") return (b.checkinsDesdeGraduacao || 0) - (a.checkinsDesdeGraduacao || 0);
                if (ordenarPor === "graduar") {
                  const ra = progressoGraduacaoInfo(data.faixas, a.faixaId, a.grau, a.checkinsDesdeGraduacao, categoriaEtaria(a.dataNascimento)).restantes;
                  const rb = progressoGraduacaoInfo(data.faixas, b.faixaId, b.grau, b.checkinsDesdeGraduacao, categoriaEtaria(b.dataNascimento)).restantes;
                  if (ra === null && rb === null) return 0;
                  if (ra === null) return 1;
                  if (rb === null) return -1;
                  return ra - rb;
                }
                return a.nome.localeCompare(b.nome);
              })
              .map((a) => {
              const { emDia, plano } = statusPagamento(a, data.planos);
              const idx = data.faixas.findIndex((f) => f.id === a.faixaId);
              const faixaAtual = data.faixas[idx] || data.faixas[0];
              const presente = sessaoAtiva ? data.checkins.some((c) => c.sessaoId === sessaoAtiva.id && c.alunoId === a.id) : false;
              const ghostDark = { color: "#F5F3EC", border: "1px solid rgba(255,255,255,0.2)" };
              const aberto = !!alunosExpandidos[a.id];
              const tituloSecaoStyle = { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: "#6B6862", marginBottom: 7 };
              const secaoStyle = { borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 10, marginTop: 10 };
              return (
                <Card key={a.id} style={{ padding: 12, background: "#1A1D24", border: "1px solid rgba(255,255,255,0.06)", opacity: a.ativo === false ? 0.6 : 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }} onClick={() => alternarExpandido(a.id)}>
                    <Avatar foto={a.foto} nome={a.nome} borderColor="#C9A227" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, color: "#F5F3EC" }}>{a.nome}{a.apelido && <span style={{ fontWeight: 400, color: "#9B9891" }}> "{a.apelido}"</span>}</div>
                      <BeltBar faixas={data.faixas} faixaId={a.faixaId} grau={a.grau} textColor="#F5F3EC" />
                      {!aberto && (
                        <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                          {!emDia && <Tag ok={false}>Pendente</Tag>}
                          {a.ativo === false && <Tag ok={false}>Acesso desativado</Tag>}
                        </div>
                      )}
                    </div>
                    <div style={{ width: 28, height: 28, borderRadius: "50%", background: "rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transform: aberto ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>
                      <ChevronRight size={15} color="#C9A227" />
                    </div>
                  </div>

                  {aberto && (
                    <div>
                      {senhaGeradaAluno?.id === a.id && <div style={{ fontSize: 11, fontWeight: 700, color: "#4ADE80", marginTop: 10 }}>Nova senha: {senhaGeradaAluno.senha}</div>}

                      <div style={secaoStyle}>
                        <div style={tituloSecaoStyle}>💰 Financeiro — {plano?.nome || "sem plano"}</div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <Tag ok={emDia}>{emDia ? "Em dia" : "Pendente"}</Tag>
                          {!emDia && <Button variant="gold" onClick={() => darBaixaPagamento(a.id)}>Dar baixa</Button>}
                          {emDia && (a.pagamentos || []).length > 0 && <Button variant="ghost" style={ghostDark} onClick={() => desfazerBaixaPagamento(a.id)}>Desfazer baixa</Button>}
                        </div>
                      </div>

                      <div style={secaoStyle}>
                        <div style={tituloSecaoStyle}>🥋 Graduação</div>
                        <div style={{ fontSize: 11.5, color: "#9B9891", marginBottom: 8 }}>{progressoGraduacaoTexto(data.faixas, a.faixaId, a.grau, a.checkinsDesdeGraduacao, categoriaEtaria(a.dataNascimento))} · {a.checkinsDesdeGraduacao || 0} aula(s) desde a última graduação</div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                          {faixaAtual?.grausMax > 0 && <Button variant="ghost" style={ghostDark} onClick={() => graduar(a.id, "grau")} disabled={a.grau >= faixaAtual.grausMax}>+1 grau</Button>}
                          <Button variant="ghost" style={ghostDark} onClick={() => graduar(a.id, "faixa")} disabled={idx >= data.faixas.length - 1}>Graduar faixa</Button>
                        </div>
                        <AjustarAulasInline onAjustar={(delta) => ajustarAulasManualmente(a.id, delta)} />
                      </div>

                      {sessaoAtiva && (
                        <div style={secaoStyle}>
                          <div style={tituloSecaoStyle}>📍 Presença na aula de hoje</div>
                          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <Tag ok={presente}>{presente ? "Presente" : "Ausente"}</Tag>
                            <Button variant="ghost" style={ghostDark} onClick={() => alternarPresenca(a.id, presente)}>{presente ? "Remover presença" : "Marcar presença"}</Button>
                          </div>
                        </div>
                      )}

                      <div style={secaoStyle}>
                        <div style={tituloSecaoStyle}>👤 Conta</div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                          <Button variant="ghost" style={ghostDark} onClick={() => resetarSenhaAlunoProf(a.id)}>Redefinir senha</Button>
                          <Button variant="ghost" style={ghostDark} onClick={() => setEditandoAluno(a)}>Editar</Button>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                          <Button variant={a.ativo === false ? "gold" : "vermelho"} onClick={() => alternarAtivoAlunoProf(a.id)}>{a.ativo === false ? "Reativar acesso" : "Desativar acesso"}</Button>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#FF8A80", fontWeight: 600 }}>
                            <ConfirmDelete onConfirm={() => removerAlunoProf(a.id)} /> Excluir cadastro
                          </span>
                        </div>
                      </div>

                      <div style={secaoStyle}>
                        <div style={tituloSecaoStyle}>📝 Termo de consentimento</div>
                        {a.termoAceito ? (
                          <div>
                            <div style={{ fontSize: 12.5, color: "#4ADE80", fontWeight: 600, marginBottom: 8 }}>Aceito em {new Date(a.termoAceitoEm).toLocaleDateString("pt-BR")}</div>
                            {a.assinaturaTermo ? (
                              <img src={a.assinaturaTermo} alt="Assinatura do termo" style={{ background: "#fff", borderRadius: 8, border: "1px solid rgba(255,255,255,0.14)", maxWidth: 240, display: "block", marginBottom: 8 }} />
                            ) : (
                              <div style={{ fontSize: 11.5, color: "#9B9891", marginBottom: 8 }}>Sem assinatura registrada (aceito antes dessa funcionalidade existir).</div>
                            )}
                            <Button variant="ghost" onClick={() => gerarDocumentoTermoAssinado(data, a, (msg) => alert(msg))} style={{ color: "#F5F3EC", border: "1px solid rgba(255,255,255,0.2)" }}>Ver documento assinado</Button>
                          </div>
                        ) : a.termoAssinadoManual ? (
                          <div>
                            <div style={{ fontSize: 12.5, color: "#9B9891", marginBottom: 8 }}>Assinado fisicamente (registrado pela administração).</div>
                            <Button variant="ghost" onClick={() => gerarDocumentoTermoAssinado(data, a, (msg) => alert(msg))} style={{ color: "#F5F3EC", border: "1px solid rgba(255,255,255,0.2)" }}>Ver documento</Button>
                          </div>
                        ) : (
                          <div style={{ fontSize: 12.5, color: "#FF8A80", fontWeight: 600 }}>Pendente — o aluno ainda não assinou.</div>
                        )}
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
            {(() => {
              const meusAlunos = data.alunos.filter((a) => a.professorId === prof.id);
              const filtrados = meusAlunos
                .filter((a) => !filtroFaixaAluno || a.faixaId === filtroFaixaAluno)
                .filter((a) => {
                  const termo = buscaAluno.trim().toLowerCase();
                  if (!termo) return true;
                  return a.nome.toLowerCase().includes(termo) || (a.apelido || "").toLowerCase().includes(termo);
                });
              if (meusAlunos.length === 0) return <Empty dark>Nenhum aluno vinculado a você ainda. Peça para a administração te vincular no cadastro do aluno.</Empty>;
              if (filtrados.length === 0) return <Empty dark>Nenhum aluno encontrado com esse filtro.</Empty>;
              return null;
            })()}
          </div>
        </div>

        {/* PÁGINA 3 — CHECK-INS */}
        <div className="qg-sem-barra" style={{ flex: "0 0 100%", width: "100%", boxSizing: "border-box", scrollSnapAlign: "start", scrollSnapStop: "always", overflowY: "auto", touchAction: "pan-y", padding: "20px 20px 24px" }}>
          <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 20, color: "#fff", textTransform: "uppercase", marginBottom: 4 }}>📍 Check-ins</div>
          <div style={{ fontSize: 12.5, color: "#9B9891", marginBottom: 16 }}>Presença e histórico das aulas</div>
          <ContadorCheckinsAula data={data} prof={prof} />
          <CheckinRetroativoProfessor data={data} save={save} prof={prof} />
          <RelatorioCheckinsProfessor data={data} prof={prof} />
        </div>

        {/* PÁGINA 4 — FINANCEIRO */}
        <div className="qg-sem-barra" style={{ flex: "0 0 100%", width: "100%", boxSizing: "border-box", scrollSnapAlign: "start", scrollSnapStop: "always", overflowY: "auto", touchAction: "pan-y", padding: "20px 20px 24px" }}>
          <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 20, color: "#fff", textTransform: "uppercase", marginBottom: 4 }}>💰 Financeiro</div>
          <div style={{ fontSize: 12.5, color: "#9B9891", marginBottom: 16 }}>Só dos seus alunos vinculados</div>
          <RelatorioMensalProfessor data={data} prof={prof} />
          <PagamentosChart data={data} alunosFiltro={data.alunos.filter((a) => a.professorId === prof.id)} dark />
        </div>

        {/* PÁGINA 5 — RELATÓRIOS */}
        <div className="qg-sem-barra" style={{ flex: "0 0 100%", width: "100%", boxSizing: "border-box", scrollSnapAlign: "start", scrollSnapStop: "always", overflowY: "auto", touchAction: "pan-y", padding: "20px 20px 24px" }}>
          <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 20, color: "#fff", textTransform: "uppercase", marginBottom: 4 }}>📑 Relatórios</div>
          <div style={{ fontSize: 12.5, color: "#9B9891", marginBottom: 16 }}>Todos os relatórios, em um só lugar</div>
          <RelatoriosProfessor data={data} prof={prof} meusAlunos={data.alunos.filter((a) => a.professorId === prof.id)} />
        </div>

        {/* PÁGINA 6 — MAIS */}
        <div className="qg-sem-barra" style={{ flex: "0 0 100%", width: "100%", boxSizing: "border-box", scrollSnapAlign: "start", scrollSnapStop: "always", overflowY: "auto", touchAction: "pan-y", padding: "20px 20px 24px" }}>
          <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 20, color: "#fff", textTransform: "uppercase", marginBottom: 4 }}>☰ Mais</div>
          <div style={{ fontSize: 12.5, color: "#9B9891", marginBottom: 16 }}>Avisos, turmas e produtos</div>
          <AvisosProfessor data={data} save={save} prof={prof} dark={true} />
          <div style={{ marginTop: 20 }}>
            <div style={{ ...blockTitleStyle, color: "#F5F3EC" }}>📅 Minhas turmas</div>
            <TurmasProfessor data={data} save={save} prof={prof} />
          </div>
          <div style={{ marginTop: 20 }}>
            <div style={{ ...blockTitleStyle, color: "#F5F3EC" }}>🛍️ Produtos à venda</div>
            <ProdutosProfessor data={data} save={save} prof={prof} />
          </div>
          <div style={{ marginTop: 20 }}>
            <GolpesProibidosCard pdf={data.academia.golpesProibidosPdf} pdfNome={data.academia.golpesProibidosPdfNome} />
          </div>
        </div>

      </div>

      <div style={{ flexShrink: 0, background: "#000", borderTop: "1px solid rgba(255,255,255,0.08)", paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div style={{ display: "flex", justifyContent: "space-around", alignItems: "center", padding: "10px 4px 4px" }}>
          {[
            { icone: "🏠", nome: "Início" },
            { icone: "🤼", nome: "Alunos" },
            { icone: "📍", nome: "Check-ins" },
            { icone: "💰", nome: "Financeiro" },
            { icone: "📑", nome: "Relatórios" },
            { icone: "☰", nome: "Mais" },
          ].map((item, i) => (
            <button key={i} onClick={() => irParaPagina(i)} style={{ background: "none", border: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, fontSize: 9.5, color: paginaAtiva === i ? "#C9A227" : "#6B6862", cursor: "pointer", flex: 1, padding: 0 }}>
              <span style={{ fontSize: 17 }}>{item.icone}</span>
              {item.nome}
            </button>
          ))}
        </div>
        <div style={{ textAlign: "center", fontSize: 9, color: "#4E4B44", padding: "2px 0 6px", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
          <span>Desenvolvido por TECBM - Bruno Martins Tecnologia</span>
          <img src={LOGO_TECBM} alt="" style={{ height: 11, width: "auto", verticalAlign: "middle" }} />
        </div>
      </div>
    </div>
  );
}

/* ---------------- ALUNO ---------------- */
function AlunoLogin({ data, save, onLogin }) {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [lembrar, setLembrar] = useState(true);
  const [erro, setErro] = useState("");
  const [modoReset, setModoReset] = useState(false);
  const [emailReset, setEmailReset] = useState("");
  const [msgReset, setMsgReset] = useState("");

  const entrar = () => {
    const aluno = data.alunos.find((a) => a.email && a.email.toLowerCase() === email.trim().toLowerCase() && (a.senha || "").trim() === senha.trim());
    if (!aluno) { setErro("E-mail ou senha incorretos."); return; }
    if (aluno.ativo === false) { setErro("Seu acesso foi desativado. Fale com a administração da academia."); return; }
    setErro("");
    onLogin(aluno.id, lembrar);
  };

  const resetar = async () => {
    const aluno = data.alunos.find((a) => a.email && a.email.toLowerCase() === emailReset.trim().toLowerCase());
    if (!aluno) { setMsgReset("Não encontramos esse e-mail cadastrado."); return; }
    const nova = randomSenha();
    const alunos = data.alunos.map((a) => (a.id === aluno.id ? { ...a, senha: nova } : a));
    await save({ ...data, alunos });
    setMsgReset(`Senha redefinida! Nova senha: ${nova}. (Envio automático por e-mail ainda não está configurado — anote e repasse ao aluno.)`);
  };

  return (
    <LoginPreto logo={data.academia.logo} titulo="Área do aluno" subtitulo="Faça login para acessar sua área">
      {!modoReset ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#C9C4B4", textTransform: "uppercase", letterSpacing: 0.4 }}>E-mail</span>
            <input style={inputStyleDark} value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#C9C4B4", textTransform: "uppercase", letterSpacing: 0.4 }}>Senha</span>
            <input type="password" style={inputStyleDark} value={senha} onChange={(e) => setSenha(e.target.value)} onKeyDown={(e) => e.key === "Enter" && entrar()} />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#C9C4B4" }}>
            <input type="checkbox" checked={lembrar} onChange={(e) => setLembrar(e.target.checked)} /> Lembrar minha senha neste aparelho
          </label>
          {erro && <div style={{ fontSize: 12.5, color: "#FF8A80", fontWeight: 600 }}>{erro}</div>}
          <Button icon={Check} variant="gold" onClick={entrar}>Entrar</Button>
          <button onClick={() => { setModoReset(true); setMsgReset(""); }} style={{ background: "none", border: "none", color: "#C9A227", fontSize: 12.5, textDecoration: "underline", cursor: "pointer", textAlign: "left" }}>Esqueci minha senha</button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#C9C4B4", textTransform: "uppercase", letterSpacing: 0.4 }}>Informe seu e-mail cadastrado</span>
            <input style={inputStyleDark} value={emailReset} onChange={(e) => setEmailReset(e.target.value)} />
          </label>
          <Button icon={Check} variant="gold" onClick={resetar}>Redefinir senha</Button>
          {msgReset && <div style={{ fontSize: 12.5, color: "#C9C4B4" }}>{msgReset}</div>}
          <button onClick={() => setModoReset(false)} style={{ background: "none", border: "none", color: "#C9A227", fontSize: 12.5, textDecoration: "underline", cursor: "pointer", textAlign: "left" }}>Voltar ao login</button>
        </div>
      )}
      <p style={{ fontSize: 11.5, color: "#8A8574", marginTop: 14 }}>Não tem acesso ainda? Peça ao professor ou à administração para te cadastrar.</p>
    </LoginPreto>
  );
}

function SignaturePad({ onChange }) {
  const canvasRef = useRef(null);
  const desenhandoRef = useRef(false);
  const vazioRef = useRef(true);

  const getPos = (e, canvas) => {
    const rect = canvas.getBoundingClientRect();
    const ponto = e.touches ? e.touches[0] : e;
    const escalaX = canvas.width / rect.width;
    const escalaY = canvas.height / rect.height;
    return { x: (ponto.clientX - rect.left) * escalaX, y: (ponto.clientY - rect.top) * escalaY };
  };

  const comecar = (e) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    const { x, y } = getPos(e, canvas);
    const ctx = canvas.getContext("2d");
    ctx.beginPath();
    ctx.moveTo(x, y);
    desenhandoRef.current = true;
  };
  const mover = (e) => {
    if (!desenhandoRef.current) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const { x, y } = getPos(e, canvas);
    const ctx = canvas.getContext("2d");
    ctx.lineTo(x, y);
    ctx.strokeStyle = "#1B2027";
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
    vazioRef.current = false;
  };
  const soltar = () => {
    if (!desenhandoRef.current) return;
    desenhandoRef.current = false;
    if (!vazioRef.current) onChange(canvasRef.current.toDataURL("image/png"));
  };
  const limpar = () => {
    const canvas = canvasRef.current;
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    vazioRef.current = true;
    onChange(null);
  };

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={500}
        height={160}
        style={{ width: "100%", height: 140, background: "#fff", border: "1px solid #D8D3C4", borderRadius: 8, touchAction: "none", cursor: "crosshair" }}
        onMouseDown={comecar} onMouseMove={mover} onMouseUp={soltar} onMouseLeave={soltar}
        onTouchStart={comecar} onTouchMove={mover} onTouchEnd={soltar}
      />
      <button type="button" onClick={limpar} style={{ marginTop: 6, background: "none", border: "none", color: "#8A8574", fontSize: 12, cursor: "pointer", textDecoration: "underline", padding: 0 }}>Limpar assinatura</button>
    </div>
  );
}

function PrimeiroAcessoTermo({ data, save, aluno }) {
  const [aceito, setAceito] = useState(false);
  const [assinatura, setAssinatura] = useState(null);
  const confirmar = async () => {
    if (!aceito || !assinatura) return;
    const alunos = data.alunos.map((a) => (a.id === aluno.id ? { ...a, termoAceito: true, termoAceitoEm: new Date().toISOString(), primeiroAcesso: false, assinaturaTermo: assinatura } : a));
    await save({ ...data, alunos });
  };
  return (
    <div style={{ maxWidth: 480, margin: "20px auto", padding: "0 20px", boxSizing: "border-box" }}>
      <SectionTitle sub={`Bem-vindo(a), ${aluno.nome}! Antes de continuar, leia o termo abaixo.`}>Primeiro acesso</SectionTitle>
      <Card>
        {data.academia.termoPdf && (
          <a href={data.academia.termoPdf} target="_blank" rel="noreferrer" onClick={(e) => { e.preventDefault(); abrirPdfDataUrl(data.academia.termoPdf); }} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "#12213B", marginBottom: 10 }}>
            📄 Abrir termo em PDF ({data.academia.termoPdfNome || "termo.pdf"})
          </a>
        )}
        {data.academia.termoPadrao && (
          <div style={{ whiteSpace: "pre-wrap", fontSize: 12.5, color: "#5A5648", maxHeight: 180, overflowY: "auto", border: "1px solid #E7E2D6", borderRadius: 8, padding: 10, marginBottom: 10 }}>{data.academia.termoPadrao}</div>
        )}
        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, marginBottom: 12 }}>
          <input type="checkbox" checked={aceito} onChange={(e) => setAceito(e.target.checked)} style={{ marginTop: 3 }} />
          Li o termo de consentimento (texto e/ou PDF) e estou ciente das condições.
        </label>
        <Field label="Assine com o dedo abaixo">
          <SignaturePad onChange={setAssinatura} />
        </Field>
        <p style={{ fontSize: 11, color: "#8A8574", margin: "6px 0 12px" }}>Sua assinatura fica registrada com o termo e disponível para o seu professor.</p>
        <Button icon={Check} variant="gold" disabled={!aceito || !assinatura} onClick={confirmar}>Continuar</Button>
      </Card>
    </div>
  );
}

function AlunoView({ data, save, activeAlunoId, setActiveAlunoId }) {
  const aluno = data.alunos.find((a) => a.id === activeAlunoId);
  const handleLogin = (id, lembrar) => {
    try { if (lembrar) localStorage.setItem(REMEMBER_KEY, id); else localStorage.removeItem(REMEMBER_KEY); } catch (_) {}
    setActiveAlunoId(id);
  };
  const handleSair = () => {
    try { localStorage.removeItem(REMEMBER_KEY); } catch (_) {}
    setActiveAlunoId(null);
  };
  if (!aluno || aluno.ativo === false) return <AlunoLogin data={data} save={save} onLogin={handleLogin} />;
  if (aluno.primeiroAcesso && (data.academia.termoPadrao || data.academia.termoPdf)) return <PrimeiroAcessoTermo data={data} save={save} aluno={aluno} />;
  return <AlunoDashboard data={data} save={save} aluno={aluno} onSair={handleSair} />;
}

function AlunoDashboard({ data, save, aluno, onSair }) {
  const fileRef = useRef(null);
  const pagerRef = useRef(null);
  const [paginaAtiva, setPaginaAtiva] = useState(0);
  const irParaPagina = (idx) => { pagerRef.current?.scrollTo({ left: pagerRef.current.clientWidth * idx, behavior: "smooth" }); };
  useDeslizarAbas(pagerRef, 5, irParaPagina);
  // O navegador às vezes "ajusta" o scroll horizontal sozinho (scroll anchoring) quando
  // conteúdo carrega depois (recados, aniversário etc.), tirando a 1ª página do lugar sem gesto do usuário.
  useLayoutEffect(() => { if (pagerRef.current) pagerRef.current.scrollLeft = 0; }, []);
  const aoRolarPaginas = () => {
    if (!pagerRef.current) return;
    const idx = Math.round(pagerRef.current.scrollLeft / pagerRef.current.clientWidth);
    setPaginaAtiva(idx);
  };
  const [msg, setMsg] = useState("");
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState(aluno.nome);
  const [email, setEmail] = useState(aluno.email || "");
  const [telefone, setTelefone] = useState(aluno.telefone || "");
  const [endereco, setEndereco] = useState(aluno.endereco || "");
  const [cen, setCen] = useState(aluno.contatoEmergenciaNome || "");
  const [cet, setCet] = useState(aluno.contatoEmergenciaTelefone || "");
  const [peso, setPeso] = useState(aluno.peso ?? "");
  const [apelido, setApelido] = useState(aluno.apelido || "");
  const [senhaAtual, setSenhaAtual] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmarSenha, setConfirmarSenha] = useState("");
  const [msgSenha, setMsgSenha] = useState("");
  const [recadosPendentes, setRecadosPendentes] = useState([]);

  useEffect(() => {
    if (!aluno.professorId) return;
    let cancelado = false;
    (async () => {
      try {
        const linhas = await pg.select("recados", `professor_id=eq.${aluno.professorId}&order=criado_em.desc`);
        const vistas = await pg.select("recados_visualizados", `aluno_id=eq.${aluno.id}`);
        const idsVistos = new Set((vistas || []).map((v) => v.recado_id));
        const naoVistos = (linhas || [])
          .filter((r) => !idsVistos.has(r.id))
          .map((r) => ({ id: r.id, videoUrl: r.video_url, destinatariosTotal: r.destinatarios_total }));
        if (!cancelado) setRecadosPendentes(naoVistos);
      } catch (_) {}
    })();
    return () => { cancelado = true; };
  }, [aluno.id, aluno.professorId]);

  const nomeProfessorRecado = data.professores.find((p) => p.id === aluno.professorId)?.nome;
  const marcarRecadoVisto = (id) => setRecadosPendentes((prev) => prev.filter((r) => r.id !== id));

  useEffect(() => {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "granted") { inscreverPush({ alunoId: aluno.id }); return; }
    if (Notification.permission !== "denied") {
      Notification.requestPermission().then((perm) => { if (perm === "granted") inscreverPush({ alunoId: aluno.id }); });
    }
  }, [aluno.id]);

  useEffect(() => {
    if (!data.avisos || data.avisos.length === 0) return;
    const chaveVistos = `qg-avisos-vistos-${aluno.id}`;
    let vistos = [];
    try { vistos = JSON.parse(localStorage.getItem(chaveVistos) || "[]"); } catch (_) {}
    const novos = data.avisos.filter((a) => !vistos.includes(a.id));
    if (novos.length > 0) {
      if (typeof Notification !== "undefined") {
        const notificar = () => novos.forEach((a) => { try { new Notification(a.titulo, { body: a.mensagem || "", icon: data.academia.logo || undefined }); } catch (_) {} });
        if (Notification.permission === "granted") notificar();
        else if (Notification.permission !== "denied") Notification.requestPermission().then((perm) => { if (perm === "granted") notificar(); });
      }
      try { localStorage.setItem(chaveVistos, JSON.stringify(data.avisos.map((a) => a.id))); } catch (_) {}
    }
  }, [data.avisos, aluno.id]);

  const alterarSenha = async () => {
    setMsgSenha("");
    if ((aluno.senha || "").trim() !== senhaAtual.trim()) { setMsgSenha("Senha atual incorreta."); return; }
    if (!novaSenha.trim()) { setMsgSenha("Digite a nova senha."); return; }
    if (novaSenha.trim() !== confirmarSenha.trim()) { setMsgSenha("As senhas novas não coincidem."); return; }
    const alunos = data.alunos.map((a) => (a.id === aluno.id ? { ...a, senha: novaSenha.trim() } : a));
    await save({ ...data, alunos });
    setSenhaAtual(""); setNovaSenha(""); setConfirmarSenha("");
    setMsgSenha("Senha alterada com sucesso!");
  };

  const meusCheckins = data.checkins.filter((c) => c.alunoId === aluno.id).sort((a, b) => b.dataHora.localeCompare(a.dataHora));
  const { emDia, vencimento, plano } = statusPagamento(aluno, data.planos);
  const faixaAtual = data.faixas.find((f) => f.id === aluno.faixaId);
  const localCheckin = localCheckinDe(aluno, data);
  const turmasDaUnidade = data.turmas.filter((t) => (t.unidadeId || null) === (aluno.unidadeId || null));
  // Turmas vinculadas a algum aluno específico (aulas particulares) somem da grade/próximo-treino
  // de todo mundo, exceto do próprio aluno vinculado — assim não colidem com o horário normal.
  const turmasPrivadasIds = new Set(data.alunos.filter((a) => a.turmaId).map((a) => a.turmaId));
  const turmasGeraisDaUnidade = turmasDaUnidade.filter((t) => !turmasPrivadasIds.has(t.id) || t.id === aluno.turmaId);
  const professorVinculadoNome = data.professores.find((p) => p.id === aluno.professorId)?.nome;
  const turmasFeitasHojeIds = new Set(
    meusCheckins
      .filter((c) => dataLocalDe(c.dataHora) === hoje())
      .map((c) => data.sessoes.find((s) => s.id === c.sessaoId)?.treinoId)
      .filter(Boolean)
  );
  const proximaTurmaObj = data.turmas.find((t) => t.id === (aluno.turmaId || proximaTurmaId(turmasGeraisDaUnidade, new Date(), turmasFeitasHojeIds)));

  const salvarPerfil = async () => {
    const alunos = data.alunos.map((a) => (a.id === aluno.id ? { ...a, nome, email, telefone, endereco, contatoEmergenciaNome: cen, contatoEmergenciaTelefone: cet, peso: peso === "" ? null : Number(peso), apelido } : a));
    await save({ ...data, alunos });
    setEditando(false);
  };

  const [arquivoFoto, setArquivoFoto] = useState(null);
  const onFoto = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setArquivoFoto(file);
    e.target.value = "";
  };
  const salvarFotoCortada = async (dataUrl) => {
    const alunos = data.alunos.map((a) => (a.id === aluno.id ? { ...a, foto: dataUrl } : a));
    await save({ ...data, alunos });
    setArquivoFoto(null);
  };

  const [buscandoLocal, setBuscandoLocal] = useState(false);

  const registrarCheckin = async (sessao) => {
    const jaFez = data.checkins.some((c) => c.sessaoId === sessao.id && c.alunoId === aluno.id);
    if (jaFez) { setMsg("Você já fez check-in nesta aula."); return; }
    const checkin = { id: uid(), sessaoId: sessao.id, alunoId: aluno.id, dataHora: new Date().toISOString() };
    const alunos = data.alunos.map((a) => (a.id === aluno.id ? { ...a, checkinsDesdeGraduacao: (a.checkinsDesdeGraduacao || 0) + 1 } : a));
    await save({ ...data, checkins: [...data.checkins, checkin], alunos });
    setMsg("Check-in confirmado! Bom treino 🥋");
  };

  const fazerCheckinLocalizacao = () => {
    setMsg("");
    const local = localCheckinDe(aluno, data);

    if (!local.exigeLocalizacao) {
      if (!aluno.professorId) { setMsg("Você ainda não tem um professor vinculado — peça para a administração te vincular no cadastro."); return; }
      const sessao = aluno.turmaId
        ? data.sessoes.find((s) => s.ativa && s.treinoId === aluno.turmaId)
        : data.sessoes.find((s) => s.ativa && s.professorId === aluno.professorId && !turmasPrivadasIds.has(s.treinoId));
      if (!sessao) { setMsg(aluno.turmaId ? "Seu professor ainda não abriu a sua aula particular agora." : "Seu professor ainda não abriu uma aula agora — peça para ele iniciar antes do check-in."); return; }
      registrarCheckin(sessao);
      return;
    }

    const proximaId = aluno.turmaId || proximaTurmaId(turmasGeraisDaUnidade);
    if (!proximaId) { setMsg("Não há nenhum treino na grade de horários agora."); return; }
    const sessao = data.sessoes.find((s) => s.ativa && s.treinoId === proximaId);

    if (local.latitude == null || local.longitude == null) { setMsg(`A administração ainda não configurou a localização de ${local.nome}.`); return; }
    if (!navigator.geolocation) { setMsg("Seu navegador não suporta localização."); return; }
    setBuscandoLocal(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setBuscandoLocal(false);
        const dist = distanciaMetros(pos.coords.latitude, pos.coords.longitude, local.latitude, local.longitude);
        if (dist > local.raioCheckin) { setMsg(`Você está a ${Math.round(dist)}m de ${local.nome} — precisa estar a até ${local.raioCheckin}m para o check-in por localização.`); return; }
        if (!sessao) { setMsg("O check-in libera apenas para o seu próximo treino da grade — peça para o professor iniciar a aula certa."); return; }
        await registrarCheckin(sessao);
      },
      () => { setBuscandoLocal(false); setMsg("Não foi possível obter sua localização. Verifique a permissão do navegador."); }
    );
  };

  const [assinaturaTermoMais, setAssinaturaTermoMais] = useState(null);
  const aceitarTermo = async () => {
    if (!assinaturaTermoMais) return;
    const alunos = data.alunos.map((a) => (a.id === aluno.id ? { ...a, termoAceito: true, termoAceitoEm: new Date().toISOString(), assinaturaTermo: assinaturaTermoMais } : a));
    await save({ ...data, alunos });
  };

  return (
    <div style={{
      background: "linear-gradient(160deg, #161B26 0%, #0B0D12 100%)",
      width: "100%",
      height: "calc(100vh - 66px)",
      boxSizing: "border-box",
      color: "#F5F3EC",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      position: "relative",
    }}>
      <img src={LOGO_CACHORRO} alt="" style={{ position: "absolute", width: 320, right: -70, bottom: -50, opacity: 0.06, pointerEvents: "none", zIndex: 0 }} />
      <div ref={pagerRef} onScroll={aoRolarPaginas} className="qg-sem-barra" style={{ flex: 1, display: "flex", overflowX: "auto", overflowAnchor: "none", scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch", touchAction: "pan-x", position: "relative", zIndex: 1 }}>

        {/* PÁGINA 1 — PERFIL & CHECK-IN */}
        <div className="qg-sem-barra" style={{ flex: "0 0 100%", width: "100%", boxSizing: "border-box", scrollSnapAlign: "start", scrollSnapStop: "always", overflowY: "auto", touchAction: "pan-y", padding: "20px 20px 24px" }}>
          {recadosPendentes.length > 0 && (
            <RecadoMestreAluno recado={recadosPendentes[0]} aluno={aluno} nomeProfessor={nomeProfessorRecado} onVisto={marcarRecadoVisto} />
          )}
          {ehAniversarioHoje(aluno.dataNascimento) && <BannerAniversario nome={aluno.nome} mensagemPersonalizada={data.academia.mensagemAniversario} />}
          <div style={{ background: "linear-gradient(165deg, #1A1D24 0%, #0D0F13 100%)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: "18px 20px 20px", marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
              <button onClick={onSair} style={{ background: "none", border: "none", color: "#C9C4B4", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 4, padding: 0 }}>
                <LogOut size={13} /> Sair
              </button>
            </div>

            {!editando ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                  <div style={{ position: "relative", flexShrink: 0 }}>
                    <Avatar foto={aluno.foto} nome={aluno.nome} size={68} borderColor="#C9A227" />
                    <button onClick={() => fileRef.current?.click()} style={{ position: "absolute", bottom: -2, right: -2, background: "#C9A227", border: "2px solid #0B0B0B", borderRadius: "50%", width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                      <Camera size={12} color="#17181B" />
                    </button>
                    <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFoto} />
                    {arquivoFoto && <CropperFoto arquivo={arquivoFoto} onSave={salvarFotoCortada} onCancel={() => setArquivoFoto(null)} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#C9A227", textTransform: "uppercase", letterSpacing: 0.5 }}>Área do aluno</div>
                    <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 18, color: "#fff" }}>{aluno.nome}{aluno.apelido && <span style={{ fontWeight: 400 }}> "{aluno.apelido}"</span>}</div>
                    <div style={{ fontSize: 12, color: "#B8B2A0", marginTop: 2 }}>
                      {aluno.email || "sem e-mail"}{professorVinculadoNome ? ` · Prof. ${professorVinculadoNome}` : ""}
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: 16 }}><BeltBar faixas={data.faixas} faixaId={aluno.faixaId} grau={aluno.grau} size="lg" textColor="#FFFFFF" /></div>

                <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 10, marginTop: 14 }}>
                  <StatTile numero={aluno.checkinsDesdeGraduacao || 0} label="check-ins registrados" />
                  <StatTile
                    numero={faixaAtual?.aulasPorGrau ? Math.max(0, faixaAtual.aulasPorGrau - (aluno.checkinsDesdeGraduacao || 0)) : "—"}
                    label={faixaAtual?.aulasPorGrau ? "aulas p/ o próximo grau" : "sem critério de grau"}
                  />
                </div>
              </>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 8 }}>
                  <Field label="Nome" labelColor="#C9C4B4"><input style={inputStyle} value={nome} onChange={(e) => setNome(e.target.value)} /></Field>
                  <Field label="Apelido" labelColor="#C9C4B4"><input style={inputStyle} value={apelido} onChange={(e) => setApelido(e.target.value)} /></Field>
                  <Field label="E-mail" labelColor="#C9C4B4"><input style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
                  <Field label="Telefone" labelColor="#C9C4B4"><input style={inputStyle} value={telefone} onChange={(e) => setTelefone(e.target.value)} /></Field>
                  <Field label="Endereço" labelColor="#C9C4B4"><input style={inputStyle} value={endereco} onChange={(e) => setEndereco(e.target.value)} /></Field>
                  <Field label="Contato de emergência (nome)" labelColor="#C9C4B4"><input style={inputStyle} value={cen} onChange={(e) => setCen(e.target.value)} /></Field>
                  <Field label="Contato de emergência (telefone)" labelColor="#C9C4B4"><input style={inputStyle} value={cet} onChange={(e) => setCet(e.target.value)} /></Field>
                  <Field label="Peso (kg)" labelColor="#C9C4B4"><input type="number" min="0" step="0.1" style={inputStyle} value={peso} onChange={(e) => setPeso(e.target.value)} /></Field>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <ConfirmButton dark onConfirm={salvarPerfil}>Salvar</ConfirmButton>
                  <Button variant="ghost" icon={X} style={{ color: "#FFFFFF", border: "1px solid rgba(255,255,255,0.35)" }} onClick={() => setEditando(false)}>Cancelar</Button>
                </div>
              </div>
            )}
          </div>

          {!editando && (
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              <ActionPill variant="primary" onClick={fazerCheckinLocalizacao} disabled={buscandoLocal} corFundo={faixaAtual?.cor} corTexto={faixaAtual?.texto}>{buscandoLocal ? "Localizando…" : "📍 Fazer check-in"}</ActionPill>
              <ActionPill onClick={() => irParaPagina(1)}>Financeiro</ActionPill>
              <ActionPill onClick={() => setEditando(true)}>Editar</ActionPill>
            </div>
          )}

          {msg && (
            <Card style={{ marginBottom: 14, background: "#1A1D24", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: msg.includes("confirmado") ? "#4ADE80" : "#FF8A80" }}>{msg}</div>
            </Card>
          )}

          <Card style={{ background: "#1A1D24", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div style={{ ...blockTitleStyle, color: "#F5F3EC" }}>Próximo treino</div>
            {proximaTurmaObj ? (
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: "10px 12px", border: "1px solid rgba(255,255,255,0.06)", color: "#F5F3EC" }}>
                <span style={{ fontWeight: 600 }}>{proximaTurmaObj.nome}</span>
                <span style={{ color: "#C9A227" }}>{proximaTurmaObj.horario}{proximaTurmaObj.horarioFim ? ` - ${proximaTurmaObj.horarioFim}` : ""}</span>
              </div>
            ) : (
              <div style={{ fontSize: 12.5, color: "#9B9891" }}>Nenhum treino cadastrado na grade agora.</div>
            )}
            <p style={{ fontSize: 12, color: "#9B9891", marginTop: 10, marginBottom: 0 }}>
              {localCheckin.exigeLocalizacao
                ? `Toque em "Check-in" acima estando em ${localCheckin.nome} durante a aula ativa.`
                : `Sua unidade é "${localCheckin.nome}" — não exige localização, só confirma a aula ativa no seu horário.`}
            </p>
          </Card>
        </div>

        {/* PÁGINA 2 — FINANCEIRO */}
        <div className="qg-sem-barra" style={{ flex: "0 0 100%", width: "100%", boxSizing: "border-box", scrollSnapAlign: "start", scrollSnapStop: "always", overflowY: "auto", touchAction: "pan-y", padding: "20px 20px 24px" }}>
          <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 20, color: "#fff", textTransform: "uppercase", marginBottom: 4 }}>💰 Financeiro</div>
          <div style={{ fontSize: 12.5, color: "#9B9891", marginBottom: 16 }}>Seus pagamentos e a chave PIX do QG</div>
          <FinanceiroAluno aluno={aluno} planos={data.planos} chavePix={(data.unidades || []).find((u) => u.id === aluno.unidadeId)?.chavePix || data.academia.chavePix} />
        </div>

        {/* PÁGINA 3 — EVOLUÇÃO */}
        <div className="qg-sem-barra" style={{ flex: "0 0 100%", width: "100%", boxSizing: "border-box", scrollSnapAlign: "start", scrollSnapStop: "always", overflowY: "auto", touchAction: "pan-y", padding: "20px 20px 24px" }}>
          <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 20, color: "#fff", textTransform: "uppercase", marginBottom: 4 }}>🥋 Evolução</div>
          <div style={{ fontSize: 12.5, color: "#9B9891", marginBottom: 16 }}>Sua jornada até a próxima faixa</div>
          <div style={{ marginBottom: 14 }}>
            <EvolucaoFaixas faixas={data.faixas} faixaId={aluno.faixaId} grau={aluno.grau} checkinsDesdeGraduacao={aluno.checkinsDesdeGraduacao} categoria={categoriaEtaria(aluno.dataNascimento)} />
          </div>
          <div style={{ ...blockTitleStyle, margin: "0 0 10px", color: "#F5F3EC" }}>Histórico de treinos</div>
          <Card style={{ background: "#1A1D24", border: "1px solid rgba(255,255,255,0.06)" }}>
            {meusCheckins.length === 0 ? (
              <Empty dark>Nenhum check-in registrado ainda.</Empty>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {meusCheckins.map((c) => {
                  const sessao = data.sessoes.find((s) => s.id === c.sessaoId);
                  const turma = sessao && data.turmas.find((t) => t.id === sessao.treinoId);
                  return (
                    <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13.5 }}>
                      <CalendarCheck size={15} color="#C9A227" />
                      <span style={{ fontWeight: 600, color: "#F5F3EC" }}>{turma?.nome || "Treino"}</span>
                      <span style={{ color: "#9B9891" }}>{new Date(c.dataHora).toLocaleString("pt-BR")}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        {/* PÁGINA 4 — AVISOS */}
        <div className="qg-sem-barra" style={{ flex: "0 0 100%", width: "100%", boxSizing: "border-box", scrollSnapAlign: "start", scrollSnapStop: "always", overflowY: "auto", touchAction: "pan-y", padding: "20px 20px 24px" }}>
          <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 20, color: "#fff", textTransform: "uppercase", marginBottom: 4 }}>🔔 Avisos</div>
          <div style={{ fontSize: 12.5, color: "#9B9891", marginBottom: 16 }}>Novidades e horários da semana</div>
          {(() => {
            const { vencimento: vencimentoAluno, plano: planoAluno } = statusPagamento(aluno, data.planos);
            if (!vencimentoAluno || !planoAluno || Number(planoAluno.valor) === 0) return null;
            const diasParaVencer = Math.round((new Date(vencimentoAluno + "T00:00:00") - new Date(hoje() + "T00:00:00")) / 86400000);
            if (diasParaVencer > 5) return null;
            const texto = diasParaVencer < 0
              ? `Sua mensalidade está vencida há ${Math.abs(diasParaVencer)} dia(s).`
              : diasParaVencer === 0
              ? "Sua mensalidade vence hoje!"
              : `Sua mensalidade vence em ${diasParaVencer} dia(s).`;
            return (
              <div style={{ background: "linear-gradient(90deg, #C81E1E, #E85D5D, #C81E1E)", borderRadius: 14, padding: "14px 18px", marginBottom: 14, display: "flex", alignItems: "center", gap: 10, boxShadow: "0 2px 10px rgba(200,30,30,0.3)" }}>
                <span style={{ fontSize: 22 }}>💰</span>
                <div>
                  <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 14, color: "#FFFFFF" }}>{texto}</div>
                  <div style={{ fontSize: 12, color: "#FFE5E5" }}>Confira a chave PIX na aba Financeiro.</div>
                </div>
              </div>
            );
          })()}
          {(() => {
            const avisosDoAluno = [...(data.avisos || [])].filter((a) => !a.professorId || a.professorId === aluno.professorId);
            if (avisosDoAluno.length === 0) return null;
            return (
              <Card style={{ marginBottom: 14, background: "#1A1D24", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ ...blockTitleStyle, color: "#FFFFFF" }}>Avisos e lembretes</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {avisosDoAluno.sort((a, b) => (b.criadoEm || "").localeCompare(a.criadoEm || "")).slice(0, 8).map((a) => (
                    <div key={a.id} style={{ borderLeft: "3px solid #C9A227", paddingLeft: 10 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: "#C9A227", textTransform: "uppercase" }}>{a.tipo || "Aviso"}</span>
                      <div style={{ fontWeight: 700, fontSize: 13.5, color: "#FFFFFF" }}>{a.titulo}</div>
                      {a.mensagem && <div style={{ fontSize: 12.5, color: "#C9C4B4" }}>{a.mensagem}</div>}
                      {a.dataEvento && <div style={{ fontSize: 12, color: "#C9A227", fontWeight: 600 }}>Data: {new Date(a.dataEvento + "T00:00:00").toLocaleDateString("pt-BR")}</div>}
                      <div style={{ fontSize: 11, color: "#8A8574" }}>{new Date(a.criadoEm).toLocaleDateString("pt-BR")}</div>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })()}
        </div>

        {/* PÁGINA 5 — MAIS */}
        <div className="qg-sem-barra" style={{ flex: "0 0 100%", width: "100%", boxSizing: "border-box", scrollSnapAlign: "start", scrollSnapStop: "always", overflowY: "auto", touchAction: "pan-y", padding: "20px 20px 24px" }}>
          <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 20, color: "#fff", textTransform: "uppercase", marginBottom: 4 }}>☰ Mais</div>
          <div style={{ fontSize: 12.5, color: "#9B9891", marginBottom: 16 }}>Vídeos, redes sociais e conta</div>

          <GradeHorarios turmas={turmasGeraisDaUnidade} />

          <VideosAluno videos={(data.videos || []).filter((v) => (!v.professorId || v.professorId === aluno.professorId) && (!v.unidadeId || v.unidadeId === aluno.unidadeId))} />

          <ProdutosAluno produtos={(data.produtos || []).filter((p) => p.professorId === aluno.professorId && p.ativo !== false)} />

          <RegrasTatameAluno imagem={data.academia.regrasTatame} />

          <GolpesProibidosCard pdf={data.academia.golpesProibidosPdf} pdfNome={data.academia.golpesProibidosPdfNome} />

          {(data.academia.instagram || data.academia.facebook || data.academia.whatsapp) && (
            <Card style={{ marginBottom: 14, background: "#1A1D24", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ ...blockTitleStyle, color: "#F5F3EC" }}>Contatos Cia Paulista</div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {data.academia.instagram && <a href={data.academia.instagram} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 600, color: "#C9A227" }}>Instagram</a>}
                {data.academia.facebook && <a href={data.academia.facebook} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 600, color: "#C9A227" }}>Facebook</a>}
                {data.academia.whatsapp && <a href={data.academia.whatsapp} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 600, color: "#C9A227" }}>WhatsApp</a>}
              </div>
            </Card>
          )}

          <Card style={{ marginBottom: 14, padding: 14, background: "#1A1D24", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div style={{ fontWeight: 700, fontSize: 12.5, color: "#F5F3EC", textTransform: "uppercase", marginBottom: 8 }}>Alterar senha</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px,1fr))", gap: 8 }}>
              <input type="password" style={inputStyleDark} placeholder="Senha atual" value={senhaAtual} onChange={(e) => setSenhaAtual(e.target.value)} />
              <input type="password" style={inputStyleDark} placeholder="Nova senha" value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} />
              <input type="password" style={inputStyleDark} placeholder="Confirmar nova senha" value={confirmarSenha} onChange={(e) => setConfirmarSenha(e.target.value)} />
            </div>
            {msgSenha && <div style={{ marginTop: 6, fontSize: 12, fontWeight: 600, color: msgSenha.includes("sucesso") ? "#4ADE80" : "#FF8A80" }}>{msgSenha}</div>}
            <div style={{ marginTop: 8 }}><ConfirmButton dark onConfirm={alterarSenha}>Salvar nova senha</ConfirmButton></div>
          </Card>

          {(data.academia.termoPadrao || data.academia.termoPdf) && (
            <Card style={{ marginBottom: 14, background: "#1A1D24", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ ...blockTitleStyle, color: "#F5F3EC" }}>Termo de consentimento</div>
              {data.academia.termoPdf && (
                <a href={data.academia.termoPdf} target="_blank" rel="noreferrer" onClick={(e) => { e.preventDefault(); abrirPdfDataUrl(data.academia.termoPdf); }} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "#C9A227", marginBottom: 10 }}>
                  📄 Abrir termo em PDF ({data.academia.termoPdfNome || "termo.pdf"})
                </a>
              )}
              {aluno.termoAceito ? (
                <div style={{ fontSize: 13, color: "#4ADE80", fontWeight: 600 }}>Aceito em {new Date(aluno.termoAceitoEm).toLocaleDateString("pt-BR")}</div>
              ) : aluno.termoAssinadoManual ? (
                <div style={{ fontSize: 13, color: "#C4C0B4" }}>Assinado fisicamente (registrado pela administração).</div>
              ) : (
                <>
                  {data.academia.termoPadrao && <div style={{ whiteSpace: "pre-wrap", fontSize: 12.5, color: "#C4C0B4", maxHeight: 140, overflowY: "auto", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: 10, marginBottom: 10 }}>{data.academia.termoPadrao}</div>}
                  <Field label="Assine com o dedo abaixo" labelColor="#C9C4B4">
                    <SignaturePad onChange={setAssinaturaTermoMais} />
                  </Field>
                  <div style={{ marginTop: 10 }}><Button icon={Check} variant="gold" disabled={!assinaturaTermoMais} onClick={aceitarTermo}>Li e aceito o termo</Button></div>
                </>
              )}
            </Card>
          )}
        </div>

      </div>

      <div style={{ flexShrink: 0, background: "#000", borderTop: "1px solid rgba(255,255,255,0.08)", paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div style={{ display: "flex", justifyContent: "space-around", alignItems: "center", padding: "10px 4px 4px" }}>
          {[
            { icone: "🏠", nome: "Perfil" },
            { icone: "💰", nome: "Financeiro" },
            { icone: "🥋", nome: "Evolução" },
            { icone: "🔔", nome: "Avisos" },
            { icone: "☰", nome: "Mais" },
          ].map((item, i) => (
            <button key={i} onClick={() => irParaPagina(i)} style={{ background: "none", border: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 3, fontSize: 9.5, color: paginaAtiva === i ? "#C9A227" : "#6B6862", cursor: "pointer", flex: 1, padding: 0 }}>
              <span style={{ fontSize: 17 }}>{item.icone}</span>
              {item.nome}
            </button>
          ))}
        </div>
        <div style={{ textAlign: "center", fontSize: 9, color: "#4E4B44", padding: "2px 0 6px", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
          <span>Desenvolvido por TECBM - Bruno Martins Tecnologia</span>
          <img src={LOGO_TECBM} alt="" style={{ height: 11, width: "auto", verticalAlign: "middle" }} />
        </div>
      </div>
    </div>
  );
}
