$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RepoRoot

function Resolve-Bun {
  $command = Get-Command bun -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $candidates = @()
  if ($env:BUN_INSTALL) {
    $candidates += Join-Path $env:BUN_INSTALL "bin\bun.exe"
  }
  if ($env:USERPROFILE) {
    $candidates += Join-Path $env:USERPROFILE ".bun\bin\bun.exe"
  }

  $repoPath = $RepoRoot.Path
  if ($repoPath -match "^[A-Za-z]:\\Users\\[^\\]+") {
    $candidates += Join-Path $Matches[0] ".bun\bin\bun.exe"
  }

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  Write-Host "Installing Bun..."
  powershell -NoProfile -ExecutionPolicy Bypass -Command "irm bun.sh/install.ps1 | iex"

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  $installed = Get-Command bun -ErrorAction SilentlyContinue
  if ($installed) {
    return $installed.Source
  }

  throw "Bun was installed, but bun.exe could not be found. Restart the terminal and run this script again."
}

$Bun = Resolve-Bun
$BunDir = Split-Path $Bun -Parent
if (($env:Path -split ";") -notcontains $BunDir) {
  $env:Path = "$BunDir;$env:Path"
}

Write-Host "Installing dependencies..."
& $Bun install

$envPath = Join-Path $RepoRoot ".env.local"
if (-not (Test-Path $envPath)) {
  Write-Host "Configuring Convex. When prompted, choose your personal team."

  $configureArgs = @("node_modules/convex/bin/main.js", "dev", "--once", "--configure")
  if ($env:CONVEX_TEAM) {
    $configureArgs += @("--team", $env:CONVEX_TEAM)
  }

  & $Bun @configureArgs
}

Write-Host "Starting Convex and Vite..."
& $Bun "run" "dev"
