import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,open,readFile,realpath,stat,lstat,writeFile,rename,unlink} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';

const run=promisify(execFile);
const worker=fileURLToPath(import.meta.url);
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const contains=(parent,child)=>{
  const relative=path.relative(parent,child);
  return relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));
};

export function createStorageMove(program,data,enabled){
  const work=path.join(program,'work'),job=path.join(work,'storage-move.json'),lock=job+'.lock';
  async function status(){
    try{return JSON.parse(await readFile(job,'utf8'));}
    catch{return null;}
  }
  async function queue(folder,mediaRoots){
    if(!enabled||process.platform!=='win32')throw fail('Data moves require Boreas to run through its Windows launcher.',409);
    if(typeof folder!=='string'||!path.isAbsolute(folder)||/[\x00-\x1f]/.test(folder)||/^\\\\[.?]\\/.test(folder))throw fail('Choose a server folder.');
    let parent;
    try{parent=await realpath(folder);if(!(await stat(parent)).isDirectory())throw Error();}
    catch{throw fail('The destination folder is unavailable.');}
    const destination=path.join(parent,'Data');
    const current=await realpath(data),programRoot=await realpath(program);
    if(contains(programRoot,destination)||contains(destination,programRoot)||contains(current,destination)||contains(destination,current)||mediaRoots.some(root=>contains(root,destination)||contains(destination,root)))throw fail('Choose a location outside the Program, Data, and library folders.');
    try{await lstat(destination);throw fail('A Data folder already exists in that location.');}catch(error){if(error.code!=='ENOENT')throw error;}
    const record=JSON.parse(await readFile(path.join(work,'server-process.json'),'utf8').catch(()=> '{}'));
    if(record.id!==process.pid)throw fail('Start Boreas through its Windows launcher before moving Data.',409);
    await mkdir(work,{recursive:true});
    let guard;
    try{guard=await open(lock,'wx');}catch(error){if(error.code==='EEXIST')throw fail('A Data move is already running.',409);throw error;}
    await guard.close();
    try{
      const pending={state:'moving',destination};
      await writeFile(job,JSON.stringify(pending));
      const child=spawn(process.execPath,[worker,program,destination],{detached:true,windowsHide:true,stdio:'ignore'});
      await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
      child.unref();
      return pending;
    }catch(error){
      await writeFile(job,JSON.stringify({state:'failed',message:'The move could not start.'}));
      await unlink(lock).catch(()=>{});
      throw error;
    }
  }
  return {status,queue};
}

async function move(program,destination){
  const job=path.join(program,'work','storage-move.json');
  const powershell=path.join(process.env.SystemRoot||'C:/Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  const launcher=['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(program,'Start-Boreas.ps1')];
  const options={cwd:program,windowsHide:true};
  let result={state:'failed',message:'The move failed. Check the Data folder location and available space.'};
  try{
    await new Promise(resolve=>setTimeout(resolve,800));
    await run(powershell,[...launcher,'-Stop'],options);
    await run(process.execPath,[path.join(program,'move-data.mjs'),destination],options);
    result={state:'complete',destination};
  }catch(error){
    if(error.stderr&&typeof error.stderr==='string')result.message=error.stderr.trim().slice(0,300)||result.message;
  }
  try{
    await run(powershell,launcher,options);
  }catch{
    result={...result,restartFailed:true};
  }finally{
    const temp=job+'.tmp';
    await writeFile(temp,JSON.stringify(result));
    await rename(temp,job);
    await unlink(job+'.lock');
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  move(process.argv[2],process.argv[3]).catch(()=>{process.exitCode=1;});
}
