'use strict';
const $=selector=>document.querySelector(selector),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let nativeLibraries=[],nativeServerApps={sports:true,liveTV:true};let session=null,csrf='',serverId='',routeVersion=0,toastTimer,searchTimer;
async function api(route,{method='GET',body}={}){const response=await fetch('/api'+route,{method,credentials:'same-origin',headers:{...(body?{'Content-Type':'application/json'}:{}),...(method!=='GET'&&csrf?{'X-Lumen-CSRF':csrf}:{})},...(body?{body:JSON.stringify(body)}:{})});let data;try{data=await response.json();}catch{throw Error('The server is not responding. Try again.');}if(!response.ok){if(response.status===401&&session){session=null;csrf='';await start();}throw Error(data.error||'The request could not be completed.');}return data;}
function toast(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,4500);}
function activateNativeSession(data){session=data.user;nativeAccountContext=data;$('#switch-native-profile').hidden=(data.profiles?.length||0)<2;csrf=data.csrfToken;const entering=session.id;nativeMoreLibraries=false;nativeLibraries=[];$('#welcome').hidden=true;$('#app').hidden=false;$('#account').innerHTML=nativeAvatar(session);$('#account').setAttribute('aria-label',session.displayName+': profile menu');$('#profile-name').textContent=session.displayName;$('#sidebar-user-name').textContent=session.displayName;$('#sidebar-user-name').title=session.displayName;applyAppearance();buildNav();$('#main').innerHTML='<p class="count" role="status">Loading your libraries…</p>';const loaded=beginBoreasLoad();void refreshNativeLibraries().then(()=>{if(session?.id===entering)return render();}).catch(error=>{if(session?.id===entering){$('#main').innerHTML=emptyPage('Unable to load your libraries',error.message,'<button class="subtle" id="retry-libraries">Try again</button>');$('#retry-libraries').onclick=start;}}).finally(loaded);}

function showAuth(status){cleanupNativeHomeRows();nativeStartupComplete=false;closeNativeItemMenu();cleanupSports();cleanupLiveTV();routeVersion++;NativePlayer.stop();NativeAtmosphere.clear();session=null;csrf='';$('#app').hidden=true;$('#welcome').hidden=false;const setup=status.setupRequired;document.title=setup?'Set up Boreas':'Sign in · Boreas';if(setup&&!status.setupAllowed){$('#auth-panel').innerHTML='<div class="eyebrow">FIRST-RUN SETUP</div><h2>Start on your server PC</h2><p>Create the first administrator at <strong>http://localhost:5180</strong> on the PC running Boreas. You can sign in here afterward.</p><button class="primary" id="check-setup">Check again</button>';$('#check-setup').onclick=start;return;}
 $('#auth-panel').innerHTML='<h2>'+(setup?'Create your administrator':'Sign in')+'</h2><form id="auth-form">'+'<label>Username<input name="username" autocomplete="username" minlength="3" maxlength="32" '+(setup?'pattern="[a-zA-Z0-9][a-zA-Z0-9_.-]{2,31}"':'')+' required></label><label>Password<input name="password" type="password" autocomplete="'+(setup?'new-password':'current-password')+'" '+(setup?'minlength="12"':'')+' maxlength="256" required></label>'+(setup?'<label>Confirm password<input name="confirmation" type="password" autocomplete="new-password" minlength="12" maxlength="256" required></label><p class="count">Use at least 12 characters.</p>':'')+'<button class="primary" type="submit">'+(setup?'Create administrator':'Sign in')+'</button><p class="form-error" role="alert"></p></form>';
 const form=$('#auth-form');form.elements.username.focus();form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('button'),error=form.querySelector('[role=alert]');error.textContent='';if(setup&&form.elements.password.value!==form.elements.confirmation.value){error.textContent='The passwords do not match.';return;}button.disabled=true;try{const body={username:form.elements.username.value,password:form.elements.password.value};if(!setup)body.remember='persistent';const data=await api(setup?'/setup':'/login',{method:'POST',body});form.reset();useSession(data);}catch(e){error.textContent=e.message;form.elements.password.value='';if(form.elements.confirmation)form.elements.confirmation.value='';}finally{button.disabled=false;}};
}
async function start(){const done=beginBoreasLoad();try{const status=await api('/status');serverId=status.serverId;nativeServerApps=status.apps||nativeServerApps;if(status.user){
 const restore=performance.getEntriesByType('navigation')[0]?.type==='reload';
 if(!restore&&!nativeStartupComplete&&status.savedAccounts?.length&&localStorage.getItem(accountChooserKey())==='yes')showBrowserAccounts(status);
 else useSession(status,{restore});
 }else showAuth(status);}catch(error){$('#app').hidden=true;$('#welcome').hidden=false;$('#auth-panel').innerHTML='<h2>Unable to connect</h2><p role="alert">'+esc(error.message)+'</p><button class="primary" id="retry-connect">Try again</button>';$('#retry-connect').onclick=start;}finally{done();}}
function buildNav(){buildNativeLibraryNav();}

function settingsTabs(selected){return [['account','Account'],['client','Client'],['server','Server']].map(([key,label])=>'<a href="#settings/'+key+'" '+(selected===key?'class="active" aria-current="page"':'')+'>'+label+'</a>').join('');}
function pageHeading(title,subtitle=''){return '<div class="native-page-heading"><div class="eyebrow">BOREAS</div><h1>'+esc(title)+'</h1>'+(subtitle?'<p class="count">'+esc(subtitle)+'</p>':'')+'</div>';}
function emptyPage(title,description,action=''){return '<section class="native-empty"><img src="/branding/lumen-wolf.png" alt=""><h2>'+esc(title)+'</h2><p>'+esc(description)+'</p>'+action+'</section>';}
let nativeBackDepth=history.state?.lumenDepth||0;
history.replaceState({...history.state,lumenDepth:nativeBackDepth},'');
function nativeBackFallback(route){
 const [section,library]=route.split('?')[0].split('/');
 if(section==='movie'||section==='episode')return '#library/'+library;
 if(section==='library'){
   const params=new URLSearchParams(route.split('?')[1]||'');
   if(params.has('episode')){params.delete('episode');return '#library/'+library+'?'+params;}
   if(params.has('season')){params.delete('season');return '#library/'+library+'?'+params;}
   if(params.has('folder')){
     const parent=params.get('folder').split('/').slice(0,-1).join('/');
     if(parent)params.set('folder',parent);else params.delete('folder');
     return '#library/'+library+'?'+params;
   }
   return '#library/'+library;
 }
 if(section==='discover')return '#discover';
 if(section==='sports')return route.split('?')[0].split('/').length>2?'#sports/'+library:library?'#sports':'#home';
 if(section==='live-tv')return '#live-tv';
 return '#home';
}
function syncNativeBack(route){
 const nav=$('#home-navigation');
 nav.querySelector('.native-top-back')?.remove();
 const [section,...parts]=route.split('?')[0].split('/');
 const params=new URLSearchParams(route.split('?')[1]||'');
 const nested=['movie','episode','search','settings'].includes(section)||
   (section==='library'&&(params.has('series')||params.has('folder')))||
   ((section==='discover'||section==='live-tv')&&parts.length>0)||
   section==='sports';
 if(!nested)return;
 const button=document.createElement('button');
 button.type='button';button.className='native-top-back';button.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12H4m7-7-7 7 7 7"/></svg>';button.setAttribute('aria-label','Go back');
 button.onclick=()=>{if(nativeBackDepth>0)history.back();else location.replace(nativeBackFallback(route));};
 nav.prepend(button);nav.hidden=false;document.body.classList.add('has-home-tabs');
}
const boreasLoads=new Set();
let boreasLoadTimer;
function beginBoreasLoad(){
 const token=Symbol(),overlay=$('#boreas-loading');
 if(!boreasLoads.size)boreasLoadTimer=setTimeout(()=>{
   overlay.classList.add('is-loading');overlay.setAttribute('aria-hidden','false');
 },140);
 boreasLoads.add(token);
 return ()=>{
   boreasLoads.delete(token);
   if(boreasLoads.size)return;
   clearTimeout(boreasLoadTimer);overlay.classList.remove('is-loading');overlay.setAttribute('aria-hidden','true');
 };
}
async function render(){
 if(!session)return;
 if(trySportsTransition(location.hash.slice(1))){syncNativeBack(location.hash.slice(1));return;}
 const done=location.hash.startsWith('#watch/')?()=>{}:beginBoreasLoad();
 try{await renderRoute();}finally{done();}
}
async function renderRoute(){cleanupNativeHomeRows();closeNativeItemMenu();await Promise.race([NativePlayer.stop(),new Promise(resolve=>setTimeout(resolve,350))]);cleanupSports();cleanupLiveTV();NativeAtmosphere.clear();cleanupNativeLibraries();const version=++routeVersion,route=location.hash.slice(1)||'home',tab=route.split('?')[0],home=['home','discover','calendar'].includes(tab);$('#profile-menu').hidden=true;$('#account').setAttribute('aria-expanded','false');document.body.classList.toggle('has-home-tabs',home);document.body.classList.toggle('web-home',tab==='home'||tab==='discover');const sports=tab==='sports'||tab.startsWith('sports/'),topNav=$('#home-navigation');
if(!topNav.dataset.homeLinks)topNav.dataset.homeLinks=topNav.innerHTML;
const links=sports?sportsTabLinks():topNav.dataset.homeLinks;
if(topNav.innerHTML!==links)topNav.innerHTML=links;
topNav.dataset.section=sports?'sports':'home';
topNav.setAttribute('aria-label',sports?'Sports sections':'Home sections');
topNav.hidden=!home&&!sports;
if(!home&&!sports){
 const [section,library]=tab.split('/');
 if(section==='movie'||section==='library'&&new URLSearchParams(route.split('?')[1]||'').has('series')){
   const base='#library/'+library;
   topNav.innerHTML='<a href="'+esc(base)+'">Recommended</a><a href="'+esc(base+'?tab=browse')+'">Browse</a>';
   topNav.setAttribute('aria-label','Library sections');
 }else if(section==='settings'){
   topNav.innerHTML=settingsTabs(library);topNav.setAttribute('aria-label','Settings sections');
 }else if(section==='discover'){
   topNav.setAttribute('aria-label','Home sections');
 }else topNav.replaceChildren();
}
syncNativeBack(route);
if(sports)document.body.classList.add('has-home-tabs');$('#home-navigation').querySelectorAll('a').forEach(a=>{a.classList.toggle('active',a.hash==='#'+(tab.startsWith('settings/')?tab.split('/').slice(0,2).join('/'):sports&&tab!=='sports/recordings'?'sports':tab));if(a.hash==='#'+(tab.startsWith('settings/')?tab.split('/').slice(0,2).join('/'):sports&&tab!=='sports/recordings'?'sports':tab))a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});$('#nav').querySelectorAll('a').forEach(a=>a.classList.toggle('active',a.hash==='#'+route.split('?')[0]||(route.startsWith('sports/')&&a.hash==='#sports')||((route.startsWith('movie/')||route.startsWith('episode/'))&&a.hash==='#library/'+route.split('/')[1])||(home&&a.hash==='#home')));const main=$('#main');document.title='Boreas';
 if(route.startsWith('watch/'))await NativePlayer.render(version,route);
 else if(route.startsWith('settings/')){const section=route.split('/')[1];main.innerHTML='<div id="settings-content" class="native-settings-content"></div>';if(section==='account')renderAccount();else if(section==='client')renderClientSettings();else if(section==='users'){location.hash='settings/server/users';return;}else if(section==='server')await renderServer(version,route.split('/')[2]||'dashboard');else location.hash='settings/account';}
 else if(route==='sports'||route.startsWith('sports/'))await renderSports(version,tab.split('/')[1]||'',tab.split('/')[2],new URLSearchParams(route.split('?')[1]||''));
 else if(route==='home'){clearNativeSearch();await renderNativeLibraryHome(version);}
 else if(route.startsWith('episode/')){const [,library,id]=route.split('/');location.replace('#watch/'+library+'/'+id);}
 else if(route.startsWith('movie/'))await renderNativeMovie(version,route);
 else if(route.startsWith('library/'))await renderNativeLibrary(version,route);
 else if(tab==='discover')await renderNativeDiscover(version,new URLSearchParams(route.split('?')[1]));
 else if(tab.startsWith('discover/'))await renderNativeDiscoverTitle(version,tab.slice('discover'.length));
 else if(route==='calendar')await renderNativeCalendar(version);
 else if(route.startsWith('search'))await renderNativeSearch(version,route);
 else if(route==='live-tv'||route.startsWith('live-tv/'))await renderNativeLiveTV(version,route.split('/')[1]);
 else if(['movies','shows','anime','sports','live-tv'].includes(route)){const label={movies:'Movies',shows:'Shows',anime:'Anime',sports:'Sports','live-tv':'Live TV'}[route];main.innerHTML=pageHeading(label)+emptyPage('Nothing here yet',label+' is part of the new Boreas shell. Its native backend has not been connected yet.');}
 else{location.hash='home';return;}if(version===routeVersion){main.classList.remove('native-reveal');void main.offsetWidth;main.classList.add('native-reveal');window.scrollTo(0,0);}}
function bindForm(form,operation){if(!form)return;const button=form.querySelector('button[type=submit]'),message=form.querySelector('[role=status]'),dirty=/^save\b/i.test(button.textContent.trim())?trackNativeSettingsForm(form,button):null;form.onsubmit=async event=>{event.preventDefault();button.disabled=true;dirty?.busy(true);message.textContent='Saving…';try{await operation(form);if(form.isConnected){message.textContent='Saved and applied.';dirty?.saved();}}catch(error){if(form.isConnected)message.textContent=error.message;else toast(error.message);}finally{if(button.isConnected){if(dirty)dirty.busy(false);else button.disabled=false;}}};}
function nativeAvatar(user){return user.avatar?'<img class="native-account-photo" src="'+esc(user.avatar)+'" alt="">':esc(user.displayName.slice(0,1).toUpperCase());}
async function accountPicture(file){
 if(file.size>10*1024*1024||!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Choose a JPEG, PNG, or WebP up to 10 MB.');
 const bitmap=await createImageBitmap(file);
 try{
   const canvas=document.createElement('canvas');canvas.width=canvas.height=128;
   const side=Math.min(bitmap.width,bitmap.height);
   canvas.getContext('2d',{alpha:false}).drawImage(bitmap,(bitmap.width-side)/2,(bitmap.height-side)/2,side,side,0,0,128,128);
   return canvas.toDataURL('image/jpeg',.78);
 }finally{bitmap.close();}
}
function renderAccount(){
 const root=$('#settings-content');
 root.innerHTML='<section class="native-panel"><div class="section-heading"><div><h2>Profile</h2><p class="count">'+esc(session.username)+' · '+(session.role==='admin'?'Administrator':'Member')+'</p></div><span class="native-user-avatar">'+nativeAvatar(session)+'</span></div><form id="profile-form"><label>'+(session.parentId?'Profile name':'Username')+'<input name="displayName" value="'+esc(session.displayName)+'" maxlength="80" required></label><label>Profile picture<input name="avatar" type="file" accept="image/jpeg,image/png,image/webp"></label><button class="primary" type="submit">Save profile</button><p role="status"></p></form><div class="actions">'+(session.parentId?'':'<button class="subtle" id="open-password">Change password</button>')+'</div></section>';
 const panel=root.firstElementChild;
 renderAccountProfileOptions(panel);
 void renderBrowserAccounts(panel);
 bindForm($('#profile-form'),async form=>{
   const file=form.elements.avatar.files[0],body={[session.parentId?'displayName':'username']:form.elements.displayName.value};
   if(file)body.avatar=await accountPicture(file);
   const result=await api('/account',{method:'PATCH',body});session=result.user;
   $('#account').innerHTML=nativeAvatar(session);
   panel.querySelector('.native-user-avatar').innerHTML=nativeAvatar(session);
   $('#profile-name').textContent=session.displayName;$('#sidebar-user-name').textContent=session.displayName;$('#sidebar-user-name').title=session.displayName;
   form.elements.avatar.value='';toast('Profile saved.');
 });
 const change=$('#open-password');
 if(change)change.onclick=()=>{
   const {dialog,body}=libraryDialog('Change password');
   body.innerHTML='<form id="password-form"><label>New password<input name="newPassword" type="password" autocomplete="new-password" minlength="12" maxlength="256" required></label><label>Confirm new password<input name="confirmation" type="password" autocomplete="new-password" minlength="12" maxlength="256" required></label><button class="primary" type="submit">Save password</button><p role="status"></p></form>';
   bindForm(body.querySelector('form'),async form=>{
     if(form.elements.newPassword.value!==form.elements.confirmation.value)throw Error('The new passwords do not match.');
     const result=await api('/account/password',{method:'POST',body:{newPassword:form.elements.newPassword.value}});
     session=result.user;csrf=result.csrfToken;dialog.close();toast('Password changed.');
   });
 };
}
async function confirmAction(title,text){const dialog=$('#confirm-dialog');$('#confirm-title').textContent=title;$('#confirm-text').textContent=text;dialog.returnValue='cancel';return new Promise(resolve=>{dialog.addEventListener('close',()=>resolve(dialog.returnValue==='confirm'),{once:true});dialog.showModal();});}
async function legacyRenderUsers(version){const root=$('#settings-content');if(session.role!=='admin'){root.innerHTML=emptyPage('Administrator access required','Only administrators can manage accounts on this server.');return;}root.innerHTML='<p role="status">Loading accounts…</p>';try{const data=await api('/users');if(version!==routeVersion)return;root.innerHTML='<section class="native-panel"><div class="section-heading"><h2>Local accounts</h2><span class="native-badge">'+data.users.length+' accounts</span></div><p class="count">These accounts belong only to this Boreas server.</p><div class="native-user-list">'+data.users.map(user=>'<article class="native-user-row"><div class="native-user-avatar">'+esc(user.displayName.slice(0,1).toUpperCase())+'</div><div><strong>'+esc(user.displayName)+'</strong><small>'+esc(user.username)+' · '+(user.role==='admin'?'Administrator':'Member')+(user.disabled?' · Disabled':'')+(user.id===session.id?' · You':'')+'</small></div><button class="subtle" data-edit="'+user.id+'">Manage</button></article>').join('')+'</div></section><section class="native-panel"><h2>Add an account</h2><form id="create-user"><div class="native-form-grid"><label>Display name<input name="displayName" maxlength="80" required></label><label>Username<input name="username" minlength="3" maxlength="32" pattern="[a-zA-Z0-9][a-zA-Z0-9_.-]{2,31}" autocomplete="off" required></label><label>Initial password<input name="password" type="password" minlength="12" maxlength="256" autocomplete="new-password" required></label><label>Role<select name="role"><option value="user">Member</option><option value="admin">Administrator</option></select></label></div><button class="primary" type="submit">Create account</button><p role="status"></p></form></section><section id="user-editor"></section>';
 bindForm($('#create-user'),async form=>{await api('/users',{method:'POST',body:{username:form.elements.username.value,displayName:form.elements.displayName.value,password:form.elements.password.value,role:form.elements.role.value}});form.reset();toast('Account created.');await render();});
 root.querySelectorAll('[data-edit]').forEach(button=>button.onclick=()=>editUser(data.users.find(user=>user.id===button.dataset.edit)));
 }catch(error){if(version===routeVersion)root.innerHTML='<p role="alert">'+esc(error.message)+'</p>';}}
function legacyEditUser(user){const root=$('#user-editor');root.className='native-panel';root.innerHTML='<h2>'+esc(user.displayName)+'</h2><form id="edit-user"><div class="native-form-grid"><label>Display name<input name="displayName" maxlength="80" value="'+esc(user.displayName)+'" required></label><label>Role<select name="role"><option value="user" '+(user.role==='user'?'selected':'')+'>Member</option><option value="admin" '+(user.role==='admin'?'selected':'')+'>Administrator</option></select></label></div><label class="check"><input name="disabled" type="checkbox" '+(user.disabled?'checked':'')+' '+(user.id===session.id?'disabled':'')+'> Disable sign-in</label><p class="count">Role or status changes sign this account out on all devices. At least one administrator must remain enabled.</p><button class="primary" type="submit">Save account</button><p role="status"></p></form><hr><h3>Reset password</h3><form id="reset-password"><label>New password<input name="password" type="password" minlength="12" maxlength="256" autocomplete="new-password" required></label><p class="count">Resetting the password signs this account out on every device.</p><button class="subtle" type="submit">Reset password</button><p role="status"></p></form>';
 bindForm($('#edit-user'),async form=>{if(!await confirmAction('Update account?', 'Save the profile, role, and sign-in status for '+user.displayName+'?'))return;await api('/users/'+user.id,{method:'PATCH',body:{displayName:form.elements.displayName.value,role:form.elements.role.value,disabled:form.elements.disabled.checked}});toast('Account updated.');await start();});
 bindForm($('#reset-password'),async form=>{if(!await confirmAction('Reset password?', 'Replace the password for '+user.displayName+' and sign out its sessions?'))return;await api('/users/'+user.id+'/password',{method:'POST',body:{password:form.elements.password.value}});form.reset();toast('Password reset.');if(user.id===session.id)await start();});root.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
}
function renderServerOverview(){const root=$('#server-content');root.innerHTML='<section class="native-panel"><dl class="native-details"><dt>Web address</dt><dd>'+esc(location.origin)+'</dd><dt>Backend</dt><dd>Boreas</dd><dt>Account storage</dt><dd>Local to this server</dd><dt>Media libraries</dt><dd>'+nativeLibraries.length+'</dd></dl></section>';if(session.role==='admin'){
 const version=routeVersion,usage=document.createElement('div');
 usage.innerHTML='<p role="status">Measuring the Data folder…</p>';
 root.firstElementChild.after(usage);
 void api('/storage/usage').then(data=>{if(version===routeVersion&&usage.isConnected)usage.innerHTML=dashboardDataFolder(data);}).catch(error=>{if(version===routeVersion&&usage.isConnected)usage.textContent=error.message;});
 }}
function renderClientSettings(){
 $('#settings-content').innerHTML='<section class="native-panel"><label>Theme<select name="theme"><option value="boreas">Boreas</option></select></label></section>';
}
function applyAppearance(){document.body.dataset.webTheme='oled';document.body.classList.remove('reduce-motion');}
const rail=$('aside');let hovered=false,closeTimer;const openRail=()=>{clearTimeout(closeTimer);document.body.classList.add('sidebar-peek');};const closeRail=()=>{clearTimeout(closeTimer);closeTimer=setTimeout(()=>{if(!hovered&&!nativeLibraryDrag&&!rail.querySelector(':focus-visible')){document.body.classList.remove('sidebar-peek');closeNativeLibraryDrawer();}},100);};rail.addEventListener('dragstart',()=>clearTimeout(closeTimer));rail.addEventListener('pointerenter',()=>{hovered=true;openRail();});rail.addEventListener('pointerleave',()=>{hovered=false;closeRail();});rail.addEventListener('focusin',event=>{if(event.target.matches(':focus-visible'))openRail();});rail.addEventListener('focusout',closeRail);
$('#account').onclick=()=>{
 const menu=$('#profile-menu'),open=menu.hidden;
 menu.hidden=!open;
 $('#account').setAttribute('aria-expanded',String(open));
 if(open)void refreshAccountSwitch(menu);
};document.addEventListener('click',event=>{if(!event.target.closest('.profile-control')){$('#profile-menu').hidden=true;$('#account').setAttribute('aria-expanded','false');}});document.addEventListener('keydown',event=>{if(event.key==='Escape'){$('#profile-menu').hidden=true;$('#account').setAttribute('aria-expanded','false');}if(event.key==='/'&&session&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){event.preventDefault();openRail();$('#search').focus();}});
$('#sign-out').onclick=async()=>{try{await api('/logout',{method:'POST'});session=null;csrf='';nativeStartupComplete=false;$('#profile-menu').hidden=true;await start();}catch(error){toast(error.message);}};function clearNativeSearch(){clearTimeout(searchTimer);$('#search').value='';}
 document.addEventListener('click',event=>{if(event.target.closest('a[href="#home"]'))clearNativeSearch();});$('#search').addEventListener('keydown',event=>{if(event.key==='Escape'){clearNativeSearch();$('#search').blur();if(location.hash.startsWith('#search'))location.hash='home';}});$('#search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{const query=$('#search').value.trim();location.hash=query?'search?q='+encodeURIComponent(query):'home';},250);});window.addEventListener('hashchange',()=>{nativeBackDepth=history.state?.lumenDepth??nativeBackDepth+1;history.replaceState({...history.state,lumenDepth:nativeBackDepth},'');if(session){applyAppearance();render();}});
function clock(){const now=new Date();$('#clock').textContent=now.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});$('#clock').dateTime=now.toISOString();}clock();setInterval(clock,30000);start();
