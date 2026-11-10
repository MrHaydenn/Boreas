let liveTV=null;
function cleanupLiveTV(){if(liveTV){clearInterval(liveTV.clock);clearTimeout(liveTV.searchTimer);liveTV.dayResizeObserver?.disconnect();liveTV.observer?.disconnect();}liveTV=null;$('#tv-dialog')?.close();$('#tv-dialog')?.remove();}
const tvTime=value=>new Date(value).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
const tvDate=value=>new Date(value).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
function tvLocalInput(value){const d=new Date(value);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}
function tvValid(state){return state===liveTV&&state.gen===routeVersion&&!!session;}
function tvGuideDays(now=Date.now()){const today=new Date(now);today.setHours(0,0,0,0);return Array.from({length:14},(_,i)=>{const date=new Date(today);date.setDate(date.getDate()+i);return date;});}
function renderTVDays(state,changeTime){const picker=$('#tv-days'),days=tvGuideDays();picker.innerHTML=days.map((date,i)=>`<button class="tv-day ${date.toDateString()===new Date(state.start).toDateString()?'active':''}" data-tv-day="${i}" aria-pressed="${date.toDateString()===new Date(state.start).toDateString()}"><strong>${i===0?'Today':esc(date.toLocaleDateString(undefined,{weekday:'short'}))}</strong><small>${esc(date.toLocaleDateString(undefined,{month:'short',day:'numeric'}))}</small></button>`).join('');picker.onclick=e=>{const day=e.target.closest('[data-tv-day]');if(!day)return;const date=new Date(days[Number(day.dataset.tvDay)]),time=new Date(state.start);date.setHours(time.getHours(),time.getMinutes(),0,0);changeTime(date.getTime());};}
function buildTVGuideShell(state){$('#tv-content').innerHTML=`<div class="tv-guide-tools"><div class="tv-window-controls"><input type="search" id="tv-filter" aria-label="Search guide programs" placeholder="Search programs, teams, sports…"><div class="tv-days-carousel"><button id="tv-days-left" class="icon" aria-label="Earlier guide days">‹</button><div id="tv-days" class="tv-days" aria-label="Guide day"></div><button id="tv-days-right" class="icon" aria-label="Later guide days">›</button></div><label class="tv-date-label">Time<input type="time" id="tv-time" aria-label="Guide time" step="1800" value="${tvLocalInput(state.start).slice(11)}"></label></div></div><div id="tv-guide-view"><div class="tv-guide-caption"><strong id="tv-guide-date"></strong><div><button class="subtle" id="tv-pan-left" aria-label="Earlier guide times" title="Earlier guide times">‹</button><button class="subtle" id="tv-pan-right" aria-label="Later guide times" title="Later guide times">›</button></div></div><p id="tv-guide-status" class="count" role="status"></p><div id="tv-guide-scroll" class="tv-guide-scroll" tabindex="0" aria-label="TV guide, scroll horizontally for later times"><div class="tv-guide-table"><div class="tv-guide-head"><div class="tv-channel-heading">CHANNELS <span>★ Favorites first</span></div><div id="tv-time-labels" class="tv-time-labels"></div></div><div id="tv-guide-rows"></div><div id="tv-guide-more" class="page-sentinel"></div></div></div></div><section id="tv-program-search" hidden aria-label="Program search results"></section>`;
 const changeTime=value=>{Object.assign(state,LumenTV.window(value));$('#tv-time').value=tvLocalInput(state.start).slice(11);renderTVDays(state,changeTime);state.programs=[];renderTVGuideRows(state);loadTVGuide(state);};renderTVDays(state,changeTime);
 const dayStrip=$('#tv-days'),dayLeft=$('#tv-days-left'),dayRight=$('#tv-days-right');const updateDayArrows=()=>{if(!tvValid(state))return;const overflow=dayStrip.scrollWidth>dayStrip.clientWidth+2;dayLeft.hidden=dayRight.hidden=!overflow;dayLeft.disabled=dayStrip.scrollLeft<=2;dayRight.disabled=dayStrip.scrollLeft+dayStrip.clientWidth>=dayStrip.scrollWidth-2;};dayLeft.onclick=()=>dayStrip.scrollBy({left:-dayStrip.clientWidth*.8,behavior:'smooth'});dayRight.onclick=()=>dayStrip.scrollBy({left:dayStrip.clientWidth*.8,behavior:'smooth'});dayStrip.addEventListener('scroll',updateDayArrows,{passive:true});state.dayResizeObserver=new ResizeObserver(updateDayArrows);state.dayResizeObserver.observe(dayStrip);updateDayArrows();
 $('#tv-time').onchange=e=>{if(!e.target.value)return;const date=new Date(state.start),[hours,minutes]=e.target.value.split(':').map(Number);date.setHours(hours,minutes,0,0);changeTime(date.getTime());};
 $('#tv-filter').oninput=e=>{state.filter=e.target.value.trim();state.searchShown=60;clearTimeout(state.searchTimer);if(!state.filter){renderTVProgramSearch(state);return;}state.searchTimer=setTimeout(()=>searchTVPrograms(state),200);};
 $('#tv-pan-left').onclick=()=>panTVGuide(state,-1,changeTime);$('#tv-pan-right').onclick=()=>panTVGuide(state,1,changeTime);
}
// Scroll the visible grid first; at either edge, fetch the next overlapping time window.
function panTVGuide(state,direction,changeTime){
 if(!tvValid(state))return;
 const scroller=$('#tv-guide-scroll');if(!scroller)return;
 const maximum=Math.max(0,scroller.scrollWidth-scroller.clientWidth);
 const atEdge=direction<0?scroller.scrollLeft<=2:scroller.scrollLeft>=maximum-2;
 if(!atEdge){scroller.scrollBy({left:direction*480,behavior:'smooth'});return;}
 changeTime(state.start+direction*2*3600000);
 $('#tv-days .active')?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'smooth'});
}
function tvProgramTimer(state,program){return state.timers.find(t=>t.ProgramId===program.Id&&LumenTV.active(t))||(program.TimerId?{Id:program.TimerId,ProgramId:program.Id,Name:program.Name,Status:'New'}:null);}
function renderTVGuideRows(state){if(!tvValid(state)||!$('#tv-guide-rows'))return;state.observer?.disconnect();const byChannel=new Map();for(const p of state.programs){if(!byChannel.has(p.ChannelId))byChannel.set(p.ChannelId,[]);byChannel.get(p.ChannelId).push(p);}const channelPrograms=id=>(byChannel.get(id)||[]).filter(p=>LumenTV.segment(p,state.start,state.end)).sort((a,b)=>Date.parse(a.StartDate)-Date.parse(b.StartDate));
 const channels=LumenTV.channels(state.channels).filter(c=>(!state.source||(c.LumenSource||'tuner')===state.source)&&(!state.favoritesOnly||c.UserData?.IsFavorite)&&(!state.category||channelPrograms(c.Id).some(p=>p[state.category])));
 $('#tv-guide-date').textContent=tvDate(state.start)+(new Date(state.start).getDate()!==new Date(state.end).getDate()?' – '+tvDate(state.end):'');$('#tv-time-labels').innerHTML=Array.from({length:8},(_,i)=>`<span>${esc(tvTime(state.start+i*1800000))}</span>`).join('');
 $('#tv-guide-rows').innerHTML=channels.slice(0,state.shown).map(channel=>{const programs=channelPrograms(channel.Id),logo=channel.logo;return `<div class="tv-guide-row"><div class="tv-channel"><button class="tv-channel-watch" data-tv-watch="${esc(channel.Id)}" aria-label="Watch ${esc(channel.Name)}">${logo?`<img src="${esc(logo)}" alt="" loading="lazy">`:'<span class="tv-channel-emblem">▣</span>'}<span><strong>${esc(channel.Name)}</strong><small>${esc(channel.ChannelNumber||'Live channel')}</small></span></button><button class="tv-star ${channel.UserData?.IsFavorite?'selected':''}" data-tv-favorite="${esc(channel.Id)}" aria-pressed="${!!channel.UserData?.IsFavorite}" aria-label="${channel.UserData?.IsFavorite?'Unfavorite':'Favorite'} ${esc(channel.Name)}">${channel.UserData?.IsFavorite?'★':'☆'}</button></div><div class="tv-program-track">${programs.length?programs.map(p=>{const segment=LumenTV.segment(p,state.start,state.end),timer=tvProgramTimer(state,p),now=Date.now()>=Date.parse(p.StartDate)&&Date.now()<Date.parse(p.EndDate);return `<button class="tv-program ${now?'on-now':''} ${timer?'scheduled':''} ${timer?.Status==='InProgress'?'tv-recording-now':''} ${state.category&&!p[state.category]?'tv-dim':''}" data-tv-program="${esc(p.Id)}" style="left:${segment.left}%;width:calc(${segment.width}% - 3px)" title="${esc(p.Name)} · ${esc(tvTime(p.StartDate))}–${esc(tvTime(p.EndDate))}" aria-label="${esc(p.Name)}, ${esc(tvTime(p.StartDate))} to ${esc(tvTime(p.EndDate))}${timer?.Status==='InProgress'?', recording now':timer?', recording scheduled':''}"><strong>${timer?'<span class="tv-record-dot">●</span> ':''}${esc(p.Name)}</strong><small>${esc(p.EpisodeTitle||`${tvTime(p.StartDate)} – ${tvTime(p.EndDate)}`)}</small>${p.IsLive?'<span class="tv-live-tag">LIVE</span>':''}</button>`;}).join(''):'<span class="tv-no-listings">No guide listings · Click channel to watch</span>'}<span class="tv-now-line" aria-hidden="true"></span></div></div>`;}).join('')||'<div class="tv-no-matches">No channels match these filters.</div>';
 const marker=$('#tv-guide-more');marker.textContent=channels.length>state.shown?'More channels below':'';if(channels.length>state.shown){state.observer=new IntersectionObserver(entries=>{if(entries.some(x=>x.isIntersecting)&&tvValid(state)){state.shown+=60;renderTVGuideRows(state);}},{root:$('#tv-guide-scroll'),rootMargin:'300px'});state.observer.observe(marker);}updateTVNow();
}
function updateTVNow(){if(!liveTV||liveTV.tab!=='guide')return;const percent=(Date.now()-liveTV.start)/(liveTV.end-liveTV.start)*100;document.querySelectorAll('.tv-now-line').forEach(x=>{x.hidden=percent<0||percent>100;x.style.left=percent+'%';});}

function nativeTVFavorites() {
  try {
    const value=JSON.parse(localStorage.getItem('lumen-native-tv-favorites:'+serverId+':'+session.id)||'[]');
    return new Set(Array.isArray(value)?value:[]);
  } catch { return new Set(); }
}

async function renderNativeLiveTV(gen,tab='guide') {
  cleanupLiveTV();
  if(!['guide','recorded','schedule','series'].includes(tab))tab='guide';
  const state={gen,tab,...LumenTV.window(),channels:[],programs:[],timers:[],filter:'',request:0,searchRequest:0,shown:60,favorites:nativeTVFavorites()};
  liveTV=state;
  $('#main').innerHTML='<div class="page-top tv-page-top"><nav class="section-breadcrumb" aria-label="Breadcrumb"><a href="#live-tv">Live TV</a><span class="breadcrumb-separator">›</span><span aria-current="page">'+({guide:'Guide',recorded:'Recorded',schedule:'DVR schedule',series:'Series rules'})[tab]+'</span></nav><button id="tv-manual" class="subtle" hidden>＋ Manual recording</button></div>'+tvTabs(tab)+'<div id="tv-content"></div>';
  $('#tv-manual').onclick=()=>openNativeRecordForm({},()=>refreshNativeDVR(state)).catch(error=>toast(error.message));
  if(tab!=='guide'){
    $('#tv-content').innerHTML='<div id="tv-dvr-list" class="tv-schedule-list"><p class="count">Loading recordings…</p></div>';
    const refresh=()=>refreshNativeDVR(state).catch(error=>{if(tvValid(state))$('#tv-dvr-list').textContent=error.message;});
    await refresh();
    if(tvValid(state))state.clock=setInterval(refresh,10000);
    return;
  }
  buildTVGuideShell(state);
  renderTVGuideRows(state);
  await Promise.all([loadTVGuide(state),refreshNativeDVR(state).catch(error=>toast(error.message))]);
  if(tvValid(state))state.clock=setInterval(()=>{
    updateTVNow();
    if(!state.filter&&!$('#tv-dialog')?.open)void refreshNativeDVR(state).catch(()=>{});
    if(!state.filter&&!$('#tv-dialog')?.open&&Date.now()-(state.updated||0)>300000)void loadTVGuide(state);
  },30000);
}

async function loadTVGuide(state) {
  const request=++state.request;
  $('#tv-guide-status').textContent='Loading listings…';
  try {
    const result=await api('/live-tv/guide?'+new URLSearchParams({start:state.start,end:state.end}));
    if(!tvValid(state)||request!==state.request)return;
    state.channels=result.channels.map(channel=>({...channel,UserData:{IsFavorite:state.favorites.has(channel.Id)}}));
    state.programs=result.programs;
    state.updated=Date.now();
    renderTVGuideRows(state);
    $('#tv-guide-status').textContent=result.guideUnavailable?'A configured XMLTV guide could not be loaded.':!state.channels.length?'Add a tuner under Server → Live TV.':!result.guideConfigured?'Add an XMLTV guide under Server → Live TV.':!state.programs.length?'No listings match the channels in this time window.':state.channels.length+' channels · Times shown in '+Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch(error) {
    if(tvValid(state)&&request===state.request)$('#tv-guide-status').textContent=error.message;
  }
}

async function searchTVPrograms(state) {
  const request=++state.searchRequest,query=state.filter;
  state.searchPrograms=[];
  state.searchLoading=true;
  state.searchError='';
  renderTVProgramSearch(state);
  try {
    const start=Date.now(),result=await api('/live-tv/guide?'+new URLSearchParams({start,end:start+14*86400000,q:query}));
    if(!tvValid(state)||request!==state.searchRequest||query!==state.filter)return;
    state.searchPrograms=result.programs;
  } catch(error) {
    if(tvValid(state)&&request===state.searchRequest&&query===state.filter)state.searchError=error.message;
  } finally {
    if(tvValid(state)&&request===state.searchRequest&&query===state.filter){state.searchLoading=false;renderTVProgramSearch(state);}
  }
}

function renderTVProgramSearch(state) {
  if(!tvValid(state))return;
  const root=$('#tv-program-search');
  root.hidden=!state.filter;
  $('#tv-guide-view').hidden=!!state.filter;
  if(root.hidden)return;
  const rows=state.searchPrograms||[];
  root.innerHTML='<div class="tv-search-heading"><h2>Programs matching “'+esc(state.filter)+'”</h2><p class="count">'+esc(state.searchLoading?'Searching guide listings…':state.searchError||rows.length+' airings found')+'</p></div><div class="tv-program-results">'+rows.slice(0,state.searchShown||60).map(program=>'<button class="tv-search-result" data-tv-program="'+esc(program.Id)+'"><span class="tv-search-identity"><strong>'+esc(program.Name)+'</strong><small>'+esc(tvDate(program.StartDate)+' · '+tvTime(program.StartDate)+' · '+program.ChannelName)+'</small><span class="tv-search-description">'+esc(program.Overview||'')+'</span></span><span class="tv-search-action">View details →</span></button>').join('')+'</div>'+(rows.length>(state.searchShown||60)?'<button class="subtle" id="tv-search-more">Load more programs</button>':'');
  $('#tv-search-more')?.addEventListener('click',()=>{state.searchShown=(state.searchShown||60)+60;renderTVProgramSearch(state);});
}

document.addEventListener('click',event=>{
  if(!liveTV||!tvValid(liveTV))return;
  const target=event.target.closest('[data-tv-watch],[data-tv-favorite],[data-tv-program],[data-dvr-play],[data-dvr-edit],[data-dvr-cancel]');
  if(!target)return;
  const state=liveTV;
  if(target.dataset.tvWatch){watchNativeChannel(target.dataset.tvWatch).catch(error=>toast(error.message));return;}
  if(target.dataset.dvrPlay){openNativeRecording(target.dataset.dvrPlay,target.dataset.dvrLive==='true');return;}
  if(target.dataset.dvrEdit){
    const row=state.timers.find(row=>row.Id===target.dataset.dvrEdit);
    if(row)openNativeRecordForm({existing:row},()=>refreshNativeDVR(state)).catch(error=>toast(error.message));
    return;
  }
  if(target.dataset.dvrCancel){
    const {dialog,body}=libraryDialog('Change recording');
    body.innerHTML='<p>Stop or cancel this recording?</p><button class="primary">Confirm</button>';
    body.querySelector('button').onclick=async()=>{
      try{await api('/live-tv/dvr/'+target.dataset.dvrCancel+(state.tab==='series'?'/rule':''),{method:'DELETE'});dialog.close();await refreshNativeDVR(state);}
      catch(error){toast(error.message);}
    };
    return;
  }
  if(target.dataset.tvFavorite){
    const id=target.dataset.tvFavorite,channel=state.channels.find(entry=>entry.Id===id);
    if(!channel)return;
    if(state.favorites.has(id))state.favorites.delete(id);else state.favorites.add(id);
    channel.UserData.IsFavorite=state.favorites.has(id);
    try{localStorage.setItem('lumen-native-tv-favorites:'+serverId+':'+session.id,JSON.stringify([...state.favorites]));}catch{}
    renderTVGuideRows(state);
    $('[data-tv-favorite="'+CSS.escape(id)+'"]')?.focus({preventScroll:true});
    return;
  }
  const program=[...state.programs,...(state.searchPrograms||[])].find(entry=>entry.Id===target.dataset.tvProgram);
  if(!program)return;
  const {dialog,body}=libraryDialog(program.Name);
  dialog.id='tv-dialog';
  const now=Date.now(),airing=now>=Date.parse(program.StartDate)&&now<Date.parse(program.EndDate);
  body.innerHTML='<p class="tv-program-meta">'+esc(tvDate(program.StartDate)+' · '+tvTime(program.StartDate)+' – '+tvTime(program.EndDate)+' · '+program.ChannelName)+'</p>'+(program.EpisodeTitle?'<h3>'+esc(program.EpisodeTitle)+'</h3>':'')+'<p class="tv-program-description">'+esc(program.Overview||'No description available.')+'</p>'+(airing?'<button type="button" class="primary" id="tv-program-watch">▶ Watch live</button>':'');
  const timer=tvProgramTimer(state,program);
  if(state.dvr?.canRecord&&(timer?.Status==='InProgress'||Date.parse(program.EndDate)>now)){
    body.insertAdjacentHTML('beforeend',' <button id="tv-program-record">'+(timer?(timer.Status==='InProgress'?'Stop recording':'Cancel recording'):'● Record')+'</button>');
    $('#tv-program-record').onclick=async()=>{
      try{
        dialog.close();
        if(timer){
          const confirm=libraryDialog(timer.Status==='InProgress'?'Stop recording?':'Cancel recording?');
          confirm.body.innerHTML='<button class="primary">Confirm</button>';
          confirm.body.querySelector('button').onclick=async()=>{
            try{await api('/live-tv/dvr/'+timer.Id,{method:'DELETE'});confirm.dialog.close();await refreshNativeDVR(state);}
            catch(error){toast(error.message);}
          };
        }else await openNativeRecordForm({program},()=>refreshNativeDVR(state));
      }catch(error){toast(error.message);}
    };
  }
  $('#tv-program-watch')?.addEventListener('click',()=>{dialog.close();watchNativeChannel(program.ChannelId).catch(error=>toast(error.message));});
});
function tvTabs(tab){
  const tabs=[['guide','Guide'],['recorded','Recorded'],['schedule','DVR schedule'],['series','Series rules']];
  return '<nav class="tabs tv-tabs" aria-label="Live TV sections">'+tabs.map(([id,name])=>'<a href="#live-tv'+(id==='guide'?'':'/'+id)+'" class="'+(tab===id?'active':'')+'" '+(tab===id?'aria-current="page"':'')+'>'+name+'</a>').join('')+'</nav>';
}

async function refreshNativeDVR(state){
  const data=await api('/live-tv/dvr');
  if(!tvValid(state))return;
  const previous=JSON.stringify(state.timers);
  state.dvr=data;
  state.timers=data.recordings.filter(row=>['New','InProgress','Finalizing'].includes(row.Status));
  if(state.tab==='guide'){
    if(previous!==JSON.stringify(state.timers))renderTVGuideRows(state);
    $('#tv-manual').hidden=!data.canRecord;
    return;
  }
  $('#tv-manual').hidden=!data.canRecord||state.tab==='recorded';
  const rows=state.tab==='recorded'?data.recordings.filter(row=>['Completed','InProgress','Finalizing'].includes(row.Status)):
    state.tab==='series'?data.rules:data.recordings.filter(row=>['New','InProgress','Finalizing','Error'].includes(row.Status));
  const list=$('#tv-dvr-list');
  list.innerHTML=rows.map(row=>{
    const watch=['Completed','InProgress'].includes(row.Status);
    const cancel=data.canRecord&&(state.tab==='series'||['New','InProgress'].includes(row.Status));
    return '<article class="tv-schedule-row"><div><strong>'+esc(row.Name)+'</strong><p class="count">'+esc([row.ChannelName,row.StartDate&&tvDate(row.StartDate)+' · '+tvTime(row.StartDate),row.EpisodeTitle,row.Status,row.Error].filter(Boolean).join(' · '))+'</p></div><div class="actions">'+
      (watch?'<button data-dvr-play="'+esc(row.Id)+'" data-dvr-live="'+(row.Status==='InProgress')+'">Watch</button>':'')+
      (data.canRecord&&row.Status==='New'?'<button class="subtle" data-dvr-edit="'+esc(row.Id)+'">Edit</button>':'')+
      (cancel?'<button class="subtle" data-dvr-cancel="'+esc(row.Id)+'">'+(row.Status==='InProgress'?'Stop recording':'Cancel')+'</button>':'')+'</div></article>';
  }).join('')||'<p class="tv-message">Nothing here yet.</p>';
}

function openNativeRecording(id,live){
  const watch=begin=>NativePlayer.open('tv-dvr',id+(begin?'?begin=1':''));
  if(!live){watch(true);return;}
  const {dialog,body}=libraryDialog('This channel is recording');
  body.innerHTML='<div class="actions"><button class="primary" id="tv-start-over">Start from beginning</button><button id="tv-watch-live">Watch live</button></div>';
  $('#tv-start-over').onclick=()=>{dialog.close();watch(true);};
  $('#tv-watch-live').onclick=()=>{dialog.close();watch(false);};
}

async function watchNativeChannel(id){
  const {recording}=await api('/live-tv/dvr/channel?'+new URLSearchParams({id}));
  if(recording)openNativeRecording(recording.Id,true);
  else NativePlayer.open('live-tv',id);
}

async function openNativeRecordForm({program,channelId,streamId,existing}={},onSaved){
  if(existing&&!existing.ProgramId.startsWith('manual~'))program={Id:existing.ProgramId,Name:existing.Name};
  const data=await api('/live-tv/dvr');
  if(!data.canRecord)throw Error('This profile cannot schedule recordings.');
  const channels=channelId||program?[]:(await api('/live-tv/channels')).channels;
  const {dialog,body}=libraryDialog(existing?'Edit '+existing.Name:program?'Record '+program.Name:'Manual recording');
  if(!data.destinations.length){body.textContent='Add a writable video library under Server → Libraries to save recordings.';return;}
  body.innerHTML='<form class="tv-record-options"><label>Save to library<select name="library">'+data.destinations.map(library=>'<option value="'+esc(library.id)+'">'+esc(library.name)+'</option>').join('')+'</select></label><label>Folder<select name="folder"></select></label>'+
    (program?'<label>Record<select name="series"><option value="0">This airing</option><option value="1">Series on this channel</option></select></label>':
      (channelId?'':'<label>Channel<select name="channel" required>'+channels.map(channel=>'<option value="'+esc(channel.tuner+'~'+channel.number)+'">'+esc(channel.number+' · '+channel.name)+'</option>').join('')+'</select></label>')+
      '<label>Recording name<input name="title" maxlength="120" placeholder="Channel name"></label><label>Start<input type="datetime-local" name="start" '+(channelId?'disabled':'required value="'+tvLocalInput(Date.now())+'"')+'></label><label>End<input type="datetime-local" name="end" required value="'+tvLocalInput(Date.now()+3600000)+'"></label>')+
    '<label>Start early (minutes)<input type="number" name="pre" value="0" min="0" max="60"></label><label>End late (minutes)<input type="number" name="post" value="0" min="0" max="60"></label><p class="count" role="status"></p><button class="primary" type="submit">Record</button></form>';
  const form=body.querySelector('form');
  if(channelId&&!program)form.elements.start.closest('label').hidden=true;
  function folders(){
    const library=data.destinations.find(library=>library.id===form.elements.library.value);
    form.elements.folder.innerHTML=library.folders.map(folder=>'<option value="'+folder.index+'">'+esc(folder.name||'Library folder')+'</option>').join('');
  }
  if(existing&&data.destinations.some(library=>library.id===existing.LibraryId))form.elements.library.value=existing.LibraryId;
  folders();
  form.elements.library.onchange=folders;
  if(existing){
    if(existing.FolderIndex>=0)form.elements.folder.value=existing.FolderIndex;
    form.elements.pre.value=existing.PrePaddingSeconds/60;
    form.elements.post.value=existing.PostPaddingSeconds/60;
    if(form.elements.series)form.elements.series.closest('label').hidden=true;
    if(form.elements.channel){
      form.elements.channel.value=existing.ChannelId;
      form.elements.title.value=existing.Name;
      form.elements.start.value=tvLocalInput(existing.StartDate);
      form.elements.end.value=tvLocalInput(existing.EndDate);
    }
    form.querySelector('[type=submit]').textContent='Save recording';
  }
  form.onsubmit=async event=>{
    event.preventDefault();
    const button=form.querySelector('button'),values=new FormData(form);
    button.disabled=true;
    try{
      const recording=await api('/live-tv/dvr'+(existing?'/'+existing.Id:''),{method:existing?'PATCH':'POST',body:{
        libraryId:values.get('library'),folder:Number(values.get('folder')),programId:program?.Id,series:values.get('series')==='1',streamId,
        channelId:channelId||values.get('channel'),title:values.get('title'),start:channelId?Date.now():new Date(values.get('start')).getTime(),
        end:new Date(values.get('end')).getTime(),pre:60*Number(values.get('pre')),post:60*Number(values.get('post'))
      }});
      if(recording.Status==='Error')throw Error(recording.Error);
      dialog.close();
      toast(existing?'Recording updated':recording.Status==='InProgress'?'Recording started':'Recording scheduled');
      await onSaved?.(recording);
    }catch(error){form.querySelector('[role=status]').textContent=error.message;}
    finally{button.disabled=false;}
  };
}
