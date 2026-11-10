function nativeCalendarDay(date){
  return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
}

async function renderNativeCalendar(version){
  const main=$('#main'),today=new Date();
  today.setHours(0,0,0,0);
  let offset=0,request=0;
  main.innerHTML='<div class="native-calendar-toolbar"><button type="button" id="calendar-previous" aria-label="Previous week">‹</button><button type="button" id="calendar-today">Today</button><button type="button" id="calendar-next" aria-label="Next week">›</button><strong id="calendar-range"></strong></div><p class="count" id="calendar-notice" role="status"></p><div class="native-calendar-grid" id="calendar-grid"></div>';
  $('#calendar-previous').onclick=()=>{offset-=7;void load();};
  $('#calendar-today').onclick=()=>{offset=0;void load();};
  $('#calendar-next').onclick=()=>{offset+=7;void load();};
  await load();

  async function load(){
    const revision=++request;
    const at=day=>new Date(today.getFullYear(),today.getMonth(),today.getDate()+offset+day);
    const format=new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',year:'numeric'});
    const days=Array.from({length:7},(_,index)=>at(index));
    $('#calendar-range').textContent=format.formatRange(days[0],days[6]);
    $('#calendar-notice').textContent='Loading Sonarr and Radarr releases…';
    try{
      const start=at(-1),end=at(8);
      const {items,warnings}=await api('/calendar?'+new URLSearchParams({start:start.toISOString(),end:end.toISOString()}));
      if(version!==routeVersion||revision!==request)return;
      const byDay=new Map(days.map(day=>[nativeCalendarDay(day),[]]));
      for(const item of items)byDay.get(item.allDay?item.date.slice(0,10):nativeCalendarDay(new Date(item.date)))?.push(item);
      const heading=new Intl.DateTimeFormat(undefined,{weekday:'short',month:'short',day:'numeric'});
      const time=new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit'});
      $('#calendar-grid').innerHTML=days.map(day=>{
        const entries=byDay.get(nativeCalendarDay(day));
        return '<section class="native-calendar-day"><h2>'+esc(heading.format(day))+'</h2>'+(entries.length?entries.map(item=>{
          const tag=item.tmdbId?'a':'div',url=item.tmdbId?' href="#discover/'+item.type+'/'+encodeURIComponent(item.tmdbId)+'"':'';
          const label=[item.subtitle,item.allDay?'':time.format(new Date(item.date))].filter(Boolean).join(' · ');
          return '<'+tag+url+' class="native-calendar-event"><img src="'+esc(item.poster||'/branding/lumen-wolf.png')+'" alt="" loading="lazy"><span><strong>'+esc(item.title)+'</strong><small>'+esc(label)+'</small><small>'+ (item.service==='radarr'?'Radarr':'Sonarr')+'</small></span></'+tag+'>';
        }).join(''):'<p class="count">No releases</p>')+'</section>';
      }).join('');
      $('#calendar-grid').querySelectorAll('img').forEach(img=>img.addEventListener('error',()=>{
        if(!img.src.endsWith('/branding/lumen-wolf.png'))img.src='/branding/lumen-wolf.png';
      },{once:true}));
      $('#calendar-notice').textContent=warnings.join(' ');
    }catch(error){if(version===routeVersion&&revision===request){$('#calendar-grid').replaceChildren();$('#calendar-notice').textContent=error.message;}}
  }
}

async function renderNativeConnections(version){
  const root=$('#server-content');
  root.innerHTML='<section aria-labelledby="metadata-connections-heading"><h2 id="metadata-connections-heading">Metadata</h2><div id="metadata-connections"></div></section><section aria-labelledby="download-connections-heading"><h2 id="download-connections-heading">Arr and qBittorrent</h2><div id="download-connections"></div></section>';
  await Promise.all([renderMetadataSettings(version,root.querySelector('#metadata-connections')),renderDownloadConnections(version,root.querySelector('#download-connections'))]);
}

async function renderDownloadConnections(version,root){
  root.innerHTML='<p role="status">Loading connections…</p>';
  try{
    const data=await api('/connections');
    if(version!==routeVersion)return;
    root.innerHTML=[['sonarr','Sonarr'],['radarr','Radarr'],['qbittorrent','qBittorrent']].map(([id,name])=>{
      const entry=data[id];
      return '<form class="native-panel native-connection-form" data-service="'+id+'"><h3>'+name+'</h3><label>Service URL<input name="url" type="url" required value="'+esc(entry.url)+'"></label><label>API key<input name="apiKey" type="password" autocomplete="off" placeholder="'+(entry.hasApiKey?'Saved':'Enter API key')+'"></label>'+
        (id==='qbittorrent'?'<label>Web UI username<input name="username" value="'+esc(entry.username)+'" autocomplete="off"></label><label>Web UI password<input name="password" type="password" autocomplete="new-password" placeholder="'+(entry.hasPassword?'Saved':'Optional with an API key')+'"></label>':'')+
        '<div class="actions"><button type="submit" class="primary">Test and save</button><button type="button" data-test '+(!entry.configured?'disabled':'')+'>Test saved connection</button></div><p role="status" class="count"></p></form>';
    }).join('');
    for(const form of root.querySelectorAll('form')){
      const endpoint='/connections/'+form.dataset.service,submit=form.querySelector('[type=submit]'),test=form.querySelector('[data-test]'),status=form.querySelector('[role=status]');
      async function run(saved){
        const wasDisabled=test.disabled;
        submit.disabled=test.disabled=true;
        status.textContent='Testing connection…';
        let success=false;
        try{
          const response=await api(endpoint+(saved?'/test':''),{method:'POST',...(saved?{}:{body:Object.fromEntries(new FormData(form))})});
          status.textContent=response.message+(saved?'':' · Saved');
          for(const input of form.querySelectorAll('[type=password]'))if(!saved&&input.value){input.value='';input.placeholder='Saved';}
          success=true;
        }catch(error){status.textContent=error.message;}
        finally{submit.disabled=false;test.disabled=wasDisabled&&!success;}
      }
      form.onsubmit=event=>{event.preventDefault();void run(false);};
      test.onclick=()=>void run(true);
    }
  }catch(error){if(version===routeVersion)root.textContent=error.message;}
}
