function setNativePlayerIcon(button,icon){if(button.dataset.playbackIcon===icon)return;button.dataset.playbackIcon=icon;button.innerHTML=playerIcon(icon);}
const NativePlayer=(()=>{
 function playbackId(){
  if(typeof crypto.randomUUID==="function")return crypto.randomUUID();
  const bytes=crypto.getRandomValues(new Uint8Array(16));
  bytes[6]=(bytes[6]&15)|64;
  bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes,byte=>byte.toString(16).padStart(2,"0")).join("");
  return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join("-");
 }
 const clientId=playbackId();let playbackSession=playbackId();
 let controller=null,hideTimer=null,video=null,returnTo='',seeking=false,generation=0,reportState=null,lastReport=0,pendingReport=Promise.resolve(),preparedJob=null,leaseTimer=null;
 let pendingSports=null;
 let skipMarkers={},introSkipped=false;
 let subtitleRenderer=null;const trackChoices=new Map();
 let liveJob=null,tvDvrLive=false,captureState=null,captureHls=null,capturePoll=null,gpuJob=null,gpuOffset=0,gpuDuration=0,gpuRestart=null;
 const root=()=>document.querySelector('#player');
 const clock=value=>{const n=Math.max(0,Math.floor(Number(value)||0)),h=Math.floor(n/3600);return (h?h+':':'')+String(Math.floor(n/60)%60).padStart(h?2:1,'0')+':'+String(n%60).padStart(2,'0');};
 function report(stopped=false){if(!video||!reportState||!Number.isFinite(video.duration)||video.duration<=0||!reportState.started)return;lastReport=Date.now();const reportingSession=playbackSession;const body={sessionId:playbackSession,gpuId:gpuJob,stopped:stopped===true,position:gpuOffset+video.currentTime,duration:gpuDuration||video.duration,eventAt:Date.now(),playing:stopped!==true&&!video.paused&&!video.ended};pendingReport=fetch(reportState.url,{method:'POST',credentials:'same-origin',keepalive:true,headers:{'Content-Type':'application/json','X-Lumen-CSRF':csrf},body:JSON.stringify(body)}).then(response=>response.json()).then(result=>{if(result.ended&&video&&reportingSession===playbackSession){stop();$('#player-error').textContent='An administrator ended this stream.';root().hidden=false;show();}}).catch(()=>{});return pendingReport;}
 function stop(){try{subtitleRenderer?.dispose();}catch{}subtitleRenderer=null;tvDvrLive=false;skipMarkers={};introSkipped=false;if(liveJob){void fetch('/api/live-tv/streams/'+liveJob,{method:'DELETE',keepalive:true,headers:{'X-Lumen-CSRF':csrf}}).catch(()=>{});liveJob=null;}if(gpuJob){void fetch('/api/playback/gpu/'+gpuJob,{method:'DELETE',credentials:'same-origin',keepalive:true,headers:{'X-Lumen-CSRF':csrf}}).catch(()=>{});gpuJob=null;}gpuRestart=null;clearInterval(capturePoll);captureHls?.destroy();captureHls=null;if(captureState){const old=captureState;captureState=null;if(!old.saved)void fetch('/sports-capture-api/jobs/'+old.id+'/release',{method:'POST',credentials:'same-origin',keepalive:true,headers:{'Content-Type':'application/json','X-Lumen-CSRF':csrf},body:JSON.stringify({viewer:old.viewer})}).catch(()=>{});}clearInterval(leaseTimer);if(preparedJob){const id=preparedJob;preparedJob=null;void fetch('/api/playback/jobs/'+id,{method:'DELETE',credentials:'same-origin',keepalive:true,headers:{'X-Lumen-CSRF':csrf}}).catch(()=>{});}report(true);gpuOffset=0;gpuDuration=0;reportState=null;generation++;clearTimeout(hideTimer);controller?.abort();controller=null;if(video){video.pause();video.removeAttribute('src');video.load();video=null;}if(document.fullscreenElement===root())void document.exitFullscreen().catch(()=>{});if(document.pictureInPictureElement)void document.exitPictureInPicture().catch(()=>{});root().hidden=true;root().classList.remove('controls-hidden');document.body.classList.remove('is-watching');seeking=false;return pendingReport;}
 function open(libraryId,itemId){returnTo=location.hash;location.hash='watch/'+libraryId+'/'+itemId;}
 function close(){const fallback=returnTo||'#home';if(history.length>1&&returnTo)history.back();else location.hash=fallback;}
 function show(){if(!video)return;root().classList.remove('controls-hidden');clearTimeout(hideTimer);hideTimer=setTimeout(()=>{if(!video||video.ended||seeking||!$('#trickplay-preview').hidden||$('#player-error').textContent||!$('#player-settings-panel').hidden)return;if(root().contains(document.activeElement)){if(document.activeElement!==root()&&document.activeElement.matches(':focus-visible'))return;document.activeElement.blur();}root().classList.add('controls-hidden');},2000);}
 function update(){if(!video)return;$('#native-player-clock').textContent=new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});const live=!!liveJob||tvDvrLive||captureState&&captureState.job?.state!=='complete',duration=live&&video.seekable.length?video.seekable.end(video.seekable.length-1):gpuDuration||(Number.isFinite(video.duration)?video.duration:0),position=gpuOffset+video.currentTime,seek=$('#seek'),atLive=!!live&&!video.paused&&duration-position<=12;seek.min=live&&video.seekable.length?video.seekable.start(0):0;seek.disabled=!duration;seek.max=duration||100;if(!seeking)seek.value=atLive?duration:position;seek.setAttribute('aria-valuetext',clock(position)+' of '+clock(duration));seek.style.setProperty('--played',(duration?100*(Number(seek.value)-Number(seek.min))/(duration-Number(seek.min)||1):0)+'%');let buffered=position;try{if(video.buffered.length)buffered=video.buffered.end(video.buffered.length-1);}catch{}seek.style.setProperty('--buffered',(duration?Math.min(100,100*(buffered-Number(seek.min))/(duration-Number(seek.min)||1)):0)+'%');const skip=$('#player-skip-marker'),entry=Object.entries(skipMarkers).find(([kind,m])=>position>=m.start&&position<m.end&&(kind!=='credits'||(!$('#skip-forward').hidden&&!$('#skip-forward').disabled)));skip.hidden=!entry;if(entry){
 if(entry[0]==='intro'&&entry[1].automatic&&!introSkipped&&!video.paused&&!seeking&&duration&&entry[1].end<duration&&entry[1].end-position>1){introSkipped=true;if(gpuRestart)void gpuRestart(entry[1].end);else video.currentTime=entry[1].end;}
 skip.textContent=entry[0]==='intro'?'Skip intro':'Next Episode';skip.onclick=()=>{if(entry[0]==='credits'){$('#skip-forward').click();return;}const end=Math.min(entry[1].end,duration||entry[1].end);if(gpuRestart)void gpuRestart(end);else video.currentTime=end;};}$('#player-elapsed').textContent=clock(position);$('#player-duration').textContent=clock(duration);$('#player-remaining').textContent=atLive?'● LIVE':'−'+clock(duration-position);$('#player-remaining').classList.toggle('sports-live',atLive);if(live||captureState){$('#player-go-live').textContent=atLive?'● Live':'● Go live';}setNativePlayerIcon($('#toggle-play'),video.paused?'play':'pause');$('#toggle-play').setAttribute('aria-label',video.paused?'Play (Space)':'Pause (Space)');setNativePlayerIcon($('#player-mute'),video.muted||!video.volume?'muted':'volume');const volume=$('#volume');volume.value=video.muted?0:video.volume;volume.style.setProperty('--volume-fill',100*Number(volume.value)+'%');}
 function failure(){if(!video)return;$('#player-loading').hidden=true;$('#player-error').textContent=captureState?'The sports stream could not be loaded. Return to Sports and reopen it to retry.':video.error?.code===2?'The media connection failed. Check the server or network and try again.':'Playback failed. Try GPU 1080p SDR in the player settings for browser compatibility.';show();}
 async function render(version,route,delivery='original',position,startPaused=false){stop();const own=++generation,[,libraryId,itemId]=route.split('/');root().innerHTML=playerShell();$('#player .player-top-actions').insertAdjacentHTML('afterbegin','<time id="native-player-clock" class="lumen-web-clock"></time><img class="lumen-web-brand" src="/branding/lumen-icon.png" alt="Boreas">');root().hidden=false;document.body.classList.add('is-watching');root().tabIndex=-1;root().focus({preventScroll:true});controller=new AbortController();const signal=controller.signal,on=(target,name,fn)=>target.addEventListener(name,fn,{signal});video=$('#video');video.preload='metadata';$('#player-title').textContent='Loading…';$('#player-loading').hidden=false;
 // These features need media processing or services beyond direct play.
 for(const id of ['next-episode','player-share','player-tracks','player-tracks-panel','compatibility','player-format-info','resume-status','trickplay-status'])$('#'+id).remove();
 const settingsPanel=$('#player-settings-panel');
 for(const paragraph of settingsPanel.querySelectorAll(':scope > p'))paragraph.remove();
 settingsPanel.insertAdjacentHTML('beforeend','<form id="native-player-options"><label>Quality<select id="native-video-quality" disabled><option>Maximum</option></select></label><label>Audio track<select id="native-audio-track" disabled><option>Stream audio</option></select></label><label>Subtitle language<select id="native-subtitle-track" disabled><option>Off</option></select></label></form>');

 $('#playback-mode').hidden=true;

 $('#close-player').onclick=close;
 {
   const seek=$('#seek'),preview=$('#trickplay-preview'),picture=$('#trickplay-picture'),label=$('#trickplay-time');
   let available=false,revision=0,bucket=-1;
   const mediaPath='/libraries/'+libraryId+'/thumbnail/'+itemId;
   if(!['capture','live-tv','tv-dvr','trailer'].includes(libraryId)){
     void api(mediaPath+'?info=1').then(result=>{if(!signal.aborted)available=result.generated;}).catch(()=>{});
   }
   function hidePreview(){
     preview.hidden=true;picture.hidden=true;seek.style.removeProperty('--seek-hover');bucket=-1;revision++;
   }
   hidePreview();
   on(seek,'pointerleave',hidePreview);
   on(seek,'pointercancel',hidePreview);
   signal.addEventListener('abort',hidePreview,{once:true});
   on(seek,'pointermove',event=>{
     const min=Number(seek.min),max=Number(seek.max),box=seek.getBoundingClientRect();
     if(seek.disabled||max<=min||!box.width){hidePreview();return;}
     const fraction=Math.max(0,Math.min(1,(event.clientX-box.left)/box.width));
     const time=min+fraction*(max-min),next=Math.floor(time/15)*15,rootBox=root().getBoundingClientRect();
     seek.style.setProperty('--seek-hover',100*fraction+'%');
     preview.style.left=Math.max(92,Math.min(rootBox.width-92,event.clientX-rootBox.left))+'px';
     preview.style.bottom=(rootBox.bottom-box.top+8)+'px';
     label.textContent=clock(time);
     preview.hidden=false;
     if(!available||next===bucket)return;
     bucket=next;picture.hidden=true;
     const request=++revision,image=new Image();
     image.onload=()=>{
       if(signal.aborted||request!==revision)return;
       picture.style.backgroundImage='url("'+image.src+'")';
       picture.hidden=false;
     };
     image.src='/api'+mediaPath+'?at='+next;
   });
 }

 let wantsPlaying=!startPaused;
 const ensurePlaying=async()=>{if(!video||own!==generation||!wantsPlaying)return;const media=video;try{await media.play();if(own===generation&&!wantsPlaying)media.pause();}catch(e){if(own!==generation)return;if(e.name==='NotAllowedError'){wantsPlaying=false;show();$('#player-loading').hidden=true;}else if(e.name!=='AbortError')failure();}};
 const play=async()=>{if(!video)return;show();wantsPlaying=video.paused;if(!wantsPlaying){video.pause();update();return;}await ensurePlaying();};
 $('#toggle-play').onclick=play;on(video,'click',play);on(video,'dblclick',()=>$('#player-fullscreen').click());
 $('#skip-back').hidden=$('#skip-forward').hidden=true;
 function seekRelative(seconds){
   if(!video)return;
   const target=Math.max(0,Math.min(gpuDuration|| (Number.isFinite(video.duration)?video.duration:Infinity),gpuOffset+video.currentTime+seconds));
   if(gpuRestart)void gpuRestart(target);else video.currentTime=target;
   show();
 }

 $('#player-mute').onclick=()=>{video.muted=!video.muted;show();update();};$('#volume').oninput=event=>{video.volume=Number(event.target.value);video.muted=false;update();show();};
 $('#seek').oninput=()=>{seeking=true;show();update();};$('#seek').onchange=()=>{if(video){if(gpuRestart)void gpuRestart(Number($('#seek').value));else video.currentTime=Number($('#seek').value);seeking=false;update();show();}};on($('#seek'),'pointercancel',()=>{seeking=false;update();});
 $('#player-settings').onclick=()=>{$('#player-settings-panel').hidden=!$('#player-settings-panel').hidden;show();};$('#close-settings').onclick=()=>{$('#player-settings-panel').hidden=true;show();};
 $('#player-fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await root().requestFullscreen();}catch{toast('Fullscreen is unavailable in this browser.');}show();};

 on(root(),'pointermove',show);on(root(),'pointerdown',show);on(root(),'focusin',show);
 on(document,'keydown',event=>{if(!video||event.ctrlKey||event.metaKey||event.altKey)return;if(event.target.matches('input,select,textarea')){show();return;}if(event.key==='Escape'){if(!$('#player-settings-panel').hidden){$('#player-settings-panel').hidden=true;show();}else if(!document.fullscreenElement)close();return;}if(event.key===' '||event.key.toLowerCase()==='k'){event.preventDefault();$('#toggle-play').click();}else if(event.key==='ArrowLeft'){event.preventDefault();if(libraryId==='trailer')$('#skip-back').click();else seekRelative(-10);}else if(event.key==='ArrowRight'){event.preventDefault();if(libraryId==='trailer')$('#skip-forward').click();else seekRelative(30);}else if(event.key.toLowerCase()==='m')$('#player-mute').click();else if(event.key.toLowerCase()==='f')$('#player-fullscreen').click();show();});
 for(const event of ['timeupdate','durationchange','loadedmetadata','volumechange','seeked','progress'])on(video,event,update);for(const event of ['pause','ended'])on(video,event,()=>{report();update();show();});on(video,'playing',()=>{if(reportState)reportState.started=true;report();$('#player-loading').hidden=true;update();show();});on(video,'waiting',()=>{$('#player-loading').hidden=false;});on(video,'canplay',()=>{$('#player-loading').hidden=true;});on(video,'error',failure);on(video,'timeupdate',()=>{if(Date.now()-lastReport>=10000)report();});const reportTimer=setInterval(()=>report(),10000);controller.signal.addEventListener('abort',()=>clearInterval(reportTimer),{once:true});on(video,'seeked',report);
 if(libraryId==='trailer'){
   await renderNativeTrailer(itemId,signal,show,clock);
   return;
 }
 if(libraryId==='live-tv'||libraryId==='tv-dvr'){
   await renderLiveTV(libraryId,itemId,own,on,play,ensurePlaying);
   return;
 }
 if(libraryId==='capture'){
   const id=itemId.split('?')[0];
   const pending=pendingSports?.id===id?pendingSports:null;
   pendingSports=null;
   await renderCapture(id,own,version,on,play,ensurePlaying,pending);
   return;
 }
 try{const {item,preferences,markers,adjacent,qualityOptions}=await api('/libraries/'+libraryId+'/item/'+itemId+'?playback=1');if(version!==routeVersion||own!==generation)return;skipMarkers=markers||{};if(!returnTo||returnTo.startsWith('#watch/'))returnTo=item.seriesId?'#library/'+libraryId+'?series='+item.seriesId:'#movie/'+libraryId+'/'+itemId;document.title='Watching '+item.title+' · Boreas';$('#player-title').innerHTML='<a href="'+(item.seriesId?'#library/'+libraryId+'?series='+item.seriesId:'#movie/'+libraryId+'/'+itemId)+'">'+esc(item.series||item.title)+'</a>';$('#player-subtitle').textContent=item.series?[(item.season===null?'':'S'+item.season),(item.episode===null?'':'E'+item.episode),item.title].filter(Boolean).join(' · '):String(item.year||'');const emblem=$('#player-emblem'),art=item.metadata?.logo||item.metadata?.seriesPoster||item.artwork;if(art){emblem.src=art;emblem.hidden=false;emblem.classList.toggle('is-logo',!!item.metadata?.logo);emblem.onerror=()=>emblem.hidden=true;}$('#playback-mode').textContent='Inspecting audio and subtitle tracks…';$('#player-loading').hidden=false;const gpuProfile=/^(sdr1080|sdr720|sdr480|originalstream|styled)$/.test(delivery)?delivery:'original';
 for(const [buttonId,target,label]of [
   ['skip-back',adjacent?.previous,'Previous episode'],['skip-forward',adjacent?.next,'Next episode']
 ]){
   const button=$('#'+buttonId);
   button.hidden=!item.seriesId||!(item.season>0);
   button.disabled=!target;
   button.title=target?label+' · '+target.title:label+' unavailable';
   button.setAttribute('aria-label',button.title);
   button.onclick=async()=>{
     if(!target)return;
     await report(true);
     location.replace('#watch/'+libraryId+'/'+target.id);
   };
 }
 const choices=trackChoices.get(session.id+'/'+libraryId+'/'+itemId)||{};
 const subtitleInfo=await api('/playback/subtitles',{method:'POST',body:{libraryId,itemId,...choices}});
 if(own!==generation)return;
 const initialPosition=Number.isFinite(position)?position:(item.playback?.completed?0:item.playback?.position||0);
 const optionForm=$('#native-player-options'),audioSelect=$('#native-audio-track'),subtitleSelect=$('#native-subtitle-track');
 const language=code=>nativeLanguageNames[code]||code;
 const label=track=>[language(track.language),track.title,track.forced?'Forced':'',track.codec?.toUpperCase(),track.channels?track.channels+' channels':''].filter(Boolean).join(' · ');
 audioSelect.innerHTML=subtitleInfo.audio.map(track=>'<option value="'+track.index+'">'+esc(label(track))+'</option>').join('')||'<option>No audio track</option>';
 audioSelect.disabled=!subtitleInfo.audio.length;
 if(subtitleInfo.audioIndex!==null)audioSelect.value=String(subtitleInfo.audioIndex);
 subtitleSelect.innerHTML='<option value="off">Off</option>'+subtitleInfo.subtitles.map(track=>'<option value="'+track.index+'">'+esc(label(track))+'</option>').join('');
 subtitleSelect.disabled=!subtitleInfo.subtitles.length;
 subtitleSelect.value=subtitleInfo.subtitleIndex===null?'off':String(subtitleInfo.subtitleIndex);
 optionForm.onsubmit=event=>event.preventDefault();
 async function restartSelection(){
   const next={...(subtitleInfo.audioIndex===null?{}:{audioIndex:Number(audioSelect.value)}),subtitleIndex:subtitleSelect.value==='off'?null:Number(subtitleSelect.value)};
   trackChoices.set(session.id+'/'+libraryId+'/'+itemId,next);
   const at=gpuOffset+video.currentTime;
   for(const select of optionForm.querySelectorAll('select'))select.disabled=true;
   try{
     const audio=subtitleInfo.audio.find(track=>track.index===next.audioIndex),subtitle=subtitleInfo.subtitles.find(track=>track.index===next.subtitleIndex);
     const prefs={...preferences};
     if(audio&&Object.hasOwn(nativeLanguageNames,audio.language))prefs.audioLanguages=[audio.language,...preferences.audioLanguages.filter(code=>code!==audio.language)].slice(0,3);
     if(subtitle&&Object.hasOwn(nativeLanguageNames,subtitle.language)){prefs.subtitleLanguage=subtitle.language;prefs.subtitleMode=subtitle.forced?'forced-only':'preferred';}
     else if(next.subtitleIndex===null)prefs.subtitleMode='off';
     const preferenceRoute='/libraries/'+libraryId+'/preferences/'+(item.seriesId||itemId)+(item.seriesId?'':'?scope=item');
     await api(preferenceRoute,{method:'PATCH',body:{audioLanguages:prefs.audioLanguages,subtitleLanguage:prefs.subtitleLanguage,subtitleMode:prefs.subtitleMode,subtitlePolicyVersion:2}});
     await report(true);
     await render(version,route,gpuProfile,at);
   }catch(error){toast(error.message);for(const select of optionForm.querySelectorAll('select'))select.disabled=select.id==='native-video-quality'&&select.options.length<2;}
 }
 audioSelect.onchange=restartSelection;
 subtitleSelect.onchange=restartSelection;
 async function switchQuality(target){
   const at=gpuOffset+video.currentTime,paused=video.paused;
   await report(true);
   await render(version,route,target,at,paused);
 }
 const quality=$('#native-video-quality');
 quality.replaceChildren(...(qualityOptions||[{profile:'original',label:'Maximum'}]).map(option=>
   new Option(option.label+'  ·  '+(option.mbps>0?'~'+Number(option.mbps.toFixed(1))+' Mbps':'Bitrate unavailable'),option.profile)));
 quality.value=qualityOptions?.some(option=>option.profile===gpuProfile)?gpuProfile:'original';
 quality.disabled=quality.options.length<2;
 quality.onchange=()=>switchQuality(quality.value);
 function mountSubtitles(offset=0){
   try{subtitleRenderer?.dispose();}catch{}subtitleRenderer=null;
   for(const track of video.querySelectorAll('track'))track.remove();
   if(subtitleInfo.warning)toast(subtitleInfo.warning);
   if(!subtitleInfo.url)return;
   if(subtitleInfo.format==='ass'){
     subtitleRenderer=new SubtitlesOctopus({
       video,subUrl:subtitleInfo.url,fonts:subtitleInfo.fonts,fallbackFont:'/vendor/libass/default.woff2',
       workerUrl:'/vendor/libass/subtitles-octopus-worker.js',
       legacyWorkerUrl:'/vendor/libass/subtitles-octopus-worker-legacy.js',
       timeOffset:offset,targetFps:24,libassMemoryLimit:64,libassGlyphLimit:16,
       onError:error=>{console.error('Subtitle renderer error',error?.message,error?.filename,error?.lineno);if(own===generation)toast('Styled subtitles could not load. Reopen playback to retry.');}
     });
   }else{
     const track=document.createElement('track');
     track.kind='subtitles';track.label='Selected subtitles';track.src=subtitleInfo.url;track.default=true;
     track.onload=()=>{
       if(offset)for(const cue of [...track.track.cues||[]]){
         if(cue.endTime<=offset)track.track.removeCue(cue);
         else{cue.startTime=Math.max(0,cue.startTime-offset);cue.endTime-=offset;}
       }
       track.track.mode='showing';
     };
     video.append(track);
   }
 }
 if(gpuProfile!=='original'){
 let restartRevision=0;gpuRestart=async(position)=>{const revision=++restartRevision;video.pause();captureHls?.destroy();captureHls=null;$('#player-loading').hidden=false;$('#player-error').textContent='';if(gpuJob){await api('/playback/gpu/'+gpuJob,{method:'DELETE'}).catch(()=>{});gpuJob=null;}const created=await api('/playback/gpu',{method:'POST',body:{libraryId,itemId,profile:gpuProfile,clientId,position,...choices,webSubtitles:true}});if(own!==generation||revision!==restartRevision){void api('/playback/gpu/'+created.id,{method:'DELETE'});return;}gpuJob=created.id;let ready;for(let n=0;n<100;n++){ready=await api('/playback/gpu/'+created.id);if(own!==generation||revision!==restartRevision)return;if(ready.state==='error')throw Error(ready.error);if(ready.state==='ready')break;await new Promise(resolve=>setTimeout(resolve,400));}if(ready.state!=='ready')throw Error('GPU playback timed out.');gpuOffset=ready.offset;gpuDuration=ready.duration;$('#playback-mode').textContent=ready.label+(gpuProfile==='originalstream'?' · No video re-encoding':gpuProfile==='styled'?' · Original subtitle styling · NVENC · AAC stereo':' · CUDA decode / NVENC · AAC stereo')+(ready.warning?' · '+ready.warning:'');if(Hls.isSupported()){captureHls=new Hls({startPosition:Math.max(0,position-gpuOffset),liveSyncDurationCount:100000,backBufferLength:30});captureHls.once(Hls.Events.MANIFEST_PARSED,()=>{void ensurePlaying();});captureHls.on(Hls.Events.ERROR,(_,data)=>{if(data.fatal)failure();});captureHls.loadSource(ready.url);captureHls.attachMedia(video);}else if(video.canPlayType('application/vnd.apple.mpegurl')){
   const desired=Math.max(0,position-gpuOffset);
   video.addEventListener('loadedmetadata',()=>{
     if(own===generation&&revision===restartRevision&&video)video.currentTime=desired;
   },{once:true,signal});
   video.src=ready.url;await ensurePlaying();
 }else throw Error('This browser cannot play HLS.');mountSubtitles(gpuOffset);update();show();};const startGpu=gpuRestart;gpuRestart=position=>startGpu(position).catch(error=>{if(own===generation){$('#player-error').textContent=error.message;$('#player-loading').hidden=true;show();}});playbackSession=playbackId();reportState={url:'/api/libraries/'+libraryId+'/progress/'+itemId,started:false};await gpuRestart(initialPosition);leaseTimer=setInterval(()=>{if(gpuJob)void api('/playback/gpu/'+gpuJob).catch(()=>{});},30000);return;
 }
 const preparation=await api('/playback/prepare',{method:'POST',body:{libraryId,itemId,...choices,webSubtitles:true}});if(own!==generation){void api('/playback/jobs/'+preparation.id,{method:'DELETE'}).catch(()=>{});return;}preparedJob=preparation.id;let prepared;for(;;){if(own!==generation)return;prepared=await api('/playback/jobs/'+preparedJob);if(own!==generation)return;if(prepared.state==='error')throw Error(prepared.error);if(prepared.state==='ready'){if(prepared.fallbackProfile){await api('/playback/jobs/'+preparedJob,{method:'DELETE'}).catch(()=>{});preparedJob=null;await render(version,route,prepared.fallbackProfile,initialPosition,startPaused);return;}break;}$('#playback-mode').textContent=prepared.state==='queued'?'Waiting to prepare selected tracks…':'Preparing selected tracks · Video is copied without re-encoding';await new Promise(resolve=>setTimeout(resolve,600));}leaseTimer=setInterval(()=>{if(preparedJob)void api('/playback/jobs/'+preparedJob).catch(()=>{});},60000);$('#playback-mode').textContent=prepared.url.includes('/jobs/')?'Direct stream · Original video/audio copied · No video re-encoding':'Direct play · Original file';mountSubtitles();
 playbackSession=playbackId();reportState={url:'/api/libraries/'+libraryId+'/progress/'+itemId,started:false};lastReport=Date.now();if(initialPosition>0)on(video,'loadedmetadata',()=>{if(video&&Number.isFinite(video.duration))video.currentTime=Math.min(initialPosition,video.duration);});video.src=prepared.url;update();show();await ensurePlaying();}catch(e){if(own===generation){$('#player-loading').hidden=true;$('#player-error').textContent=e.message;show();}}
 }

 async function renderLiveTV(kind,itemId,own,on,play,ensurePlaying){
   const valid=()=>own===generation;
   const [id,query]=itemId.split('?'),begin=new URLSearchParams(query).get('begin')==='1';
   const recording=kind==='tv-dvr',endpoint='/live-tv/'+(recording?'dvr/':'streams/');
   let jobId=id,switching=false;
   const tools=$('#player-live-tools'),record=$('#player-record'),live=$('#player-go-live');
   const errors=error=>{if(valid()){$('#player-loading').hidden=true;$('#player-error').textContent=error.message;show();}};
   function attach(source,fromBeginning=false){
     captureHls?.destroy();captureHls=null;
     if(!source.live){video.src=source.url;void ensurePlaying();return;}
     if(Hls.isSupported()){
       captureHls=new Hls({startPosition:fromBeginning?0:-1,liveSyncDurationCount:3,backBufferLength:90});
       captureHls.once(Hls.Events.MANIFEST_PARSED,()=>void ensurePlaying());
       captureHls.on(Hls.Events.ERROR,(_,data)=>{if(data.fatal&&valid()&&!switching&&!recording)errors(Error('The tuner stream was interrupted.'));});
       captureHls.loadSource(source.url);captureHls.attachMedia(video);
     }else if(video.canPlayType('application/vnd.apple.mpegurl')){
       if(fromBeginning)on(video,'loadedmetadata',()=>{if(video?.seekable.length)video.currentTime=video.seekable.start(0);});
       video.src=source.url;void ensurePlaying();
     }else throw Error('This browser cannot play Live TV HLS.');
   }
   live.onclick=()=>{
     if(video?.seekable.length){
       video.currentTime=Math.max(video.seekable.start(0),video.seekable.end(video.seekable.length-1)-3);
       void ensurePlaying();update();show();
     }
   };
   try{
     if(!recording){
       const [tuner,number]=id.split('~');
       const job=await api('/live-tv/streams',{method:'POST',body:{tuner,number}});
       if(!valid()){void api(endpoint+job.id,{method:'DELETE'}).catch(()=>{});return;}
       liveJob=jobId=job.id;$('#player-title').textContent=job.name;
       $('#player-subtitle').textContent='Live TV';
     }
     let source;
     for(let attempt=0;attempt<45&&valid();attempt++){
       source=await api(endpoint+jobId);
       if(source.state==='error')throw Error('The tuner could not start this channel. It may be in use or have no signal.');
       if(source.state==='ready')break;
       await new Promise(resolve=>setTimeout(resolve,500));
     }
     if(!valid())return;
     if(source?.state!=='ready')throw Error('The tuner did not start in time.');
     source.live=!recording||source.live;
     tvDvrLive=recording&&source.live;
     if(recording)$('#player-title').textContent=source.name;
     $('#player-subtitle').textContent=recording?(source.live?'Recording · Live TV':'Recorded Live TV'):'Live TV';
     $('#playback-mode').textContent=source.live?'HDHomeRun · Live':'HDHomeRun · Saved recording';
     tools.hidden=!source.live;
     record.hidden=true;
     if(source.live){
       void api('/live-tv/dvr').then(data=>{
         if(!valid()||tools.hidden)return;
         record.hidden=!data.canRecord;
         record.disabled=!data.canRecord;
         record.textContent=recording?'● Recording':'● Record';
         record.onclick=async()=>{
           try{
             if(recording){
               const {dialog,body}=libraryDialog('Stop recording?');
               body.innerHTML='<p>The portion already recorded will be saved.</p><button class="primary">Stop recording</button>';
               body.querySelector('button').onclick=async()=>{
                 try{await api(endpoint+jobId,{method:'DELETE'});dialog.close();}catch(error){toast(error.message);}
               };
               return;
             }
             const now=Date.now(),guide=await api('/live-tv/guide?'+new URLSearchParams({start:now,end:now+1}));
             if(!valid())return;
             const program=guide.programs.find(entry=>entry.ChannelId===id);
             await openNativeRecordForm({program,channelId:id,streamId:jobId},row=>{
               if(!valid())return;
               switching=true;
               liveJob=null;
               location.replace('#watch/tv-dvr/'+row.Id);
             });
           }catch(error){toast(error.message);}
         };
       }).catch(()=>{});
     }
     attach(source,begin);
     if(source.live)leaseTimer=setInterval(async()=>{
       if(!valid()||switching)return;
       try{
         const latest=await api(endpoint+jobId);
         if(!valid()||switching)return;
         if(latest.state==='error')throw Error('The tuner stream was interrupted.');
         if(recording&&!latest.live&&tvDvrLive){
           const position=video.currentTime;
           tvDvrLive=false;tools.hidden=true;$('#player-error').textContent='';$('#playback-mode').textContent='HDHomeRun · Saved recording';
           $('#player-subtitle').textContent='Recorded Live TV';
           on(video,'loadedmetadata',()=>{if(video&&Number.isFinite(video.duration))video.currentTime=Math.min(position,video.duration);});
           attach(latest);
         }
       }catch(error){errors(error);}
     },recording?4000:15000);
     update();show();
   }catch(error){errors(error);}
 }

 function openSports(source,title,recording){
   const id='opening-'+playbackId();
   pendingSports={id,source,title,recording,returnTo:location.hash};
   location.hash='watch/capture/'+id;
 }
 async function renderCapture(id,own,version,on,play,ensurePlaying,pending){

  const valid=()=>own===generation&&version===routeVersion;
  returnTo=pending?.returnTo||'#sports/recordings';
  $('#player-title').textContent=pending?.title||'Opening sports stream…';
  $('#player-subtitle').textContent='Preparing the recorder…';
  $('#close-player').setAttribute('aria-label','Back to Sports');
  const loadingLabel=document.createElement('small');
  loadingLabel.className='sports-loading-label';
  loadingLabel.setAttribute('role','status');
  loadingLabel.textContent='Preparing the recorder…';
  $('#player-loading').append(loadingLabel);
  if(id.startsWith('opening-')){
    try{
      if(!pending)throw Error('This stream request expired. Reopen the game from Sports.');
      const job=await SportsCapture.startSource(pending.source,pending.title,pending.recording);
      if(!valid())return;
      id=job.id;
      history.replaceState(history.state,'','#watch/capture/'+id);
    }catch(error){if(valid()){$('#player-loading').hidden=true;$('#player-error').textContent=error.message;show();}return;}
  }
  const viewer=playbackId();captureState={id,viewer,job:null};

  const refresh=async()=>{if(!valid())return;try{const data=await SportsCapture.api('jobs');const job=data.jobs.find(j=>j.id===id);if(!job)throw Error('Capture not found.');if(!['complete','failed'].includes(job.state))await SportsCapture.api('jobs/'+id+'/heartbeat','POST',{viewer});if(!valid())return;captureState.job=job;$('#player-title').textContent=job.title;$('#player-subtitle').textContent=job.state==='complete'?'Recorded sports':job.recording?'Recording · Sports':'Live sports';$('#player-live-tools').hidden=job.state==='complete';$('#player-record').disabled=!!job.recording;$('#player-record').textContent=job.recording?'● Recording':'● Record';update();}catch(e){if(valid())$('#player-error').textContent=e.message;}};
  $('#player-record').onclick=async()=>{try{await SportsCapture.api('jobs/'+id+'/record','POST',{});await refresh();}catch(e){toast(e.message);}};
  $('#player-go-live').onclick=()=>{if(video?.seekable.length){video.currentTime=Math.max(video.seekable.start(0),video.seekable.end(video.seekable.length-1)-3);void playIfPaused();}};
  async function playIfPaused(){if(video?.paused)await play();update();show();}
  capturePoll=setInterval(()=>void refresh(),5000);await refresh();
  try{let data;for(let attempt=0;valid()&&attempt<60;attempt++){try{data=await SportsCapture.api('jobs/'+id+'/watch','POST',{});break;}catch(e){if(e.status!==409)throw e;$('#player-subtitle').textContent=e.message;await new Promise(resolve=>setTimeout(resolve,1500));}}if(!valid())return;if(!data)throw Error('The recorder took too long to prepare the stream. Reopen the game to retry.');loadingLabel.textContent='Buffering sports stream…';captureState.job=data.job;if(data.file){captureState.saved=true;$('#playback-mode').textContent='Saved sports recording · MP4';video.src=data.url;await ensurePlaying();return;}$('#playback-mode').textContent='Sports capture · HLS · Shared recorder';
   const begin=new URLSearchParams(location.hash.split('?')[1]||'').get('begin')==='1';
   if(data.job.state!=='complete'){
     const form=$('#native-player-options'),settings=$('#player-settings');
     form.insertAdjacentHTML('beforeend','<label>Stream link<select id="native-sports-link" disabled><option>Checking links…</option></select></label><small id="native-link-status" role="status"></small>');
     const select=$('#native-sports-link'),status=$('#native-link-status'),endpoint='jobs/'+id+'/links';
     let busy=false;
     const refreshLinks=async()=>{
       if(busy||!valid())return;
       busy=true;
       try{
         const result=await SportsCapture.api(endpoint);
         if(!valid())return;
         select.replaceChildren(...result.links.map(link=>new Option(link.label,String(link.variant))));
         if(!select.options.length)select.add(new Option('No alternate links'));
         select.value=result.links.length?String(result.activeVariant):select.options[0].value;
         select.disabled=result.links.length<2;
       }catch{if(valid()){select.replaceChildren(new Option('Links unavailable'));select.disabled=true;}}
       finally{busy=false;}
     };
     on(settings,'click',()=>{if(!$('#player-settings-panel').hidden)void refreshLinks();});
     select.onchange=async()=>{
       if(busy)return;
       busy=true;select.disabled=true;status.textContent='Switching link for everyone watching…';
       try{await SportsCapture.api(endpoint,'POST',{variant:Number(select.value),viewer});if(valid())status.textContent='Shared link changed.';}
       catch(error){if(valid())status.textContent=error.message;}
       finally{busy=false;await refreshLinks();}
     };
     if(!$('#player-settings-panel').hidden)void refreshLinks();
   }
   function mount(url,fromBeginning=false){
     captureHls?.destroy();captureHls=null;
     let initialized=false;
     const start=()=>{if(!valid()||initialized)return;initialized=true;void ensurePlaying();};
     if(Hls.isSupported()){
       captureHls=new Hls({startPosition:fromBeginning?0:-1,liveSyncDurationCount:3,backBufferLength:30});
       captureHls.on(Hls.Events.MANIFEST_PARSED,start);
       captureHls.on(Hls.Events.ERROR,(_,event)=>{
         if(!valid()||!event.fatal)return;
         $('#player-loading').hidden=true;$('#player-error').textContent='The sports stream was interrupted. Reopen it to retry.';show();
       });
       captureHls.loadSource(url);captureHls.attachMedia(video);
     }else if(video.canPlayType('application/vnd.apple.mpegurl')){
       on(video,'loadedmetadata',start);video.src=url;
     }else throw Error('This browser cannot play HLS streams.');
   }
   mount(data.url,begin);update();show();
  }catch(e){if(valid()){$('#player-loading').hidden=true;$('#player-error').textContent=e.message;show();}}
 }
 window.addEventListener('pagehide',stop);return {open,openSports,render,stop};
})();
