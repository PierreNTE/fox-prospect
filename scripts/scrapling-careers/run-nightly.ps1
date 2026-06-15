# Runner nocturne du collecteur Scrapling carrières.
# Lancé automatiquement par le Planificateur de tâches Windows (voir install-task.ps1).
# Active le venv, lance la collecte avec écriture en base, journalise dans runs.log.

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

$py  = Join-Path $here ".venv\Scripts\python.exe"
$log = Join-Path $here "runs.log"
$stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

Add-Content $log "`n===== $stamp — collecte démarrée ====="

if (-not (Test-Path $py)) {
  Add-Content $log "ERREUR : venv introuvable. Lance d'abord : python -m venv .venv ; .venv\Scripts\python.exe -m pip install -r requirements.txt ; .venv\Scripts\scrapling install"
  exit 1
}

# --commit : écrit les signaux ; --limit 30 : plafonne le nombre de comptes par nuit.
& $py "collect_careers.py" --commit --limit 30 *>> $log
Add-Content $log "===== terminé (exit=$LASTEXITCODE) ====="
