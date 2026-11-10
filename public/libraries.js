let libraryPoll,librarySearchTimer,libraryObserver;
function cleanupNativeLibraries(){libraryObserver?.disconnect();clearTimeout(libraryPoll);clearTimeout(librarySearchTimer);document.querySelector('.native-library-dialog')?.close();}
const libraryLabels={movies:'Movies',shows:'TV shows',anime:'Anime','home-videos':'Home videos',music:'Music'};
function libraryIcon(type){return navIcon(type==='movies'?'movie':type==='anime'?'anime':type==='music'?'discover':'tv');}
function fileSize(size){if(size<1024)return size+' B';if(size>=1024**3)return (size/1024**3).toFixed(1)+' GB';if(size>=1024**2)return (size/1024**2).toFixed(1)+' MB';return Math.round(size/1024)+' KB';}
async function refreshNativeLibraries(){const id=session?.id;if(!id)return [];const result=await api('/libraries');if(session?.id===id){const before=JSON.stringify(nativeLibraries.map(l=>[l.id,l.name,l.type,l.enabled,l.showOnHome]));nativeLibraries=result.libraries;if(before!==JSON.stringify(nativeLibraries.map(l=>[l.id,l.name,l.type,l.enabled,l.showOnHome])))buildNav();}return result.libraries;}
function libraryDialog(title){document.querySelector('.native-library-dialog')?.remove();const dialog=document.createElement('dialog');dialog.className='native-library-dialog';dialog.innerHTML='<div class="native-dialog-heading"><h2>'+esc(title)+'</h2><button class="subtle" aria-label="Close dialog">Close</button></div><div class="native-dialog-content"></div>';dialog.querySelector('button').onclick=()=>dialog.close();dialog.addEventListener('close',()=>dialog.remove(),{once:true});document.body.append(dialog);dialog.showModal();return {dialog,body:dialog.querySelector('.native-dialog-content')};}
async function renderServer(version,section){if(section==='overview')section='dashboard';if(section==='metadata')section='connections';const root=$('#settings-content');root.classList.add('native-server-layout');root.innerHTML='<nav class="native-server-nav" aria-label="Server management"><a href="#settings/server" '+(section==='dashboard'?'class="active" aria-current="page"':'')+'>'+navIcon('settings')+'<span>Dashboard</span></a>'+(session.role==='admin'?'<a href="#settings/server/libraries" '+(section==='libraries'?'class="active" aria-current="page"':'')+'>'+navIcon('movie')+'<span>Libraries</span></a><a href="#settings/server/connections" '+(section==='connections'?'class="active" aria-current="page"':'')+'>'+navIcon('settings')+'<span>Connections</span></a><a href="#settings/server/transcoder" '+(section==='transcoder'?'class="active" aria-current="page"':'')+'>'+navIcon('settings')+'<span>Transcoder</span></a><a href="#settings/server/users" '+(section==='users'?'class="active" aria-current="page"':'')+'>'+navIcon('profile')+'<span>Users</span></a><a href="#settings/server/media-analysis" '+(section==='media-analysis'?'class="active" aria-current="page"':'')+'>'+navIcon('settings')+'<span>Media analysis</span></a><a href="#settings/server/storage" '+(section==='storage'?'class="active" aria-current="page"':'')+'>'+navIcon('settings')+'<span>Storage</span></a><a href="#settings/server/live-tv" '+(section==='live-tv'?'class="active" aria-current="page"':'')+'>'+navIcon('live')+'<span>Live TV</span></a><a href="#settings/server/sports" '+(section==='sports'?'class="active" aria-current="page"':'')+'>'+navIcon('sports')+'<span>Sports capture</span></a>'+[['network','Networking'],['apps','Apps'],['updates','Updates']].map(([key,label])=>'<a href="#settings/server/'+key+'" '+(section===key?'class="active" aria-current="page"':'')+'>'+navIcon('settings')+'<span>'+label+'</span></a>').join(''):'')+'</nav><div id="server-content" class="native-server-content"></div>';if(section==='libraries'){if(session.role!=='admin'){$('#server-content').innerHTML=emptyPage('Administrator access required','Only administrators manage library folders.');return;}await renderLibraryManager(version,location.hash.split("/")[3]);}else if(section==='dashboard'&&session.role==='admin')await renderNativeDashboard(version);else if(section==='connections'&&session.role==='admin')await renderNativeConnections(version);else if(section==='transcoder'&&session.role==='admin')await renderTranscoderSettings(version);else if(section==='users'&&session.role==='admin')await renderUsers(version);else if(section==='sports'&&session.role==='admin')await SportsCapture.settings();else if(section==='live-tv'&&session.role==='admin')await renderNativeTunerSettings(version);else if(section==='media-analysis'&&session.role==='admin')await renderNativeMediaAnalysis(version);else if(section==='storage'&&session.role==='admin')await renderNativeStorage(version);else if(['network','apps','updates'].includes(section)&&session.role==='admin')await renderServerPreferences(version,section);else renderServerOverview();}
function scanLabel(library){const scan=library.scan||{};if(scan.state==='queued')return 'Queued for scanning';if(scan.state==='metadata')return 'Matching metadata · '+(scan.matched||0)+(scan.totalSeries?' / '+scan.totalSeries+' series':' movies');if(scan.state==='scanning')return 'Scanning · '+(scan.found||0)+' media files found';if(scan.state==='error')return 'Scan failed · '+(scan.message||'Check folder access and retry.');if(scan.state==='warning')return 'Scanned with '+(scan.warnings?.length||0)+' folder warning(s)';if(scan.completedAt)return 'Last scanned '+new Date(scan.completedAt).toLocaleString();return 'Not scanned yet';}
async function renderLibraryManager(version,selectedId){const target=$('#server-content');target.innerHTML='<section class="native-panel"><div class="section-heading"><div class="actions native-library-toolbar"><button class="subtle" id="rescan-all-libraries">Rescan all libraries</button><button class="primary" id="add-library">Add library</button></div></div><div id="native-library-list"><p role="status">Loading libraries…</p></div></section><section id="library-editor" hidden></section>';$('#add-library').onclick=()=>editLibrary(null,version);
 const rescan=$('#rescan-all-libraries');
 rescan.onclick=async()=>{
   rescan.disabled=true;
   try{const data=await api('/libraries/rescan',{method:'POST',body:{}});toast(data.queued+' libraries queued.'+(data.skipped?' '+data.skipped+' unavailable.':''));await load();}
   catch(error){toast(error.message);}
   finally{rescan.disabled=false;}
 };
 await load();
 async function load(){try{const libraries=await refreshNativeLibraries();if(version!==routeVersion)return;const list=$('#native-library-list');if(!list)return;if(selectedId){const selected=libraries.find(l=>l.id===selectedId);if(!selected){list.textContent='Library not found.';return;}list.closest('section').hidden=true;editLibrary(selected,version);return;}list.className='native-library-card-grid';list.innerHTML=libraries.length?libraries.map(l=>'<article class="native-library-admin-card"><a class="native-library-card-link" href="#settings/server/libraries/'+esc(l.id)+'"><span class="native-library-symbol">'+libraryIcon(l.type)+'</span><strong>'+esc(l.name)+'</strong><small>'+esc(libraryLabels[l.type])+' · '+l.itemCount+' files</small><small>'+esc(scanLabel(l))+'</small></a><div class="actions"><button class="subtle" data-scan="'+esc(l.id)+'" '+(['queued','scanning','metadata'].includes(l.scan?.state)?'disabled':'')+'>Rescan</button><a class="subtle" href="#settings/server/libraries/'+esc(l.id)+'">Settings</a></div></article>').join(''):'<div class="empty"><h3>No libraries yet</h3><p>Add your first media folder to start scanning.</p></div>';
 list.querySelectorAll('[data-scan]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{await api('/libraries/'+button.dataset.scan+'/scan',{method:'POST',body:{}});toast('Scan queued.');await load();}catch(error){toast(error.message);button.disabled=false;}});
 if(libraries.some(l=>['scanning','queued','metadata'].includes(l.scan?.state))){clearTimeout(libraryPoll);libraryPoll=setTimeout(()=>{if(version===routeVersion)load();},1500);}
 }catch(error){if(version===routeVersion&&$('#native-library-list'))$('#native-library-list').innerHTML='<p role="alert">'+esc(error.message)+'</p>';}}
}
function editLibrary(library,version){const target=$('#library-editor');target.hidden=false;target.className='native-panel';const value=library||{name:'',type:'movies',paths:[],recursive:true,ignoreHidden:true,includeExtras:false,enabled:true,showOnHome:true,searchable:true,scanOnStartup:false,autoScanMinutes:0,minFileSizeMB:0,sort:'title'};target.innerHTML='<div class="section-heading"><h2>'+(library?'Library settings':'Add a library')+'</h2><button class="subtle" id="cancel-library">Cancel</button></div><form id="library-form"><div class="native-form-grid"><label>Library name<input name="name" maxlength="80" value="'+esc(value.name)+'" placeholder="For example: Movies" required></label><label>Library type<select name="type">'+Object.entries(libraryLabels).map(([key,label])=>'<option value="'+key+'" '+(value.type===key?'selected':'')+'>'+label+'</option>').join('')+'</select></label></div><fieldset class="native-library-options"><legend>Folders on this server</legend><input type="hidden" name="paths" value="'+esc(JSON.stringify(value.paths))+'"><div id="library-folder-list"></div><button type="button" class="subtle" id="browse-library-folder">Add folder</button></fieldset><fieldset class="native-library-options"><legend>Scan options</legend>'+[['recursive','Include subfolders'],['ignoreHidden','Ignore names starting with a dot or $'],['includeExtras','Include extras, samples, and trailers'],['scanOnStartup','Rescan when this server starts'],['watchChanges','Scan when files or folders change']].map(([name,label])=>'<label class="check"><input type="checkbox" name="'+name+'" '+(value[name]?'checked':'')+'> '+label+'</label>').join('')+'</fieldset><fieldset class="native-library-options"><legend>Metadata</legend><label class="check"><input type="checkbox" name="metadataEnabled" '+(value.metadataEnabled!==false?'checked':'')+'> Use online metadata</label><label>Metadata provider<select name="metadataProvider"><option value="tmdb">TMDB</option></select></label><p class="count">TMDB provides matching, descriptions, and artwork. Local artwork remains available.</p></fieldset>'+nativeLanguageFields(value.playbackPreferences)+'<fieldset class="native-library-options"><legend>Visibility</legend><label class="check"><input type="checkbox" name="enabled" '+(value.enabled?'checked':'')+'> Available to signed-in members</label><label class="check"><input type="checkbox" name="showOnHome" '+(value.showOnHome?'checked':'')+'> Pin to navigation and show on Home</label><label class="check"><input type="checkbox" name="searchable" '+(value.searchable!==false?'checked':'')+'> Include this library in global search</label></fieldset><button class="primary" type="submit">'+(library?'Save settings':'Create and scan library')+'</button><p role="status"></p></form>';
 const form=$('#library-form'),paths=[...value.paths],folders=$('#library-folder-list');
 function renderFolders(){
   form.elements.paths.value=JSON.stringify(paths);
   folders.innerHTML=paths.length?paths.map((folder,index)=>'<div class="native-library-folder"><span>'+esc(folder)+'</span><button type="button" class="subtle" data-remove-folder="'+index+'" aria-label="Remove '+esc(folder)+'">Remove</button></div>').join(''):'<p class="count">No folders added.</p>';
   folders.querySelectorAll('[data-remove-folder]').forEach(button=>button.onclick=()=>{paths.splice(Number(button.dataset.removeFolder),1);renderFolders();form.elements.paths.dispatchEvent(new Event('input',{bubbles:true}));});
 }
 renderFolders();
 $('#cancel-library').onclick=()=>{if(library)location.hash='settings/server/libraries';else{target.hidden=true;target.replaceChildren();}};
 $('#browse-library-folder').onclick=()=>browseLibraryFolder(folder=>{if(!paths.includes(folder)){paths.push(folder);renderFolders();form.elements.paths.dispatchEvent(new Event('input',{bubbles:true}));}});
 const syncMetadata=()=>{form.elements.metadataProvider.disabled=!form.elements.metadataEnabled.checked;};
 form.elements.metadataEnabled.addEventListener('change',syncMetadata);syncMetadata();
 if(library){
   const actions=document.createElement('div');actions.className='actions';
   actions.innerHTML='<a class="subtle" href="#library/'+esc(library.id)+'">Browse library</a><button class="subtle native-danger" type="button">Remove library</button>';
   actions.querySelector('button').onclick=async()=>{
     if(!await confirmAction('Remove '+library.name+'?','Remove this library from Boreas? Media files and folders will remain untouched.'))return;
     try{await api('/libraries/'+library.id,{method:'DELETE'});toast('Library removed.');location.hash='settings/server/libraries';}catch(error){toast(error.message);}
   };
   target.append(actions);
 }
 bindForm(form,async()=>{
   if(!paths.length)throw Error('Add at least one folder.');
   const body={playbackPreferences:readNativeLanguages(form),name:form.elements.name.value,type:form.elements.type.value,paths,metadataProvider:form.elements.metadataProvider.value};
   for(const name of ['recursive','ignoreHidden','includeExtras','enabled','showOnHome','searchable','scanOnStartup','watchChanges','metadataEnabled'])body[name]=form.elements[name].checked;
   await api('/libraries'+(library?'/'+library.id:''),{method:library?'PATCH':'POST',body});toast('Library saved. Scan queued.');
   if(version===routeVersion){if(library)location.hash='settings/server/libraries';else await render();}
 });target.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});form.elements.name.focus({preventScroll:true});
}
async function browseLibraryFolder(select){const {dialog,body}=libraryDialog('Choose a folder on the server');let revision=0;body.innerHTML='<form id="folder-path-form"><label>Server folder path<input name="path" placeholder="D:\Media or \\server\share" autocomplete="off"></label><button class="subtle">Open path</button></form><div id="folder-browser"></div>';const form=body.querySelector('form'),browser=body.querySelector('#folder-browser');form.onsubmit=event=>{event.preventDefault();load(form.elements.path.value);};await load('');
 async function load(folder){const current=++revision;browser.innerHTML='<p role="status">Reading folders…</p>';try{const data=await api('/filesystem?path='+encodeURIComponent(folder));if(current!==revision||!dialog.open)return;form.elements.path.value=data.path;browser.innerHTML='<div class="native-folder-toolbar"><button class="subtle" data-drives>Drives</button>'+(data.parent?'<button class="subtle" data-parent>Up one folder</button>':'')+(data.path?'<button class="primary" data-select>Use this folder</button>':'')+'</div><p class="count">'+esc(data.path||'Choose a server drive, or enter a network share above.')+'</p><div class="native-folder-list">'+(data.folders.map((entry,i)=>'<button class="subtle" data-folder="'+i+'">'+navIcon('tv')+'<span>'+esc(entry.name)+'</span><span>›</span></button>').join('')||'<p class="count">No subfolders.</p>')+'</div>';browser.querySelector('[data-drives]').onclick=()=>load('');browser.querySelector('[data-parent]')?.addEventListener('click',()=>load(data.parent));browser.querySelector('[data-select]')?.addEventListener('click',()=>{select(data.path);dialog.close();});browser.querySelectorAll('[data-folder]').forEach(button=>button.onclick=()=>load(data.folders[Number(button.dataset.folder)].path));}catch(error){if(current===revision)browser.innerHTML='<p role="alert">'+esc(error.message)+'</p>';}}
}
function nativePinnedLibraries(){return nativeOrderedLibraries().pinned;}
function nativePlaybackBadge(item){const p=item.playback;return p?.completed?'<span class="watched" aria-label="Watched">✓</span>':p?.duration&&p.position>0?'<div class="progress"><span style="width:'+Math.min(100,100*p.position/p.duration)+'%"></span></div>':'';}
function nativeHomeCard(item,library,index){const episode=!!item.seriesId&&item.kind!=='series',href=item.kind==='series'?'#library/'+library.id+'?series='+item.id:episode?'#library/'+library.id+'?'+new URLSearchParams({series:item.seriesId,season:item.season??'unknown',episode:item.id}):library.type==='movies'?'#movie/'+library.id+'/'+item.id:library.type==='home-videos'?'#watch/'+library.id+'/'+item.id:'#library/'+library.id,art=episode?item.metadata?.seriesPoster||item.artwork:item.artwork,title=episode?item.series:item.title,subtitle=episode?[(item.recommendation==='next'?'Next up':item.recommendation==='resume'?'Resume':''),item.season!==null?'S'+item.season:'',item.episode!==null?'E'+item.episode:'',item.title].filter(Boolean).join(' · '):[item.year,item.recommendation==='next'?'Next up':item.recommendation==='resume'?'Resume':item.kind==='series'?item.itemCount+' episodes':''].filter(Boolean).join(' · ');return '<a class="card'+(library.type==='home-videos'?' native-landscape-card':'')+'" data-home-item="'+index+'" href="'+href+'"><div class="poster"><img '+(!art?'class="native-art-fallback" ':'')+'src="'+esc(art||'/branding/lumen-wolf.png')+'" alt="" loading="lazy">'+nativePlaybackBadge(item)+'</div><span class="card-title">'+esc(title)+'</span><span class="card-sub">'+esc(subtitle)+'</span></a>';}

async function renderNativeLibraryHome(version,libraryScope=null){
 const libraries=libraryScope?[libraryScope]:nativePinnedLibraries(),main=$('#main');
 const compact=libraryScope?.type==='home-videos';
 if(!libraries.length){main.innerHTML=emptyPage('Your home is ready','Pin a library in server library settings to show its recently added titles here.',session.role==='admin'?'<a class="primary" href="#settings/server/libraries">Manage libraries</a>':'');return;}
 main.innerHTML='<section id="native-home-feature" class="web-home-hero" aria-label="Featured title"></section><div id="home-rows"'+(compact?' class="native-compact-shelves"':'')+'><section data-row-kind="personal" id="native-continue-row" hidden></section><p role="status">Loading your libraries…</p></div>';
 const shelves=[];
 let partial=false;
 if(libraryScope){
   try{
     const data=await api('/libraries/'+libraryScope.id+'/recommended');
     shelves.push(...data.rows.map(row=>({...row,library:libraryScope})));
   }catch(error){if(version===routeVersion)main.innerHTML=emptyPage('Could not load recommendations',error.message);return;}
 }else{
   const historyRequest=api('/playback/home').catch(()=>({items:[]}));
   const results=await Promise.allSettled(libraries.map(async library=>{
     const {items}=await api('/libraries/'+library.id+'/items?sort=added&limit=18&view='+(['shows','anime'].includes(library.type)?'series':'items'));
     return {kind:'recent',title:'Recently Added in '+library.name,library,items};
   }));
   const history=await historyRequest;
   shelves.push({kind:'personal',title:'Continue Watching',items:history.items});
   shelves.push(...results.filter(result=>result.status==='fulfilled').map(result=>result.value));
   partial=results.some(result=>result.status==='rejected');
 }
 if(version!==routeVersion)return;
 const cards=[];
 const html=shelves.map(shelf=>{
   const content=shelf.items.map(item=>{
     const library=shelf.library||libraries.find(l=>l.id===item.libraryId);
     if(!library)return '';
     const index=cards.length;
     cards.push({item,library,personal:shelf.kind==='personal'});
     return nativeHomeCard(item,library,index);
   }).join('');
   if(!content)return '';
   return '<div data-row-kind="'+esc(shelf.kind)+'"'+(shelf.library?' data-library-id="'+esc(shelf.library.id)+'"':'')+'><section class="section"><div class="section-heading"><h2>'+esc(shelf.title)+'</h2><div class="row-controls"><button data-home-scroll="-1" aria-label="Scroll '+esc(shelf.title)+' left">‹</button><button data-home-scroll="1" aria-label="Scroll '+esc(shelf.title)+' right">›</button></div></div><div class="poster-row">'+content+'</div></section></div>';
 }).join('');
 $('#home-rows').innerHTML=html+(cards.length?'':emptyPage('Your home is ready','Scan your pinned libraries to see recently added media.'));
 const feature=$('#native-home-feature');feature.hidden=!cards.length;
 function select({item,library}){const m=item.metadata?.state==='matched'||item.metadata?.seriesMatched?item.metadata:null;NativeAtmosphere.show(nativeBackdrop(item));feature.innerHTML='<div class="web-hero-copy">'+(m?.logo?'<img class="web-hero-logo" src="'+esc(m.logo)+'" alt="'+esc(item.title)+'">':'')+(item.seriesId&&item.kind!=='series'?'<p class="web-hero-series">'+esc(item.series)+'</p>':'')+'<h1><a href="'+(item.kind==='series'?'#library/'+library.id+'?series='+item.id:item.seriesId?'#library/'+library.id+'?series='+item.seriesId:library.type==='home-videos'?'#watch/'+library.id+'/'+item.id:'#movie/'+library.id+'/'+item.id)+'">'+esc(item.title)+'</a></h1><p class="web-hero-meta">'+esc([item.year,m?.runtime?m.runtime+' min':'',m?.rating].filter(Boolean).join(' · '))+'</p><p class="web-hero-description">'+esc(m?.overview||'Explore this title in your library.')+'</p></div>';const logo=feature.querySelector('.web-hero-logo'),label=feature.querySelector('.web-hero-series');if(logo){const loaded=()=>{if(label)label.hidden=true;};logo.onload=loaded;logo.onerror=()=>{logo.hidden=true;if(label)label.hidden=false;};if(logo.complete&&logo.naturalWidth>0)loaded();}}
 if(cards.length)select(cards[0]);main.querySelectorAll('[data-home-item]').forEach(card=>{const entry=cards[Number(card.dataset.homeItem)];bindNativeContext(card,{...nativeMediaTarget(entry.library.id,entry.item),continueWatching:entry.personal});const show=()=>select(cards[Number(card.dataset.homeItem)]);card.onfocus=show;card.onpointerenter=show;if(entry.library.type==='home-videos')card.onclick=event=>{if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();NativePlayer.open(entry.library.id,entry.item.id);};});main.querySelectorAll('[data-home-scroll]').forEach(button=>button.onclick=()=>{const row=button.closest('.section').querySelector('.poster-row');row.scrollBy({left:Number(button.dataset.homeScroll)*row.clientWidth*.8,behavior:document.body.classList.contains('reduce-motion')||matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});});main.querySelectorAll('#home-rows img').forEach(img=>bindNativeThumbnailFallback(img));setupNativeHomeRows(main,cards,select,{compact});if(partial)toast('Some home sections could not load. Your other libraries are still available.');
}

async function renderNativeLibrary(version,route){
 const id=route.slice(8).split('?')[0],params=new URLSearchParams(route.split('?')[1]||''),series=params.get('series')||'',main=$('#main');let library=nativeLibraries.find(l=>l.id===id);if(!library){await refreshNativeLibraries();library=nativeLibraries.find(l=>l.id===id);}if(version!==routeVersion)return;if(!library){main.innerHTML=emptyPage('Library unavailable','This library was removed or is not available to your account.');return;}
 if(series&&['shows','anime'].includes(library.type)){await renderNativeSeries(version,id,series,params);return;}
 const browse=params.get('tab')==='browse',folders=library.type==='home-videos',folder=folders?params.get('folder')||'':'';
 const base='#library/'+id;
 const browseURL=value=>base+'?'+new URLSearchParams({tab:'browse',...(value?{folder:value}:{})});
 const nav=$('#home-navigation');
 nav.innerHTML='<a href="'+base+'" '+(!browse?'class="active" aria-current="page"':'')+'>Recommended</a><a href="'+browseURL('')+'" '+(browse?'class="active" aria-current="page"':'')+'>Browse</a>';
 nav.dataset.section='library';nav.setAttribute('aria-label',library.name+' sections');nav.hidden=false;syncNativeBack(route);
 document.body.classList.add('has-home-tabs');
 if(!browse){document.body.classList.add('web-home');await renderNativeLibraryHome(version,library);return;}
 main.innerHTML=(folder?'<div class="native-folder-crumb">'+esc(folder.replaceAll('/',' › '))+'</div>':'')+
   '<p id="catalog-status" class="count" role="status"></p><div id="native-catalog" class="grid'+(folders?' native-landscape-grid':'')+'"></div><div class="page-sentinel"><button class="subtle load-more" id="catalog-more" hidden>Load more</button></div>';
 if(!folders)main.insertAdjacentHTML('beforeend','<nav class="library-alphabet" aria-label="Jump to title letter">'+['All','#',...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map(letter=>'<button type="button" data-letter="'+letter+'" aria-label="'+(letter==='All'?'All titles':'Jump to '+letter)+'" '+(letter==='All'?'aria-current="true"':'')+'>'+letter+'</button>').join('')+'</nav>');
 let next=0,busy=false,request=0,jump='';
 const grid=$('#native-catalog'),status=$('#catalog-status'),more=$('#catalog-more');
 async function load(append=false){
   const current=++request;busy=true;more.disabled=true;status.textContent='Loading…';
   try{
     const query=new URLSearchParams({view:['shows','anime'].includes(library.type)?'series':'items',jump:append?'':jump,sort:'title',offset:append?String(next):'0',limit:'60'});
     if(folders)query.set('folder',folder);
     const data=await api('/libraries/'+id+'/items?'+query);
     if(current!==request||version!==routeVersion)return;
     if(jump&&!append&&!data.jumpFound){status.textContent='No titles beginning with '+jump+'.';return;}
     const cards=data.items.map(item=>{
       const card=document.createElement('a');card.className='card unified-card'+(folders?' native-landscape-card':'');
       card.href=item.kind==='folder'?browseURL(item.folder):item.kind==='series'?base+'?series='+item.id:library.type==='movies'?'#movie/'+id+'/'+item.id:'#watch/'+id+'/'+item.id;
       card.innerHTML='<div class="poster">'+(item.kind==='folder'?'<span class="native-folder-art" aria-hidden="true">📁</span>':'<img '+(!item.artwork?'class="native-art-fallback" ':'')+'src="'+esc(item.artwork||'/branding/lumen-wolf.png')+'" alt="" loading="lazy">'+nativePlaybackBadge(item))+'</div><span class="card-title">'+esc(item.title)+'</span>'+(item.kind==='series'?'<span class="card-sub">'+item.itemCount+' episodes</span>':item.year?'<span class="card-sub">'+esc(item.year)+'</span>':'');
       if(item.kind!=='folder'){
         bindNativeContext(card,nativeMediaTarget(id,item));
         if(folders)card.onclick=event=>{if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();NativePlayer.open(id,item.id);};
         card.onpointerenter=card.onfocus=()=>NativeAtmosphere.select(nativeBackdrop(item));
         const image=card.querySelector('img:not(.native-art-fallback)');if(image)bindNativeThumbnailFallback(image);
       }
       return card;
     });
     if(!append)grid.replaceChildren();
     if(cards.length)grid.append(...cards);
     else if(!append)grid.innerHTML=emptyPage(folders?'No videos in this folder':'No titles match','');
     status.textContent='';next=data.next;more.hidden=next===null;
     if(!append)NativeAtmosphere.show(nativeBackdrop(data.items.find(item=>item.kind!=='folder')));
   }catch(error){if(version===routeVersion&&current===request)status.textContent=error.message;}
   finally{if(version===routeVersion&&current===request){busy=false;more.disabled=false;}}
 }
 main.querySelectorAll('[data-letter]').forEach(button=>button.onclick=()=>{
   jump=button.dataset.letter==='All'?'':button.dataset.letter;
   main.querySelectorAll('[data-letter]').forEach(letter=>{if(letter===button)letter.setAttribute('aria-current','true');else letter.removeAttribute('aria-current');});
   window.scrollTo({top:0,behavior:'instant'});void load();
 });
 more.onclick=()=>{if(!busy&&next!==null)void load(true);};
 libraryObserver=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)&&!busy&&next!==null&&version===routeVersion)void load(true);},{rootMargin:'400px'});
 libraryObserver.observe(more);await load();
}

async function showNativeFile(libraryId,itemId){try{const result=await api('/libraries/'+libraryId+'/item/'+itemId),item=result.item,{body}=libraryDialog(item.title);body.innerHTML='<div class="native-file-detail">'+(item.artwork?'<img src="'+esc(item.artwork)+'" alt="">':'<img src="/branding/lumen-wolf.png" alt="">')+'<div><p class="count">Detected from your local files</p><dl class="native-details"><dt>Filename</dt><dd>'+esc(item.fileName)+'</dd><dt>Relative path</dt><dd>'+esc(item.relativePath)+'</dd>'+(item.path?'<dt>Server path</dt><dd>'+esc(item.path)+'</dd>':'')+(item.series?'<dt>Series</dt><dd>'+esc(item.series)+'</dd>':'')+(item.season!==null?'<dt>Season / episode</dt><dd>'+esc('Season '+item.season+' · Episode '+(item.episode??'Unknown')+(item.episodeEnd?'–'+item.episodeEnd:''))+'</dd>':'')+'<dt>File type</dt><dd>'+esc(item.extension.toUpperCase())+'</dd><dt>File size</dt><dd>'+fileSize(item.size)+'</dd><dt>Modified</dt><dd>'+esc(new Date(item.modifiedAt).toLocaleString())+'</dd><dt>Subtitle files</dt><dd>'+esc(item.subtitles.map(s=>s.name).join(', ')||'None found')+'</dd></dl><p class="count">Original files are unchanged. Playback, codec probing, and online metadata are not connected yet.</p></div></div>';}catch(error){toast(error.message);}}

async function renderServerPreferences(version,section){
 const root=$('#server-content');
 if(section==='updates'){
   await renderUpdateSettings(version,root);return;
 }
 root.innerHTML='<p role="status">Loading settings…</p>';
 try{
   const data=await api('/server/'+section);
   if(version!==routeVersion||!root.isConnected)return;
   const fields=section==='network'
     ?'<label>Allowed public URL<input name="publicOrigin" type="url" placeholder="https://boreas.example.com" value="'+esc(data.publicOrigin)+'"></label><p class="count">Use the HTTPS address served by your reverse proxy. Leave blank for local access only.</p>'
     :[['sports','Sports'],['liveTV','Live TV']].map(([key,label])=>'<label class="check"><input name="'+key+'" type="checkbox" '+(data[key]?'checked':'')+'> '+label+'</label>').join('');
   root.innerHTML='<section class="native-panel"><form id="server-preferences">'+fields+'<button class="primary" type="submit">Save settings</button><p role="status"></p></form></section>';
   bindForm(root.querySelector('form'),async form=>{
     const body=section==='network'?{publicOrigin:form.elements.publicOrigin.value}:{sports:form.elements.sports.checked,liveTV:form.elements.liveTV.checked};
     if(section==='network'&&location.origin===data.publicOrigin&&body.publicOrigin!==data.publicOrigin){
       throw Error('Open Boreas using its local address to change this URL.');
     }
     const result=await api('/server/'+section,{method:'PATCH',body});
     if(section==='network')form.elements.publicOrigin.value=result.publicOrigin;
     else{nativeServerApps=result;buildNav();}
   });
 }catch(error){if(version===routeVersion&&root.isConnected)root.textContent=error.message;}
}

async function renderUpdateSettings(version,root){
 root.innerHTML='<p role="status">Loading update settings…</p>';
 try{
   const data=await api('/server/updates');
   if(version!==routeVersion||!root.isConnected)return;
   root.innerHTML='<section class="native-panel"><form id="update-channel"><label>Update channel<select name="channel"><option value="stable">Stable</option><option value="experimental">Experimental</option></select></label><p class="count">Stable checks published releases. Experimental also checks new commits on the default branch.</p><button type="submit" class="primary">Save settings</button><p role="status"></p></form><div class="actions"><button type="button" class="subtle" id="check-boreas-update">Check for updates</button><a class="primary" id="get-boreas-update" target="_blank" rel="noopener" hidden>Update</a></div><p class="count" id="boreas-update-status" role="status"></p></section>';
   const form=root.querySelector('#update-channel'),button=root.querySelector('#check-boreas-update'),link=root.querySelector('#get-boreas-update'),status=root.querySelector('#boreas-update-status');
   form.elements.channel.value=data.channel;
   async function check(){
     button.disabled=true;link.hidden=true;status.textContent='Checking GitHub…';
     try{
       const result=await api('/server/updates/check');
       if(!root.isConnected||version!==routeVersion)return;
       status.textContent=result.update
         ?(result.update.kind==='commit'&&!result.update.installerReady?'New commit '+result.update.label+' · installer pending':'Update available · '+result.update.label)
         :'No newer update found · installed '+result.version;
       if(result.update){link.href=result.update.url;link.hidden=false;}
     }catch(error){status.textContent=error.message;}
     finally{button.disabled=false;}
   }
   button.onclick=()=>void check();
   bindForm(form,async()=>{await api('/server/updates',{method:'PATCH',body:{channel:form.elements.channel.value}});await check();});
   void check();
 }catch(error){if(version===routeVersion&&root.isConnected)root.textContent=error.message;}
}
