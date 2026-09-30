# CLAUDE.md

Painel AIO (`painelAIO`): painel ao vivo em que a equipe da MCID/SE/DMP/CGPAC cadastra os AIOs e acompanha em que momento cada um está. O painel antigo, estático, com as 11 etapas da PC 32, agora se chama `painelcargaaio` (pasta irmã). Não confunda os dois.

## Arquitetura
- **Backend:** Supabase (Postgres + Auth + PostgREST + Realtime). Tudo fica no schema `public`. O SQL em `sql/` é colado no SQL Editor na ordem 01→06. `99_testes.sql` confere RLS e regras (roda em transação e desfaz tudo).
- **Front:** HTML/JS puro, com módulos ES, em `docs/`. É servido pelo GitHub Pages (repo `brunothiago/painelAIO`). `supabase-js` vem do jsdelivr, com a versão fixada em `docs/js/config.js`. SheetJS é carregado sob demanda (upload das listas da Caixa).
- **Ponte com o MCID:** os scripts de `python/` rodam no Mac do usuário, na VPN.
  - O banco MCID é acessado com psycopg2.
  - O Supabase é acessado por HTTPS/PostgREST com a secret key. Não use a porta 5432, que pode estar bloqueada na rede do ministério.
  - Todo script só simula por padrão; `--commit` grava.

## Convenções importantes
- **Escapar sempre.** Monte HTML com o template `html\`\`` de `docs/js/util.js`, que escapa as interpolações. Use `raw()` só para marcação fixa. Nunca coloque dado do banco em `innerHTML` sem escapar.
- **Autoria e histórico ficam no banco.** Os triggers preenchem `created_by`/`updated_by` a partir do e-mail do JWT e gravam `aio_historico`. O front não escreve essas colunas.
- **Mudar momento só por RPC.** Use `mudar_momento` (versão otimista, obs obrigatória em desvio, data não futura, preenche datas-marco). `criar_aio` cria o contrato, se precisar, e o AIO numa transação.
- **Trava otimista.** `aio.versao`: o front manda `eq('versao', v)`. Se voltar 0 linhas, houve conflito.
- **Normalização de números** (igual em SQL, Python e JS):
  - instrumento: dígitos antes de "/";
  - operação: dígitos antes do "-", sem zeros à esquerda.
- **Listas da Caixa.** O leitor está duplicado: `python/caixa.py` e `docs/js/caixa.js`. Os dois usam o mesmo `docs/js/caixa_mapa.json`. Mudou um, mude o outro. T3/T4 não contam como convalidação por padrão (`caixa_lista.convalidacao`).
- **Visão `v_aio_painel`.** Completa proponente, município, UF, objeto, secretaria e modalidade com a tabela `referencia` (SACI) quando o contrato não tem esses dados.
- **Execução física** fica em % (0–100). A planilha traz fração, e o seed multiplica por 100.
- Ao mudar uma coluna, atualize `sql/`, a visão, `python/04_espelhar_mcid.py` (DDL do espelho), `docs/js/detalhe.js` (CAMPOS_*) e `docs/js/exportar.js`.

## Comandos
```bash
.venv/bin/python python/01_seed_planilha.py [--commit]
.venv/bin/python python/02_importar_lista_caixa.py ARQUIVO.xlsx [--recebida-em AAAA-MM-DD] [--commit]
.venv/bin/python python/03_sync_referencia.py [--commit]      # VPN
.venv/bin/python python/04_espelhar_mcid.py [--criar-tabelas] [--commit]   # VPN
.venv/bin/python python/05_gerar_mock.py && python3 -m http.server 8000   # prévia: /docs/?mock=1
./publicar.sh "mensagem"
.venv/bin/python python/aplicar_sql.py [01 02 03 ...] [--commit]   # aplica sql/ no Supabase via pooler (SUPABASE_DB_URL); sempre roda 04 após 01–03 e termina com 99
```

## Segurança
- `config.env` (secret key do Supabase e senha do MCID), `*.xlsx`, `seed/` e `relatorios/` ficam fora do Git.
- `publicar.sh` bloqueia o envio se achar segredo em `docs/`.
- A publishable key em `docs/js/config.js` é pública por projeto: a proteção vem da RLS com `is_membro()`.
