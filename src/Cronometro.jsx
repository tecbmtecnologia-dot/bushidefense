import { useState, useEffect, useRef, useCallback } from "react";
import { pg } from "./supabaseClient.js";

// Cronômetro de treino: página standalone (fora do login), pensada pra ficar aberta numa TV do
// tatame. Só lê a tabela pública "academia" (nome/logo) pra se personalizar — não depende de
// nenhuma sessão de professor/aluno.

const CONFIG_KEY = "qg-cronometro-config";
const CONFIG_PADRAO = { rounds: 5, roundMin: 3, roundSeg: 0, descansoMin: 1, descansoSeg: 0, preparoSeg: 10, logoCustom: null, nomeCustom: "" };

function carregarConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) return { ...CONFIG_PADRAO, ...JSON.parse(raw) };
  } catch (_) {}
  return CONFIG_PADRAO;
}

function salvarConfig(cfg) {
  try { localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg)); } catch (_) {}
}

function mmss(totalSeg) {
  const s = Math.max(0, Math.round(totalSeg));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

// Mesmo bipe curto da contagem (triângulo, decaimento rápido) — sem depender de nenhum arquivo
// de áudio externo. `duracao` curta toca só uma vez (usado na contagem regressiva); `duracao`
// mais longa repete esse mesmo bipe sem parar até preencher o tempo pedido (usado quando uma
// fase termina, pra soar como um apito contínuo em vez de um som parado só).
function useApito() {
  const ctxRef = useRef(null);
  const getCtx = () => {
    if (!ctxRef.current) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        ctxRef.current = new AC();
      } catch (_) { return null; }
    }
    if (ctxRef.current.state === "suspended") { try { ctxRef.current.resume(); } catch (_) {} }
    return ctxRef.current;
  };

  const tocarNota = useCallback((ctx, freq, t0, duracaoNota, volume) => {
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, t0);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(volume, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duracaoNota);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duracaoNota + 0.02);
  }, []);

  return useCallback((duracao, atraso = 0, volume = 0.7, freq = 1400) => {
    const ctx = getCtx();
    if (!ctx) return;
    const t0 = ctx.currentTime + atraso;

    if (duracao <= 0.35) {
      tocarNota(ctx, freq, t0, Math.min(duracao, 0.22), volume);
      return;
    }

    // Repete o mesmo bipe da contagem sem pausa até preencher a duração pedida.
    const intervalo = 0.16;
    const nBipes = Math.max(1, Math.round(duracao / intervalo));
    for (let i = 0; i < nBipes; i++) {
      tocarNota(ctx, freq, t0 + i * intervalo, 0.15, volume);
    }
  }, [tocarNota]);
}

const campoStyle = {
  width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.05)",
  color: "#F5F3EC", fontSize: 15, fontFamily: "Inter",
};
const labelStyle = { fontSize: 11.5, fontWeight: 600, color: "#9B9891", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 5, display: "block" };

function Campo({ label, children }) {
  return <div><span style={labelStyle}>{label}</span>{children}</div>;
}

function ConfigTela({ config, setConfig, onIniciar, academia }) {
  const fileRef = useRef(null);
  const duracaoRound = config.roundMin * 60 + config.roundSeg;
  const podeIniciar = config.rounds > 0 && duracaoRound > 0;
  const num = (campo) => (e) => setConfig((c) => ({ ...c, [campo]: Math.max(0, Number(e.target.value) || 0) }));
  const logoExibido = config.logoCustom || academia?.logo;
  const onLogoFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setConfig((c) => ({ ...c, logoCustom: reader.result }));
    reader.readAsDataURL(f);
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, boxSizing: "border-box" }}>
      <div style={{ width: "100%", maxWidth: 460, background: "linear-gradient(165deg, #1A1D24 0%, #0D0F13 100%)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 20, padding: "28px 26px", boxShadow: "0 20px 60px rgba(0,0,0,0.45)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 22 }}>
          {logoExibido ? (
            <img src={logoExibido} alt="" style={{ width: 44, height: 44, borderRadius: 10, objectFit: "cover" }} />
          ) : (
            <div style={{ width: 44, height: 44, borderRadius: 10, background: "rgba(201,162,39,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>⏱️</div>
          )}
          <div>
            <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: 18, color: "#F5F3EC", textTransform: "uppercase", letterSpacing: 0.4 }}>{config.nomeCustom || academia?.nome || "Cronômetro de treino"}</div>
            <div style={{ fontSize: 12, color: "#9B9891" }}>Configure os rounds e mostre na TV do tatame</div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 14 }}>
          <div>
            <span style={labelStyle}>Nome exibido no cronômetro</span>
            <input type="text" style={campoStyle} value={config.nomeCustom} onChange={(e) => setConfig((c) => ({ ...c, nomeCustom: e.target.value }))} placeholder={academia?.nome || "ex: Cia Paulista — Unidade Centro"} />
          </div>

          <div>
            <span style={labelStyle}>Logo exibida no cronômetro</span>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input ref={fileRef} type="file" accept="image/*" onChange={onLogoFile} style={{ display: "none" }} />
              <button type="button" onClick={() => fileRef.current?.click()} style={{ ...campoStyle, width: "auto", cursor: "pointer", flex: 1, textAlign: "left", color: "#C9C4B4" }}>🖼️ {config.logoCustom ? "Trocar imagem…" : "Enviar logo própria…"}</button>
              {config.logoCustom && (
                <button type="button" onClick={() => setConfig((c) => ({ ...c, logoCustom: null }))} style={{ padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.14)", background: "transparent", color: "#9B9891", fontSize: 12.5, cursor: "pointer" }}>Usar padrão</button>
              )}
            </div>
            <p style={{ fontSize: 11, color: "#6B6656", marginTop: 5 }}>{config.logoCustom ? "Usando a logo enviada por você, só nessa TV/dispositivo." : `Sem logo própria enviada, usa a logo da academia${academia?.logo ? "" : " (ainda não cadastrada)"}.`}</p>
          </div>

          <Campo label="Quantidade de rounds">
            <input type="number" min="1" max="99" style={campoStyle} value={config.rounds} onChange={num("rounds")} />
          </Campo>

          <div>
            <span style={labelStyle}>Duração de cada round</span>
            <div style={{ display: "flex", gap: 10 }}>
              <input type="number" min="0" max="59" style={campoStyle} value={config.roundMin} onChange={num("roundMin")} placeholder="min" />
              <input type="number" min="0" max="59" style={campoStyle} value={config.roundSeg} onChange={num("roundSeg")} placeholder="seg" />
            </div>
          </div>

          <div>
            <span style={labelStyle}>Descanso entre rounds</span>
            <div style={{ display: "flex", gap: 10 }}>
              <input type="number" min="0" max="59" style={campoStyle} value={config.descansoMin} onChange={num("descansoMin")} placeholder="min" />
              <input type="number" min="0" max="59" style={campoStyle} value={config.descansoSeg} onChange={num("descansoSeg")} placeholder="seg" />
            </div>
          </div>

          <Campo label="Preparação antes de começar (segundos)">
            <input type="number" min="0" max="120" style={campoStyle} value={config.preparoSeg} onChange={num("preparoSeg")} />
          </Campo>
        </div>

        {!podeIniciar && <div style={{ fontSize: 12, color: "#FF8A80", marginTop: 12 }}>Defina ao menos 1 round com duração maior que zero.</div>}

        <button onClick={onIniciar} disabled={!podeIniciar} style={{
          marginTop: 20, width: "100%", padding: "14px 0", borderRadius: 12, border: "none",
          background: podeIniciar ? "#C9A227" : "rgba(255,255,255,0.08)", color: podeIniciar ? "#12213B" : "#6B6656",
          fontFamily: "Oswald", fontWeight: 700, fontSize: 16, textTransform: "uppercase", letterSpacing: 0.5,
          cursor: podeIniciar ? "pointer" : "default",
        }}>▶ Iniciar cronômetro</button>

        <p style={{ fontSize: 11, color: "#6B6656", marginTop: 14, textAlign: "center" }}>Essa página não exige login — deixe salva/favoritada na TV ou tablet do tatame.</p>
      </div>
    </div>
  );
}

export default function Cronometro() {
  const [academia, setAcademia] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const rows = await pg.select("academia", "select=nome,logo&limit=1");
        if (rows && rows[0]) setAcademia(rows[0]);
      } catch (_) {}
    })();
  }, []);

  const [config, setConfig] = useState(carregarConfig);
  useEffect(() => { salvarConfig(config); }, [config]);
  const [tela, setTela] = useState("config"); // config | timer
  const [fase, setFase] = useState("preparo"); // preparo | round | descanso | fim
  const [roundAtual, setRoundAtual] = useState(1);
  const [segundosRestantes, setSegundosRestantes] = useState(0);
  const [rodando, setRodando] = useState(false);
  const [telaCheia, setTelaCheia] = useState(false);
  const apito = useApito();

  const duracaoFase = useCallback((f) => {
    if (f === "preparo") return config.preparoSeg;
    if (f === "round") return config.roundMin * 60 + config.roundSeg;
    if (f === "descanso") return config.descansoMin * 60 + config.descansoSeg;
    return 0;
  }, [config]);

  const iniciar = () => {
    const primeiraFase = config.preparoSeg > 0 ? "preparo" : "round";
    setFase(primeiraFase);
    setRoundAtual(1);
    setSegundosRestantes(duracaoFase(primeiraFase));
    setRodando(true);
    setTela("timer");
    apito(0.2, 0, 0.6, 1400);
  };

  const reiniciar = () => {
    setRodando(false);
    setTela("config");
    setFase("preparo");
    setRoundAtual(1);
  };

  // Contagem regressiva: um segundo por vez enquanto estiver rodando.
  useEffect(() => {
    if (!rodando || tela !== "timer" || fase === "fim") return;
    const id = setInterval(() => setSegundosRestantes((s) => s - 1), 1000);
    return () => clearInterval(id);
  }, [rodando, tela, fase]);

  // Bipes de contagem (últimos 10s) e troca de fase quando o tempo zera.
  useEffect(() => {
    if (!rodando || tela !== "timer" || fase === "fim") return;
    if (segundosRestantes <= 10 && segundosRestantes >= 1) {
      apito(0.1, 0, 0.75, 1400);
      return;
    }
    if (segundosRestantes > 0) return;

    if (fase === "preparo") {
      setFase("round");
      setSegundosRestantes(duracaoFase("round"));
      apito(1.1, 0, 0.85, 1400);
    } else if (fase === "round") {
      const temDescanso = config.descansoMin > 0 || config.descansoSeg > 0;
      if (roundAtual < config.rounds) {
        if (temDescanso) {
          setFase("descanso");
          setSegundosRestantes(duracaoFase("descanso"));
          apito(1.1, 0, 0.85, 1400);
        } else {
          setRoundAtual((r) => r + 1);
          setSegundosRestantes(duracaoFase("round"));
          apito(1.1, 0, 0.85, 1400);
        }
      } else {
        setFase("fim");
        setRodando(false);
        apito(2.4, 0, 0.85, 1400);
      }
    } else if (fase === "descanso") {
      setRoundAtual((r) => r + 1);
      setFase("round");
      setSegundosRestantes(duracaoFase("round"));
      apito(1.1, 0, 0.85, 1400);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segundosRestantes]);

  // Mantém a tela ligada (TV/tablet) enquanto o cronômetro estiver na tela — recursos que não
  // suportam a API simplesmente não fazem nada (ex: Safari mais antigo).
  useEffect(() => {
    if (tela !== "timer") return;
    let lock;
    const pedir = async () => {
      try { lock = await navigator.wakeLock?.request("screen"); } catch (_) {}
    };
    pedir();
    const onVis = () => { if (document.visibilityState === "visible") pedir(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      try { lock?.release(); } catch (_) {}
    };
  }, [tela]);

  useEffect(() => {
    const onChange = () => setTelaCheia(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const alternarTelaCheia = async () => {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
    } catch (_) {}
  };

  if (tela === "config") {
    return <ConfigTela config={config} setConfig={setConfig} onIniciar={iniciar} academia={academia} />;
  }

  const contagemFinal = fase !== "fim" && segundosRestantes <= 10 && segundosRestantes >= 0;
  const corFase = contagemFinal ? "#FF4D4D" : { preparo: "#F2A93B", round: "#F5F3EC", descanso: "#4ADE80", fim: "#C9A227" }[fase];
  const labelFase = {
    preparo: "Prepare-se",
    round: `Round ${roundAtual} de ${config.rounds}`,
    descanso: "Descanso",
    fim: "Treino finalizado 🥋",
  }[fase];
  const logoExibido = config.logoCustom || academia?.logo;
  const nomeExibido = config.nomeCustom || academia?.nome;

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "stretch",
      background: "radial-gradient(circle at 50% 20%, rgba(201,162,39,0.06), transparent 55%), linear-gradient(160deg, #14171F 0%, #0B0C10 100%)",
      color: "#F5F3EC", position: "relative", overflow: "hidden", boxSizing: "border-box",
    }}>
      {(logoExibido || nomeExibido) && (
        <div style={{ width: "clamp(200px, 28vw, 440px)", flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20, padding: 24, boxSizing: "border-box", borderRight: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)" }}>
          {logoExibido && <img src={logoExibido} alt="" style={{ width: "100%", maxWidth: 260, height: "auto", objectFit: "contain" }} />}
          {nomeExibido && <div style={{ fontFamily: "Oswald", fontWeight: 600, fontSize: "clamp(15px, 2vw, 24px)", textTransform: "uppercase", letterSpacing: 0.5, color: "#C9C4B4", textAlign: "center" }}>{nomeExibido}</div>}
        </div>
      )}

      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 20, boxSizing: "border-box" }}>
        <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: "clamp(20px, 4vw, 40px)", textTransform: "uppercase", letterSpacing: 1, color: corFase, marginBottom: 6 }}>{labelFase}</div>

        {fase !== "fim" ? (
          <div style={{ fontFamily: "Oswald", fontWeight: 700, fontSize: "clamp(90px, 20vw, 300px)", lineHeight: 1, color: corFase, fontVariantNumeric: "tabular-nums", textShadow: "0 6px 40px rgba(0,0,0,0.5)" }}>
            {mmss(segundosRestantes)}
          </div>
        ) : (
          <div style={{ fontSize: "clamp(60px, 12vw, 140px)", marginTop: 10 }}>🏆</div>
        )}

        <div style={{ display: "flex", gap: 12, marginTop: 34, flexWrap: "wrap", justifyContent: "center" }}>
          {fase !== "fim" && (
            <button onClick={() => setRodando((v) => !v)} style={botaoEstilo(false)}>{rodando ? "⏸ Pausar" : "▶ Continuar"}</button>
          )}
          <button onClick={reiniciar} style={botaoEstilo(false)}>⟲ {fase === "fim" ? "Novo treino" : "Reconfigurar"}</button>
          <button onClick={alternarTelaCheia} style={botaoEstilo(false)}>{telaCheia ? "⤢ Sair da tela cheia" : "⛶ Tela cheia"}</button>
        </div>
      </div>
    </div>
  );
}

function botaoEstilo() {
  return {
    padding: "10px 18px", borderRadius: 24, border: "1px solid rgba(255,255,255,0.16)",
    background: "rgba(255,255,255,0.06)", color: "#F5F3EC", fontSize: 13.5, fontWeight: 600,
    fontFamily: "Inter", cursor: "pointer",
  };
}
