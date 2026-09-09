# Сохраняет все заявки TLS Service SPB на жёсткий диск этого ПК.
# Запуск: правый клик → «Выполнить с PowerShell»
# Или в терминале: powershell -ExecutionPolicy Bypass -File .\scripts\backup-to-pc.ps1

param(
  [string]$SiteUrl = "https://tls-service-spb.onrender.com",
  [string]$Login = "admin",
  [string]$Password = "admin123",
  [string]$OutDir = "$env:USERPROFILE\Documents\TLS-Service-backups"
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$base = $SiteUrl.TrimEnd("/")
Write-Host "Вход на $base ..."

$loginBody = @{ login = $Login; password = $Password } | ConvertTo-Json
$auth = Invoke-RestMethod -Method Post -Uri "$base/api/auth/login" -ContentType "application/json" -Body $loginBody
$token = $auth.token
if (-not $token) { throw "Не удалось получить токен. Проверьте логин и пароль." }

$stamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$outFile = Join-Path $OutDir "tls-bookings-$stamp.json"

Write-Host "Скачивание заявок..."
Invoke-WebRequest -Uri "$base/api/backup/download" -Headers @{ Authorization = "Bearer $token" } -OutFile $outFile

Write-Host "Готово: $outFile"
Write-Host "Совет: добавьте этот скрипт в Планировщик заданий Windows (раз в день)."
