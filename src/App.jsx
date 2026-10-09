import { useState, useEffect, useRef, useLayoutEffect, createContext, useContext } from "react";
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid } from "recharts";
import { Shield, User, Users, QrCode, Camera, Check, Plus, Trash2, X, Award, CalendarCheck, CreditCard, ChevronRight, LogOut, Gift, RefreshCw, Download, Share, LayoutDashboard, UserCog, Calendar, Wallet, FileText, Bell, MapPin, Video, Home, ShoppingBag, Receipt, PlayCircle, Settings, Timer, ExternalLink, ClipboardList } from "lucide-react";
import { loadAll, saveAll, saveAlunos, salvarInscricaoPush, notificarPush, criarContaAuth, redefinirSenhaAuth, atualizarEmailAuth, excluirContaAuth, excluirDadosRelacionadosAluno } from "./db.js";
import { uploadArquivo, removerArquivo, pg, supabaseAuth, definirLembrarSessao } from "./supabaseClient.js";
import { LOGO_CIRCULAR, LOGO_ICONE, LOGO_FUNDO } from "./logos.js";
import { MARCA, GRADE_HORARIOS } from "virtual:marca";

// Chave pública Web Push da academia (par da VAPID_PRIVATE_KEY nos secrets do Supabase).
const VAPID_PUBLIC_KEY = MARCA.vapidPublicKey;

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

/*
 * Mantém a conta de login (Supabase Auth) de um aluno/professor alinhada com o formulário de
 * cadastro/edição: cria a conta se ainda não existe (precisa de e-mail) e atualiza a senha lá se
 * ela mudou. Devolve o patch a mesclar no registro local (ex: { authUserId }) ou null se nada
 * precisou mudar. Lança erro com mensagem amigável pro chamador decidir o que fazer.
 */
async function sincronizarContaAuth(registroAnterior, form) {
  if (!form.email) return null;
  if (!registroAnterior?.authUserId) {
    try {
      const authUserId = await criarContaAuth(form.email, form.senha);
      return { authUserId };
    } catch (e) {
      throw new Error(`Não foi possível criar o login desta pessoa: ${e.message}`);
    }
  }
  if (form.email.trim().toLowerCase() !== (registroAnterior.email || "").trim().toLowerCase()) {
    try {
      await atualizarEmailAuth(registroAnterior.authUserId, form.email);
    } catch (e) {
      throw new Error(`Cadastro salvo, mas não foi possível atualizar o e-mail de login: ${e.message}`);
    }
  }
  if (form.senha && form.senha !== registroAnterior.senha) {
    try {
      await redefinirSenhaAuth(registroAnterior.authUserId, form.senha);
    } catch (e) {
      throw new Error(`Cadastro salvo, mas não foi possível atualizar a senha de login: ${e.message}`);
    }
  }
  return null;
}

// Tema claro do desktop (admin/professor, só depois de logar — ver App()). Os componentes que já
// eram "escuros" (Card dark, StatCard dark, cores lidas direto no style) passam a checar esse
// contexto e clarear sozinhos quando ele está ligado; fora dele (celular, telas de login, aluno)
// continuam exatamente como sempre foram. Nenhum componente de login consulta este hook.
const DesktopThemeContext = createContext(false);
const useDesktopLight = () => useContext(DesktopThemeContext);
// Estilo do botão "ghost" usado em cima de fundo escuro — repetido dezenas de vezes no app. Vira
// undefined (usa a cor padrão do Button, que já é clara) quando o desktop está no tema claro.
const ghostEscuroFallback = (light) => (light ? undefined : { color: "#F5F3EC", border: "1px solid rgba(255,255,255,0.2)" });

// Paleta do tema claro — deriva da marca (navy/dourado) já usada no app, só troca o fundo escuro
// por um canvas claro com cards de sombra suave.
const LIGHT = {
  ink: "#12213B", gold: "#C9A227", goldSoft: "#EFE1B0",
  paper: "#EFEAD9", surface: "#FFFFFF", line: "#DFD6BC",
  muted: "#8A8371", text: "#241F14",
  good: "#1E7A34", goodSoft: "#E4F3E7",
  warn: "#9C6B0A", warnSoft: "#FBEFD7",
  bad: "#B3261E", badSoft: "#FBEAE8",
  shadow: "0 1px 2px rgba(18,33,59,.05), 0 10px 26px rgba(18,33,59,.09)",
  shadowSm: "0 1px 2px rgba(18,33,59,.05), 0 4px 12px rgba(18,33,59,.07)",
};

const STORAGE_KEY = "qg-data-v3";
const PERIOD_MESES = { mensal: 1, trimestral: 3, semestral: 6, anual: 12 };
const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const formatDias = (dias) => (Array.isArray(dias) ? dias.join("/") : (dias || ""));

const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : "id-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

// Número de cadastro sequencial do aluno (tipo "matrícula" mesmo, um código único por pessoa).
const proximoCodigoAluno = (alunos) => Math.max(0, ...alunos.map((a) => a.codigo || 0)) + 1;
const formatarCodigoAluno = (n) => "Nº " + String(n).padStart(3, "0");
// Preenche o código só de quem ainda não tem (alunos já cadastrados antes dessa função existir),
// dando os números mais baixos pra quem matriculou primeiro. Roda uma única vez, na carga inicial.
function atribuirCodigosFaltantes(alunos) {
  if (alunos.every((a) => a.codigo)) return alunos;
  const usados = new Set(alunos.filter((a) => a.codigo).map((a) => a.codigo));
  let proximo = 1;
  const codigosPorId = {};
  [...alunos]
    .sort((a, b) => (a.matricula || "9999-99-99").localeCompare(b.matricula || "9999-99-99") || a.nome.localeCompare(b.nome))
    .forEach((a) => {
      if (a.codigo) return;
      while (usados.has(proximo)) proximo++;
      codigosPorId[a.id] = proximo;
      usados.add(proximo);
      proximo++;
    });
  return alunos.map((a) => (codigosPorId[a.id] ? { ...a, codigo: codigosPorId[a.id] } : a));
}
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

/* Baixa um objeto como arquivo .json — usado pra exportação de dados (direito de portabilidade/
   acesso da LGPD). */
function baixarJson(nomeArquivo, objeto) {
  const blob = new Blob([JSON.stringify(objeto, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* Monta o "pacote" de dados pessoais de um aluno pra exportação (LGPD, direito de acesso/
   portabilidade — art. 18). Sem senha nem dado de outro aluno. */
function dadosExportaveisAluno(aluno, data) {
  const faixa = data.faixas.find((f) => f.id === aluno.faixaId);
  return {
    geradoEm: new Date().toISOString(),
    dadosCadastrais: {
      nome: aluno.nome, email: aluno.email || null, telefone: aluno.telefone || null,
      endereco: aluno.endereco || null, dataNascimento: aluno.dataNascimento || null,
      contatoEmergenciaNome: aluno.contatoEmergenciaNome || null,
      contatoEmergenciaTelefone: aluno.contatoEmergenciaTelefone || null,
      matricula: aluno.matricula || null, codigo: aluno.codigo || null,
      faixa: faixa?.nome || null, grau: aluno.grau || 0,
    },
    consentimentoLgpd: {
      termoAceito: !!aluno.termoAceito, termoAceitoEm: aluno.termoAceitoEm || null,
      assinaturaRegistrada: !!aluno.assinaturaTermo,
    },
    anamnese: aluno.anamneseEm ? { preenchidaEm: aluno.anamneseEm, respostas: aluno.anamnese?.respostas || {} } : null,
    pagamentos: (aluno.pagamentos || []).map((p) => ({ data: p.data, valor: p.valor })),
    checkins: (data.checkins || []).filter((c) => c.alunoId === aluno.id).map((c) => ({ dataHora: c.dataHora })),
    compras: (data.vendas || []).filter((v) => v.alunoId === aluno.id).map((v) => ({ produto: v.produtoNome, valor: v.valor, data: v.data })),
  };
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

function statusPagamento(aluno, planos, dataRef = null) {
  const plano = (planos || []).find((p) => p.id === aluno.planoId);
  if (plano && Number(plano.valor) === 0) return { emDia: true, vencimento: null, plano };
  if (!aluno.ultimoPagamento) return { emDia: false, vencimento: null, plano };
  // Sem plano (ou plano de outro professor, invisível pela RLS): o pagamento vale 1 mês.
  let vencimento = addMeses(aluno.ultimoPagamento, PERIOD_MESES[plano?.periodicidade] || 1);
  if (aluno.diaVencimento) {
    const [y, m] = vencimento.split("-");
    vencimento = `${y}-${m}-${String(aluno.diaVencimento).padStart(2, "0")}`;
  }
  return { emDia: vencimento >= (dataRef || hoje()), vencimento, plano };
}

/* Pendentes de um mês (relatórios): olha só aquele mês, não a situação de hoje. Um pagamento
   cobre o mês em que foi feito e os seguintes conforme a periodicidade do plano (mensal = só
   aquele mês, trimestral = 3 meses...). Pendente = aluno ativo, matriculado até o fim do mês,
   com plano pago (ou sem plano), sem nenhum pagamento cobrindo aquele mês. */
function pendentesNoMes(alunos, planos, mes) {
  const [y, m] = mes.split("-").map(Number);
  const indiceMes = (ym) => { const [a, b] = ym.split("-").map(Number); return a * 12 + (b - 1); };
  const alvo = y * 12 + (m - 1);
  const fimMes = `${mes}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
  return alunos.filter((a) => {
    if (a.ativo === false) return false;
    if (a.matricula && a.matricula > fimMes) return false;
    const plano = (planos || []).find((p) => p.id === a.planoId);
    if (plano && Number(plano.valor) === 0) return false;
    const meses = PERIOD_MESES[plano?.periodicidade] || 1;
    const coberto = (a.pagamentos || []).some((p) => { const i = indiceMes(p.data.slice(0, 7)); return i <= alvo && alvo < i + meses; });
    return !coberto;
  });
}

async function darBaixaEm(data, save, alunoId, valorProdutos = 0, valorPagoCustom = null, dataPagamento = null) {
  // dataPagamento permite lançar pagamento retroativo (ex.: mês anterior); nunca no futuro.
  const dataPag = dataPagamento && dataPagamento <= hoje() ? dataPagamento : hoje();
  const alunos = data.alunos.map((a) => {
    if (a.id !== alunoId) return a;
    const plano = data.planos.find((p) => p.id === a.planoId);
    const valorMensalidade = valorPagoCustom != null ? Number(valorPagoCustom) || 0 : (plano?.valor || 0);
    const extra = Number(valorProdutos) || 0;
    const pagamento = { id: uid(), data: dataPag, valor: valorMensalidade + extra, valorMensalidade, valorProdutos: extra };
    const pagamentos = [...(a.pagamentos || []), pagamento];
    // Um lançamento retroativo não pode "voltar" o último pagamento se já existe um mais recente.
    const ultimoPagamento = a.ultimoPagamento && a.ultimoPagamento > dataPag ? a.ultimoPagamento : dataPag;
    return { ...a, ultimoPagamento, pagamentos };
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
  await save({ ...data, checkins: [...data.checkins, checkin] });
}

async function removerPresencaEm(data, save, sessaoId, alunoId) {
  const checkin = data.checkins.find((c) => c.sessaoId === sessaoId && c.alunoId === alunoId);
  if (!checkin) return;
  const checkins = data.checkins.filter((c) => c.id !== checkin.id);
  await save({ ...data, checkins });
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

function FotosTreinoAluno({ fotos, nomeProfessor }) {
  const [aberta, setAberta] = useState(null);
  if (!fotos || fotos.length === 0) return null;
  return (
    <div style={{ background: "linear-gradient(165deg, #1A1D24 0%, #0D0F13 100%)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: 16, marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 20 }}>📸</span>
        <div>
          <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 14, color: "#FFFFFF" }}>Foto do treino</div>
          <div style={{ fontSize: 11.5, color: "#9B9891" }}>{nomeProfessor ? `De: ${nomeProfessor}` : ""} · fica visível por alguns dias</div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(86px, 1fr))", gap: 8 }}>
        {fotos.map((f) => (
          <button key={f.id} onClick={() => setAberta(f)} style={{ padding: 0, border: "none", background: "none", cursor: "pointer" }}>
            <img src={f.fotoUrl} alt="" style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 8 }} />
          </button>
        ))}
      </div>
      {aberta && (
        <div onClick={() => setAberta(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20 }}>
          <img src={aberta.fotoUrl} alt="" style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 8 }} />
        </div>
      )}
    </div>
  );
}

function BannerAniversario({ nome, mensagemPersonalizada }) {
  const primeiroNome = nome.split(" ")[0];
  const mensagem = (mensagemPersonalizada || `Toda a equipe do ${MARCA.sede} deseja um ótimo dia. 🥋`).split("{nome}").join(primeiroNome);
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

// Aulas que contam pro próximo grau/faixa: os check-ins do histórico do aluno feitos depois da
// última graduação (sem graduação registrada, conta o histórico inteiro), mais o ajuste manual
// do professor. Calculado sempre a partir de data.checkins pra bater com o "Histórico de treinos".
function aulasDesdeGraduacao(aluno, checkins) {
  const desde = aluno.ultimaGraduacaoEm ? new Date(aluno.ultimaGraduacaoEm).getTime() : null;
  const doHistorico = (checkins || []).filter((c) => c.alunoId === aluno.id && (desde == null || new Date(c.dataHora).getTime() > desde)).length;
  return Math.max(0, doHistorico + (Number(aluno.ajusteAulas) || 0));
}

function progressoGraduacaoTexto(faixas, faixaId, grau, checkinsDesdeGraduacao, categoria) {
  return progressoGraduacaoInfo(faixas, faixaId, grau, checkinsDesdeGraduacao, categoria).texto;
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
  const light = useDesktopLight();
  const escuro = dark && !light;
  return <div className={light && dark ? "qg-card" : undefined} style={{
    background: escuro ? "#1A1D24" : (light && dark ? LIGHT.surface : "#FFFFFF"),
    border: escuro ? "1px solid rgba(255,255,255,0.06)" : (light && dark ? `1px solid ${LIGHT.line}` : "1px solid #EFEBDF"),
    borderRadius: light && dark ? 16 : 14, padding: 18,
    boxShadow: escuro ? "0 1px 3px rgba(0,0,0,0.25)" : (light && dark ? LIGHT.shadow : "0 1px 3px rgba(23,24,27,0.05)"),
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
    <button type={type} onClick={onClick} disabled={disabled} className="qg-btn" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 8, fontFamily: "Inter", fontWeight: 600, fontSize: 13.5, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, border: "none", ...variants[variant], ...style }}>
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
  dark = dark && !useDesktopLight();
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

// Visualizador em tela cheia com zoom próprio (pinça, toque duplo e botões +/−): o viewport do app
// bloqueia o zoom nativo da página (user-scalable=no), então o zoom é feito aqui dentro.
function ImagemZoom({ src, alt, onFechar }) {
  const [escala, setEscala] = useState(1);
  const caixaRef = useRef(null);
  const pinca = useRef(null);
  const ultimoToque = useRef(0);
  const MIN = 1, MAX = 5;
  const limitar = (z) => Math.min(MAX, Math.max(MIN, z));

  // Aplica um novo zoom mantendo fixo o ponto (px, py) da tela, relativo à caixa.
  const aplicarZoom = (nova, px, py, base = escala, baseScroll = null) => {
    const caixa = caixaRef.current;
    if (!caixa) return;
    nova = limitar(nova);
    const sl = baseScroll ? baseScroll.left : caixa.scrollLeft;
    const st = baseScroll ? baseScroll.top : caixa.scrollTop;
    const fator = nova / base;
    setEscala(nova);
    requestAnimationFrame(() => {
      caixa.scrollLeft = (sl + px) * fator - px;
      caixa.scrollTop = (st + py) * fator - py;
    });
  };

  useEffect(() => {
    const overflowAntes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const tecla = (e) => { if (e.key === "Escape") onFechar(); };
    window.addEventListener("keydown", tecla);
    return () => { document.body.style.overflow = overflowAntes; window.removeEventListener("keydown", tecla); };
  }, [onFechar]);

  const relativo = (x, y) => { const r = caixaRef.current.getBoundingClientRect(); return [x - r.left, y - r.top]; };
  const distancia = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

  const onTouchStart = (e) => {
    if (e.touches.length === 2) {
      const [px, py] = relativo((e.touches[0].clientX + e.touches[1].clientX) / 2, (e.touches[0].clientY + e.touches[1].clientY) / 2);
      pinca.current = { dist: distancia(e.touches), escala, px, py, scroll: { left: caixaRef.current.scrollLeft, top: caixaRef.current.scrollTop } };
    } else if (e.touches.length === 1) {
      const agora = Date.now();
      if (agora - ultimoToque.current < 300) {
        const [px, py] = relativo(e.touches[0].clientX, e.touches[0].clientY);
        aplicarZoom(escala > 1.5 ? 1 : 2.5, px, py);
        ultimoToque.current = 0;
      } else ultimoToque.current = agora;
    }
  };
  const onTouchMove = (e) => {
    if (e.touches.length === 2 && pinca.current) {
      e.preventDefault();
      const p = pinca.current;
      aplicarZoom(p.escala * (distancia(e.touches) / p.dist), p.px, p.py, p.escala, p.scroll);
    }
  };
  const onTouchEnd = (e) => { if (e.touches.length < 2) pinca.current = null; };
  const onWheel = (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const [px, py] = relativo(e.clientX, e.clientY);
    aplicarZoom(escala * (e.deltaY < 0 ? 1.15 : 1 / 1.15), px, py);
  };
  const botaoZoom = (fator) => {
    const caixa = caixaRef.current;
    aplicarZoom(escala * fator, caixa.clientWidth / 2, caixa.clientHeight / 2);
  };

  // touchmove precisa ser não-passivo para o preventDefault da pinça funcionar.
  useEffect(() => {
    const caixa = caixaRef.current;
    if (!caixa) return;
    const mover = (e) => onTouchMove(e);
    caixa.addEventListener("touchmove", mover, { passive: false });
    return () => caixa.removeEventListener("touchmove", mover);
  });

  const botao = { width: 44, height: 44, borderRadius: 22, border: "1px solid rgba(255,255,255,0.25)", background: "rgba(20,23,31,0.85)", color: "#FFFFFF", fontSize: 22, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" };
  return (
    <div style={{ position: "fixed", inset: 0, background: "#000000", zIndex: 9999, display: "flex", flexDirection: "column" }}>
      <div ref={caixaRef} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} onWheel={onWheel}
        style={{ flex: 1, overflow: "auto", touchAction: "pan-x pan-y", WebkitOverflowScrolling: "touch" }}>
        <img src={src} alt={alt} draggable={false} style={{ display: "block", width: `${escala * 100}%`, maxWidth: "none", height: "auto", margin: escala === 1 ? "0 auto" : 0, userSelect: "none" }} />
      </div>
      <button onClick={onFechar} aria-label="Fechar" style={{ ...botao, position: "absolute", top: "calc(12px + env(safe-area-inset-top))", right: 12 }}><X size={22} /></button>
      <div style={{ position: "absolute", bottom: "calc(16px + env(safe-area-inset-bottom))", left: 0, right: 0, display: "flex", justifyContent: "center", gap: 12, pointerEvents: "none" }}>
        <button onClick={() => botaoZoom(1 / 1.5)} aria-label="Diminuir zoom" style={{ ...botao, pointerEvents: "auto", opacity: escala <= MIN ? 0.4 : 1 }}>−</button>
        <button onClick={() => botaoZoom(1.5)} aria-label="Aumentar zoom" style={{ ...botao, pointerEvents: "auto", opacity: escala >= MAX ? 0.4 : 1 }}>+</button>
      </div>
    </div>
  );
}

function GradeHorarios({ turmas }) {
  const [aberto, setAberto] = useState(false);
  const [telaCheia, setTelaCheia] = useState(false);
  const dias = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
  const comAula = dias.filter((dia) => turmas.some((t) => (t.dias || []).includes(dia)));
  return (
    <Card style={{ marginBottom: 14, background: "#1A1D24", border: "1px solid rgba(255,255,255,0.06)" }}>
      <button onClick={() => setAberto((v) => !v)} style={{ width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ ...blockTitleStyle, color: "#FFFFFF" }}>Grade de horários</span>
        <span style={{ fontSize: 18, color: "#C9A227" }}>{aberto ? "−" : "+"}</span>
      </button>
      {aberto && GRADE_HORARIOS && (
        <div style={{ marginTop: 10 }}>
          <button onClick={() => setTelaCheia(true)} style={{ display: "block", width: "100%", padding: 0, border: "none", background: "none", cursor: "zoom-in" }}>
            <img src={GRADE_HORARIOS} alt="Grade de horários" style={{ display: "block", width: "100%", height: "auto", borderRadius: 8 }} />
          </button>
          <div style={{ marginTop: 6, fontSize: 11.5, color: "#9B9891", textAlign: "center" }}>Toque na imagem para ampliar</div>
          {telaCheia && <ImagemZoom src={GRADE_HORARIOS} alt="Grade de horários" onFechar={() => setTelaCheia(false)} />}
        </div>
      )}
      {aberto && !GRADE_HORARIOS && (
        comAula.length === 0 ? (
          <div style={{ marginTop: 10 }}><Empty dark>Nenhuma turma cadastrada ainda.</Empty></div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
            {comAula.map((dia) => (
              <div key={dia}>
                <div style={{ fontWeight: 700, fontSize: 12.5, color: "#C9A227", marginBottom: 4 }}>{dia}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {turmas.filter((t) => (t.dias || []).includes(dia)).sort((a, b) => (a.horario || "").localeCompare(b.horario || "")).map((t) => (
                    <div key={t.id} style={{ fontSize: 12.5, color: "#E5E1D4", display: "flex", justifyContent: "space-between", background: "rgba(255,255,255,0.05)", borderRadius: 6, padding: "6px 10px", border: "1px solid rgba(255,255,255,0.1)" }}>
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
          <div style={{ fontSize: 12, color: "#5A5648" }}>Chave PIX do {MARCA.sede}: <b>{chavePix}</b></div>
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
                <button key={v.id} onClick={() => setSelecionadoId(v.id)} style={{ textAlign: "left", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "10px 12px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13.5, color: "#F5F3EC" }}>{v.titulo}</div>
                    {v.legenda && <div style={{ fontSize: 11.5, color: "#9B9891" }}>{v.legenda}</div>}
                  </div>
                  <ChevronRight size={16} color="#9B9891" />
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
  dark = dark && !useDesktopLight();
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

function mesmoDiaMesAnterior() {
  const d = new Date();
  const ultimoDiaMesAnterior = new Date(d.getFullYear(), d.getMonth(), 0).getDate();
  const ant = new Date(d.getFullYear(), d.getMonth() - 1, Math.min(d.getDate(), ultimoDiaMesAnterior));
  return `${ant.getFullYear()}-${String(ant.getMonth() + 1).padStart(2, "0")}-${String(ant.getDate()).padStart(2, "0")}`;
}

function DarBaixaControle({ plano, mensalidade, onConfirmar, dark = true, retroativo = false }) {
  const light = useDesktopLight();
  const escuro = dark && !light;
  const [aberto, setAberto] = useState(false);
  const [produtos, setProdutos] = useState("");
  const valorHora = Number(plano?.valorHora) || 0;
  const valorPadrao = mensalidade != null ? Number(mensalidade) || 0 : Number(plano?.valor) || 0;
  const [horas, setHoras] = useState("");
  const [valorPago, setValorPago] = useState(valorPadrao ? String(valorPadrao) : "");
  const [dataPagamento, setDataPagamento] = useState(retroativo ? mesmoDiaMesAnterior() : hoje());
  const ghostBotao = escuro ? { color: "#FFFFFF", border: "1px solid rgba(255,255,255,0.2)" } : ghostEscuroFallback(light);
  const total = (Number(valorPago) || 0) + (Number(produtos) || 0);
  const labelColor = escuro ? "#C9C4B4" : (light ? LIGHT.muted : undefined);
  const inputBase = escuro ? inputStyleDark : inputStyle;

  const aplicarHoras = (v) => {
    setHoras(v);
    if (valorHora > 0 && v !== "") setValorPago(String((Number(v) || 0) * valorHora));
  };

  if (!aberto) {
    if (retroativo) return <Button variant="ghost" style={ghostBotao} onClick={() => setAberto(true)}>Lançar retroativo</Button>;
    return <Button variant="gold" onClick={() => setAberto(true)}>Dar baixa</Button>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 220 }}>
      {valorHora > 0 && (
        <Field label={`Quantidade de horas-aula (R$ ${valorHora.toFixed(2)}/hora)`} labelColor={labelColor}>
          <input type="number" min="0" step="0.5" style={inputBase} value={horas} onChange={(e) => aplicarHoras(e.target.value)} placeholder="0" />
        </Field>
      )}
      <Field label="Data do pagamento" labelColor={labelColor}>
        <input type="date" max={hoje()} style={inputBase} value={dataPagamento} onChange={(e) => setDataPagamento(e.target.value)} />
      </Field>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: -4 }}>
        <Button variant="ghost" style={{ ...ghostBotao, padding: "4px 10px", fontSize: 12 }} onClick={() => setDataPagamento(hoje())}>Hoje</Button>
        <Button variant="ghost" style={{ ...ghostBotao, padding: "4px 10px", fontSize: 12 }} onClick={() => setDataPagamento(mesmoDiaMesAnterior())}>Mês anterior</Button>
      </div>
      <Field label="Valor total pago (R$)" labelColor={labelColor}>
        <input type="number" min="0" step="0.01" style={inputBase} value={valorPago} onChange={(e) => setValorPago(e.target.value)} placeholder="0,00" />
      </Field>
      <Field label="Produtos comprados junto (R$, opcional)" labelColor={labelColor}>
        <input type="number" min="0" step="0.01" style={inputBase} value={produtos} onChange={(e) => setProdutos(e.target.value)} placeholder="0,00" />
      </Field>
      <div style={{ fontSize: 12.5, color: escuro ? "#9B9891" : (light ? LIGHT.muted : "#5A5648") }}>
        Valor pago R$ {(Number(valorPago) || 0).toFixed(2)}{Number(produtos) > 0 ? ` + produtos R$ ${Number(produtos).toFixed(2)}` : ""} = <strong style={{ color: "#C9A227" }}>Total R$ {total.toFixed(2)}</strong>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <ConfirmButton dark={dark} onConfirm={() => { onConfirmar(Number(produtos) || 0, Number(valorPago) || 0, dataPagamento || hoje()); setAberto(false); setProdutos(""); }}>Confirmar pagamento</ConfirmButton>
        <Button variant="ghost" style={escuro ? { color: "#FFFFFF", border: "1px solid rgba(255,255,255,0.2)" } : ghostEscuroFallback(light)} onClick={() => { setAberto(false); setProdutos(""); }}>Cancelar</Button>
      </div>
    </div>
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
  // undefined = ainda não checou a sessão do Supabase Auth; null = checou e não tem sessão.
  const [authUserId, setAuthUserId] = useState(undefined);
  const [recuperacaoSenha, setRecuperacaoSenha] = useState(false);

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

  // Sessão real do Supabase Auth: checa a sessão persistida no boot e escuta login/logout/expiração.
  useEffect(() => {
    let ativo = true;
    supabaseAuth.getSession().then(({ data: { session } }) => { if (ativo) setAuthUserId(session?.user?.id || null); });
    const { data: assinatura } = supabaseAuth.onAuthStateChange((_evento, session) => {
      // Link de "esqueci minha senha" clicado: o Supabase já autentica a pessoa (sessão válida)
      // só pra permitir trocar a senha — não deve cair direto no dashboard sem definir a senha nova.
      if (_evento === "PASSWORD_RECOVERY") setRecuperacaoSenha(true);
      setAuthUserId(session?.user?.id || null);
    });
    return () => { ativo = false; assinatura?.subscription?.unsubscribe(); };
  }, []);

  const carregar = async () => {
    setLoading(true);
    setErroConexao(null);
    try {
      const fresh = await loadAll();
      // Numerar automaticamente só faz sentido vendo a lista inteira de alunos — com RLS,
      // isso só acontece numa sessão de admin (professor/aluno só recebem o próprio recorte).
      if (role === "admin" && fresh.alunos.some((a) => !a.codigo)) {
        fresh.alunos = atribuirCodigosFaltantes(fresh.alunos);
        try { await saveAlunos(fresh.alunos); } catch (_) { /* atualiza a lista mesmo assim; tenta salvar de novo na próxima carga */ }
      }
      setData(fresh);
    } catch (e) {
      setErroConexao(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { carregar(); }, []);

  // Reconsulta o banco sempre que login/logout acontece: a RLS libera um recorte diferente de
  // dados pra cada estado de sessão, e o primeiro carregamento (antes de logar) só trouxe o que
  // dava pra ver sem sessão.
  const primeiraChecagemSessao = useRef(true);
  useEffect(() => {
    if (authUserId === undefined) return;
    if (primeiraChecagemSessao.current) { primeiraChecagemSessao.current = false; return; }
    carregar();
  }, [authUserId]);

  // Deriva quem está logado a partir da sessão real: acha o registro local (aluno/professor/admin)
  // cujo auth_user_id bate com o usuário autenticado no Supabase. Some se a sessão cair ou se a
  // conta tiver sido desativada nesse meio-tempo (ativo === false não conta como logado).
  useEffect(() => {
    if (!data || authUserId === undefined) return;
    if (!authUserId) { setAdminDesbloqueado(false); setActiveProfId(null); setActiveAlunoId(null); return; }
    const aluno = data.alunos.find((a) => a.authUserId === authUserId && a.ativo !== false);
    const prof = data.professores.find((p) => p.authUserId === authUserId && p.ativo !== false);
    setActiveAlunoId(aluno ? aluno.id : null);
    setActiveProfId(prof ? prof.id : null);
    setAdminDesbloqueado(data.academia.adminAuthUserId === authUserId);
  }, [data, authUserId]);

  const save = async (next) => {
    const anterior = data;
    setData(next);
    try {
      await saveAll(next, anterior);
    } catch (e) {
      setErroConexao(e?.message || String(e));
    }
  };

  const sairAdmin = () => { supabaseAuth.signOut(); };

  if (loading || authUserId === undefined) return <div style={{ padding: 40, fontFamily: "Inter", color: "#5A5648" }}>Carregando dados do banco…</div>;

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

  if (recuperacaoSenha) return <RedefinirSenhaRecuperacao logo={data.academia.logo} onFinalizado={() => setRecuperacaoSenha(false)} />;

  const emTelaLoginPreta = (role === "professor" && !activeProfId) || (role === "aluno" && !activeAlunoId);
  const alunoAtivo = role === "aluno" ? data.alunos.find((a) => a.id === activeAlunoId) : null;
  const profAtivo = role === "professor" ? data.professores.find((p) => p.id === activeProfId) : null;
  const alunoNoDashboardProprio = role === "aluno" && alunoAtivo && alunoAtivo.ativo !== false && !(alunoAtivo.primeiroAcesso && (data.academia.termoPadrao || data.academia.termoPdf)) && !!alunoAtivo.anamneseEm;
  const professorNoDashboardMobileProprio = role === "professor" && !!profAtivo && !ehDesktopTop;
  const temRodapeProprio = alunoNoDashboardProprio || professorNoDashboardMobileProprio;

  return (
    <div style={{ minHeight: "100vh", background: "#F5F1E8", fontFamily: "Inter", display: "flex", flexDirection: "column" }}>
      <style>{".qg-sem-barra{scrollbar-width:none;-ms-overflow-style:none;}.qg-sem-barra::-webkit-scrollbar{display:none;width:0;height:0;}"
        + ".qg-btn{transition:transform .35s cubic-bezier(.16,1,.3,1),box-shadow .35s cubic-bezier(.16,1,.3,1),filter .2s ease;}"
        + ".qg-btn:hover:not(:disabled){transform:translateY(-2px) scale(1.015);filter:brightness(1.06);box-shadow:0 10px 24px rgba(18,33,59,.18);}"
        + ".qg-btn:active:not(:disabled){transform:translateY(0) scale(.985);filter:brightness(0.95);box-shadow:0 2px 6px rgba(18,33,59,.12);transition:transform .1s ease,filter .1s ease,box-shadow .1s ease;}"
        + "@keyframes qg-fade-in{from{opacity:0;transform:translateY(14px) scale(.99);}to{opacity:1;transform:translateY(0) scale(1);}}"
        + ".qg-fade-in{animation:qg-fade-in .45s cubic-bezier(.16,1,.3,1) both;}"
        + ".qg-nav-item{transition:background .3s cubic-bezier(.16,1,.3,1),color .3s cubic-bezier(.16,1,.3,1),padding-left .3s cubic-bezier(.16,1,.3,1),box-shadow .3s cubic-bezier(.16,1,.3,1);}"
        + ".qg-nav-item:hover{padding-left:16px;background:rgba(18,33,59,.05);}"
        + ".qg-card{transition:transform .35s cubic-bezier(.16,1,.3,1),box-shadow .35s cubic-bezier(.16,1,.3,1);}"
        + ".qg-card:hover{transform:translateY(-3px);box-shadow:0 4px 10px rgba(18,33,59,.08),0 20px 40px rgba(18,33,59,.14);}"
        + "@keyframes qg-pop{0%{opacity:0;transform:scale(.94);}100%{opacity:1;transform:scale(1);}}"
        + ".qg-pop{animation:qg-pop .3s cubic-bezier(.16,1,.3,1) both;}"
      }</style>
      {erroConexao && (
        <div style={{ background: "#FFF3F0", color: "#B3261E", fontSize: 12.5, textAlign: "center", padding: "6px 10px" }}>
          Última ação pode não ter sido salva no banco: {erroConexao}
        </div>
      )}
      <TopNav role={role} setRole={(r) => { setRole(r); setActiveProfId(null); setActiveAlunoId(null); }} academia={data.academia} modo={modo} onAtualizar={carregar} />
      <div style={{ flex: ehDesktopTop ? 1 : "initial", display: "flex", flexDirection: "column", background: role === "aluno" && !emTelaLoginPreta && ehDesktopTop ? "#0B0D12" : undefined }}>
        {role === "admin" && (
          <div style={{ maxWidth: 980, margin: "0 auto", padding: "22px 20px 60px", width: "100%", boxSizing: "border-box" }}>
            {adminDesbloqueado ? (
              <DesktopThemeContext.Provider value={ehDesktopTop}>
                <AdminView data={data} save={save} onSairAdmin={sairAdmin} />
              </DesktopThemeContext.Provider>
            ) : <AdminGate />}
          </div>
        )}
        {role === "professor" && (
          <div style={{ maxWidth: emTelaLoginPreta && ehDesktopTop ? "none" : 980, margin: "0 auto", width: "100%", padding: !emTelaLoginPreta && ehDesktopTop ? "22px 20px 60px" : undefined, boxSizing: "border-box" }}>
            <DesktopThemeContext.Provider value={ehDesktopTop}>
              <ProfessorView data={data} save={save} activeProfId={activeProfId} />
            </DesktopThemeContext.Provider>
          </div>
        )}
        {role === "aluno" && (
          <div style={{ maxWidth: emTelaLoginPreta && ehDesktopTop ? "none" : 980, margin: "0 auto", width: "100%" }}>
            <AlunoView data={data} save={save} activeAlunoId={activeAlunoId} />
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

function AdminGate() {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);
  const entrar = async () => {
    setErro("");
    setCarregando(true);
    definirLembrarSessao(false);
    const { error } = await supabaseAuth.signInWithPassword({ email: email.trim().toLowerCase(), password: senha.trim() });
    setCarregando(false);
    if (error) setErro("E-mail ou senha incorretos.");
  };
  return (
    <div style={{ maxWidth: 360, margin: "40px auto" }}>
      <SectionTitle sub="Acesso restrito ao administrador">Painel administrador</SectionTitle>
      <Card>
        <Field label="E-mail de administrador">
          <input style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && entrar()} />
        </Field>
        <Field label="Senha de administrador">
          <input type="password" style={inputStyle} value={senha} onChange={(e) => setSenha(e.target.value)} onKeyDown={(e) => e.key === "Enter" && entrar()} />
        </Field>
        {erro && <div style={{ fontSize: 12.5, color: "#B3261E", marginTop: 6 }}>{erro}</div>}
        <div style={{ marginTop: 12 }}><Button icon={Check} onClick={entrar} disabled={carregando}>Entrar</Button></div>
      </Card>
      <div style={{ textAlign: "center", marginTop: 14, fontSize: 10.5, color: "#9B9891" }}>
        <a href="/privacidade.html" target="_blank" rel="noreferrer" style={{ color: "#9B9891" }}>Política de Privacidade</a>
      </div>
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
          <img src={academia.logo || LOGO_ICONE} alt="logo" style={{ width: 34, height: 34, borderRadius: 8, objectFit: "cover" }} />
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
  dark = dark && !useDesktopLight();
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
  const light = useDesktopLight();
  const [busca, setBusca] = useState("");
  const [categoria, setCategoria] = useState("todos");
  const [secaoExpandida, setSecaoExpandida] = useState(null);
  const [ordemFrequencia, setOrdemFrequencia] = useState("mais");
  const [dataCheckins, setDataCheckins] = useState(hoje());
  const [mesFinanceiro, setMesFinanceiro] = useState(() => new Date().toISOString().slice(0, 7));
  const [anoFinanceiro, setAnoFinanceiro] = useState(() => String(new Date().getFullYear()));
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
      <div style={{ fontSize: 12.5, color: light ? LIGHT.muted : "#9B9891", marginBottom: 12 }}>Todos os relatórios abaixo consideram só os seus {meusAlunos.length} aluno(s) vinculado(s).</div>
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <input style={{ ...inputStyle, flex: 1, minWidth: 200 }} placeholder="🔍 Buscar relatório..." value={busca} onChange={(e) => setBusca(e.target.value)} />
        {categorias.map((c) => (
          <button key={c.id} onClick={() => setCategoria(c.id)} style={light ? {
            padding: "7px 14px", borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: "pointer",
            border: `1px solid ${LIGHT.line}`, background: categoria === c.id ? LIGHT.gold : LIGHT.surface,
            color: categoria === c.id ? "#17181B" : LIGHT.muted,
          } : {
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

        {visivel("financeiro", "Relatório anual") && (
          <CartaoRelatorio dark corIcone="#F1EAFF" icone="📅" tag="Financeiro" titulo="Relatório anual"
            descricao="Receita do ano dos seus alunos, mês a mês e por aluno." botao={{ variant: "gold" }}
            onClick={() => { setErro(""); gerarRelatorioAnual(data, anoFinanceiro, setErro, meusAlunos, prof.nome); }}>
            <input type="number" min="2000" max="2100" style={{ ...inputStyle, maxWidth: "100%" }} value={anoFinanceiro} onChange={(e) => setAnoFinanceiro(e.target.value)} placeholder="2026" />
          </CartaoRelatorio>
        )}

        {visivel("financeiro", "Pagamentos: confirmados x pendentes") && (
          <CartaoRelatorio dark corIcone="#F1EAFF" icone="📈" tag="Financeiro" titulo="Pagamentos: confirmados x pendentes"
            descricao="Gráfico comparando os dois grupos, só dos seus alunos." botao={{ variant: "gold", texto: "Ver gráfico" }}
            onClick={() => setSecaoExpandida(secaoExpandida === "pagamentos" ? null : "pagamentos")} />
        )}

        {visivel("financeiro", "Vendas de produtos") && (
          <CartaoRelatorio dark corIcone="#FFF3E0" icone="🛍️" tag="Financeiro" titulo="Vendas de produtos"
            descricao="Total vendido e detalhamento por produto, das suas vendas registradas." botao={{ variant: "gold" }}
            onClick={() => { setErro(""); gerarRelatorioVendas(data, setErro, (data.vendas || []).filter((v) => v.professorId === prof.id), prof.nome); }} />
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
          <div style={light ? blockTitleStyle : { ...blockTitleStyle, color: "#F5F3EC" }}>Aniversariantes de {MESES[mesAniversario]}</div>
          {aniversariantesDoMes.length === 0 ? (
            <Empty dark>Nenhum aniversariante em {MESES[mesAniversario]}.</Empty>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {aniversariantesDoMes.map((a) => (
                <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13.5 }}>
                  <Gift size={15} color="#C9A227" />
                  <span style={{ fontWeight: 600, color: light ? LIGHT.text : "#F5F3EC" }}>{a.nome}</span>
                  <span style={{ color: light ? LIGHT.muted : "#9B9891" }}>dia {a.dataNascimento.split("-")[2]}</span>
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
  const [anoFinanceiro, setAnoFinanceiro] = useState(() => String(new Date().getFullYear()));
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
    .map((a) => ({ aluno: a, info: progressoGraduacaoInfo(data.faixas, a.faixaId, a.grau, aulasDesdeGraduacao(a, data.checkins), categoriaEtaria(a.dataNascimento)) }))
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
    const nomeUnidade = unidade ? unidade.nome : `${MARCA.sede} (padrão)`;
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

        {visivel("financeiro", "Relatório anual") && (
          <CartaoRelatorio corIcone="#F1EAFF" icone="📅" tag="Financeiro" titulo="Relatório anual"
            descricao="Receita do ano inteiro, mês a mês e por aluno." botao={{ variant: "gold" }}
            onClick={() => { setErro(""); gerarRelatorioAnual(data, anoFinanceiro, setErro); }}>
            <input type="number" min="2000" max="2100" style={{ ...inputStyle, maxWidth: "100%" }} value={anoFinanceiro} onChange={(e) => setAnoFinanceiro(e.target.value)} placeholder="2026" />
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
  const light = useDesktopLight();
  const ghostEscuro = light ? undefined : { color: "#F5F3EC", border: "1px solid rgba(255,255,255,0.2)" };
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
    let authPatch = null;
    try {
      authPatch = await sincronizarContaAuth(null, form);
    } catch (e) {
      alert(e.message);
      return;
    }
    const a = { id: uid(), tipo: "aluno", matricula: hoje(), codigo: proximoCodigoAluno(data.alunos), ultimoPagamento: null, foto: null, pagamentos: [], checkinsDesdeGraduacao: 0, primeiroAcesso: true, termoAceito: false, termoAceitoEm: null, ativo: true, ...form, ...authPatch };
    await save({ ...data, alunos: [...data.alunos, a] });
    setNovoAluno(false);
  };
  const editarAluno = async (id, form) => {
    const anterior = data.alunos.find((a) => a.id === id);
    let authPatch = null;
    try {
      authPatch = await sincronizarContaAuth(anterior, form);
    } catch (e) {
      alert(e.message);
    }
    const alunos = data.alunos.map((a) => (a.id === id ? { ...a, ...form, ...authPatch } : a));
    await save({ ...data, alunos });
    setEditandoAluno(null);
  };
  const removerAluno = async (id) => {
    const aluno = data.alunos.find((a) => a.id === id);
    await save({ ...data, alunos: data.alunos.filter((a) => a.id !== id) });
    await excluirDadosRelacionadosAluno(id);
    if (aluno?.authUserId) await excluirContaAuth(aluno.authUserId);
  };
  const resetarSenha = async (id) => {
    const aluno = data.alunos.find((a) => a.id === id);
    if (!aluno?.authUserId) { alert("Este aluno ainda não tem login real — cadastre um e-mail pra ele primeiro."); return; }
    const nova = randomSenha();
    try {
      await redefinirSenhaAuth(aluno.authUserId, nova);
      setSenhaGerada({ id, senha: nova });
    } catch (e) {
      alert(`Não foi possível redefinir a senha: ${e.message}`);
    }
  };
  const alternarAtivoAluno = async (id) => {
    const alunos = data.alunos.map((a) => (a.id === id ? { ...a, ativo: a.ativo === false ? true : false } : a));
    await save({ ...data, alunos });
  };

  const addProf = async (form) => {
    let authPatch = null;
    try {
      authPatch = await sincronizarContaAuth(null, form);
    } catch (e) {
      alert(e.message);
      return;
    }
    const p = { id: uid(), tipo: "professor", primeiroAcesso: true, termoAceito: false, termoAceitoEm: null, ...form, ...authPatch };
    await save({ ...data, professores: [...data.professores, p] });
    setNovoProf(false);
  };
  const editarProf = async (id, form) => {
    const anterior = data.professores.find((p) => p.id === id);
    let authPatch = null;
    try {
      authPatch = await sincronizarContaAuth(anterior, form);
    } catch (e) {
      alert(e.message);
    }
    const professores = data.professores.map((p) => (p.id === id ? { ...p, ...form, ...authPatch } : p));
    await save({ ...data, professores });
    setEditandoProf(null);
  };
  const removerProf = async (id) => { await save({ ...data, professores: data.professores.filter((p) => p.id !== id) }); };
  const alternarAtivoProf = async (id) => {
    const professores = data.professores.map((p) => (p.id === id ? { ...p, ativo: p.ativo === false ? true : false } : p));
    await save({ ...data, professores });
  };
  const resetarSenhaProf = async (id) => {
    const prof = data.professores.find((p) => p.id === id);
    if (!prof?.authUserId) { alert("Este professor ainda não tem login real — cadastre um e-mail pra ele primeiro."); return; }
    const nova = randomSenha();
    try {
      await redefinirSenhaAuth(prof.authUserId, nova);
      setSenhaGeradaProf({ id, senha: nova });
    } catch (e) {
      alert(`Não foi possível redefinir a senha: ${e.message}`);
    }
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
  const iconesTabsClaro = {
    dashboard: LayoutDashboard, alunos: Users, professores: UserCog, turmas: Calendar, graduacao: Award,
    planos: CreditCard, financeiro: Wallet, relatorios: FileText, avisos: Bell, unidades: MapPin, videos: Video, config: Settings,
  };

  const [refFullBleed, estiloFullBleed] = useFullBleed();

  return (
    <div ref={refFullBleed} style={{
      backgroundImage: light
        ? "none"
        : "radial-gradient(circle at 15% 15%, rgba(201,162,39,0.05), transparent 40%), linear-gradient(160deg, #14171F 0%, #0B0C10 100%)",
      background: light ? LIGHT.paper : undefined,
      minHeight: "calc(100vh - 66px)",
      ...estiloFullBleed,
      position: "relative",
      marginTop: -22,
      marginBottom: -60,
      display: "flex",
      overflow: "hidden",
    }}>
      {!light && <img src={LOGO_FUNDO} alt="" style={{ position: "absolute", width: 420, right: -110, bottom: -70, opacity: 0.05, pointerEvents: "none", zIndex: 0 }} />}
      <div style={{ width: 220, flexShrink: 0, background: light ? LIGHT.surface : "#000", borderRight: light ? `1px solid ${LIGHT.line}` : "1px solid rgba(255,255,255,0.06)", boxSizing: "border-box", zIndex: 1 }}>
        <div style={{ position: "sticky", top: 0, padding: "20px 12px" }}>
          <div style={{ padding: "0 6px 16px", marginBottom: 10, borderBottom: light ? `1px solid ${LIGHT.line}` : "1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ fontFamily: "Oswald", fontWeight: 700, color: light ? LIGHT.ink : "#fff", fontSize: 13, textTransform: "uppercase", letterSpacing: 0.4 }}>{data.academia.nome}</div>
            <div style={{ fontSize: 10.5, color: light ? LIGHT.muted : "#9B9891", marginTop: 2 }}>Painel administrador</div>
          </div>
          {tabs.map((t) => {
            const IconeClaro = iconesTabsClaro[t.id];
            const ativo = tab === t.id;
            return (
              <button key={t.id} onClick={() => setTab(t.id)} className={light ? "qg-nav-item" : undefined} style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
                padding: light ? "9px 12px" : "10px 12px", borderRadius: light ? 10 : 8, border: "none", cursor: "pointer", marginBottom: 2,
                position: "relative",
                background: ativo ? (light ? LIGHT.ink : "rgba(201,162,39,0.12)") : "transparent",
                color: ativo ? (light ? "#FFFFFF" : "#C9A227") : (light ? "#5B5645" : "#9B9891"),
                fontSize: 13, fontWeight: ativo ? 700 : 600,
                boxShadow: light && ativo ? "0 6px 16px rgba(18,33,59,0.22)" : "none",
              }}>
                {light && ativo && <span style={{ position: "absolute", left: -12, top: 6, bottom: 6, width: 3, background: LIGHT.gold, borderRadius: "0 3px 3px 0" }} />}
                {light ? (
                  <IconeClaro size={16} strokeWidth={2.2} style={{ flexShrink: 0, color: ativo ? LIGHT.gold : "#8A8371" }} />
                ) : (
                  <span style={{ fontSize: 15, width: 18, textAlign: "center" }}>{iconesTabs[t.id]}</span>
                )}
                {t.label}
              </button>
            );
          })}
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: light ? `1px solid ${LIGHT.line}` : "1px solid rgba(255,255,255,0.08)" }}>
            <Button variant="ghost" icon={LogOut} style={light ? { color: LIGHT.ink, border: `1px solid ${LIGHT.line}`, width: "100%", justifyContent: "center" } : { color: "#F5F3EC", border: "1px solid rgba(255,255,255,0.2)", width: "100%", justifyContent: "center" }} onClick={onSairAdmin}>Sair</Button>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, padding: "24px 28px 40px", minWidth: 0, color: light ? LIGHT.text : "#F5F3EC" }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontFamily: "Oswald", fontWeight: light ? 600 : 700, fontSize: light ? 26 : 21, color: light ? LIGHT.ink : "#C9A227", textTransform: light ? "none" : "uppercase" }}>{tabs.find((t) => t.id === tab)?.label}</div>
          <div style={{ fontSize: light ? 13.5 : 12, color: light ? LIGHT.muted : "#9B9891", marginTop: light ? 5 : 2 }}>Cadastro central de alunos, professores, graduação e financeiro do QG</div>
        </div>

      <div key={light ? tab : undefined} className={light ? "qg-fade-in" : undefined}>
      {tab === "dashboard" && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 12, marginBottom: 14 }}>
            <StatCard label="Alunos ativos" value={data.alunos.length} icon={Users} dark chipBg="#EEF1FA" chipColor="#12213B" />
            <StatCard label="Professores" value={data.professores.length} icon={Award} dark chipBg={LIGHT.goldSoft} chipColor="#9C6B0A" />
            <StatCard label="Turmas" value={data.turmas.length} icon={CalendarCheck} dark chipBg="#EEF1FA" chipColor="#12213B" />
            <StatCard label="Check-ins hoje" value={checkinsHoje} icon={QrCode} dark chipBg={LIGHT.goodSoft} chipColor={LIGHT.good} />
            <StatCard label="Pagamentos pendentes" value={pendentes} icon={CreditCard} dark chipBg={LIGHT.warnSoft} chipColor={LIGHT.warn} />
            <StatCard label="Termos pendentes" value={termosPendentes} icon={Shield} dark chipBg={LIGHT.badSoft} chipColor={LIGHT.bad} />
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
                      <div style={{ fontWeight: 600, fontSize: 14, color: light ? LIGHT.text : "#F5F3EC" }}>{a.codigo && <span style={{ color: "#C9A227", fontWeight: 700 }}>{formatarCodigoAluno(a.codigo)} · </span>}{a.nome}{a.apelido && <span style={{ fontWeight: 400, color: light ? LIGHT.muted : "#9B9891" }}> "{a.apelido}"</span>}</div>
                      <BeltBar faixas={data.faixas} faixaId={a.faixaId} grau={a.grau} textColor={light ? LIGHT.text : "#F5F3EC"} />
                      <div style={{ fontSize: 11, color: light ? LIGHT.muted : "#9B9891" }}>
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
                    <span style={{ fontSize: 11.5, color: light ? LIGHT.muted : "#9B9891" }}>{plano?.nome || "sem plano"}</span>
                    <Tag ok={emDia}>{emDia ? "Pagamento em dia" : "Pagamento pendente"}</Tag>
                    <Tag ok={a.termoAceito || a.termoAssinadoManual}>{a.termoAceito || a.termoAssinadoManual ? "Termo OK" : "Termo pendente"}</Tag>
                    {a.ativo === false && <Tag ok={false}>Acesso desativado</Tag>}
                    {senhaGerada?.id === a.id && <span style={{ fontSize: 11.5, fontWeight: 700, color: "#1E7A34" }}>Nova senha: {senhaGerada.senha}</span>}
                    <Button variant="ghost" style={ghostEscuro} onClick={() => resetarSenha(a.id)}>Redefinir senha</Button>
                    <Button variant={a.ativo === false ? "gold" : "ghost"} style={a.ativo === false ? undefined : ghostEscuro} onClick={() => alternarAtivoAluno(a.id)}>{a.ativo === false ? "Reativar acesso" : "Desativar acesso"}</Button>
                    <Button variant="ghost" style={ghostEscuro} onClick={() => setEditandoAluno(a)}>Editar</Button>
                    <Button variant="ghost" style={ghostEscuro} onClick={() => baixarJson(`dados-${normalizarTexto(a.nome).replace(/\s+/g, "-")}.json`, dadosExportaveisAluno(a, data))}>Exportar dados (LGPD)</Button>
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
              <Card dark key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 12, flexWrap: "wrap", gap: 8, opacity: p.ativo === false ? 0.6 : 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Avatar foto={p.foto} nome={p.nome} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14, color: light ? LIGHT.text : "#F5F3EC" }}>{p.nome}</div>
                    <div style={{ fontSize: 12.5, color: light ? LIGHT.muted : "#9B9891" }}>{p.especialidade || "—"} {p.email && `· ${p.email}`} {p.telefone && `· ${p.telefone}`}</div>
                    {p.faixaId && <div style={{ marginTop: 4 }}><BeltBar faixas={data.faixas} faixaId={p.faixaId} grau={p.grau || 0} textColor={light ? LIGHT.text : "#F5F3EC"} /></div>}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  {p.ativo === false && <Tag ok={false}>Acesso desativado</Tag>}
                  {(data.academia.termoPadrao || data.academia.termoPdf) && <Tag ok={p.termoAceito}>{p.termoAceito ? "Termo OK" : "Termo pendente"}</Tag>}
                  {senhaGeradaProf?.id === p.id && <span style={{ fontSize: 11.5, fontWeight: 700, color: "#6FCF7A" }}>Nova senha: {senhaGeradaProf.senha}</span>}
                  <Button variant="ghost" onClick={() => resetarSenhaProf(p.id)} style={ghostEscuro}>Redefinir senha</Button>
                  <Button variant={p.ativo === false ? "gold" : "ghost"} style={p.ativo === false ? undefined : ghostEscuro} onClick={() => alternarAtivoProf(p.id)}>{p.ativo === false ? "Reativar acesso" : "Desativar acesso"}</Button>
                  <Button variant="ghost" onClick={() => setEditandoProf(p)} style={ghostEscuro}>Editar</Button>
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
                  <div style={{ fontWeight: 600, fontSize: 14, color: light ? LIGHT.text : "#F5F3EC" }}>{t.nome}</div>
                  <div style={{ fontSize: 12.5, color: light ? LIGHT.muted : "#9B9891" }}>{formatDias(t.dias)} · {t.horario}{t.horarioFim ? ` às ${t.horarioFim}` : ""}</div>
                  <div style={{ fontSize: 11.5, color: light ? LIGHT.muted : "#9B9891" }}>Unidade: {unidadeDaTurma ? unidadeDaTurma.nome : `${MARCA.sede} (padrão)`}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Button variant="ghost" onClick={() => setEditandoTurma(t)} style={ghostEscuro}>Editar</Button>
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
    </div>
  );
}

function StatCard({ label, value, icon: Icon, dark = false, accent, chipBg, chipColor }) {
  const light = useDesktopLight();
  const escuro = dark && !light;
  return (
    <Card style={{ display: "flex", flexDirection: "column", gap: 8, position: "relative", overflow: "hidden", ...(escuro ? { background: "#1A1D24", border: "1px solid rgba(255,255,255,0.06)" } : {}) }}>
      {accent && <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: accent }} />}
      {light ? (
        <div style={{ width: 30, height: 30, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", background: chipBg || LIGHT.goldSoft }}>
          <Icon size={15} color={chipColor || "#9C6B0A"} />
        </div>
      ) : (
        <Icon size={18} color="#C9A227" />
      )}
      <div style={{ fontFamily: "Oswald", fontSize: 28, fontWeight: light ? 600 : 700, color: escuro ? "#F5F3EC" : "#12213B", fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div style={{ fontSize: 12.5, color: escuro ? "#9B9891" : "#5A5648", fontWeight: light ? 500 : 600 }}>{label}</div>
    </Card>
  );
}

// unidadeFixa: quando o professor cadastra/edita um aluno, a unidade fica travada na dele.
function PersonForm({ tipo, initial, planos, faixas, professores, unidades, unidadeFixa, turmas, onSave, onCancel }) {
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
  const [senha, setSenha] = useState(i.senha || (tipo === "aluno" && !initial ? MARCA.senhaPadraoAluno : ""));
  const [termoAssinadoManual, setTAM] = useState(i.termoAssinadoManual || false);
  const [professorId, setProfessorId] = useState(i.professorId || "");
  const [peso, setPeso] = useState(i.peso ?? "");
  const [apelido, setApelido] = useState(i.apelido || "");
  const [unidadeId, setUnidadeId] = useState(unidadeFixa !== undefined ? (unidadeFixa?.id || "") : (i.unidadeId || ""));
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
        grau: Math.min(Number(grau) || 0, grausMaxSelecionado), senha: senha || MARCA.senhaPadraoAluno, termoAssinadoManual,
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
      {tipo === "aluno" && i.codigo && (
        <div style={{ fontSize: 12.5, fontWeight: 700, color: "#8A8574", marginBottom: 10 }}>{formatarCodigoAluno(i.codigo)} <span style={{ fontWeight: 400 }}>(número de cadastro, gerado automaticamente)</span></div>
      )}
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
                {(planos || []).filter((p) => !p.unidadeId || p.unidadeId === unidadeId).map((p) => <option key={p.id} value={p.id}>{p.nome} — R$ {p.valor}{p.valorHora ? ` (hora-aula R$ ${p.valorHora})` : ""}</option>)}
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
            {unidadeFixa !== undefined ? (
              <Field label="Unidade de treino">
                <div style={{ ...inputStyle, background: "#F0EDE3", color: "#5A5648", display: "flex", alignItems: "center" }}>{unidadeFixa ? unidadeFixa.nome : `${MARCA.sede} (padrão)`}</div>
                <p style={{ fontSize: 11, color: "#8A8574", marginTop: 4 }}>Você só pode cadastrar alunos pra sua própria unidade. Se isso estiver errado, peça pra administração ajustar a unidade no seu cadastro.</p>
              </Field>
            ) : (
              <Field label="Unidade de treino">
                <select style={inputStyle} value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)}>
                  <option value="">{MARCA.sede} (padrão)</option>
                  {(unidades || []).map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
                </select>
              </Field>
            )}
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
                <option value="">{MARCA.sede} (padrão)</option>
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
            <div style={{ ...inputStyle, background: "#F0EDE3", color: "#5A5648", display: "flex", alignItems: "center" }}>{unidadeFixa ? unidadeFixa.nome : `${MARCA.sede} (padrão)`}</div>
            <p style={{ fontSize: 11, color: "#8A8574", marginTop: 4 }}>Você só pode cadastrar turmas pra sua própria unidade. Se isso estiver errado, peça pra administração ajustar a unidade no seu cadastro.</p>
          </Field>
        ) : (
          <Field label={`Unidade (deixe em branco para ${MARCA.sede} padrão)`}>
            <select style={inputStyle} value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)}>
              <option value="">{MARCA.sede} (padrão)</option>
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
  const light = useDesktopLight();
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
      <p style={{ fontSize: 12.5, color: light ? LIGHT.muted : "#9B9891", marginTop: 0 }}>Baseado no sistema de graduação da IBJJF. Edite nomes, cores, graus, tempo mínimo e quantas aulas valem um novo grau. Use as setas para reordenar a sequência.</p>
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
                <BeltBar faixas={data.faixas} faixaId={f.id} grau={0} textColor={light ? LIGHT.text : "#F5F3EC"} />
                <span style={{ fontSize: 11.5, color: light ? LIGHT.muted : "#9B9891" }}>{f.categoria}</span>
              </div>
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <button onClick={() => moverFaixa(idx, -1)} style={light ? { ...iconBtnStyle, background: LIGHT.paper, border: `1px solid ${LIGHT.line}`, color: LIGHT.ink } : { ...iconBtnStyle, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)", color: "#F5F3EC" }} disabled={idx === 0}>↑</button>
                <button onClick={() => moverFaixa(idx, 1)} style={light ? { ...iconBtnStyle, background: LIGHT.paper, border: `1px solid ${LIGHT.line}`, color: LIGHT.ink } : { ...iconBtnStyle, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.14)", color: "#F5F3EC" }} disabled={idx === data.faixas.length - 1}>↓</button>
                <ConfirmDelete size={14} onConfirm={() => removerFaixa(f.id)} />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px,1fr))", gap: 8, marginTop: 10 }}>
              <Field label="Nome" labelColor={light ? LIGHT.muted : "#9B9891"}><input style={inputStyle} value={f.nome} onChange={(e) => atualizarFaixa(f.id, "nome", e.target.value)} /></Field>
              <Field label="Graus máx." labelColor={light ? LIGHT.muted : "#9B9891"}><input type="number" min="0" max="10" style={inputStyle} value={f.grausMax} onChange={(e) => atualizarFaixa(f.id, "grausMax", Number(e.target.value))} /></Field>
              <Field label="Tempo mínimo (anos)" labelColor={light ? LIGHT.muted : "#9B9891"}><input type="number" min="0" step="0.5" style={inputStyle} value={f.tempoMinimoAnos ?? ""} onChange={(e) => atualizarFaixa(f.id, "tempoMinimoAnos", e.target.value === "" ? null : Number(e.target.value))} /></Field>
              <Field label="Aulas por grau" labelColor={light ? LIGHT.muted : "#9B9891"}><input type="number" min="0" style={inputStyle} value={f.aulasPorGrau ?? ""} onChange={(e) => atualizarFaixa(f.id, "aulasPorGrau", e.target.value === "" ? null : Number(e.target.value))} /></Field>
              <Field label="Cor da faixa" labelColor={light ? LIGHT.muted : "#9B9891"}><input type="color" style={{ ...inputStyle, padding: 2, height: 36 }} value={f.cor} onChange={(e) => atualizarFaixa(f.id, "cor", e.target.value)} /></Field>
              <Field label="Cor da ponta (riscos)" labelColor={light ? LIGHT.muted : "#9B9891"}><input type="color" style={{ ...inputStyle, padding: 2, height: 36 }} value={f.corPonta || "#17181B"} onChange={(e) => atualizarFaixa(f.id, "corPonta", e.target.value)} /></Field>
            </div>
            {f.observacoes && <div style={{ fontSize: 11.5, color: light ? LIGHT.muted : "#9B9891", marginTop: 6 }}>{f.observacoes}</div>}
          </Card>
        ))}
      </div>
    </div>
  );
}

function PlanoForm({ unidades, unidadeFixa, onSave, onCancel }) {
  const [nome, setNome] = useState("");
  const [valor, setValor] = useState("");
  const [valorHora, setValorHora] = useState("");
  const [periodicidade, setPeriodicidade] = useState("mensal");
  const [unidadeId, setUnidadeId] = useState(unidadeFixa ? (unidadeFixa.id || "") : "");
  const submit = () => { if (!nome.trim()) return; onSave({ nome, valor: Number(valor) || 0, valorHora: Number(valorHora) || 0, periodicidade, unidadeId }); };
  return (
    <Card style={{ marginBottom: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr 1fr 1.2fr", gap: 10 }}>
        <Field label="Nome do plano"><input style={inputStyle} value={nome} onChange={(e) => setNome(e.target.value)} /></Field>
        <Field label="Valor (R$)"><input type="number" min="0" style={inputStyle} value={valor} onChange={(e) => setValor(e.target.value)} /></Field>
        <Field label="Valor da hora-aula (R$)"><input type="number" min="0" step="0.01" style={inputStyle} value={valorHora} onChange={(e) => setValorHora(e.target.value)} placeholder="ex: personal" /></Field>
        <Field label="Periodicidade">
          <select style={inputStyle} value={periodicidade} onChange={(e) => setPeriodicidade(e.target.value)}>
            <option value="mensal">Mensal</option><option value="trimestral">Trimestral</option><option value="semestral">Semestral</option><option value="anual">Anual</option>
          </select>
        </Field>
        {unidadeFixa !== undefined ? (
          <Field label="Unidade">
            <div style={{ ...inputStyle, background: "#F0EDE3", color: "#5A5648", display: "flex", alignItems: "center" }}>{unidadeFixa ? unidadeFixa.nome : `${MARCA.sede} (padrão)`}</div>
          </Field>
        ) : (
          <Field label="Unidade">
            <select style={inputStyle} value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)}>
              <option value="">Todas as unidades</option>
              {(unidades || []).map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </select>
          </Field>
        )}
      </div>
      {unidadeFixa !== undefined && <p style={{ fontSize: 11, color: "#8A8574", marginTop: 6 }}>Você só pode cadastrar planos pra sua própria unidade. Se isso estiver errado, peça pra administração ajustar a unidade no seu cadastro.</p>}
      <p style={{ fontSize: 11, color: "#8A8574", marginTop: 6 }}>Preencha "Valor da hora-aula" em planos de personal — esse valor fica disponível na hora de dar baixa no pagamento, pra calcular o total a partir das horas dadas.</p>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <ConfirmButton onConfirm={submit}>Salvar</ConfirmButton>
        <Button variant="ghost" icon={X} onClick={onCancel}>Cancelar</Button>
      </div>
    </Card>
  );
}

function PlanosAdmin({ data, save }) {
  const light = useDesktopLight();
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
      <p style={{ fontSize: 12.5, color: light ? LIGHT.muted : "#9B9891", marginTop: 0 }}>O status "em dia / pendente" de cada aluno é calculado automaticamente comparando a data do último pagamento e o dia de vencimento com a periodicidade do plano. Vincule um plano a uma unidade quando o valor for diferente por local — planos sem unidade ficam disponíveis pra todas. Planos cadastrados aqui ficam visíveis pra todos os professores; cada professor também pode cadastrar planos só dele, na área de Financeiro.</p>
      {aviso && <div style={{ fontSize: 12.5, color: "#FF8A80", fontWeight: 600, marginBottom: 10 }}>{aviso}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <Button icon={Plus} onClick={() => setNovo(true)}>Novo plano</Button>
      </div>
      {novo && <PlanoForm unidades={data.unidades} onCancel={() => setNovo(false)} onSave={adicionar} />}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {data.planos.map((p) => (
          <Card dark key={p.id} style={{ padding: 12 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: "#C9A227", textTransform: "uppercase" }}>
              {p.professorId ? `Prof. ${data.professores.find((pr) => pr.id === p.professorId)?.nome || "?"}` : "Todos os professores"}
            </span>
            <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr 1fr 1.4fr auto", gap: 10, alignItems: "end", marginTop: 6 }}>
              <Field label="Nome" labelColor={light ? LIGHT.muted : "#9B9891"}><input style={inputStyle} value={p.nome} onChange={(e) => atualizar(p.id, "nome", e.target.value)} /></Field>
              <Field label="Valor (R$)" labelColor={light ? LIGHT.muted : "#9B9891"}><input type="number" style={inputStyle} value={p.valor} onChange={(e) => atualizar(p.id, "valor", Number(e.target.value))} /></Field>
              <Field label="Valor hora-aula (R$)" labelColor={light ? LIGHT.muted : "#9B9891"}><input type="number" step="0.01" style={inputStyle} value={p.valorHora || ""} onChange={(e) => atualizar(p.id, "valorHora", Number(e.target.value))} /></Field>
              <Field label="Periodicidade" labelColor={light ? LIGHT.muted : "#9B9891"}>
                <select style={inputStyle} value={p.periodicidade} onChange={(e) => atualizar(p.id, "periodicidade", e.target.value)}>
                  <option value="mensal">Mensal</option><option value="trimestral">Trimestral</option><option value="semestral">Semestral</option><option value="anual">Anual</option>
                </select>
              </Field>
              <Field label="Unidade" labelColor={light ? LIGHT.muted : "#9B9891"}>
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

function PlanosProfessor({ data, save, prof, dark = true }) {
  const light = useDesktopLight();
  const [novo, setNovo] = useState(false);
  const [aviso, setAviso] = useState("");
  const meusPlanos = data.planos.filter((p) => p.professorId === prof.id);
  const unidadeDoProfessor = (data.unidades || []).find((u) => u.id === prof.unidadeId) || null;
  const atualizar = async (id, campo, valor) => { const planos = data.planos.map((p) => (p.id === id ? { ...p, [campo]: valor } : p)); await save({ ...data, planos }); };
  const remover = async (id) => {
    const emUso = data.alunos.some((a) => a.planoId === id);
    if (emUso) { setAviso("Não é possível remover: há alunos usando este plano."); return; }
    setAviso("");
    await save({ ...data, planos: data.planos.filter((p) => p.id !== id) });
  };
  const adicionar = async (form) => {
    const p = { id: uid(), ...form, unidadeId: prof.unidadeId || null, professorId: prof.id };
    await save({ ...data, planos: [...data.planos, p] });
    setNovo(false);
  };
  return (
    <div>
      <div style={light ? blockTitleStyle : { ...blockTitleStyle, color: "#F5F3EC" }}>💳 Meus planos</div>
      <p style={{ fontSize: 12.5, color: light ? LIGHT.muted : "#9B9891", marginTop: 0 }}>Planos que só você usa pra vincular aos seus alunos — outros professores não veem. Pra planos que valem pra academia toda, peça pra administração cadastrar.</p>
      {aviso && <div style={{ fontSize: 12.5, color: "#FF8A80", fontWeight: 600, marginBottom: 10 }}>{aviso}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <Button icon={Plus} onClick={() => setNovo(true)}>Novo plano</Button>
      </div>
      {novo && <PlanoForm unidadeFixa={unidadeDoProfessor} onCancel={() => setNovo(false)} onSave={adicionar} />}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {meusPlanos.map((p) => (
          <Card dark={dark} key={p.id} style={{ padding: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr 1fr 1.4fr auto", gap: 10, alignItems: "end" }}>
              <Field label="Nome" labelColor={light ? LIGHT.muted : "#9B9891"}><input style={inputStyle} value={p.nome} onChange={(e) => atualizar(p.id, "nome", e.target.value)} /></Field>
              <Field label="Valor (R$)" labelColor={light ? LIGHT.muted : "#9B9891"}><input type="number" style={inputStyle} value={p.valor} onChange={(e) => atualizar(p.id, "valor", Number(e.target.value))} /></Field>
              <Field label="Valor hora-aula (R$)" labelColor={light ? LIGHT.muted : "#9B9891"}><input type="number" step="0.01" style={inputStyle} value={p.valorHora || ""} onChange={(e) => atualizar(p.id, "valorHora", Number(e.target.value))} /></Field>
              <Field label="Periodicidade" labelColor={light ? LIGHT.muted : "#9B9891"}>
                <select style={inputStyle} value={p.periodicidade} onChange={(e) => atualizar(p.id, "periodicidade", e.target.value)}>
                  <option value="mensal">Mensal</option><option value="trimestral">Trimestral</option><option value="semestral">Semestral</option><option value="anual">Anual</option>
                </select>
              </Field>
              <Field label="Unidade" labelColor={light ? LIGHT.muted : "#9B9891"}>
                <div style={{ ...inputStyle, background: "#F0EDE3", color: "#5A5648", display: "flex", alignItems: "center" }}>{unidadeDoProfessor ? unidadeDoProfessor.nome : `${MARCA.sede} (padrão)`}</div>
              </Field>
              <ConfirmDelete onConfirm={() => remover(p.id)} />
            </div>
          </Card>
        ))}
        {meusPlanos.length === 0 && <Empty dark={dark}>Você ainda não cadastrou nenhum plano.</Empty>}
      </div>
    </div>
  );
}

function PizzaSVG({ dados, size = 190 }) {
  const total = dados.reduce((s, d) => s + d.value, 0);
  if (!total) return null;
  const cx = size / 2, cy = size / 2, r = size / 2 - 4;
  let anguloAtual = -Math.PI / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {dados.map((d, i) => {
        const fracao = d.value / total;
        const anguloFim = anguloAtual + fracao * Math.PI * 2;
        const x1 = cx + r * Math.cos(anguloAtual), y1 = cy + r * Math.sin(anguloAtual);
        const x2 = cx + r * Math.cos(anguloFim), y2 = cy + r * Math.sin(anguloFim);
        const largeArc = fracao > 0.5 ? 1 : 0;
        const path = fracao >= 0.999
          ? `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z`
          : `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`;
        anguloAtual = anguloFim;
        return <path key={i} d={path} fill={d.color} stroke="#fff" strokeWidth={2} />;
      })}
    </svg>
  );
}

function AlunosPorFaixaChart({ alunos, faixas, titulo, dark = false }) {
  const light = useDesktopLight();
  dark = dark && !light;
  const porFaixa = faixas.map((f) => ({ name: f.nome, value: alunos.filter((a) => a.faixaId === f.id).length, color: f.cor, borda: f.borda })).filter((d) => d.value > 0);
  if (porFaixa.length === 0) return null;

  if (light) {
    const total = porFaixa.reduce((s, d) => s + d.value, 0);
    return (
      <Card style={{ marginBottom: 14 }}>
        <div style={blockTitleStyle}>{titulo || "Alunos por faixa"}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 26, flexWrap: "wrap" }}>
          <div style={{ borderRadius: "50%", flexShrink: 0, boxShadow: `inset 0 0 0 1px ${LIGHT.line}` }}>
            <PizzaSVG dados={porFaixa} size={150} />
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 12.5, color: LIGHT.muted, marginBottom: 10 }}>Total de alunos: <b style={{ color: LIGHT.ink }}>{total}</b></div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {porFaixa.map((d, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 2.5, flexShrink: 0, background: d.color, boxShadow: d.borda ? `inset 0 0 0 1px ${d.borda}` : undefined }} />
                  <span style={{ color: "#3A3324", fontWeight: 500 }}>{d.name}:</span>
                  <b style={{ color: LIGHT.ink, fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{d.value}</b>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>
    );
  }

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
  dark = dark && !useDesktopLight();
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
  const light = useDesktopLight();
  dark = dark && !light;
  const alunosBase = alunosFiltro || data.alunos;
  const [mes, setMes] = useState(() => new Date().toISOString().slice(0, 7));
  const confirmadosMes = alunosBase.flatMap((a) => (a.pagamentos || []).filter((p) => p.data.slice(0, 7) === mes));
  const totalConfirmado = confirmadosMes.reduce((s, p) => s + (p.valor || 0), 0);
  // Só aquele mês: quem não tem pagamento cobrindo o mês selecionado (ver pendentesNoMes).
  const pendentesAtuais = pendentesNoMes(alunosBase, data.planos, mes);
  const totalPendente = pendentesAtuais.reduce((s, a) => s + (data.planos.find((p) => p.id === a.planoId)?.valor || 0), 0);
  const corConfirmado = light ? LIGHT.good : "#4ADE80";
  const corPendente = light ? LIGHT.bad : "#FF6B6B";
  const dadosGrafico = [
    { name: "Confirmados no mês", value: confirmadosMes.length, color: corConfirmado },
    { name: "Pendentes no mês", value: pendentesAtuais.length, color: corPendente },
  ].filter((d) => d.value > 0);
  const totalGrafico = dadosGrafico.reduce((s, d) => s + d.value, 0);

  return (
    <Card style={{ marginBottom: 14, ...(dark ? { background: "#1A1D24", border: "1px solid rgba(255,255,255,0.06)" } : {}) }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
        <div style={dark ? { ...blockTitleStyle, color: "#F5F3EC" } : blockTitleStyle}>Pagamentos confirmados x pendentes</div>
        <input type="month" style={{ ...(dark ? inputStyleDark : inputStyle), maxWidth: 170 }} value={mes} onChange={(e) => setMes(e.target.value)} />
      </div>
      {dadosGrafico.length === 0 ? (
        <Empty dark={dark}>Sem pagamentos confirmados nem pendências neste mês.</Empty>
      ) : light ? (
        (() => {
          let acumulado = 0;
          const paradas = dadosGrafico.map((d) => {
            const inicio = (acumulado / totalGrafico) * 360;
            acumulado += d.value;
            const fim = (acumulado / totalGrafico) * 360;
            return `${d.color} ${inicio}deg ${fim}deg`;
          });
          return (
            <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
              <div style={{ width: 118, height: 118, borderRadius: "50%", flexShrink: 0, position: "relative", boxShadow: `inset 0 0 0 1px ${LIGHT.line}`, background: `conic-gradient(${paradas.join(", ")})` }}>
                <div style={{ position: "absolute", inset: 20, borderRadius: "50%", background: LIGHT.surface, boxShadow: "0 1px 2px rgba(36,31,20,.06)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontFamily: "Oswald", fontSize: 20, color: LIGHT.ink, lineHeight: 1 }}>{totalGrafico}</span>
                  <span style={{ fontSize: 9.5, color: LIGHT.muted, marginTop: 2 }}>pagamentos</span>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 12.5 }}>
                {dadosGrafico.map((d, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 9, height: 9, borderRadius: "50%", flexShrink: 0, background: d.color }} />
                    <span style={{ color: "#3A3324" }}>{d.name}</span>
                    <b style={{ marginLeft: 14, fontVariantNumeric: "tabular-nums" }}>{d.value}</b>
                  </div>
                ))}
              </div>
            </div>
          );
        })()
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie data={dadosGrafico} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={(e) => <text x={e.x} y={e.y} textAnchor={e.textAnchor} fill={dark ? "#F5F3EC" : "#1B2027"} fontSize={12}>{`${e.name}: ${e.value}`}</text>}>
              {dadosGrafico.map((entry, i) => <Cell key={i} fill={entry.color} stroke={dark ? "#1A1D24" : "#fff"} strokeWidth={2} />)}
            </Pie>
            <Tooltip contentStyle={dark ? { background: "#1A1D24", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 8, color: "#F5F3EC" } : undefined} labelStyle={dark ? { color: "#F5F3EC" } : undefined} itemStyle={dark ? { color: "#F5F3EC" } : undefined} />
            <Legend wrapperStyle={dark ? { color: "#F5F3EC" } : undefined} />
          </PieChart>
        </ResponsiveContainer>
      )}
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginTop: 10, paddingTop: 12, borderTop: dark ? "1px solid rgba(255,255,255,0.1)" : "1px solid #E7E2D6" }}>
        <div>
          <div style={{ fontSize: 11.5, color: dark ? "#9B9891" : "#8A8574", fontWeight: 600, textTransform: "uppercase" }}>Total confirmado no mês</div>
          <div style={{ fontFamily: "Oswald", fontSize: 22, fontWeight: 700, color: corConfirmado }}>R$ {totalConfirmado.toFixed(2)}</div>
        </div>
        <div>
          <div style={{ fontSize: 11.5, color: dark ? "#9B9891" : "#8A8574", fontWeight: 600, textTransform: "uppercase" }}>Total pendente no mês</div>
          <div style={{ fontFamily: "Oswald", fontSize: 22, fontWeight: 700, color: corPendente }}>R$ {totalPendente.toFixed(2)}</div>
        </div>
      </div>
    </Card>
  );
}

function AlunosPorMesChart({ data, dark = false }) {
  dark = dark && !useDesktopLight();
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
  dark = dark && !useDesktopLight();
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

/* Perguntas da anamnese que o aluno responde no app. `detalhe` = campo de texto que aparece
   (e passa a ser obrigatório) quando a resposta é uma das `detalheQuando`. `alerta` = respostas
   que o professor precisa ver em destaque. */
const ANAMNESE_PERGUNTAS = [
  { id: "cardiaco", texto: "Tem problema cardíaco?", opcoes: [["sim", "Sim"], ["nao", "Não"]], alerta: ["sim"] },
  { id: "pressao", texto: "Possui pressão:", opcoes: [["alta", "Alta (hipertensão)"], ["baixa", "Baixa"], ["normal", "Normal"]], alerta: ["alta", "baixa"] },
  { id: "diabetes", texto: "Tem diabetes?", opcoes: [["sim", "Sim"], ["nao", "Não"]], alerta: ["sim"], detalhe: { id: "diabetesTipo", texto: "Se sim, qual tipo?" }, detalheQuando: ["sim"] },
  { id: "respiratorio", texto: "Tem problema respiratório (asma)?", opcoes: [["sim", "Sim"], ["nao", "Não"]], alerta: ["sim"] },
  { id: "limitacao", texto: "Possui alguma limitação física, lesão ou dor?", opcoes: [["sim", "Sim"], ["nao", "Não"]], alerta: ["sim"], detalhe: { id: "limitacaoQual", texto: "Se sim, qual?" }, detalheQuando: ["sim"] },
  { id: "medicamento", texto: "Faz uso de algum medicamento?", opcoes: [["sim", "Sim"], ["nao", "Não"]], alerta: ["sim"], detalhe: { id: "medicamentoDetalhe", texto: "Se sim, por qual motivo e há quanto tempo?" }, detalheQuando: ["sim"] },
  { id: "arteMarcial", texto: "Pratica ou já praticou alguma arte marcial?", opcoes: [["sim", "Sim"], ["nao", "Não"], ["parado", "Já pratiquei mas estou parado"]], alerta: [] },
];
const ANAMNESE_DECLARACAO = "Declaro que as informações acima são verdadeiras e estou apto para a prática de atividade física, ciente de que a prática do Jiu-Jitsu envolve esforço físico e riscos inerentes ao esporte.";

const escaparHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* Perguntas com resposta que pede atenção do professor (ex: "Tem problema cardíaco? Sim"). */
function alertasAnamnese(anamnese) {
  const r = anamnese?.respostas || {};
  return ANAMNESE_PERGUNTAS.filter((q) => q.alerta.includes(r[q.id])).map((q) => {
    const opcao = q.opcoes.find(([v]) => v === r[q.id])?.[1];
    const detalhe = q.detalhe && r[q.detalhe.id] ? ` — ${r[q.detalhe.id]}` : "";
    return `${q.texto.replace(/[?:]$/, "")}: ${opcao}${detalhe}`;
  });
}

function gerarDocumentoAnamnese(data, aluno, onErro) {
  if (!aluno.anamneseEm || !aluno.anamnese) { onErro && onErro("Este aluno ainda não preencheu a anamnese."); return; }
  const r = aluno.anamnese.respostas || {};

  const perguntasHtml = ANAMNESE_PERGUNTAS.map((q) => {
    const opcoesHtml = q.opcoes.map(([v, rotulo]) => {
      const marcado = r[q.id] === v;
      const destaque = marcado && q.alerta.includes(v);
      return `<span style="display:inline-block;margin:4px 16px 0 0;font-size:12.5px;${marcado ? `font-weight:700;color:${destaque ? "#B3401E" : "#1B2027"};` : "color:#8A8574;"}">(${marcado ? "X" : "&nbsp;&nbsp;"}) ${rotulo}</span>`;
    }).join("");
    const detalheHtml = q.detalhe && q.detalheQuando.includes(r[q.id])
      ? `<div style="font-size:12.5px;margin-top:6px;"><span style="color:#8A8574;">${q.detalhe.texto}</span> <b>${escaparHtml(r[q.detalhe.id]) || "—"}</b></div>`
      : "";
    return `<div style="border-bottom:1px solid #EFEBDF;padding:10px 0;"><div style="font-size:13px;font-weight:600;">${q.texto}</div><div>${opcoesHtml}</div>${detalheHtml}</div>`;
  }).join("");

  const alertas = alertasAnamnese(aluno.anamnese);
  const alertasHtml = alertas.length
    ? `<div style="border:1px solid #F0C9BC;background:#FCEFEA;border-radius:8px;padding:10px 14px;margin:14px 0;font-size:12.5px;color:#B3401E;"><b>Atenção:</b><ul style="margin:6px 0 0 18px;padding:0;">${alertas.map((t) => `<li>${escaparHtml(t)}</li>`).join("")}</ul></div>`
    : "";

  const assinaturaHtml = aluno.anamnese.assinatura
    ? `<div style="margin-top:20px;"><img src="${aluno.anamnese.assinatura}" style="max-width:280px;display:block;" /><div style="border-top:1px solid #1B2027;width:280px;margin-top:2px;"></div><div style="font-size:11px;color:#8A8574;margin-top:4px;">Assinatura de ${escaparHtml(aluno.nome)}</div></div>`
    : "";

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Anamnese - ${escaparHtml(aluno.nome)}</title>
    <style>${estiloRelatorioModerno()}</style></head>
    <body>
      ${marcaDaguaRelatorio(data)}
      <button class="voltar-btn" onclick="window.close()">← Voltar para o app</button>
      ${cabecalhoRelatorioModerno(data, "Anamnese", aluno.nome)}
      <div class="stats">
        <div class="stat"><div class="label">Aluno</div><div class="value" style="font-size:15px;">${escaparHtml(aluno.nome)}</div></div>
        <div class="stat"><div class="label">Preenchida em</div><div class="value" style="font-size:15px;">${new Date(aluno.anamneseEm).toLocaleString("pt-BR")}</div></div>
      </div>
      ${alertasHtml}
      <div style="margin:10px 0;">${perguntasHtml}</div>
      <p style="font-size:12.5px;line-height:1.6;margin-top:16px;">${ANAMNESE_DECLARACAO}</p>
      <p style="font-size:12.5px;font-weight:700;">(X) Li e concordo com os termos apresentados.</p>
      ${assinaturaHtml}
      ${rodapeRelatorioModerno()}
    </body></html>`;

  abrirJanelaRelatorio(html, onErro);
}

function gerarRelatorioMensal(data, mes, onErro, alunosFiltro, tituloExtra) {
  const alunosBase = alunosFiltro || data.alunos;
  const confirmadosMes = alunosBase.flatMap((a) => (a.pagamentos || []).filter((p) => p.data.slice(0, 7) === mes).map((p) => ({ ...p, alunoNome: a.nome })));
  const totalConfirmado = confirmadosMes.reduce((s, p) => s + (p.valor || 0), 0);
  const pendentesAtuais = pendentesNoMes(alunosBase, data.planos, mes);
  const totalPendente = pendentesAtuais.reduce((s, a) => s + (data.planos.find((p) => p.id === a.planoId)?.valor || 0), 0);
  const [ano, mesNum] = mes.split("-");
  const nomeMes = MESES[Number(mesNum) - 1];

  const linhasConfirmados = confirmadosMes
    .map((p) => `<tr><td>${p.alunoNome}</td><td>${new Date(p.data + "T00:00:00").toLocaleDateString("pt-BR")}</td><td>R$ ${p.valor.toFixed(2)}</td></tr>`)
    .join("") || `<tr><td colspan="3">Nenhum pagamento confirmado neste mês.</td></tr>`;

  const linhasPendentes = pendentesAtuais
    .map((a) => { const plano = data.planos.find((p) => p.id === a.planoId); return `<tr><td>${a.nome}</td><td>${plano?.nome || "—"}</td><td>R$ ${(plano?.valor || 0).toFixed(2)}</td></tr>`; })
    .join("") || `<tr><td colspan="3">Nenhuma pendência neste mês.</td></tr>`;

  const dadosPagamentos = [
    { nome: "Confirmados no mês", valor: confirmadosMes.length, cor: "#4ADE80" },
    { nome: "Pendentes no mês", valor: pendentesAtuais.length, cor: "#FF6B6B" },
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
          <div class="stat"><div class="label">Receita pendente no mês</div><div class="value">R$ ${totalPendente.toFixed(2)}</div></div>
        </div>
        ${graficoPagamentosHtml}
        <div class="section-title">Pagamentos confirmados no mês</div>
        <table><thead><tr><th>Aluno</th><th>Data</th><th>Valor</th></tr></thead><tbody>${linhasConfirmados}</tbody></table>
        <div class="section-title">Pagamentos pendentes no mês</div>
        <table><thead><tr><th>Aluno</th><th>Plano</th><th>Valor</th></tr></thead><tbody>${linhasPendentes}</tbody></table>
        ${rodapeRelatorioModerno()}
      </div>
    </body></html>`;

  abrirJanelaRelatorio(html, onErro);
}

function gerarRelatorioAnual(data, ano, onErro, alunosFiltro, tituloExtra) {
  const alunosBase = alunosFiltro || data.alunos;
  const anoStr = String(ano);
  const pagamentosAno = alunosBase.flatMap((a) => (a.pagamentos || []).filter((p) => p.data.slice(0, 4) === anoStr).map((p) => ({ ...p, alunoId: a.id, alunoNome: a.nome })));
  const totalAno = pagamentosAno.reduce((s, p) => s + (p.valor || 0), 0);

  const porMes = MESES.map((nome, i) => {
    const chave = `${anoStr}-${String(i + 1).padStart(2, "0")}`;
    const doMes = pagamentosAno.filter((p) => p.data.slice(0, 7) === chave);
    return { nome, qtd: doMes.length, total: doMes.reduce((s, p) => s + (p.valor || 0), 0) };
  });
  const mesesComReceita = porMes.filter((m) => m.total > 0).length;
  const mediaMensal = mesesComReceita ? totalAno / mesesComReceita : 0;
  const maiorMes = Math.max(0, ...porMes.map((m) => m.total));

  const barrasHtml = porMes.map((m) => {
    const largura = maiorMes ? Math.round((m.total / maiorMes) * 100) : 0;
    return `<div style="display:flex;align-items:center;gap:8px;margin:4px 0;font-size:12px;">
      <div style="width:78px;">${m.nome}</div>
      <div style="flex:1;background:rgba(0,0,0,0.06);border-radius:4px;height:14px;"><div style="width:${largura}%;background:#C9A227;height:14px;border-radius:4px;"></div></div>
      <div style="width:90px;text-align:right;">R$ ${m.total.toFixed(2)}</div>
    </div>`;
  }).join("");

  const linhasMeses = porMes
    .map((m) => `<tr><td>${m.nome}</td><td>${m.qtd}</td><td>R$ ${m.total.toFixed(2)}</td></tr>`)
    .join("") + `<tr><td><strong>Total</strong></td><td><strong>${pagamentosAno.length}</strong></td><td><strong>R$ ${totalAno.toFixed(2)}</strong></td></tr>`;

  const porAluno = {};
  pagamentosAno.forEach((p) => {
    if (!porAluno[p.alunoId]) porAluno[p.alunoId] = { nome: p.alunoNome, qtd: 0, total: 0, meses: new Set() };
    porAluno[p.alunoId].qtd += 1;
    porAluno[p.alunoId].total += p.valor || 0;
    porAluno[p.alunoId].meses.add(Number(p.data.slice(5, 7)));
  });
  const linhasAlunos = Object.values(porAluno)
    .sort((x, y) => y.total - x.total)
    .map((a) => `<tr><td>${a.nome}</td><td>${[...a.meses].sort((x, y) => x - y).map((m) => MESES[m - 1].slice(0, 3)).join(", ")}</td><td>${a.qtd}</td><td>R$ ${a.total.toFixed(2)}</td></tr>`)
    .join("") || `<tr><td colspan="4">Nenhum pagamento registrado neste ano.</td></tr>`;

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Relatório anual ${anoStr}</title>
    <style>${estiloRelatorioModerno()}</style></head>
    <body>
      ${marcaDaguaRelatorio(data)}
      <button class="voltar-btn" onclick="window.close()">← Voltar para o app</button>
      ${cabecalhoRelatorioModerno(data, "Relatório financeiro anual" + (tituloExtra ? " — " + tituloExtra : ""), `Ano de ${anoStr}`)}
      <div class="conteudo">
        <div class="stats">
          <div class="stat"><div class="label">Receita no ano</div><div class="value">R$ ${totalAno.toFixed(2)}</div></div>
          <div class="stat"><div class="label">Pagamentos confirmados</div><div class="value">${pagamentosAno.length}</div></div>
          <div class="stat"><div class="label">Alunos que pagaram</div><div class="value">${Object.keys(porAluno).length}</div></div>
          <div class="stat"><div class="label">Média por mês (com receita)</div><div class="value">R$ ${mediaMensal.toFixed(2)}</div></div>
        </div>
        <div class="section-title">Receita mês a mês</div>
        ${barrasHtml}
        <div class="section-title">Resumo por mês</div>
        <table><thead><tr><th>Mês</th><th>Pagamentos</th><th>Receita</th></tr></thead><tbody>${linhasMeses}</tbody></table>
        <div class="section-title">Pagamentos por aluno</div>
        <table><thead><tr><th>Aluno</th><th>Meses pagos</th><th>Pagamentos</th><th>Total</th></tr></thead><tbody>${linhasAlunos}</tbody></table>
        ${rodapeRelatorioModerno()}
      </div>
    </body></html>`;

  abrirJanelaRelatorio(html, onErro);
}

function RelatorioMensal({ data }) {
  const light = useDesktopLight();
  const [mes, setMes] = useState(() => new Date().toISOString().slice(0, 7));
  const [erro, setErro] = useState("");
  return (
    <Card dark style={{ marginBottom: 14 }}>
      <div style={light ? blockTitleStyle : { ...blockTitleStyle, color: "#F5F3EC" }}>Relatório mensal</div>
      <p style={{ fontSize: 12.5, color: light ? LIGHT.muted : "#9B9891", marginTop: 0 }}>Gera um relatório com total de alunos, pagamentos confirmados e pendentes do mês escolhido — abre em uma nova aba pronta para salvar como PDF (ou imprimir).</p>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ flex: "0 1 180px", minWidth: 140 }}><Field label="Mês do relatório" labelColor={light ? LIGHT.muted : "#9B9891"}><input type="month" style={light ? { ...inputStyle, maxWidth: 170 } : { ...inputStyle, maxWidth: 170, background: "#0F1116", border: "1px solid rgba(255,255,255,0.14)", color: "#F5F3EC", colorScheme: "dark" }} value={mes} onChange={(e) => setMes(e.target.value)} /></Field></div>
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
        <td>${a.codigo ? formatarCodigoAluno(a.codigo) : "—"}</td>
        <td>${a.nome}${a.apelido ? ` "${a.apelido}"` : ""}</td>
        <td>${faixa ? `${faixa.nome}${faixa.grausMax > 0 ? ` (${a.grau}º)` : ""}` : "—"}</td>
        <td>${categoria}</td>
        <td>${a.telefone || "—"}</td>
        <td>${professor?.nome || "—"}</td>
        <td>${plano?.nome || "—"}</td>
        <td>${emDia ? '<span class="pill pill-ok">Em dia</span>' : '<span class="pill pill-pendente">Pendente</span>'}</td>
      </tr>`;
    })
    .join("") || `<tr><td colspan="8">Nenhum aluno cadastrado.</td></tr>`;

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
      <table><thead><tr><th>Nº</th><th>Aluno</th><th>Faixa</th><th>Categoria</th><th>Telefone</th><th>Professor</th><th>Plano</th><th>Pagamento</th></tr></thead><tbody>${linhas}</tbody></table>
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
    const nomeUnidade = unidade ? unidade.nome : `${MARCA.sede} (padrão)`;
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

function legendaPizzaMoedaHtml(itens) {
  return `<div class="legenda-pizza">${itens
    .map((it) => `<div class="legenda-item"><span class="legenda-cor" style="background:${it.cor};border:1px solid rgba(0,0,0,0.15);"></span>${it.nome}: <span class="legenda-valor">R$ ${it.valor.toFixed(2)}</span></div>`)
    .join("")}</div>`;
}

function gerarRelatorioVendas(data, onErro, vendasFiltro, tituloExtra) {
  const vendasBase = vendasFiltro || data.vendas || [];
  const totalVendido = vendasBase.reduce((s, v) => s + (v.valor || 0), 0);

  const porProduto = {};
  vendasBase.forEach((v) => { porProduto[v.produtoNome || "—"] = (porProduto[v.produtoNome || "—"] || 0) + (v.valor || 0); });
  const pizzaPorProduto = Object.entries(porProduto)
    .sort((a, b) => b[1] - a[1])
    .map(([nome, valor], i) => ({ nome, valor, cor: CORES_UNIDADES[i % CORES_UNIDADES.length] }));

  const linhas = [...vendasBase]
    .sort((a, b) => (b.data || "").localeCompare(a.data || ""))
    .map((v) => {
      const aluno = data.alunos.find((a) => a.id === v.alunoId);
      const professor = data.professores.find((p) => p.id === v.professorId);
      return `<tr>
        <td>${v.produtoNome}</td>
        <td>${aluno?.nome || "—"}</td>
        <td>${professor?.nome || "—"}</td>
        <td>${v.data ? new Date(v.data + "T00:00:00").toLocaleDateString("pt-BR") : "—"}</td>
        <td>R$ ${(v.valor || 0).toFixed(2)}</td>
      </tr>`;
    })
    .join("") || `<tr><td colspan="5">Nenhuma venda registrada.</td></tr>`;

  const graficoHtml = pizzaPorProduto.length
    ? `<div class="section-title">Vendas por produto</div>
       <div class="grafico-faixas">${svgPizza(pizzaPorProduto)}${legendaPizzaMoedaHtml(pizzaPorProduto)}</div>`
    : "";

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Relatório de vendas</title>
    <style>${estiloRelatorioModerno()}</style></head>
    <body>
      ${marcaDaguaRelatorio(data)}
      <button class="voltar-btn" onclick="window.close()">← Voltar para o app</button>
      ${cabecalhoRelatorioModerno(data, "Relatório de vendas de produtos" + (tituloExtra ? " — " + tituloExtra : ""))}
      <div class="stats">
        <div class="stat"><div class="label">Vendas registradas</div><div class="value">${vendasBase.length}</div></div>
        <div class="stat"><div class="label">Total vendido</div><div class="value">R$ ${totalVendido.toFixed(2)}</div></div>
      </div>
      ${graficoHtml}
      <div class="section-title">Detalhamento das vendas</div>
      <table><thead><tr><th>Produto</th><th>Aluno</th><th>Professor</th><th>Data</th><th>Valor</th></tr></thead><tbody>${linhas}</tbody></table>
      ${rodapeRelatorioModerno()}
    </body></html>`;

  abrirJanelaRelatorio(html, onErro);
}

function PresencaManualAdmin({ data, save }) {
  const light = useDesktopLight();
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
      <div style={light ? { ...blockTitleStyle } : { ...blockTitleStyle, color: "#F5F3EC" }}>Marcar presença manual</div>
      <p style={{ fontSize: 12.5, color: light ? LIGHT.muted : "#9B9891", marginTop: 0 }}>Para quando o aluno esqueceu o celular ou não conseguiu fazer o check-in por localização.</p>
      <Field label="Turma" labelColor={light ? LIGHT.muted : "#9B9891"}><select style={light ? inputStyle : { ...inputStyle, background: "#0F1116", border: "1px solid rgba(255,255,255,0.14)", color: "#F5F3EC", colorScheme: "dark" }} value={turmaId} onChange={(e) => setTurmaId(e.target.value)}>{data.turmas.map((t) => <option key={t.id} value={t.id} style={light ? undefined : { background: "#1A1D24", color: "#F5F3EC" }}>{t.nome} — {t.horario}{t.horarioFim ? ` às ${t.horarioFim}` : ""}</option>)}</select></Field>
      {!sessaoAtiva ? (
        <div style={{ marginTop: 10 }}><Button variant="gold" icon={CalendarCheck} onClick={abrirSessao}>Abrir check-in desta turma hoje</Button></div>
      ) : (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflowY: "auto" }}>
            {data.alunos.map((a) => {
              const presente = data.checkins.some((c) => c.sessaoId === sessaoAtiva.id && c.alunoId === a.id);
              return (
                <div key={a.id} style={light ? { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", background: LIGHT.paper, borderRadius: 6, border: `1px solid ${LIGHT.line}`, color: LIGHT.text } : { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", background: "#12151B", borderRadius: 6, border: "1px solid rgba(255,255,255,0.08)", color: "#F5F3EC" }}>
                  <span style={{ fontSize: 13 }}>{a.nome}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Tag ok={presente}>{presente ? "Presente" : "Ausente"}</Tag>
                    <Button variant="ghost" onClick={() => alternarPresenca(a.id, presente)} style={ghostEscuroFallback(light)}>{presente ? "Remover" : "Marcar presença"}</Button>
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
  const light = useDesktopLight();
  const [erro, setErro] = useState("");
  const meusAlunos = data.alunos.filter((a) => a.professorId === prof.id);
  return (
    <Card style={light ? { marginBottom: 16 } : { marginBottom: 16, background: "#1A1D24", border: "1px solid rgba(255,255,255,0.06)" }}>
      <div style={light ? blockTitleStyle : { ...blockTitleStyle, color: "#F5F3EC" }}>Lista de alunos</div>
      <p style={{ fontSize: 12.5, color: light ? LIGHT.muted : "#C9C4B4", marginTop: 0 }}>Gera um PDF com o total e a lista de todos os seus {meusAlunos.length} aluno(s) vinculado(s).</p>
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
  const light = useDesktopLight();
  const [erro, setErro] = useState("");
  return (
    <Card dark style={{ marginBottom: 14 }}>
      <div style={light ? blockTitleStyle : { ...blockTitleStyle, color: "#F5F3EC" }}>Lista de alunos</div>
      <p style={{ fontSize: 12.5, color: light ? LIGHT.muted : "#9B9891", marginTop: 0 }}>Gera um PDF com todos os alunos cadastrados: faixa, categoria, telefone, professor, plano e status de pagamento.</p>
      <Button icon={Users} variant="gold" onClick={() => { setErro(""); gerarRelatorioListaAlunos(data, setErro); }}>Gerar lista de alunos (PDF)</Button>
      {erro && <div style={{ marginTop: 8, fontSize: 12.5, color: "#FF8A80", fontWeight: 600 }}>{erro}</div>}
    </Card>
  );
}

function RelatorioCheckins({ data }) {
  const light = useDesktopLight();
  const [dataSel, setDataSel] = useState(hoje());
  const [erro, setErro] = useState("");
  return (
    <Card dark style={{ marginBottom: 14 }}>
      <div style={light ? blockTitleStyle : { ...blockTitleStyle, color: "#F5F3EC" }}>Relatório de check-ins por data</div>
      <p style={{ fontSize: 12.5, color: light ? LIGHT.muted : "#9B9891", marginTop: 0 }}>Escolha uma data e veja todos os alunos que fizeram check-in naquele dia — abre pronto para salvar como PDF.</p>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div style={{ flex: "0 1 180px", minWidth: 140 }}><Field label="Data" labelColor={light ? LIGHT.muted : "#9B9891"}><input type="date" style={light ? { ...inputStyle, maxWidth: 170 } : { ...inputStyle, maxWidth: 170, background: "#0F1116", border: "1px solid rgba(255,255,255,0.14)", color: "#F5F3EC", colorScheme: "dark" }} value={dataSel} onChange={(e) => setDataSel(e.target.value)} /></Field></div>
        <Button icon={CalendarCheck} variant="gold" onClick={() => { setErro(""); gerarRelatorioCheckins(data, dataSel, setErro); }}>Gerar relatório (PDF)</Button>
      </div>
      {erro && <div style={{ marginTop: 8, fontSize: 12.5, color: "#FF8A80", fontWeight: 600 }}>{erro}</div>}
    </Card>
  );
}

function BuscaAluno({ alunos, alunoId, onSelecionar, dark = true, disabled = false }) {
  dark = dark && !useDesktopLight();
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
  dark = dark && !useDesktopLight();
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
    await save({ ...data, checkins: [...data.checkins, checkin] });
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
    await save({ ...data, checkins });
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
  dark = dark && !useDesktopLight();
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
  const light = useDesktopLight();
  const ghostBranco = light ? undefined : { color: "#FFFFFF", border: "1px solid rgba(255,255,255,0.2)" };
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
        <span style={{ fontSize: 11.5, color: light ? LIGHT.muted : "#C9C4B4", fontWeight: 600 }}>{acao === "add" ? "Adicionar" : "Remover"} {valor} aula(s)?</span>
        <Button variant="gold" onClick={confirmar}>Sim</Button>
        <Button variant="ghost" style={ghostBranco} onClick={() => setAcao(null)}>Não</Button>
      </span>
    );
  }

  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      <input type="number" min="1" style={{ ...inputStyle, width: 64, padding: "6px 8px" }} value={valor} onChange={(e) => setValor(e.target.value)} placeholder="nº aulas" />
      <Button variant="ghost" style={ghostBranco} onClick={() => pedirConfirmacao("add")}>+ Aulas</Button>
      <Button variant="ghost" style={ghostBranco} onClick={() => pedirConfirmacao("remove")}>− Aulas</Button>
    </div>
  );
}

function RecadoMestreProfessor({ data, prof, dark = true }) {
  dark = dark && !useDesktopLight();
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

function FotoTreinoProfessor({ prof, dark = true }) {
  dark = dark && !useDesktopLight();
  const [fotos, setFotos] = useState([]);
  const [arquivo, setArquivo] = useState(null);
  const [preview, setPreview] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [msg, setMsg] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const inputCameraRef = useRef(null);
  const inputGaleriaRef = useRef(null);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const linhas = await pg.select("fotos_treino", `professor_id=eq.${prof.id}&order=criado_em.desc`);
        if (!cancelado) setFotos((linhas || []).map((f) => ({ id: f.id, fotoUrl: f.foto_url, criadoEm: f.criado_em })));
      } catch (_) {}
    })();
    return () => { cancelado = true; };
  }, [prof.id]);

  const onArquivo = (e) => {
    const f = e.target.files?.[0];
    if (f) { setArquivo(f); setPreview(URL.createObjectURL(f)); setMsg(""); }
    e.target.value = "";
  };

  const cancelarEscolha = () => { setArquivo(null); setPreview(null); setConfirmando(false); };

  const enviar = async () => {
    if (!arquivo) return;
    setEnviando(true);
    setConfirmando(false);
    setMsg("");
    try {
      const url = await uploadArquivo("fotos-treino", arquivo, setProgresso);
      const criadoEm = new Date().toISOString();
      const id = uid();
      await pg.upsert("fotos_treino", [{ id, professor_id: prof.id, foto_url: url, criado_em: criadoEm }]);
      notificarPush("Foto do treino 📸", `${prof.nome} postou uma foto do treino de hoje.`, { professorAlunosId: prof.id });
      setFotos((prev) => [{ id, fotoUrl: url, criadoEm }, ...prev]);
      setMsg("Foto publicada! Fica visível pros seus alunos por 5 dias.");
      cancelarEscolha();
    } catch (e) {
      setMsg("Não foi possível enviar: " + (e?.message || "tenta de novo."));
    }
    setEnviando(false);
    setProgresso(0);
  };

  const remover = async (foto) => {
    await removerArquivo("fotos-treino", foto.fotoUrl);
    await pg.deleteIn("fotos_treino", [foto.id]);
    setFotos((prev) => prev.filter((f) => f.id !== foto.id));
  };

  const diasRestantes = (criadoEm) => {
    const dias = 5 - Math.floor((Date.now() - new Date(criadoEm).getTime()) / 86400000);
    return dias <= 0 ? "some hoje" : `some em ${dias} dia(s)`;
  };

  const corTexto = dark ? "#F5F3EC" : undefined;
  const corMuted = dark ? "#C9C4B4" : "#5A5648";

  return (
    <Card style={{ marginBottom: 16, ...(dark ? { background: "#1A1D24", border: "1px solid rgba(255,255,255,0.06)" } : {}) }}>
      <div style={dark ? { ...blockTitleStyle, color: corTexto } : blockTitleStyle}>📸 Foto do treino</div>
      <p style={{ fontSize: 12.5, color: corMuted, marginTop: 0 }}>
        Tire (ou escolha) uma foto do treino de hoje — todos os seus alunos recebem a notificação, e ela some sozinha depois de 5 dias.
      </p>
      {arquivo ? (
        <div>
          <img src={preview} alt="" style={{ width: "100%", maxHeight: 220, objectFit: "cover", borderRadius: 8, marginBottom: 10 }} />
          {enviando ? (
            <div style={{ fontSize: 13, color: corMuted }}>Enviando... {progresso}%</div>
          ) : confirmando ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12.5, color: corMuted, fontWeight: 600 }}>Publicar essa foto?</span>
              <Button variant="vermelho" onClick={enviar}>Sim, publicar</Button>
              <Button variant="ghost" style={dark ? { color: "#FFFFFF", border: "1px solid rgba(255,255,255,0.2)" } : undefined} onClick={() => setConfirmando(false)}>Não</Button>
            </span>
          ) : (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button variant="vermelho" onClick={() => setConfirmando(true)}>Publicar foto</Button>
              <Button variant="ghost" style={dark ? { color: "#FFFFFF", border: "1px solid rgba(255,255,255,0.2)" } : undefined} onClick={cancelarEscolha}>Trocar foto</Button>
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button variant="vermelho" icon={Camera} onClick={() => inputCameraRef.current?.click()}>Tirar foto agora</Button>
          <Button variant="ghost" style={dark ? { color: "#FFFFFF", border: "1px solid rgba(255,255,255,0.2)" } : undefined} onClick={() => inputGaleriaRef.current?.click()}>🖼️ Escolher da galeria</Button>
        </div>
      )}
      <input ref={inputCameraRef} type="file" accept="image/*" capture="environment" hidden onChange={onArquivo} />
      <input ref={inputGaleriaRef} type="file" accept="image/*" hidden onChange={onArquivo} />
      {msg && <div style={{ marginTop: 8, fontSize: 12.5, fontWeight: 600, color: msg.includes("publicada") ? (dark ? "#4ADE80" : "#1E7A34") : (dark ? "#FF8A80" : "#B3261E") }}>{msg}</div>}

      {fotos.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))", gap: 8, marginTop: 14 }}>
          {fotos.map((f) => (
            <div key={f.id} style={{ position: "relative" }}>
              <img src={f.fotoUrl} alt="" style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 8 }} />
              <div style={{ position: "absolute", bottom: 2, left: 2, right: 2, fontSize: 9, fontWeight: 700, color: "#fff", background: "rgba(0,0,0,0.55)", borderRadius: 4, padding: "1px 4px", textAlign: "center" }}>{diasRestantes(f.criadoEm)}</div>
              <button onClick={() => remover(f)} style={{ position: "absolute", top: 2, right: 2, background: "rgba(0,0,0,0.55)", border: "none", borderRadius: "50%", width: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                <X size={12} color="#fff" />
              </button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function AlunosPertoDeGraduar({ data, prof, dark = true }) {
  dark = dark && !useDesktopLight();
  const LIMITE_AULAS = 5;
  const candidatos = data.alunos
    .filter((a) => a.professorId === prof.id)
    .map((a) => ({ aluno: a, info: progressoGraduacaoInfo(data.faixas, a.faixaId, a.grau, aulasDesdeGraduacao(a, data.checkins), categoriaEtaria(a.dataNascimento)) }))
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
  dark = dark && !useDesktopLight();
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
              {turmasDisponiveis.map((t) => <option key={t.id} value={t.id} style={dark ? { background: "#1A1D24", color: "#F5F3EC" } : undefined}>{t.nome} — {t.horario}{t.horarioFim ? ` às ${t.horarioFim}` : ""}</option>)}
            </select>
          </Field>
        </div>
        <div style={{ fontFamily: "Oswald", fontSize: 32, fontWeight: 700, color: dark ? "#C9A227" : "#12213B" }}>{total}</div>
      </div>
    </Card>
  );
}

function RelatorioCheckinsProfessor({ data, prof, dark = true }) {
  dark = dark && !useDesktopLight();
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
  dark = dark && !useDesktopLight();
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
  const light = useDesktopLight();
  const darBaixa = (alunoId, valorProdutos, valorPago, dataPagamento) => darBaixaEm(data, save, alunoId, valorProdutos, valorPago, dataPagamento);
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

      <div style={light ? blockTitleStyle : { ...blockTitleStyle, color: "#F5F3EC" }}>Pagamentos pendentes</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
        {pendentes.map((a) => {
          const { plano, vencimento } = statusPagamento(a, data.planos);
          return (
            <Card dark key={a.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 12, flexWrap: "wrap", gap: 8 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, color: light ? LIGHT.text : "#F5F3EC" }}>{a.nome}</div>
                <div style={{ fontSize: 12, color: light ? LIGHT.muted : "#9B9891" }}>{plano?.nome || "sem plano"} · R$ {plano?.valor ?? 0} {vencimento && `· venceu em ${new Date(vencimento + "T00:00:00").toLocaleDateString("pt-BR")}`}</div>
              </div>
              <DarBaixaControle plano={plano} onConfirmar={(valorProdutos, valorPago, dataPagamento) => darBaixa(a.id, valorProdutos, valorPago, dataPagamento)} />
            </Card>
          );
        })}
        {pendentes.length === 0 && <Empty dark>Nenhum pagamento pendente 🎉</Empty>}
      </div>

      <div style={light ? blockTitleStyle : { ...blockTitleStyle, color: "#F5F3EC" }}>Pagamentos realizados (recentes)</div>
      <p style={{ fontSize: 12, color: light ? LIGHT.muted : "#9B9891", marginTop: 0 }}>Deu baixa por engano? Só o pagamento mais recente de cada aluno pode ser desfeito.</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {pagamentosRecentes.map((p) => (
          <Card dark key={p.id} style={{ padding: 12, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <div>
              <span style={{ fontWeight: 600, fontSize: 13.5, color: light ? LIGHT.text : "#F5F3EC" }}>{p.alunoNome}</span>
              <span style={{ fontSize: 13, color: light ? LIGHT.muted : "#9B9891" }}> · R$ {p.valor} · {new Date(p.data + "T00:00:00").toLocaleDateString("pt-BR")}</span>
              {p.valorProdutos > 0 && (
                <div style={{ fontSize: 11.5, color: light ? LIGHT.muted : "#9B9891" }}>Mensalidade R$ {p.valorMensalidade?.toFixed(2)} + produtos R$ {p.valorProdutos.toFixed(2)}</div>
              )}
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
  dark = dark && !useDesktopLight();
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
  const light = useDesktopLight();
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
      <p style={{ fontSize: 12.5, color: light ? LIGHT.muted : "#9B9891", marginTop: 0 }}>Avisos, notícias e próximos eventos publicados aqui aparecem na área do aluno, com notificação no aparelho quando o app é aberto.</p>
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
                <div style={{ fontWeight: 700, fontSize: 14, color: light ? LIGHT.text : "#F5F3EC" }}>{a.titulo}</div>
                {a.mensagem && <div style={{ fontSize: 12.5, color: light ? LIGHT.muted : "#9B9891", marginTop: 2 }}>{a.mensagem}</div>}
                {a.dataEvento && <div style={{ fontSize: 12, color: "#C9A227", fontWeight: 600, marginTop: 4 }}>Data do evento: {new Date(a.dataEvento + "T00:00:00").toLocaleDateString("pt-BR")}</div>}
                <div style={{ fontSize: 11, color: light ? LIGHT.muted : "#9B9891", marginTop: 4 }}>{new Date(a.criadoEm).toLocaleString("pt-BR")}</div>
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

function VideoForm({ unidades, unidadeFixa, onSave, onCancel }) {
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
          {unidadeFixa !== undefined ? (
            <input style={{ ...inputStyle, opacity: 0.75 }} value={unidadeFixa ? unidadeFixa.nome : "Todas as unidades"} disabled readOnly />
          ) : (
            <select style={inputStyle} value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)}>
              <option value="">Todas as unidades</option>
              {(unidades || []).map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </select>
          )}
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
  const light = useDesktopLight();
  const [novo, setNovo] = useState(false);
  const videosVisiveis = [...(data.videos || [])]
    .filter((v) => !v.professorId || v.professorId === prof.id)
    .sort((a, b) => (b.criadoEm || "").localeCompare(a.criadoEm || ""));

  const unidadeDoProfessor = (data.unidades || []).find((u) => u.id === prof.unidadeId) || null;

  const adicionar = async (form) => {
    const video = { id: uid(), criadoEm: new Date().toISOString(), professorId: prof.id, ...form, unidadeId: unidadeDoProfessor?.id || "" };
    await save({ ...data, videos: [...(data.videos || []), video] });
    setNovo(false);
  };
  const remover = async (id) => { await save({ ...data, videos: (data.videos || []).filter((v) => v.id !== id) }); };

  return (
    <div>
      <p style={{ fontSize: 12.5, color: light ? LIGHT.muted : "#9B9891", marginTop: 0 }}>Vídeos que você publicar aqui aparecem só pros seus alunos vinculados{unidadeDoProfessor ? ` da unidade ${unidadeDoProfessor.nome}` : ""} — cole um link do YouTube ou envie um arquivo MP4 direto.</p>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <Button icon={Plus} onClick={() => setNovo(true)}>Novo vídeo</Button>
      </div>
      {novo && <VideoForm unidades={data.unidades} unidadeFixa={unidadeDoProfessor} onCancel={() => setNovo(false)} onSave={adicionar} />}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {videosVisiveis.map((v) => {
          const unidadeDoVideo = (data.unidades || []).find((u) => u.id === v.unidadeId);
          return (
          <Card dark key={v.id} style={{ padding: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#C9A227", textTransform: "uppercase" }}>{!v.professorId ? "Geral (todos)" : "Só seus alunos"}{unidadeDoVideo ? ` · ${unidadeDoVideo.nome}` : ""}</span>
              <div style={{ fontWeight: 700, fontSize: 14, color: light ? LIGHT.text : "#F5F3EC" }}>{v.titulo}</div>
              {v.legenda && <div style={{ fontSize: 12, color: light ? LIGHT.muted : "#9B9891" }}>{v.legenda}</div>}
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
  const light = useDesktopLight();
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
      <p style={{ fontSize: 12.5, color: light ? LIGHT.muted : "#9B9891", marginTop: 0 }}>Vídeos de técnicas e posições para os alunos assistirem dentro do próprio app — cole um link do YouTube ou envie um arquivo MP4 direto. Vincule a uma unidade pra ele aparecer só pros alunos de lá.</p>
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
              <div style={{ fontWeight: 700, fontSize: 14, color: light ? LIGHT.text : "#F5F3EC" }}>{v.titulo}</div>
              {v.legenda && <div style={{ fontSize: 12, color: light ? LIGHT.muted : "#9B9891" }}>{v.legenda}</div>}
              <a href={v.url} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, color: "#C9A227" }}>{v.url.includes("/storage/v1/") ? "Arquivo enviado" : v.url}</a>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <select style={light ? { ...inputStyle, width: 160 } : { ...inputStyleDark, width: 160 }} value={v.unidadeId || ""} onChange={(e) => atualizarUnidade(v.id, e.target.value)}>
                <option value="" style={light ? undefined : { background: "#1A1D24", color: "#F5F3EC" }}>Todas as unidades</option>
                {(data.unidades || []).map((u) => <option key={u.id} value={u.id} style={light ? undefined : { background: "#1A1D24", color: "#F5F3EC" }}>{u.nome}</option>)}
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
  const light = useDesktopLight();
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
        <Field label="Nome do produto" labelColor={light ? LIGHT.muted : "#C9C4B4"}><input style={light ? inputStyle : inputStyleDark} value={nome} onChange={(e) => setNome(e.target.value)} placeholder={`Ex: Kimono ${MARCA.nomeEquipe} A2`} /></Field>
        <Field label="Valor (R$)" labelColor={light ? LIGHT.muted : "#C9C4B4"}><input type="number" min="0" step="0.01" style={light ? inputStyle : inputStyleDark} value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" /></Field>
        <div>
          <span style={{ fontSize: 12, fontWeight: 600, color: light ? LIGHT.muted : "#C9C4B4", textTransform: "uppercase", letterSpacing: 0.4 }}>Fotos</span>
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
            <Button variant="ghost" style={light ? undefined : { color: "#FFFFFF", border: "1px solid rgba(255,255,255,0.2)" }} onClick={() => inputCameraRef.current?.click()} disabled={enviando}>📷 Tirar foto</Button>
            <Button variant="ghost" style={light ? undefined : { color: "#FFFFFF", border: "1px solid rgba(255,255,255,0.2)" }} onClick={() => inputGaleriaRef.current?.click()} disabled={enviando}>🖼️ Escolher da galeria</Button>
          </div>
          <input ref={inputCameraRef} type="file" accept="image/*" capture="environment" hidden onChange={onArquivo} />
          <input ref={inputGaleriaRef} type="file" accept="image/*" multiple hidden onChange={onArquivo} />
          {enviando && <div style={{ fontSize: 12, color: light ? LIGHT.muted : "#C9C4B4", marginTop: 6 }}>Enviando foto...</div>}
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
  const light = useDesktopLight();
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
      <p style={{ fontSize: 12.5, color: light ? LIGHT.muted : "#9B9891", marginTop: 0 }}>Produtos que você cadastrar aqui aparecem pros seus alunos vinculados verem (kimonos, bonés, patches etc.) — é só pra divulgar, a venda combina direto com o aluno.</p>
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
              <div style={{ fontWeight: 700, fontSize: 14, color: light ? LIGHT.text : "#F5F3EC" }}>{p.nome}</div>
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

function VendaForm({ produtos, alunos, onSave, onCancel }) {
  const light = useDesktopLight();
  const [alunoId, setAlunoId] = useState(alunos[0]?.id || "");
  const [produtoId, setProdutoId] = useState(produtos[0]?.id || "outro");
  const [nomeCustom, setNomeCustom] = useState("");
  const [valor, setValor] = useState(produtos[0] ? String(produtos[0].valor) : "");
  const [dataVenda, setDataVenda] = useState(hoje());

  const selecionarProduto = (id) => {
    setProdutoId(id);
    if (id === "outro") { setNomeCustom(""); setValor(""); return; }
    const p = produtos.find((x) => x.id === id);
    if (p) setValor(String(p.valor));
  };

  const submit = () => {
    if (!alunoId) return;
    const produtoSelecionado = produtos.find((p) => p.id === produtoId);
    const nome = produtoId === "outro" ? nomeCustom.trim() : (produtoSelecionado?.nome || "");
    if (!nome || !valor || Number(valor) <= 0) return;
    onSave({ alunoId, produtoId: produtoId === "outro" ? null : produtoId, produtoNome: nome, valor: Number(valor), data: dataVenda });
  };

  return (
    <Card dark style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Field label="Aluno" labelColor={light ? LIGHT.muted : "#C9C4B4"}>
          <select style={light ? inputStyle : inputStyleDark} value={alunoId} onChange={(e) => setAlunoId(e.target.value)}>
            {alunos.length === 0 && <option value="">Nenhum aluno vinculado</option>}
            {alunos.map((a) => <option key={a.id} value={a.id} style={light ? undefined : { background: "#1A1D24", color: "#F5F3EC" }}>{a.nome}</option>)}
          </select>
        </Field>
        <Field label="Produto" labelColor={light ? LIGHT.muted : "#C9C4B4"}>
          <select style={light ? inputStyle : inputStyleDark} value={produtoId} onChange={(e) => selecionarProduto(e.target.value)}>
            {produtos.map((p) => <option key={p.id} value={p.id} style={light ? undefined : { background: "#1A1D24", color: "#F5F3EC" }}>{p.nome} — R$ {p.valor.toFixed(2)}</option>)}
            <option value="outro" style={light ? undefined : { background: "#1A1D24", color: "#F5F3EC" }}>Outro (não cadastrado)</option>
          </select>
        </Field>
        {produtoId === "outro" && (
          <Field label="Nome do produto" labelColor={light ? LIGHT.muted : "#C9C4B4"}><input style={light ? inputStyle : inputStyleDark} value={nomeCustom} onChange={(e) => setNomeCustom(e.target.value)} placeholder="Ex: Faixa avulsa" /></Field>
        )}
        <Field label="Valor da venda (R$)" labelColor={light ? LIGHT.muted : "#C9C4B4"}><input type="number" min="0" step="0.01" style={light ? inputStyle : inputStyleDark} value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" /></Field>
        <p style={{ fontSize: 11.5, color: light ? LIGHT.muted : "#9B9891", margin: 0 }}>O valor já vem preenchido com o preço cadastrado do produto — pode deixar como está ou editar (ex: desconto, combo).</p>
        <Field label="Data da venda" labelColor={light ? LIGHT.muted : "#C9C4B4"}><input type="date" style={light ? { ...inputStyle, maxWidth: "100%" } : { ...inputStyleDark, maxWidth: "100%" }} value={dataVenda} onChange={(e) => setDataVenda(e.target.value)} /></Field>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <ConfirmButton dark onConfirm={submit}>Registrar venda</ConfirmButton>
        <Button variant="ghost" icon={X} style={light ? undefined : { color: "#FFFFFF", border: "1px solid rgba(255,255,255,0.2)" }} onClick={onCancel}>Cancelar</Button>
      </div>
    </Card>
  );
}

function VendasProfessor({ data, save, prof }) {
  const light = useDesktopLight();
  const [novo, setNovo] = useState(false);
  const meusAlunos = data.alunos.filter((a) => a.professorId === prof.id);
  const meusProdutos = (data.produtos || []).filter((p) => p.professorId === prof.id);
  const minhasVendas = [...(data.vendas || [])]
    .filter((v) => v.professorId === prof.id)
    .sort((a, b) => (b.criadoEm || "").localeCompare(a.criadoEm || ""));
  const totalVendido = minhasVendas.reduce((s, v) => s + (v.valor || 0), 0);

  const adicionar = async (form) => {
    const venda = { id: uid(), criadoEm: new Date().toISOString(), professorId: prof.id, ...form };
    await save({ ...data, vendas: [...(data.vendas || []), venda] });
    setNovo(false);
  };
  const remover = async (id) => {
    await save({ ...data, vendas: (data.vendas || []).filter((v) => v.id !== id) });
  };

  return (
    <div>
      <p style={{ fontSize: 12.5, color: light ? LIGHT.muted : "#9B9891", marginTop: 0 }}>Registre aqui as vendas de produtos pros seus alunos — vale tanto pra um produto já cadastrado quanto pra algo avulso (não precisa estar na lista de produtos).</p>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontSize: 13, color: light ? LIGHT.muted : "#C9C4B4" }}>{minhasVendas.length} venda(s) · total <span style={{ color: "#C9A227", fontWeight: 700 }}>R$ {totalVendido.toFixed(2)}</span></div>
        <Button icon={Plus} onClick={() => setNovo(true)}>Registrar venda</Button>
      </div>
      {novo && <VendaForm produtos={meusProdutos} alunos={meusAlunos} onCancel={() => setNovo(false)} onSave={adicionar} />}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {minhasVendas.map((v) => {
          const aluno = data.alunos.find((a) => a.id === v.alunoId);
          return (
            <Card dark key={v.id} style={{ padding: 12, display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: light ? LIGHT.text : "#F5F3EC" }}>{v.produtoNome}</div>
                <div style={{ fontSize: 12, color: light ? LIGHT.muted : "#9B9891" }}>{aluno?.nome || "Aluno removido"} · {v.data ? new Date(v.data + "T00:00:00").toLocaleDateString("pt-BR") : "—"}</div>
              </div>
              <div style={{ fontSize: 13, color: "#C9A227", fontWeight: 700, flexShrink: 0 }}>R$ {v.valor.toFixed(2)}</div>
              <ConfirmDelete onConfirm={() => remover(v.id)} />
            </Card>
          );
        })}
        {minhasVendas.length === 0 && <Empty dark>Nenhuma venda registrada ainda.</Empty>}
      </div>
    </div>
  );
}

function TurmasProfessor({ data, save, prof }) {
  const light = useDesktopLight();
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
      <p style={{ fontSize: 12.5, color: light ? LIGHT.muted : "#9B9891", marginTop: 0 }}>Turmas que você cadastrar aqui aparecem na grade de horários dos seus alunos vinculados, e você pode iniciar o check-in delas normalmente.</p>
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
                <div style={{ fontWeight: 600, fontSize: 14, color: light ? LIGHT.text : "#F5F3EC" }}>{t.nome}</div>
                <div style={{ fontSize: 12.5, color: light ? LIGHT.muted : "#9B9891" }}>{formatDias(t.dias)} · {t.horario}{t.horarioFim ? ` às ${t.horarioFim}` : ""}</div>
                <div style={{ fontSize: 11.5, color: light ? LIGHT.muted : "#9B9891" }}>Unidade: {unidadeDaTurma ? unidadeDaTurma.nome : `${MARCA.sede} (padrão)`}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Button variant="ghost" onClick={() => setEditando(t)} style={ghostEscuroFallback(light)}>Editar</Button>
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

function SobreEquipeAluno({ texto, nomeEquipe }) {
  const [aberto, setAberto] = useState(false);
  if (!texto || !texto.trim()) return null;
  return (
    <Card style={{ marginBottom: 14, background: "#1A1D24", border: "1px solid rgba(255,255,255,0.06)" }}>
      <button onClick={() => setAberto((v) => !v)} style={{ width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ ...blockTitleStyle, color: "#FFFFFF" }}>🥋 Sobre a {nomeEquipe || "equipe"}</span>
        <span style={{ fontSize: 18, color: "#C9A227" }}>{aberto ? "−" : "+"}</span>
      </button>
      {aberto && (
        <div style={{ marginTop: 10, fontSize: 13.5, lineHeight: 1.55, color: "#C4C0B4", whiteSpace: "pre-wrap" }}>{texto}</div>
      )}
    </Card>
  );
}

function GolpesProibidosCard({ pdf, pdfNome }) {
  const light = useDesktopLight();
  if (!pdf) return null;
  return (
    <Card style={light ? { marginBottom: 14 } : { marginBottom: 14, background: "#1A1D24", border: "1px solid rgba(255,255,255,0.06)" }}>
      <div style={light ? blockTitleStyle : { ...blockTitleStyle, color: "#FFFFFF" }}>🚫 Golpes proibidos</div>
      <a href={pdf} target="_blank" rel="noreferrer" onClick={(e) => { e.preventDefault(); abrirPdfDataUrl(pdf); }} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "#C9A227" }}>
        📄 Abrir PDF ({pdfNome || "golpes-proibidos.pdf"})
      </a>
    </Card>
  );
}

// Tabela de pesos configurada no painel (Configurações): link e/ou arquivo (imagem com zoom, ou PDF).
function TabelaPesosCard({ link, arquivo, arquivoNome }) {
  const light = useDesktopLight();
  const [aberto, setAberto] = useState(false);
  const [telaCheia, setTelaCheia] = useState(false);
  if (!link && !arquivo) return null;
  const ehImagem = arquivo && arquivo.startsWith("data:image");
  const textoLink = link ? link.replace(/^https?:\/\//, "").replace(/\/$/, "") : "";
  return (
    <Card style={light ? { marginBottom: 14 } : { marginBottom: 14, background: "#1A1D24", border: "1px solid rgba(255,255,255,0.06)" }}>
      <button onClick={() => setAberto((v) => !v)} style={{ width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={light ? { ...blockTitleStyle, marginBottom: 0 } : { ...blockTitleStyle, marginBottom: 0, color: "#FFFFFF" }}>⚖️ Tabela de Pesos e Categorias</span>
        <span style={{ fontSize: 18, color: "#C9A227" }}>{aberto ? "−" : "+"}</span>
      </button>
      {aberto && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
          {ehImagem && (
            <div>
              <button onClick={() => setTelaCheia(true)} style={{ display: "block", width: "100%", padding: 0, border: "none", background: "none", cursor: "zoom-in" }}>
                <img src={arquivo} alt="Tabela de pesos" style={{ display: "block", width: "100%", height: "auto", borderRadius: 8 }} />
              </button>
              <div style={{ marginTop: 6, fontSize: 11.5, color: "#9B9891", textAlign: "center" }}>Toque na imagem para ampliar</div>
              {telaCheia && <ImagemZoom src={arquivo} alt="Tabela de pesos" onFechar={() => setTelaCheia(false)} />}
            </div>
          )}
          {arquivo && !ehImagem && (
            <a href={arquivo} target="_blank" rel="noreferrer" onClick={(e) => { e.preventDefault(); abrirPdfDataUrl(arquivo); }} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "#C9A227" }}>
              📄 Abrir PDF ({arquivoNome || "tabela-de-pesos.pdf"})
            </a>
          )}
          {link && (
            <a href={link} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "#C9A227", wordBreak: "break-all" }}>
              🔗 {textoLink}
            </a>
          )}
        </div>
      )}
    </Card>
  );
}

function slugTexto(str) {
  return normalizarTexto(str)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
}

// Metodologia de aula do professor — fica fora do `data` geral, numa tabela própria que só o
// próprio professor consegue ler (RLS), pra nunca chegar no app do aluno.
function MetodologiaProfessor({ prof }) {
  const light = useDesktopLight();
  const [texto, setTexto] = useState("");
  const [status, setStatus] = useState("carregando");
  useEffect(() => {
    let ativo = true;
    pg.select("metodologias_professor", `select=texto&professor_id=eq.${prof.id}`)
      .then((rows) => { if (ativo) { setTexto(rows?.[0]?.texto || ""); setStatus("ok"); } })
      .catch(() => { if (ativo) setStatus("erro-carregar"); });
    return () => { ativo = false; };
  }, [prof.id]);
  const salvar = async () => {
    setStatus("salvando");
    try {
      await pg.upsert("metodologias_professor", [{ professor_id: prof.id, texto, atualizado_em: new Date().toISOString() }]);
      setStatus("salvo");
    } catch (_) {
      setStatus("erro-salvar");
    }
  };
  const muted = light ? LIGHT.muted : "#9B9891";
  return (
    <Card dark style={light ? undefined : { background: "#1A1D24", border: "1px solid rgba(255,255,255,0.06)" }}>
      <div style={light ? blockTitleStyle : { ...blockTitleStyle, color: "#FFFFFF" }}>📋 Minha metodologia de aula</div>
      <p style={{ fontSize: 12.5, color: muted, marginBottom: 12 }}>
        Anote como você conduz suas aulas: aquecimento, técnicas, alongamento, treinos... Só você vê esse texto — ele não aparece pros alunos.
      </p>
      {status === "carregando" ? (
        <p style={{ fontSize: 12.5, color: muted }}>Carregando...</p>
      ) : status === "erro-carregar" ? (
        <p style={{ fontSize: 12.5, color: "#E57373" }}>Não foi possível carregar sua metodologia. Verifique a internet e abra a aba de novo.</p>
      ) : (
        <>
          <textarea
            style={{ ...(light ? inputStyle : inputStyleDark), minHeight: 200, fontFamily: "Inter", resize: "vertical", lineHeight: 1.5 }}
            value={texto}
            onChange={(e) => { setTexto(e.target.value); if (status !== "salvando") setStatus("ok"); }}
            placeholder={"Aquecimento: ...\nTécnicas: ...\nAlongamento: ...\nTreinos: ..."}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
            <Button variant="gold" icon={Check} disabled={status === "salvando"} onClick={salvar}>{status === "salvando" ? "Salvando..." : "Salvar metodologia"}</Button>
            {status === "salvo" && <span style={{ fontSize: 12.5, color: "#6FCF7F", fontWeight: 600 }}>Salvo!</span>}
            {status === "erro-salvar" && <span style={{ fontSize: 12.5, color: "#E57373", fontWeight: 600 }}>Erro ao salvar. Tente de novo.</span>}
          </div>
        </>
      )}
    </Card>
  );
}

function SalaReuniaoProfessores({ data, prof }) {
  const light = useDesktopLight();
  const [aberta, setAberta] = useState(false);
  const [linkCopiado, setLinkCopiado] = useState(false);
  const roomName = `${MARCA.slug}-reuniao-${slugTexto(data.academia.nome) || "equipe"}-${(data.academia.id || "sala").replace(/-/g, "").slice(0, 8)}`;
  const roomBase = `https://meet.jit.si/${roomName}#config.prejoinPageEnabled=true&config.disableDeepLinking=true`;
  const jitsiUrl = `${roomBase}&userInfo.displayName="${encodeURIComponent(prof?.nome || "Professor")}"`;

  const convidar = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: "Reunião de vídeo", text: "Entre na reunião pelo link:", url: roomBase }); return; } catch (_) { /* usuário cancelou o compartilhamento */ }
    }
    try {
      await navigator.clipboard.writeText(roomBase);
      setLinkCopiado(true);
      setTimeout(() => setLinkCopiado(false), 2500);
    } catch (_) { /* clipboard indisponível */ }
  };

  return (
    <>
      <Card dark style={light ? undefined : { background: "#1A1D24", border: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={light ? blockTitleStyle : { ...blockTitleStyle, color: "#FFFFFF" }}>🎥 Reunião de professores</div>
        <p style={{ fontSize: 12.5, color: light ? LIGHT.muted : "#9B9891", marginBottom: 12 }}>
          Sala de vídeo chamada pra equipe de professores. Quem entrar ao mesmo tempo cai na mesma reunião — sem precisar marcar link nem app externo. Quer chamar algum aluno também? Envie o link pra ele — não precisa ter o app instalado, abre no navegador normal.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button onClick={() => setAberta(true)} style={{ flex: "1 1 160px", justifyContent: "center" }}>Entrar na reunião</Button>
          <Button variant="ghost" icon={Share} onClick={convidar} style={{ flex: "1 1 160px", justifyContent: "center", ...(light ? {} : { color: "#F5F3EC", border: "1px solid rgba(255,255,255,0.2)" }) }}>
            {linkCopiado ? "Link copiado!" : "Convidar (link)"}
          </Button>
        </div>
      </Card>

      {aberta && (
        <div style={{ position: "fixed", inset: 0, background: "#000", zIndex: 9999, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", background: "#111318", borderBottom: "1px solid rgba(255,255,255,0.1)", flexShrink: 0 }}>
            <div style={{ color: "#F5F3EC", fontSize: 13, fontWeight: 600 }}>🎥 Reunião de professores</div>
            <button onClick={() => setAberta(false)} style={{ background: "rgba(255,255,255,0.1)", border: "none", borderRadius: 6, color: "#F5F3EC", padding: "7px 14px", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Sair ✕</button>
          </div>
          <iframe
            src={jitsiUrl}
            allow="camera; microphone; fullscreen; display-capture; autoplay"
            style={{ flex: 1, border: "none", width: "100%" }}
            title="Reunião de professores"
          />
        </div>
      )}
    </>
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
  const light = useDesktopLight();
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
      <p style={{ fontSize: 12.5, color: light ? LIGHT.muted : "#9B9891", marginTop: 0 }}>Cadastre aqui outros locais onde o professor dá aula (ou "Personal", sem endereço fixo). Depois é só vincular cada aluno à unidade certa no cadastro dele — o check-in por localização passa a considerar o local daquela unidade, em vez do QG.</p>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <Button icon={Plus} onClick={() => setNovo(true)}>Nova unidade</Button>
      </div>
      {novo && <UnidadeForm onCancel={() => setNovo(false)} onSave={adicionar} />}
      {editando && <UnidadeForm initial={editando} onCancel={() => setEditando(null)} onSave={(form) => editar(editando.id, form)} />}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {(data.unidades || []).map((u) => (
          <Card dark key={u.id} style={{ padding: 12, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: light ? LIGHT.text : "#F5F3EC" }}>{u.nome}</div>
              <div style={{ fontSize: 12, color: light ? LIGHT.muted : "#9B9891" }}>
                {u.latitude != null ? `${u.endereco || "Local cadastrado"} · raio ${u.raioCheckin || 150}m` : "Sem localização fixa (não exige geolocalização)"}
              </div>
              <div style={{ fontSize: 11.5, color: light ? LIGHT.muted : "#9B9891" }}>PIX: {u.chavePix || "usa a chave geral da academia"}</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Button variant="ghost" onClick={() => setEditando(u)} style={ghostEscuroFallback(light)}>Editar</Button>
              <ConfirmDelete onConfirm={() => remover(u.id)} />
            </div>
          </Card>
        ))}
        {(data.unidades || []).length === 0 && <Empty dark>Nenhuma unidade cadastrada ainda. O {MARCA.sede} continua sendo o local padrão para quem não tiver unidade selecionada.</Empty>}
      </div>
    </div>
  );
}

function PedirAssinaturaTodos({ data, save }) {
  const light = useDesktopLight();
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
          <Button variant="ghost" style={ghostEscuroFallback(light)} onClick={() => setConfirmando(false)}>Cancelar</Button>
        </div>
      ) : (
        <Button variant="ghost" onClick={() => { setConfirmando(true); setFeito(false); }} style={ghostEscuroFallback(light)}>Pedir nova assinatura de todos os alunos</Button>
      )}
      {feito && <div style={{ fontSize: 12, color: "#4ADE80", fontWeight: 600, marginTop: 6 }}>Pronto — na próxima vez que cada aluno abrir o app, ele vai precisar assinar de novo (com o dedo, na tela).</div>}
    </div>
  );
}

function ConfiguracoesAdmin({ data, save }) {
  const light = useDesktopLight();
  const rotuloConfig = light ? LIGHT.muted : "#9B9891";
  const ghostConfig = ghostEscuroFallback(light);
  const [nome, setNome] = useState(data.academia.nome);
  const [chavePix, setChavePix] = useState(data.academia.chavePix || "");
  const [termo, setTermo] = useState(data.academia.termoPadrao || "");
  const [logo, setLogo] = useState(data.academia.logo || null);
  const [termoPdf, setTermoPdf] = useState(data.academia.termoPdf || null);
  const [termoPdfNome, setTermoPdfNome] = useState(data.academia.termoPdfNome || "");
  const [endereco, setEndereco] = useState(data.academia.endereco || "");
  const [latitude, setLatitude] = useState(data.academia.latitude ?? "");
  const [longitude, setLongitude] = useState(data.academia.longitude ?? "");
  const [raioCheckin, setRaioCheckin] = useState(data.academia.raioCheckin ?? 150);
  const [instagram, setInstagram] = useState(data.academia.instagram || "");
  const [facebook, setFacebook] = useState(data.academia.facebook || "");
  const [whatsapp, setWhatsapp] = useState(data.academia.whatsapp || "");
  const [mensagemAniversario, setMensagemAniversario] = useState(data.academia.mensagemAniversario || "");
  const [regrasTatame, setRegrasTatame] = useState(data.academia.regrasTatame || null);
  const [sobreEquipe, setSobreEquipe] = useState(data.academia.sobreEquipe || "");
  const [marcaDagua, setMarcaDagua] = useState(data.academia.marcaDagua || null);
  const [golpesProibidosPdf, setGolpesProibidosPdf] = useState(data.academia.golpesProibidosPdf || null);
  const [golpesProibidosPdfNome, setGolpesProibidosPdfNome] = useState(data.academia.golpesProibidosPdfNome || "");
  const [tabelaPesosLink, setTabelaPesosLink] = useState(data.academia.tabelaPesosLink || "");
  const [tabelaPesosArquivo, setTabelaPesosArquivo] = useState(data.academia.tabelaPesosArquivo || null);
  const [tabelaPesosArquivoNome, setTabelaPesosArquivoNome] = useState(data.academia.tabelaPesosArquivoNome || "");
  const logoRef = useRef(null);
  const pdfRef = useRef(null);
  const regrasRef = useRef(null);
  const marcaDaguaRef = useRef(null);
  const golpesProibidosRef = useRef(null);
  const tabelaPesosRef = useRef(null);

  const onLogo = (e) => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => setLogo(r.result); r.readAsDataURL(f); };
  const onPdf = (e) => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => { setTermoPdf(r.result); setTermoPdfNome(f.name); }; r.readAsDataURL(f); };
  const onRegras = (e) => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => setRegrasTatame(r.result); r.readAsDataURL(f); };
  const onMarcaDagua = (e) => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => setMarcaDagua(r.result); r.readAsDataURL(f); };
  const onGolpesProibidos = (e) => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => { setGolpesProibidosPdf(r.result); setGolpesProibidosPdfNome(f.name); }; r.readAsDataURL(f); };
  const onTabelaPesos = (e) => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => { setTabelaPesosArquivo(r.result); setTabelaPesosArquivoNome(f.name); }; r.readAsDataURL(f); };
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
        ...data.academia, nome, chavePix, termoPadrao: termo, logo, termoPdf, termoPdfNome,
        endereco, latitude: latitude === "" ? null : Number(latitude), longitude: longitude === "" ? null : Number(longitude),
        raioCheckin: Number(raioCheckin) || 150, instagram, facebook, whatsapp, mensagemAniversario, regrasTatame, sobreEquipe, marcaDagua, golpesProibidosPdf, golpesProibidosPdfNome,
        tabelaPesosLink: tabelaPesosLink.trim() || null, tabelaPesosArquivo, tabelaPesosArquivoNome: tabelaPesosArquivoNome || null,
      },
    });
  };

  return (
    <Card dark>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field label="Logo da equipe" labelColor={rotuloConfig}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {logo ? <img src={logo} alt="logo" style={{ width: 56, height: 56, borderRadius: 10, objectFit: "cover", border: "1px solid rgba(255,255,255,0.14)" }} /> : <div style={{ width: 56, height: 56, borderRadius: 10, background: "rgba(255,255,255,0.06)" }} />}
            <Button variant="ghost" icon={Camera} onClick={() => logoRef.current?.click()} style={ghostConfig}>Enviar logo</Button>
            <input ref={logoRef} type="file" accept="image/*" hidden onChange={onLogo} />
          </div>
        </Field>
        <Field label="Nome da academia/equipe" labelColor={rotuloConfig}><input style={inputStyle} value={nome} onChange={(e) => setNome(e.target.value)} /></Field>
        <Field label="Chave PIX para pagamentos" labelColor={rotuloConfig}><input style={inputStyle} value={chavePix} onChange={(e) => setChavePix(e.target.value)} placeholder="ex: e-mail, telefone ou chave aleatória" /></Field>
        <Field label={`Endereço do ${MARCA.sede}`} labelColor={rotuloConfig}><input style={inputStyle} value={endereco} onChange={(e) => setEndereco(e.target.value)} placeholder="Rua, número, bairro, cidade" /></Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <Field label="Latitude" labelColor={rotuloConfig}><input type="number" step="any" style={inputStyle} value={latitude} onChange={(e) => setLatitude(e.target.value)} /></Field>
          <Field label="Longitude" labelColor={rotuloConfig}><input type="number" step="any" style={inputStyle} value={longitude} onChange={(e) => setLongitude(e.target.value)} /></Field>
          <Field label="Raio permitido (metros)" labelColor={rotuloConfig}><input type="number" min="10" style={inputStyle} value={raioCheckin} onChange={(e) => setRaioCheckin(e.target.value)} /></Field>
        </div>
        <div>
          <Button variant="ghost" onClick={usarLocalizacaoAtual} style={ghostConfig}>Usar minha localização atual (se você estiver no {MARCA.sede} agora)</Button>
          <p style={{ fontSize: 11.5, color: rotuloConfig, marginTop: 6 }}>Isso preenche latitude/longitude com base em onde este aparelho está agora. Se preferir, pegue as coordenadas pelo Google Maps: toque e segure o local no mapa e copie os números que aparecem.</p>
        </div>
        <Field label="Mensagem de aniversário (opcional)" labelColor={rotuloConfig}>
          <input style={inputStyle} value={mensagemAniversario} onChange={(e) => setMensagemAniversario(e.target.value)} placeholder={`Toda a equipe do ${MARCA.sede} deseja um ótimo dia. 🥋`} />
          <p style={{ fontSize: 11.5, color: rotuloConfig, marginTop: 4 }}>Use <b>{"{nome}"}</b> em qualquer lugar do texto pra ele virar o primeiro nome da pessoa automaticamente. Se deixar em branco, usamos a mensagem padrão.</p>
        </Field>
        <Field label="Termo de consentimento (texto exibido no app)" labelColor={rotuloConfig}>
          <textarea style={{ ...inputStyle, minHeight: 120, fontFamily: "Inter", resize: "vertical" }} value={termo} onChange={(e) => setTermo(e.target.value)} />
        </Field>
        <Field label="Termo de consentimento (arquivo PDF, opcional)" labelColor={rotuloConfig}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Button variant="ghost" onClick={() => pdfRef.current?.click()} style={ghostConfig}>{termoPdf ? "Trocar PDF" : "Enviar PDF"}</Button>
            <input ref={pdfRef} type="file" accept="application/pdf" hidden onChange={onPdf} />
            {termoPdfNome && <span style={{ fontSize: 12.5, color: rotuloConfig }}>{termoPdfNome}</span>}
          </div>
        </Field>
        <Field label="Assinatura do termo" labelColor={rotuloConfig}>
          <PedirAssinaturaTodos data={data} save={save} />
          <p style={{ fontSize: 11.5, color: rotuloConfig, marginTop: 4 }}>Use isso depois de mudar o texto do termo, ou pra fazer todo mundo assinar com o dedo pela primeira vez (inclusive quem já tinha aceitado antes, sem assinatura).</p>
        </Field>
        <Field label="Regras do tatame (imagem, opcional)" labelColor={rotuloConfig}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {regrasTatame && <img src={regrasTatame} alt="regras do tatame" style={{ width: 56, height: 56, borderRadius: 10, objectFit: "cover", border: "1px solid rgba(255,255,255,0.14)" }} />}
            <Button variant="ghost" icon={Camera} onClick={() => regrasRef.current?.click()} style={ghostConfig}>{regrasTatame ? "Trocar imagem" : "Enviar imagem"}</Button>
            {regrasTatame && <Button variant="ghost" icon={X} onClick={() => setRegrasTatame(null)} style={ghostConfig}>Remover</Button>}
            <input ref={regrasRef} type="file" accept="image/*" hidden onChange={onRegras} />
          </div>
          <p style={{ fontSize: 11.5, color: rotuloConfig, marginTop: 4 }}>Se preenchida, aparece no app do aluno, na aba "Mais", em um card "Regras do tatame" que ele pode expandir.</p>
        </Field>
        <Field label="Sobre a equipe (texto, opcional)" labelColor={rotuloConfig}>
          <textarea style={{ ...inputStyle, minHeight: 120, fontFamily: "Inter", resize: "vertical" }} value={sobreEquipe} onChange={(e) => setSobreEquipe(e.target.value)} placeholder="Conte a história da equipe, os valores, os professores..." />
          <p style={{ fontSize: 11.5, color: rotuloConfig, marginTop: 4 }}>Se preenchido, aparece no app do aluno, na aba "Mais", em um card "Sobre a" + o nome da academia, que ele pode expandir.</p>
        </Field>
        <Field label="Marca d'água dos relatórios em PDF (imagem, opcional)" labelColor={rotuloConfig}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {marcaDagua && <img src={marcaDagua} alt="marca d'água" style={{ width: 56, height: 56, borderRadius: 10, objectFit: "cover", border: "1px solid rgba(255,255,255,0.14)", background: "#333" }} />}
            <Button variant="ghost" icon={Camera} onClick={() => marcaDaguaRef.current?.click()} style={ghostConfig}>{marcaDagua ? "Trocar imagem" : "Enviar imagem"}</Button>
            {marcaDagua && <Button variant="ghost" icon={X} onClick={() => setMarcaDagua(null)} style={ghostConfig}>Remover</Button>}
            <input ref={marcaDaguaRef} type="file" accept="image/*" hidden onChange={onMarcaDagua} />
          </div>
          <p style={{ fontSize: 11.5, color: rotuloConfig, marginTop: 4 }}>Aparece grande, no centro, bem clarinha, atrás do conteúdo de todo relatório em PDF. Funciona melhor com uma imagem clara/transparente (tipo um desenho de linha) — ela é invertida automaticamente pra ficar visível no papel branco. Se não enviar nada aqui, usamos o "Logo da equipe" pequeno no canto, como já era antes.</p>
        </Field>
        <Field label="Golpes proibidos (arquivo PDF, opcional)" labelColor={rotuloConfig}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Button variant="ghost" onClick={() => golpesProibidosRef.current?.click()} style={ghostConfig}>{golpesProibidosPdf ? "Trocar PDF" : "Enviar PDF"}</Button>
            <input ref={golpesProibidosRef} type="file" accept="application/pdf" hidden onChange={onGolpesProibidos} />
            {golpesProibidosPdfNome && <span style={{ fontSize: 12.5, color: rotuloConfig }}>{golpesProibidosPdfNome}</span>}
            {golpesProibidosPdf && <Button variant="ghost" icon={X} onClick={() => { setGolpesProibidosPdf(null); setGolpesProibidosPdfNome(""); }} style={ghostConfig}>Remover</Button>}
          </div>
          <p style={{ fontSize: 11.5, color: rotuloConfig, marginTop: 4 }}>Se enviado, aparece pro aluno na aba "Mais" e também no app do professor, como um link pra abrir o PDF.</p>
        </Field>
        <Field label="Tabela de pesos e categorias (opcional)" labelColor={rotuloConfig}>
          <input style={inputStyle} value={tabelaPesosLink} onChange={(e) => setTabelaPesosLink(e.target.value)} placeholder="Link do site da tabela (ex: site da federação)" />
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
            {tabelaPesosArquivo && tabelaPesosArquivo.startsWith("data:image") && <img src={tabelaPesosArquivo} alt="tabela de pesos" style={{ width: 56, height: 56, borderRadius: 10, objectFit: "cover", border: "1px solid rgba(255,255,255,0.14)" }} />}
            <Button variant="ghost" icon={Camera} onClick={() => tabelaPesosRef.current?.click()} style={ghostConfig}>{tabelaPesosArquivo ? "Trocar imagem/PDF" : "Enviar imagem ou PDF"}</Button>
            <input ref={tabelaPesosRef} type="file" accept="image/*,application/pdf" hidden onChange={onTabelaPesos} />
            {tabelaPesosArquivoNome && <span style={{ fontSize: 12.5, color: rotuloConfig }}>{tabelaPesosArquivoNome}</span>}
            {tabelaPesosArquivo && <Button variant="ghost" icon={X} onClick={() => { setTabelaPesosArquivo(null); setTabelaPesosArquivoNome(""); }} style={ghostConfig}>Remover</Button>}
          </div>
          <p style={{ fontSize: 11.5, color: rotuloConfig, marginTop: 4 }}>Aparece pro aluno e no app do professor. Imagem abre com zoom; PDF e link abrem numa nova aba. Pode usar só o link, só o arquivo, ou os dois. Sem nada, o card não aparece.</p>
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <Field label="Instagram" labelColor={rotuloConfig}><input style={inputStyle} value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="https://instagram.com/..." /></Field>
          <Field label="Facebook" labelColor={rotuloConfig}><input style={inputStyle} value={facebook} onChange={(e) => setFacebook(e.target.value)} placeholder="https://facebook.com/..." /></Field>
          <Field label="WhatsApp" labelColor={rotuloConfig}><input style={inputStyle} value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="https://wa.me/55..." /></Field>
        </div>
        <div><ConfirmButton onConfirm={salvar}>Salvar configurações</ConfirmButton></div>
      </div>
    </Card>
  );
}

/* ---------------- PROFESSOR ---------------- */
const LOGO_TECBM = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHgAAAB1CAYAAACF+iUMAAAopUlEQVR42u19eXScV3n++957v2/2RbIdh5Rsjiw5DktbCRJC4tFYi5fYSSDVHAgNkC648IMQ0oVAaWWFQqGFBppyWqWlgZQljAJZKy+yNBo7OxpoSxZLchISliy2Z9+/e+/7+2NGihzseGYsecG65+TkRJFmvvs9992ed7kAp9IiQugnBgCwak/k7ot+9hPd+vDYt2f/fzjMYXEdsvCUAhcAABFW7Y58h7kd18pU1uJel0FSfTOXOvC3v+i9+teBSL+IBgfkIrSnEsAE2B6bEAcyGW5n+k7e5O9TibgEQAEElliyxND53Hghnvmzn2/YMNlHYT6EIbUILwA7FR6yZdvXzVhHh2WSdZM4Y2mfSsRLAEwAIACiYR18VQJjnfYm9+4VOx54yxCGVPvEhLEI7ykAcPvgoLFv4ydLbbt2bBYu12flgYMWEJoEAAgEBACIQqhsViHQGabXP7ZydPvbYx0dViASEYsq+mQGd2LCiHV0WK1jI1eh0/FDlBbXUhIiQwCqnk8NBAgIAKS1Yk4HV+XSAVD0kenO7nsgHObQF9KAQIsSfBKtQKRfzIDLHOY9UC4zLZUGZEgVswwEBFQ9owQAwDjXhaJGYEuN5uYftUZHvwChkAqMR05b7/qkBLgvHObR4IBs3bX9anQ6fghKE5AmRGRH88YAkYFSJBNxS/h9n125e+zvo8GgrKprPN0APvk2TMQAUS+/806Xf8XZLyDnzbpU1ojIZyW1po0REJAU/iZhxRP/MB3s+XT7xIQRa29XgKgXJfgEgtt2772epgvO2YFCNOtyWQMipzrArUZWAIBCJlOWaGr6q7aHIl+KdXRYgKihv58tAny8V3//LLiwxLcDnY5362JxVnKPQUEZMp2SzGH/9KrH9tyxYmTkHBgY0KcL64UnieQiDA2xFU1NbtMhhtHlulSlkhKRCZqXRyQAIimam4RO535OmXhwcsN7fg6RfgG/5azXSSHBgfFxDqGQMgy8i3k9l6pkygI2X+BWzzGikPFEGW3GeehrHl09MnIOBAdkHxFflOCFBJdIRBHlyvGR/xAOxx+pYlEBoFio7RIpyZ0uAVo9W84k1j7Xc+WLM/H2ogQvAJERRZRtYztuEE7nH6tSiZBoAdknAkQmVD6nkLELDLd/vC0SOe+3mfU6cQCHwzzW0WGtjIx+gvn9X9elkkKtEHDhH4kh4yqXV4h4PjrN3a3jYx+bEysvAnzMajkSERAKqbbI6CcMn+efVS4jSWlGyJFqeODXWEfSACQbsTPIOFeFoiYpzxZ+7zdax0duigaDcnU4bC7a4GNZg4MGbNlirRzbcbHR7H9MZXKSlOaAiLU9cCXNAFoRmgYypwtkOg1ABI1IPxFpxkBzj0+odPovJwNdX6kSIhIQaRHgelY1LGnbds954G7ahYydr2UJADirlcZAQCCSirvdXGfzzxNj32KcD5DWpJVqKG5G0gSIxBxORoX8HXsD3X80l3hZVNE1rD4iDsEBed6Dd58LvqWj6DAv0OUSVIxuHYKilWY2B6ey/CVatH5qzdpbUKlLADHD3W5OpCVWs0s1SzEiEgGqYkGiz3f9qice6j/3nnv8gHjKEyLHB2AiNoSoVoyMnGNvXj7GDL5CZXMSGGN1xbpEGm0mgdZxSGS69vb0TLVMDdueWbP2cdDyjxHoZ9zlEqSVqluRISIQCJlMWdzu2Go/c8noqpEfLYFQSJ3KILPjAS4MDWHL6PAFpss2joKtUNmsQmSizs8BYKiZ281VubB17xVXTLVPDBr7WjeWApGImFzTfTceSHVSqfRT7vNwTaohhgoRDetg3GI22++To3m09f77l0IopNoHB41FgH8TFGyPxTiEQopz81+Yy3m+yuUsYJzX+TkEDCX3eoVMJj49HVx/WyASEbGOLRYAwEyI8/T69fFCMtdFxdKE8PoEkW4MZMYMlU5J7rC/HZf4Rs760Y+WxLZsOSVjZbaQ4AbGx3mso8Nqi45+lbmc661EQgLjRp15IUIGxD0eoZKZm6fWdP9D++CgEQ0GDwEvGgxKCIf5i5s2JWyvxHt0sfy44fUJQJIV8a+HDgEA5MLKZCRz2H/Xe+aSkQtHd6yJBoOy7xRT1wvlRWNf1e62PhT5ivB4/txKJhVCI5khsrjdLlSh+Jmpzu4vH5VWpH4GOKDPveMOu/3Clo8z0/hHnc0p0sRqDcUOdeq05nY7A0MApbMf3ru259unErW5IAAHIhERDQZl2+7RW7nPd6NMJiolrnV+HWltGUuWGCoe3z7Z2b2h5hdLhMAYARG0RkY/JXyef5LZjARNvF6QEQlIk0IugNltXGZyH55e2/Pt9olBY8ZEnE4qGtsnJoxoMChbo6Nf4z7fjTIRlwhM1BO4YMXsWsLnNXQ2EyPi1/WFwzzW3i5rRkVrbB8cNKaCXbeqdPpG7vYI4KiAqL64tlIFxEFaTBWLSnhc31oVHflQrGOL1RcO89mC/NMB4EAkwquFcv8omnyftBIpC5CLuqsxSErD4zF0ofSTbLrQOxUMHhh66imqi1lCpNiWLVb7xKAx2dn9dZVJfkq4PAI5Z/WATFXujBhHUIrpYkmB0/Wttocj1w+FqsX1JzHIOI/gimgwKFtHRt6BHvujZJUJVP0qEYgU97i5LhR+msuWun+5fn0cwmEOocY7FWbLbyM7b2RO1+dJKbculTQyxup9W6gUAeeEDgeDUnl79tevvveXoVDhZGW95gXg9sFBI7Zli9Wyc/gS4fVsByU9JBVQveQwkWJ2OwOlfpJPZHpe3LQpcazgzmXShhBVa3TH+WA4dzBDrFS5rETkoh79gkQzelsxn4/rbG5UpfNX7Nu4sXQygnzsKprCPLZli9UyMvx73OMZIU0+XZZ1gYtVlgo4A+QcZS738Rc3bUrMZJ3mY6NDiCoQiYipwLrnlZXronL5WeFyCSA5m41icHRejRCBGAIBcpVIWtzl7GI+x7Y3h8MOACA4yWLlYwOYiPUNAbSOjLxDeD3/ioK7dbkkoU7VR1oTcAbMZuMylXv/vt6Nj82o/PncbDQYlBCJiGcD639h5VNrddl6tkptWggEuuLe1fDA+BohkkpZ3OkMus5atu3NQ0N2OMnyyngM4CJUzCu1PjT+vHDaz5OpjALG6ot1NREIRsxmMpXJXzvd1fv9hQD3kFVV+y3Dw2/mTd5R7rS3ymRcIjFByKD2zBYBIAJoLZnbLUjrxymb659c27tjwfewoBJc8RoR+vtx1cORu5khzpPpjAW8TnBJEwhO3LShzhbeN93V+/2ZMGtBdx0Kqb5wmO/buPGXxWIyQIXSPwmPXwCCRFL0mv9cg3xU8tBCZTIKAS5Gl+vBlSMjV0SDQdk+ceL5a2wQXIBQiLV94qNDzOd9j0ykFCLw+r6YCDiXzDC5yubeP9XVGz7uDFF/P4OBAQ0A0LZ71xe5z/cZlUxKIBSACK+p7VodMK1AcIbC0DJbes++7u4HTjTrVS/A2D4xKNyZVnrZoB9wj/e9ViJpIaLRwEGxhN9nlA/Er9vXve47q8Nh8+lQqHzc30B/P2vfvLkSv+8Z+TvDv/SvZeIgVQ4yq8O/pmoxgtIoDERhaFlMv2df58YHTqR3XZeKbh8cFLGOLdZLUP6m8DW914rHGwKXiCzR5DdkPPHgvp5132mfmDCeDoWO3yknwsq8j34W6Oxk7kyGApGImLq853MyHv8rZnOUAZmqT1IqEo/IGUhJIMtM2N0/bB3fGTqRhQM1e3szqqZtbOQadDqvlYmExZAZVKe6ICBlNPkNlc3e9/ZgzzVTP5ilIGnBwKxqqvbY7RxiADHEmcNE0aqKntWyKB/R0roTAf6EZuq/amM0YbYckDFGlrS402lg0boWqP9ugD5ddbzUgu21URU9C25kxx8wh2tIWyUCpWGmV7dmcFFLbnMKLeU9k+8OXDObxZuv4rb+fgYXXYR9APDqsmU4Gxq9br1txw5XdskSwbPxs4TT1SsLRScCfQgQGLM5VpKyAMoWACJQQ24KKe6wcyqXX1bLi+fta91YOveOO+wvXH99cU4EQieFBPeFw3yoo8NqGdt+DTqcYS0tDYqAkDGs54QTKW6zC10uJnIvHfwAzLToN2abEIgqLS8AEB0fr3xGVRqH5vzi+Y/uWm63ubyQzro1Yx8kAiwQ9ZmFjEsDczCbzRSGAVQqVj62VNCgCQEZVjzkOsHVWjPT5KB1QZWtD+1r3VhaObpjjfB6vtX28Phdk+/u/GwlRXV8QBZH45eHgkHZNjZyDXM5w1QuESg1Cy7WOhdBa402k4OmHFN01S+feqoEFOaAqOoQC9Yei/FYe4esGjuIAhwinSv3jKww3f5zZDKxCp2u9Tqf11CGNUTWEhICuNsFAAgqnwdSGpAxsBJJC5AQCBkgAQJjhADYCEOgtWamwYCzgk4XNu/rXTd6wci2TuZ2PUBKuYXf/5nWPZHWqV3joWo8zuaLqatfRUciAoJB2Ta6rY053c9oJQksicQY1vPhpLVmNpMBZxmdzG+YWrfu4Qb45UMopnYi48D4ODe5upqjMEmrPjTMN1G51MJ9Hh9JBcB4JQtUKABJWVW3JCuGdk5Ihzg/CRetiNlsCJznrHxh07PBnvELRrdfajidu4i0Q5elAgAlmvymzmTumbwseA0A0Hxx7fUBXP3Sc++5x+9Y6t8BhninLhUVAuNUp75C08aQYQYy2XV7ezY8WjfDU41VV+4eu9jwutepZPpyshmroWwBd7vPQs6BLAtAE5BVBi0tBcCqSrwK5nyB+Ab2B4VQaIisTKWv3te7Mbo63G+qN3WOMYfj3SqbkVAtMiTSUni9ApTcLuOJrdPrNj2+kKwXHk4VAqJuD4d92d85Yyd3ON6p0mkFyDhWh57UCLJGwTUiz+lM/IqpdVc9HKCIiGJdG0Ho78fVnZ1OJSBmnLGsVSYSUDETCGRZCkATAkMCBCTNAF/TMMfLVSWisnHGMtN65aW/nA6u/8rqcNjUv7N8iNntV6pMWgIyQYcefMm9HkFlmdWp1PqpdVc8vFAg4+FYqhW7dnlNl7kDbfaLZTptIWPGb+jJN/gwQgIgkIbfL6z9BzdOda/b1hCjU9UkbZFIJ/PYIiqbKwIyY85XsaPq8wW2bwRkCX+TIRPxf397IPHRJ8aXGXaBdzOv+wqZTEiEI5QHk5Zo2gQg5HQyt2F6w4Y9C8F6sbngBsbHecu2baZh5yPMYbtYZ1KScWbULhFU7QcDSzQ1CZVM3jbV1bs9QBFxLA+umdZAmgDQAABefW72xjHpcZBcICX8fkOmkoNTnT0f+ek2t7Bz+iH3uK6QiaR1RHABAJAJXSppIHJxv3tba2TkslhHhzXfVZuzL6k9FhPRYFAKB7+JezzvUIm0BMYF6HrIOgBCtHhl0/+8N9B9A2zdinWq5cM6pw36tQuolrXkDidX6fS/Tq3p+jMAAO407uJ+30aZTJZrYfiQMUYlSwNpF7Obwy2PPdQ7FAqpfiI2X2VArEpBGrGODmvV+MhNzOv7okpVM0NUSXDXobSU8PsNlUzeNnV51ycDkYiArVuPWaAYw/xJAOncE6eEyy1UofgCf+nAjQAALaPbr2VO59UykbSgHvqWIdOlMpElPYbN3NEaHRscQNSB8fF5KehjM+U2reMjN6HP91WZz0kCLWqtcMPZf7TkdjuXyfhtU4HuGwKRiIh2dqp5CeaJfheQnZB5EzjjVhJoANKglcWcDq7LxZeQCpufDoXKbWPbP2C4Pd9VpbICIlG3tmEMSRPJdFoKv/cjrdHIYDQYlFWQ2bE9PwCsHNv556K56SsqnZKoNSfkWM8LACIlmpq4lUo9MbWm62KoDDbRxwrua/XVI8PM7d2gMhm5cPM7DlmKiKrRlQYEYMzuRNIKmMsJKp//VbGQ7H4heOXe1tGd1zGP805dLGvQGo81JCPSltHcZMh0dnDqss4/mxvZNCTBbdHRzwmv+ysqk1GgiQOwOqsgQaNpoirkf8ZAXwfhMIetW2k+aTgCzON8V6YSERARAUkikgCggSrkOHO5OPd4OHM5Ofd4OXIDVbHwPwj8f6lQvl3lsoEXglfuXTm6/YPM7byTSpYCpXA+4m2GzJDxpCU8ri1tj0RvP/+++5YDom7U+RJot31eZXMaATkwBkj1eaIEpJndLnQ6s2uys2cq0N8volu3ahgYmDd0cTdyasA3rqpWotdCd1XhlxGRcwEAwF0OAYwDFYpApICkAp3N7kTDlFS27mJ282WQVnaqs+fRuZ+9OhI5U5ns66Q0kVIIjM3fCUQ0ZDIpudvzp+ZS/+YLtm3rHtqw4alGYmVBlgRkjIHSGghZPSmyKtMndCajmNv5qbaHxg9GL+v8AgwMHFItcaxGUI9DibP6TwaRlkwYAjlHRARmdzCq0Iqg0uk8cE4qm72P2R0pKJV3aRt/BhWjqWBw72EkHgEAWrZtM/c9/rhVJtllOH1+mUo3VvBwVFeOCZnJSO5wnGn4Pbtadg13RYPBp+sFGVsjo9cxm7gThQCVzylEzuvN8VYfSzOni6lyacI6kNr0/FVXvXJMPCsRwtatuGrjZU1UZI+iYawkq6xrLcdFBOBeL6hU6gAyzGqtM6jZf4HBACSVbIZ1l/R55NNvuTR+OIKlr68PhoaGoK8PYGgIYHYf1T2tGh/Zji53r8znNQIsXDJfK8UcDg4Ar0Aq2b133eYn6yFEEABg1cjIu8Bp3ooOx8UqnbKwmsjHOfOYj8pezYwL9HqFypeeVOns2n0bN+5vGOSqBmgbHW1Dp9irSxYg1lAKV+GFkaRKMK/r/4l4duzJrq5Xj+gThMO8fcUKFnvuOQ19fdW8/Rs4NDPsWnRkDzrdl+l8XsGCAUzVLYHidjsHrfZTudw12dnzs1ppX1EV+UeX3HtvzxlnwA7u9b5Lp9MWVijB6kz1WlQKAiIKmU5b3ON+C3L3aMvwcNe+jRv394XDfKhBSVYAkpctQkSkWvOzjAGAKuz9/Uu+P/fH7YODBrQDuDOtFO3sVFUwVQxA1f/qUWGdWo6owphTzc7Y7EUzXBWLijvsy4CJXS0PjX0sisEf1uJds5nu+INXX52xkrn1Op9/nPt8Bmlp1ds0VnkYZqhMWqJpvlX4nZHzd923fCgUUo0Wg2uuGujrJUAEs31iwjlbfwUAsS1brFjHFisaDFZGJDXq6RMgQO3xaVUOK4MNELFCu9b7XpHrfEEjwhmmz3/3hbvHbwFEfbRB5wygWtZCxPZt3JhW6UKvyuUfE0uXGliNB+u1x4hC6ArIF5kO79i5Dz54ZsOT5Kxiqb4GfSRgDAhgPwBYh8upzIfjRwRW7XwGATAOWlOOiBQaBpJuAGTOGClJ8mDcQp/7b1rHd32xUn89IY40A5vNOSK6vwoyHEj2qkzuB8y0cWSogSqRxtG2ow/hpLlQ2ZxEYa52Lm9+tG185I+iwaCseZjJRRchAIAwXS1oGDDzDDW8SsXsDgCiH8Q6Oqz22O1i3i7k6O9n0NenL3x050pmGr9HhQLVxDQRaGYzAVBPcsArURgWMw0C0qqucU8EQJV0qGElk1I0+T7TtnvXF2MdHRZsHTjssxzygwFEDUQ4efXVmclL17yPiqVPMJebIaKGGgPRQ44BMqHyea0teR7zeL65MjL6p5We3aPfadS+IsGqsncNczmBkFQ9zYqECzD08qKLEBBJWtTMDLOJlKJazQdpDaDR90xn17Aq5K5Gw9TMtHHdyKAYREBCIVMpyV2uz1z4+CPfWDEU9gKi7qNDCRF2mD8mIMLV4bC5N9j9LyqV+TjzuDgw0A3ZDsaYLpe1yma18LpuXzk+9pFYR4e1+sknzdrIdKqoaKqHflnYxU2QJCXVQzlX6tfIgnCYT3f2DlM+3Ysc9wqfTxCR1YCZACAQMpuR6DQ/Zp69/Fur77//nCEMKZgzA5sd4YTQ06FQuX1iwpha2/0Nncl+lLncHDhTAKDqNWmIyIAIVSEnuds5uHLP2EeefstbyrPVhW+scjkRqzRf1/TFC38IVInXWQZUMdqI6ICqwznZuT4iE8n3UdmKCJ/XgEZArhTaC+tA3GIOx9V6qXdsxf33nwOIsze/vaEai3V0WO2Dg8ZkoPvfdDr9Ue52C2YaHJTSWE/xTkWUESRxXSgobpqDbY/s/uzqcNhdBfnIyXuEPFRrOI9Ki1FFqBAAmJ757fZ5B1gwW64ujYJEKASghqcAAKKdnSoQiYjp9Zv/Vz6W2qAL+VHu9xo4o61qZ65net8MK5kuo2FeYC7zj7YMD795Zgb2Ue3U7JyLYO+/qXj6A4RsirndjBqzHQhKcV0sKeH1fEG9acn2tnv/w3O41o4VzzXpluFhGxC8g0olqCUFh0CECEKmUxI0+x4AQOyBB+a9YlFr6zIUvOKx15qQMUxA0PcCVK4wmIkq9n1yY6lYen6TzmbHxNKlNkBUdY71qoRgCKbKZSUI0cKbXONtkV1/EA0GZU2OSKxjiwWRiJjs6vkeJjKdZMlnuNsjtG7EdiAAALcOHCwzt/vdsGzF8NvuvNN1yExIIhwKhZTlcDgQ8DIqlQBr8VYRAQERtCaDKDnfwAaq3RJEugeFAKoLCQJCcM79SSU87WcvBK8vpuPTm2U8cQuaBq+OgGogVmZC57IaAS9gbudQW3Tkc7V7mtV+170bNrzE4y+vpXL5GaO5yQDQVkMNHoimSqYt5nRfVlp53ra37djhglBIzb0kg8v9BED5mp2Zqi+GyKgEhYXLGyPkKqxUfQkEQvabWg8HNBDhS5s/Upi8PNivy6UPM4cDkTMNdcXKM1MHONOFoiSlgIjdXFcoEevYYgGF+dObQi9DKt+lc7l7hdNlEIECaCBxxJghEynJ7fbLi05j5/n33bd8CFEFoNKSosQyrPKOdewRAYiEcyG9LOQc6/8TQE3OIzm1AACrw2FzOtDzbZXJfpjZ7RwFrx1kqmYBldbc4xbasn6uBby9/lix4oazvRs2vCR//D/vU6XS49zl5ABMNeLAImdCplKKGcal5vIlz6zcteM9UazMnSxnMmWop+oPKmEpIWQUOBZsSgAjVap0StT04gkZ4yqXKwrOH6k6WfqNIpfptT3fltnM9Wh3cBCCqJa5XoiVRgO7CaTkzyFvrd13WdezjZEB1evh9t1wgzV5WfASVSr2c5+XA4LViO0AZFwXiwqUbOJe91DL2Mg1EAopj8dzDvDKDmtUhQrdTgCA+57s7n4lEImIeclJV/2CaGenWv3II80EFFCFItR6gwgyxlQ+X7A7vU8cLZaLdXRY7RMTxnRw3bdUOvshZrMxZrMxIlJznMnDWXgNwiAilDqVWDu1bt3zgf5+0TjbU3lxBOEwn7ps7S0yntoqfF4DGSgkgrppfGScLKmpZKHhcQ+17t7ZhaAuET6fm5SWtcWdOMOTzn8wvHUrAiIVczk3MHEBlMswO26nRq2eSDxXk+WIdXRUCJGunjutdL4dlPyp8Hj460c+zYx9QiJCBM1cDk6F0s1T6656PhCJiOjAgDw2Og+RIBTS7RODxtTa7gEdT23lXr8gBElIuoHPYyQtpHIZgdh9gPABlc1CvfM/FnIxITQpZdVdpq2JDIdZ+zupEiLPdnf/hKxMry4W/4d7fIJAyhkZriS1FAFDzT1eIROJv5jq6rl1btXHfPC1FOuoDMveu7Z7QKWTnzP8TQI5Z0QNgMwYklUmROZiDnt3JQau9zkXru+WSqV6r4SYGVdtUyJT19/NzPWaCl55APMHu6lU/in3+ASRklVnkohzxT0eLpOZm6bXrv9qgA4t6Zk3Qn4m5Ti5pvsLOpO8gjT9mjsdjEireilEQoZEmlShqOuVFEQAQjU/IVJ1jkcfhXnLxRcbgUhEMCH03LCkpu0YAhDghdyrPll3MXt1CPnenvcezMfTXVS0YtzrE6SVBRy1cHmESqVvnAp2VST3dVUe815LPjuUNHL/KmbzjSLnZ6lCXgHyBVezCKSZzc50Kb9+MtC7o6564ur4h7mExuGK2y58ePRcrWAfEAoCTUdj2AjAMvw+Q8UTX54M9tzccINZtVRo9fbtzcpj38Zs9neSkqCL+U9NBXq/dqT51fNOBlQT0Easo2Pv+SP/HbS5faPM6XqzzhcUHNNdwLURCqQ1WcL41Rv9Xl84zGdneOzfTzM2b3YP1X+vfmR7s7Its7Ns6nJwOlarXIZpiz4IHAWQhlo7GCqlRlS9US3W2OZCIQXUz57G9fH2wcHLcm9t+1sqy5VTnb1fe6NDsyBsT4Xo7hfR4BVTF0S2Bw27a4w5HGfrQn62EXphECZAzpAXyzPeKvYR8VdhHKMwrgGrMzwOUx92UXT72app2Rl0MPk2dDuCOldQsqw3oEo3k80wmM0EYTSBzucrDed1KT8ETezY/YIq61WdEvQ3lXKkfhbDI2uEBXvZ0eCA7KMwH8L1+1Y+8MC7xFL/fxpLmnutg/HZqs15BpdQGKQtmSeOByESEYAohw7zq6v27OpBg7tUiQhIX8dMY4llybfyUnkJuOyAwgDuE6DzBSClgEplrYolVSG6kdV7hx4CATKany2/lmLFqvl5w89d0D6fIawkEKY3b/7V6nD4/ers5VuFv+kTMpWwANj8znFEZnG/19QH939tX2DdswAALcPDXnTzjcLuXq7zhXeh3fb7ulTSaNrb0DSBmwSkNSABoNags1lNiEBY0FVfnFe1MMNjqBAhRGCa5m+/FWqzpgOz8I1cs7YjFAeAG1btGSXhb7rBSqbKSGTMRz8PEViiyWfKg/HbpgLr/vrcSMRuN/nfk5Yf5KbZjHY7IDJAaQGz2UAVihqLhSoHyrDaQMcqY5DpNYZqXlxQQlAaNLKDJyRuPy7fggMa+vtZIBIRey/v+qROJm8zljSbyCqpvWP8dGU0+Q2dSv7LVKD7hkseecThMPBe7vfeiADNqlDUMp60dD6vVKmsdbGkAYERMAGVDnxOgJyQYb1tO7WpZxQqkwFA9V8AALEHfq1++wCuUpvRzk7VFw7zvYHuG+T++N+iMFLMbkOYjZXrXZWeZJ1M3Da5pusTAADxUnYL93vXyf0HSqQ0VUQXKqMfEBkgsiODuHAdyDSfzWknJcBV2zFUndU8Fez6vC5newAxiTYbn0um1+hTWdzjE7Jc/PHeQPcNAABtkR0fZg7HrTIel4BgW/DxSafAOiE3gA+FQmr1k2FzqnPjj1U2tw4BU8w0OdQEMlbGEDmdhi4WXoBC4UMVcHdez9yeO8iyNGngCKc9ticOYACAp98SKrcPDhrT3eufULlcLwKlmM3gcLRbQ0kp7nQKktaLVjbdM9276ZkKuO7/VMWSIlXpsj/RBbYzRYlIRJWmKvsJeo4TvGbHNOzc2QFe+wgzbX6ZTsvDXj9LpJlpMAJ60cpmup/r3Ty9MrL9T4Xbe7suFhUpzU6oWq7UxuqZ/0AixXw+m06lH3a7/UF3JkPH+x4HdqIBnqkunOztndCpdJCkupd7fWJmruRr/pQmNA0CxIxK5tc+17t5esXOnSu5zXm7KhSJlDye4FIFTlIEJIFIE5FGw0DmdHLmdHLh9gju9dlAyiQh3BHr6LBmadHTSYJn15w+4tY9Y9/nXu/7VCJRYb2ICDgo7vEKlUjdNBXsufXse793lvOM3xkGZG+lcokAkc9Xzftrk/J0NXJCAgIFSDhXszCXC4AxoHIZkAuQ2czLSGyacURQ+tvkdSVENvXEU4H1v5i3iQenLMAzIFfJkdbdke8Kn+dalUiUiDEm3G5DpVJ/ORns/crqBx88Uy/x7kTTfKvM5NS8FQTM5K+RNJAGBpyTYVTGPzjtlZqgVIoAUFeGKesH0O7MQaHwIF/a/Cxm4y8++a7uV37jc08QuCcfwFXTBVu3IgwM6LY94//FlzT9IZVLIJPJv5ju7P3qij17zjGYHmY220Uqm5aAXDSoYxVURyVV20o4s1ccIWYKQC5ApTNARK+SUgngeDdKUAzVdywyCuBwwL5LLvnlYQ9pXx/1AeCr4+MYHR/XJwrckxPgGZCrjnDrnrE/Bq0OTAV67gMAaI3sulssbb5GHthvITMMaqiUE4G73QBU7bpnDHQuBxro/1BpCwi/yTwOCzO5n+fPa3lo6cGd6rB3BYfDPLBsGc7a1r4+DSfegT8FAH69KYTKvRG5bPz7IIxrSCkF1dvEGyj/B9DaAtD3M4fLqQuFJ5nLNgLZQmZvsPexI/1Z+8SgATGA2K/nUI0nUDJ/GwCuvNjBQcPd2koAAC8xleAOh1vlc9UKkQa4Y0TF7HaiYrF/cs3aL/6G5gB47S6I/fsJ+vp0tbWR4BRcpwbdU+lLolW7x3rAMB4gUgZYkgA5o8beuzaXNDMVj3/tmTVdn2oZHrb5zviFPhWubP/tBHgGZETdtnPbOvB67kclTW1ZCpHNSnJ987205P4moRLJWyc7u2+a+x2LVOUJOYqoAxQRk70bdqhsdhMIkWIOJwfSqpKUr1OSCYVKJRVzOj7V9tjuPeduu+c8QNSB/n6xKMEnASHSdu+9Z1Gz9w7hdfeqZMqCusqAaI4XR1J4/UIXS8/r9MGuqXVXPb/QN6EsAny0FekXEByQLcPDNua2PSA83h6ZSEjgtcXE+DoXnUhJ5nQJkvJFnSsHp3t6nmvgApFFFT1vKzggIRzm+zZsKIuXD25S+fw23twkALRE0oBHqW8jqDS7zhY2IRcql1cojHOYyzZ2QWR7SxRPrpu8Ty+AASq1Xlu34tOhUPnM8tiVOpv7b+72COJcVaYB1WeTkTGu8nmFCOcaLu8TbZHRv6hrrteiil6gNTPhbWBAX/jY7usI2Z1UKhHpyuWZ9XvrWqMQjLvcIFOJm6c6e798oi95Pr0Bfo2gQEDUbaMj16LH8V0qWWomhYj1shSkCRirZK9SqZunOru/fKTWkEUVfXxCKAJE3T44aEx29XxP5XLvR5vJkXOqjHGvM4RChqCJq0zG4j7fl1rHd3061lGd0EeEiwCfoDUz8mk6uO4ulSu8H20mY6bJCUk1cGgQtDZUJiWFz/el1j2Rm2MdHRYg0pEGfy6q6OO0ZmzmysiO93GX61bQdKYqlhQ20PyGpAGQabTbGCj1HZnM3XRMg84XJXgeJLmjw+oj4tPBdXexePYiUvpxw+vlQNqq90QTMiAApopFyTyePxR+90jr/fcvhVBInQqs1291belMQd+KcNhnnHXmTua0vVOlUhYw3lDoQ6TLwuM2qVT+Pymxe9+aNfuP53XtiwAfbs3ehXyH37703J3c53uHjMcrN0hj/S+LSEvu8QiVyz3JQF+zXInnosGgAjg504mnR3V4NUu0YmTEZ7psd4LgV+pSWYFSrDJvA+t6WaSVYk4np2JJWWW95LmentTJKsnstAC4Ouj8uZ6e1N5L11xF+fw3uc3kyFFjHXO9KgNmK2loZtgAAb50thA5CIf5yaqmTw+AZ2JlImyfmDAmO3v+ROfzn+QuDwfGdO3D26hyfa7PJ2Q68Xd7A12fi46P65PZmz4tG3hmw6joro8bHu9tMpebuXuQvRG2gCCFz2uoRPqWyWBX/0Jdy74I8Hx42NV0YOv42Me42/ENKpdAl8sakR8yTKPaHA7AuOJeD7cSyVumgz0z4J60ztVpD/BcD7t1ZOQdYOff5Xb7SpnLSpxTa13JG2vJ7A6hioVbpgM9/QEiEUU86cE9vWzw4VZ1XOBUT8+PdQbXQtma4i6PqF43O+MxW4a/SehiaWQ60NMPg4NGFFGeCuAuSvDrCJFV27a9CfyuCBpmm8pmFQAB97i5LpWf0vn0uul44eWTsbh9UYKPsqIz4wI3bHgp90p8rS6VnuY2kzO7g+ti6f+M/cmu6e7Nv4KnnqJTCdzF9fpVLdFpGR5+86o9kV+t2jP24qpt294EAACnaLXl/wd+ou2TzxkZPwAAAABJRU5ErkJggg==";
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
        <img src={logo || LOGO_CIRCULAR} alt="" style={{ width: 200, height: 200, objectFit: "contain", marginBottom: 18, borderRadius: "50%" }} />
        <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 18, color: "#FFFFFF", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>{titulo}</div>
        {subtitulo && <div style={{ fontSize: 12.5, color: "#8F97A8", marginBottom: 20 }}>{subtitulo}</div>}
        <div style={{ textAlign: "left" }}>{children}</div>
        <BotaoInstalarApp />
        <div style={{ marginTop: 40, paddingTop: 18, borderTop: "1px solid rgba(255,255,255,0.08)", fontSize: 10.5, color: "#FFFFFF", opacity: 0.7, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, flexWrap: "wrap" }}>
          <span>Desenvolvido por TECBM - Bruno Martins Tecnologia</span>
          <img src={LOGO_TECBM} alt="" style={{ height: 13, width: "auto", verticalAlign: "middle" }} />
        </div>
        <div style={{ marginTop: 6, fontSize: 10, opacity: 0.6 }}>
          <a href="/privacidade.html" target="_blank" rel="noreferrer" style={{ color: "#8F97A8" }}>Política de Privacidade</a>
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
  const light = useDesktopLight();
  const ghostEscuro = ghostEscuroFallback(light);
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
    { id: "vendas", label: "Vendas" },
    { id: "metodologia", label: "Metodologia" },
    { id: "reuniao", label: "Reunião" },
    { id: "cronometro", label: "Cronômetro", externo: "/cronometro.html" },
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
      if (ordenarPor === "frequencia") return aulasDesdeGraduacao(b, data.checkins) - aulasDesdeGraduacao(a, data.checkins);
      if (ordenarPor === "graduar") {
        const ra = progressoGraduacaoInfo(data.faixas, a.faixaId, a.grau, aulasDesdeGraduacao(a, data.checkins), categoriaEtaria(a.dataNascimento)).restantes;
        const rb = progressoGraduacaoInfo(data.faixas, b.faixaId, b.grau, aulasDesdeGraduacao(b, data.checkins), categoriaEtaria(b.dataNascimento)).restantes;
        if (ra === null && rb === null) return 0;
        if (ra === null) return 1;
        if (rb === null) return -1;
        return ra - rb;
      }
      return a.nome.localeCompare(b.nome);
    });

  const iconesTabs = {
    dashboard: "📊", inicio: "🏠", alunos: "🤼", checkins: "📍", turmas: "📅", financeiro: "💰", relatorios: "📑", avisos: "🔔", videos: "🎬", produtos: "🛍️", vendas: "💵", metodologia: "📋", reuniao: "🎥", cronometro: "⏱️", perfil: "👤",
  };
  const iconesTabsClaro = {
    dashboard: LayoutDashboard, inicio: Home, alunos: Users, checkins: QrCode, turmas: Calendar, financeiro: Wallet,
    relatorios: FileText, avisos: Bell, videos: PlayCircle, produtos: ShoppingBag, vendas: Receipt, metodologia: ClipboardList, reuniao: Video, cronometro: Timer, perfil: User,
  };

  const [refFullBleed, estiloFullBleed] = useFullBleed();

  return (
    <div ref={refFullBleed} style={{
      backgroundImage: light
        ? "none"
        : "radial-gradient(circle at 15% 15%, rgba(201,162,39,0.05), transparent 40%), linear-gradient(160deg, #14171F 0%, #0B0C10 100%)",
      background: light ? LIGHT.paper : undefined,
      minHeight: "calc(100vh - 66px)",
      ...estiloFullBleed,
      position: "relative",
      marginTop: -22,
      marginBottom: -60,
      display: "flex",
      overflow: "hidden",
    }}>
      {!light && <img src={LOGO_FUNDO} alt="" style={{ position: "absolute", width: 420, right: -110, bottom: -70, opacity: 0.05, pointerEvents: "none", zIndex: 0 }} />}
      <div style={{ width: 220, flexShrink: 0, background: light ? LIGHT.surface : "#000", borderRight: light ? `1px solid ${LIGHT.line}` : "1px solid rgba(255,255,255,0.06)", boxSizing: "border-box", zIndex: 1 }}>
        <div style={{ position: "sticky", top: 0, padding: "20px 12px" }}>
          <div style={{ padding: "0 6px 16px", marginBottom: 10, borderBottom: light ? `1px solid ${LIGHT.line}` : "1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ fontFamily: "Oswald", fontWeight: 700, color: light ? LIGHT.ink : "#fff", fontSize: 13, textTransform: "uppercase", letterSpacing: 0.4 }}>{data.academia.nome}</div>
            <div style={{ fontSize: 10.5, color: light ? LIGHT.muted : "#9B9891", marginTop: 2 }}>Área do professor</div>
          </div>
          {tabs.map((t) => {
            const IconeClaro = iconesTabsClaro[t.id];
            const ativo = !t.externo && tab === t.id;
            return (
              <button key={t.id} onClick={() => (t.externo ? window.open(t.externo, "_blank", "noopener") : setTab(t.id))} className={light ? "qg-nav-item" : undefined} style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
                padding: light ? "9px 12px" : "10px 12px", borderRadius: light ? 10 : 8, border: "none", cursor: "pointer", marginBottom: 2,
                position: "relative",
                background: ativo ? (light ? LIGHT.ink : "rgba(201,162,39,0.12)") : "transparent",
                color: ativo ? (light ? "#FFFFFF" : "#C9A227") : (light ? "#5B5645" : "#9B9891"),
                fontSize: 13, fontWeight: ativo ? 700 : 600,
                boxShadow: light && ativo ? "0 6px 16px rgba(18,33,59,0.22)" : "none",
              }}>
                {light && ativo && <span style={{ position: "absolute", left: -12, top: 6, bottom: 6, width: 3, background: LIGHT.gold, borderRadius: "0 3px 3px 0" }} />}
                {light ? (
                  <IconeClaro size={16} strokeWidth={2.2} style={{ flexShrink: 0, color: ativo ? LIGHT.gold : "#8A8371" }} />
                ) : (
                  <span style={{ fontSize: 15, width: 18, textAlign: "center" }}>{iconesTabs[t.id]}</span>
                )}
                {t.label}
                {t.externo && <ExternalLink size={12} strokeWidth={2.2} style={{ flexShrink: 0, marginLeft: "auto", opacity: 0.6 }} />}
              </button>
            );
          })}
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: light ? `1px solid ${LIGHT.line}` : "1px solid rgba(255,255,255,0.08)" }}>
            <Button variant="ghost" icon={LogOut} style={light ? { color: LIGHT.ink, border: `1px solid ${LIGHT.line}`, width: "100%", justifyContent: "center" } : { color: "#F5F3EC", border: "1px solid rgba(255,255,255,0.2)", width: "100%", justifyContent: "center" }} onClick={onSair}>Sair</Button>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, padding: "24px 28px 40px", minWidth: 0, color: light ? LIGHT.text : "#F5F3EC" }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontFamily: "Oswald", fontWeight: light ? 600 : 700, fontSize: light ? 26 : 21, color: light ? LIGHT.ink : "#C9A227", textTransform: light ? "none" : "uppercase" }}>{tabs.find((t) => t.id === tab)?.label}</div>
          <div style={{ fontSize: light ? 13.5 : 12, color: light ? LIGHT.muted : "#9B9891", marginTop: light ? 5 : 2 }}>Logado como professor · {prof.nome} · só os seus alunos vinculados</div>
        </div>

      <div key={light ? tab : undefined} className={light ? "qg-fade-in" : undefined}>
      {tab === "dashboard" && (
        <div>
          <Card dark style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 16, flexWrap: "wrap" }}>
            <Avatar foto={prof.foto} nome={prof.nome} size={76} borderColor={light ? LIGHT.gold : "#C9A227"} />
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: light ? LIGHT.muted : "#9B9891", textTransform: "uppercase", letterSpacing: 0.6 }}>Bem-vindo, professor</div>
              <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 30, color: light ? LIGHT.ink : "#C9A227", lineHeight: 1.15 }}>{prof.nome}</div>
              {prof.faixaId && <div style={{ marginTop: 10 }}><BeltBar faixas={data.faixas} faixaId={prof.faixaId} grau={prof.grau} size="lg" textColor={light ? LIGHT.text : "#F5F3EC"} /></div>}
            </div>
          </Card>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 12, marginBottom: 14 }}>
            <StatCard label="Alunos ativos" value={meusAlunos.filter((a) => a.ativo !== false).length} icon={Users} dark chipBg="#EEF1FA" chipColor="#12213B" />
            <StatCard label="Turmas" value={data.turmas.length} icon={CalendarCheck} dark chipBg="#EEF1FA" chipColor="#12213B" />
            <StatCard label="Check-ins hoje" value={data.checkins.filter((c) => { const al = data.alunos.find((a) => a.id === c.alunoId); return al && al.professorId === prof.id && dataLocalDe(c.dataHora) === hoje(); }).length} icon={QrCode} dark chipBg={LIGHT.goodSoft} chipColor={LIGHT.good} />
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
            <StatCard label="Meus alunos" value={meusAlunos.length} icon={Users} dark chipBg="#EEF1FA" chipColor="#12213B" />
            <StatCard label="Aula ativa" value={sessaoAtiva ? "Sim" : "Não"} icon={CalendarCheck} dark chipBg={LIGHT.goodSoft} chipColor={LIGHT.good} />
          </div>

          <Card style={light ? { marginBottom: 16 } : { marginBottom: 16, background: "#171C27", border: "1px solid rgba(255,255,255,0.07)" }}>
            <div style={light ? blockTitleStyle : { ...blockTitleStyle, color: "#F0EEE8" }}>Aula do dia</div>
            {!sessaoAtiva ? (
              <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
                <div style={{ flex: "0 1 260px", minWidth: 160 }}>
                  <Field label="Selecionar treino" labelColor={light ? LIGHT.muted : "#9B9891"}>
                    <select style={light ? inputStyle : { ...inputStyle, background: "#0F1218", border: "1px solid rgba(255,255,255,0.12)", color: "#F0EEE8", colorScheme: "dark" }} value={turmaId} onChange={(e) => setTurmaId(e.target.value)}>
                      {data.turmas.filter((t) => !t.professorId || t.professorId === prof.id).map((t) => <option key={t.id} value={t.id} style={light ? undefined : { background: "#1A1D24", color: "#F5F3EC" }}>{t.nome} — {t.horario}{t.horarioFim ? ` às ${t.horarioFim}` : ""}</option>)}
                    </select>
                  </Field>
                </div>
                <Button icon={CalendarCheck} variant="gold" onClick={iniciarAula}>Iniciar aula</Button>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 13, color: light ? LIGHT.muted : "#9B9891", marginBottom: 4 }}>Aula ativa — os alunos já podem fazer check-in por localização</div>
                <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8, color: light ? LIGHT.text : "#F0EEE8" }}>{turma?.nome}</div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: light ? LIGHT.text : "#F0EEE8" }}>{checkinsSessao.length} aluno(s) fizeram check-in</div>
                <Button variant="danger" onClick={encerrarSessao}>Encerrar aula</Button>
              </div>
            )}
          </Card>

          <RecadoMestreProfessor data={data} prof={prof} dark />

          <FotoTreinoProfessor prof={prof} dark />

          <AlunosPorFaixaChart alunos={meusAlunos} faixas={data.faixas} titulo="Meus alunos por faixa" dark />

          <AlunosPertoDeGraduar data={data} prof={prof} dark />
        </div>
      )}

      {tab === "alunos" && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
            <div style={{ fontSize: 13, color: light ? LIGHT.muted : "#9B9891" }}>{meusAlunos.length} aluno(s) vinculados a você</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button icon={Users} variant="gold" onClick={() => { setErroRelatorioAlunos(""); if (meusAlunos.length === 0) { setErroRelatorioAlunos("Nenhum aluno vinculado a você ainda."); return; } gerarRelatorioListaAlunos(data, setErroRelatorioAlunos, meusAlunos, prof.nome); }}>Lista de alunos (PDF)</Button>
              <Button icon={Plus} onClick={() => setNovoAluno(true)}>Novo aluno</Button>
            </div>
          </div>
          {erroRelatorioAlunos && <div style={{ marginBottom: 10, fontSize: 12.5, color: "#FF8A80", fontWeight: 600 }}>{erroRelatorioAlunos}</div>}
          {!sessaoAtiva && <p style={{ fontSize: 12, color: light ? LIGHT.muted : "#9B9891", marginTop: 0 }}>Inicie a aula na aba Início para poder marcar presença manualmente.</p>}
          {novoAluno && (
            <PersonForm tipo="aluno" planos={data.planos.filter((p) => !p.professorId || p.professorId === prof.id)} faixas={data.faixas} professores={data.professores} unidadeFixa={(data.unidades || []).find((u) => u.id === prof.unidadeId) || null} turmas={data.turmas} initial={{ professorId: prof.id }} onCancel={() => setNovoAluno(false)} onSave={addAlunoProf} />
          )}
          {editandoAluno && (
            <PersonForm tipo="aluno" planos={data.planos.filter((p) => !p.professorId || p.professorId === prof.id)} faixas={data.faixas} professores={data.professores} unidadeFixa={(data.unidades || []).find((u) => u.id === prof.unidadeId) || null} turmas={data.turmas} initial={editandoAluno} onCancel={() => setEditandoAluno(null)} onSave={(form) => editarAlunoProf(editandoAluno.id, form)} />
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
              const tituloSecaoStyle = { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, color: light ? LIGHT.muted : "#B0AA98", marginBottom: 7 };
              const secaoStyle = { borderTop: light ? `1px solid ${LIGHT.line}` : "1px solid #EFEBDF", paddingTop: 10, marginTop: 10 };
              return (
                <Card dark key={a.id} style={{ padding: 12, opacity: a.ativo === false ? 0.6 : 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }} onClick={() => alternarExpandido(a.id)}>
                    <Avatar foto={a.foto} nome={a.nome} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, color: light ? LIGHT.text : "#F5F3EC" }}>{a.codigo && <span style={{ color: "#C9A227", fontWeight: 700 }}>{formatarCodigoAluno(a.codigo)} · </span>}{a.nome}{a.apelido && <span style={{ fontWeight: 400, color: light ? LIGHT.muted : "#9B9891" }}> "{a.apelido}"</span>}</div>
                      <BeltBar faixas={data.faixas} faixaId={a.faixaId} grau={a.grau} textColor={light ? LIGHT.text : "#F5F3EC"} />
                      {!aberto && (
                        <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                          {!emDia && <Tag ok={false}>Pendente</Tag>}
                          {a.ativo === false && <Tag ok={false}>Acesso desativado</Tag>}
                        </div>
                      )}
                    </div>
                    <div style={{ width: 28, height: 28, borderRadius: "50%", background: light ? LIGHT.paper : "rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transform: aberto ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>
                      <ChevronRight size={15} color={light ? LIGHT.muted : "#9B9891"} />
                    </div>
                  </div>

                  {aberto && (
                    <div>
                      {senhaGeradaAluno?.id === a.id && <div style={{ fontSize: 11, fontWeight: 700, color: "#6FCF7A", marginTop: 10 }}>Nova senha: {senhaGeradaAluno.senha}</div>}

                      <div style={secaoStyle}>
                        <div style={tituloSecaoStyle}>💰 Financeiro — {plano?.nome || "sem plano"}</div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <Tag ok={emDia}>{emDia ? "Em dia" : "Pendente"}</Tag>
                          {!emDia && <DarBaixaControle plano={plano} onConfirmar={(valorProdutos, valorPago, dataPagamento) => darBaixaPagamento(a.id, valorProdutos, valorPago, dataPagamento)} />}
                          {emDia && <DarBaixaControle retroativo plano={plano} onConfirmar={(valorProdutos, valorPago, dataPagamento) => darBaixaPagamento(a.id, valorProdutos, valorPago, dataPagamento)} />}
                          {emDia && (a.pagamentos || []).length > 0 && <Button variant="ghost" onClick={() => desfazerBaixaPagamento(a.id)} style={ghostEscuro}>Desfazer baixa</Button>}
                        </div>
                      </div>

                      <div style={secaoStyle}>
                        <div style={tituloSecaoStyle}>🥋 Graduação</div>
                        <div style={{ fontSize: 11.5, color: light ? LIGHT.muted : "#9B9891", marginBottom: 8 }}>{progressoGraduacaoTexto(data.faixas, a.faixaId, a.grau, aulasDesdeGraduacao(a, data.checkins), categoriaEtaria(a.dataNascimento))} · {aulasDesdeGraduacao(a, data.checkins)} aula(s) desde a última graduação</div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                          {faixaAtual?.grausMax > 0 && <Button variant="ghost" onClick={() => graduar(a.id, "grau")} disabled={a.grau >= faixaAtual.grausMax} style={ghostEscuro}>+1 grau</Button>}
                          <Button variant="ghost" onClick={() => graduar(a.id, "faixa")} disabled={idx >= data.faixas.length - 1} style={ghostEscuro}>Graduar faixa</Button>
                        </div>
                        <AjustarAulasInline onAjustar={(delta) => ajustarAulasManualmente(a.id, delta)} />
                      </div>

                      {sessaoAtiva && (
                        <div style={secaoStyle}>
                          <div style={tituloSecaoStyle}>📍 Presença na aula de hoje</div>
                          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <Tag ok={presente}>{presente ? "Presente" : "Ausente"}</Tag>
                            <Button variant="ghost" onClick={() => alternarPresenca(a.id, presente)} style={ghostEscuro}>{presente ? "Remover presença" : "Marcar presença"}</Button>
                          </div>
                        </div>
                      )}

                      <div style={secaoStyle}>
                        <div style={tituloSecaoStyle}>👤 Conta</div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                          <Button variant="ghost" onClick={() => resetarSenhaAlunoProf(a.id)} style={ghostEscuro}>Redefinir senha</Button>
                          <Button variant="ghost" onClick={() => setEditandoAluno(a)} style={ghostEscuro}>Editar</Button>
                          <Button variant="ghost" onClick={() => baixarJson(`dados-${normalizarTexto(a.nome).replace(/\s+/g, "-")}.json`, dadosExportaveisAluno(a, data))} style={ghostEscuro}>Exportar dados (LGPD)</Button>
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
                              <div style={{ fontSize: 11.5, color: light ? LIGHT.muted : "#9B9891", marginBottom: 8 }}>Sem assinatura registrada (aceito antes dessa funcionalidade existir).</div>
                            )}
                            <Button variant="ghost" onClick={() => gerarDocumentoTermoAssinado(data, a, (msg) => alert(msg))} style={ghostEscuro}>Ver documento assinado</Button>
                          </div>
                        ) : a.termoAssinadoManual ? (
                          <div>
                            <div style={{ fontSize: 12.5, color: light ? LIGHT.muted : "#9B9891", marginBottom: 8 }}>Assinado fisicamente (registrado pela administração).</div>
                            <Button variant="ghost" onClick={() => gerarDocumentoTermoAssinado(data, a, (msg) => alert(msg))} style={ghostEscuro}>Ver documento</Button>
                          </div>
                        ) : (
                          <div style={{ fontSize: 12.5, color: "#FF8A80", fontWeight: 600 }}>Pendente — o aluno ainda não assinou.</div>
                        )}
                      </div>

                      <div style={secaoStyle}>
                        <div style={tituloSecaoStyle}>🩺 Anamnese</div>
                        {a.anamneseEm ? (
                          <div>
                            <div style={{ fontSize: 12.5, color: "#4ADE80", fontWeight: 600, marginBottom: 8 }}>Preenchida em {new Date(a.anamneseEm).toLocaleDateString("pt-BR")}</div>
                            {alertasAnamnese(a.anamnese).length > 0 && (
                              <div style={{ fontSize: 12, color: "#FF8A80", marginBottom: 8, lineHeight: 1.5 }}>
                                ⚠ {alertasAnamnese(a.anamnese).join(" · ")}
                              </div>
                            )}
                            <Button variant="ghost" onClick={() => gerarDocumentoAnamnese(data, a, (msg) => alert(msg))} style={ghostEscuro}>Ver anamnese</Button>
                          </div>
                        ) : (
                          <div style={{ fontSize: 12.5, color: "#FF8A80", fontWeight: 600 }}>Pendente — o aluno ainda não preencheu.</div>
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
          <div style={{ marginTop: 20 }}>
            <PlanosProfessor data={data} save={save} prof={prof} dark />
          </div>
        </div>
      )}

      {tab === "relatorios" && (
        <RelatoriosProfessor data={data} prof={prof} meusAlunos={meusAlunos} />
      )}

      {tab === "avisos" && (
        <div>
          <AvisosProfessor data={data} save={save} prof={prof} dark />
          <GolpesProibidosCard pdf={data.academia.golpesProibidosPdf} pdfNome={data.academia.golpesProibidosPdfNome} />
          <TabelaPesosCard link={data.academia.tabelaPesosLink} arquivo={data.academia.tabelaPesosArquivo} arquivoNome={data.academia.tabelaPesosArquivoNome} />
        </div>
      )}

      {tab === "videos" && <VideosProfessor data={data} save={save} prof={prof} />}

      {tab === "produtos" && <ProdutosProfessor data={data} save={save} prof={prof} />}

      {tab === "vendas" && <VendasProfessor data={data} save={save} prof={prof} />}

      {tab === "metodologia" && <MetodologiaProfessor prof={prof} />}

      {tab === "reuniao" && <SalaReuniaoProfessores data={data} prof={prof} />}

      {tab === "perfil" && (
        <Card dark>
          <div style={light ? blockTitleStyle : { ...blockTitleStyle, color: "#F5F3EC" }}>Meu perfil</div>
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
                <div style={{ fontWeight: 700, fontSize: 15, color: light ? LIGHT.text : "#F5F3EC" }}>{prof.nome}</div>
                <div style={{ fontSize: 12.5, color: light ? LIGHT.muted : "#9B9891" }}>{prof.especialidade || "—"} {prof.email && `· ${prof.email}`} {prof.telefone && `· ${prof.telefone}`}</div>
                {prof.endereco && <div style={{ fontSize: 11.5, color: light ? LIGHT.muted : "#9B9891" }}>{prof.endereco}</div>}
                {prof.faixaId && <div style={{ marginTop: 8 }}><BeltBar faixas={data.faixas} faixaId={prof.faixaId} grau={prof.grau} textColor={light ? LIGHT.text : "#F5F3EC"} /></div>}
                <div style={{ marginTop: 8 }}><Button variant="ghost" onClick={() => setEditandoPerfil(true)} style={ghostEscuro}>Editar meus dados</Button></div>
              </div>
            ) : (
              <div style={{ flex: 1, minWidth: 220, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 8 }}>
                  <Field label="Nome" labelColor={light ? LIGHT.muted : "#9B9891"}><input style={inputStyle} value={nome} onChange={(e) => setNome(e.target.value)} /></Field>
                  <Field label="E-mail" labelColor={light ? LIGHT.muted : "#9B9891"}><input style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
                  <Field label="Telefone" labelColor={light ? LIGHT.muted : "#9B9891"}><input style={inputStyle} value={telefone} onChange={(e) => setTelefone(e.target.value)} /></Field>
                  <Field label="Especialidade" labelColor={light ? LIGHT.muted : "#9B9891"}><input style={inputStyle} value={especialidade} onChange={(e) => setEspecialidade(e.target.value)} /></Field>
                  <Field label="Endereço" labelColor={light ? LIGHT.muted : "#9B9891"}><input style={inputStyle} value={endereco} onChange={(e) => setEndereco(e.target.value)} /></Field>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <ConfirmButton onConfirm={salvarPerfilProf}>Salvar</ConfirmButton>
                  <Button variant="ghost" icon={X} onClick={() => setEditandoPerfil(false)} style={ghostEscuro}>Cancelar</Button>
                </div>
              </div>
            )}
          </div>
        </Card>
      )}
      </div>
      </div>
    </div>
  );
}

function ProfessorLogin({ data }) {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [lembrar, setLembrar] = useState(true);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);

  const entrar = async () => {
    setErro("");
    setCarregando(true);
    definirLembrarSessao(lembrar);
    const { error } = await supabaseAuth.signInWithPassword({ email: email.trim().toLowerCase(), password: senha.trim() });
    if (error) { setErro("E-mail ou senha incorretos."); setCarregando(false); return; }
    const prof = data.professores.find((p) => p.email && p.email.toLowerCase() === email.trim().toLowerCase());
    if (prof && prof.ativo === false) {
      setErro("Seu acesso foi desativado. Fale com a administração da academia.");
      await supabaseAuth.signOut();
    }
    setCarregando(false);
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
        <Button icon={Check} variant="gold" onClick={entrar} disabled={carregando}>Entrar</Button>
      </div>
      <p style={{ fontSize: 11.5, color: "#8A8574", marginTop: 14 }}>Esqueceu a senha? Peça para a administração redefinir no cadastro do professor.</p>
    </LoginPreto>
  );
}

function ProfessorView({ data, save, activeProfId }) {
  const prof = data.professores.find((p) => p.id === activeProfId);
  const handleSair = () => { supabaseAuth.signOut(); };

  // Verifica de tempos em tempos, direto no banco, se o acesso deste professor ainda está ativo —
  // pra derrubar a sessão automaticamente mesmo se ele já estiver logado em outro aparelho quando for desativado.
  useEffect(() => {
    if (!prof || prof.ativo === false) return;
    const verificar = async () => {
      try {
        const linhas = await pg.select("professores", `select=ativo&id=eq.${prof.id}`);
        const ainda = linhas && linhas[0];
        if (!ainda || ainda.ativo === false) handleSair();
      } catch (_) { /* falha de rede não desloga por engano */ }
    };
    const intervalo = setInterval(verificar, 60000);
    return () => clearInterval(intervalo);
  }, [prof?.id, prof?.ativo]);

  if (!prof || prof.ativo === false) return <ProfessorLogin data={data} />;
  if (prof.primeiroAcesso && (data.academia.termoPadrao || data.academia.termoPdf)) return <PrimeiroAcessoTermoProfessor data={data} save={save} prof={prof} />;
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
    const avisosDoProfessor = data.avisos.filter((a) => !a.professorId || a.professorId === prof.id);
    const chaveVistos = `qg-avisos-vistos-prof-${prof.id}`;
    let vistos = [];
    try { vistos = JSON.parse(localStorage.getItem(chaveVistos) || "[]"); } catch (_) {}
    const novos = avisosDoProfessor.filter((a) => !vistos.includes(a.id));
    if (novos.length > 0) {
      if (typeof Notification !== "undefined") {
        const notificar = () => novos.forEach((a) => { try { new Notification(a.titulo, { body: a.mensagem || "", icon: data.academia.logo || undefined }); } catch (_) {} });
        if (Notification.permission === "granted") notificar();
        else if (Notification.permission !== "denied") Notification.requestPermission().then((perm) => { if (perm === "granted") notificar(); });
      }
      try { localStorage.setItem(chaveVistos, JSON.stringify(avisosDoProfessor.map((a) => a.id))); } catch (_) {}
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
    let authPatch = null;
    try {
      authPatch = await sincronizarContaAuth(null, form);
    } catch (e) {
      alert(e.message);
      return;
    }
    // codigo fica null aqui: com RLS, este professor só enxerga os próprios alunos, então
    // calcular o "próximo número" a partir dessa lista parcial colidiria com o de outro
    // professor. Quem preenche é o backfill que roda só em sessão de admin (em carregar()).
    const a = { id: uid(), tipo: "aluno", matricula: hoje(), codigo: null, ultimoPagamento: null, foto: null, pagamentos: [], checkinsDesdeGraduacao: 0, primeiroAcesso: true, termoAceito: false, termoAceitoEm: null, ativo: true, ...form, professorId: prof.id, ...authPatch };
    await save({ ...data, alunos: [...data.alunos, a] });
    setNovoAluno(false);
  };
  const editarAlunoProf = async (id, form) => {
    const anterior = data.alunos.find((a) => a.id === id);
    let authPatch = null;
    try {
      authPatch = await sincronizarContaAuth(anterior, form);
    } catch (e) {
      alert(e.message);
    }
    const alunos = data.alunos.map((a) => (a.id === id ? { ...a, ...form, ...authPatch } : a));
    await save({ ...data, alunos });
    setEditandoAluno(null);
  };
  const resetarSenhaAlunoProf = async (id) => {
    const aluno = data.alunos.find((a) => a.id === id);
    if (!aluno?.authUserId) { alert("Este aluno ainda não tem login real — cadastre um e-mail pra ele primeiro."); return; }
    const nova = randomSenha();
    try {
      await redefinirSenhaAuth(aluno.authUserId, nova);
      setSenhaGeradaAluno({ id, senha: nova });
    } catch (e) {
      alert(`Não foi possível redefinir a senha: ${e.message}`);
    }
  };
  const alternarAtivoAlunoProf = async (id) => {
    const alunos = data.alunos.map((a) => (a.id === id ? { ...a, ativo: a.ativo === false ? true : false } : a));
    await save({ ...data, alunos });
  };
  const removerAlunoProf = async (id) => {
    const aluno = data.alunos.find((a) => a.id === id && a.professorId === prof.id);
    if (!aluno) return;
    const alunos = data.alunos.filter((a) => !(a.id === id && a.professorId === prof.id));
    await save({ ...data, alunos });
    await excluirDadosRelacionadosAluno(id);
    if (aluno.authUserId) await excluirContaAuth(aluno.authUserId);
  };
  const alternarPresenca = async (alunoId, presente) => {
    if (!sessaoAtiva) return;
    if (presente) await removerPresencaEm(data, save, sessaoAtiva.id, alunoId);
    else await marcarPresencaEm(data, save, sessaoAtiva.id, alunoId);
  };
  const ajustarAulasManualmente = async (alunoId, delta) => {
    if (!delta) return;
    const alunos = data.alunos.map((a) => {
      if (a.id !== alunoId) return a;
      // Não deixa o ajuste negativo passar do que o histórico tem (senão "-1" some em cliques que não mudam nada na tela).
      const doHistorico = aulasDesdeGraduacao({ ...a, ajusteAulas: 0 }, data.checkins);
      return { ...a, ajusteAulas: Math.max(-doHistorico, (Number(a.ajusteAulas) || 0) + delta) };
    });
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
        return { ...a, grau: Math.min(a.grau + 1, faixaAtual.grausMax), checkinsDesdeGraduacao: 0, ultimaGraduacaoEm: new Date().toISOString(), ajusteAulas: 0 };
      }
      const proxima = data.faixas[idx + 1];
      if (!proxima) return a;
      return { ...a, faixaId: proxima.id, grau: 0, checkinsDesdeGraduacao: 0, ultimaGraduacaoEm: new Date().toISOString(), ajusteAulas: 0 };
    });
    await save({ ...data, alunos });
  };
  const darBaixaPagamento = (alunoId, valorProdutos, valorPago, dataPagamento) => darBaixaEm(data, save, alunoId, valorProdutos, valorPago, dataPagamento);
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
      <img src={LOGO_FUNDO} alt="" style={{ position: "absolute", width: 320, right: -70, bottom: -50, opacity: 0.06, pointerEvents: "none", zIndex: 0 }} />
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

          <FotoTreinoProfessor prof={prof} dark={true} />

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
            <PersonForm tipo="aluno" planos={data.planos.filter((p) => !p.professorId || p.professorId === prof.id)} faixas={data.faixas} professores={data.professores} unidadeFixa={(data.unidades || []).find((u) => u.id === prof.unidadeId) || null} turmas={data.turmas} initial={{ professorId: prof.id }} onCancel={() => setNovoAluno(false)} onSave={addAlunoProf} />
          )}
          {editandoAluno && (
            <PersonForm tipo="aluno" planos={data.planos.filter((p) => !p.professorId || p.professorId === prof.id)} faixas={data.faixas} professores={data.professores} unidadeFixa={(data.unidades || []).find((u) => u.id === prof.unidadeId) || null} turmas={data.turmas} initial={editandoAluno} onCancel={() => setEditandoAluno(null)} onSave={(form) => editarAlunoProf(editandoAluno.id, form)} />
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
                if (ordenarPor === "frequencia") return aulasDesdeGraduacao(b, data.checkins) - aulasDesdeGraduacao(a, data.checkins);
                if (ordenarPor === "graduar") {
                  const ra = progressoGraduacaoInfo(data.faixas, a.faixaId, a.grau, aulasDesdeGraduacao(a, data.checkins), categoriaEtaria(a.dataNascimento)).restantes;
                  const rb = progressoGraduacaoInfo(data.faixas, b.faixaId, b.grau, aulasDesdeGraduacao(b, data.checkins), categoriaEtaria(b.dataNascimento)).restantes;
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
                      <div style={{ fontWeight: 600, fontSize: 14, color: "#F5F3EC" }}>{a.codigo && <span style={{ color: "#C9A227", fontWeight: 700 }}>{formatarCodigoAluno(a.codigo)} · </span>}{a.nome}{a.apelido && <span style={{ fontWeight: 400, color: "#9B9891" }}> "{a.apelido}"</span>}</div>
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
                          {!emDia && <DarBaixaControle plano={plano} onConfirmar={(valorProdutos, valorPago, dataPagamento) => darBaixaPagamento(a.id, valorProdutos, valorPago, dataPagamento)} />}
                          {emDia && <DarBaixaControle retroativo plano={plano} onConfirmar={(valorProdutos, valorPago, dataPagamento) => darBaixaPagamento(a.id, valorProdutos, valorPago, dataPagamento)} />}
                          {emDia && (a.pagamentos || []).length > 0 && <Button variant="ghost" style={ghostDark} onClick={() => desfazerBaixaPagamento(a.id)}>Desfazer baixa</Button>}
                        </div>
                      </div>

                      <div style={secaoStyle}>
                        <div style={tituloSecaoStyle}>🥋 Graduação</div>
                        <div style={{ fontSize: 11.5, color: "#9B9891", marginBottom: 8 }}>{progressoGraduacaoTexto(data.faixas, a.faixaId, a.grau, aulasDesdeGraduacao(a, data.checkins), categoriaEtaria(a.dataNascimento))} · {aulasDesdeGraduacao(a, data.checkins)} aula(s) desde a última graduação</div>
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
                          <Button variant="ghost" style={ghostDark} onClick={() => baixarJson(`dados-${normalizarTexto(a.nome).replace(/\s+/g, "-")}.json`, dadosExportaveisAluno(a, data))}>Exportar dados (LGPD)</Button>
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

                      <div style={secaoStyle}>
                        <div style={tituloSecaoStyle}>🩺 Anamnese</div>
                        {a.anamneseEm ? (
                          <div>
                            <div style={{ fontSize: 12.5, color: "#4ADE80", fontWeight: 600, marginBottom: 8 }}>Preenchida em {new Date(a.anamneseEm).toLocaleDateString("pt-BR")}</div>
                            {alertasAnamnese(a.anamnese).length > 0 && (
                              <div style={{ fontSize: 12, color: "#FF8A80", marginBottom: 8, lineHeight: 1.5 }}>
                                ⚠ {alertasAnamnese(a.anamnese).join(" · ")}
                              </div>
                            )}
                            <Button variant="ghost" onClick={() => gerarDocumentoAnamnese(data, a, (msg) => alert(msg))} style={{ color: "#F5F3EC", border: "1px solid rgba(255,255,255,0.2)" }}>Ver anamnese</Button>
                          </div>
                        ) : (
                          <div style={{ fontSize: 12.5, color: "#FF8A80", fontWeight: 600 }}>Pendente — o aluno ainda não preencheu.</div>
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
          <div style={{ marginTop: 20 }}>
            <PlanosProfessor data={data} save={save} prof={prof} dark />
          </div>
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
          <div style={{ fontSize: 12.5, color: "#9B9891", marginBottom: 16 }}>Avisos, vídeos, turmas e produtos</div>
          <AvisosProfessor data={data} save={save} prof={prof} dark={true} />
          <div style={{ marginTop: 20 }}>
            <div style={{ ...blockTitleStyle, color: "#F5F3EC" }}>🎬 Vídeos de técnicas</div>
            <VideosProfessor data={data} save={save} prof={prof} />
          </div>
          <div style={{ marginTop: 20 }}>
            <div style={{ ...blockTitleStyle, color: "#F5F3EC" }}>📅 Minhas turmas</div>
            <TurmasProfessor data={data} save={save} prof={prof} />
          </div>
          <div style={{ marginTop: 20 }}>
            <div style={{ ...blockTitleStyle, color: "#F5F3EC" }}>🛍️ Produtos à venda</div>
            <ProdutosProfessor data={data} save={save} prof={prof} />
          </div>
          <div style={{ marginTop: 20 }}>
            <div style={{ ...blockTitleStyle, color: "#F5F3EC" }}>💵 Vendas de produtos</div>
            <VendasProfessor data={data} save={save} prof={prof} />
          </div>
          <div style={{ marginTop: 20 }}>
            <MetodologiaProfessor prof={prof} />
          </div>
          <div style={{ marginTop: 20 }}>
            <SalaReuniaoProfessores data={data} prof={prof} />
          </div>
          <div style={{ marginTop: 20 }}>
            <GolpesProibidosCard pdf={data.academia.golpesProibidosPdf} pdfNome={data.academia.golpesProibidosPdfNome} />
            <TabelaPesosCard link={data.academia.tabelaPesosLink} arquivo={data.academia.tabelaPesosArquivo} arquivoNome={data.academia.tabelaPesosArquivoNome} />
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
function AlunoLogin({ data }) {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [lembrar, setLembrar] = useState(true);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [modoRecuperar, setModoRecuperar] = useState(false);
  const [emailRecuperar, setEmailRecuperar] = useState("");
  const [msgRecuperar, setMsgRecuperar] = useState("");
  const [enviandoRecuperar, setEnviandoRecuperar] = useState(false);

  const entrar = async () => {
    setErro("");
    setCarregando(true);
    definirLembrarSessao(lembrar);
    const { error } = await supabaseAuth.signInWithPassword({ email: email.trim().toLowerCase(), password: senha.trim() });
    if (error) { setErro("E-mail ou senha incorretos."); setCarregando(false); return; }
    const aluno = data.alunos.find((a) => a.email && a.email.toLowerCase() === email.trim().toLowerCase());
    if (aluno && aluno.ativo === false) {
      setErro("Seu acesso foi desativado. Fale com a administração da academia.");
      await supabaseAuth.signOut();
    }
    setCarregando(false);
  };

  const enviarRecuperacao = async () => {
    setMsgRecuperar("");
    if (!emailRecuperar.trim()) { setMsgRecuperar("Digite seu e-mail."); return; }
    setEnviandoRecuperar(true);
    const { error } = await supabaseAuth.resetPasswordForEmail(emailRecuperar.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/alunos.html`,
    });
    setEnviandoRecuperar(false);
    setMsgRecuperar(error ? `Não foi possível enviar: ${error.message}` : "Se esse e-mail tiver uma conta, enviamos um link pra você criar uma senha nova. Confira sua caixa de entrada (e o spam).");
  };

  if (modoRecuperar) {
    return (
      <LoginPreto logo={data.academia.logo} titulo="Área do aluno" subtitulo="Recuperar senha">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#C9C4B4", textTransform: "uppercase", letterSpacing: 0.4 }}>Seu e-mail cadastrado</span>
            <input style={inputStyleDark} value={emailRecuperar} onChange={(e) => setEmailRecuperar(e.target.value)} onKeyDown={(e) => e.key === "Enter" && enviarRecuperacao()} />
          </label>
          {msgRecuperar && <div style={{ fontSize: 12.5, color: msgRecuperar.startsWith("Não") ? "#FF8A80" : "#4ADE80", fontWeight: 600 }}>{msgRecuperar}</div>}
          <Button icon={Check} variant="gold" onClick={enviarRecuperacao} disabled={enviandoRecuperar}>Enviar link de recuperação</Button>
          <Button variant="ghost" style={ghostEscuroFallback(false)} onClick={() => { setModoRecuperar(false); setMsgRecuperar(""); }}>Voltar ao login</Button>
        </div>
      </LoginPreto>
    );
  }

  return (
    <LoginPreto logo={data.academia.logo} titulo="Área do aluno" subtitulo="Faça login para acessar sua área">
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
        <Button icon={Check} variant="gold" onClick={entrar} disabled={carregando}>Entrar</Button>
        <button type="button" onClick={() => { setModoRecuperar(true); setEmailRecuperar(email); }} style={{ background: "none", border: "none", color: "#C9C4B4", fontSize: 12.5, textDecoration: "underline", cursor: "pointer", padding: 0, textAlign: "center" }}>Esqueci minha senha</button>
      </div>
      <p style={{ fontSize: 11.5, color: "#8A8574", marginTop: 14 }}>Não tem acesso ainda? Peça ao professor ou à administração para cadastrar.</p>
    </LoginPreto>
  );
}

/* Tela mostrada quando a pessoa chega pelo link de "esqueci minha senha" (e-mail do Supabase) —
   o link já autentica pra permitir a troca, mas não pode cair direto no dashboard sem definir a
   senha nova antes. Serve pra aluno, professor ou admin, já que os três usam o mesmo Supabase Auth. */
function RedefinirSenhaRecuperacao({ logo, onFinalizado }) {
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [msg, setMsg] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [feito, setFeito] = useState(false);

  const salvar = async () => {
    setMsg("");
    if (novaSenha.trim().length < 6) { setMsg("A senha precisa ter pelo menos 6 caracteres."); return; }
    if (novaSenha.trim() !== confirmar.trim()) { setMsg("As senhas não coincidem."); return; }
    setSalvando(true);
    const { error } = await supabaseAuth.updateUser({ password: novaSenha.trim() });
    setSalvando(false);
    if (error) { setMsg(`Não foi possível salvar: ${error.message}`); return; }
    setFeito(true);
    await supabaseAuth.signOut();
  };

  return (
    <LoginPreto logo={logo} titulo="Nova senha" subtitulo={feito ? undefined : "Defina sua nova senha de acesso"}>
      {feito ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 13, color: "#4ADE80", fontWeight: 600 }}>Senha alterada com sucesso! Faça login novamente com a senha nova.</div>
          <Button icon={Check} variant="gold" onClick={onFinalizado}>Ir para o login</Button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#C9C4B4", textTransform: "uppercase", letterSpacing: 0.4 }}>Nova senha</span>
            <input type="password" style={inputStyleDark} value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#C9C4B4", textTransform: "uppercase", letterSpacing: 0.4 }}>Confirmar nova senha</span>
            <input type="password" style={inputStyleDark} value={confirmar} onChange={(e) => setConfirmar(e.target.value)} onKeyDown={(e) => e.key === "Enter" && salvar()} />
          </label>
          {msg && <div style={{ fontSize: 12.5, color: "#FF8A80", fontWeight: 600 }}>{msg}</div>}
          <Button icon={Check} variant="gold" onClick={salvar} disabled={salvando}>Salvar nova senha</Button>
        </div>
      )}
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

function PrimeiroAcessoTermoProfessor({ data, save, prof }) {
  const [aceito, setAceito] = useState(false);
  const [assinatura, setAssinatura] = useState(null);
  const confirmar = async () => {
    if (!aceito || !assinatura) return;
    const professores = data.professores.map((p) => (p.id === prof.id ? { ...p, termoAceito: true, termoAceitoEm: new Date().toISOString(), primeiroAcesso: false, assinaturaTermo: assinatura } : p));
    await save({ ...data, professores });
  };
  return (
    <div style={{ maxWidth: 480, margin: "20px auto", padding: "0 20px", boxSizing: "border-box" }}>
      <SectionTitle sub={`Bem-vindo(a), ${prof.nome}! Antes de continuar, leia o termo abaixo.`}>Primeiro acesso</SectionTitle>
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
        <p style={{ fontSize: 11, color: "#8A8574", margin: "6px 0 12px" }}>Sua assinatura fica registrada com o termo.</p>
        <Button icon={Check} variant="gold" disabled={!aceito || !assinatura} onClick={confirmar}>Continuar</Button>
      </Card>
    </div>
  );
}

function PrimeiroAcessoAnamnese({ data, save, aluno }) {
  const [respostas, setRespostas] = useState({});
  const [aceito, setAceito] = useState(false);
  const [assinatura, setAssinatura] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const responder = (id, valor) => setRespostas((r) => ({ ...r, [id]: valor }));

  const faltando = ANAMNESE_PERGUNTAS.some((q) => !respostas[q.id] || (q.detalhe && q.detalheQuando.includes(respostas[q.id]) && !(respostas[q.detalhe.id] || "").trim()));
  const podeEnviar = !faltando && aceito && assinatura && !salvando;

  const confirmar = async () => {
    if (!podeEnviar) return;
    // Só guarda o texto de "Se sim, ..." quando a resposta pede — se o aluno digitou e depois trocou pra "Não", descarta.
    const limpas = {};
    ANAMNESE_PERGUNTAS.forEach((q) => {
      limpas[q.id] = respostas[q.id];
      if (q.detalhe && q.detalheQuando.includes(respostas[q.id])) limpas[q.detalhe.id] = respostas[q.detalhe.id].trim();
    });
    setSalvando(true);
    const alunos = data.alunos.map((a) => (a.id === aluno.id ? { ...a, anamnese: { respostas: limpas, declaracaoAceita: true, assinatura }, anamneseEm: new Date().toISOString() } : a));
    try { await save({ ...data, alunos }); } finally { setSalvando(false); }
  };

  return (
    <div style={{ maxWidth: 480, margin: "20px auto", padding: "0 20px", boxSizing: "border-box" }}>
      <SectionTitle sub={`${aluno.nome}, responda o questionário de saúde abaixo. Ele fica salvo no seu cadastro e disponível para o seu professor.`}>Anamnese</SectionTitle>
      <Card>
        {ANAMNESE_PERGUNTAS.map((q) => (
          <div key={q.id} style={{ borderBottom: "1px solid #EFEBDF", paddingBottom: 12, marginBottom: 12 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: "#1B2027", marginBottom: 6 }}>{q.texto}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px" }}>
              {q.opcoes.map(([valor, rotulo]) => (
                <label key={valor} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                  <input type="radio" name={`anamnese-${q.id}`} checked={respostas[q.id] === valor} onChange={() => responder(q.id, valor)} />
                  {rotulo}
                </label>
              ))}
            </div>
            {q.detalhe && q.detalheQuando.includes(respostas[q.id]) && (
              <div style={{ marginTop: 8 }}>
                <Field label={q.detalhe.texto}>
                  <input style={inputStyle} value={respostas[q.detalhe.id] || ""} onChange={(e) => responder(q.detalhe.id, e.target.value)} />
                </Field>
              </div>
            )}
          </div>
        ))}
        <p style={{ fontSize: 12.5, color: "#5A5648", lineHeight: 1.55, margin: "0 0 10px" }}>{ANAMNESE_DECLARACAO}</p>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, marginBottom: 12 }}>
          <input type="checkbox" checked={aceito} onChange={(e) => setAceito(e.target.checked)} style={{ marginTop: 3 }} />
          Li e concordo com os termos apresentados.
        </label>
        <Field label="Assine com o dedo abaixo">
          <SignaturePad onChange={setAssinatura} />
        </Field>
        {faltando && <p style={{ fontSize: 11.5, color: "#B3401E", margin: "6px 0 0" }}>Responda todas as perguntas (e o campo "Se sim" quando marcar Sim) para continuar.</p>}
        <div style={{ marginTop: 12 }}>
          <Button icon={Check} variant="gold" disabled={!podeEnviar} onClick={confirmar}>{salvando ? "Salvando..." : "Enviar anamnese"}</Button>
        </div>
      </Card>
    </div>
  );
}

function AlunoView({ data, save, activeAlunoId }) {
  const aluno = data.alunos.find((a) => a.id === activeAlunoId);
  const handleSair = () => { supabaseAuth.signOut(); };

  // Mesma lógica do professor: confere no banco de tempos em tempos se o acesso continua ativo,
  // pra derrubar a sessão automaticamente se o aluno for desativado enquanto já está logado.
  useEffect(() => {
    if (!aluno || aluno.ativo === false) return;
    const verificar = async () => {
      try {
        const linhas = await pg.select("alunos", `select=ativo&id=eq.${aluno.id}`);
        const ainda = linhas && linhas[0];
        if (!ainda || ainda.ativo === false) handleSair();
      } catch (_) { /* falha de rede não desloga por engano */ }
    };
    const intervalo = setInterval(verificar, 60000);
    return () => clearInterval(intervalo);
  }, [aluno?.id, aluno?.ativo]);

  if (!aluno || aluno.ativo === false) return <AlunoLogin data={data} />;
  if (aluno.primeiroAcesso && (data.academia.termoPadrao || data.academia.termoPdf)) return <PrimeiroAcessoTermo data={data} save={save} aluno={aluno} />;
  if (!aluno.anamneseEm) return <PrimeiroAcessoAnamnese data={data} save={save} aluno={aluno} />;
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
  const [fotosTreino, setFotosTreino] = useState([]);

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

  useEffect(() => {
    if (!aluno.professorId) return;
    let cancelado = false;
    (async () => {
      try {
        const limite = new Date(Date.now() - 5 * 86400000).toISOString();
        const linhas = await pg.select("fotos_treino", `professor_id=eq.${aluno.professorId}&criado_em=gte.${limite}&order=criado_em.desc`);
        if (!cancelado) setFotosTreino((linhas || []).map((f) => ({ id: f.id, fotoUrl: f.foto_url, criadoEm: f.criado_em })));
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
    const avisosDoAluno = data.avisos.filter((a) => !a.professorId || a.professorId === aluno.professorId);
    const chaveVistos = `qg-avisos-vistos-${aluno.id}`;
    let vistos = [];
    try { vistos = JSON.parse(localStorage.getItem(chaveVistos) || "[]"); } catch (_) {}
    const novos = avisosDoAluno.filter((a) => !vistos.includes(a.id));
    if (novos.length > 0) {
      if (typeof Notification !== "undefined") {
        const notificar = () => novos.forEach((a) => { try { new Notification(a.titulo, { body: a.mensagem || "", icon: data.academia.logo || undefined }); } catch (_) {} });
        if (Notification.permission === "granted") notificar();
        else if (Notification.permission !== "denied") Notification.requestPermission().then((perm) => { if (perm === "granted") notificar(); });
      }
      try { localStorage.setItem(chaveVistos, JSON.stringify(avisosDoAluno.map((a) => a.id))); } catch (_) {}
    }
  }, [data.avisos, aluno.id]);

  const alterarSenha = async () => {
    setMsgSenha("");
    if (!novaSenha.trim()) { setMsgSenha("Digite a nova senha."); return; }
    if (novaSenha.trim() !== confirmarSenha.trim()) { setMsgSenha("As senhas novas não coincidem."); return; }
    const { error: erroReauth } = await supabaseAuth.signInWithPassword({ email: aluno.email, password: senhaAtual.trim() });
    if (erroReauth) { setMsgSenha("Senha atual incorreta."); return; }
    const { error: erroUpdate } = await supabaseAuth.updateUser({ password: novaSenha.trim() });
    if (erroUpdate) { setMsgSenha(`Não foi possível alterar a senha: ${erroUpdate.message}`); return; }
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
  const [checkinEmAndamento, setCheckinEmAndamento] = useState(false);

  const registrarCheckin = async (sessao) => {
    const jaFez = data.checkins.some((c) => c.sessaoId === sessao.id && c.alunoId === aluno.id);
    if (jaFez) { setMsg("Você já fez check-in nesta aula."); return; }
    const checkin = { id: uid(), sessaoId: sessao.id, alunoId: aluno.id, dataHora: new Date().toISOString() };
    await save({ ...data, checkins: [...data.checkins, checkin] });
    setMsg("Check-in confirmado! Bom treino 🥋");
  };

  // Trava única pra tela inteira de check-in: sem ela, um toque duplo (ou um segundo toque de
  // impaciência enquanto o pedido de localização/gravação ainda está em andamento) disparava
  // registrarCheckin duas vezes antes do primeiro terminar — como a checagem "jaFez" lá dentro
  // só enxerga o estado local (que ainda não tinha sido atualizado com o primeiro check-in),
  // as duas chamadas passavam e criavam duas linhas de check-in (e incrementavam o contador de
  // aulas duas vezes) pro mesmo treino.
  const fazerCheckinLocalizacao = () => {
    if (checkinEmAndamento) return;
    setMsg("");
    const local = localCheckinDe(aluno, data);

    if (!local.exigeLocalizacao) {
      if (!aluno.professorId) { setMsg("Você ainda não tem um professor vinculado — peça para a administração te vincular no cadastro."); return; }
      const sessao = aluno.turmaId
        ? data.sessoes.find((s) => s.ativa && s.treinoId === aluno.turmaId)
        : data.sessoes.find((s) => s.ativa && s.professorId === aluno.professorId && !turmasPrivadasIds.has(s.treinoId));
      if (!sessao) { setMsg(aluno.turmaId ? "Seu professor ainda não abriu a sua aula particular agora." : "Seu professor ainda não abriu uma aula agora — peça para ele iniciar antes do check-in."); return; }
      setCheckinEmAndamento(true);
      registrarCheckin(sessao).finally(() => setCheckinEmAndamento(false));
      return;
    }

    const proximaId = aluno.turmaId || proximaTurmaId(turmasGeraisDaUnidade);
    if (!proximaId) { setMsg("Não há nenhum treino na grade de horários agora."); return; }
    const sessao = data.sessoes.find((s) => s.ativa && s.treinoId === proximaId);

    if (local.latitude == null || local.longitude == null) { setMsg(`A administração ainda não configurou a localização de ${local.nome}.`); return; }
    if (!navigator.geolocation) { setMsg("Seu navegador não suporta localização."); return; }
    setBuscandoLocal(true);
    setCheckinEmAndamento(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setBuscandoLocal(false);
        const dist = distanciaMetros(pos.coords.latitude, pos.coords.longitude, local.latitude, local.longitude);
        if (dist > local.raioCheckin) { setMsg(`Você está a ${Math.round(dist)}m de ${local.nome} — precisa estar a até ${local.raioCheckin}m para o check-in por localização.`); setCheckinEmAndamento(false); return; }
        if (!sessao) { setMsg("O check-in libera apenas para o seu próximo treino da grade — peça para o professor iniciar a aula certa."); setCheckinEmAndamento(false); return; }
        await registrarCheckin(sessao);
        setCheckinEmAndamento(false);
      },
      () => { setBuscandoLocal(false); setCheckinEmAndamento(false); setMsg("Não foi possível obter sua localização. Verifique a permissão do navegador."); }
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
      <img src={LOGO_FUNDO} alt="" style={{ position: "absolute", width: 320, right: -70, bottom: -50, opacity: 0.06, pointerEvents: "none", zIndex: 0 }} />
      <div ref={pagerRef} onScroll={aoRolarPaginas} className="qg-sem-barra" style={{ flex: 1, display: "flex", overflowX: "auto", overflowAnchor: "none", scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch", touchAction: "pan-x", position: "relative", zIndex: 1 }}>

        {/* PÁGINA 1 — PERFIL & CHECK-IN */}
        <div className="qg-sem-barra" style={{ flex: "0 0 100%", width: "100%", boxSizing: "border-box", scrollSnapAlign: "start", scrollSnapStop: "always", overflowY: "auto", touchAction: "pan-y", padding: "20px 20px 24px" }}>
          {recadosPendentes.length > 0 && (
            <RecadoMestreAluno recado={recadosPendentes[0]} aluno={aluno} nomeProfessor={nomeProfessorRecado} onVisto={marcarRecadoVisto} />
          )}
          <FotosTreinoAluno fotos={fotosTreino} nomeProfessor={nomeProfessorRecado} />
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
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#C9A227", textTransform: "uppercase", letterSpacing: 0.5 }}>Área do aluno{aluno.codigo ? ` · ${formatarCodigoAluno(aluno.codigo)}` : ""}</div>
                    <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 18, color: "#fff" }}>{aluno.nome}{aluno.apelido && <span style={{ fontWeight: 400 }}> "{aluno.apelido}"</span>}</div>
                    <div style={{ fontSize: 12, color: "#B8B2A0", marginTop: 2 }}>
                      {aluno.email || "sem e-mail"}{professorVinculadoNome ? ` · Prof. ${professorVinculadoNome}` : ""}
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: 16 }}><BeltBar faixas={data.faixas} faixaId={aluno.faixaId} grau={aluno.grau} size="lg" textColor="#FFFFFF" /></div>

                <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 10, marginTop: 14 }}>
                  <StatTile numero={meusCheckins.length} label="check-ins registrados" />
                  <StatTile
                    numero={faixaAtual?.aulasPorGrau ? Math.max(0, faixaAtual.aulasPorGrau - aulasDesdeGraduacao(aluno, data.checkins)) : "—"}
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
              <ActionPill variant="primary" onClick={fazerCheckinLocalizacao} disabled={checkinEmAndamento} corFundo={faixaAtual?.cor} corTexto={faixaAtual?.texto}>{buscandoLocal ? "Localizando…" : checkinEmAndamento ? "Enviando…" : "📍 Fazer check-in"}</ActionPill>
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
            <EvolucaoFaixas faixas={data.faixas} faixaId={aluno.faixaId} grau={aluno.grau} checkinsDesdeGraduacao={aulasDesdeGraduacao(aluno, data.checkins)} categoria={categoriaEtaria(aluno.dataNascimento)} />
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

          <SobreEquipeAluno texto={data.academia.sobreEquipe} nomeEquipe={data.academia.nome} />

          <RegrasTatameAluno imagem={data.academia.regrasTatame} />

          <GolpesProibidosCard pdf={data.academia.golpesProibidosPdf} pdfNome={data.academia.golpesProibidosPdfNome} />
          <TabelaPesosCard link={data.academia.tabelaPesosLink} arquivo={data.academia.tabelaPesosArquivo} arquivoNome={data.academia.tabelaPesosArquivoNome} />

          {(data.academia.instagram || data.academia.facebook || data.academia.whatsapp) && (
            <Card style={{ marginBottom: 14, background: "#1A1D24", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ ...blockTitleStyle, color: "#F5F3EC" }}>Contatos {MARCA.nomeEquipe}</div>
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

          <Card style={{ marginBottom: 14, padding: 14, background: "#1A1D24", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div style={{ fontWeight: 700, fontSize: 12.5, color: "#F5F3EC", textTransform: "uppercase", marginBottom: 8 }}>Meus dados (LGPD)</div>
            <p style={{ fontSize: 12, color: "#9B9891", margin: "0 0 10px" }}>Baixe uma cópia de todos os seus dados guardados pelo sistema, ou peça a exclusão da sua conta e do seu histórico.</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button variant="ghost" style={{ color: "#FFFFFF", border: "1px solid rgba(255,255,255,0.2)" }} onClick={() => baixarJson(`meus-dados-${normalizarTexto(aluno.nome).replace(/\s+/g, "-")}.json`, dadosExportaveisAluno(aluno, data))}>Baixar meus dados</Button>
              {data.academia.whatsapp && (
                <a href={data.academia.whatsapp} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", fontSize: 12.5, fontWeight: 600, color: "#FF8A80" }}>Solicitar exclusão da minha conta</a>
              )}
            </div>
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
