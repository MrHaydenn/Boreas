import {sendMedia} from './media.mjs';
import {createRecordingQueue} from './sports-recording-queue.mjs';
import {validateCaptureSettings,applyCaptureService} from './sports-capture-settings.mjs';
import {streamVariant} from './apps/sports-capture/sources.mjs';
import path from 'node:path';
import {readFile,writeFile,mkdir,rename,unlink,open,stat} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {Readable} from 'node:stream';
import {randomBytes} from 'node:crypto';
import {safeName,sourceURL} from './apps/sports-capture/policy.mjs';
const nhlTeams=Object.fromEntries([
 'Anaheim Ducks:ANA','Boston Bruins:BOS','Buffalo Sabres:BUF','Calgary Flames:CGY','Carolina Hurricanes:CAR','Chicago Blackhawks:CHI','Colorado Avalanche:COL','Columbus Blue Jackets:CBJ','Dallas Stars:DAL','Detroit Red Wings:DET','Edmonton Oilers:EDM','Florida Panthers:FLA','Los Angeles Kings:LAK','Minnesota Wild:MIN','Montreal Canadiens:MTL','Nashville Predators:NSH','New Jersey Devils:NJD','New York Islanders:NYI','New York Rangers:NYR','Ottawa Senators:OTT','Philadelphia Flyers:PHI','Pittsburgh Penguins:PIT','San Jose Sharks:SJS','Seattle Kraken:SEA','St. Louis Blues:STL','Tampa Bay Lightning:TBL','Toronto Maple Leafs:TOR','Utah Mammoth:UTA','Vancouver Canucks:VAN','Vegas Golden Knights:VGK','Washington Capitals:WSH','Winnipeg Jets:WPG'
].map(entry=>entry.split(':')));
const nflTeams=Object.fromEntries([
 'Arizona Cardinals:ari','Atlanta Falcons:atl','Baltimore Ravens:bal','Buffalo Bills:buf','Carolina Panthers:car','Chicago Bears:chi','Cincinnati Bengals:cin','Cleveland Browns:cle','Dallas Cowboys:dal','Denver Broncos:den','Detroit Lions:det','Green Bay Packers:gb','Houston Texans:hou','Indianapolis Colts:ind','Jacksonville Jaguars:jax','Kansas City Chiefs:kc','Las Vegas Raiders:lv','Los Angeles Chargers:lac','Los Angeles Rams:lar','Miami Dolphins:mia','Minnesota Vikings:min','New England Patriots:ne','New Orleans Saints:no','New York Giants:nyg','New York Jets:nyj','Philadelphia Eagles:phi','Pittsburgh Steelers:pit','San Francisco 49ers:sf','Seattle Seahawks:sea','Tampa Bay Buccaneers:tb','Tennessee Titans:ten','Washington Commanders:wsh'
].map(entry=>entry.split(':')));
function recordingTeams(title){
 return String(title||'').split(/ at | vs\.? /i).slice(0,2).map(name=>{
  const nhl=nhlTeams[name],nfl=nflTeams[name];
  const logo=nhl?'https://assets.nhle.com/logos/nhl/svg/'+nhl+'_dark.svg':nfl?'https://a.espncdn.com/i/teamlogos/nfl/500/'+nfl+'.png':'';
  return {name,abbrev:nhl||nfl?.toUpperCase()||name.split(/\s+/).map(word=>word[0]).join('').slice(0,3),logo};
 });
}
export function createSportsCapture({authorize,directory=process.cwd(),fetcher=fetch,applyService=applyCaptureService,enabled=()=>true}={}){
 const configFile=path.join(directory,'sports-capture.local.json'),tickets=new Map(),exports=new Map();let writing=Promise.resolve(),applying=false,activity=[],activityAt=0;
 async function config(){try{return JSON.parse(await readFile(configFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;return {};}}
 function update(change){writing=writing.catch(()=>{}).then(async()=>{const c=await config();change(c);await writeFile(configFile+'.tmp',JSON.stringify(c,null,2));await rename(configFile+'.tmp',configFile);});return writing;}
 async function worker(route,method='GET',data){const c=await config();if(!c.token)throw Object.assign(Error('The capture service is not installed. Run apps/sports-capture/Setup.ps1 on the Lumen server.'),{status:503});return fetcher('http://127.0.0.1:47779'+route,{method,headers:{Authorization:'Bearer '+c.token,'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{}),signal:AbortSignal.timeout(route.endsWith('recording.mp4')?600000:route.endsWith('/links')?40000:15000)});}
 async function workerJSON(route,method,data){const r=await worker(route,method,data),j=await r.json();if(!r.ok)throw Object.assign(Error(j.error||'Capture service unavailable.'),{status:r.status});if(route==='/jobs'&&(!method||method==='GET')&&Array.isArray(j.jobs)){activity=j.jobs.filter(job=>!['complete','failed'].includes(job.state)).map(job=>({title:job.title,phase:job.state==='finalizing'?'Finishing sports recording':job.recording?'Recording sports':'Sports capture',detail:job.state}));activityAt=Date.now();}return j;}
 const queue=createRecordingQueue({directory,workerJSON,fetcher,enabled});
 async function exportJob(j){if(j.state!=='complete')return;if(exports.has(j.id))return exports.get(j.id);const task=(async()=>{const c=await config();if(c.exports?.[j.id])return;const folder=c.recordingsDirectory||path.join(directory,'Sports recordings');await mkdir(folder,{recursive:true});const destination=path.join(folder,safeName(j.title,j.id));try{await readFile(destination+'.lumen.json','utf8');await update(c=>{c.exports={...c.exports,[j.id]:destination};});return;}catch{}
  const temporary=destination+'.native-'+randomBytes(8).toString('hex')+'.partial';try{const r=await worker('/jobs/'+j.id+'/recording.mp4');if(!r.ok)throw Error('Recording export unavailable');await pipeline(Readable.fromWeb(r.body),createWriteStream(temporary,{flags:'wx'}));await rename(temporary,destination);await writeFile(destination+'.lumen.json',JSON.stringify({id:j.id,title:j.title,recordedAt:j.created,completedAt:j.completed},null,2));await update(c=>{c.exports={...c.exports,[j.id]:destination};});}catch(e){await unlink(temporary).catch(()=>{});throw e;}})();exports.set(j.id,task);task.catch(()=>exports.delete(j.id));return task;}
 async function savedRecordings(){const c=await config(),saved=[];for(const [id,filename]of Object.entries(c.exports||{})){if(!/^[a-f0-9-]{36}$/.test(id)||path.extname(filename).toLowerCase()!=='.mp4')continue;try{const info=JSON.parse(await readFile(filename+'.lumen.json','utf8'));if(info.id!==id||!(await stat(filename)).isFile())continue;saved.push({id,title:info.title,created:info.recordedAt,state:'complete',ready:true,saved:true,filename});}catch{}}return saved;}
 async function readBody(req){let text='';for await(const part of req){text+=part;if(text.length>8192)throw Object.assign(Error('Request too large'),{status:413});}return JSON.parse(text||'{}');}
 const exportTimer=setInterval(()=>{if(applying||!enabled())return;workerJSON('/jobs').then(data=>{for(const job of data.jobs)if(job.state==='complete')void exportJob(job).catch(()=>{});}).catch(()=>{});},15000);exportTimer.unref();
 const handler=async(req,res,url)=>{if(!url.pathname.startsWith('/sports-capture-api/'))return false;const send=(code,value)=>{res.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));return true;};try{
  const route=url.pathname.slice('/sports-capture-api'.length),media=route.match(/^\/media\/([a-f0-9-]{36})\/(master\.m3u8|(?:low\/)?index\.m3u8|(?:low\/)?seg\d{8}\.ts)$/);
  if(media){const ticket=tickets.get(url.searchParams.get('ticket'));if(req.method!=='GET'||!ticket||ticket.job!==media[1]||ticket.until<Date.now())return send(401,{error:'Playback link expired. Reopen this recording.'});const r=await worker('/jobs/'+media[1]+'/'+media[2]);if(!r.ok)return send(r.status,{error:'Stream not ready'});res.writeHead(200,{'content-type':r.headers.get('content-type'),'cache-control':'no-store','referrer-policy':'no-referrer'});if(media[2].endsWith('.m3u8')){const text=await r.text();res.end(text.replace(/^((?:low\/)?(?:index\.m3u8|seg\d{8}\.ts))$/gm,'$1?ticket='+encodeURIComponent(url.searchParams.get('ticket'))));}else{const stream=Readable.fromWeb(r.body);stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);}return true;}
  if(!await authorize(req.headers.authorization))return send(403,{error:'Sign in as the Boreas server owner to use sports capture.'});
  if(route==='/settings'&&req.method==='GET'){
   const c=await config();let connected=false,status={};try{await workerJSON('/jobs');connected=true;status=await workerJSON('/status');}catch{}
   const settings=validateCaptureSettings({},c,directory);
   return send(200,{...settings,connected,limit:settings.maxConcurrent,activeCaptures:status.activeCaptures||0,activeEncoder:status.encoder||'cpu',encoderMessage:status.encoderMessage||'',activeTemporaryDirectory:status.temporaryDirectory||'',needsApply:connected&&(status.temporaryDirectory!==settings.temporaryDirectory||status.encoderPreference!==settings.encoder||status.maxConcurrent!==settings.maxConcurrent),applying});
  }
  if(route==='/settings'&&req.method==='POST'){
   if(applying)return send(409,{error:'Capture settings are being applied. Please wait.'});
   let settings,input,previous;try{input=await readBody(req);previous=validateCaptureSettings({},await config(),directory);settings=validateCaptureSettings(input,await config(),directory);}catch(e){return send(400,{error:e.message});}
   const apply=input.apply===true;applying=apply;
   try{let restart=apply&&(settings.temporaryDirectory!==previous.temporaryDirectory||settings.encoder!==previous.encoder||settings.maxConcurrent!==previous.maxConcurrent);if(apply){let active=[],status;try{active=(await workerJSON('/jobs')).jobs;status=await workerJSON('/status');}catch{restart=true;}if(status&&status.temporaryDirectory!==undefined)restart||=status.temporaryDirectory!==settings.temporaryDirectory||status.encoderPreference!==settings.encoder||status.maxConcurrent!==settings.maxConcurrent;if(restart&&active.some(j=>!['complete','failed'].includes(j.state)))return send(409,{error:'Finish or stop the active captures before saving changes that restart the shared recorder.'});}
    for(const folder of [settings.recordingsDirectory,settings.temporaryDirectory]){await mkdir(folder,{recursive:true});const probe=path.join(folder,'.lumen-write-'+randomBytes(8).toString('hex'));await writeFile(probe,'',{flag:'wx'});await unlink(probe);}
    await update(c=>Object.assign(c,settings));if(restart){try{await Promise.allSettled([...exports.values()]);await writing;await applyService(directory);}catch(e){await update(c=>Object.assign(c,previous));throw e;}}return send(200,{...settings,applied:apply});
   }finally{if(apply)applying=false;}
  }
  if(route==='/settings/apply'&&req.method==='POST'){
   if(applying)return send(409,{error:'Capture settings are already being applied.'});
   applying=true;
   try{const data=await workerJSON('/jobs');if(data.jobs.some(j=>!['complete','failed'].includes(j.state)))return send(409,{error:'Finish or stop the active capture before applying settings.'});await Promise.allSettled([...exports.values()]);await writing;await applyService(directory);return send(200,{message:'Capture settings applied.'});}finally{applying=false;}
  }
  if(route==='/schedule'&&req.method==='POST')return send(200,await queue.add(await readBody(req)));
  if(route==='/jobs'&&req.method==='GET'){const saved=await savedRecordings(),data=await workerJSON('/jobs').catch(error=>{if(!saved.length)throw error;return {jobs:[]};});data.jobs.push(...await queue.list());for(const job of data.jobs)if(job.state==='complete')void exportJob(job)?.catch(()=>{});const combined=new Map(data.jobs.map(j=>[j.id,j]));for(const {filename,...job} of saved)combined.set(job.id,job);return send(200,{...data,jobs:[...combined.values()].map(job=>({...job,teams:recordingTeams(job.title),canDelete:req.lumenPermissions?.deleteMedia===true}))});}
  if(route==='/jobs'&&req.method==='POST'){if(applying)return send(409,{error:'Capture service is restarting. Try again shortly.'});const b=await readBody(req);if(b.recording===true&&req.lumenPermissions&&!req.lumenPermissions.record)return send(403,{error:'This profile cannot record sports.'});if(b.source!=='demo')sourceURL(b.source);return send(200,await workerJSON('/jobs','POST',{source:b.source,variant:streamVariant(b.variant)??undefined,title:String(b.title||'Sports capture').slice(0,120),recording:b.recording===true}));}
  const m=route.match(/^\/jobs\/([a-f0-9-]{36})(?:\/(links|watch|heartbeat|release|record|stop|preview|click|key|export|file))?$/);if(!m)return send(404,{error:'Capture endpoint not found.'});const [,id,action]=m;
  if((req.method==='DELETE'&&!action||req.method==='POST'&&action==='stop')&&await queue.cancel(id))return send(200,{ok:true,message:'Scheduled recording cancelled.'});
  if(action==='file'&&['GET','HEAD'].includes(req.method)){const record=(await savedRecordings()).find(j=>j.id===id);if(!record)return send(404,{error:'Recording not found.'});const handle=await open(record.filename,'r');await sendMedia(req,res,{handle,size:(await handle.stat()).size,mime:'video/mp4'});return true;}
  if(action==='links'&&['GET','POST'].includes(req.method))return send(200,await workerJSON('/jobs/'+id+'/links',req.method,req.method==='POST'?await readBody(req):undefined));
  if(action==='watch'&&req.method==='POST'){const saved=(await savedRecordings()).find(j=>j.id===id);if(saved){const {filename,...job}=saved;return send(200,{job,file:true,url:'/sports-capture-api/jobs/'+id+'/file'});}const job=await workerJSON('/jobs/'+id);if(job.state==='failed')return send(410,{error:job.message||'Capture failed. Start a new capture to retry.'});if(!job.ready)return send(409,{error:'Waiting for the source to start playing.'});for(const [key,t] of tickets)if(t.until<Date.now())tickets.delete(key);const token=randomBytes(24).toString('hex');tickets.set(token,{job:id,until:Date.now()+8*3600000});return send(200,{job,url:'/sports-capture-api/media/'+id+'/'+'index.m3u8'+'?ticket='+token});}
  if(action==='export'&&req.method==='POST'){const job=await workerJSON('/jobs/'+id);if(job.state!=='complete')return send(409,{error:'Stop and finish the recording first.'});await exportJob(job);return send(200,{message:'Recording saved to your configured folder.'});}
  if(action==='preview'&&req.method==='GET'){const r=await worker('/jobs/'+id+'/preview');res.writeHead(r.status,{'content-type':r.headers.get('content-type'),'cache-control':'no-store'});res.end(Buffer.from(await r.arrayBuffer()));return true;}
  if(req.method==='POST'&&['heartbeat','release','record','stop','click','key'].includes(action))return send(200,await workerJSON('/jobs/'+id+'/'+action,'POST',await readBody(req)));
  if(req.method==='DELETE'&&!action){
   const saved=(await savedRecordings()).find(record=>record.id===id);
   if(!saved)return send(200,await workerJSON('/jobs/'+id,'DELETE'));
   if(path.basename(saved.filename)!==safeName(saved.title,id))return send(409,{error:'The recording path could not be verified.'});
   await workerJSON('/jobs/'+id,'DELETE').catch(error=>{if(error.status!==404)throw error;});
   await unlink(saved.filename);
   await unlink(saved.filename+'.lumen.json').catch(error=>{if(error.code!=='ENOENT')throw error;});
   await update(c=>{delete c.exports[id];});
   return send(200,{ok:true,message:'Recording deleted.'});
  }
  return send(405,{error:'Method not allowed.'});
 }catch(e){return send(e.status||502,{error:e.code==='ECONNREFUSED'||e.message==='fetch failed'?'The capture service is offline. Start it on the Lumen server.':e.message});}};
 handler.isInternalPlayback=url=>tickets.get(url.searchParams.get('ticket'))?.internal===true;
 handler.liveInput=async(id,port)=>{
  const job=await workerJSON('/jobs/'+id);
  if(!job.ready||['complete','failed','finalizing'].includes(job.state))throw Object.assign(Error('The live capture is not ready.'),{status:409});
  const ticket=randomBytes(24).toString('hex');
  tickets.set(ticket,{job:id,internal:true,until:Date.now()+8*3600000});
  return {title:job.title,url:'http://127.0.0.1:'+port+'/sports-capture-api/media/'+id+'/index.m3u8?ticket='+ticket,release:()=>tickets.delete(ticket)};
 };
 handler.activity=()=>Date.now()-activityAt<30000?activity:[];
 handler.close=async()=>{clearInterval(exportTimer);await queue.close();await Promise.allSettled([...exports.values()]);await writing;};return handler;
}
