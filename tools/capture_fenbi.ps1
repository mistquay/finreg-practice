param([int[]]$Years=@(2026,2025,2024),[string]$Session='finreg-source',[switch]$UseOpenSession)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root
$cli=(Get-Command npx -ErrorAction Stop).Source
$utf8=New-Object System.Text.UTF8Encoding($false)
$folder=Join-Path $root 'data\fenbi'
[IO.Directory]::CreateDirectory($folder) | Out-Null
function Run-Code([string]$Code) {
    $lines=& $cli --yes --package '@playwright/cli' playwright-cli "-s=$Session" --raw run-code ($Code -replace '[\r\n]+',' ')
    $result=$lines -join "`n"
    if($LASTEXITCODE -ne 0 -or $result.StartsWith('###')) {throw "Browser collector failed: $result"}
    $null=$result | ConvertFrom-Json
    return $result
}
if(-not $UseOpenSession) {
    & $cli --yes --package '@playwright/cli' playwright-cli "-s=$Session" open 'https://www.fenbi.com/spa/tiku/guide/realTest/xingce/xingce' --headed
    Read-Host 'Log into Fenbi in the opened window, then press Enter (no password is stored by this script)'
}
foreach($year in $Years) {
    if($year -lt 2010 -or $year -gt 2100){throw 'Invalid year'}
    & $cli --yes --package '@playwright/cli' playwright-cli "-s=$Session" goto 'https://www.fenbi.com/spa/tiku/guide/realTest/xingce/xingce?redirect=true' | Out-Null
    $title="$($year)年国家公务员录用考试《行测》题（地市级网友回忆版）"
    $titleJson=ConvertTo-Json -Compress -InputObject $title
    $code='async(page)=>{const title=TITLE;const target=page.getByText(title,{exact:true});await target.waitFor({state:"visible",timeout:20000});const loaded=page.waitForResponse(r=>r.url().includes("/combine/static/exercise")&&r.status()===200,{timeout:30000});await target.click();return await(await loaded).json();}'
    $exercise=Run-Code ($code.Replace('TITLE',$titleJson))
    [IO.File]::WriteAllText((Join-Path $folder "$year-exercise-response.txt"),$exercise,$utf8)
    $parsed=$exercise | ConvertFrom-Json
    $idsJson=ConvertTo-Json -Compress -InputObject @($parsed.questions.id)
    $code='async(page)=>{const ids=IDS;const out=[];for(let i=0;i<ids.length;i+=30){const r=await page.request.get("https://tiku.fenbi.com/api/xingce/questions?app=web&kav=131&av=134&hav=128&version=3.0.0.0&ids="+ids.slice(i,i+30).join(","));if(!r.ok())throw new Error("HTTP "+r.status());const data=await r.json();if(!Array.isArray(data))throw new Error("Unexpected response");out.push(...data);await new Promise(resolve=>setTimeout(resolve,800));}return out;}'
    $details=Run-Code ($code.Replace('IDS',$idsJson))
    if(@($details | ConvertFrom-Json).Count -ne @($parsed.questions).Count){throw "Question count mismatch for $year"}
    [IO.File]::WriteAllText((Join-Path $folder "$year-details.json"),$details,$utf8)
    $enrichCode=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'fenbi-enrich.js'),$utf8)
    $extra=Run-Code ($enrichCode.Replace('IDS_PLACEHOLDER',$idsJson))
    [IO.File]::WriteAllText((Join-Path $folder "$year-enrichment.json"),$extra,$utf8)
    Write-Output "$year : $(@($parsed.questions).Count) questions captured. No answers submitted."
}
$pointIds=@(Get-ChildItem -LiteralPath $folder -Filter '*-enrichment.json' | ForEach-Object {
    $enriched=[IO.File]::ReadAllText($_.FullName,$utf8) | ConvertFrom-Json
    $enriched.keypoints.PSObject.Properties | ForEach-Object { $_.Value | ForEach-Object { $_.id } }
} | Sort-Object -Unique)
$pointCode=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'fenbi-keypoints.js'),$utf8)
$catalog=Run-Code ($pointCode.Replace('IDS_PLACEHOLDER',(ConvertTo-Json -Compress -InputObject $pointIds)))
[IO.File]::WriteAllText((Join-Path $folder 'keypoint-catalog.json'),$catalog,$utf8)
& $cli --yes --package '@playwright/cli' playwright-cli "-s=$Session" goto 'https://www.fenbi.com/spa/tiku/guide/realTest/xingce/xingce?redirect=true' | Out-Null
Write-Output 'Next: python scripts/import_fenbi.py, then import data/fenbi-bank.json in the local app.'
