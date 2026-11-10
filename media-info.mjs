import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

// Read-only, bounded probing for title-page labels. Never prepares or transcodes media.
export function createMediaInfo(libraries,{ffprobe=process.env.LUMEN_NATIVE_FFPROBE||'C:/Program Files/Jellyfin/Server/ffprobe.exe'}={}){
 const cache=new Map();let queue=Promise.resolve();
 const language=code=>({und:'Unspecified',eng:'English',en:'English',ara:'Arabic',por:'Portuguese',jpn:'Japanese',ja:'Japanese',spa:'Spanish',fra:'French',deu:'German',kor:'Korean',zho:'Chinese'}[code]||code||'Unspecified');
 return async(libraryId,itemId,admin=false)=>{
  let media;try{media=await libraries.openMedia(libraryId,itemId,admin);const key=libraryId+'/'+itemId+':'+media.size+':'+media.modifiedAt,filename=media.filename,size=media.size;await media.handle.close();media=null;
   if(cache.has(key))return cache.get(key);
   const pending=queue.then(async()=>{try{const {stdout}=await promisify(execFile)(ffprobe,['-v','error','-show_streams','-show_format','-of','json',filename],{windowsHide:true,maxBuffer:2*1024*1024,timeout:8000});const info=JSON.parse(stdout),streams=info.streams||[],video=streams.find(s=>s.codec_type==='video'&&!s.disposition?.attached_pic),audios=streams.filter(s=>s.codec_type==='audio'),audio=audios.find(s=>s.disposition?.default)||audios[0],subs=streams.filter(s=>s.codec_type==='subtitle'),technical=[];
    if(video)technical.push([video.height?video.height+'p':'',({h264:'H.264',hevc:'HEVC',av1:'AV1'})[video.codec_name]||video.codec_name?.toUpperCase()].filter(Boolean).join(' · '));
    if(audio)technical.push(language(audio.tags?.language)+' ('+String(audio.codec_name||'Audio').toUpperCase()+' '+({1:'Mono',2:'Stereo',6:'5.1',8:'7.1'}[audio.channels]||audio.channel_layout||'')+')');
    if(subs.length){const names=[...new Set(subs.map(s=>language(s.tags?.language)))];technical.push('Subtitles · '+names.slice(0,3).join(', ')+(names.length>3?' +'+(names.length-3):''));}
    const duration=Number(info.format?.duration),dv=video?.side_data_list?.find(s=>s.side_data_type==="DOVI configuration record");const track=(s,ordinal)=>({id:s.index,ordinal,language:({en:'eng',ja:'jpn',es:'spa',fr:'fra',de:'deu',it:'ita',pt:'por',ko:'kor',zh:'zho'}[s.tags?.language]||s.tags?.language||'und'),codec:s.codec_name,channels:s.channels,forced:!!s.disposition?.forced||/forced|signs/i.test(s.tags?.title||''),title:[language(s.tags?.language),s.tags?.title,s.disposition?.forced?'Forced':'',s.codec_name?.toUpperCase(),s.channels?s.channels+' channels':''].filter(Boolean).join(' · ')});
    return {technical,sourceBitrate:duration>0?size*8/duration:0,audioTracks:audios.map(track),subtitleTracks:subs.map(track),videoDetails:video?{frameRate:(()=>{const [n,d]=String(video.avg_frame_rate||video.r_frame_rate||'0/1').split('/').map(Number);return d>0&&Number.isFinite(n/d)?n/d:0;})(),codec:video.codec_name,transfer:video.color_transfer,primaries:video.color_primaries,width:video.width,height:video.height,dolbyVision:dv?{profile:dv.dv_profile,level:dv.dv_level,compatibilityId:dv.dv_bl_signal_compatibility_id}:null}:null,...(duration>0?{durationSeconds:duration}:{})};
   }catch{return {technical:[]};}});queue=pending.catch(()=>{});if(cache.size>=128)cache.delete(cache.keys().next().value);cache.set(key,pending);return pending;
  }catch{await media?.handle.close().catch(()=>{});return {technical:[]};}
 };
}
