# Installs Ollama (if needed), starts it, and pulls the print-watch vision model.
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\setup-ollama.ps1 [-Model gemma3:4b]
param(
  [string]$Model = $(if ($env:PW_MODEL) { $env:PW_MODEL } else { "gemma3:4b" }),
  [string]$OllamaUrl = $(if ($env:PW_OLLAMA_URL) { $env:PW_OLLAMA_URL } else { "http://127.0.0.1:11434" })
)
$ErrorActionPreference = "Stop"
function Log($m) { Write-Host "[setup-ollama] $m" }

function Test-Reachable {
  try { Invoke-RestMethod -Uri "$OllamaUrl/api/tags" -TimeoutSec 3 | Out-Null; return $true } catch { return $false }
}

if (-not (Test-Reachable)) {
  if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
    Log "Ollama not found — installing via winget…"
    winget install -e --id Ollama.Ollama --accept-source-agreements --accept-package-agreements --silent
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("Path", "User")
  }
  Log "Starting Ollama…"
  Start-Process -WindowStyle Hidden -FilePath "ollama" -ArgumentList "serve" -ErrorAction SilentlyContinue
  $deadline = (Get-Date).AddSeconds(90)
  while (-not (Test-Reachable) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 2 }
  if (-not (Test-Reachable)) { throw "Ollama did not start. Launch it and re-run." }
}
Log "Ollama is running."

$short = $Model.Split(":")[0]
$have = $false
try { $have = (Invoke-RestMethod "$OllamaUrl/api/tags").models.name | Where-Object { $_ -like "$short*" } } catch {}
if ($have) {
  Log "Model '$Model' already available."
} else {
  Log "Pulling '$Model' (first time can be several GB)…"
  ollama pull $Model
}
Log "Setup complete — print-watch is ready. "
