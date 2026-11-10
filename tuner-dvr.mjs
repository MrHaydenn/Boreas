import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {open,readFile,realpath,rename,rm,writeFile} from 'node:fs/promises';

const fail=(message,status=400)=>Object.assign(Error(message),{status});
const active=['InProgress','Finalizing'];
const day=86400000;
const padding=value=>Math.min(3600,Math.max(0,Math.round(Number(value)||0)));
const libraryTypes=new Set(['home-videos','movies','shows','anime']);

export async function createTunerDVR(directory,liveTV,libraries,{enabled=()=>true}={}) {
  const file=path.join(directory,'tuner-dvr.json'),owner='native-dvr';
  let state={recordings:[],rules:[]},pending=Promise.resolve(),closed=false;
  const jobs=new Map();
  try{state=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  const interrupted=state.recordings.filter(row=>active.includes(row.Status));
  for(const row of interrupted){
    row.Status='Error';
    row.Error='The server stopped during capture.';
  }
  async function save(){
    const temp=file+'.tmp';
    await writeFile(temp,JSON.stringify(state));
    await rename(temp,file);
  }
  function serialize(work){
    const task=pending.then(work);
    pending=task.catch(()=>{});
    return task;
  }
  function destinations(allowed){
    return libraries.list(true).filter(library=>library.enabled&&libraryTypes.has(library.type)&&allowed(library.id));
  }
  function view({fileName,folder,...row}){
    const library=destinations(id=>id===row.LibraryId)[0];
    return {...row,FolderIndex:library?.paths.indexOf(folder)??-1};
  }
  function get(id,allowed){
    const row=state.recordings.find(item=>item.Id===id&&allowed(item.LibraryId));
    if(!row)throw fail('Recording not found.',404);
    return row;
  }
  function enqueue(program,options){
    const existing=state.recordings.find(row=>row.ProgramId===program.Id&& !['Cancelled','Error'].includes(row.Status));
    if(existing)return existing;
    const row={...options,Id:randomUUID(),ProgramId:program.Id,ChannelId:program.ChannelId,ChannelName:program.ChannelName,
      Name:program.Name,EpisodeTitle:program.EpisodeTitle||'',StartDate:program.StartDate,EndDate:program.EndDate,Status:'New'};
    state.recordings.push(row);
    return row;
  }
  async function finish(row){
    const job=jobs.get(row.Id);
    if(!job)return;
    row.Status='Finalizing';
    const output=path.join(row.folder,row.fileName),temp=output+'.partial';
    try{
      await liveTV.finalize(owner,job,temp);
      await rename(temp,output);
      row.Status='Completed';
      try{libraries.startScan(row.LibraryId);}catch{}
    }catch(error){row.Status='Error';row.Error=error.message;await rm(temp,{force:true}).catch(()=>{});}
    finally{jobs.delete(row.Id);}
  }
  async function tick(){
    if(closed)return;
    let changed=false;
    const now=Date.now();
    for(const row of state.recordings){
      if(row.Status==='InProgress'&&(Date.parse(row.EndDate)+row.PostPaddingSeconds*1000<=now||liveTV.ended(owner,jobs.get(row.Id)))){
        await finish(row);changed=true;
      }
      if(row.Status!=='New'||!enabled())continue;
      if(Date.parse(row.EndDate)<=now){row.Status='Error';row.Error='The airing ended before a tuner became available.';changed=true;continue;}
      if(Date.parse(row.StartDate)-row.PrePaddingSeconds*1000>now)continue;
      if([...jobs.keys()].some(id=>state.recordings.find(item=>item.Id===id)?.ChannelId===row.ChannelId))continue;
      try{
        if(!destinations(id=>id===row.LibraryId).some(library=>library.paths.includes(row.folder))||await realpath(row.folder)!==row.folder)throw fail('The recording folder is no longer available.');
        const [tuner,number]=row.ChannelId.split('~');
        const job=await liveTV.start(owner,{tuner,number},true);
        jobs.set(row.Id,job.id);
        row.Status='InProgress';row.RecordedAt=new Date().toISOString();changed=true;
      }catch(error){if(error.status!==409){row.Status='Error';row.Error=error.message;changed=true;}}
    }
    if(changed)await save();
  }
  let nextRules=0;
  async function refreshRules(){
    if(closed||!enabled()||Date.now()<nextRules||!state.rules.length)return;
    nextRules=Date.now()+15*60000;
    const start=Date.now();
    let changed=false;
    for(const rule of state.rules){
      const {programs}=await liveTV.guideWindow(start,start+14*day,rule.Name);
      for(const program of programs){
        if(program.ChannelId!==rule.ChannelId||program.Name!==rule.Name)continue;
        const count=state.recordings.length;
        enqueue(program,{LibraryId:rule.LibraryId,folder:rule.folder,PrePaddingSeconds:rule.PrePaddingSeconds,PostPaddingSeconds:rule.PostPaddingSeconds,RuleId:rule.Id});
        const row=state.recordings.at(-1);
        if(state.recordings.length>count){assignFileName(row);changed=true;}
      }
    }
    if(changed)await save();
  }
  function assignFileName(row){
    const title=row.Name.replace(/[<>:"/\\|?*\x00-\x1f]/g,' ').trim().slice(0,100)||'Live TV';
    row.fileName=title+' - '+row.StartDate.slice(0,16).replace(':','')+' - '+row.Id+'.mp4';
  }
  let tickPending=false;
  const timer=setInterval(()=>{
    if(tickPending)return;
    tickPending=true;
    void serialize(async()=>{await tick();await refreshRules();})
      .catch(error=>console.error('Live TV DVR:',error.message))
      .finally(()=>{tickPending=false;});
  },5000);
  timer.unref();
  if(interrupted.length)await save();
  return {
    list(allowed){return {recordings:state.recordings.filter(row=>allowed(row.LibraryId)).map(view),rules:state.rules.filter(rule=>allowed(rule.LibraryId)).map(view)};},
    destinations(allowed){return destinations(allowed).map(library=>({id:library.id,name:library.name,folders:library.paths.map((folder,index)=>({index,name:path.basename(folder)}))}));},
    channel(channelId,allowed){const row=state.recordings.find(row=>row.ChannelId===channelId&&row.Status==='InProgress'&&allowed(row.LibraryId));return row?view(row):null;},
    create(input,allowed,releaseViewer){return serialize(async()=>{
      const library=destinations(allowed).find(library=>library.id===input.libraryId),folder=library?.paths[Number(input.folder??0)];
      if(!folder)throw fail('Choose an available recording library and folder.');
      const now=Date.now(),start=Number(input.start),end=Number(input.end);
      let program;
      if(input.programId){
        const stamp=Number(String(input.programId).split('~').at(-1));
        const result=await liveTV.guideWindow(stamp,stamp+1);
        program=result.programs.find(entry=>entry.Id===input.programId);
        if(!program||Date.parse(program.EndDate)<=now)throw fail('This airing is no longer available.',404);
      }else{
        const channel=liveTV.channels().find(entry=>entry.tuner+'~'+entry.number===input.channelId);
        if(!channel||!Number.isFinite(start)||!Number.isFinite(end)||end<=Math.max(now,start)||end-start>12*3600000||start>now+14*day||start<now-60000)throw fail('Choose a channel and a recording time of up to 12 hours.');
        program={Id:'manual~'+randomUUID(),ChannelId:input.channelId,ChannelName:channel.name,Name:String(input.title||channel.name).trim().slice(0,120)||channel.name,StartDate:new Date(start).toISOString(),EndDate:new Date(end).toISOString()};
      }
      if(Date.parse(program.EndDate)-Date.parse(program.StartDate)>day)throw fail('This airing is too long to record.');
      const options={LibraryId:library.id,folder,PrePaddingSeconds:padding(input.pre),PostPaddingSeconds:padding(input.post)};
      const duplicate=state.recordings.find(row=>row.ProgramId===program.Id&&!['Error','Cancelled'].includes(row.Status));
      if(duplicate&&!allowed(duplicate.LibraryId))throw fail('This airing is already scheduled.',409);
      if(input.series&&input.programId){
        let rule=state.rules.find(row=>row.ChannelId===program.ChannelId&&row.Name===program.Name&&row.LibraryId===library.id);
        if(!rule){rule={...options,Id:randomUUID(),Name:program.Name,ChannelId:program.ChannelId,ChannelName:program.ChannelName};state.rules.push(rule);}
        options.RuleId=rule.Id;nextRules=0;
      }
      const row=enqueue(program,options);
      if(!row.fileName)assignFileName(row);
      await save();
      if(releaseViewer&&Date.parse(row.StartDate)<=now)await releaseViewer().catch(()=>{});
      await tick();
      return view(row);
    });},
    update(id,input,allowed){return serialize(async()=>{
      const row=get(id,allowed);
      if(row.Status!=='New')throw fail('Only upcoming recordings can be edited.',409);
      const library=destinations(allowed).find(entry=>entry.id===input.libraryId);
      const folder=library?.paths[Number(input.folder??0)];
      if(!folder)throw fail('Choose an available recording library and folder.');
      const changes={LibraryId:library.id,folder,PrePaddingSeconds:padding(input.pre),PostPaddingSeconds:padding(input.post)};
      if(row.ProgramId.startsWith('manual~')){
        const start=Number(input.start),end=Number(input.end),now=Date.now();
        const channel=liveTV.channels().find(entry=>entry.tuner+'~'+entry.number===input.channelId);
        if(!channel||!Number.isFinite(start)||!Number.isFinite(end)||end<=Math.max(now,start)||start<now-60000||start>now+14*day||end-start>12*3600000)throw fail('Choose a channel and a recording time of up to 12 hours.');
        Object.assign(changes,{ChannelId:input.channelId,ChannelName:channel.name,Name:String(input.title||channel.name).trim().slice(0,120)||channel.name,
          StartDate:new Date(start).toISOString(),EndDate:new Date(end).toISOString()});
      }
      Object.assign(row,changes);
      assignFileName(row);
      await save();
      await tick();
      return view(row);
    });},
    cancel(id,allowed,rule=false){return serialize(async()=>{
      if(rule){
        if(!state.rules.some(row=>row.Id===id&&allowed(row.LibraryId)))throw fail('Series rule not found.',404);
        state.rules=state.rules.filter(row=>row.Id!==id);
        for(const row of state.recordings)if(row.RuleId===id&&row.Status==='New')row.Status='Cancelled';
      }else{
        const row=get(id,allowed);
        if(row.Status==='New')row.Status='Cancelled';
        else if(row.Status==='InProgress')await finish(row);
        else throw fail('This recording is no longer active.',409);
      }
      await save();return {ok:true};
    });},
    async playback(id,allowed){
      const row=get(id,allowed),job=jobs.get(id);
      if(row.Status==='Error')throw fail(row.Error||'Recording failed.',409);
      if(row.Status==='Completed')return {name:row.Name,live:false,state:'ready',url:'/api/live-tv/dvr/'+id+'/media'};
      if(!job)throw fail('This recording is not ready.',409);
      const status=await liveTV.status(owner,job);
      return {...status,name:row.Name,live:true,url:'/api/live-tv/dvr/'+id+'/index.m3u8'};
    },
    async asset(id,name,allowed){
      const row=get(id,allowed);
      if(name!=='media'){
        const job=jobs.get(id);if(!job)throw fail('Recording stream has ended.',404);
        return liveTV.asset(owner,job,name);
      }
      if(row.Status!=='Completed'||!destinations(libraryId=>libraryId===row.LibraryId).some(library=>library.paths.includes(row.folder)))throw fail('Recording not available.',404);
      const filename=path.join(row.folder,row.fileName);
      const resolved=await realpath(filename).catch(()=>null);
      if(resolved!==filename)throw fail('Recording not found.',404);
      const handle=await open(filename,'r');
      try{return {handle,size:(await handle.stat()).size,mime:'video/mp4'};}
      catch(error){await handle.close();throw error;}
    },
    async close(){
      closed=true;
      clearInterval(timer);
      await pending;
      if(!jobs.size)return;
      for(const id of [...jobs.keys()])await finish(state.recordings.find(row=>row.Id===id));
      await save();
    }
  };
}
