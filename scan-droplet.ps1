# Read-only scan of a Hermes brain on a server you name. Writes a map on this PC.
# Does not restart gateway, serve, or Telegram. Removes the temp file after.
# The server address lives in .hermes-host as user@host. That file stays off git.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$key = Join-Path $env:USERPROFILE '.ssh\id_ed25519'
$hostFile = Join-Path $root '.hermes-host'
if (-not (Test-Path $hostFile)) { throw 'Add user@host to .hermes-host. No scan was written.' }
$target = (Get-Content -Path $hostFile -TotalCount 1).Trim()
if ($target -notmatch '^[\w.@:-]+$') { throw 'The host file looks wrong. No scan was written.' }
$sshHost = $target
if ($target -match '@([^@]+)$') { $sshHost = $Matches[1] }
if ($sshHost -notmatch '^[\w.:-]+$') { throw 'The host file looks wrong. No scan was written.' }
New-Item -ItemType Directory -Force -Path (Join-Path $root 'public') | Out-Null
function Assert-Ok($step) {
  if ($LASTEXITCODE -ne 0) { throw "$step failed with exit $LASTEXITCODE" }
}
scp -i $key -o BatchMode=yes (Join-Path $root 'scanner\scan_brain.py') "${target}:/tmp/hermes_brain_scan.py"
Assert-Ok 'upload scanner'
ssh -i $key -o BatchMode=yes $target "python3 /tmp/hermes_brain_scan.py --home /root/.hermes --out /tmp/hermes-brain.json --label 'Droplet Hermes' --host '$sshHost'"
Assert-Ok 'remote scan'
scp -i $key -o BatchMode=yes "${target}:/tmp/hermes-brain.json" (Join-Path $root 'public\brain.droplet.json')
Assert-Ok 'download map'
ssh -i $key -o BatchMode=yes $target 'rm -f /tmp/hermes-brain.json /tmp/hermes_brain_scan.py'
Assert-Ok 'remove temp scan'
Write-Output "Wrote public\brain.droplet.json"
