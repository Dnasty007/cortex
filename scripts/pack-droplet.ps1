# Read-only pack of the live Hermes brain. Writes a redacted folder on this PC.
# Does not restart gateway, serve, or Telegram. Does not modify the remote home.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$key = Join-Path $env:USERPROFILE '.ssh\id_ed25519'
if (-not (Test-Path $key)) { $key = Join-Path $env:TEMP 'id_ed25519.restore' }
if (-not (Test-Path $key)) { throw 'SSH key not found. No pack was written.' }
$hostFile = Join-Path $root '.hermes-host'
$target = ''
if ($env:HERMES_SSH) { $target = $env:HERMES_SSH.Trim() }
if (-not $target -and (Test-Path $hostFile)) {
  $target = (Get-Content -Path $hostFile -TotalCount 1).Trim()
}
if (-not $target) { throw 'Set HERMES_SSH to user@host. No pack was written.' }
if ($target -notmatch '^[\w.@:-]+$') { throw 'HERMES_SSH looks wrong. No pack was written.' }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$remoteOut = "/tmp/cortex-pack-$stamp"
$remoteScript = "/tmp/cortex-pack-brain-$stamp.py"
$remoteLock = "/tmp/cortex-pattern-$stamp.lock"
$lock = Join-Path $env:USERPROFILE '.cortex\pattern.lock'
if (-not (Test-Path $lock)) { throw 'Pattern lock missing. No pack was written.' }
$packs = Join-Path $root 'packs'
$downloaded = Join-Path $packs "cortex-pack-$stamp"
$local = Join-Path $packs "droplet-$stamp"
New-Item -ItemType Directory -Force -Path $packs | Out-Null

function Assert-Ok($step) {
  if ($LASTEXITCODE -ne 0) { throw "$step failed with exit $LASTEXITCODE" }
}

$packed = $false
try {
  scp -i $key -o BatchMode=yes (Join-Path $root 'scanner\pack_brain.py') "${target}:${remoteScript}"
  Assert-Ok 'upload packer'
  scp -i $key -o BatchMode=yes $lock "${target}:${remoteLock}"
  Assert-Ok 'upload pattern lock'
  $raw = ssh -i $key -o BatchMode=yes $target "CORTEX_PATTERN_LOCK=$remoteLock python3 $remoteScript --home /root/.hermes --out $remoteOut --label 'Droplet Hermes'"
  Assert-Ok 'remote pack'
  scp -i $key -o BatchMode=yes -r "${target}:${remoteOut}" "$packs\"
  Assert-Ok 'download pack'
  if (-not (Test-Path (Join-Path $downloaded 'manifest.json'))) { throw 'The pack arrived without a manifest.' }
  if (Test-Path $local) { throw 'That pack folder already exists.' }
  Rename-Item -Path $downloaded -NewName (Split-Path -Leaf $local)
  $packed = $true
  $line = @($raw -split "`n" | Where-Object { $_.Trim().StartsWith('{') } | Select-Object -Last 1)
  if (-not $line) { throw 'The pack did not report a result.' }
  $parsed = $line | ConvertFrom-Json
  $parsed.out = $local
  Write-Output ($parsed | ConvertTo-Json -Compress)
} finally {
  ssh -i $key -o BatchMode=yes $target "rm -rf $remoteOut $remoteScript $remoteLock" | Out-Null
  if (-not $packed -and (Test-Path $downloaded)) { Remove-Item -Recurse -Force $downloaded }
  if (-not $packed -and (Test-Path $local)) { Remove-Item -Recurse -Force $local }
}
