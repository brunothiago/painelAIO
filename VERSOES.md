# Versões do Painel AIO

Espelho de `docs/js/versoes.js` (botão "Versão" do painel). Ao publicar uma versão nova, atualize os dois e troque `?v=` no `docs/index.html`.

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
