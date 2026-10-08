import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { readFileSync } from "fs";

// Cada academia é uma "marca" em marcas/<slug>/ (marca.json + ícones + logo). O deploy escolhe
// qual usar pela variável VITE_MARCA (no Netlify: Site settings > Environment variables).
// Sem ela, usa a Bushi Strategy.
function marcaPlugin(slug) {
  const dir = resolve(__dirname, "marcas", slug);
  const marca = JSON.parse(readFileSync(resolve(dir, "marca.json"), "utf8"));
  const logoCircular = "data:image/png;base64," + readFileSync(resolve(dir, "logo-circular.png")).toString("base64");

  const icones = [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/icon-192-maskable.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
    { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ];
  const manifesto = (name, shortName, startUrl) => JSON.stringify({
    name, short_name: shortName,
    description: `Check-in, graduação e pagamentos da ${marca.nomeCompleto}`,
    start_url: startUrl, scope: "/", display: "standalone",
    background_color: marca.corFundo, theme_color: marca.corTema, orientation: "portrait-primary",
    icons: icones,
  }, null, 2) + "\n";

  // Arquivos servidos na raiz do site, gerados a partir da marca.
  const arquivos = {
    "manifest.json": () => manifesto(`${marca.nomeEquipe} Administrador`, `${marca.nomeEquipe} Admin`, "/"),
    "manifest-alunos.json": () => manifesto("Alunos", "Alunos", "/alunos.html"),
    "manifest-professores.json": () => manifesto("Professores", "Professores", "/professores.html"),
    "sw.js": () => readFileSync(resolve(__dirname, "pwa/sw.js"), "utf8").replaceAll("__MARCA_NOME_APP__", marca.nomeApp),
  };
  for (const f of ["favicon.jpg", "icon-192.png", "icon-192-maskable.png", "icon-512.png", "icon-512-maskable.png"]) {
    arquivos[f] = () => readFileSync(resolve(dir, f));
  }
  const tipos = { json: "application/json", js: "text/javascript", png: "image/png", jpg: "image/jpeg" };

  const ID_VIRTUAL = "virtual:marca";
  return {
    name: "marca",
    resolveId(id) { if (id === ID_VIRTUAL) return "\0" + ID_VIRTUAL; },
    load(id) {
      if (id === "\0" + ID_VIRTUAL) return `export const MARCA = ${JSON.stringify(marca)};\nexport const LOGO_CIRCULAR = ${JSON.stringify(logoCircular)};\n`;
    },
    transformIndexHtml: {
      order: "pre",
      handler: (html) => html
        .replaceAll("%MARCA_NOME_APP%", marca.nomeApp)
        .replaceAll("%MARCA_NOME_EQUIPE%", marca.nomeEquipe)
        .replaceAll("%MARCA_FORO%", marca.foro)
        .replaceAll("%MARCA_COR_TEMA%", marca.corTema)
        .replaceAll("%MARCA_COR_FUNDO%", marca.corFundo),
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const nome = (req.url || "").split("?")[0].replace(/^\//, "");
        if (!arquivos[nome]) return next();
        res.setHeader("Content-Type", tipos[nome.split(".").pop()]);
        res.end(arquivos[nome]());
      });
    },
    generateBundle() {
      for (const [fileName, gerar] of Object.entries(arquivos)) this.emitFile({ type: "asset", fileName, source: gerar() });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), marcaPlugin(env.VITE_MARCA || "bushistrategy")],
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, "index.html"),
          alunos: resolve(__dirname, "alunos.html"),
          professores: resolve(__dirname, "professores.html"),
          privacidade: resolve(__dirname, "privacidade.html"),
          cronometro: resolve(__dirname, "cronometro.html"),
        },
      },
    },
  };
});
