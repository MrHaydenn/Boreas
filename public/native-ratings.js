function nativeRatingsMarkup(metadata,series=false){
 const score=metadata?.voteCount>0&&Number.isFinite(metadata.voteAverage)?metadata.voteAverage:null;
 return '<div class="title-ratings rt-ratings native-title-ratings" id="native-title-ratings" aria-label="TMDB and Rotten Tomatoes ratings" '+(score===null?'hidden':'')+'><span class="rt-score" data-tmdb-rating '+(score===null?'hidden':'')+'><span aria-hidden="true">★</span> <strong data-tmdb-score>'+(score===null?'':score.toFixed(1)+' / 10')+'</strong> <small>TMDB</small></span><span class="rt-score" data-rt-critics hidden><span aria-hidden="true">🍅</span> <strong></strong> <small>'+(series?'Series critics':'Critics')+'</small></span><span class="rt-score" data-rt-audience hidden><span aria-hidden="true">🍿</span> <strong></strong> <small>'+(series?'Series audience':'Audience')+'</small></span></div>';
}
async function loadNativeTitleRatings(version,libraryId,id,kind='item'){
 const root=$('#native-title-ratings');
 if(!root)return;
 try{
   const data=await api('/ratings/'+libraryId+'/'+kind+'/'+id);
   if(version!==routeVersion||!root.isConnected)return;
   const tmdb=root.querySelector('[data-tmdb-rating]');
   if(Number.isFinite(data.tmdb?.score)){
     tmdb.querySelector('strong').textContent=data.tmdb.score.toFixed(1)+' / 10';
     tmdb.hidden=false;
   }
   for(const field of ['critics','audience']){
     const node=root.querySelector('[data-rt-'+field+']');
     node.hidden=!Number.isFinite(data[field]);
     if(node.hidden)continue;
     node.querySelector('strong').textContent=data[field]+'%';
     node.title='Rotten Tomatoes '+field+' score via MDBList';
     if(data.scope==='series')node.querySelector('small').textContent='Series '+field;
   }
   root.hidden=!root.querySelector('.rt-score:not([hidden])');
 }catch{}
}
async function loadNativeRatingsSettings(container){const section=document.createElement('section');section.className='settings-card';section.innerHTML='<h3>Rotten Tomatoes ratings</h3><p>Checking MDBList connection…</p>';container.append(section);try{const data=await api('/ratings/settings');if(!section.isConnected)return;section.innerHTML='<h3>Rotten Tomatoes ratings</h3><p>'+(data.configured?'MDBList is configured for critics and audience scores.':'Add an MDBList API key to load Rotten Tomatoes critics and audience scores.')+'</p>'+(data.environment?'<p>The connection is managed by the server environment.</p>':'<form><label>MDBList API key<input name="apiKey" type="password" autocomplete="new-password" required maxlength="256" placeholder="'+(data.configured?'Configured · enter a replacement key':'Enter an MDBList API key')+'"></label><button class="primary" type="submit">Save ratings connection</button><p role="status"></p></form>')+'<p class="count">The key stays on the Dev server. Scores are cached for 24 hours; only movie or series IDs are sent to MDBList. <a href="https://api.mdblist.com/docs/" target="_blank" rel="noopener">MDBList API documentation ↗</a></p>';const form=section.querySelector('form');if(form)bindForm(form,async()=>{await api('/ratings/settings',{method:'PATCH',body:{apiKey:form.elements.apiKey.value.trim()}});form.elements.apiKey.value='';toast('Ratings connection saved. Open a title to load its scores.');});}catch(e){if(section.isConnected)section.textContent=e.message;}}
