let nativeAccountContext=null,nativeStartupComplete=false;
function profilePreferenceKey(accountId){return 'lumen-native-profiles:'+serverId+':'+accountId;}
function profilePreference(accountId){try{return JSON.parse(localStorage.getItem(profilePreferenceKey(accountId))||'{}');}catch{return {};}}
function useSession(data,{restore=false}={}){nativeAccountContext=data;const profiles=data.profiles||[],account=data.accountId||data.user.id,prefs=profilePreference(account);if(!restore&&!nativeStartupComplete&&profiles.length>1){session=data.user;csrf=data.csrfToken;if(prefs.ask!==false){showNativeProfiles(data);return;}nativeStartupComplete=true;if(prefs.last&&prefs.last!==data.user.id&&profiles.some(p=>p.id===prefs.last)&&!(data.user.parentId&&prefs.last===account)){void selectNativeProfile(prefs.last,data);return;}}nativeStartupComplete=true;activateNativeSession(data);}
async function selectNativeProfile(id,data,password){try{await NativePlayer.stop();const result=await api('/profiles/select',{method:'POST',body:{id,...(password?{password}:{})}});nativeAccountContext=result;nativeStartupComplete=true;const key=profilePreferenceKey(result.accountId),prefs=profilePreference(result.accountId);localStorage.setItem(key,JSON.stringify({...prefs,last:result.user.id}));$('#welcome').hidden=true;if(result.user.id!==data.user.id)location.hash='home';activateNativeSession(result);}catch(e){const error=$('#profile-choice-error');if(error)error.textContent=e.message;else{toast(e.message);activateNativeSession(data);}}}
function showNativeProfiles(data){nativeAccountContext=data;session=data.user;csrf=data.csrfToken;routeVersion++;cleanupNativeHomeRows();cleanupNativeLibraries();cleanupSports();NativeAtmosphere.clear();void NativePlayer.stop();$('#app').hidden=true;$('#welcome').hidden=false;document.title='Choose a profile · Boreas';const root=$('#auth-panel');root.innerHTML='<h2>Who’s watching?</h2><p class="count">Choose a profile. Each profile has its own watch progress and library access.</p><div class="native-profile-grid">'+data.profiles.map(p=>'<button class="native-profile-choice" data-profile="'+p.id+'"><span class="native-user-avatar">'+nativeAvatar(p)+'</span><strong>'+esc(p.displayName)+'</strong><small>'+(p.parentId?'Managed profile':'Account owner')+'</small></button>').join('')+'</div><form id="owner-profile-password" hidden><p>Enter the account password to return to the owner profile.</p><label>Account password<input type="password" name="password" autocomplete="current-password" maxlength="256" required></label><button class="primary" type="submit">Open owner profile</button></form><p id="profile-choice-error" role="alert"></p><button class="subtle" id="profiles-sign-out">Sign out</button>';root.querySelectorAll('[data-profile]').forEach(b=>b.onclick=()=>{if(data.user.parentId&&b.dataset.profile===data.accountId){const form=$('#owner-profile-password');form.hidden=false;form.elements.password.focus();form.onsubmit=e=>{e.preventDefault();const password=form.elements.password.value;form.elements.password.value='';void selectNativeProfile(b.dataset.profile,data,password);};}else void selectNativeProfile(b.dataset.profile,data);});$('#profiles-sign-out').onclick=async()=>{await api('/logout',{method:'POST'});nativeStartupComplete=false;session=null;csrf='';await start();};root.querySelector('[data-profile]')?.focus();}
function renderAccountProfileOptions(root){const account=nativeAccountContext?.accountId||session.id,prefs=profilePreference(account),section=document.createElement('div');section.className='native-account-options';section.innerHTML='<h3>Startup profile</h3><form id="startup-profile-settings"><label class="check"><input name="ask" type="checkbox" '+(prefs.ask!==false?'checked':'')+'> Show profile chooser at startup</label><p class="count">If disabled, this browser opens the last-used profile. This preference is saved for this account on this browser.</p><button class="primary" type="submit">Save settings</button><p role="status"></p></form>';root.append(section);bindForm(section.querySelector('form'),async form=>localStorage.setItem(profilePreferenceKey(account),JSON.stringify({...profilePreference(account),ask:form.elements.ask.checked,last:session.id})));}
function nativePermissionFields(value={}){
 const p={libraryIds:null,sports:true,liveTV:true,record:false,deleteMedia:false,...value};
 const options=fields=>fields.map(([key,label])=>'<label class="check"><input type="checkbox" name="'+key+'" '+(p[key]?'checked':'')+'>'+label+'</label>').join('');
 return '<fieldset class="native-permissions native-user-section"><legend>Media libraries</legend><label class="check"><input name="allLibraries" type="checkbox" '+(p.libraryIds===null?'checked':'')+'> All libraries, including libraries added later</label><div class="native-library-access">'+nativeLibraries.map(l=>'<label class="check"><input type="checkbox" data-library-permission="'+l.id+'" '+(p.libraryIds===null||p.libraryIds.includes(l.id)?'checked':'')+'>'+esc(l.name)+'</label>').join('')+'</div></fieldset><fieldset class="native-permissions native-user-section"><legend>Boreas services</legend>'+options([['sports','Sports and sports recordings'],['liveTV','Live TV']])+'</fieldset><fieldset class="native-permissions native-user-section"><legend>Media actions</legend>'+options([['record','Create and manage recordings'],['deleteMedia','Delete media and recordings permanently']])+'</fieldset>';
}
function bindNativePermissionFields(form){const all=form.elements.allLibraries;const update=()=>form.querySelectorAll('[data-library-permission]').forEach(c=>c.disabled=all.checked);all.onchange=update;update();}
function readNativePermissions(form){return {libraryIds:form.elements.allLibraries.checked?null:[...form.querySelectorAll('[data-library-permission]:checked')].map(c=>c.dataset.libraryPermission),...Object.fromEntries(['sports','liveTV','record','deleteMedia'].map(k=>[k,form.elements[k].checked]))};}
const usersRoute='#settings/server/users';
async function renderUsers(version){
 const root=$('#server-content');
 root.innerHTML='<p role="status">Loading accounts…</p>';
 try{
   const {users}=await api('/users');
   if(version!==routeVersion||!root.isConnected)return;
   const [, , ,id,action]=location.hash.split('/');
   if(id==='new'){editUser(root);return;}
   if(id){
     const selected=users.find(user=>user.id===id);
     if(!selected){root.innerHTML=emptyPage('Account unavailable','Choose an account from Users.');return;}
     if(action==='managed'&&!selected.parentId){editUser(root,null,selected);return;}
     editUser(root,selected);return;
   }
   const cards=users.map(user=>{
     const owner=users.find(account=>account.id===user.parentId);
     const type=owner?'Managed by '+owner.username:user.role==='admin'?'Administrator':'Member';
     return '<a class="native-user-card" href="'+usersRoute+'/'+esc(user.id)+'"><span class="native-user-avatar">'+nativeAvatar(user)+'</span><strong>'+esc(user.displayName)+'</strong><small>'+esc(type+(user.disabled?' · Disabled':''))+'</small></a>';
   }).join('');
   root.innerHTML='<section class="native-panel"><div class="section-heading"><h2>Users &amp; managed profiles</h2><a class="primary" href="'+usersRoute+'/new">Add account</a></div><div class="native-user-cards">'+cards+'</div></section>';
 }catch(error){if(version===routeVersion&&root.isConnected)root.textContent=error.message;}
}
function editUser(root,user=null,parent=null){
 const managed=!!(parent||user?.parentId),creating=!user;
 const nameField=managed?'<label>Profile name<input name="displayName" maxlength="80" value="'+esc(user?.displayName||'')+'" required></label>':'<label>Username<input name="username" minlength="3" maxlength="32" pattern="[a-zA-Z0-9][a-zA-Z0-9_.-]{2,31}" value="'+esc(user?.username||'')+'" required></label>';
 const roleField=managed?'':'<label>Role<select name="role"><option value="user">Member</option><option value="admin" '+(user?.role==='admin'?'selected':'')+'>Administrator</option></select></label>';
 const passwordField=creating&&!managed?'<label>Initial password<input type="password" name="password" minlength="12" maxlength="256" autocomplete="new-password" required></label>':'';
 root.innerHTML='<section class="native-panel"><div class="section-heading"><div class="native-user-edit-heading">'+(user?'<span class="native-user-avatar">'+nativeAvatar(user)+'</span>':'')+'<h2>'+esc(user?.displayName||(managed?'Add managed profile':'Add account'))+'</h2></div></div><form id="native-user-edit"><fieldset class="native-user-section"><legend>Account details</legend>'+nameField+roleField+passwordField+'<label>Profile picture<input name="avatar" type="file" accept="image/jpeg,image/png,image/webp"></label>'+(creating?'':'<label class="check"><input type="checkbox" name="disabled" '+(user.disabled?'checked':'')+' '+(user.id===session.id?'disabled':'')+'> Disable access</label>')+'</fieldset>'+nativePermissionFields(user?.permissions)+'<div class="actions"><button class="primary" type="submit">'+(creating?'Create '+(managed?'profile':'account'):'Save settings')+'</button>'+(!creating&&!managed?'<a class="subtle" href="'+usersRoute+'/'+esc(user.id)+'/managed">Add managed profile</a><button class="subtle" type="button" id="native-reset-password">Change password</button>':'')+'</div><p role="status"></p></form></section>';
 const form=root.querySelector('form');
 bindNativePermissionFields(form);
 bindForm(form,async()=>{
   const name=managed?'displayName':'username',input={[name]:form.elements[name].value,permissions:readNativePermissions(form)};
   if(!managed)input.role=form.elements.role.value;
   if(form.elements.avatar.files[0])input.avatar=await accountPicture(form.elements.avatar.files[0]);
   if(creating){
     if(parent)await api('/users/'+parent.id+'/managed',{method:'POST',body:input});
     else await api('/users',{method:'POST',body:{...input,password:form.elements.password.value}});
     toast('Created.');location.hash=usersRoute;return;
   }
   input.disabled=form.elements.disabled.checked;
   const result=await api('/users/'+user.id,{method:'PATCH',body:input});
   const current=await api('/profiles');nativeAccountContext=current;
   session=current.user;
   $('#account').innerHTML=nativeAvatar(session);
   $('#sidebar-user-name').textContent=session.displayName;
   $('#sidebar-user-name').title=session.displayName;
   $('#profile-name').textContent=session.displayName;
   $('#switch-native-profile').hidden=current.profiles.length<2;
   root.querySelector('.native-user-edit-heading h2').textContent=result.user.displayName;
   root.querySelector('.native-user-edit-heading .native-user-avatar').innerHTML=nativeAvatar(result.user);
   form.elements.avatar.value='';
 });
 root.querySelector('#native-reset-password')?.addEventListener('click',()=>{
   const {body,dialog}=libraryDialog('Change password · '+user.displayName);
   body.innerHTML='<form><label>New password<input type="password" name="password" minlength="12" maxlength="256" autocomplete="new-password" required></label><p class="count">This signs the account and its profiles out on all devices.</p><button class="primary" type="submit">Save password</button><p role="status"></p></form>';
   bindForm(body.querySelector('form'),async f=>{
     await api('/users/'+user.id+'/password',{method:'POST',body:{password:f.elements.password.value}});
     dialog.close();toast('Password changed.');
     if(user.id===(nativeAccountContext?.accountId||session.id))await start();
   });
 });
}
function nativeFormState(form){return JSON.stringify([...form.elements].filter(e=>e.name&&!e.disabled&&e.type!=='submit').map(e=>[e.name,e.type==='checkbox'?e.checked:e.value]));}
function trackNativeSettingsForm(form,button){let saved=nativeFormState(form),busy=false,pending=form.dataset.pendingApply===String(true);const update=()=>{button.disabled=busy||!pending&&nativeFormState(form)===saved;};form.addEventListener('input',update);form.addEventListener('change',update);update();return {busy(value){busy=value;update();},saved(){pending=false;saved=nativeFormState(form);update();},update};}

document.addEventListener('DOMContentLoaded',()=>{document.querySelector('#switch-native-profile').onclick=async()=>{try{const data=await api('/profiles');showNativeProfiles(data);}catch(e){toast(e.message);}};});

const accountChooserKey=()=> 'boreas-account-chooser:'+serverId;
async function switchBrowserAccount(input){
 await NativePlayer.stop();
 const result=await api('/account/sessions',{method:'POST',body:input});
 nativeStartupComplete=false;
 history.replaceState({...history.state,lumenDepth:0},'','#home');
 useSession(result);
}
function showBrowserAccounts(data){
 session=data.user;csrf=data.csrfToken;nativeAccountContext=data;
 $('#app').hidden=true;$('#welcome').hidden=false;
 document.title='Choose an account · Boreas';
 const panel=$('#auth-panel');
 panel.innerHTML='<h2>Choose an account</h2><div class="native-profile-grid">'+[data.user,...data.savedAccounts].map(user=>'<button class="native-profile-choice" data-account="'+esc(user.id)+'"><span class="native-user-avatar">'+nativeAvatar(user)+'</span><strong>'+esc(user.displayName)+'</strong></button>').join('')+'</div><p role="alert"></p>';
 panel.querySelectorAll('[data-account]').forEach(button=>button.onclick=async()=>{
   panel.querySelectorAll('button').forEach(item=>item.disabled=true);
   try{
     if(button.dataset.account===data.user.id)useSession(data);
     else await switchBrowserAccount({accountId:button.dataset.account});
   }catch(error){panel.querySelector('[role=alert]').textContent=error.message;panel.querySelectorAll('button').forEach(item=>item.disabled=false);}
 });
 panel.querySelector('button')?.focus();
}
async function renderBrowserAccounts(root){
 if(session.parentId)return;
 const panel=document.createElement('div');panel.className='native-account-options';
 panel.innerHTML='<h3>Signed-in accounts</h3><div class="native-browser-accounts"></div><button class="subtle" type="button">Sign in to another account</button>';
 root.append(panel);
 panel.querySelector('button').onclick=()=>{
   const {dialog,body}=libraryDialog('Sign in to another account');
   body.innerHTML='<form><label>Username<input name="username" autocomplete="username" required maxlength="32"></label><label>Password<input name="password" type="password" autocomplete="current-password" required maxlength="256"></label><button class="primary" type="submit">Sign in</button><p role="status"></p></form>';
   bindForm(body.querySelector('form'),async form=>{await switchBrowserAccount({username:form.elements.username.value,password:form.elements.password.value});dialog.close();});
 };
 try{
   const data=await api('/status');
   if(!panel.isConnected||!data.savedAccounts?.length)return;
   const list=panel.querySelector('.native-browser-accounts');
   list.innerHTML=data.savedAccounts.map(user=>'<button type="button" class="subtle" data-account="'+esc(user.id)+'">Switch to '+esc(user.displayName)+'</button>').join('')+'<form><label class="check"><input name="ask" type="checkbox" '+(localStorage.getItem(accountChooserKey())==='yes'?'checked':'')+'> Show account chooser at startup</label><button class="primary" type="submit">Save settings</button><p role="status"></p></form>';
   list.querySelectorAll('[data-account]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{await switchBrowserAccount({accountId:button.dataset.account});}catch(error){toast(error.message);button.disabled=false;}});
   bindForm(list.querySelector('form'),async form=>localStorage.setItem(accountChooserKey(),form.elements.ask.checked?'yes':'no'));
 }catch(error){if(panel.isConnected)panel.querySelector('.native-browser-accounts').textContent=error.message;}
}

async function refreshAccountSwitch(menu){
 const button=menu.querySelector('#switch-native-account'),profileId=session?.id;
 button.hidden=true;
 if(!profileId||session.parentId)return;
 try{
   const data=await api('/status');
   if(menu.hidden||session?.id!==profileId||data.user?.id!==profileId||!data.savedAccounts?.length)return;
   button.hidden=false;
   button.onclick=()=>{
     menu.hidden=true;
     $('#account').setAttribute('aria-expanded','false');
     showBrowserAccounts(data);
   };
 }catch{}
}
