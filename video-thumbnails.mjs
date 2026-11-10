import path from 'node:path';import {mkdir,readFile,stat,rename,unlink,readdir,mkdtemp,rmdir} from 'node:fs/promises';import {createHash} from 'node:crypto';import {execFile} from 'node:child_process';
const fail=(message,status=503)=>Object.assign(Error(message),{status});
export async function createVideoThumbnails(directory,libraries,{ffmpeg=process.env.LUMEN_NATIVE_FFMPEG||'C:/Program Files/Jellyfin/Server/ffmpeg.exe',ffprobe=process.env.LUMEN_NATIVE_FFPROBE||'C:/Program Files/Jellyfin/Server/ffprobe.exe'}={}){
 const posters=path.join(directory,'video-thumbnails'),previews=path.join(directory,'trickplay');
 const built=path.join(previews,'generated'),building=new Map();await Promise.all([mkdir(posters,{recursive:true}),mkdir(previews,{recursive:true})]);let queue=Promise.resolve(),closed=false;const pending=new Map(),failures=new Map(),children=new Set();
 function run(binary,args){return new Promise((resolve,reject)=>{const child=execFile(binary,args,{windowsHide:true,timeout:45000,maxBuffer:4*1024*1024},(error,stdout)=>{children.delete(child);error?reject(fail('Video thumbnail could not be generated.')):resolve(stdout);});children.add(child);});}
 async function source(libraryId,itemId,admin){const media=await libraries.openMedia(libraryId,itemId,admin);try{const info=await media.handle.stat();return {filename:media.filename,size:info.size,mtime:info.mtimeMs};}finally{await media.handle.close();}}
 async function generate(source,key,file){const cache=path.dirname(file);if(closed)throw fail('Thumbnail service is stopping.');const temporary=path.join(cache,key+'.partial.jpg');try{const probe=JSON.parse(await run(ffprobe,['-v','error','-show_streams','-show_format','-of','json',source.filename])),video=probe.streams?.find(s=>s.codec_type==='video'&&!s.disposition?.attached_pic);if(!video)throw fail('No video frame is available.',404);const duration=Number(probe.format?.duration)||0,position=duration>0?Math.min(60,duration*.1):0,hdr=['smpte2084','arib-std-b67'].includes(video.color_transfer),filter=(hdr?'zscale=t=linear:npl=100,format=gbrpf32le,tonemap=hable,zscale=t=bt709:m=bt709:r=tv,format=yuv420p,':'')+'thumbnail=12,scale=640:-2';await run(ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-y','-threads','1','-filter_threads','1','-ss',String(position),'-i',source.filename,'-map','0:'+video.index,'-an','-sn','-dn','-vf',filter,'-frames:v','1','-q:v','3',temporary]);await rename(temporary,file);
 // Bound the on-disk cache; old frames can always be regenerated.
 const files=await readdir(cache);if(files.length>5000){const old=[];for(const name of files)if(/^[a-f0-9]{64}\.jpg$/.test(name)){const info=await stat(path.join(cache,name));old.push({name,time:info.mtimeMs});}for(const entry of old.sort((a,b)=>a.time-b.time).slice(0,Math.max(0,old.length-4500)))if(entry.name!==key+'.jpg')await unlink(path.join(cache,entry.name)).catch(()=>{});}
 }catch(e){await unlink(temporary).catch(()=>{});failures.set(key,Date.now()+60000);if(failures.size>512)failures.delete(failures.keys().next().value);throw e;}}
 function previewDirectory(media) {
   const key=createHash('sha256').update(JSON.stringify([media.filename,media.size,media.mtime,'preview-v1'])).digest('hex');
   return path.join(built,key);
 }
 const previewPaths=new Map();
 async function completedPreviews(items){
   const folders=new Set(await readdir(built).catch(error=>{
     if(error.code==='ENOENT')return [];
     throw error;
   }));
   const completed=new Set();
   if(!folders.size)return completed;
   let index=0;
   await Promise.all(Array.from({length:Math.min(items.length,8)},async()=>{
     while(index<items.length){
       const item=items[index++],previous=previewPaths.get(item.id);
       let directory=previous&&previous.size===item.size&&previous.modifiedAt===item.modifiedAt&&previous.path===item.path?previous.directory:null;
       if(!directory){
         const info=await stat(item.path).catch(()=>null);
         if(!info?.isFile()||info.size!==item.size||info.mtime.toISOString()!==item.modifiedAt)continue;
         directory=previewDirectory({filename:item.path,size:info.size,mtime:info.mtimeMs});
         if(previewPaths.size>=100000)previewPaths.delete(previewPaths.keys().next().value);
         previewPaths.set(item.id,{path:item.path,size:item.size,modifiedAt:item.modifiedAt,directory});
       }
       if(folders.has(path.basename(directory))&&(await stat(path.join(directory,'complete')).catch(()=>null))?.isFile())completed.add(item.id);
     }
   }));
   return completed;
 }
 function prebuild(media, options) {
   const destination=previewDirectory(media);
   if(building.has(destination))return building.get(destination);
   const task=buildPreviews(media,destination,options).finally(()=>building.delete(destination));
   building.set(destination,task);
   return task;
 }
 async function buildPreviews(media,destination,{light,stopped,run,progress=()=>{}}) {
   if((await stat(path.join(destination,'complete')).catch(()=>null))?.isFile())return false;
   const probe=JSON.parse((await run(ffprobe,['-v','error','-show_entries','format=duration:stream=index,codec_type,color_transfer:stream_disposition=attached_pic','-of','json',media.filename],light())).toString());
   const video=probe.streams?.find(stream=>stream.codec_type==='video'&&!stream.disposition?.attached_pic),duration=Math.min(86400,Number(probe.format?.duration));
   if(!video||!Number.isFinite(duration)||duration<=0)return false;
   await mkdir(destination,{recursive:true});
   const hdr=['smpte2084','arib-std-b67'].includes(video.color_transfer);
   const filter='tpad=stop_mode=clone:stop_duration=15,fps=1/15:start_time=0:round=up,'+(hdr?'zscale=t=linear:npl=100,format=gbrpf32le,tonemap=hable,zscale=t=bt709:m=bt709:r=tv,format=yuv420p,':'')+'scale=320:-2';
   const count=Math.ceil(duration/15);
   for(let first=0;first<count;first+=20){
     progress(first,count);
     if(stopped())return false;
     const last=Math.min(first+20,count),missing=[];
     for(let index=first;index<last;index++)if(!(await stat(path.join(destination,index+'.jpg')).catch(()=>null))?.size)missing.push(index);
     if(!missing.length)continue;
     const stage=await mkdtemp(path.join(destination,'batch-'));
     try{
       const low=light(),threads=low?'1':'2';
       await run(ffmpeg,['-nostdin','-v','error','-threads',threads,'-filter_threads',threads,...(low?['-readrate','6']:[]),'-ss',String(first*15),'-i',media.filename,'-map','0:'+video.index,'-an','-sn','-dn','-vf',filter,'-frames:v',String(last-first),'-threads',threads,'-q:v','5','-start_number',String(first),path.join(stage,'%d.jpg')],low);
       for(const name of await readdir(stage))if(/^\d+\.jpg$/.test(name))await rename(path.join(stage,name),path.join(destination,name));
     }finally{
       for(const name of await readdir(stage))if(/^\d+\.jpg$/.test(name))await unlink(path.join(stage,name)).catch(()=>{});
       await rmdir(stage).catch(()=>{});
     }
   }
   const files=await readdir(destination);
   if(files.filter(name=>/^\d+\.jpg$/.test(name)).length<count)throw fail('Some preview frames could not be generated.');
   const {writeFile}=await import('node:fs/promises');
   await writeFile(path.join(destination,'complete'),'1');
   progress(count,count);
   return true;
 }
 return {prebuild,completedPreviews,
 async available(libraryId,itemId,admin=false){
   const media=await source(libraryId,itemId,admin);
   return !!(await stat(path.join(previewDirectory(media),'complete')).catch(()=>null))?.isFile();
 },
 async get(libraryId,itemId,admin=false,at=null){const media=await source(libraryId,itemId,admin),key=createHash('sha256').update(JSON.stringify([media.filename,media.size,media.mtime,'frame-v1',at])).digest('hex'),file=path.join(posters,key+'.jpg');if(at!==null){
 const folder=previewDirectory(media);
 if(!(await stat(path.join(folder,'complete')).catch(()=>null))?.isFile())throw fail('Trickplay is not generated for this video.',404);
 const content=await readFile(path.join(folder,Math.floor(at/15)+'.jpg')).catch(()=>null);
 if(!content?.length)throw fail('Preview frame not found.',404);
 await source(libraryId,itemId,admin);
 return {content,mime:'image/jpeg'};
 }if(!(await stat(file).catch(()=>null))?.size){if(closed)throw fail('Thumbnail service is stopping.');if(failures.get(key)>Date.now())throw fail('Video thumbnail is temporarily unavailable.');let task=pending.get(key);if(!task){if(pending.size>=128)throw fail('Thumbnail generation is busy. Try again shortly.');task=queue.then(()=>generate(media,key,file));queue=task.catch(()=>{});pending.set(key,task);task.finally(()=>pending.delete(key)).catch(()=>{});}await task;}await source(libraryId,itemId,admin);return {content:await readFile(file),mime:'image/jpeg'};},async close(){closed=true;for(const child of children)child.kill();await queue;}};
}
