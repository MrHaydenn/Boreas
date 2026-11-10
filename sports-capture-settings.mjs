import path from 'node:path';
import {execFile} from 'node:child_process';

export function validateCaptureSettings(input, current, directory) {
  const settings = {
    recordingsDirectory:input.recordingsDirectory ?? current.recordingsDirectory ?? path.join(directory,'Sports recordings'),
    temporaryDirectory:input.temporaryDirectory ?? current.temporaryDirectory ?? path.join(directory,'Sports temporary'),
    maxConcurrent:input.maxConcurrent ?? current.maxConcurrent ?? 3,
    encoder:input.encoder ?? current.encoder ?? 'auto',
  };
  if(!Number.isInteger(settings.maxConcurrent)||settings.maxConcurrent<1||settings.maxConcurrent>4)throw Error('Choose a simultaneous capture limit from 1 to 4.');
  if (!['auto','nvenc','cpu'].includes(settings.encoder)) throw Error('Choose Automatic, NVIDIA GPU, or CPU encoding.');
  for (const key of ['recordingsDirectory','temporaryDirectory']) {
    const value=settings[key];
    if (typeof value !== 'string' || !path.isAbsolute(value) || value.length > 500 || /[,\x00-\x1f]/.test(value)) throw Error('Enter an absolute folder path on the Lumen server, without commas.');
    settings[key]=path.resolve(value);
    if (settings[key] === path.parse(settings[key]).root) throw Error('Choose a dedicated subfolder, not a drive root.');
  }
  const a=settings.recordingsDirectory.toLowerCase(),b=settings.temporaryDirectory.toLowerCase();
  if(a===b || a.startsWith(b+path.sep) || b.startsWith(a+path.sep)) throw Error('Temporary and finished recordings must use separate folders.');
  return settings;
}

export function applyCaptureService(directory) {
  if(process.platform!=='win32') return Promise.reject(Error('Apply capture settings using your container manager on this server.'));
  return new Promise((resolve,reject)=>{
    execFile('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(directory,'apps','sports-capture','Setup.ps1'),'-Apply','-SkipBuild'],{cwd:directory,windowsHide:true,timeout:180000,maxBuffer:65536},error=>{
      if(error) reject(Error('Capture settings could not be applied. Check Docker Desktop and ensure no capture is running. The previous service is retained when setup fails.'));
      else resolve();
    });
  });
}
