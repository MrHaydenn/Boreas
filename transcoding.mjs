import {fileURLToPath} from 'node:url';
import {upscaleArguments} from './upscaling.mjs';
import path from 'node:path';
import {mkdir,readFile,readdir,rm,open,stat,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {selectMediaTracks} from './track-delivery.mjs';
const fail=(message,status=400)=>Object.assign(Error(message),{status});
export const TRANSCODE_PROFILES={sdr720:{label:"GPU · 720p SDR · ~4 Mbps",hdr:false,bitrate:"3744k",width:1280,height:720},sdr480:{label:"GPU · 480p SDR · ~1 Mbps",hdr:false,bitrate:"744k",width:854,height:480},upscale1440p60:{label:'1440p 60 fps Upscaling · GPU AI',ai:true,fps60:true,resolution:'2560x1440'},upscale4k60:{label:'4K 60 fps Upscaling · GPU AI',ai:true,fps60:true},upscale4k:{label:'4K Upscaling · GPU AI',ai:true},styled:{label:'Source resolution · Styled subtitles',styled:true},originalstream:{label:'Original video · AAC compatible audio',copy:true},hdr10copy:{label:'Original 4K HDR10 · Video stream copy',hdr:true,copy:true},sdr1080:{label:'GPU · 1080p SDR · 8 Mbps',hdr:false,bitrate:'8M',width:1920,height:1080},hdr4k:{label:'GPU · 4K HDR10 · 35 Mbps',hdr:true,bitrate:'35M',width:3840,height:2160}};
TRANSCODE_PROFILES.upscale1440p={label:'1440p Upscaling · GPU AI',ai:true,resolution:'2560x1440'};
for(const [name,profile] of Object.entries(TRANSCODE_PROFILES)){
 if(!profile.ai)continue;
 for(const [scaler,label] of Object.entries({nis:'NVIDIA Image Scaling',spline:'Spline36',anime:'Anime4K'})){
  TRANSCODE_PROFILES[name+'-'+scaler]={...profile,scaler,label:profile.label.split(' · ')[0]+' · '+label};
 }
 for(const strength of [2,3,4]){
  TRANSCODE_PROFILES[name+'-'+strength]={...profile,strength,label:profile.label+' · Strength '+strength};
 }
}

export function playbackQualityOptions(settings={},sourceBitrate=0,video=null){
 const {width=0,height=0}=video||{};
 // Width identifies widescreen sources with the letterboxing cropped out.
 const resolution=width>=7680||height>=4320?'8K':width>=3840||height>=2160?'4K':
   width===2560||height===1440?'1440p':width===1920||height===1080?'1080p':
   width===1280||height===720?'720p':height>0?height+'p':null;
 return [
  {profile:'original',label:resolution?'Maximum ('+resolution+')':'Maximum',mbps:sourceBitrate>0?sourceBitrate/1e6:null},
  {profile:'sdr1080',label:'1080p',mbps:(settings.sdrBitrate||8)+.256},
  {profile:'sdr720',label:'720p',mbps:4},
  {profile:'sdr480',label:'480p',mbps:1}
 ];
}
export function transcodeArguments(filename,probe,preferences,profile,start,destination,settings={},options={}){
 const p=TRANSCODE_PROFILES[profile]?{...TRANSCODE_PROFILES[profile]}:null;if(profile==="sdr1080")p.bitrate=(settings.sdrBitrate||8)+"M";if(profile==="hdr4k")p.bitrate=(settings.hdrBitrate||35)+"M";if(!p)throw fail('Unknown GPU playback profile.');
 const tracks=selectMediaTracks(probe.streams||[],preferences,options),v=tracks.video;if(!v)throw fail('No video stream found.',415);
 if(p.styled){
   const hdr=v.color_transfer==='smpte2084'&&v.color_primaries==='bt2020';
   if(v.color_transfer==='arib-std-b67')throw fail('Styled subtitles for HLG video are not supported yet. Choose Simple browser subtitles in Server → Transcoder.',415);
   if(!tracks.subtitle||!['ass','ssa','subrip','webvtt','mov_text','text'].includes(tracks.subtitle.codec_name))throw fail('Choose a text subtitle track for styled playback.',415);
   const filter='setpts=PTS+'+start+'/TB,subtitles=filename=subtitles.ass:fontsdir=fonts,setpts=PTS-STARTPTS,format='+(hdr?'p010le':'yuv420p');
   return {tracks,args:['-hide_banner','-loglevel','warning','-nostdin','-y','-ss',String(start),'-readrate','1.1','-i',filename,'-map','0:'+v.index,...(tracks.audio?['-map','0:'+tracks.audio.index]:[]),'-sn','-dn','-vf',filter,
     '-c:v',hdr?'hevc_nvenc':'h264_nvenc','-preset',settings.preset||'p5','-tune','hq','-rc','vbr','-cq','18','-b:v','0','-profile:v',hdr?'main10':'high',
     ...(hdr?['-tag:v','hvc1','-color_primaries','bt2020','-color_trc','smpte2084','-colorspace','bt2020nc']:[]),
     '-force_key_frames','expr:gte(t,n_forced*4)','-c:a','aac','-b:a','320k','-ac','2','-f','hls','-hls_time','4','-hls_list_size','0','-hls_segment_type','fmp4','-hls_flags','independent_segments+temp_file','-hls_segment_filename',path.join(destination,'segment%06d.m4s'),path.join(destination,'index.m3u8')]};
 }
 const hdr=['smpte2084','arib-std-b67'].includes(v.color_transfer);if(p.hdr&&v.color_transfer!=='smpte2084')throw fail('HDR10 conversion requires a PQ HDR source. Use original playback or SDR.',415);
 if(profile==='originalstream'){const dv=v.side_data_list?.find(s=>s.side_data_type==='DOVI configuration record'),stripDv=v.codec_name==='hevc'&&v.color_transfer==='smpte2084'&&v.color_primaries==='bt2020'&&dv&&[1,6].includes(dv.dv_bl_signal_compatibility_id);return {tracks,args:['-hide_banner','-loglevel','warning','-nostdin','-y','-ss',String(start),'-readrate','1.1','-i',filename,'-map','0:'+v.index,...(tracks.audio?['-map','0:'+tracks.audio.index]:[]),'-c:v','copy',...(stripDv?['-bsf:v','hevc_metadata=remove_dovi=1']:[]),...(v.codec_name==='hevc'?['-tag:v','hvc1']:[]),'-c:a','aac','-b:a','320k','-ac','2','-sn','-dn','-avoid_negative_ts','make_zero','-f','hls','-hls_time','4','-hls_list_size','0','-hls_segment_type','fmp4','-hls_flags','independent_segments+temp_file','-hls_segment_filename',path.join(destination,'segment%06d.m4s'),path.join(destination,'index.m3u8')]};}
 if(p.copy){const dv=v.side_data_list?.find(s=>s.side_data_type==='DOVI configuration record');if(v.codec_name!=='hevc'||v.color_primaries!=='bt2020'||!dv||![1,6].includes(dv.dv_bl_signal_compatibility_id))throw fail('This source does not have a verified HDR10-compatible Dolby Vision base layer.',415);const compatible=['aac','ac3','eac3','mp3','alac'];if(tracks.audio&&!compatible.includes(tracks.audio.codec_name)){const alternate=probe.streams.find(s=>s.codec_type==='audio'&&s.tags?.language===tracks.audio.tags?.language&&compatible.includes(s.codec_name));if(alternate)tracks.audio=alternate;}const copyAudio=!tracks.audio||compatible.includes(tracks.audio.codec_name);return {tracks,args:['-hide_banner','-loglevel','warning','-nostdin','-y','-ss',String(start),'-readrate','1.1','-i',filename,'-map','0:'+v.index,...(tracks.audio?['-map','0:'+tracks.audio.index]:[]),'-c:v','copy','-bsf:v','hevc_metadata=remove_dovi=1','-tag:v','hvc1','-c:a',copyAudio?'copy':'aac',...(!copyAudio?['-b:a','320k','-ac','2']:[]),'-sn','-dn','-avoid_negative_ts','make_zero','-f','hls','-hls_time','4','-hls_list_size','0','-hls_segment_type','fmp4','-hls_flags','independent_segments+temp_file','-hls_segment_filename',path.join(destination,'segment%06d.m4s'),path.join(destination,'index.m3u8')]};}
 const width=Math.min(p.width,Number(v.width)),height=Math.min(p.height,Number(v.height));
 const filter=`scale_cuda=w=${width}:h=${height}:force_original_aspect_ratio=decrease:force_divisible_by=2:format=p010le`+(p.hdr?'':hdr?',tonemap_cuda=tonemap=bt2390:format=nv12':',scale_cuda=format=nv12');
 return {tracks,args:['-hide_banner','-loglevel','warning','-nostdin','-y',...(settings.hardwareDecoding===false?['-init_hw_device','cuda=gpu:0','-filter_hw_device','gpu']:['-hwaccel','cuda','-hwaccel_output_format','cuda']),'-ss',String(start),'-readrate','1.1','-i',filename,'-map','0:'+v.index,...(tracks.audio?['-map','0:'+tracks.audio.index]:[]),'-sn','-dn','-vf',(settings.hardwareDecoding===false?'format=p010le,hwupload_cuda,':'')+filter,'-c:v',p.hdr?'hevc_nvenc':'h264_nvenc','-preset',settings.preset||'p5','-tune','hq','-profile:v',p.hdr?'main10':'high','-b:v',p.bitrate,'-maxrate',p.bitrate,'-bufsize',p.hdr?'70M':'24M','-g',String(Math.max(24,Math.min(240,Math.round((Number(String(v.avg_frame_rate||v.r_frame_rate||'24/1').split('/')[0])/Number(String(v.avg_frame_rate||v.r_frame_rate||'24/1').split('/')[1]||1)||24)*4)))),'-forced-idr','1','-force_key_frames','expr:gte(t,n_forced*4)','-color_primaries',p.hdr?'bt2020':'bt709','-color_trc',p.hdr?'smpte2084':'bt709','-colorspace',p.hdr?'bt2020nc':'bt709',...(p.hdr?['-tag:v','hvc1']:[]),'-c:a','aac','-ac','2','-b:a','256k','-f','hls','-hls_time','4','-hls_list_size','0','-hls_segment_type','fmp4','-hls_flags','independent_segments+temp_file','-hls_segment_filename',path.join(destination,'segment%06d.m4s'),path.join(destination,'index.m3u8')]};
}
export async function createTranscoding(directory,libraries,languages,{settings=()=>({maxSessions:2,bufferSegments:180,idleSeconds:120}),ffmpeg=process.env.LUMEN_NATIVE_FFMPEG||'C:/Program Files/Jellyfin/Server/ffmpeg.exe',ffprobe=process.env.LUMEN_NATIVE_FFPROBE||'C:/Program Files/Jellyfin/Server/ffprobe.exe'}={}){
 const root=path.join(directory,'gpu-playback');await mkdir(root,{recursive:true});
 for(const name of await readdir(root))if(/^[a-f0-9-]{36}$/.test(name))await rm(path.join(root,name),{recursive:true,force:true});
 const jobs=new Map();let closed=false;
 function owned(user,id){const j=jobs.get(id);if(!j||j.user!==user)throw fail('GPU playback session not found.',404);j.touched=Date.now();return j;}
 async function release(user,id){const j=owned(user,id);jobs.delete(id);if(j.child&&j.child.exitCode===null){j.child.kill();await j.finished;}j.liveInput?.release();await rm(j.directory,{recursive:true,force:true,maxRetries:5,retryDelay:200});return {ok:true};}
 async function prepare(user,libraryId,itemId,admin=false,options={},liveInput=null){
  // Reclaim abandoned/failed jobs before applying capacity limits. A client
  // replacing its own stream must not compete with its previous request.
  for(const job of [...jobs.values()])if(job.state==='error'||Date.now()-job.touched>job.settings.idleSeconds*1000||options.clientId&&job.user===user&&job.clientId===options.clientId)await release(job.user,job.id).catch(()=>{});

  if(TRANSCODE_PROFILES[options.profile]?.ai&&[...jobs.values()].some(job=>TRANSCODE_PROFILES[job.profile]?.ai))throw fail('The GPU AI upscaler is already in use. Choose Maximum or close the other upscaled stream.',409);
  if(closed)throw fail('Playback service is stopping.',503);if(!TRANSCODE_PROFILES[options.profile])throw fail('Choose a GPU playback profile.');
  if(jobs.size>=settings().maxSessions)throw fail(settings().maxSessions+' of '+settings().maxSessions+' media-processing slots are in use. Close another processed stream or use direct playback.',409);
  const item=liveInput||await libraries.item(libraryId,itemId,admin);
  let filename=liveInput?.url;
  if(!liveInput){const media=await libraries.openMedia(libraryId,itemId,admin);filename=media.filename;await media.handle.close();}
  if(closed)throw fail('Playback service is stopping.',503);if(jobs.size>=settings().maxSessions)throw fail(settings().maxSessions+' of '+settings().maxSessions+' media-processing slots are in use. Close another processed stream or use direct playback.',409);
  if(TRANSCODE_PROFILES[options.profile]?.ai&&[...jobs.values()].some(job=>TRANSCODE_PROFILES[job.profile]?.ai))throw fail('The GPU AI upscaler is already in use. Choose Maximum or close the other upscaled stream.',409);
  const id=randomUUID(),j={id,user,libraryId,itemId,directory:path.join(root,id),profile:options.profile,liveInput,comparison:options.comparison===true,clientId:typeof options.clientId==='string'?options.clientId.slice(0,120):null,title:[item.series,item.title].filter(Boolean).join(" · "),poster:item.metadata?.seriesPoster||item.artwork||item.metadata?.poster||null,settings:settings(),state:'preparing',touched:Date.now()};jobs.set(id,j);
  try{const {stdout}=await promisify(execFile)(ffprobe,['-v','error','-show_streams','-show_format','-of','json',filename],{windowsHide:true,timeout:20000,maxBuffer:4*1024**2});if(!jobs.has(id)||closed)throw fail('Playback was cancelled.',410);
   const probe=JSON.parse(stdout);j.duration=Number(probe.format?.duration)||0;j.offset=Math.max(0,Math.min(Math.max(0,j.duration-1),Number(options.position)||0));await mkdir(j.directory,{recursive:true});
   const preferences=liveInput?{audioLanguages:[]}:languages.effective(user,libraryId,item,admin);
   if(j.profile==='styled'){
     const selected=selectMediaTracks(probe.streams||[],preferences,options);
     if(!selected.subtitle)throw fail('No subtitle track is selected.',415);
     const execute=promisify(execFile);
     await execute(ffmpeg,['-nostdin','-v','error','-y','-i',filename,'-map','0:'+selected.subtitle.index,'-c:s','ass','-f','ass','subtitles.ass'],{cwd:j.directory,windowsHide:true,timeout:60000,maxBuffer:1024*1024});
     await mkdir(path.join(j.directory,'fonts'));
     const fonts=(probe.streams||[]).filter(stream=>stream.codec_type==='attachment').map((stream,index)=>({stream,index})).filter(({stream})=>['ttf','otf'].includes(stream.codec_name)&&Number(stream.extradata_size||0)<=10*1024*1024).slice(0,32);
     if(fonts.length){
       const args=fonts.flatMap(({stream,index})=>['-dump_attachment:t:'+index,'fonts/font-'+index+'.'+stream.codec_name]);
       await execute(ffmpeg,['-nostdin','-v','error','-y',...args,'-i',filename,'-map','0:v:0','-frames:v','0','-f','null','-'],{cwd:j.directory,windowsHide:true,timeout:30000,maxBuffer:1024*1024});
     }
   }
   if(!jobs.has(id)||closed)throw fail('Playback was cancelled.',410);
   const selected=selectMediaTracks(probe.streams||[],preferences,options);
   let binary=ffmpeg,pipeline,seek=j.offset;
   if(!liveInput&&(TRANSCODE_PROFILES[j.profile].ai||j.comparison&&j.profile==='originalstream')){
     const requested=j.offset,origin=Number(probe.format?.start_time)||0;
     const {stdout:timestamps}=await promisify(execFile)(ffprobe,[
       '-v','error','-select_streams','v:0','-read_intervals',String(requested)+'%+5',
       '-show_packets','-show_entries','packet=pts_time,flags','-of','json',filename
     ],{windowsHide:true,timeout:20000,maxBuffer:4*1024**2});
     const keys=(JSON.parse(timestamps).packets||[]).filter(packet=>packet.flags?.includes('K'))
       .map(packet=>Number(packet.pts_time)-origin).filter(Number.isFinite).sort((a,b)=>a-b);
     const keyframe=keys.findLast(time=>time<=requested+.001)??(requested===0?keys[0]:undefined);
     if(keyframe===undefined)throw fail('The source keyframe could not be located for accurate AI playback.',415);
     j.offset=Math.max(0,keyframe);
     // NVEnc seeks forward to a keyframe. Seek just before the chosen keyframe
     // to avoid floating-point rounding skipping it.
     seek=keyframe>0?Math.max(0,keyframe-.01):0;
   }
   if(TRANSCODE_PROFILES[j.profile].ai){
     binary=process.env.LUMEN_NATIVE_UPSCALER||fileURLToPath(new URL('./work/upscaling/nvencc-9.40/NVEncC64.exe',import.meta.url));
     if(!(await stat(binary).catch(()=>null))?.isFile())throw fail('The GPU AI upscaler is unavailable on this server.',503);
     pipeline={tracks:selected,args:upscaleArguments(filename,probe,selected,seek,j.directory,{...TRANSCODE_PROFILES[j.profile],live:!!liveInput})};
   }else pipeline=transcodeArguments(filename,probe,preferences,j.profile,j.offset,j.directory,j.settings,options);
   const {args,tracks}=pipeline;
   if(liveInput&&!TRANSCODE_PROFILES[j.profile].ai){
     args[args.indexOf('-hls_list_size')+1]='8';
     args[args.indexOf('-hls_flags')+1]='independent_segments+temp_file+delete_segments';
   }
   j.selection={audio:tracks.audio?{index:tracks.audio.index,language:tracks.audio.tags?.language,codec:TRANSCODE_PROFILES[j.profile].copy&&j.profile!=='originalstream'?tracks.audio.codec_name:'aac'}:null,subtitle:j.profile==='styled'?{index:tracks.subtitle.index,codec:tracks.subtitle.codec_name,burned:true}:null};j.warning=tracks.subtitle&&!options.webSubtitles&&j.profile!=='styled'?'Processed streaming currently omits subtitles. Use direct playback when subtitles are needed.':null;
   j.child=spawn(binary,args,{cwd:j.directory,windowsHide:true,stdio:['ignore','ignore','pipe']});let errors='';j.child.stderr.on('data',chunk=>{errors=(errors+chunk.toString()).slice(-4000);});j.finished=new Promise(resolve=>{j.child.once('error',()=>{j.state='error';j.error='GPU playback could not start. Check FFmpeg and the NVIDIA driver.';resolve();});j.child.once('close',code=>{if(code!==0&&jobs.has(id)){j.state='error';j.error=TRANSCODE_PROFILES[j.profile].ai?'GPU AI upscaling stopped. Choose Maximum to continue.':'GPU conversion stopped. Try original playback or another profile.';}resolve();});});
   return {id,state:j.state};
  }catch(e){await release(user,id).catch(()=>{});throw e;}
 }
 async function status(user,id,admin=false){const j=owned(user,id);if(!j.liveInput)await libraries.item(j.libraryId,j.itemId,admin);if(j.state!=='error'){const playlist=await readFile(path.join(j.directory,'index.m3u8'),'utf8').catch(()=>'');if(playlist.includes('.m4s')&&(await stat(path.join(j.directory,'init.mp4')).catch(()=>null))?.size)j.state='ready';}
 if(!j.liveInput&&(TRANSCODE_PROFILES[j.profile].ai||j.comparison)&&j.state==='ready'){
   if(!j.mediaOriginPromise)j.mediaOriginPromise=promisify(execFile)(ffprobe,[
     '-v','error','-analyzeduration','1000000','-probesize','1000000',
     '-show_entries','stream=codec_type,start_time','-of','json',path.join(j.directory,'index.m3u8')
   ],{windowsHide:true,timeout:10000,maxBuffer:1024*1024}).then(({stdout})=>{
     const origin=Number(JSON.parse(stdout).streams?.find(stream=>stream.codec_type==='video')?.start_time);
     if(!Number.isFinite(origin))throw fail('The AI stream timestamp could not be determined.',502);
     return origin;
   });
   j.mediaOrigin=await j.mediaOriginPromise;
 }
 return {id,state:j.state,error:j.error,duration:j.duration,offset:j.offset-(j.mediaOrigin||0),profile:j.profile,label:TRANSCODE_PROFILES[j.profile].ai?TRANSCODE_PROFILES[j.profile].label:TRANSCODE_PROFILES[j.profile].styled?TRANSCODE_PROFILES[j.profile].label:TRANSCODE_PROFILES[j.profile].copy?TRANSCODE_PROFILES[j.profile].label:TRANSCODE_PROFILES[j.profile].label.replace(/\d+ Mbps$/,(j.profile==='sdr1080'?j.settings.sdrBitrate||8:j.profile==='sdr720'?4:j.profile==='sdr480'?1:j.settings.hdrBitrate||35)+' Mbps'),selection:j.selection,warning:j.warning,subtitleUrl:null,url:'/api/playback/gpu/'+id+'/index.m3u8'};}
 async function asset(user,id,name,admin=false){const j=owned(user,id);if(!j.liveInput)await libraries.item(j.libraryId,j.itemId,admin);if(!/^(index\.m3u8|init\.mp4|segment\d{6}\.m4s)$/.test(name))throw fail('Invalid playback asset.',404);const handle=await open(path.join(j.directory,name),'r').catch(()=>{throw fail('This part of the playback buffer expired. Seek again to restart it.',410);});const info=await handle.stat();return {handle,size:info.size,mime:name.endsWith('m3u8')?'application/vnd.apple.mpegurl':name.endsWith('m4s')?'video/iso.segment':'video/mp4'};}
 const timer=setInterval(async()=>{for(const j of jobs.values()){if(Date.now()-j.touched>j.settings.idleSeconds*1000){await release(j.user,j.id).catch(()=>{});continue;}const names=(await readdir(j.directory).catch(()=>[])).filter(n=>/^segment\d{6}\.m4s$/.test(n)).sort();for(const n of names.slice(0,-j.settings.bufferSegments))await unlink(path.join(j.directory,n)).catch(()=>{});}},10000);timer.unref();
 function targetBitrate(job){
   const profile=TRANSCODE_PROFILES[job.profile];
   if(!profile.bitrate)return null;
   const configured=job.profile==="sdr1080"?job.settings.sdrBitrate:job.profile==="hdr4k"?job.settings.hdrBitrate:null;
   return (configured||parseFloat(profile.bitrate)*(profile.bitrate.endsWith("k")?.001:1))*1e6;
 }
 return {sessions:()=>[...jobs.values()].map(j=>({id:'gpu:'+j.id,gpuId:j.id,userId:j.user,title:j.title,poster:j.poster,bitrate:targetBitrate(j),targetBitrate:true,profile:TRANSCODE_PROFILES[j.profile].label,phase:j.state,done:0,total:j.duration||0})),async end(id){const j=jobs.get(id);if(j)await release(j.user,id);return {ok:true};},activity:()=>[...jobs.values()].filter(job=>job.state!=='error'&&job.child?.exitCode==null).map(job=>({name:job.title,state:job.state==='ready'?'Streaming':'Preparing',profile:TRANSCODE_PROFILES[job.profile].label})),libraryFor(user,id){return owned(user,id).libraryId;},prepare,status,asset,release,async close(){closed=true;clearInterval(timer);await Promise.all([...jobs.values()].map(j=>release(j.user,j.id).catch(()=>{})));}};
}
