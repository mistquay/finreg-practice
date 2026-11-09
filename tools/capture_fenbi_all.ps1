param([string]$Session='finreg-source',[switch]$UseOpenSession,[switch]$SkipImport)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$OutputEncoding=[Console]::OutputEncoding
$env:PYTHONIOENCODING='utf-8'
$cli=(Get-Command npx -ErrorAction Stop).Source
$python=(Get-Command python -ErrorAction Stop).Source
if(-not $UseOpenSession){
    & $cli --yes --package '@playwright/cli' playwright-cli "-s=$Session" open 'https://www.fenbi.com/spa/tiku/guide/realTest/xingce/xingce' --headed
    if($LASTEXITCODE -ne 0){throw 'Unable to open browser'}
    Read-Host 'Log into Fenbi, then press Enter. The collector does not submit answers.'
}
[IO.Directory]::CreateDirectory((Join-Path $root 'data\fenbi')) | Out-Null
& $cli --yes --package '@playwright/cli' playwright-cli "-s=$Session" state-save data/fenbi/session.private.json
if($LASTEXITCODE -ne 0){throw 'Unable to export browser state'}
& $python tools/fenbi_api.py all
if($LASTEXITCODE -ne 0){throw 'Capture was interrupted. Check data/fenbi-api reports, then rerun to resume.'}
if(-not $SkipImport){
    & $python scripts/import_fenbi_api.py
    if($LASTEXITCODE -ne 0){throw 'Import interrupted. Fix the reported error and rerun scripts/import_fenbi_api.py.'}
}
Write-Output 'Finished. Refresh the local app; use subject, paper kind, level and year filters.'