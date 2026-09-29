#!/bin/bash
# Publica o painel (pasta docs/) no GitHub Pages: brunothiago/painelAIO.
# Antes de enviar, confere que nenhum segredo nem dado operacional está indo junto.
set -euo pipefail
cd "$(dirname "$0")"
# chaves reais: secret key nova (sb_secret_...), chave JWT antiga (eyJhbGci...) ou senha do banco
if grep -rEl "sb_secret_[A-Za-z0-9_-]{8,}|eyJhbGci[A-Za-z0-9_-]{10,}|DB_PASSWORD=[^[:space:]]" docs/ ; then
  echo "ERRO: há chave secreta dentro de docs/. Nada foi publicado." >&2; exit 1
fi
if git ls-files --others --cached --exclude-standard | grep -E "\.xlsx$|config\.env$|seed/|relatorios/" ; then
  echo "ERRO: arquivo de dados/segredo seria enviado. Nada foi publicado." >&2; exit 1
fi
git add -A
git status --short
git commit -m "${1:-Publica painel AIO}" || { echo "Nada para publicar."; exit 0; }
git push
echo "Publicado. Em ~1–3 min: https://thiagobruno.com.br/painelAIO/"
