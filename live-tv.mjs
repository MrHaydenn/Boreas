import {fetchXmltv,guideAddress,guideChannelId,guideForChannel} from './xmltv-guide.mjs';
import path from 'node:path';
import {mkdir,readFile,writeFile,rename,open,rm,rmdir,stat} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const fail=(message,status=400)=>Object.assign(Error(message),{status});
export function tunerAddress(value){const s=String(value||'').trim(),parts=s.split('.').map(Number);if(!/^\d{1,3}(\.\d{1,3}){3}$/.test(s)||parts.some(n=>n>255)||!(parts[0]===10||parts[0]===192&&parts[1]===168||parts[0]===172&&parts[1]>=16&&parts[1]<=31))throw fail('Enter the private IPv4 address of your HDHomeRun.');return parts.join('.');}
export function tunerPort(value){
 if(value==null||String(value).trim()==='')return null;
 const port=Number(value);
 if(!/^\d+$/.test(String(value).trim())||!Number.isInteger(port)||port<1||port>65535)throw fail('Enter a tuner port from 1 to 65535.');
 return port;
}
export async function createLiveTV(directory,{fetcher=fetch,ffmpeg=process.env.LUMEN_NATIVE_FFMPEG||'C:/Program Files/Jellyfin/Server/ffmpeg.exe'}={}){
 const file=path.join(directory,'tuners.json'),root=path.join(directory,'live-tv-buffer'),jobs=new Map();let tuners=[],writes=Promise.resolve(),closed=false;
 await mkdir(root,{recursive:true});try{tuners=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 async function discover(address,port){const base='http://'+address+(port?':'+port:'');const json=async endpoint=>{try{const r=await fetcher(base+endpoint,{signal:AbortSignal.timeout(5000),redirect:'error'});if(!r.ok)throw Error();return await r.json();}catch{throw fail('HDHomeRun did not respond. Check the address and tuner connection.',502);}};const [device,lineup]=await Promise.all([json('/discover.json'),json('/lineup.json')]);if(!/^[0-9a-f]{8}$/i.test(device.DeviceID||'')||!Array.isArray(lineup))throw fail('This address did not return an HDHomeRun lineup.',502);
 function streamPath(value){
   try{
     const url=new URL(value);
     if(url.protocol==='http:'&&url.hostname===address&&!url.username&&!url.password&&Number(url.port||80)===(port||5004))return url.pathname+url.search;
   }catch{}
   return null;
 }
 const channels=lineup.slice(0,500).filter(c=>/^\d{1,5}(\.\d{1,4})?$/.test(c.GuideNumber)&&!c.DRM&&!String(c.Tags||'').split(',').includes('drm')).map(c=>({number:c.GuideNumber,name:String(c.GuideName||c.GuideNumber).slice(0,100),...((streamPath(c.URL))?{streamPath:streamPath(c.URL)}:{})}));return {id:device.DeviceID,address,name:String(device.FriendlyName||device.ModelNumber||'HDHomeRun').slice(0,100),count:Math.max(1,Math.min(8,Number(device.TunerCount)||1)),channels};}
 function commit(change){const task=writes.then(async()=>{const next=change(tuners),temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(next));await rename(temp,file);tuners=next;return tuners;});writes=task.catch(()=>{});return task;}
 async function stop(j){jobs.delete(j.id);if(j.child.exitCode===null)j.child.kill();await j.done;await rm(j.dir,{recursive:true,force:true}).catch(()=>{});}
 function owned(user,id){const j=jobs.get(id);if(!j||j.user!==user)throw fail('Live stream not found.',404);j.touched=Date.now();return j;}
 const guides=new Map();
 async function loadGuide(url){
   const old=guides.get(url);
   if(old?.pending)return old.pending;
   if(old&&old.until>Date.now())return old.result;
   const entry={result:old?.result||null,until:0};
   guides.set(url,entry);
   entry.pending=fetchXmltv(url,fetcher).then(result=>{
     entry.result=result;entry.until=Date.now()+15*60000;return result;
   }).catch(()=>{
     entry.until=Date.now()+60000;return entry.result;
   }).finally(()=>{delete entry.pending;});
   return entry.pending;
 }
 async function guideChannels(){
   const results=await Promise.all(tuners.map(async tuner=>{
     const guide=tuner.guideUrl?await loadGuide(tuner.guideUrl):null;
     return {unavailable:!!tuner.guideUrl&&!guide,channels:tuner.channels.map(({streamPath,...channel})=>({...channel,tuner:tuner.id,...(guide?guideForChannel(guide,channel):{})}))};
   }));
   return {channels:results.flatMap(result=>result.channels),guideUnavailable:results.some(result=>result.unavailable)};
 }
 async function guideWindow(start,end,query=''){
   if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>15*86400000)throw fail('Choose a valid guide window.');
   const search=String(query).trim().slice(0,120).toLowerCase();
   const results=await Promise.all(tuners.map(async tuner=>{
     const guide=tuner.guideUrl?await loadGuide(tuner.guideUrl):null;
     const programs=[];
     const channels=tuner.channels.map(channel=>{
       const id=tuner.id+'~'+channel.number,guideId=guide?guideChannelId(guide,channel):null;
       if(guideId){
         for(const row of guide.programs.get(guideId)||[]){
           if(!row.end||row.start>=end||row.end<=start)continue;
           if(search&&!([row.title,row.episode,row.overview,channel.name,channel.number].join(' ').toLowerCase().includes(search)))continue;
           programs.push({Id:id+'~'+row.start,ChannelId:id,ChannelName:channel.name,Name:row.title,EpisodeTitle:row.episode,Overview:row.overview,StartDate:new Date(row.start).toISOString(),EndDate:new Date(row.end).toISOString(),CanRecord:false});
         }
       }
       return {Id:id,Name:channel.name,ChannelNumber:channel.number};
     });
     return {channels,programs,unavailable:!!tuner.guideUrl&&!guide,configured:!!tuner.guideUrl};
   }));
   return {channels:results.flatMap(result=>result.channels),programs:results.flatMap(result=>result.programs).sort((a,b)=>a.StartDate.localeCompare(b.StartDate)).slice(0,search?2000:12000),guideUnavailable:results.some(result=>result.unavailable),guideConfigured:results.some(result=>result.configured)};
 }
 const timer=setInterval(()=>{for(const j of jobs.values())if(!j.recording&&Date.now()-j.touched>45000)void stop(j);},10000);timer.unref();
 return {activity:()=>[...jobs.values()].filter(job=>!job.error).map(job=>({name:job.channel,state:'Tuner streaming'})),tuners:()=>tuners,channels:()=>tuners.flatMap(t=>t.channels.map(({streamPath,...channel})=>({...channel,tuner:t.id}))),guideChannels,guideWindow,async add(value){
   const input=typeof value==='string'?{address:value}:value||{};
   const address=tunerAddress(input.address),port=tunerPort(input.port),guideUrl=guideAddress(input.guideUrl);
   const tuner=await discover(address,port);
   const result=await commit(list=>{
     const existing=list.find(entry=>entry.id===tuner.id);
     return [...list.filter(entry=>entry.id!==tuner.id),{...tuner,port,guideUrl:input.guideUrl===undefined?existing?.guideUrl||'':guideUrl}];
   });
   for(const url of guides.keys())if(!result.some(entry=>entry.guideUrl===url))guides.delete(url);
   return result;
 },async remove(id){
   const result=await commit(list=>list.filter(t=>t.id!==id));
   for(const url of guides.keys())if(!result.some(entry=>entry.guideUrl===url))guides.delete(url);
   return result;
 },
 async start(user,input,recording=false){const tuner=tuners.find(t=>t.id===input.tuner),channel=tuner?.channels.find(c=>c.number===input.number);if(!channel)throw fail('Channel not found.',404);if(closed||jobs.size>=4||[...jobs.values()].filter(j=>j.tuner===tuner.id).length>=tuner.count)throw fail('All available tuners are in use.',409);const id=randomUUID(),dir=path.join(root,id);await mkdir(dir);if(closed||jobs.size>=4||[...jobs.values()].filter(j=>j.tuner===tuner.id).length>=tuner.count){await rmdir(dir);throw fail('All available tuners are in use.',409);}
 const child=spawn(ffmpeg,[...(recording?[]:['-nostdin']),'-hide_banner','-loglevel','error','-rw_timeout','12000000','-i','http://'+tunerAddress(tuner.address)+':'+(tunerPort(tuner.port)||5004)+(channel.streamPath||'/auto/v'+channel.number),'-map','0:v:0','-map','0:a:0?','-vf','yadif=0:-1:1,scale=-2:720','-c:v','libx264','-preset','ultrafast','-threads','2','-pix_fmt','yuv420p','-force_key_frames','expr:gte(t,n_forced*2)','-c:a','aac','-ac','2','-f','hls','-hls_time','2','-hls_list_size',recording?'0':'12','-hls_flags',recording?'temp_file':'delete_segments+temp_file',...(recording?['-hls_playlist_type','event']:[]),'-hls_segment_filename','segment%06d.ts','index.m3u8'],{cwd:dir,windowsHide:true,stdio:recording?['pipe','ignore','ignore']:'ignore'});child.stdin?.on('error',()=>{});const j={id,user,recording,tuner:tuner.id,channel:channel.name,dir,child,touched:Date.now(),error:false};j.done=new Promise(resolve=>{child.once('close',()=>{j.error=true;resolve();});child.once('error',()=>{j.error=true;resolve();});});jobs.set(id,j);return {id,name:channel.name};},
 ended(user,id){return owned(user,id).error;},
 async finalize(user,id,output){
   const job=owned(user,id);
   if(!job.recording)throw fail('Recording not found.',404);
   if(!job.error){
     job.child.stdin.end('q\n');
     const timeout=setTimeout(()=>job.child.kill(),10000);
     try{await job.done;}finally{clearTimeout(timeout);}
   }
   try{
     await new Promise((resolve,reject)=>{
       const child=spawn(ffmpeg,['-nostdin','-v','error','-i','index.m3u8','-c','copy','-movflags','+faststart','-f','mp4','-n',output],{cwd:job.dir,windowsHide:true,stdio:'ignore'});
       const timeout=setTimeout(()=>child.kill(),300000);
       child.once('error',error=>{clearTimeout(timeout);reject(error);});
       child.once('close',code=>{clearTimeout(timeout);if(code===0)resolve();else reject(Error('The tuner produced no playable recording or the destination could not be written.'));});
     });
   }finally{await stop(job);}
 },
 async status(user,id){const j=owned(user,id);return {state:j.error?'error':(await stat(path.join(j.dir,'index.m3u8')).catch(()=>null))?.size?'ready':'preparing',url:'/api/live-tv/streams/'+id+'/index.m3u8'};},async asset(user,id,name){const j=owned(user,id);if(!/^(index\.m3u8|segment\d{6}\.ts)$/.test(name))throw fail('Stream asset not found.',404);const handle=await open(path.join(j.dir,name),'r').catch(()=>{throw fail('Stream asset not found.',404);});return {handle,size:(await handle.stat()).size,mime:name.endsWith('.ts')?'video/mp2t':'application/vnd.apple.mpegurl'};},async release(user,id){await stop(owned(user,id));return {ok:true};},async close(){closed=true;clearInterval(timer);await Promise.allSettled([...jobs.values()].map(stop));await writes;}};
}
