# Sincronização diária do painelAIO no Windows (o mesmo que rodar_sync.sh no Mac).
# Precisa da VPN para falar com o banco MCID:
#   0) Gmail -> MCID: e-mails de AIO da GEPAC07 em se_cgpac.aio_solicitacoes
#      (aio_pipeline.py do painelcargaaio; 7 dias para cobrir dias sem VPN)
#   1) MCID -> Supabase: dados do SACI/TransfereGov usados na busca e no detalhe
#   1b) AIOs da SNH que chegaram por e-mail viram AIOs no painel (08_aios_do_email.py)
#   2) Supabase -> MCID: espelho do cadastro em se_cgpac.painelaio_*
# Sem VPN, os scripts avisam e saem sem erro.
# Agendado pelo Agendador de Tarefas (ver LEIAME, "Instalar no Windows").
$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot
$env:PYTHONUTF8 = '1'   # acentos e símbolos no log sem erro de codificação

$Py = '.venv\Scripts\python.exe'
if (-not (Test-Path $Py)) { $Py = 'python' }
$Carga = '..\painelcargaaio'
$PyCarga = "$Carga\.venv\Scripts\python.exe"
if (-not (Test-Path $PyCarga)) { $PyCarga = 'python' }
$Log = Join-Path $HOME 'logs\painelaio_sync.log'
New-Item -ItemType Directory -Force (Split-Path $Log) | Out-Null

# O notebook só roda: o código é editado no Mac, enviado ao GitHub e baixado aqui.
# --ff-only não mexe em nada se houver alteração local; o erro fica no log.
function Atualizar($Pasta) { git -C $Pasta pull --ff-only --quiet 2>&1 | ForEach-Object { "git ($Pasta): $_" } }

# Junta a saída e os erros do Python como texto simples
function Rodar($Exe) { & $Exe @args 2>&1 | ForEach-Object { "$_" } }

& {
  "=== $(Get-Date -Format 'yyyy-MM-dd HH:mm') ==="
  Atualizar .
  Atualizar $Carga
  Rodar $PyCarga "$Carga\aio_pipeline.py" --dias 7 | Select-String 'RESUMO|ERROR|Falha' | ForEach-Object Line
  Rodar $Py python\03_sync_referencia.py --commit
  Rodar $Py python\08_aios_do_email.py --commit
  Rodar $Py python\04_espelhar_mcid.py --commit
} | Out-File -Append -Encoding utf8 $Log
