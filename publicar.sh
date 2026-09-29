#!/bin/bash
# Publica o painel (pasta docs/) no GitHub Pages: brunothiago/painelAIO.
# Antes de enviar, confere que nenhum segredo nem dado operacional está indo junto.
set -euo pipefail
cd "$(dirname "$0")"
if grep -rEl "sb_secret_|service_role|SUPABASE_SERVICE_KEY|DB_PASSWORD" docs/ ; then
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
