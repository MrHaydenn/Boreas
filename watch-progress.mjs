import path from 'node:path';import {readFile,writeFile,rename} from 'node:fs/promises';import {randomUUID} from 'node:crypto';
const fail=(message,status=400)=>Object.assign(Error(message),{status});
export async function createWatchProgress(directory,libraries){const filename=path.join(directory,'watch-progress.json');let data={version:1,users:{}};try{data=JSON.parse(await readFile(filename,'utf8'));if(data.version!==1||!data.users)throw Error('Invalid watch progress store.');}catch(e){if(e.code!=='ENOENT')throw e;}let writes=Promise.resolve();const key=(libraryId,itemId)=>libraryId+'/'+itemId;const get=(user,libraryId,itemId)=>data.users[user]?.[key(libraryId,itemId)]||null;
 function decorate(user,libraryId,items){return items.map(item=>({...item,playback:get(user,libraryId,item.id)}));}
 async function summary(user,libraryId,id,kind='item',season=null,admin=false){const scope=await libraries.selection(libraryId,id,kind,season,admin),items=scope.items.filter(i=>kind!=='series'||i.season>0),watched=items.filter(i=>get(user,libraryId,i.id)?.completed).length;return {title:scope.title,total:items.length,watched,completed:items.length>0&&watched===items.length};}
 async function decorateTitles(user,libraryId,items,admin=false){return Promise.all(items.map(async item=>({...item,playback:item.kind==='series'?await summary(user,item.libraryId||libraryId,item.id,'series',null,admin):get(user,item.libraryId||libraryId,item.id)})));}
 async function mark(user,libraryId,id,{kind='item',season=null,watched}={},admin=false){if(typeof watched!=='boolean')throw fail('Choose watched or unwatched.');const scope=await libraries.selection(libraryId,id,kind,season,admin),items=scope.items.filter(i=>kind!=='series'||i.season>0);const pending=writes.then(async()=>{const next=structuredClone(data);next.users[user]||={};const eventAt=Date.now();for(const item of items){const previous=get(user,libraryId,item.id),duration=previous?.duration||1;next.users[user][key(libraryId,item.id)]={position:watched?duration:0,duration,completed:watched,eventAt,updatedAt:new Date().toISOString()};}const temp=filename+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(next),{mode:0o600});await rename(temp,filename);data=next;return {updated:items.length,watched};});writes=pending.catch(()=>{});return pending;}
 async function regularEpisodes(libraryId,seriesId,admin=false){const {items}=await libraries.selection(libraryId,seriesId,'series',null,admin);return items.filter(e=>e.season>0).sort((a,b)=>a.season-b.season||(a.episode??9999)-(b.episode??9999)||a.title.localeCompare(b.title,undefined,{numeric:true,sensitivity:'base'}));}

 async function seriesStart(user,libraryId,seriesId,admin=false){const episodes=await regularEpisodes(libraryId,seriesId,admin);if(!episodes.length)return {item:null};const watched=episodes.filter(e=>{const p=get(user,libraryId,e.id);return p&&(p.completed||p.position>0);}).sort((a,b)=>get(user,libraryId,b.id).eventAt-get(user,libraryId,a.id).eventAt);let selected;if(watched.length){const latest=watched[0],progress=get(user,libraryId,latest.id);selected=!progress.completed&&progress.position>0?latest:episodes.slice(episodes.findIndex(e=>e.id===latest.id)+1).find(e=>!get(user,libraryId,e.id)?.completed);}selected||=episodes.find(e=>!get(user,libraryId,e.id)?.completed)||episodes[0];return {item:decorate(user,libraryId,[selected])[0]};}
 async function adjacent(libraryId,itemId,admin=false){
   const current=await libraries.item(libraryId,itemId,admin);
   if(!current.seriesId||!(current.season>0))return {previous:null,next:null};
   const episodes=await regularEpisodes(libraryId,current.seriesId,admin);
   const index=episodes.findIndex(item=>item.id===itemId);
   const entry=item=>item?{id:item.id,title:item.title,season:item.season,episode:item.episode}:null;
   return {previous:index>0?entry(episodes[index-1]):null,next:index>=0?entry(episodes[index+1]):null};
 }
 return {adjacent,get,decorate,decorateTitles,summary,mark,seriesStart,async save(user,libraryId,itemId,input,admin=false){await libraries.item(libraryId,itemId,admin);const position=Number(input.position),duration=Number(input.duration),eventAt=Number(input.eventAt||Date.now());if(!Number.isFinite(position)||!Number.isFinite(duration)||position<0||duration<=0||duration>1e7||position>duration+5||!Number.isSafeInteger(eventAt)||eventAt>Date.now()+300000)throw fail('Invalid playback progress.');const result=writes.then(async()=>{const previous=get(user,libraryId,itemId);if(previous&&eventAt<previous.eventAt)return previous;const value={position:Math.min(position,duration),duration,completed:!!previous?.completed||position/duration>=.9,eventAt,updatedAt:new Date().toISOString()};const next=structuredClone(data);next.users[user]||={};next.users[user][key(libraryId,itemId)]=value;const temp=filename+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(next),{mode:0o600});await rename(temp,filename);data=next;return value;});writes=result.catch(()=>{});return result;},
 async startedSeries(user,libraryId,admin=false){
  const started=new Set();
  for(const [record,progress] of Object.entries(data.users[user]||{})){
   if(!record.startsWith(libraryId+'/')||!(progress.completed||progress.position>0))continue;
   const item=await libraries.item(libraryId,record.slice(libraryId.length+1),admin).catch(()=>null);
   if(item?.seriesId&&item.season>0)started.add(item.seriesId);
  }
  return started;
 },
 async home(user,allowedLibraryIds=null,{includeUnpinned=false,exclude=()=>false}={}){const visible=new Map(libraries.list(false).filter(l=>(includeUnpinned||l.showOnHome)&&(allowedLibraryIds===null||allowedLibraryIds.includes(l.id))).map(l=>[l.id,l])),records=Object.entries(data.users[user]||{}).sort((a,b)=>b[1].eventAt-a[1].eventAt),groups=new Set(),items=[];
 for(const [recordKey,progress]of records){if(items.length>=30)break;const [libraryId,itemId]=recordKey.split('/'),library=visible.get(libraryId);if(!library||progress.completed&&library.type==='movies'||!progress.completed&&progress.position<=0)continue;let item;try{item=await libraries.item(libraryId,itemId,false);}catch{continue;}
 if(exclude(libraryId,item))continue;
 if(!item.seriesId){if(!progress.completed&&progress.position>0)items.push({...item,libraryId,libraryName:library.name,playback:progress,recommendation:'resume'});continue;}
 if(!(item.season>0)||!progress.completed&&progress.position<=0)continue;
 const group=libraryId+'/'+item.seriesId;if(groups.has(group))continue;groups.add(group);if(!progress.completed&&progress.position>0){items.push({...item,libraryId,libraryName:library.name,playback:progress,recommendation:'resume'});continue;}
 const episodes=await regularEpisodes(libraryId,item.seriesId);const index=episodes.findIndex(e=>e.id===itemId),next=episodes.slice(index+1).find(e=>e.season!==0&&!get(user,libraryId,e.id)?.completed);if(next)items.push({...next,libraryId,libraryName:library.name,playback:get(user,libraryId,next.id),recommendation:'next'});
 }return {items};},async close(){await writes;}};
}
