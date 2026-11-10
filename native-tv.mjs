import {playbackQualityOptions} from './transcoding.mjs';
import {selectMediaTracks} from './track-delivery.mjs';
import {canLibrary,requireLibrary,requirePermission} from './permissions.mjs';
import {hdrDecision} from './hdr-policy.mjs';
// Android TV view of Native's own libraries/accounts. No Plex calls or credentials.
import {randomUUID} from 'node:crypto';
const fail=(message,status=400)=>Object.assign(Error(message),{status});
export const tvId=(library,kind,id,season)=>[library,kind,id,...(season===undefined?[]:[season])].join('~');
export function tvScope(value){const [library,kind,id,season,...extra]=String(value).split('~');if(extra.length||!/^[-a-f0-9]{36}$/.test(library)||!['file','series','season'].includes(kind)||!/^([a-f0-9]{32})$/.test(id)||kind==='season'&&!/^\d{1,3}$/.test(season))throw fail('Invalid native title.');return {library,kind,id,season:season===undefined?null:Number(season)};}
export function nativeTVCard(item,library){const meta=item.metadata||{},episode=!!item.seriesId&&item.kind!=='series',series=item.kind==='series';return {id:tvId(library,series?'series':'file',item.id),libraryId:library,kind:'item',type:series?'Series':episode?'Episode':'Movie',title:item.title||'Untitled',seriesTitle:item.series||'',seriesId:item.seriesId?tvId(library,'series',item.seriesId):'',seasonId:episode&&Number.isInteger(item.season)?tvId(library,'season',item.seriesId,item.season):'',season:item.season,episode:item.episode,year:item.year??meta.year,subtitle:episode?[item.series,'S'+item.season+' · E'+item.episode].filter(Boolean).join(' · '):String(item.year||''),poster:item.artwork||meta.poster||null,backdrop:meta.backdrop||null,logo:meta.logo||null,overview:meta.overview||'',durationSeconds:item.playback?.duration>1?item.playback.duration:Number(meta.runtime||0)*60,resumeSeconds:item.playback?.completed?0:item.playback?.position||0,played:!!item.playback?.completed,rating:meta.rating||meta.contentRating||'',genres:meta.genres||[],director:(meta.directors||[]).join(', '),people:(meta.cast||[]).map(person=>({name:person.name,role:person.character||'',photo:person.photo||null})),technical:[],favorite:false};}
export function createNativeTV({libraries,progress,recommendations,accounts,metadata,ratings,discover,connections,liveTV,dvr,mediaInfo,mediaState,transcoding,transcoderSettings,languages,subtitleDelivery,getDashboard=()=>null,appAvailable=()=>true,videoThumbnails,playbackMarkers,mediaAnalysis}){
 const sessions=new Map();
 return async function handle(req,res,url,{raw,user,body,send}){
  const route=url.pathname.slice('/tv-api/'.length),method=req.method||'GET',admin=user?.role==='admin';
  if(route==='info'&&method==='GET'){send(200,{protocol:'lumen-tv/1',backend:'lumen-native',name:'Boreas',version:'0.1.0',serverId:accounts.serverId,publicUrl:'http://'+req.headers.host,features:['native-login','home','libraries','search','details','playback','progress','card-actions','watched','favorites']});return true;}
  if(!user)throw fail('Sign in to your Boreas account.',401);
  if(!appAvailable('liveTV')&&/^(live|dvr|guide|channel-watch)/.test(route))throw fail('Live TV is disabled on this server.',404);
  if(/^(live|dvr)/.test(route))requirePermission(user,'liveTV');
  if(/^(item|season|card-actions|trailers|ratings)\//.test(route))requireLibrary(user,tvScope(decodeURIComponent(route.slice(route.indexOf('/')+1))).library);
  if(route.startsWith('library/'))requireLibrary(user,route.slice(8).split('/')[0]);
  const withState=(item,library)=>{const value=nativeTVCard(item,library);return {...value,favorite:mediaState?.favorite(user.id,value.id)||false};};
  const card=(item,library)=>withState(progress.decorate(user.id,library,[item])[0],library);
  const page=async(library,options={})=>{requireLibrary(user,library);const result=await libraries.listItems(library,{admin,view:'series',limit:40,...options});return {...result,items:(await progress.decorateTitles(user.id,library,result.items,admin)).map(i=>i.kind==='folder'?{...i,libraryId:library,landscape:true}:{...withState(i,library),landscape:result.library?.type==='home-videos'})};};
  const row=(title,items)=>({title,items});
  const watchingCard=(item,library,landscape=false)=>{
   const value=card(item,library);
   return {...value,landscape,continueWatching:true,poster:item.metadata?.seriesPoster||value.poster,
    subtitle:[item.recommendation==='next'?'Next up':'Resume',value.subtitle].filter(Boolean).join(' · ')};
  };
  if(route==='me'){send(200,{user:{id:user.id,name:user.displayName},backend:'lumen-native'});return true;}
  if(route==='profiles'){
   if(url.searchParams.get('platform')!=='roku'){send(200,{items:[{id:user.id,kind:'profile',title:user.displayName,subtitle:'Boreas account'}]});return true;}
   const status=accounts.status(raw);
   send(200,{items:status.profiles.map(profile=>({id:profile.id,kind:'profile',title:profile.displayName,subtitle:'Boreas profile',protected:profile.id===status.accountId&&user.id!==status.accountId}))});return true;
  }
  if(route==='profiles/switch'){
   const input=await body(req);
   if(input.platform!=='roku'){
    if(input.id!==user.id)throw fail('Sign out to use another account.',403);
    send(200,{session:{AccessToken:'',User:{Id:user.id,Name:user.displayName}}});return true;
   }
   const status=await accounts.selectProfile(raw,input);
   send(200,{csrfToken:status.csrfToken,session:{AccessToken:'',User:{Id:status.user.id,Name:status.user.displayName}}});return true;
  }
  if(route==='libraries'){send(200,{items:libraries.list(admin).filter(l=>canLibrary(user,l.id)).map(l=>({id:l.id,title:l.name,type:l.type==='movies'?'movies':l.type,kind:'library'}))});return true;}
  if(route.startsWith('card-actions/')){const id=decodeURIComponent(route.slice(13)),scope=tvScope(id),kind=scope.kind==='file'?'item':scope.kind,summary=await progress.summary(user.id,scope.library,scope.id,kind,scope.season,admin),selection=await libraries.selection(scope.library,scope.id,kind,scope.season,admin),record=scope.kind==='file'?await libraries.item(scope.library,scope.id,admin):null,type=scope.kind==='season'?'Season':scope.kind==='series'?'Series':record.seriesId?'Episode':'Movie',hiddenId=tvId(scope.library,record?.seriesId||scope.kind!=='file'?'series':'file',record?.seriesId||scope.id);
   if(method==='GET'){send(200,{id,title:summary.title,type,played:summary.completed,favorite:mediaState?.favorite(user.id,id)||false,canFavorite:!!mediaState,canHideContinue:!!mediaState&&scope.kind!=='season',canDelete:admin||user.permissions?.deleteMedia===true,canEditArtwork:admin,fileCount:selection.items.length});return true;}
   if(method==='POST'){const input=await body(req);if(['watched','unwatched'].includes(input.action)){await progress.mark(user.id,scope.library,scope.id,{kind,season:scope.season,watched:input.action==='watched'},admin);send(200,{ok:true,message:input.action==='watched'?'Marked watched.':'Marked unwatched.'});return true;}if(['favorite','unfavorite'].includes(input.action)&&mediaState){await mediaState.setFavorite(user.id,id,input.action==='favorite');send(200,{ok:true,message:input.action==='favorite'?'Added to favorites.':'Removed from favorites.'});return true;}if(input.action==='hideContinue'&&mediaState){await mediaState.setHidden(user.id,hiddenId,true);send(200,{ok:true,message:'Removed from Continue Watching.'});return true;}if(input.action==='delete'){requirePermission(user,'deleteMedia');const result=await libraries.deleteMedia(scope.library,scope.id,{kind,season:scope.season,deleteFiles:true,confirmTitle:input.confirmTitle});send(200,{...result,message:'Selected media files deleted.'});return true;}throw fail('This action is not available.',400);}throw fail('Method not allowed.',405);
  }
  if(route==='home'){
   const hidden=new Set((url.searchParams.get('hiddenLibraries')||'').split(','));
   const order=(url.searchParams.get('libraryOrder')||'').split(',');
   const visible=libraries.list(admin).filter(l=>l.showOnHome&&canLibrary(user,l.id)&&!hidden.has(l.id));
   const position=id=>{const index=order.indexOf(id);return index<0?order.length:index;};
   visible.sort((a,b)=>position(a.id)-position(b.id));
   const rows=[],continueWatching=await (recommendations?.watching(user.id,visible.map(l=>l.id))||progress.home(user.id,visible.map(l=>l.id)));
   const watching=continueWatching.items.filter(i=>canLibrary(user,i.libraryId)&&!hidden.has(i.libraryId)&&!mediaState?.hidden(user.id,tvId(i.libraryId,i.seriesId?'series':'file',i.seriesId||i.id)));
   if(watching.length)rows.push(row('Continue Watching',watching.map(i=>watchingCard(i,i.libraryId))));
   for(const library of visible){
    const result=await page(library.id,{sort:'added',limit:20});
    if(result.items.length)rows.push(row('Recently Added · '+library.name,result.items));
   }
   send(200,{rows,message:'Add and scan libraries in Boreas web settings.'});return true;
  }
  if(route.startsWith('library/')){
   const library=decodeURIComponent(route.slice(8)),offset=Number(url.searchParams.get('start')||0),letter=url.searchParams.get('letter')||'',browse=url.searchParams.get('tab')==='browse';
   if(!browse&&recommendations){
    const data=await recommendations.rows(user.id,library,admin),landscape=data.library.type==='home-videos';
    const rows=data.rows.map(shelf=>row(shelf.title,shelf.items.map(item=>shelf.kind==='personal'?
      watchingCard(item,library,landscape):{...withState(item,library),landscape})));
    send(200,{library:data.library,rows,folderBrowser:false});return true;
   }
   const result=await page(library,{offset,folder:browse?url.searchParams.get('folder')||'':null,jump:browse&&offset===0?letter:'',sort:browse?'title':'added'});
   if(result.jumpFound===false){result.items=[];result.next=null;}
   const rows=[];
   if(!browse&&result.items.length)rows.push(row('Recently Added in '+result.library.name,result.items));
   send(200,{...result,rows,folderBrowser:!!result.folderBrowser});return true;
  }
  if(route==='search'){const allowedLibraryIds=libraries.list(admin).filter(l=>l.enabled&&l.searchable!==false&&canLibrary(user,l.id)).map(l=>l.id);const result=await libraries.search({q:url.searchParams.get('q')||'',limit:60,allowedLibraryIds});send(200,{rows:[row('Search',(await progress.decorateTitles(user.id,null,result.items,admin)).map(i=>withState(i,i.libraryId)))]});return true;}
  const allowed=id=>canLibrary(user,id);
  const discoveryCard=item=>({...item,id:item.type+':'+item.id,discoverId:item.id,discoverType:item.type,kind:'discover',year:Number(item.date?.slice(0,4))||null});
  if(route==='discover'&&discover){
   const {rows}=await discover.list(url.searchParams.get('q')||'',allowed,url.searchParams.get('category'));
   send(200,{rows:rows.map(shelf=>({...shelf,items:shelf.items.map(discoveryCard)}))});return true;
  }
  const discoverTitle=route.match(/^discover\/(movie|tv)\/([1-9]\d{0,9})$/);
  if(discoverTitle&&discover){
   const [,type,id]=discoverTitle,item=await discover.detail(type,Number(id));
   send(200,{...discoveryCard(item),type:type==='tv'?'Series':'Movie',durationSeconds:Number(item.runtime||0)*60,people:item.cast,genres:item.genres});return true;
  }
  if(route==='week'&&connections){
   const offset=Math.min(365,Math.max(0,Number.parseInt(url.searchParams.get('offset'),10)||0)),start=new Date();
   start.setUTCHours(0,0,0,0);start.setUTCDate(start.getUTCDate()+offset);
   const end=new Date(+start+28*86400000),data=await connections.calendar(start.toISOString(),end.toISOString(),user),days=new Map();
   for(const item of data.items){
    if(!item.tmdbId)continue;
    const key=item.date.slice(0,10);
    if(!days.has(key))days.set(key,{label:key,items:[]});
    days.get(key).items.push(discoveryCard({...item,id:item.tmdbId}));
   }
   send(200,{days:[...days.values()],nextOffset:offset+28});return true;
  }
  if(route==='guide'&&liveTV&&dvr){
   requirePermission(user,'liveTV');
   const day=Math.min(13,Math.max(0,Number(url.searchParams.get('day'))||0)),hour=Math.min(23,Math.max(0,Number(url.searchParams.get('hour'))||0)),offset=Math.max(0,Number(url.searchParams.get('start'))||0);
   const query=(url.searchParams.get('q')||'').slice(0,120),now=Date.now();
   const start=Math.floor(now/1800000)*1800000+(day*24+hour)*3600000,end=start+(query?86400000:10800000);
   const result=await liveTV.guideWindow(start,end,query),listed=result.channels.slice(offset,offset+8);
   const channels=listed.map(channel=>({id:channel.Id,title:channel.Name,number:channel.ChannelNumber}));
   const channelIds=new Set(channels.map(channel=>channel.id));
   const programs=result.programs.filter(program=>query||channelIds.has(program.ChannelId)).map(program=>({...program,CanRecord:admin||user.permissions?.record===true,recording:!!dvr.channel(program.ChannelId,allowed)}));
   send(200,{start:new Date(start).toISOString(),end:new Date(end).toISOString(),query,channels,programs,next:offset+8<result.channels.length?offset+8:null});return true;
  }
  if(route.startsWith('channel-watch/')&&liveTV&&dvr){
   requirePermission(user,'liveTV');
   const id=decodeURIComponent(route.slice(14));
   const channel=(await liveTV.guideChannels()).channels.find(entry=>entry.tuner+'~'+entry.number===id);
   if(!channel)throw fail('Channel not found.',404);
   send(200,{channel:{id,title:channel.name,kind:'channel'},recording:dvr.channel(id,allowed)});return true;
  }
  if(route==='dvr'&&dvr&&method==='GET'){
   const data=dvr.list(allowed),tab=url.searchParams.get('tab');
   send(200,{items:tab==='rules'?data.rules:data.recordings.filter(item=>tab==='scheduled'?item.Status!=='Completed':item.Status==='Completed'||item.IsInProgress)});return true;
  }
  if(route==='recording-defaults'&&dvr){
   requirePermission(user,'liveTV');requirePermission(user,'record');
   send(200,{RecordingLibraries:dvr.destinations(allowed).map(library=>({Id:library.id,Name:library.name,Compatible:true}))});return true;
  }
  if(route==='record'&&dvr&&method==='POST'){
   requirePermission(user,'liveTV');requirePermission(user,'record');
   const input=await body(req);
   send(202,await dvr.create({programId:input.ProgramId,libraryId:input.RecordingLibraryId,pre:input.PrePaddingSeconds,post:input.PostPaddingSeconds},allowed));return true;
  }
  if(route==='discover'||route.startsWith('week')){send(200,route==='discover'?{rows:[],featured:[],message:'Discover is not connected to the native backend yet.'}:{days:[],nextOffset:28});return true;}
  if(route.startsWith('overview/')){const scope=tvScope(decodeURIComponent(route.slice(9))),item=scope.kind==='file'?await libraries.item(scope.library,scope.id,admin):await libraries.series(scope.library,scope.id,admin);send(200,{overview:item.metadata?.overview||''});return true;}
  if(route.startsWith('ratings/')&&method==='GET'&&ratings){
   const scope=tvScope(decodeURIComponent(route.slice(8)));
   send(200,await ratings.lookup(scope.library,scope.id,scope.kind==='file'?'item':'series',admin));return true;
  }
  if(route.startsWith('trailers/')){const scope=tvScope(decodeURIComponent(route.slice(9))),record=scope.kind==='file'?await libraries.item(scope.library,scope.id,admin):await libraries.series(scope.library,scope.id,admin),m=record.metadata||{},id=m.seriesTmdbId||m.tmdbId;if(!id||!metadata){send(200,{items:[],message:'No trailer metadata is available.'});return true;}const data=await metadata.request((m.seriesTmdbId||scope.kind!=='file'?'tv/':'movie/')+id+'/videos');send(200,{title:record.title,items:(data.results||[]).filter(v=>v.site==='YouTube'&&/^[a-zA-Z0-9_-]{11}$/.test(v.key)&&['Trailer','Teaser'].includes(v.type)).sort((a,b)=>Number(b.official)-Number(a.official)).map(v=>({key:v.key,title:v.name}))});return true;}
  if(route.startsWith('item/')||route.startsWith('season/')){const scope=tvScope(decodeURIComponent(route.slice(route.indexOf('/')+1)));if(scope.kind==='file'){const record=await libraries.item(scope.library,scope.id,admin),item=card(record,scope.library),info=record.metadata?.state==='matched'&&mediaInfo?await mediaInfo(scope.library,scope.id,admin):{};const enriched={...item,...info};send(200,{...enriched,playItem:enriched,playLabel:item.resumeSeconds>0&&!item.played?'Resume':'Play',canPlay:true,media:{},audioTracks:[],subtitleTracks:[]});return true;}
   const series=await libraries.series(scope.library,scope.id,admin),seriesCard=nativeTVCard({...series,year:series.metadata?.year,playback:await progress.summary(user.id,scope.library,scope.id,'series',null,admin),kind:'series'},scope.library),seasons=series.seasons.filter(s=>Number.isInteger(s.season)).map(s=>({id:tvId(scope.library,'season',scope.id,s.season),kind:'season',type:'Season',title:s.title,season:s.season,poster:s.poster||series.artwork}));
   for(const season of seasons)season.played=(await progress.summary(user.id,scope.library,scope.id,'season',season.season,admin)).completed;
   if(scope.kind==='season'){const items=[];let offset=0;do{const result=await page(scope.library,{series:scope.id,season:String(scope.season),view:'items',limit:100,offset});items.push(...result.items);offset=result.next;}while(offset!==null);send(200,{series:seriesCard,seasons,items});}else{
    const start=await progress.seriesStart?.(user.id,scope.library,scope.id,admin);
    const playItem=start?.item?card(start.item,scope.library):null;
    send(200,{...seriesCard,seasons,playItem,playLabel:playItem?.resumeSeconds>0?'Resume':'Play'});
   }return true;
  }
  if(route==='playback'&&method==='POST'){const input=await body(req);
  if(input.platform==='roku'&&liveTV&&dvr&&input.rokuKind==='channel'){
   if(!appAvailable('liveTV'))throw fail('Live TV is disabled on this server.',404);
   requirePermission(user,'liveTV');
   const [tuner,number]=String(input.id).split('~'),job=await liveTV.start(user.id,{tuner,number});
   try{
    for(let attempt=0;attempt<80;attempt++){
     const state=await liveTV.status(user.id,job.id);
     if(state.state==='ready'){send(200,{id:input.id,title:input.rokuTitle||'Live TV',tunerStream:job.id,url:state.url,streamFormat:'hls',live:true,startPositionSeconds:0,offsetSeconds:0,durationSeconds:0});return true;}
     if(state.state==='error')break;
     await new Promise(resolve=>setTimeout(resolve,250));
    }
    throw fail('The tuner stream did not become ready.',503);
   }catch(error){await liveTV.release(user.id,job.id).catch(()=>{});throw error;}
  }
  if(input.platform==='roku'&&dvr&&input.rokuKind==='recording'){
   requirePermission(user,'liveTV');
   const stream=await dvr.playback(input.id,allowed);
   if(stream.state!=='ready')throw fail('Recording is still preparing.',409);
   send(200,{id:input.id,title:stream.name,url:stream.url,streamFormat:stream.live?'hls':'mp4',live:stream.live,recording:stream.live,rokuRecording:true,offsetSeconds:0,startPositionSeconds:Math.max(0,Number(input.positionSeconds)||0),durationSeconds:0});return true;
  }
  const scope=tvScope(input.id);requireLibrary(user,scope.library);if(scope.kind!=='file')throw fail('Choose a movie or episode.');const sourceItem=await libraries.item(scope.library,scope.id,admin),item=card(sourceItem,scope.library),sessionId=randomUUID();for(const [key,value]of sessions)if(value.until<Date.now())sessions.delete(key);if(sessions.size>1000)throw fail('Too many playback sessions.',429);const sourceInfo=mediaInfo?await mediaInfo(scope.library,scope.id,admin):{},hdr=hdrDecision(sourceInfo.videoDetails||{},input.hdrCapabilities||{},input.hdr10Fallback===true);const audioTracks=sourceInfo.audioTracks||[],subtitleTracks=sourceInfo.subtitleTracks||[];
 const trackOptions={};
 if(input.AudioStreamIndex!==undefined)trackOptions.audioIndex=input.AudioStreamIndex;
 if(input.SubtitleStreamIndex!==undefined)trackOptions.subtitleIndex=input.SubtitleStreamIndex===-1?null:input.SubtitleStreamIndex;
 const streams=[...audioTracks.map(track=>({index:track.id,codec_type:'audio',codec_name:track.codec,tags:{language:track.language}})),
   ...subtitleTracks.map(track=>({index:track.id,codec_type:'subtitle',codec_name:track.codec,tags:{language:track.language},disposition:{forced:track.forced?1:0}}))];
 const preferences=languages?languages.effective(user.id,scope.library,sourceItem,admin):{audioLanguages:['eng','jpn'],subtitleLanguage:'eng',subtitleMode:'audio-aware'};
 const selected=selectMediaTracks(streams,preferences,trackOptions);
 const selectedAudioIndex=selected.audio?.index??-1,selectedSubtitleIndex=selected.subtitle?.index??-1;
 const selectedAudioOrdinal=audioTracks.findIndex(track=>track.id===selectedAudioIndex);
 const selectedSubtitleOrdinal=subtitleTracks.findIndex(track=>track.id===selectedSubtitleIndex);
 if(languages&&(input.AudioStreamIndex!==undefined||input.SubtitleStreamIndex!==undefined)){
   const choices={...preferences};
   if(selected.audio&&['eng','jpn','spa','fra','deu','ita','por','kor','zho','und'].includes(selected.audio.tags.language))choices.audioLanguages=[selected.audio.tags.language,...preferences.audioLanguages.filter(code=>code!==selected.audio.tags.language)].slice(0,3);
   if(selected.subtitle){choices.subtitleLanguage=selected.subtitle.tags.language;choices.subtitleMode=selected.subtitle.disposition.forced?'forced-only':'preferred';}
   else choices.subtitleMode='off';
   await languages.save(user.id,scope.library,sourceItem.seriesId||scope.id,{audioLanguages:choices.audioLanguages,subtitleLanguage:choices.subtitleLanguage,subtitleMode:choices.subtitleMode,subtitlePolicyVersion:2},admin,!sourceItem.seriesId);
 }
 const trickplay=await videoThumbnails?.available(scope.library,scope.id,admin).catch(()=>false)?{baseUrl:"/api/libraries/"+scope.library+"/thumbnail/"+scope.id+"?at=",interval:15,width:320,height:180}:null;
 const savedMarkers=playbackMarkers?.get(scope.library,scope.id)||{};
 const intro=savedMarkers.intro||await mediaAnalysis?.intro(scope.library,sourceItem);
 const markers=[];
 for(const [kind,range] of [['intro',intro],['credits',savedMarkers.credits||await mediaAnalysis?.credits(scope.library,sourceItem)]]){
   if(Number.isFinite(range?.start)&&Number.isFinite(range?.end)&&range.end>range.start){
     markers.push({Kind:kind,StartSeconds:range.start,EndSeconds:range.end});
   }
 }
 const adjacent=sourceItem.seriesId?await progress.adjacent?.(scope.library,scope.id,admin):null;
 const episodeCard=async entry=>entry?card(await libraries.item(scope.library,entry.id,admin),scope.library):null;
 const [previousEpisode,nextEpisode]=await Promise.all([episodeCard(adjacent?.previous),episodeCard(adjacent?.next)]);
 const trackData={qualityOptions:playbackQualityOptions(transcoderSettings?.get(),sourceInfo.sourceBitrate,sourceInfo.videoDetails),markers,previousEpisode,nextEpisode,trickplay,audioTracks,subtitleTracks,selectedAudioIndex,selectedSubtitleIndex,selectedAudioOrdinal,selectedSubtitleOrdinal};
 if(transcoderSettings?.get().autoHdr10Fallback===false)hdr.hdr10Fallback=false;let converted=null;if(input.compatibility||input.transcodeProfile||hdr.hdr10Fallback||hdr.sdrFallback){converted=await transcoding.prepare(user.id,scope.library,scope.id,admin,{profile:input.transcodeProfile||(input.compatibility||hdr.sdrFallback?'sdr1080':'hdr10copy'),position:input.positionSeconds,...trackOptions,webSubtitles:!!subtitleDelivery});let ready;for(let n=0;n<120;n++){ready=await transcoding.status(user.id,converted.id,admin);if(ready.state==='error'){await transcoding.release(user.id,converted.id);throw fail(ready.error,415);}if(ready.state==='ready')break;await new Promise(resolve=>setTimeout(resolve,250));}if(ready.state!=='ready'){await transcoding.release(user.id,converted.id);throw fail('GPU conversion did not become ready. Try original playback.',503);}converted=ready;}
 sessions.set(sessionId,{user:user.id,gpuId:converted?.id,...scope,hiddenId:tvId(scope.library,item.seriesId?'series':'file',item.seriesId?tvScope(item.seriesId).id:scope.id),duration:item.durationSeconds,sourceBitrate:sourceInfo.sourceBitrate,device:/roku/i.test(req.headers?.["user-agent"]||"")?"Roku":"Android TV",until:Date.now()+86400000});if(converted){
   let externalSubtitle=null;
   if(subtitleDelivery&&selectedSubtitleIndex>=0){
     try{
       const prepared=await subtitleDelivery.prepare(user.id,scope.library,scope.id,admin,{...trackOptions,audioIndex:selectedAudioIndex,subtitleIndex:selectedSubtitleIndex,timeOffset:converted.offset});
       if(prepared.url)externalSubtitle={url:prepared.url,mime:prepared.format==='ass'?'text/x-ssa':'text/vtt',language:selected.subtitle.tags.language};
     }catch(error){sessions.delete(sessionId);await transcoding.release(user.id,converted.id).catch(()=>{});throw error;}
   }
   send(200,{...item,sessionId,frameRate:/^upscale(?:4k|1440p)60(?:-[2-4]|-nis|-spline|-anime)?$/.test(converted.profile)?60:sourceInfo.videoDetails?.frameRate||0,url:converted.url,streamFormat:'hls',live:false,seekMode:'restart',videoCopy:converted.profile==='hdr10copy',hdr10Fallback:converted.profile==='hdr10copy',deliveryLabel:converted.profile==='hdr10copy'?'Original HDR10 · Dolby Vision removed · No video encoding':converted.label,startPositionSeconds:Math.max(0,Number(input.positionSeconds||0)-converted.offset),offsetSeconds:converted.offset,durationSeconds:converted.duration,transcodeProfile:converted.profile,...trackData,selectedAudioOrdinal:0,selectedSubtitleOrdinal:externalSubtitle?0:-1,externalSubtitle,warning:converted.warning});return true;}send(200,{...item,...sourceInfo,...hdr,sessionId,url:'/api/libraries/'+scope.library+'/media/'+scope.id,streamFormat:({mkv:'mkv',webm:'webm',ts:'ts'})[(await libraries.item(scope.library,scope.id,admin)).extension]||'mp4',live:false,seekMode:'native',videoCopy:true,startPositionSeconds:Number(input.positionSeconds||0),offsetSeconds:0,...trackData});return true;}
  if(route==='progress'&&method==='POST'){const input=await body(req),session=sessions.get(input.sessionId);if(!session||session.user!==user.id)throw fail('Playback session expired.',410);requireLibrary(user,session.library);const dashboard=getDashboard(),key=user.id+'/'+input.sessionId;if(dashboard?.isEnded(key)||session.gpuId&&dashboard?.isEnded('gpu:'+session.gpuId)){send(200,{ended:true});return true;}const duration=Number(input.durationSeconds)||session.duration;dashboard?.playback(key,await libraries.item(session.library,session.id,admin),{user:user.displayName||user.name||'Viewer',device:session.device,network:dashboard.networkType(url),bitrate:session.gpuId?null:session.sourceBitrate,gpuId:session.gpuId,position:Number(input.positionSeconds)||0,duration,playing:!input.isPaused,stopped:input.event==='stop',eventAt:Date.now()});if(duration>0)await progress.save(user.id,session.library,session.id,{position:Number(input.positionSeconds||0),duration},admin);if(mediaState&&Number(input.positionSeconds)>0&&mediaState.hidden(user.id,session.hiddenId))await mediaState.setHidden(user.id,session.hiddenId,false);if(session.gpuId){if(input.event==='stop')await transcoding.release(user.id,session.gpuId).catch(()=>{});else await transcoding.status(user.id,session.gpuId,admin);}if(input.event==='stop')sessions.delete(input.sessionId);send(200,{ok:true});return true;}
  if(route==='logout'&&method==='POST'){await accounts.logout(raw);send(200,{ok:true});return true;}
  if(route.startsWith('live')||route.startsWith('dvr')){send(200,{items:[],rows:[],channels:[],message:'Live TV is not configured on Boreas yet.'});return true;}
  throw fail('This feature is not available on the native dev backend yet.',501);
 };
}
