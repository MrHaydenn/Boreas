async function renderNativeTunerSettings(version){const root=$('#server-content');root.innerHTML='<section class="native-panel"><h2>HDHomeRun tuners</h2><p>Add your tuner by its local IPv4 address. Boreas will read its channel lineup.</p><form id="native-add-tuner"><label>Tuner IP address<input name="address" required placeholder="192.168.1.100"></label><label>Tuner port<input name="port" type="number" min="1" max="65535" step="1" placeholder="HDHomeRun defaults"></label><p class="count">A custom port is used for both lineup discovery and playback.</p><label>TV guide URL<input name="guideUrl" type="url" placeholder="https://example.com/guide.xml"></label><p class="count">Optional XMLTV feed. Matching channels show what’s on now and next.</p><button class="primary" type="submit">Add or refresh tuner</button><p role="status"></p></form><div id="native-tuner-list"></div></section>';const form=$('#native-add-tuner'),list=$('#native-tuner-list');let current=[];function draw(tuners){current=tuners;list.innerHTML=tuners.map(t=>'<article class="native-user-row"><div><strong>'+esc(t.name)+'</strong><small>'+esc(t.address+(t.port?':'+t.port:''))+' · '+(t.guideUrl?'Guide configured · ':'')+t.channels.length+' channels · '+t.count+' tuners</small></div><div class="actions"><button class="subtle" data-edit-tuner="'+esc(t.id)+'">Edit</button><button class="subtle" data-remove-tuner="'+esc(t.id)+'">Remove</button></div></article>').join('')||'<p class="count">No tuners configured.</p>';}bindForm(form,async()=>{const data=await api('/live-tv/tuners',{method:'POST',body:{address:form.elements.address.value,port:form.elements.port.value,guideUrl:form.elements.guideUrl.value}});if(version===routeVersion){draw(data.tuners);form.reset();}});list.onclick=async event=>{const edit=current.find(t=>t.id===event.target.closest('[data-edit-tuner]')?.dataset.editTuner);if(edit){form.elements.address.value=edit.address;form.elements.port.value=edit.port??'';form.elements.guideUrl.value=edit.guideUrl||'';form.elements.address.focus();return;}const id=event.target.closest('[data-remove-tuner]')?.dataset.removeTuner;if(id)try{const data=await api('/live-tv/tuners',{method:'DELETE',body:{id}});if(version===routeVersion)draw(data.tuners);}catch(e){toast(e.message);}};try{const data=await api('/live-tv/tuners');if(version===routeVersion)draw(data.tuners);}catch(e){if(version===routeVersion)list.textContent=e.message;}}
async function renderNativeStorage(version){
 const root=$('#server-content');
 root.innerHTML='<p role="status">Reading storage settings…</p>';
 try{
   const data=await api('/storage');
   if(version!==routeVersion||!root.isConnected)return;
   root.innerHTML='<section class="native-panel native-storage-settings"><label>Program folder<input readonly value="'+esc(data.program)+'"></label><label>Data folder<input readonly id="native-data-path" value="'+esc(data.data)+'"></label><button type="button" class="subtle" id="native-move-data">Move Data folder</button><p role="status"></p></section>';
   const button=root.querySelector('#native-move-data'),status=root.querySelector('[role=status]');
   function show(current){
     if(current?.state==='moving'){button.disabled=true;status.textContent='Moving Data. Boreas will restart automatically.';}
     else{button.disabled=false;status.textContent=current?.state==='failed'?current.message:current?.state==='complete'?'Data folder moved.':'';}
   }
   async function waitForMove(){
     while(version===routeVersion&&root.isConnected){
       await new Promise(resolve=>setTimeout(resolve,3000));
       if(version!==routeVersion||!root.isConnected)return;
       try{
         const latest=await api('/storage');
         root.querySelector('#native-data-path').value=latest.data;
         show(latest.move);
         if(latest.move?.state!=='moving')return;
       }catch{status.textContent='Waiting for Boreas to restart…';}
     }
   }
   show(data.move);
   if(data.move?.state==='moving')void waitForMove();
   button.onclick=()=>browseLibraryFolder(async folder=>{
     if(!await confirmAction('Move Data folder?','Boreas will create a Data folder inside the selected location. Playback will be interrupted during the move.'))return;
     button.disabled=true;
     try{const result=await api('/storage/move',{method:'POST',body:{folder}});show(result.move);void waitForMove();}
     catch(error){status.textContent=error.message;button.disabled=false;}
   });
 }catch(error){if(version===routeVersion&&root.isConnected)root.textContent=error.message;}
}

async function editNativeMarkers(target){const route='/libraries/'+target.libraryId+'/markers/'+target.id;try{const {markers}=await api(route),{dialog,body}=libraryDialog('Intro & credits markers');body.innerHTML='<form><p>Enter timestamps in seconds. Leave both fields blank to remove a marker.</p>'+['intro','credits'].map(type=>'<fieldset><legend>'+type+'</legend><div class="native-form-grid"><label>Start<input name="'+type+'Start" type="number" min="0" step=".1" value="'+(markers[type]?.start??'')+'"></label><label>End<input name="'+type+'End" type="number" min="0" step=".1" value="'+(markers[type]?.end??'')+'"></label></div></fieldset>').join('')+'<button class="primary" type="submit">Save markers</button><p role="status"></p></form>';bindForm(body.querySelector('form'),async form=>{const payload={};for(const type of ['intro','credits']){const start=form.elements[type+'Start'].value,end=form.elements[type+'End'].value;if((start==='')!==(end===''))throw Error('Enter both timestamps or leave both blank.');payload[type]=start===''?null:{start:Number(start),end:Number(end)};}await api(route,{method:'PATCH',body:payload});dialog.close();toast('Skip markers saved.');});}catch(e){toast(e.message);}}
