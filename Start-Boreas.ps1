param([switch]$Stop)
$ErrorActionPreference='Stop'
$lumenNativeRoot=$PSScriptRoot
$runtime=$lumenNativeRoot
if(Test-Path -LiteralPath (Join-Path $lumenNativeRoot 'boreas-installed')){
 $runtime=Join-Path $env:LOCALAPPDATA 'Boreas'
 $env:BOREAS_RUNTIME=$runtime
}
$configFile=Join-Path $runtime 'boreas.config.json'
if(-not(Test-Path -LiteralPath $configFile)){$configFile=Join-Path $lumenNativeRoot 'lumen-native.config.json'}
$config=Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json
$port=[int]$config.port
$pidFile=Join-Path $runtime 'work\server-process.json'
if($Stop){
 if(-not(Test-Path -LiteralPath $pidFile)){Write-Output 'No Boreas launcher record was found.';exit}
 $saved=Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json
 $process=Get-Process -Id $saved.id -ErrorAction SilentlyContinue
 if($process -and $process.StartTime.ToUniversalTime().Ticks -eq ([datetime]$saved.started).ToUniversalTime().Ticks){
  # Windows does not automatically terminate FFmpeg when its Node parent exits.
  # Only stop FFmpeg children of this verified Native server process.
  Get-CimInstance Win32_Process -Filter "ParentProcessId = $($process.Id)" | Where-Object { $_.Name -eq 'ffmpeg.exe' } | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
  Stop-Process -Id $process.Id;Write-Output 'Stopped Boreas only.'
 }else{Write-Output 'Boreas is not running with this launcher record.'}
 exit
}
try{
 $status=Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/status" -TimeoutSec 2
 if($status.application -eq 'lumen-native'){Write-Output "Boreas is already running: http://localhost:$port";exit}
 throw "Port $port belongs to another application. Choose another port in the server configuration."
}catch{if($_.Exception.Message -like '*belongs to another application*'){throw}}
$node=if($config.nodeExecutable){$config.nodeExecutable}else{(Get-Command node.exe -ErrorAction Stop).Source}
if(-not $env:LUMEN_NATIVE_FFMPEG){
 $ffmpeg=Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
 if($ffmpeg){$env:LUMEN_NATIVE_FFMPEG=$ffmpeg.Source}
}
if(-not $env:LUMEN_NATIVE_FFPROBE){
 $ffprobe=Get-Command ffprobe.exe -ErrorAction SilentlyContinue
 if($ffprobe){$env:LUMEN_NATIVE_FFPROBE=$ffprobe.Source}
}
$logDirectory=Join-Path $runtime 'work\logs'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$process=Start-Process -FilePath $node -ArgumentList ('"'+(Join-Path $lumenNativeRoot 'server.mjs')+'"') -WorkingDirectory $lumenNativeRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDirectory "$stamp-out.log") -RedirectStandardError (Join-Path $logDirectory "$stamp-error.log") -PassThru
@{id=$process.Id;started=$process.StartTime.ToUniversalTime().ToString('o')}|ConvertTo-Json|Set-Content -LiteralPath $pidFile
for($attempt=0;$attempt -lt 40;$attempt++){
 if($process.HasExited){throw "Boreas could not start. See $logDirectory. No other application was stopped."}
 try{$status=Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/status" -TimeoutSec 2;if($status.application -eq 'lumen-native'){Write-Output "Boreas is running: http://localhost:$port";exit}}catch{}
 Start-Sleep -Milliseconds 250
}
throw "Boreas did not become ready. See $logDirectory."
