param([string]$Version='0.1.0',[string]$Revision='')
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$dist=Join-Path $root 'installer\dist'
$stage=Join-Path $root ('work\installer-'+[guid]::NewGuid())
$payload=Join-Path $stage 'payload'
$archive=Join-Path $stage 'boreas.zip'
New-Item -ItemType Directory -Force $payload,$dist | Out-Null
try{
 Get-ChildItem -LiteralPath $root -File -Filter '*.mjs' | Where-Object Name -ne 'implement-libraries.mjs' | Copy-Item -Destination $payload
 foreach($name in 'public','Start-Boreas.ps1'){Copy-Item -LiteralPath (Join-Path $root $name) -Destination $payload -Recurse}
 $sports=Join-Path $payload 'apps\sports-capture'
 New-Item -ItemType Directory -Force $sports | Out-Null
 foreach($name in 'Dockerfile','Setup.ps1','encoding.mjs','health.mjs','policy.mjs','proxy.mjs','sources.mjs','worker.mjs'){
  Copy-Item -LiteralPath (Join-Path $root "apps\sports-capture\$name") -Destination $sports
 }
 & $compiler /nologo /target:winexe "/out:$payload\BoreasTray.exe" /r:System.Windows.Forms.dll /r:System.Drawing.dll (Join-Path $PSScriptRoot 'Tray.cs')
 if($LASTEXITCODE){throw 'Tray build failed.'}
 @{version=$Version;revision=$Revision}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $payload 'boreas-build.json') -Encoding ascii
 Compress-Archive -Path (Join-Path $payload '*') -DestinationPath $archive
 $installer=Join-Path $dist 'BoreasSetup.exe'
 & $compiler /nologo /target:winexe "/out:$installer" "/resource:$archive,Boreas.Payload" /r:System.Windows.Forms.dll /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll /r:System.Web.Extensions.dll (Join-Path $PSScriptRoot 'Setup.cs')
 if($LASTEXITCODE){throw 'Installer build failed.'}
 Write-Output $installer
}finally{
 $resolved=(Resolve-Path -LiteralPath $stage).Path
 $work=(Resolve-Path -LiteralPath (Join-Path $root 'work')).Path
 if($resolved.StartsWith($work+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){Remove-Item -LiteralPath $resolved -Recurse -Force}
}
