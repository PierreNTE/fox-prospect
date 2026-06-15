# Enregistre une tâche planifiée Windows qui lance le collecteur Scrapling chaque nuit.
#
# Usage (PowerShell, depuis ce dossier) :
#   powershell -ExecutionPolicy Bypass -File install-task.ps1
#   powershell -ExecutionPolicy Bypass -File install-task.ps1 -At "03:15"
#
# Pour supprimer la tâche :
#   Unregister-ScheduledTask -TaskName "FoxProspect-Scrapling-Carrieres" -Confirm:$false

param([string]$At = "02:30")

$here   = Split-Path -Parent $MyInvocation.MyCommand.Path
$runner = Join-Path $here "run-nightly.ps1"

if (-not (Test-Path $runner)) {
  Write-Error "run-nightly.ps1 introuvable dans $here"
  exit 1
}

$action  = New-ScheduledTaskAction -Execute "powershell.exe" `
            -Argument "-ExecutionPolicy Bypass -NonInteractive -WindowStyle Hidden -File `"$runner`""
$trigger = New-ScheduledTaskTrigger -Daily -At $At

# StartWhenAvailable : rattrape la collecte si le PC était éteint à l'heure prévue.
# WakeToRun : tente de réveiller le PC en veille (pas de garantie si éteint).
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun `
            -ExecutionTimeLimit (New-TimeSpan -Hours 2)

Register-ScheduledTask -TaskName "FoxProspect-Scrapling-Carrieres" `
  -Action $action -Trigger $trigger -Settings $settings `
  -Description "Collecte nocturne des signaux recrutement (pages carrières) via Scrapling — écrit dans Supabase" `
  -Force | Out-Null

Write-Output "✓ Tâche planifiée enregistrée : FoxProspect-Scrapling-Carrieres (quotidien à $At)"
Write-Output "  Rattrapage si PC éteint : oui (StartWhenAvailable)"
Write-Output "  Journal des exécutions  : $here\runs.log"
Write-Output ""
Write-Output "  Limite : ne tourne que si le PC est allumé. Pour une collecte"
Write-Output "  vraiment indépendante de la machine, c'est le rôle des crons Vercel."
