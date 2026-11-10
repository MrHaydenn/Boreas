import path from 'node:path';
import {mkdir,stat,readdir,unlink,open} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
import {selectMediaTracks} from './track-delivery.mjs';

const fail=(message,status=400)=>Object.assign(Error(message),{status});
export function createSubtitleDelivery(directory,libraries,languages,{ffmpeg=process.env.LUMEN_NATIVE_FFMPEG||'C:/Program Files/Jellyfin/Server/ffmpeg.exe',ffprobe=process.env.LUMEN_NATIVE_FFPROBE||'C:/Program Files/Jellyfin/Server/ffprobe.exe'}={}){
  const root=path.join(directory,'subtitle-cache'),jobs=new Map(),cache=new Map();
  let queue=Promise.resolve();
  const execute=promisify(execFile);
  async function inspect(user,libraryId,itemId,admin,options){
    const item=await libraries.item(libraryId,itemId,admin),media=await libraries.openMedia(libraryId,itemId,admin);
    const filename=media.filename,key=filename+':'+media.size+':'+media.modifiedAt;
    await media.handle.close();
    let probe=cache.get(key);
    if(!probe){
      probe=execute(ffprobe,['-v','error','-show_streams','-of','json',filename],{windowsHide:true,timeout:20000,maxBuffer:4*1024**2}).then(({stdout})=>JSON.parse(stdout));
      if(cache.size>=128)cache.delete(cache.keys().next().value);
      cache.set(key,probe);
      void probe.catch(()=>cache.delete(key));
    }
    const {streams=[]}=await probe;
    const selected=selectMediaTracks(streams,languages.effective(user,libraryId,item,admin),options);
    const track=stream=>({index:stream.index,language:stream.tags?.language||'und',title:stream.tags?.title||'',codec:stream.codec_name,channels:stream.channels,forced:!!stream.disposition?.forced||/forced|signs/i.test(stream.tags?.title||'')});
    return {filename,key,streams,selected,audio:streams.filter(s=>s.codec_type==='audio').map(track),subtitles:streams.filter(s=>s.codec_type==='subtitle').map(track)};
  }
  async function prepare(user,libraryId,itemId,admin,options={}){
    const info=await inspect(user,libraryId,itemId,admin,options),subtitle=info.selected.subtitle;
    const video=info.selected.video;
    const result={video:video?{width:video.width,height:video.height,codec:video.codec_name,transfer:video.color_transfer,primaries:video.color_primaries}:null,audio:info.audio,subtitles:info.subtitles,audioIndex:info.selected.audio?.index??null,subtitleIndex:subtitle?.index??null,format:null,fonts:[]};
    if(!subtitle)return result;
    if(!['ass','ssa','subrip','webvtt','mov_text','text'].includes(subtitle.codec_name)){
      result.warning='This image subtitle format is not supported in the browser yet.';
      return result;
    }
    const format=['ass','ssa'].includes(subtitle.codec_name)?'ass':'vtt';
    const offset=options.timeOffset===undefined?0:Number(options.timeOffset);
    if(!Number.isFinite(offset)||Math.abs(offset)>86400)throw fail('Invalid subtitle timestamp offset.');
    const localSubtitle=offset?'offset-'+Math.round(offset*1000)+'.'+format:'subtitles.'+format;
    const hash=createHash('sha256').update(info.key+':'+subtitle.index+':'+format).digest('hex');
    const folder=path.join(root,hash);
    async function build(){
      await mkdir(folder,{recursive:true});
      const file=path.join(folder,localSubtitle);
      if(!(await stat(file).catch(()=>null))?.size){
        await execute(ffmpeg,['-nostdin','-v','error','-y',...(offset?['-itsoffset',String(-offset)]:[]),'-i',info.filename,'-map','0:'+subtitle.index,'-c:s',format==='ass'?'ass':'webvtt','-f',format==='ass'?'ass':'webvtt',localSubtitle],{cwd:folder,windowsHide:true,timeout:60000,maxBuffer:1024**2});
      }
      const attachments=info.streams.filter(s=>s.codec_type==='attachment');
      const fonts=format==='ass'?attachments.map((stream,index)=>({stream,index})).filter(({stream})=>['ttf','otf'].includes(stream.codec_name)&&Number(stream.extradata_size||0)<=10*1024**2).slice(0,32):[];
      for(const {stream,index}of fonts){
        const font='font-'+index+'.'+stream.codec_name;
        if((await stat(path.join(folder,font)).catch(()=>null))?.size)continue;
        await execute(ffmpeg,['-nostdin','-v','error','-y','-dump_attachment:t:'+index,font,'-i',info.filename,'-map','0:v:0','-frames:v','0','-f','null','-'],{cwd:folder,windowsHide:true,timeout:30000,maxBuffer:1024**2});
      }
      return fonts.map(({stream,index})=>'font-'+index+'.'+stream.codec_name);
    }
    const task=queue.then(build);queue=task.catch(()=>{});
    const fonts=await task,id=randomUUID();
    if(jobs.size>=512)jobs.delete(jobs.keys().next().value);
    jobs.set(id,{user,libraryId,itemId,admin,folder,localSubtitle,files:new Set(['subtitles.'+format,...fonts]),until:Date.now()+24*3600000});
    return {...result,format,url:'/api/playback/subtitles/'+id+'/subtitles.'+format,fonts:fonts.map(font=>'/api/playback/subtitles/'+id+'/'+font)};
  }
  const timer=setInterval(()=>{for(const [id,job]of jobs)if(job.until<Date.now())jobs.delete(id);},60000);
  timer.unref();
  return {
    prepare,
    libraryFor(user,id){
      const job=jobs.get(id);
      if(!job||job.user!==user)throw fail('Subtitle asset not found.',404);
      return job.libraryId;
    },
    async asset(user,id,name){
      const job=jobs.get(id);
      if(!job||job.user!==user||!job.files.has(name))throw fail('Subtitle asset not found.',404);
      const media=await libraries.openMedia(job.libraryId,job.itemId,job.admin);
      await media.handle.close();
      const handle=await open(path.join(job.folder,name.startsWith('subtitles.')?job.localSubtitle:name),'r');
      return {handle,size:(await handle.stat()).size,mime:name.endsWith('.vtt')?'text/vtt; charset=utf-8':name.endsWith('.ass')?'text/plain; charset=utf-8':name.endsWith('.otf')?'font/otf':'font/ttf'};
    },
    async close(){clearInterval(timer);jobs.clear();await queue;}
  };
}
