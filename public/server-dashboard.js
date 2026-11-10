const dashboardColors = ['#809dff','#5dd6bf','#ed9fb8','#f3c776','#c4a0ff','#62cfff','#9cdb75','#f59e73'];
function dashboardBytes(bytes) {
  if (!Number.isFinite(bytes)) return 'Unavailable';
  const units=['B','KiB','MiB','GiB','TiB'];
  const index=bytes>0?Math.min(4,Math.floor(Math.log(bytes)/Math.log(1024))):0;
  return (bytes/1024**index).toLocaleString(undefined,{maximumFractionDigits:index?1:0})+' '+units[index];
}
function dashboardRate(bytes) {
  return Number.isFinite(bytes)?(bytes*8/1e6).toLocaleString(undefined,{maximumFractionDigits:2})+' Mbps':'Unavailable';
}
function dashboardProgress(done,total) {
  if(!Number.isFinite(done)||!Number.isFinite(total)||total<=0)return '';
  return '<progress max="'+total+'" value="'+Math.min(done,total)+'"></progress><small>'+done.toLocaleString()+' / '+total.toLocaleString()+'</small>';
}
function dashboardDrive(drive,colors) {
  const known=drive.total>0&&Number.isFinite(drive.free);
  const used=known?Math.max(0,drive.total-drive.free):null;
  const libraryBytes=drive.libraries.reduce((sum,item)=>sum+item.bytes,0);
  const segments=drive.libraries.map(item=>({...item,color:colors.get(item.id)}));
  if(known)segments.push({name:'Other used',bytes:Math.max(0,used-libraryBytes),color:'#566177'},{name:'Free',bytes:drive.free,color:'#273248'});
  const scale=Math.max(1,segments.reduce((sum,item)=>sum+item.bytes,0));
  return '<article class="dashboard-drive"><div class="dashboard-heading"><strong>'+esc(drive.drive)+'</strong><span>'+esc(known?dashboardBytes(drive.free)+' free of '+dashboardBytes(drive.total):'Capacity unavailable')+'</span></div><div class="dashboard-stack" aria-hidden="true">'+segments.map(item=>'<span title="'+esc(item.name+': '+dashboardBytes(item.bytes))+'" style="background:'+item.color+';width:'+100*item.bytes/scale+'%"></span>').join('')+'</div><ul class="dashboard-legend">'+segments.map(item=>'<li><i style="background:'+item.color+'"></i><span>'+esc(item.name)+'</span><strong>'+dashboardBytes(item.bytes)+'</strong></li>').join('')+'</ul></article>';
}

function dashboardDataFolder(usage, expanded=false) {
  const rows=expanded&&usage.folders.length?'<ul class="dashboard-legend">'+usage.folders.map(folder=>'<li><span>'+esc(folder.name)+'</span><strong>'+dashboardBytes(folder.bytes)+'</strong></li>').join('')+'</ul>':'';
  return '<section class="native-panel dashboard-section"><h3>Data folder</h3><dl class="native-details"><dt>Size</dt><dd><strong>'+dashboardBytes(usage.bytes)+'</strong>'+(usage.partial?' · Partial measurement':'')+'</dd><dt>Location</dt><dd>'+esc(usage.path)+'</dd></dl>'+rows+'<p class="count">Measured '+new Date(usage.sampledAt).toLocaleTimeString()+'. Updated at most once per minute.</p></section>';
}

async function renderNativeDashboard(version) {
  const root=$('#server-content');
  root.classList.add('dashboard-page');
  root.closest('.native-server-layout').classList.add('dashboard-wide');
  root.innerHTML='<span id="dashboard-status" class="dashboard-status" role="status">Loading server stats…</span><div id="dashboard-content"></div>';
  const status=root.querySelector('#dashboard-status'),content=root.querySelector('#dashboard-content');
  const colors=new Map();
  let range='hour',timer,revision=0;
  async function refresh() {
    clearTimeout(timer);
    const request=++revision;
    try {
      const data=await api('/dashboard?range='+range);
      if(version!==routeVersion||!root.isConnected||request!==revision)return;
      const {system,drives,network,activities}=data;
      for(const drive of drives)for(const library of drive.libraries)if(!colors.has(library.id))colors.set(library.id,dashboardColors[colors.size%dashboardColors.length]);
      const chart=dashboardNetworkChart(data.networkHistory,range);
      const percent=value=>Number.isFinite(value)?Math.round(value)+'%':'Unavailable';
      const temp=value=>Number.isFinite(value)?Math.round(value)+' °C':'Unavailable';
      const cards=[
        ['CPU',percent(system.cpu.usage),[system.cpu.name,'Temperature '+(system.cpu.temperature==null?'unavailable · no CPU sensor reported':temp(system.cpu.temperature))].filter(Boolean).join(' · ')],
        ['Memory',dashboardBytes(system.memory.used),dashboardBytes(system.memory.total)+' installed'],
        ...system.gpus.map(gpu=>[gpu.name,percent(gpu.usage),temp(gpu.temperature)+' · VRAM '+(gpu.memoryUsed===null?'Unavailable':gpu.memoryUsed+' / '+gpu.memoryTotal+' MiB')])
      ];
      const rows=[
        ...activities.scans.map(scan=>({title:scan.name,phase:scan.state==='metadata'?'Matching metadata':scan.state==='queued'?'Scan queued':'Scanning files',detail:(scan.found??0)+' files found',done:scan.matched,total:scan.totalSeries||scan.found})),
        ...activities.analysis.jobs.map(job=>({title:job.title,phase:job.phase,detail:job.library,done:job.frames??job.done,total:job.totalFrames??job.total})),
        ...activities.transcodes.map(job=>({title:job.name,phase:job.state,detail:job.profile})),
        ...activities.tuners.map(job=>({title:job.name,phase:job.state})),
        ...(activities.sports||[])
      ];
      content.innerHTML=dashboardSessions(data.sessions||[])+'<div class="dashboard-metrics">'+cards.map(([label,value,detail])=>'<article class="native-panel dashboard-metric"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong><small>'+esc(detail)+'</small></article>').join('')+'</div>'+
        '<section class="native-panel dashboard-section"><h3>Activity</h3><p class="count">Media analysis '+esc(activities.analysis.mode)+' · '+activities.analysis.active+' active · '+activities.analysis.queued+' queued · '+activities.analysis.completed+' videos prepared · '+activities.analysis.failed+' errors this session</p>'+
        (rows.length?'<div class="dashboard-activities">'+rows.map(row=>'<article><div><strong>'+esc(row.title||'Playback')+'</strong><small>'+esc([row.phase,row.detail].filter(Boolean).join(' · '))+'</small></div><div>'+dashboardProgress(row.done,row.total)+'</div></article>').join('')+'</div>':'<p class="count">No active jobs or recent playback.</p>')+'</section>'+
        '<section class="native-panel dashboard-section"><h3>Network bandwidth</h3><div class="dashboard-network">'+[['local','Local Boreas'],['public','Public Boreas']].map(([key,label])=>'<article><strong>'+label+'</strong><span>'+dashboardRate(network[key].rate)+'</span><small>'+dashboardBytes(network[key].sent)+' sent since startup</small></article>').join('')+'<article><strong>Host adapters</strong><span>↓ '+dashboardRate(system.network?.received)+'</span><small>↑ '+dashboardRate(system.network?.sent)+'</small></article></div>'+chart+'<p class="count">Boreas rates show outgoing response data. Public traffic is grouped by the configured public hostname.</p></section>'+
        (data.dataFolder?dashboardDataFolder(data.dataFolder,true):'<section class="native-panel dashboard-section"><h3>Data folder</h3><p class="count">Measuring storage in the background…</p></section>')+'<section class="native-panel dashboard-section"><h3>Drive storage</h3><p class="count">Library sizes come from the last scan. Overlapping files are counted once.</p>'+(drives.map(drive=>dashboardDrive(drive,colors)).join('')||'<p class="count">Loading drive statistics…</p>')+'</section>'+dashboardDevices(data.devices||[]);
      content.querySelector('#dashboard-network-range').onchange=event=>{range=event.target.value;void refresh();};
      content.querySelectorAll('[data-end-session]').forEach(button=>button.onclick=async()=>{if(!await confirmAction('End stream?','This will stop playback on the viewer’s device.'))return;button.disabled=true;try{await api('/dashboard/sessions/'+encodeURIComponent(button.dataset.endSession),{method:'DELETE'});content.querySelector('[data-end-session="'+CSS.escape(button.dataset.endSession)+'"]')?.closest('article').remove();}catch(error){status.textContent=error.message;button.disabled=false;}});
      content.querySelectorAll('[data-boot-device]').forEach(button=>button.onclick=async()=>{
        if(!await confirmAction('Sign out device?','The device will need to sign in again.'))return;
        button.disabled=true;
        try{await api('/dashboard/devices/'+button.dataset.bootDevice,{method:'DELETE'});if(button.dataset.current==='true')await start();else void refresh();}
        catch(error){status.textContent=error.message;button.disabled=false;}
      });
      status.textContent='';
    } catch (error) {
      if(version===routeVersion&&root.isConnected)status.textContent=error.message;
    }
    if(version===routeVersion&&root.isConnected&&request===revision)timer=setTimeout(refresh,5000);
  }
  await refresh();
}

function dashboardSessions(sessions){
 const time=value=>{value=Math.max(0,Math.round(value||0));return Math.floor(value/3600)+':'+String(Math.floor(value/60)%60).padStart(2,'0')+':'+String(value%60).padStart(2,'0');};
 const cards=sessions.map(entry=>{
   const art=entry.poster?'<img src="'+esc(entry.poster)+'" alt="" loading="lazy">':'<span class="dashboard-session-placeholder" aria-hidden="true">▶</span>';
   const network=entry.network==='public'?'Public network':entry.network==='local'?'Local network':'Network unavailable';
   const rate=entry.bitrate?dashboardRate(entry.bitrate/8)+(entry.targetBitrate?' target':' estimated'):'Bitrate unavailable';
   const progress=entry.total>0?'<progress max="'+entry.total+'" value="'+Math.min(entry.done,entry.total)+'"></progress><small>'+time(entry.done)+' / '+time(entry.total)+'</small>':'';
   return '<article class="dashboard-session">'+art+'<div class="dashboard-session-info"><div class="dashboard-session-title"><strong>'+esc(entry.title||'Playback')+'</strong><span>'+esc(entry.phase||'Active')+'</span></div><small>'+esc([entry.user,entry.device,entry.profile].filter(Boolean).join(' · '))+'</small><div class="dashboard-session-tags"><span>'+network+'</span><span>'+rate+'</span></div><div class="dashboard-session-progress">'+progress+'</div><button class="subtle" data-end-session="'+esc(entry.id)+'">End stream</button></div></article>';
 }).join('');
 return '<section class="native-panel dashboard-section"><div class="section-heading"><h3>Active sessions</h3><span class="native-badge">'+sessions.length+' active</span></div>'+(cards?'<div class="dashboard-session-grid">'+cards+'</div>':'<p class="count">No active playback sessions.</p>')+'</section>';
}

function dashboardNetworkChart(history,range){
 const ranges=[['hour','1 hour'],['day','1 day'],['week','1 week'],['month','1 month']];
 const controls='<div class="dashboard-chart-header"><div class="dashboard-chart-legend"><span>Local</span><span>Public</span></div><label>Time range <select id="dashboard-network-range">'+ranges.map(([value,label])=>'<option value="'+value+'"'+(value===range?' selected':'')+'>'+label+'</option>').join('')+'</select></label></div>';
 const points=history?.points||[];
 if(!points.some(point=>point[1]!==null))return controls+'<p class="count">Network history is collecting. The first sample appears after about a minute.</p>';
 const peak=Math.max(125000,...points.flatMap(point=>point.slice(1)));
 const x=index=>60+index/Math.max(1,points.length-1)*910;
 const y=value=>175-155*value/peak;
 const line=(column,color)=>{
   let path='',connected=false;
   const dots=[];
   points.forEach((point,index)=>{
     const value=point[column];
     if(value===null){connected=false;return;}
     const px=x(index).toFixed(1),py=y(value).toFixed(1);
     path+=(connected?'L':'M')+px+' '+py;
     if(!connected)dots.push('<circle cx="'+px+'" cy="'+py+'" r="2" fill="'+color+'"/>');
     connected=true;
   });
   return '<path d="'+path+'" fill="none" stroke="'+color+'" stroke-width="2" vector-effect="non-scaling-stroke"/>'+dots.join('');
 };
 const grid=[0,.25,.5,.75,1].map(level=>'<line x1="60" x2="970" y1="'+y(peak*level)+'" y2="'+y(peak*level)+'"/><text x="54" y="'+(y(peak*level)+4)+'" text-anchor="end">'+esc(dashboardRate(peak*level))+'</text>').join('');
 const labels=[0,.25,.5,.75,1].map((ratio,index)=>{
   const date=new Date(history.start+(history.end-history.start)*ratio);
   const options=range==='hour'||range==='day'?{hour:'numeric',minute:'2-digit'}:{month:'short',day:'numeric'};
   return '<text x="'+(60+910*ratio)+'" y="199" text-anchor="'+(index===0?'start':index===4?'end':'middle')+'">'+esc(date.toLocaleString([],options))+'</text>';
 }).join('');
 return controls+'<svg class="dashboard-line-chart" viewBox="0 0 985 207" role="img" aria-label="Local and public outgoing network rates in Mbps over the selected time range">'+grid+labels+line(1,'#8cceff')+line(2,'#62dec2')+'</svg>';
}

function dashboardDevices(devices){
 const groups=new Map();
 for(const entry of devices){
   if(!groups.has(entry.id))groups.set(entry.id,[]);
   groups.get(entry.id).push(entry);
 }
 const cards=[...groups.values()].map(entries=>{
   const device=entries.find(entry=>entry.device!=='Unknown device')||entries[0];
   const current=entries.some(entry=>entry.current);
   const seen=Math.max(...entries.map(entry=>entry.lastSeen||Date.parse(entry.createdAt)||0));
   const tv=device.device==='Roku'||device.device==='Android TV';
   const clients=[device.version,tv?'Boreas TV':device.device!=='Unknown device'?'Boreas Web':null,device.platform].filter(Boolean);
   const accounts=[...new Map(entries.map(entry=>[entry.accountId||entry.account,entry])).values()];
   return '<article class="dashboard-device-card"><span class="dashboard-device-icon" aria-hidden="true">'+navIcon(tv?'tv':'discover')+'</span><div><strong>'+esc(device.device)+'</strong>'+(current?' <small>· This device</small>':'')+'<small>'+esc(clients.join(' · '))+'</small>'+(seen?'<small>Last seen '+esc(new Date(seen).toLocaleString())+'</small>':'')+'<ul>'+accounts.map(entry=>'<li>'+esc(entry.account+(entry.profile?' · '+entry.profile:''))+'</li>').join('')+'</ul></div><button class="subtle" data-boot-device="'+esc(device.id)+'" data-current="'+current+'" aria-label="Boot '+esc(device.device)+'">Boot device</button></article>';
 }).join('');
 return '<section class="native-panel dashboard-section"><div class="section-heading"><h3>Connected devices</h3><span class="native-badge">'+groups.size+' signed in</span></div>'+(cards?'<div class="dashboard-device-grid">'+cards+'</div>':'<p class="count">No signed-in devices.</p>')+'</section>';
}
