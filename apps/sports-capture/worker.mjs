import {selectEncoder,hlsOutputArgs} from './encoding.mjs';
import {streamVariant,streamChoices} from './sources.mjs';
import {isBlackFrame,healthUpdate,nextVariant} from './health.mjs';
import http from 'node:http';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
const command=promisify(execFile);
import {once} from 'node:events';
import {randomUUID,timingSafeEqual} from 'node:crypto';
import {mkdir,readFile,writeFile,readdir,rm,stat,rename} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {chromium} from 'playwright-core';
import {startProxy} from './proxy.mjs';
import {sourceURL,shouldStop} from './policy.mjs';
const secret=process.env.CAPTURE_TOKEN;if(!secret||secret.length<32)throw Error('CAPTURE_TOKEN required');
const encoding=await selectEncoder(process.env.CAPTURE_ENCODER||'auto');
const captureProfile={width:1920,height:1080,fps:60,encoder:encoding.encoder,adaptive:false};
const jobs=new Map(),active=new Map();let startQueue=Promise.resolve();
const maxConcurrent=Math.max(1,Math.min(4,Number(process.env.CAPTURE_MAX_CONCURRENT)||3));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const run=(command,args,options={})=>spawn(command,args,{stdio:['pipe','ignore','pipe'],...options});
await mkdir('/data',{recursive:true});
for(const id of await readdir('/data'))if(/^[a-f0-9-]{36}$/.test(id))try{const j=JSON.parse(await readFile('/data/'+id+'/job.json'));if(j.recording===false){await rm('/data/'+id,{recursive:true,force:true});continue;}if(!['complete','failed'].includes(j.state)){j.state='failed';j.message='Capture service restarted. Any captured segments remain available.';}jobs.set(id,j);}catch{}
const pulse=run('pulseaudio',['--daemonize=no','--exit-idle-time=-1','--load=module-null-sink sink_name=idle','--log-target=stderr']);
await startProxy();await wait(1500);
async function releaseDesktop(c){c.xvfb?.kill();if(c.audioModule){const module=c.audioModule;c.audioModule=null;await command('pactl',['unload-module',module]).catch(()=>{});}}
const jobWrites=new WeakMap();
async function persist(j){
 const file='/data/'+j.id+'/job.json';
 const pending=(jobWrites.get(j)||Promise.resolve()).catch(()=>{}).then(async()=>{
  await writeFile(file+'.tmp',JSON.stringify(j));await rename(file+'.tmp',file);
 });
 jobWrites.set(j,pending);await pending;
}
function view(j){return {id:j.id,title:j.title,state:j.state,recording:j.recording,created:j.created,message:j.message||'',ready:j.ready||false,capture:j.capture||{width:1280,height:720,fps:30},source:j.source,variant:j.variant,activeVariant:j.activeVariant??j.variant,completed:j.completed||null};}
async function finish(j,reason=''){const current=active.get(j.id);if(!current||current.stopping)return;current.stopping=true;j.state='finalizing';j.message=reason;await persist(j);const c=current;clearTimeout(c.releaseTimer);
 try{if(c.ff&&c.ff.exitCode===null&&c.ff.signalCode===null){const exited=once(c.ff,'close');c.ff.stdin.end('q\n');await Promise.race([exited,wait(10000).then(()=>c.ff.kill('SIGTERM'))]);}await c.browser?.close();await releaseDesktop(c);await rm('/tmp/lumen-capture-'+j.id,{recursive:true,force:true});
  if(j.recording&&j.ready){const exportProcess=run('ffmpeg',['-nostdin','-y','-loglevel','error','-i','/data/'+j.id+'/index.m3u8','-c','copy','-movflags','+faststart','/data/'+j.id+'/recording.mp4']);const [code]=await once(exportProcess,'close');if(code!==0)throw Error('Could not finalize recording. Captured segments were retained.');j.state='complete';j.completed=Date.now();}
  else if(j.recording){j.state='failed';j.message=reason||'No video was captured.';}
  else{jobs.delete(j.id);await rm('/data/'+j.id,{recursive:true,force:true});}
 }catch(e){j.state='failed';j.message=e.message;}finally{if(jobs.has(j.id))await persist(j);active.delete(j.id);}}
async function prepare(j){const current=active.get(j.id);if(!current)return;let browser;try{
 current.xvfb=run('Xvfb',[current.display,'-screen','0','1920x1080x24','-nolisten','tcp']);
 current.sink='capture_'+j.id.replaceAll('-','');
 const audio=await command('pactl',['load-module','module-null-sink','sink_name='+current.sink]);current.audioModule=audio.stdout.trim();
 if(active.get(j.id)!==current||current.stopping){await releaseDesktop(current);return;}
 await wait(300);browser=await chromium.launchPersistentContext('/tmp/lumen-capture-'+j.id,{env:{...process.env,DISPLAY:current.display,PULSE_SINK:current.sink},ignoreDefaultArgs:['--enable-automation'],viewport:null,acceptDownloads:false,serviceWorkers:'block',executablePath:'/usr/bin/chromium',headless:false,proxy:{server:'http://127.0.0.1:8899'},args:['--no-sandbox','--disable-dev-shm-usage','--disable-quic','--force-webrtc-ip-handling-policy=disable_non_proxied_udp','--proxy-bypass-list=<-loopback>','--autoplay-policy=no-user-gesture-required','--window-size=1920,1080','--window-position=0,0','--start-fullscreen','--kiosk','--hide-scrollbars']});if(active.get(j.id)!==current||current.stopping){await browser.close();await releaseDesktop(current);return;}current.browser=browser;const context=browser;const page=context.pages()[0]||await context.newPage();current.page=page;context.on('page',p=>{if(p!==page)p.close().catch(()=>{});});page.on('dialog',d=>d.dismiss());
 if(j.source==='demo')await page.setContent(`<body style="margin:0;background:black"><video style="width:100vw;height:100vh" autoplay></video><script>
const c=document.createElement('canvas');c.width=1920;c.height=1080;const x=c.getContext('2d');
const a=new AudioContext(),o=a.createOscillator(),g=a.createGain(),d=a.createMediaStreamDestination();g.gain.value=0;o.frequency.value=${880+(j.variant||0)*220};o.connect(g);g.connect(d);o.start();
for(let t=2;t<360;t+=2){g.gain.setValueAtTime(.2,t);g.gain.setValueAtTime(0,t+.12);}
function draw(){const t=a.currentTime; x.fillStyle=t>=2&&t%2<.12?'white':'#152539';x.fillRect(0,0,1920,1080);x.fillStyle='#eab32c';x.font='52px sans-serif';x.fillText('Lumen ${j.id.slice(0,8)} sync test '+t.toFixed(2),90,350);requestAnimationFrame(draw);}draw();
const s=c.captureStream(60);s.addTrack(d.stream.getAudioTracks()[0]);document.querySelector('video').srcObject=s;
</script>`);
 else {await page.goto(j.source,{waitUntil:'domcontentloaded',timeout:45000});if(j.variant!==null&&j.variant!==undefined){const option=page.locator('#linkSelector a').nth(j.variant);await option.waitFor({state:'visible',timeout:15000});await option.click();await wait(1500);}}
 j.state='needs-input';j.message='Waiting for video. Use the source preview to press Play if needed.';await persist(j);
 for(let attempt=0;attempt<180&&active.get(j.id)===current&&!current.stopping;attempt++){for(const frame of page.frames()){const videos=frame.locator('video');if(await videos.count().catch(()=>0)){const v=videos.first();await v.evaluate(v=>{v.muted=false;v.volume=1;if(v.paused)v.play().catch(()=>{});}).catch(()=>{});const playing=await v.evaluate(v=>!v.paused&&v.readyState>=2&&v.videoWidth>0).catch(()=>false);if(playing){for(const captureFrame of page.frames())await captureFrame.addStyleTag({content:'html,body{margin:0!important;padding:0!important;width:100%!important;height:100%!important;overflow:hidden!important;scrollbar-width:none!important;scrollbar-gutter:auto!important}*::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}'}).catch(()=>{});await v.evaluate(v=>{v.style.cssText='position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;margin:0!important;padding:0!important;border:0!important;object-fit:contain!important;z-index:2147483647!important;background:black!important';}).catch(()=>{});let child=frame;while(child.parentFrame()){const el=await child.frameElement();await el.evaluate(el=>el.style.cssText='position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;margin:0!important;padding:0!important;border:0!important;z-index:2147483647!important');child=child.parentFrame();}
   const dir='/data/'+j.id;const ff=run('ffmpeg',['-y','-loglevel','warning','-filter_threads','2','-copyts','-start_at_zero','-thread_queue_size','32','-f','x11grab','-draw_mouse','0','-framerate','60','-video_size','1920x1080','-i',current.display+'.0','-thread_queue_size','512','-isync','0','-f','pulse','-sample_rate','48000','-fragment_size','3840','-i',current.sink+'.monitor',...hlsOutputArgs(encoding.encoder,dir,'high')]);current.ff=ff;ff.stdin.on('error',()=>{});let encoderLog='';ff.stderr.on('data',chunk=>{encoderLog=(encoderLog+chunk.toString()).slice(-4000);});ff.once('error',()=>finish(j,'Encoder could not start.'));ff.once('close',()=>{if(!current.stopping&&active.get(j.id)===current){console.error('Capture encoder stopped:',encoderLog);finish(j,'Encoder stopped unexpectedly.');}});
   for(let n=0;n<30&&active.get(j.id)===current&&!current.stopping;n++){if(await stat(dir+'/index.m3u8').catch(()=>null)){j.ready=true;j.state='capturing';j.message='';await persist(j);return;}await wait(1000);}throw Error('Encoder did not produce a playable stream.');}}}
  if(attempt===60||attempt===120)await switchLink(current).catch(()=>{});if(attempt%10===2)for(const f of page.frames())await f.getByRole('button',{name:/^play( video)?$/i}).first().click({timeout:500}).catch(()=>{});await wait(1000);}
 if(active.get(j.id)===current&&!current.stopping)throw Error('The source did not start playing within three minutes, including alternate links.');
 }catch(e){if(active.get(j.id)===current&&!current.stopping){j.message='Source could not start. Check its preview or try another game page.';await finish(j,j.message);}}}
async function presentVideo(current){
 for(const frame of current.page.frames()){
  const v=frame.locator('video').first();if(!await v.count().catch(()=>0))continue;
  const state=await v.evaluate(v=>{v.muted=false;v.volume=1;if(v.paused)v.play().catch(()=>{});return {playing:!v.paused&&v.readyState>=2&&v.videoWidth>0,time:v.currentTime};}).catch(()=>null);
  if(!state?.playing)continue;
  await v.evaluate(v=>{v.style.cssText='position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;margin:0!important;padding:0!important;border:0!important;object-fit:contain!important;z-index:2147483647!important;background:black!important';}).catch(()=>{});
  let child=frame;while(child.parentFrame()){const el=await child.frameElement();await el.evaluate(el=>el.style.cssText='position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;border:0!important;z-index:2147483647!important');child=child.parentFrame();}return state;
 }return null;
}
async function linkChoices(current){
 const {job,page}=current;
 if(!page||job.source==='demo')return [];
 const choices=streamChoices(await page.content(),job.source);
 if(choices.length)return choices;
 const response=await fetch(job.source,{signal:AbortSignal.timeout(5000),redirect:'error'});
 return response.ok?streamChoices(await response.text(),job.source):[];
}
async function selectLink(current,variant){
 const {job,page}=current;
 await page.goto(job.source,{waitUntil:'domcontentloaded',timeout:8000});
 if(current.stopping)throw Object.assign(Error('Capture is finishing.'),{status:409});
 if(variant!==null)await page.locator('#linkSelector a').nth(variant).click({timeout:5000});
}
async function switchLink(current,requested=null){
 const j=current.job,manual=requested!==null;
 if(current.stopping||j.source==='demo')return false;
 if(current.switching)throw Object.assign(Error('A link change is already in progress.'),{status:409});
 current.switching=true;
 try{
  const choices=await linkChoices(current),previous=j.activeVariant??j.variant??null;
  const variant=manual?requested:nextVariant(choices,previous);
  const choice=choices.find(c=>c.variant===variant);
  if(!choice){
   if(manual)throw Object.assign(Error('That link is no longer available.'),{status:400});
   return false;
  }
  if(variant===previous)return true;
  try{await selectLink(current,variant);}
  catch(error){
   if(manual&&!current.stopping)await selectLink(current,previous).catch(()=>{});
   throw error;
  }
  if(current.stopping)throw Object.assign(Error('Capture is finishing.'),{status:409});
  j.activeVariant=variant;j.message='';current.unhealthySince=null;current.lastVideoTime=null;
  await persist(j);return true;
 }finally{current.switching=false;}
}
async function blackFrame(page){
 const png=await page.screenshot({type:'png',timeout:5000});
 return new Promise((resolve,reject)=>{const ff=spawn('ffmpeg',['-v','error','-i','pipe:0','-vf','scale=32:18','-frames:v','1','-pix_fmt','gray','-f','rawvideo','pipe:1'],{stdio:['pipe','pipe','ignore']});let chunks=[];const timeout=setTimeout(()=>{ff.kill('SIGKILL');reject(Error('Health sample timed out'));},5000);ff.stdout.on('data',b=>chunks.push(b));ff.stdin.on('error',()=>{});ff.on('error',e=>{clearTimeout(timeout);reject(e);});ff.on('close',code=>{clearTimeout(timeout);const pixels=Buffer.concat(chunks);if(code!==0||pixels.length!==576)reject(Error('Health sample unavailable'));else resolve(isBlackFrame(pixels));});ff.stdin.end(png);});
}
setInterval(()=>{for(const current of active.values()){
 if(!current.job.ready||current.stopping||current.healthBusy||current.switching||!current.page)continue;
 current.healthBusy=true;void (async()=>{try{
  const state=await presentVideo(current),black=await blackFrame(current.page),now=Date.now();
  const stalled=!state||(current.lastVideoTime!==null&&current.lastVideoTime!==undefined&&Math.abs(state.time-current.lastVideoTime)<0.05);
  current.lastVideoTime=state?.time??null;const health=healthUpdate(current.unhealthySince,black||stalled,now);current.unhealthySince=health.since;
  if(health.recover){current.unhealthySince=now;await switchLink(current);}else if(!black&&!stalled&&current.job.message){current.job.message='';await persist(current.job);}
 }catch(error){console.error('Capture health check:',error.message);}finally{current.healthBusy=false;}})();
}},5000).unref();
async function createOrJoinCapture(b){
 const source=b.source==='demo'?'demo':sourceURL(b.source),variant=streamVariant(b.variant);
 if(typeof b.scheduleId==='string'){const existing=[...jobs.values()].find(j=>j.scheduleId===b.scheduleId);if(existing)return {status:200,job:view(existing)};}
 const current=[...active.values()].find(c=>c.job.source===source);
 if(current){
  if(current.stopping)throw Object.assign(Error('This capture is finishing. Try again shortly.'),{status:409});
  if(b.recording)current.job.recording=true;current.job.lastViewer=Date.now();clearTimeout(current.releaseTimer);await persist(current.job);return {status:200,job:view(current.job)};
 }
 if(active.size>=maxConcurrent)throw Object.assign(Error(active.size+' of '+maxConcurrent+' recorders are in use. Watch an active game or finish a capture before starting a different game.'),{status:409});
 const j={id:randomUUID(),scheduleId:typeof b.scheduleId==='string'&&/^[a-f0-9-]{36}$/.test(b.scheduleId)?b.scheduleId:undefined,capture:captureProfile,source,variant,title:String(b.title||'Sports capture').slice(0,120),recording:b.recording===true,created:Date.now(),lastViewer:Date.now(),state:'starting'};
 await mkdir('/data/'+j.id);jobs.set(j.id,j);const used=new Set([...active.values()].map(c=>c.display));const display=Array.from({length:4},(_,i)=>':'+(100+i)).find(d=>!used.has(d));active.set(j.id,{job:j,viewers:new Map(),releaseTimer:null,display,stopping:false});await persist(j);void prepare(j);return {status:202,job:view(j)};
}
async function body(req){let s='';for await(const part of req){s+=part;if(s.length>8192)throw Error('Request too large');}return JSON.parse(s||'{}');}
const server=http.createServer(async(req,res)=>{const send=(code,data)=>{res.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));};try{const token=String(req.headers.authorization||'').replace(/^Bearer /,'');if(token.length!==secret.length||!timingSafeEqual(Buffer.from(token),Buffer.from(secret)))return send(401,{error:'Unauthorized'});const u=new URL(req.url,'http://local');
 if(u.pathname==='/status'&&req.method==='GET')return send(200,{...encoding,maxConcurrent,activeCaptures:active.size,temporaryDirectory:process.env.CAPTURE_HOST_TEMPORARY_DIRECTORY||'',encoderPreference:process.env.CAPTURE_ENCODER||'auto'});
 if(u.pathname==='/jobs'&&req.method==='GET')return send(200,{jobs:[...jobs.values()].map(view)});
 if(u.pathname==='/jobs'&&req.method==='POST'){
  const b=await body(req);const operation=startQueue.catch(()=>{}).then(()=>createOrJoinCapture(b));startQueue=operation;
  const result=await operation;return send(result.status,result.job);
 }

 const m=u.pathname.match(/^\/jobs\/([a-f0-9-]{36})(?:\/(links|heartbeat|release|record|stop|preview|click|key|master\.m3u8|(?:low\/)?index\.m3u8|(?:low\/)?seg\d{8}\.ts|recording\.mp4))?$/);if(!m||!jobs.has(m[1]))return send(404,{error:'Capture not found'});const j=jobs.get(m[1]),action=m[2],current=active.get(j.id);
 if(req.method==='DELETE'&&!action){if(current)return send(409,{error:'Stop this capture before deleting it.'});await rm('/data/'+j.id,{recursive:true,force:true});jobs.delete(j.id);return send(200,{ok:true});}
 if(action==='links'&&['GET','POST'].includes(req.method)){
  if(!current?.page||!j.ready||current.stopping)return send(409,{error:'Live links are unavailable for this capture.'});
  if(req.method==='GET')return send(200,{links:(await linkChoices(current)).map(({label,variant})=>({label,variant})),activeVariant:j.activeVariant??j.variant??0});
  const input=await body(req),lastSeen=current.viewers.get(input.viewer),variant=streamVariant(input.variant);
  if(!lastSeen||Date.now()-lastSeen>90000)return send(403,{error:'Join the live capture before changing its link.'});
  if(variant===null)return send(400,{error:'Choose a valid stream option.'});
  if(!await switchLink(current,variant))return send(409,{error:'Live links are unavailable for this capture.'});
  return send(200,{activeVariant:j.activeVariant??j.variant??0});
 }
 if(req.method==='POST'&&['heartbeat','release','record','stop','click','key'].includes(action)){if(!current||current.stopping)return send(409,{error:'Capture is not running.'});const b=await body(req);if(action==='heartbeat'||action==='release'){
 const viewer=b.viewer===undefined?'legacy':b.viewer;
 if(typeof viewer!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(viewer))throw Error('Invalid viewer session.');
 for(const [id,last] of current.viewers)if(Date.now()-last>90000)current.viewers.delete(id);
 if(action==='heartbeat'){current.viewers.set(viewer,Date.now());j.lastViewer=Date.now();clearTimeout(current.releaseTimer);}
 else{
  current.viewers.delete(viewer);clearTimeout(current.releaseTimer);
  if(!j.recording&&!current.viewers.size)current.releaseTimer=setTimeout(()=>{if(active.get(j.id)===current&&!j.recording&&!current.viewers.size)void finish(j);},3000);
 }
}if(action==='record'){j.recording=true;await persist(j);}if(action==='stop')void finish(j);if(action==='click'){if(!Number.isFinite(b.x)||!Number.isFinite(b.y))throw Error('Invalid click');await current.page?.mouse.click(Math.max(0,Math.min(captureProfile.width-1,b.x)),Math.max(0,Math.min(captureProfile.height-1,b.y)));}if(action==='key'){if(!['Space','Enter','f','Escape'].includes(b.key))throw Error('Invalid key');await current.page?.keyboard.press(b.key);}return send(200,view(j));}
 if(req.method!=='GET')return send(405,{error:'Method not allowed'});if(!action)return send(200,view(j));if(action==='preview'){if(!current?.page||current.job!==j)return send(409,{error:'Preview unavailable'});const image=await current.page.screenshot({type:'jpeg',quality:65,timeout:5000});res.writeHead(200,{'content-type':'image/jpeg','cache-control':'no-store'});return res.end(image);}
 const file='/data/'+j.id+'/'+action,info=await stat(file).catch(()=>null);if(!info)return send(404,{error:'Video is not ready yet'});res.writeHead(200,{'content-type':action.endsWith('.m3u8')?'application/vnd.apple.mpegurl':action.endsWith('.ts')?'video/mp2t':'video/mp4','content-length':info.size,'cache-control':'no-store'});const stream=createReadStream(file);stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
 }catch(e){if(!res.headersSent)send(e.status||400,{error:e.message});else res.destroy();}});server.listen(47779,'0.0.0.0');
setInterval(async()=>{for(const current of active.values()){const j=current.job;if(current.stopping)continue;const files=await readdir('/data/'+j.id).catch(()=>[]);let size=0;for(const f of files){const file='/data/'+j.id+'/'+f,info=await stat(file).catch(()=>null);if(info?.isFile())size+=info.size;else if(f==='low'&&info?.isDirectory())for(const segment of await readdir(file))size+=(await stat(file+'/'+segment).catch(()=>({size:0}))).size;}if(shouldStop(j,Date.now())||size>20*1024**3)void finish(j,size>20*1024**3?'Capture reached the 20 GB limit.':'Capture ended automatically.');}},15000).unref();
process.on('SIGTERM',async()=>{await Promise.all([...active.values()].map(c=>finish(c.job,'Service shutdown')));pulse.kill();process.exit();});
