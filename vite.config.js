import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
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
});
