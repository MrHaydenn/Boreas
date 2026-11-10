import path from 'node:path';
import {readFile} from 'node:fs/promises';

const repository='MrHaydenn/Boreas';
const github='https://github.com/'+repository;
const versionParts=value=>/^v?(\d+)\.(\d+)\.(\d+)$/.exec(value||'')?.slice(1).map(Number);
function newer(tag,current){
  const next=versionParts(tag),previous=versionParts(current);
  if(!next||!previous)return false;
  return (next.find((value,index)=>value!==previous[index])??0) >
    (previous.find((value,index)=>value!==next[index])??0);
}
export async function createUpdateCheck(directory,fetcher=fetch){
  const build=await readFile(path.join(directory,'boreas-build.json'),'utf8').then(JSON.parse).catch(()=>({version:'0.1.0'}));
  const cache=new Map(),pending=new Map();
  async function get(endpoint,{missing=false}={}){
    const response=await fetcher('https://api.github.com/repos/'+repository+endpoint,{
      headers:{Accept:'application/vnd.github+json','User-Agent':'Boreas-update-check'},
      signal:AbortSignal.timeout(6000),redirect:'error'
    });
    if(missing&&response.status===404)return null;
    if(!response.ok)throw Object.assign(Error('Could not check GitHub for updates. Try again shortly.'),{status:502});
    return response.json();
  }
  async function check(channel){
    const current={version:build.version,revision:build.revision||null,channel};
    if(channel==='stable'){
      const release=await get('/releases/latest',{missing:true});
      if(!release||!newer(release.tag_name,build.version))return {...current,update:null};
      const tag=release.tag_name;
      const hasInstaller=release.assets?.some(asset=>asset.name==='BoreasSetup.exe'&&asset.state==='uploaded');
      return {...current,update:{label:tag,url:github+'/releases/'+(hasInstaller?'download/':'tag/')+encodeURIComponent(tag)+(hasInstaller?'/BoreasSetup.exe':''),kind:'release'}};
    }
    const repo=await get('');
    const head=(await get('/commits/'+encodeURIComponent(repo.default_branch))).sha;
    if(!/^[a-f0-9]{40}$/.test(head))throw Error('GitHub returned an invalid commit.');
    const base=build.revision||'v'+build.version;
    const comparison=await get('/compare/'+encodeURIComponent(base)+'...'+head,{missing:true});
    if(head===build.revision||comparison?.ahead_by===0)return {...current,update:null};
    const builds=await get('/actions/workflows/windows-build.yml/runs?head_sha='+head+'&status=success&per_page=1',{missing:true});
    const run=builds?.workflow_runs?.[0]?.id;
    return {...current,update:{label:head.slice(0,8),kind:'commit',url:Number.isSafeInteger(run)?github+'/actions/runs/'+run:github+'/commit/'+head,installerReady:Number.isSafeInteger(run)}};
  }
  return channel=>{
    const saved=cache.get(channel);
    if(saved&&Date.now()-saved.at<60000)return Promise.resolve(saved.result);
    if(!pending.has(channel))pending.set(channel,check(channel).then(result=>{
      cache.set(channel,{at:Date.now(),result});return result;
    }).finally(()=>pending.delete(channel)));
    return pending.get(channel);
  };
}
