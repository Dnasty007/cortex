# Open Hermes Cortex as a desktop window. Starts the local server if it
# is down, then opens Edge in app mode. While that server is up, a localhost
# door on the droplet lets Hermes search the same map. The app is not hosted
# on the droplet.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$logDir = Join-Path $env:LOCALAPPDATA 'HermesCortex'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir 'launcher.log'

function Write-Log($message) {
  $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $message
  Add-Content -Path $log -Value $line
}

function Test-Port {
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $client.Connect('127.0.0.1', 5179)
    $client.Close()
    return $true
  } catch {
    return $false
  }
}

Set-Location $root
if (-not (Test-Port)) {
  if (-not (Test-Path (Join-Path $root 'node_modules'))) {
    Write-Log 'installing npm packages'
    & npm.cmd install
    if ($LASTEXITCODE -ne 0) { Write-Log 'npm install failed'; exit 1 }
  }
  Write-Log 'starting cortex server'
  $nodeExe = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
  if (-not $nodeExe) { $nodeExe = "$env:ProgramFiles\nodejs\node.exe" }
  $vite = Join-Path $root 'node_modules\vite\bin\vite.js'
  $serverCmd = "`"$nodeExe`" `"$vite`""
  $spawn = ([wmiclass]'Win32_Process').Create($serverCmd, $root)
  Write-Log ("server spawn " + $spawn.ReturnValue + " pid " + $spawn.ProcessId)
  $ready = $false
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-Port) { $ready = $true; break }
  }
  if (-not $ready) { Write-Log 'server did not open 5179'; exit 1 }
}

$edge = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
if (-not (Test-Path $edge)) { $edge = "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe" }
$profile = Join-Path $logDir 'edge'
Start-Process -FilePath $edge -ArgumentList @(
  '--app=http://127.0.0.1:5179/',
  "--user-data-dir=$profile",
  '--window-size=1440,900',
  '--no-first-run'
)
Write-Log 'opened desktop window'

$ssh = "$env:SystemRoot\System32\OpenSSH\ssh.exe"
$key = Join-Path $env:USERPROFILE '.ssh\id_ed25519'
$tunnelUp = $false
Get-CimInstance Win32_Process -Filter "Name = 'ssh.exe'" | ForEach-Object {
  if ($_.CommandLine -match '25179:127.0.0.1:5179') { $tunnelUp = $true }
}
$hostFile = Join-Path $root '.hermes-host'
$target = ''
if (Test-Path $hostFile) { $target = (Get-Content -Path $hostFile -TotalCount 1).Trim() }
if (-not $tunnelUp -and $target -match '^[\w.@:-]+$' -and (Test-Path $ssh) -and (Test-Path $key)) {
  $tunnelErr = Join-Path $logDir 'tunnel.err'
  $tunnelCmd = "cmd.exe /c `"`"$ssh`" -i `"$key`" -o BatchMode=yes -o ExitOnForwardFailure=yes -o TCPKeepAlive=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=4 -o StrictHostKeyChecking=accept-new -N -R 127.0.0.1:25179:127.0.0.1:5179 $target >> `"$tunnelErr`" 2>&1`""
  $spawn = ([wmiclass]'Win32_Process').Create($tunnelCmd, $root)
  Start-Sleep -Seconds 2
  $alive = Get-Process -Id $spawn.ProcessId -ErrorAction SilentlyContinue
  if ($spawn.ReturnValue -ne 0 -or -not $alive) {
    Write-Log ("tunnel failed code " + $spawn.ReturnValue)
  } else {
    Write-Log ("tunnel up pid " + $spawn.ProcessId)
  }
} else {
  Write-Log 'tunnel already up or ssh key missing'
}
