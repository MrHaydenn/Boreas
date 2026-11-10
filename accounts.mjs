import {permissions,effectivePermissions} from './permissions.mjs';
import {randomBytes,randomUUID,scrypt as derive,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
const scrypt=promisify(derive),fail=(message,status=400)=>Object.assign(Error(message),{status});
const token=()=>randomBytes(32).toString('base64url'),digest=value=>createHash('sha256').update(value).digest('hex');
const username=value=>{if(typeof value!=='string'||! /^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,31}$/.test(value))throw fail('Use 3–32 letters, numbers, dots, underscores, or dashes for the username.');return value;};
const displayName=value=>{if(typeof value!=='string'||!value.trim()||value.trim().length>80||/[\x00-\x1f]/.test(value))throw fail('Enter a display name of up to 80 characters.');return value.trim();};
function password(value){if(typeof value!=='string'||value.length<12||value.length>256)throw fail('Use a password between 12 and 256 characters.');return value;}
async function hash(value){const salt=randomBytes(24).toString('hex');return {salt,hash:(await scrypt(value,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024})).toString('hex')};}
async function matches(value,record){const computed=await scrypt(String(value||''),record.salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024});return timingSafeEqual(computed,Buffer.from(record.hash,'hex'));}
const view=user=>({id:user.id,username:user.username,displayName:user.parentId?user.displayName:user.username,avatar:user.avatar||null,role:user.role,disabled:user.disabled,createdAt:user.createdAt,parentId:user.parentId||null,permissions:effectivePermissions(user)});
function saveAvatar(user,input){if(input.avatar!==undefined){if(typeof input.avatar!=='string'||input.avatar.length>32000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(input.avatar))throw fail('Choose a valid profile picture.');user.avatar=input.avatar;}}
function renameAccount(users,user,value){
 if(value===undefined)return;
 if(user.parentId){user.displayName=displayName(value);return;}
 const next=username(value);
 if(users.some(other=>other.id!==user.id&&other.username.toLowerCase()===next.toLowerCase()))throw fail('That username is already in use.',409);
 user.username=user.displayName=next;
}
export async function createAccounts(directory){
 await mkdir(directory,{recursive:true});const filename=path.join(directory,'accounts.json');let state;
 try{state=JSON.parse(await readFile(filename,'utf8'));if(state.version!==1||!Array.isArray(state.users)||!Array.isArray(state.sessions))throw Error('Invalid account data.');}catch(error){if(error.code!=='ENOENT')throw error;state={version:1,id:randomUUID(),users:[],sessions:[]};await writeFile(filename,JSON.stringify(state,null,2),{mode:0o600,flag:'wx'});}
 let queue=Promise.resolve();const dummy=await hash(token()),attempts=new Map();let hashing=0;
 async function costly(operation){if(hashing>=4)throw fail('The account service is busy. Try again shortly.',429);hashing++;try{return await operation();}finally{hashing--;}}
 async function transaction(operation){const result=queue.then(async()=>{const draft=structuredClone(state),value=await operation(draft);const temporary=filename+'.'+randomUUID()+'.tmp';await writeFile(temporary,JSON.stringify(draft,null,2)+'\n',{mode:0o600});await rename(temporary,filename);state=draft;return value;});queue=result.catch(()=>{});return result;}
 function current(raw){if(!raw)return null;const session=state.sessions.find(s=>s.tokenHash===digest(raw)&&(s.until===null||s.until>Date.now())),account=session&&state.users.find(u=>u.id===session.userId&&!u.parentId&&!u.disabled),user=account&&(session.profileId?state.users.find(u=>u.id===session.profileId&&!u.disabled&&(u.id===account.id||u.parentId===account.id)):account);return user?{user,account,session}:null;}
 function profileView(user,account){return {...view(user),permissions:effectivePermissions(user,user.parentId?account:null)};}
 function family(account){return state.users.filter(u=>!u.disabled&&(u.id===account.id||u.parentId===account.id)).map(u=>profileView(u,account));}
 function requireUser(raw){const result=current(raw);if(!result)throw fail('Sign in to continue.',401);return result;}
 function requireAdmin(raw){const result=requireUser(raw);if(result.user.role!=='admin')throw fail('Administrator access is required.',403);return result;}
 const deviceId=session=>session.deviceGroup||digest("device:"+session.tokenHash);
 const lastSeen=new Map();
 function newSession(draft,user,remember,device){const raw=token(),csrf=token(),until=remember==='persistent'?null:Date.now()+(remember?30:1)*86400000;draft.sessions=draft.sessions.filter(s=>s.until===null||s.until>Date.now()).slice(-499);draft.sessions.push({tokenHash:digest(raw),csrf,userId:user.id,until,device,createdAt:new Date().toISOString()});return {raw,csrf,until,user:view(user),accountId:user.id,profiles:draft.users.filter(u=>!u.disabled&&(u.id===user.id||u.parentId===user.id)).map(u=>profileView(u,user))};}
 function rate(ip,name){const now=Date.now();for(const [key,value] of attempts)if(value.until<now)attempts.delete(key);if(attempts.size>10000)throw fail('Too many sign-in attempts. Try later.',429);const keys=['ip:'+ip,'name:'+name];for(const key of keys){const entry=attempts.get(key)||{count:0,until:now+15*60000};if(entry.count>=(key.startsWith('ip:')?30:10))throw fail('Too many sign-in attempts. Try again in 15 minutes.',429);entry.count++;attempts.set(key,entry);}}
 return {
  async linkDevices(tokens){
   const sessions=tokens.map(raw=>current(raw)?.session).filter(Boolean);
   if(sessions.length<2||sessions.every(entry=>deviceId(entry)===deviceId(sessions[0])))return;
   await transaction(draft=>{
    const active=tokens.map(raw=>current(raw)?.session).filter(Boolean);
    if(active.length<2)return;
    const hashes=new Set(active.map(entry=>entry.tokenHash));
    const group=deviceId(active[0]);
    for(const entry of draft.sessions)if(hashes.has(entry.tokenHash))entry.deviceGroup=group;
   });
  },
  devices(raw){
   const active=requireAdmin(raw);
   return state.sessions.filter(entry=>entry.until===null||entry.until>Date.now()).flatMap(entry=>{
    const owner=state.users.find(user=>user.id===entry.userId&&!user.disabled);
    if(!owner)return [];
    const profile=entry.profileId&&state.users.find(user=>user.id===entry.profileId&&!user.disabled);
    return [{id:deviceId(entry),account:owner.username,accountId:owner.id,profile:profile?.parentId?profile.displayName:null,device:entry.device?.name||entry.device||'Unknown device',platform:entry.device?.platform||null,version:entry.device?.version||null,createdAt:entry.createdAt||null,lastSeen:lastSeen.get(entry.tokenHash)||null,current:entry.tokenHash===active.session.tokenHash}];
   });
  },
  revokeDevice(raw,id){return transaction(draft=>{
   requireAdmin(raw);
   draft.sessions=draft.sessions.filter(entry=>deviceId(entry)!==id);
   return {ok:true};
  });},
  sessionExpiry(raw){return current(raw)?.session.until??null;},
  isPersistent(raw){return current(raw)?.session.until===null;},
  serverId:state.id,cookieName:'lumen_native_'+state.id.replaceAll('-','').slice(0,12),
  status(raw,{touch=true}={}){const result=current(raw);if(result&&touch){lastSeen.set(result.session.tokenHash,Date.now());if(lastSeen.size>1024)lastSeen.delete(lastSeen.keys().next().value);}return {setupRequired:!state.users.length,user:result?profileView(result.user,result.account):null,accountId:result?.account.id||null,profiles:result?family(result.account):[],csrfToken:result?.session.csrf||null};},
  verifyCSRF(raw,value){const {session}=requireUser(raw);if(typeof value!=='string'||Buffer.byteLength(value)!==Buffer.byteLength(session.csrf)||!timingSafeEqual(Buffer.from(value),Buffer.from(session.csrf)))throw fail('Reload the page and try again.',403);},
  async setup(input,device){const name=username(input.username),secret=password(input.password);return transaction(async draft=>{if(draft.users.length)throw fail('Initial setup has already been completed.',409);const user={id:randomUUID(),username:name,displayName:name,role:'admin',disabled:false,createdAt:new Date().toISOString(),password:await costly(()=>hash(secret))};draft.users.push(user);return newSession(draft,user,false,device);});},
  async login(input,ip,device){if(typeof input.password!=='string'||input.password.length>256)throw fail('Username or password is incorrect.',401);const name=String(input.username||'').toLowerCase().slice(0,64);rate(ip,name);const user=state.users.find(u=>u.username.toLowerCase()===name.toLowerCase());const valid=await costly(()=>matches(input.password,user?.password||dummy));if(!valid||!user||user.disabled)throw fail('Username or password is incorrect.',401);return transaction(draft=>{const latest=draft.users.find(u=>u.id===user.id&&!u.disabled);if(!latest||latest.password.hash!==user.password.hash)throw fail('Sign in again.',401);return newSession(draft,latest,input.remember==='persistent'?'persistent':input.remember===true,device);});},
  async logout(raw){return transaction(draft=>{draft.sessions=draft.sessions.filter(s=>s.tokenHash!==digest(raw||''));return {ok:true};});},
  list(raw){requireAdmin(raw);return state.users.map(u=>profileView(u,state.users.find(p=>p.id===u.parentId)));},
  async createManaged(raw,parentId,input){requireAdmin(raw);const title=displayName(input.displayName),access=permissions(input.permissions);return transaction(draft=>{requireAdmin(raw);const parent=draft.users.find(u=>u.id===parentId&&!u.parentId&&!u.disabled);if(!parent)throw fail("Choose an enabled parent account.",404);if(draft.users.filter(u=>u.parentId===parentId).length>=20)throw fail("This account already has 20 managed profiles.");const user={id:randomUUID(),parentId,username:"",displayName:title,role:"user",disabled:false,permissions:access,createdAt:new Date().toISOString()};saveAvatar(user,input);draft.users.push(user);return profileView(user,parent);});},
  async selectProfile(raw,input){const active=requireUser(raw),target=state.users.find(u=>u.id===input.id&&!u.disabled&&(u.id===active.account.id||u.parentId===active.account.id));if(!target)throw fail("Profile not found.",404);if(active.user.parentId&&target.id===active.account.id){rate("profile:"+active.session.tokenHash,active.account.username);if(typeof input.password!=="string"||input.password.length>256||!await costly(()=>matches(input.password,active.account.password)))throw fail("Enter the account password to open the owner profile.",403);}await transaction(draft=>{const latest=requireUser(raw);if(latest.account.id!==active.account.id)throw fail("Sign in again.",401);const session=draft.sessions.find(s=>s.tokenHash===digest(raw));const selected=draft.users.find(u=>u.id===target.id&&!u.disabled);if(!session||!selected)throw fail("Profile not found.",404);session.profileId=selected.id;session.csrf=token();});return this.status(raw);},
  async create(raw,input){requireAdmin(raw);const name=username(input.username),secret=password(input.password);if(!['admin','user'].includes(input.role))throw fail('Choose a valid role.');const encoded=await costly(()=>hash(secret));return transaction(draft=>{const actor=draft.users.find(u=>u.id===requireAdmin(raw).user.id);if(actor?.disabled||actor?.role!=='admin')throw fail('Administrator access is required.',403);if(draft.users.some(u=>u.username.toLowerCase()===name.toLowerCase()))throw fail('That username is already in use.',409);const user={id:randomUUID(),username:name,displayName:name,role:input.role,permissions:permissions(input.permissions),disabled:false,createdAt:new Date().toISOString(),password:encoded};saveAvatar(user,input);draft.users.push(user);return view(user);});},
  async update(raw,id,input){const actor=requireAdmin(raw).user;return transaction(draft=>{requireAdmin(raw);const user=draft.users.find(u=>u.id===id);if(!user)throw fail('Account not found.',404);if(input.role!==undefined&&!['admin','user'].includes(input.role))throw fail('Choose a valid role.');if(input.disabled!==undefined&&typeof input.disabled!=='boolean')throw fail('Choose a valid account status.');if(user.parentId&&input.role&&input.role!=='user')throw fail('Managed profiles cannot be administrators.');const role=input.role??user.role,disabled=input.disabled??user.disabled;if(user.id===actor.id&&disabled)throw fail('You cannot disable your own account.');if(user.role==='admin'&&!user.disabled&&(role!=='admin'||disabled)&&draft.users.filter(u=>u.role==='admin'&&!u.disabled).length<=1)throw fail('Keep at least one enabled administrator.');if(input.permissions!==undefined)user.permissions=permissions(input.permissions);renameAccount(draft.users,user,user.parentId?input.displayName:input.username);saveAvatar(user,input);if(user.role!==role||user.disabled!==disabled)draft.sessions=draft.sessions.filter(s=>s.userId!==user.id&&s.profileId!==user.id);user.role=role;user.disabled=disabled;return view(user);});},
  async profile(raw,input){const person=requireUser(raw).user;return transaction(draft=>{requireUser(raw);const user=draft.users.find(u=>u.id===person.id);renameAccount(draft.users,user,user.parentId?input.displayName:input.username??input.displayName);saveAvatar(user,input);return profileView(user,draft.users.find(u=>u.id===user.parentId));});},
  async changePassword(raw,input){const active=requireUser(raw),person=active.user;if(person.parentId)throw fail("Managed profiles do not have a sign-in password.",403);const secret=password(input.newPassword);if(input.currentPassword!==undefined&&(typeof input.currentPassword!=='string'||input.currentPassword.length>256||!await costly(()=>matches(input.currentPassword,person.password))))throw fail('The current password is incorrect.',403);const encoded=await costly(()=>hash(secret));return transaction(draft=>{requireUser(raw);const user=draft.users.find(u=>u.id===person.id);if(user.password.hash!==person.password.hash)throw fail('Your password changed. Sign in again.',409);user.password=encoded;draft.sessions=draft.sessions.filter(s=>s.userId!==user.id);return newSession(draft,user,active.session.until===null?'persistent':false,active.session.device);});},
  async resetPassword(raw,id,input){requireAdmin(raw);const secret=password(input.password),encoded=await costly(()=>hash(secret));return transaction(draft=>{requireAdmin(raw);const user=draft.users.find(u=>u.id===id);if(!user)throw fail('Account not found.',404);if(user.parentId)throw fail('Managed profiles do not have a sign-in password.');user.password=encoded;draft.sessions=draft.sessions.filter(s=>s.userId!==id);return {ok:true};});}
 };
}
