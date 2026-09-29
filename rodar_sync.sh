#!/bin/bash
# Sincronização diária do painelAIO (precisa da VPN para falar com o banco MCID):
#   1) MCID -> Supabase: dados do SACI/TransfereGov usados na busca e no detalhe
#   2) Supabase -> MCID: espelho do cadastro em se_cgpac.painelaio_*
# Sem VPN, os scripts avisam e saem sem erro.
set -u
cd "$(dirname "$0")"
PY=.venv/bin/python3
[ -x "$PY" ] || PY=python3
LOG="$HOME/logs/painelaio_sync.log"
mkdir -p "$(dirname "$LOG")"
{
  echo "=== $(date '+%Y-%m-%d %H:%M') ==="
  "$PY" python/03_sync_referencia.py --commit
  "$PY" python/04_espelhar_mcid.py --commit
} >>"$LOG" 2>&1
