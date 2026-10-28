# Versões do Painel AIO

Espelho de `docs/js/versoes.js` (botão "Versão" do painel). Ao publicar uma versão nova, atualize os dois e troque `?v=` no `docs/index.html`.

## 1.4.1 — 28/10/2026
- No topo do painel: horário em que os e-mails da Caixa chegaram ao painel e horário da última carga completa (fica laranja se passar de 24 h). Passe o mouse em "E-mails" para ver quando chegou o último e-mail da GEPAC07.
- AIOs da SNH com Vitor Bastos como responsável, inclusive os que chegarem por e-mail daqui em diante.

## 1.4.0 — 28/10/2026
- AIOs da SNH entram sozinhos: cada e-mail da Caixa (GEPAC07) vira um AIO no painel. Os que já têm a AIO emitida no TransfereGov entram como Concluído, na data de emissão; os demais, como Solicitado, na data do e-mail.
- Quando o TransfereGov mostra a AIO emitida, o AIO criado pelo e-mail passa sozinho para Concluído.
- O painel passa a carregar mais de 1.000 AIOs (antes parava em 1.000).

## 1.3.0 — 06/10/2026
- Listas fixas no preenchimento: UF, secretaria, modalidade (agrupada por secretaria) e fase do PAC viram seletores; localização e status no SEI também, com a opção "Outro (digitar)…" para casos novos.
- Referência da solicitação: caixas de marcar (Global Repasse, SPA Repasse, Licitação Repasse…) em vez de texto livre; o painel monta "Global Repasse = SPA Repasse" sozinho.
- Processo SEI e nº do instrumento/operação conferidos no formato; o processo SEI digitado só com números ganha a pontuação sozinho.
- Cadastro de AIO novo usa as mesmas listas (e ganhou a fase do PAC); o que vem do SACI ou da Caixa já entra na grafia padrão.
- Valores antigos digitados de jeitos diferentes foram unificados (ex.: "Contenção" → "Contenção de Encostas", "SPA Gllobal" → "SPA Global").

## 1.2.0 — 30/09/2026
- Cada campo tem uma letra, como no Excel (A = Nº AIO, B = Instrumento…), igual à coluna da planilha exportada.
- As letras aparecem no preenchimento do AIO, no cadastro de AIO novo, nos dados do MCID e no cabeçalho da lista.
- Botão "Mapa de colunas" com a lista completa (A até AZ). A exportação ganhou fase do PAC, referência da solicitação, saldo, desbloqueio, e-mail GEPAC07 e valor de repasse.

## 1.1.0 — 30/09/2026
- Nº sequencial de cada AIO (AIO nº 1, 2, 3…), igual à coluna ID da planilha para os AIOs da carga inicial; os novos recebem o próximo nº.
- Busca pelo nº: digite 12 (ou #12) e aperte Enter para abrir o AIO nº 12. Ordenação por nº.
- Nº na lista, no detalhe, no quadro, na atividade e na exportação.

## 1.0.0 — 29/09/2026
- Primeira versão do Painel AIO com cadastro ao vivo (Supabase).
- Momentos do fluxo: Solicitado → Recebido na CGPAC → Em análise → Tramitado ao GAB-SE → Assinado → Concluído. Os desvios exigem observação.
- Contratos em etapas agrupados pelo instrumento, com um AIO por etapa (ou por "2 e 4").
- Busca e início do cadastro a partir do SACI/TransfereGov, das listas da Caixa ou de um contrato já cadastrado.
- Listas da Caixa: importação do .xlsx no próprio painel, presença na lista de convalidação e fila de itens sem cadastro.
- Histórico de cada AIO (quem, quando, o quê), aba Atividade, quadro por momento e exportação CSV/Excel.
