import path from 'node:path';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

const invalid=message=>Object.assign(Error(message),{status:400});
export async function createServerPreferences(directory,defaults){
  const file=path.join(directory,'server-preferences.json');
  let current={...defaults};
  try{current={...current,...JSON.parse(await readFile(file,'utf8'))};}
  catch(error){if(error.code!=='ENOENT')throw error;}
  let queue=Promise.resolve();
  function save(change){
    const operation=queue.then(async()=>{
      const next={...current,...change},temporary=file+'.'+randomUUID()+'.tmp';
      await writeFile(temporary,JSON.stringify(next,null,2)+'\n',{mode:0o600});
      await rename(temporary,file);
      current=next;
      return {...current};
    });
    queue=operation.catch(()=>{});
    return operation;
  }
  return {
    get:()=>({...current}),
    saveNetwork(input){
      if(typeof input.publicOrigin!=='string'||input.publicOrigin.length>255)throw invalid('Enter a valid public HTTPS URL.');
      const raw=input.publicOrigin.trim();
      if(!raw)return save({publicOrigin:''});
      let url;
      try{url=new URL(raw);}catch{throw invalid('Enter a valid public HTTPS URL.');}
      if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw invalid('Enter an HTTPS origin without a path, query, or credentials.');
      return save({publicOrigin:url.origin});
    },
    saveUpdateChannel(input){
      if(!['stable','experimental'].includes(input.channel))throw invalid('Choose Stable or Experimental.');
      return save({updateChannel:input.channel});
    },
    saveApps(input){
      if(typeof input.sports!=='boolean'||typeof input.liveTV!=='boolean')throw invalid('Choose which apps to enable.');
      return save({sports:input.sports,liveTV:input.liveTV});
    }
  };
}
