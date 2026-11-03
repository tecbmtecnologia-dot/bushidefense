// Aviso de "nova versão do app".
//
// No celular o app instalado (PWA) fica dias aberto em segundo plano: ao voltar pra ele o sistema
// só "acorda" a página antiga, sem recarregar — então quem não fecha o app de verdade continua
// com o código de antes do último deploy (foi assim que o professor principal ficou sem os cards
// dos PDFs). Aqui, sempre que o app volta pra tela (e a cada 15 min), relemos a página no
// servidor e comparamos o script principal (o nome muda a cada build). Se mudou, aparece uma
// faixa "Atualizar" — não recarrega sozinho pra não perder um formulário pela metade.

const INTERVALO_MS = 15 * 60 * 1000;

function scriptAtual() {
  const s = document.querySelector('script[type="module"][src*="/assets/"]');
  return s ? new URL(s.getAttribute("src"), location.href).pathname : null;
}

let avisado = false;

function mostrarAviso() {
  if (avisado) return;
  avisado = true;
  const faixa = document.createElement("div");
  faixa.setAttribute("role", "status");
  faixa.style.cssText =
    "position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));z-index:99999;" +
    "display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:12px;" +
    "background:#1A1D24;color:#F5F3EC;box-shadow:0 6px 24px rgba(0,0,0,.35);" +
    "font:600 14px/1.3 system-ui,-apple-system,sans-serif;max-width:520px;margin:0 auto;";
  const texto = document.createElement("span");
  texto.textContent = "Tem uma versão nova do app.";
  texto.style.flex = "1";
  const botao = document.createElement("button");
  botao.type = "button";
  botao.textContent = "Atualizar";
  botao.style.cssText =
    "border:0;border-radius:8px;padding:8px 14px;background:#C9A227;color:#111;font:700 14px system-ui,sans-serif;cursor:pointer;";
  botao.onclick = () => location.reload();
  faixa.append(texto, botao);
  document.body.appendChild(faixa);
}

async function verificar() {
  if (avisado || document.visibilityState !== "visible") return;
  const atual = scriptAtual();
  if (!atual) return;
  try {
    const res = await fetch(location.pathname, { cache: "no-store" });
    if (!res.ok) return;
    const html = await res.text();
    const m = html.match(/<script[^>]*type="module"[^>]*src="([^"]*\/assets\/[^"]+)"/);
    if (!m) return;
    const novo = new URL(m[1], location.href).pathname;
    if (novo !== atual) mostrarAviso();
  } catch (_) { /* sem internet: tenta de novo na próxima */ }
}

export function vigiarNovaVersao() {
  if (!import.meta.env.PROD) return;
  document.addEventListener("visibilitychange", verificar);
  window.addEventListener("focus", verificar);
  setInterval(verificar, INTERVALO_MS);
}
