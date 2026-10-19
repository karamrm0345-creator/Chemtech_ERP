# Chemtech ERP - run on a Windows PC without Docker.
# Needs: Node.js LTS (https://nodejs.org) and PostgreSQL 16 (https://www.postgresql.org/download/windows/).
# Usage: double-click start-windows.bat, or run:  powershell -ExecutionPolicy Bypass -File .\start-windows.ps1
# Add -Rebuild after pulling new code.
param([switch]$Rebuild)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Step($msg) { Write-Host ""; Write-Host "> $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host ""; Write-Host "X $msg" -ForegroundColor Red; Read-Host "Press Enter to close"; exit 1 }
function Run($exe, [string[]]$argv) { & $exe @argv; if ($LASTEXITCODE -ne 0) { Fail "Command failed: $exe $($argv -join ' ')" } }
function NewSecret([int]$n) { -join ((48..57) + (65..90) + (97..122) | Get-Random -Count $n | ForEach-Object { [char]$_ }) }
function ReadEnvValue($key) {
  $line = Get-Content .env | Where-Object { $_ -match "^$key=" } | Select-Object -First 1
  if ($line) { return ($line -replace "^$key=", "").Trim('"') } else { return $null }
}

Step "Checking Node.js"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Fail "Node.js is not installed. Install the LTS version from https://nodejs.org, restart the PC, then run this again." }
node --version

Step "Checking PostgreSQL"
$psql = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\psql.exe" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
if (-not $psql) { Fail "PostgreSQL is not installed. Install version 16 from https://www.postgresql.org/download/windows/ (remember the 'postgres' password), then run this again." }
Write-Host $psql.FullName

if (-not (Test-Path .env) -or -not (Select-String -Path .env -Pattern "^DATABASE_URL=" -Quiet)) {
  Step "First-time setup: creating the database"
  $sec = Read-Host "Enter the password you chose for the 'postgres' user when installing PostgreSQL" -AsSecureString
  $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
  $dbPass = NewSecret 24
  $roleExists = "$(& $psql.FullName -U postgres -h localhost -tAc "SELECT 1 FROM pg_roles WHERE rolname='chemtech'")".Trim()
  if ($LASTEXITCODE -ne 0) { Fail "Could not connect to PostgreSQL. Check the 'postgres' password and that the PostgreSQL service is running." }
  if ($roleExists -eq "1") { Run $psql.FullName @("-U","postgres","-h","localhost","-c","ALTER ROLE chemtech WITH LOGIN PASSWORD '$dbPass'") }
  else { Run $psql.FullName @("-U","postgres","-h","localhost","-c","CREATE ROLE chemtech WITH LOGIN CREATEDB PASSWORD '$dbPass'") }
  $dbExists = "$(& $psql.FullName -U postgres -h localhost -tAc "SELECT 1 FROM pg_database WHERE datname='chemtech_erp'")".Trim()
  if ($dbExists -ne "1") { Run $psql.FullName @("-U","postgres","-h","localhost","-c","CREATE DATABASE chemtech_erp OWNER chemtech") }
  Remove-Item Env:PGPASSWORD

  Write-Host ""
  Write-Host "Choose a password for the demo users (at least 10 characters, letters AND numbers, e.g. ChemDemo2026)."
  do {
    $demo = Read-Host "Demo password"
    $ok = $demo.Length -ge 10 -and $demo -match "[A-Za-z]" -and $demo -match "\d"
    if (-not $ok) { Write-Host "Too weak - use at least 10 characters with letters and numbers." -ForegroundColor Yellow }
  } until ($ok)

  @(
    "DATABASE_URL=""postgresql://chemtech:$dbPass@localhost:5432/chemtech_erp?schema=public""",
    "SESSION_SECRET=""$(NewSecret 48)""",
    "UPLOAD_DIR=""./storage/uploads""",
    "INSECURE_COOKIES=""1""",
    "DEMO_PASSWORD=""$demo"""
  ) | Set-Content .env -Encoding ascii
  $Rebuild = $true
}

$env:DATABASE_URL = ReadEnvValue "DATABASE_URL"
$env:UPLOAD_DIR = ReadEnvValue "UPLOAD_DIR"
$demoPw = ReadEnvValue "DEMO_PASSWORD"

if ($Rebuild -or -not (Test-Path node_modules)) { Step "Installing packages (a few minutes the first time)"; Run npm.cmd @("ci","--no-audit","--no-fund"); Run npx.cmd @("prisma","generate") }

Step "Applying database migrations"
Run npx.cmd @("prisma","migrate","deploy")
Step "Loading reference data"
Run npx.cmd @("tsx","prisma/seed-base.ts")
if ($demoPw) {
  Step "Loading fictional demo data (skipped if already loaded)"
  $env:NODE_ENV = "development"; $env:ALLOW_DEMO_SEED = "1"; $env:DEMO_PASSWORD = $demoPw
  Run npx.cmd @("tsx","prisma/seed-demo.ts")
  Remove-Item Env:ALLOW_DEMO_SEED, Env:DEMO_PASSWORD
}

if ($Rebuild -or -not (Test-Path .next\BUILD_ID)) { Step "Building the app (2-5 minutes)"; $env:NODE_ENV = "production"; Run npm.cmd @("run","build") }

Step "Starting Chemtech ERP on http://localhost:3000  (close this window or press Ctrl+C to stop)"
Write-Host "Sign in as gm@chemtech.demo with your demo password." -ForegroundColor Green
$env:NODE_ENV = "production"; $env:INSECURE_COOKIES = "1"
Start-Job { Start-Sleep 6; Start-Process "http://localhost:3000" } | Out-Null
& npx.cmd next start -p 3000
