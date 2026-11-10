param([switch]$Apply,[switch]$SkipBuild)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location -LiteralPath $projectRoot
$docker=(Get-Command docker.exe -ErrorAction SilentlyContinue).Source
if(-not $docker){$docker=Join-Path $env:ProgramFiles 'Docker\Docker\resources\bin\docker.exe'}
function DockerCommand([string[]]$Arguments){
 $result=& $docker @Arguments
 if($LASTEXITCODE -ne 0){throw 'Docker operation failed. Check that Docker Desktop is running.'}
 return $result
}
$runtime=if($env:BOREAS_RUNTIME){$env:BOREAS_RUNTIME}else{$projectRoot}
$configPath=Join-Path $runtime 'sports-capture.local.json'
$settings=@{}
if(Test-Path -LiteralPath $configPath){
 $json=Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
 foreach($property in $json.PSObject.Properties){$settings[$property.Name]=$property.Value}
}
if(-not $settings.token){$bytes=New-Object byte[] 32;$rng=[Security.Cryptography.RandomNumberGenerator]::Create();$rng.GetBytes($bytes);$rng.Dispose();$settings.token=([BitConverter]::ToString($bytes)).Replace('-','').ToLowerInvariant()}
if(-not $settings.recordingsDirectory){$settings.recordingsDirectory=Join-Path $runtime 'Sports recordings'}
if(-not $settings.temporaryDirectory){$settings.temporaryDirectory=Join-Path $runtime 'Sports temporary'}
if(-not $settings.maxConcurrent){$settings.maxConcurrent=3}
if($settings.maxConcurrent -notin @(1,2,3,4)){throw 'Capture limit must be between 1 and 4.'}
if(-not $settings.encoder){$settings.encoder='auto'}
if($settings.encoder -notin @('auto','nvenc','cpu')){throw 'Unknown encoder setting.'}
foreach($key in @('recordingsDirectory','temporaryDirectory')){
 if(-not [IO.Path]::IsPathRooted($settings[$key]) -or $settings[$key].Contains(',')){throw 'Use an absolute folder path without commas.'}
 $settings[$key]=[IO.Path]::GetFullPath($settings[$key]).TrimEnd('\')
 if($settings[$key] -eq [IO.Path]::GetPathRoot($settings[$key]).TrimEnd('\')){throw 'Choose a dedicated subfolder, not a drive root.'}
 New-Item -ItemType Directory -Force -Path $settings[$key] | Out-Null
}
$tempPath=$settings.temporaryDirectory
$savedPath=$settings.recordingsDirectory
if($tempPath -eq $savedPath -or $tempPath.StartsWith($savedPath+'\',[StringComparison]::OrdinalIgnoreCase) -or $savedPath.StartsWith($tempPath+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Temporary and finished recordings must use separate folders.'}
$existing=DockerCommand @('ps','-a','--filter','name=^lumen-sports-capture$','--format','{{.Names}}')
if($existing -and -not $Apply){Write-Host 'Capture is already installed. Use -Apply to apply settings when no capture is running.';exit 0}
if($existing){
 $info=(DockerCommand @('inspect','lumen-sports-capture') | ConvertFrom-Json)[0]
 if($info.State.Running){
  $jobs=Invoke-RestMethod 'http://127.0.0.1:47779/jobs' -Headers @{Authorization='Bearer '+$settings.token} -TimeoutSec 10
  if(@($jobs.jobs | Where-Object {$_.state -notin @('complete','failed')}).Count){throw 'Finish or stop the active capture before applying settings.'}
 }
}
if(-not $SkipBuild){DockerCommand @('build','-t','lumen-sports-capture:0.1','-f','apps/sports-capture/Dockerfile','apps/sports-capture') | Out-Host}
else{DockerCommand @('image','inspect','lumen-sports-capture:0.1','--format','{{.Id}}') | Out-Null}
# Keep the old container until the replacement is healthy so failures can roll back.
$backupName='lumen-sports-capture-backup-'+[DateTime]::UtcNow.ToString('yyyyMMddHHmmss')
if($existing){
 DockerCommand @('stop','lumen-sports-capture') | Out-Null
 try{
  $oldMount=@($info.Mounts | Where-Object Destination -eq '/data')[0]
  $oldHostPath=($info.Config.Env | Where-Object {$_ -like 'CAPTURE_HOST_TEMPORARY_DIRECTORY=*'} | Select-Object -First 1) -replace '^CAPTURE_HOST_TEMPORARY_DIRECTORY=',''
  $sameFolder=$oldMount.Type -eq 'bind' -and ($oldHostPath -eq $tempPath -or $oldMount.Source.Replace('/','\').TrimEnd('\') -eq $tempPath)
  if(-not $sameFolder){
   # Copy only worker-owned UUID job directories; never overwrite destination captures.
   $jobIds=DockerCommand @('run','--rm','--volumes-from','lumen-sports-capture:ro','--entrypoint','ls','lumen-sports-capture:0.1','-1','/data')
   foreach($id in $jobIds){
    if($id -notmatch '^[a-f0-9-]{36}$'){continue}
    if(Test-Path -LiteralPath (Join-Path $tempPath $id)){throw 'The destination already contains a capture with the same ID. Choose an empty temporary folder.'}
    DockerCommand @('cp',('lumen-sports-capture:/data/'+$id),$tempPath) | Out-Null
   }
  }
  DockerCommand @('rename','lumen-sports-capture',$backupName) | Out-Null
 }catch{DockerCommand @('start','lumen-sports-capture') | Out-Null;throw}
}
$env:CAPTURE_TOKEN=$settings.token
$env:CAPTURE_ENCODER=$settings.encoder
$env:CAPTURE_MAX_CONCURRENT=[string]$settings.maxConcurrent
$env:CAPTURE_HOST_TEMPORARY_DIRECTORY=$tempPath
try{
 $arguments=@('run','-d','--name','lumen-sports-capture','--restart','unless-stopped','--init','--cpus','6','--memory','5g','--memory-swap','5g','--shm-size','512m','--cap-drop','ALL','--security-opt','no-new-privileges','-p','127.0.0.1:47779:47779','-e','CAPTURE_TOKEN','-e','CAPTURE_ENCODER','-e','CAPTURE_MAX_CONCURRENT','-e','CAPTURE_HOST_TEMPORARY_DIRECTORY','--mount',('type=bind,source='+$tempPath+',target=/data'))
 if($settings.encoder -ne 'cpu'){$arguments+=@('--gpus','all','-e','NVIDIA_DRIVER_CAPABILITIES=compute,video,utility')}
 $arguments+='lumen-sports-capture:0.1'
 DockerCommand $arguments | Out-Null
 $ready=$false
 for($i=0;$i -lt 30;$i++){
  try{$status=Invoke-RestMethod 'http://127.0.0.1:47779/status' -Headers @{Authorization='Bearer '+$settings.token} -TimeoutSec 2;$ready=$true;break}catch{Start-Sleep -Seconds 1}
 }
 if(-not $ready){throw 'Capture did not become ready. The previous service will be restored.'}
 # Preserve export records written while setup was running.
 if(Test-Path -LiteralPath $configPath){$latest=Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json;foreach($property in $latest.PSObject.Properties){if($property.Name -notin @('temporaryDirectory','recordingsDirectory','encoder','maxConcurrent','token')){$settings[$property.Name]=$property.Value}}}
 [IO.File]::WriteAllText($configPath,($settings | ConvertTo-Json -Depth 20),(New-Object Text.UTF8Encoding $false))
 if($existing){DockerCommand @('rm',$backupName) | Out-Null}
 Write-Host ('Sports capture ready: '+$status.encoderMessage)
}catch{
 & $docker rm -f lumen-sports-capture 2>$null | Out-Null
 if($existing){DockerCommand @('rename',$backupName,'lumen-sports-capture') | Out-Null;DockerCommand @('start','lumen-sports-capture') | Out-Null}
 throw
}finally{Remove-Item Env:CAPTURE_TOKEN,Env:CAPTURE_ENCODER,Env:CAPTURE_MAX_CONCURRENT,Env:CAPTURE_HOST_TEMPORARY_DIRECTORY -ErrorAction SilentlyContinue}
