# Painel AIO

Painel para a equipe da CGPAC **cadastrar e acompanhar cada AIO** (Autorização de Início de Objeto) ao vivo:

- em que **momento** o AIO está e há quantos dias;
- contratos de **etapa única** e contratos **em etapas**, com os AIOs agrupados pelo instrumento;
- se o instrumento está na **lista de convalidação da Caixa**;
- dados do SACI e do TransfereGov.

Endereço: `https://thiagobruno.com.br/painelAIO/`. É preciso ter login.

O painel antigo (a linha do tempo da PC 32) passou a se chamar **painelcargaaio** e continua funcionando à parte.

## Como funciona

```
Navegador (equipe) ── login ──► Supabase (banco na nuvem, login, tempo real)
  site em docs/ (GitHub Pages)       ▲                        │
                                     │ HTTPS                  ▼
                  Seu Mac na VPN: python/ (sincronização 2x ao dia)
                  Banco MCID: SACI, TransfereGov, aio_solicitacoes  ◄── cópia em se_cgpac.painelaio_*
```

- O site não guarda dados: ele lê e grava no Supabase.
- Só entra quem tem login **e** está na tabela `perfil`.
- O banco do MCID só responde na VPN. Por isso quem leva dados do MCID para o painel, e do painel de volta para o MCID, são os scripts em `python/`, rodando no seu Mac.

## Momentos

| Fluxo | Desvios (exigem observação) |
|---|---|
| 1 Solicitado pela Caixa | Pendência na CGPAC |
| 2 Recebido na CGPAC | Devolvido à Secretaria Finalística |
| 3 Em análise (checklist) | Impedimento judicial/TCU |
| 4 Tramitado ao GAB-SE | Cancelado / não se aplica |
| 5 Assinado | |
| 6 Concluído (AIO concedida) | |

- Cada mudança de momento guarda a data, quem mudou e a observação.
- O prazo (SLA) de cada momento define quando o AIO fica "atrasado". Para mudar o prazo, edite a coluna `sla_dias` da tabela `momento`.

## Etapas

- Cada AIO é de uma etapa do contrato. Ele pode cobrir mais de uma ("2 e 4") ou ser de "Única".
- O painel não deixa ter dois AIOs **em andamento** para a mesma etapa do mesmo contrato.
- Contratos com mais de um AIO aparecem numa linha-mãe que abre e fecha.

## Listas da Caixa

- Na aba **Listas da Caixa**, qualquer pessoa da equipe importa o `.xlsx` do e-mail da Caixa, sem VPN.
- O painel acha sozinho cada "Tabela N", a data do e-mail e o cabeçalho.
- Os itens casam com os contratos pelo nº do instrumento/convênio e, se não casar, pela operação.
- Importar o mesmo arquivo de novo não duplica.
- Na importação você marca se a tabela **conta como lista de convalidação**. As Tabelas 1, 2 e 5 contam. A T3 ("sem TGOV") e a T4 ("executados por etapas") não contam, e é assim que a planilha "Informações AIO" já tratava.
- A fila **"Na lista da Caixa e ainda sem cadastro"** tem o botão **Iniciar cadastro**.

---

## Instalação (uma vez)

### 1. Supabase (~15 min)

1. Entre em <https://supabase.com> e clique em **New project**:
   - nome `painelAIO`;
   - região **South America (São Paulo)**;
   - anote a senha do banco num lugar seguro.
2. **SQL Editor**: cole e rode, **nesta ordem**, cada arquivo da pasta `sql/`:
   1. `01_schema.sql`
   2. `02_triggers_rpc.sql`
   3. `03_views.sql`
   4. `04_rls.sql`
   5. `05_seed.sql`
   6. `05b_equipe.sql`, depois de conferir os e-mails. Esse arquivo fica só no seu Mac e não vai para o GitHub
   7. `06_realtime.sql`
   8. `99_testes.sql`: tem que terminar com **TODOS OS TESTES PASSARAM**

   Se algum SQL de 01 a 03 for rodado de novo (por exemplo, numa atualização), rode também o `04_rls.sql` logo depois. Recriar tabelas ou visões devolve ao visitante sem login a permissão padrão do Supabase, e o teste 1 do `99_testes.sql` falha.
3. **Authentication › Sign In / Providers**: desligue **Allow new users to sign up**. Deixe só o e-mail ligado.
4. **Authentication › Users › Add user › Create new user**:
   - um usuário para cada pessoa da tabela `perfil`, com o mesmo e-mail;
   - uma senha provisória;
   - **Auto Confirm User** marcado.

   Depois, cada pessoa troca a própria senha no painel (menu com o nome › Trocar senha).
5. **Authentication › URL Configuration**:
   - Site URL: `https://thiagobruno.com.br/painelAIO/`
   - Redirect URLs: acrescente `http://localhost:8000`
6. **Project Settings › API Keys**: copie
   - a **URL do projeto** e a **publishable key**, que vão para `docs/js/config.js`;
   - a **secret key**, que vai **só** para `config.env` (`SUPABASE_SERVICE_KEY`). Ela dá acesso total: nunca a coloque em `docs/`.

### 2. Carga inicial (no Mac, com VPN)

```bash
cd NamiDash/painelAIO
python3 -m venv .venv && .venv/bin/pip install -r python/requirements.txt
cp config.env.example config.env        # e preencha (DB_* iguais aos do painelcargaaio)

.venv/bin/python python/01_seed_planilha.py              # simulação: confira relatorios/seed_*.csv
.venv/bin/python python/01_seed_planilha.py --commit
.venv/bin/python python/02_importar_lista_caixa.py "Informações AIO.xlsx" --commit
.venv/bin/python python/03_sync_referencia.py --commit
.venv/bin/python python/04_espelhar_mcid.py --criar-tabelas --commit
```

Todos os scripts **só simulam** sem `--commit`: mostram o que fariam e gravam um relatório em `relatorios/`.

### 3. Publicação

- O repositório `brunothiago/painelAIO` publica pelo GitHub Pages a partir da branch `main`, pasta `/docs`.
- Para publicar: `./publicar.sh "mensagem"`. O script se recusa a publicar se houver chave secreta ou planilha no envio.

### 4. Sincronização automática (2x por dia útil)

```bash
cp com.mcid.painelaio_sync.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.mcid.painelaio_sync.plist
```

- Roda `rodar_sync.sh` às 08:30 e às 14:00.
- O log fica em `~/logs/painelaio_sync.log`.
- Sem VPN, o script avisa no log e sai sem erro.
- O uso diário também evita que o Supabase gratuito entre em pausa, o que acontece depois de ~7 dias parado.

## Pré-visualização local (sem Supabase)

```bash
.venv/bin/python python/05_gerar_mock.py     # copia os dados do Supabase para seed/mock.json (fora do Git)
python3 -m http.server 8000                   # na pasta do projeto
# abra http://localhost:8000/docs/?mock=1
```

No modo prévia, as alterações ficam só na memória do navegador.

## Arquivos

| Caminho | Para que serve |
|---|---|
| `docs/` | O site: `index.html`, `css/`, `js/`. `js/config.js` guarda a URL e a chave pública. `js/caixa_mapa.json` diz quais cabeçalhos da Caixa viram quais campos |
| `sql/` | O banco do Supabase: tabelas, regras, visões, acesso, carga e testes |
| `python/01_seed_planilha.py` | Carga inicial da aba "AIOs a partir de julho de 2026" |
| `python/02_importar_lista_caixa.py` | Importa listas da Caixa pelo terminal. Faz o mesmo que a aba do painel |
| `python/03_sync_referencia.py` | MCID → Supabase (SACI, TransfereGov, e-mails GEPAC07) |
| `python/04_espelhar_mcid.py` | Supabase → MCID (`se_cgpac.painelaio_*`) |
| `python/05_gerar_mock.py` | Dados da pré-visualização local |
| `rodar_sync.sh`, `com.mcid.painelaio_sync.plist` | Sincronização agendada |
| `publicar.sh` | Publica `docs/` com as verificações de segurança |

## Segurança

- A **publishable key** em `docs/js/config.js` é pública de propósito. Sem login de alguém da tabela `perfil`, o banco não entrega nada: as regras de acesso (RLS) estão em `sql/04_rls.sql` e foram testadas pelo `99_testes.sql`.
- A **secret key** e a senha do banco MCID ficam só no `config.env`, que é ignorado pelo Git.
- **Para tirar o acesso de alguém:** na tabela `perfil`, mude `ativo` para `false` e, em Authentication, apague o usuário.
- **Se a secret key vazar:** gere outra em Project Settings › API Keys e troque no `config.env`.
- Os dados ficam no Supabase, região São Paulo. São dados de contratos. Não cadastre CPF nem documentos pessoais. A cópia institucional fica no banco MCID (`se_cgpac.painelaio_*`).
