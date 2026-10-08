# Marcas (uma pasta por academia)

O mesmo código atende várias academias. Cada uma tem uma pasta aqui com:

| Arquivo | Para quê |
|---|---|
| `marca.json` | Nome, cores, nome da sede, senha padrão do aluno, e-mail, foro |
| `simbolo.png` | Só o símbolo, sem texto — usado no cabeçalho (34px) quando a academia não enviou logo pelo painel |
| `logo-circular.png` | Logo usada no login, no cronômetro e nos relatórios (quando a academia ainda não enviou a sua pelo painel) |
| `favicon.jpg` | Ícone da aba do navegador |
| `icon-192.png`, `icon-512.png` | Ícone do app instalado no celular |
| `icon-192-maskable.png`, `icon-512-maskable.png` | Mesmo ícone, com margem de segurança (Android recorta em círculo) |

## Campos do `marca.json`

- `slug`: nome da pasta (sem espaço/acento); também prefixa a sala de reunião por vídeo
- `nomeApp`: título das páginas e das notificações (ex.: "QG Cia Paulista")
- `nomeEquipe`: nome curto (ex.: "Cia Paulista"), usado em "Contatos ...", ícone do admin etc.
- `nomeCompleto`: descrição do app instalado (ex.: "Cia Paulista Jiu Jitsu")
- `sede`: como o local principal é chamado (ex.: "QG" → "QG (padrão)", "Endereço do QG")
- `senhaPadraoAluno`: senha inicial sugerida ao cadastrar aluno
- `email`, `foro`: contato e foro da política de privacidade
- `corTema`, `corFundo`: cor da barra do celular e fundo enquanto o app carrega

## Nova academia

1. Copie `marcas/ciapaulista` para `marcas/<slug-novo>` e troque os arquivos/campos.
2. No Netlify do site novo, defina `VITE_MARCA=<slug-novo>`, `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.
3. No Supabase novo, defina os secrets das edge functions: `ACADEMIA_EMAIL`, `ACADEMIA_SEDE`,
   `VAPID_PUBLIC_KEY` e `VAPID_PRIVATE_KEY`.
