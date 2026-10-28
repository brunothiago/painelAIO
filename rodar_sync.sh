#!/bin/bash
# Sincronização diária do painelAIO (precisa da VPN para falar com o banco MCID):
#   0) Gmail -> MCID: e-mails de AIO da GEPAC07 em se_cgpac.aio_solicitacoes
#      (aio_pipeline.py do painelcargaaio; 7 dias para cobrir dias sem VPN)
#   1) MCID -> Supabase: dados do SACI/TransfereGov usados na busca e no detalhe
#   1b) AIOs da SNH que chegaram por e-mail viram AIOs no painel (08_aios_do_email.py)
#   2) Supabase -> MCID: espelho do cadastro em se_cgpac.painelaio_*
# Sem VPN, os scripts avisam e saem sem erro.
set -u
cd "$(dirname "$0")"
PY=.venv/bin/python3
[ -x "$PY" ] || PY=python3
CARGA=../painelcargaaio
PY_CARGA=$CARGA/.venv/bin/python3
[ -x "$PY_CARGA" ] || PY_CARGA=python3
LOG="$HOME/logs/painelaio_sync.log"
mkdir -p "$(dirname "$LOG")"
{
  echo "=== $(date '+%Y-%m-%d %H:%M') ==="
  "$PY_CARGA" "$CARGA/aio_pipeline.py" --dias 7 | grep -E 'RESUMO|ERROR|Falha'
  "$PY" python/03_sync_referencia.py --commit
  "$PY" python/08_aios_do_email.py --commit | grep -vE '^(Relatório|  e-mails)'
  "$PY" python/04_espelhar_mcid.py --commit
} >>"$LOG" 2>&1
