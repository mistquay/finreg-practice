param([int]$Port=8765,[switch]$NoBrowser)
$ErrorActionPreference='Stop'
Set-Location -LiteralPath $PSScriptRoot
$python=Get-Command python -ErrorAction SilentlyContinue
if($python){$runtime=$python.Source}else{$runtime=Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'}
if(!(Test-Path -LiteralPath $runtime)){throw 'Python 3.10+ is required. Install Python and run this script again.'}
try {
    $existing=Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/meta" -TimeoutSec 2
    if($existing.counts -and $existing.papers){
        if(-not $NoBrowser){Start-Process "http://127.0.0.1:$Port"}
        Write-Output "FinReg Practice is already running at http://127.0.0.1:$Port"
        return
    }
} catch {}
if(-not $NoBrowser){Start-Process "http://127.0.0.1:$Port"}
& $runtime (Join-Path $PSScriptRoot 'app.py') --port $Port
