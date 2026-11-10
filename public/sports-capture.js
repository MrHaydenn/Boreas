/* Browser capture is intentionally independent of Plex playback sessions. */
const SportsCapture=(()=>{
 let timer=null,preview=null;
 async function api(route,method='GET',data){const r=await fetch('/sports-capture-api/'+route,{method,headers:{'X-Lumen-CSRF':csrf,'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});const value=await r.json();if(!r.ok)throw Object.assign(Error(value.error||'Capture request failed'),{status:r.status});return value;}
 function cleanup(){clearTimeout(timer);timer=null;preview?.close();}
 async function mount(){
  const host=document.querySelector('#sports-recordings');if(!host)return;
  host.innerHTML='<p id="capture-message" role="status"></p><div class="sports-grid recording-grid"></div>';
  const message=host.querySelector('#capture-message'),grid=host.querySelector('.recording-grid');
  let menu=null,signature='';
  const label=job=>({scheduled:'Scheduled',complete:'Recorded',failed:'Failed',finalizing:'Finishing',starting:'Preparing','needs-input':'Waiting for input'}[job.state]||(job.recording?'Recording':'Watching live'));
  const date=job=>new Date(Date.parse(job.start)||job.created).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
  function actions(job){
   const dialog=document.createElement('dialog');menu=dialog;dialog.className='sports-dialog recording-dialog';
   dialog.innerHTML='<div class="sports-dialog-head"><h2>'+esc(job.title)+'</h2><button type="button" data-close>Close</button></div><p>'+esc(label(job)+' · '+date(job))+'</p><div class="sports-actions"></div><p role="status"></p>';
   const list=dialog.querySelector('.sports-actions'),status=dialog.querySelector('[role=status]');
   const add=(title,run)=>{const button=document.createElement('button');button.textContent=title;button.onclick=async()=>{button.disabled=true;try{await run();dialog.close();}catch(error){status.textContent=error.message;button.disabled=false;}};list.append(button);};
   const active=['starting','needs-input','capturing'].includes(job.state);
   if(job.ready&&job.state!=='failed'&&job.state!=='finalizing')add(job.state==='complete'?'Play recording':'Watch live',()=>watch(job.id,false));
   if(active&&job.ready&&job.recording)add('Watch from beginning',()=>watch(job.id,true));
   if(active){
    add('Source preview',()=>sourcePreview(job.id));
    if(!job.recording)add('Record',()=>api('jobs/'+job.id+'/record','POST',{}));
    add(job.recording?'Finish recording':'Stop capture',()=>api('jobs/'+job.id+'/stop','POST',{}));
   }
   if(job.state==='scheduled')add('Cancel recording',()=>api('jobs/'+job.id+'/stop','POST',{}));
   if(job.state==='complete'&&!job.saved)add('Save to folder',()=>api('jobs/'+job.id+'/export','POST',{}));
   if(job.canDelete&&['complete','failed'].includes(job.state))add(job.saved?'Delete recording':'Remove capture',async()=>{if(confirm(job.saved?'Permanently delete this recording?':'Remove this capture?'))await api('jobs/'+job.id,'DELETE');});
   dialog.querySelector('[data-close]').onclick=()=>dialog.close();
   dialog.addEventListener('close',()=>{dialog.remove();menu=null;void refresh();},{once:true});
   host.append(dialog);dialog.showModal();
  }
  async function refresh(){
   clearTimeout(timer);if(!host.isConnected)return;
   try{
    const {jobs}=await api('jobs');if(!host.isConnected)return;
    jobs.sort((a,b)=>b.created-a.created);
    const next=JSON.stringify(jobs);
    if(!menu&&next!==signature){
     signature=next;grid.replaceChildren();
     if(!jobs.length)grid.innerHTML='<div class="sports-empty">No sports recordings yet.</div>';
     for(const job of jobs){
      const card=document.createElement('button');card.type='button';card.className='sports-game recording-card';
      card.setAttribute('aria-label',job.title+', '+label(job));
      const teams=job.teams?.length?job.teams:[{name:job.title}];
      card.innerHTML='<div class="sports-game-top"><span class="recording-status" data-state="'+esc(job.state)+'">'+esc(label(job))+'</span></div>'+teams.map(team=>'<div class="sports-team">'+(team.logo?'<img src="'+esc(team.logo)+'" alt="" loading="lazy">':'<span class="recording-team-fallback">'+esc(team.abbrev||'')+'</span>')+'<span>'+esc(team.name)+'</span></div>').join('')+'<footer>'+esc(date(job))+'</footer>';
      card.onclick=()=>actions(job);grid.append(card);
     }
    }
    message.textContent='';
   }catch(error){if(host.isConnected)message.textContent=error.message;}
   if(host.isConnected)timer=setTimeout(refresh,5000);
  }
  await refresh();
 }
 function watch(id,begin){location.hash='watch/capture/'+id+(begin?'?begin=1':'');}
 async function startSource(source,title,recording=false){return api('jobs','POST',{source:source.url,variant:source.variant,title,recording});}
 async function sourcePreview(id){preview?.close();const d=document.createElement('dialog');preview=d;d.className='capture-preview';d.innerHTML='<div class="sports-dialog-head"><h2>Source browser</h2><button data-close>Close</button></div><p>Click the picture to press Play in the capture browser. Pop-up tabs are blocked.</p><img alt="Capture browser preview"><div class="sports-actions"><button data-key="Space">Play / pause</button><button data-key="f">Fullscreen</button><button data-key="Escape">Escape</button><button data-refresh>Refresh preview</button></div><p role="status"></p>';(document.fullscreenElement===$('#player')?$('#player'):document.body).append(d);d.showModal();let blob=null,timeout;const img=d.querySelector('img'),status=d.querySelector('[role=status]');async function refresh(){clearTimeout(timeout);try{const r=await fetch('/sports-capture-api/jobs/'+id+'/preview',{credentials:'same-origin'});if(!r.ok)throw Error('Preview is not available yet.');const next=URL.createObjectURL(await r.blob());if(!d.open){URL.revokeObjectURL(next);return;}if(blob)URL.revokeObjectURL(blob);blob=next;img.src=blob;status.textContent='';}catch(e){status.textContent=e.message;}if(d.open)timeout=setTimeout(refresh,5000);}img.onclick=async e=>{const box=img.getBoundingClientRect();try{await api('jobs/'+id+'/click','POST',{x:(e.clientX-box.left)*img.naturalWidth/box.width,y:(e.clientY-box.top)*img.naturalHeight/box.height});await refresh();}catch(e){status.textContent=e.message;}};for(const b of d.querySelectorAll('[data-key]'))b.onclick=()=>api('jobs/'+id+'/key','POST',{key:b.dataset.key}).then(refresh).catch(e=>status.textContent=e.message);d.querySelector('[data-close]').onclick=()=>d.close();d.querySelector('[data-refresh]').onclick=refresh;d.addEventListener('close',()=>{clearTimeout(timeout);if(blob)URL.revokeObjectURL(blob);d.remove();if(preview===d)preview=null;},{once:true});await refresh();}
 async function settings(){
  const panel=$('#server-content');if(!panel)return;
  const section=document.createElement('section');
  section.className='native-panel';
  section.innerHTML='<p role="status">Checking capture service…</p>';panel.append(section);
  try{
   const data=await api('settings');if(!section.isConnected)return;
   const folderField=(name,label,value)=>'<div class="native-sports-folder"><label>'+label+'<input name="'+name+'" value="'+esc(value||'')+'" required></label><button class="subtle" type="button" data-browse="'+name+'" aria-label="Browse for '+label.toLowerCase()+'">Browse</button></div>';
   section.innerHTML='<div class="section-heading"><span class="native-badge">'+(data.connected?'Capture service connected':'Capture service offline')+'</span></div><form id="sports-recorder-settings"><fieldset><legend>Recording folders</legend>'+folderField('temporary','Temporary capture folder',data.temporaryDirectory)+folderField('folder','Finished recordings folder',data.recordingsDirectory)+'</fieldset><fieldset><legend>Recorder</legend><div class="native-form-grid"><label>Simultaneous games<input name="maxConcurrent" type="number" min="1" max="4" value="'+esc(data.maxConcurrent)+'" required></label><label>Video encoding<select name="encoder"><option value="auto">Automatic (prefer NVIDIA GPU)</option><option value="nvenc">NVIDIA GPU</option><option value="cpu">CPU</option></select></label></div>'+(data.encoderMessage?'<p class="count">'+esc(data.encoderMessage)+'</p>':'')+'</fieldset><button class="primary" type="submit">Save settings</button><p role="status">'+(data.needsApply?'Saved settings are waiting to be applied.':'')+'</p></form>';
   const form=section.querySelector('form'),status=form.querySelector('[role=status]');
   form.elements.encoder.value=data.encoder;form.dataset.pendingApply=String(!!data.needsApply);
   form.querySelectorAll('[data-browse]').forEach(button=>button.onclick=()=>browseLibraryFolder(folder=>{
     const input=form.elements[button.dataset.browse];
     input.value=folder;
     input.dispatchEvent(new Event('input',{bubbles:true}));
   }));
   bindForm(form,async()=>{status.textContent='Saving and applying settings…';await api('settings','POST',{recordingsDirectory:form.elements.folder.value.trim(),temporaryDirectory:form.elements.temporary.value.trim(),encoder:form.elements.encoder.value,maxConcurrent:Number(form.elements.maxConcurrent.value),apply:true});});
  }catch(e){section.querySelector('p').textContent=e.message;}
 }
 return {mount,cleanup,settings,watch,startSource,sourcePreview,api};
})();

globalThis.SportsCapture=SportsCapture;
