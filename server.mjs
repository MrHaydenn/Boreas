import dgram from 'node:dgram';
import {createUpdateCheck} from './update-check.mjs';
import {createServerPreferences} from './server-preferences.mjs';
import {createStorageMove} from './storage-move.mjs';
import {createServerDashboard} from './server-dashboard.mjs';
import {createMediaAnalysis} from './media-analysis.mjs';
import {createPlaybackMarkers} from './playback-markers.mjs';
import {createNativeConnections} from './native-connections.mjs';
import {createDiscover} from './discover.mjs';
import {createTunerDVR} from './tuner-dvr.mjs';
import {createLiveTV} from './live-tv.mjs';
import {createVideoThumbnails} from './video-thumbnails.mjs';
import {createLibraryWatcher} from './library-watcher.mjs';
import {canLibrary,requireLibrary,requirePermission} from './permissions.mjs';
import {createTranscoderSettings} from './transcoder-settings.mjs';
import {playbackQualityOptions,createTranscoding,TRANSCODE_PROFILES} from './transcoding.mjs';
import {createRatings} from './ratings.mjs';
import {createMediaState} from './media-state.mjs';
import {createMediaInfo} from './media-info.mjs';
import {createLibraryRecommendations} from './library-recommendations.mjs';
import {createNativeTV,tvId} from './native-tv.mjs';
import {createTitleArtwork} from './title-artwork.mjs';
import {createSportsHandler} from './sports.mjs';
import {createSportsCapture} from './sports-capture.mjs';
import {createArtworkPalette} from './artwork-palette.mjs';
import {createSubtitleDelivery} from './subtitle-delivery.mjs';
import {createTrackDelivery} from './track-delivery.mjs';
import {createLanguagePreferences} from './preferences.mjs';
import {createWatchProgress} from './watch-progress.mjs';
import {sendMedia} from './media.mjs';
import {createTVMetadata} from './tv-metadata.mjs';
import {createMetadataArtwork} from './artwork.mjs';
import {createMovieMetadata} from './metadata.mjs';
import {createLibraries,LIBRARY_TYPES} from './libraries.mjs';
import http from 'node:http';import os from 'node:os';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';import {readFile,stat} from 'node:fs/promises';import {createAccounts} from './accounts.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
export const localAddresses=()=>Object.values(os.networkInterfaces()).flat().filter(a=>a&&a.family==='IPv4'&&!a.internal).map(a=>a.address);
const fail=(message,status=400)=>Object.assign(Error(message),{status});
async function jsonBody(req,limit=8192){if(!String(req.headers['content-type']||'').startsWith('application/json'))throw fail('Send JSON data.',415);let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>limit)throw fail('Request is too large.',413);}try{const value=JSON.parse(text);if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}catch{throw fail('Invalid request data.');}}
export async function createApplication({directory=here,dataDirectory=path.join(directory,'data'),publicRoot=path.join(directory,'public'),publicOrigin='',appDefaults={sports:true,liveTV:true},allowSetup,metadataFetcher,ratingsFetcher,enableMediaAnalysis=false,sportsDirectory=path.join(dataDirectory,'sports'),sportsFetcher}={}){

 const metadataArtwork=createMetadataArtwork({directory:dataDirectory}),artworkPalette=createArtworkPalette();
 const accounts=await createAccounts(dataDirectory),metadata=await createMovieMetadata(dataDirectory,{fetcher:metadataFetcher}),tvMetadata=await createTVMetadata(dataDirectory,metadata),titleArtwork=await createTitleArtwork(dataDirectory,metadata),libraries=await createLibraries(dataDirectory,{metadata,tvMetadata,artworkOverrides:titleArtwork});const progress=await createWatchProgress(dataDirectory,libraries),languages=await createLanguagePreferences(dataDirectory,libraries),tracks=await createTrackDelivery(dataDirectory,libraries,languages,{settings:()=>transcoderSettings.get()});const ips=new Set(localAddresses()),ownHosts=new Set(['localhost','127.0.0.1','::1',os.hostname().toLowerCase(),os.hostname().toLowerCase()+'.local',...ips]);const serverPreferences=await createServerPreferences(dataDirectory,{publicOrigin,...appDefaults,updateChannel:"stable"});
 const checkUpdates=await createUpdateCheck(directory);
 const serverPublicOrigin=()=>serverPreferences.get().publicOrigin;
 const appAvailable=name=>serverPreferences.get()[name]===true;
 const sports=createSportsHandler({authorize:async()=>true,fetcher:sportsFetcher}),capture=createSportsCapture({directory:sportsDirectory,program:directory,fetcher:sportsFetcher,authorize:async()=>true,enabled:()=>appAvailable('sports')});
 function local(req){const address=String(req.socket.remoteAddress||'').replace(/^::ffff:/,'');return ['127.0.0.1','::1'].includes(address)||ips.has(address);}
 const discover=createDiscover(metadata,libraries);
 const connections=createNativeConnections(dataDirectory,libraries);
 const subtitleDelivery=createSubtitleDelivery(dataDirectory,libraries,languages);
 const transcoderSettings=await createTranscoderSettings(dataDirectory),transcoding=await createTranscoding(dataDirectory,libraries,languages,{settings:()=>transcoderSettings.get()});
 const playbackMarkers=await createPlaybackMarkers(dataDirectory);
 const liveTV=await createLiveTV(dataDirectory);
 const dvr=await createTunerDVR(dataDirectory,liveTV,libraries,{enabled:()=>appAvailable('liveTV')});
 const videoThumbnails=await createVideoThumbnails(dataDirectory,libraries);
 const mediaAnalysis=await createMediaAnalysis(dataDirectory,libraries,videoThumbnails);
 const stopScanListener=enableMediaAnalysis?libraries.onScan((id,items)=>mediaAnalysis.enqueue(id,items)):()=>{};
 if(enableMediaAnalysis)await mediaAnalysis.resume();
 const ratings=await createRatings(dataDirectory,libraries,metadata,{fetcher:ratingsFetcher}),libraryWatcher=await createLibraryWatcher(libraries);
 const mediaInfo=createMediaInfo(libraries);
 const mediaState=await createMediaState(dataDirectory),recommendations=createLibraryRecommendations({libraries,progress,mediaState,tvId}),nativeTV=createNativeTV({libraries,progress,recommendations,accounts,metadata,ratings,discover,connections,liveTV,dvr,mediaState,transcoding,transcoderSettings,languages,subtitleDelivery,getDashboard:()=>dashboard,appAvailable,videoThumbnails,playbackMarkers,mediaAnalysis,mediaInfo});
 const cookie=req=>{const entry=String(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(accounts.cookieName+'='));return entry?.slice(accounts.cookieName.length+1)||'';};
 const storageMove=createStorageMove(directory,dataDirectory,enableMediaAnalysis);
 const dashboard=createServerDashboard({libraries,directory:dataDirectory,publicOrigin:serverPublicOrigin,historyFile:enableMediaAnalysis?path.join(dataDirectory,"dashboard-network.json"):undefined,activities:()=>{
   const entries=libraries.list(true),names=new Map(entries.map(entry=>[entry.id,entry.name]));
   const analysis=mediaAnalysis.status();
   return {scans:entries.filter(entry=>['queued','scanning','metadata'].includes(entry.scan.state)).map(entry=>({name:entry.name,...entry.scan,warnings:undefined})),analysis:{...analysis,jobs:analysis.jobs.map(job=>({...job,library:names.get(job.libraryId)}))},transcodes:transcoding.activity(),tuners:liveTV.activity(),sports:capture.activity()};
 }});
 const server=http.createServer(async(req,res)=>{
  const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  try{
   res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://www.youtube.com https://s.ytimg.com; frame-src https://www.youtube-nocookie.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://image.tmdb.org https://artworks.thetvdb.com https://assets.nhle.com https://a.espncdn.com; media-src 'self' blob:; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
   if(!req.headers.host)throw fail('Missing host.',400);const url=new URL(req.url,'http://'+req.headers.host),hostname=url.hostname.replace(/^\[|\]$/g,'').toLowerCase();const publicOrigin=serverPublicOrigin();if(!ownHosts.has(hostname)&&(!publicOrigin||hostname!==new URL(publicOrigin).hostname.toLowerCase()))throw fail('This hostname is not configured for Boreas.',403);
   dashboard.observe(req,res,url);
   const raw=cookie(req),method=req.method||'GET';
   const isPublic=!!publicOrigin&&hostname===new URL(publicOrigin).hostname.toLowerCase();
   const agent=req.headers['user-agent']||'';
   const browser=agent.match(/(Edg)\/([\d.]+)/i)||agent.match(/(Firefox|Chrome|Version)\/([\d.]+)/i);
   const platform=/roku/i.test(agent)?'Roku OS':/android/i.test(agent)?'Android':/Windows/i.test(agent)?'Windows':/iPhone|iPad/i.test(agent)?'iOS':/Macintosh/i.test(agent)?'macOS':/Linux/i.test(agent)?'Linux':null;
   const name=platform==='Roku OS'?'Roku':platform==='Android'&&!/mozilla/i.test(agent)?'Android TV':({edg:'Edge',firefox:'Firefox',chrome:'Chrome',version:'Safari'})[browser?.[1].toLowerCase()]||'Unknown device';
   const device={name,platform,version:browser?.[2]||null};
   if(!['GET','HEAD'].includes(method)){
    const origin=req.headers.origin;const expected='http://'+req.headers.host;
    if(!origin||(origin!==expected&&origin!==publicOrigin)||req.headers['sec-fetch-site']==='cross-site')throw fail('This request must come from the Boreas page.',403);
   }
   const slotsName=accounts.cookieName+'_accounts';
   const cookieFlags='; Path=/; HttpOnly; SameSite=Strict'+(req.socket.encrypted?'; Secure':'');
   function appendCookie(value){res.appendHeader('Set-Cookie',value);}
   function writeSessionCookie(value){appendCookie(accounts.cookieName+'='+value.raw+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+(value.until===null?34560000:Math.max(1,Math.floor((value.until-Date.now())/1000)))+(req.socket.encrypted?'; Secure':''));}
   function setSession(value){writeSessionCookie(value);return {user:value.user,csrfToken:value.csrf,accountId:value.accountId||value.user.id,profiles:value.profiles||[value.user]};}
   function savedAccounts(active){
    if(!active.user||active.user.parentId)return [];
    const value=String(req.headers.cookie||'').split(';').map(part=>part.trim()).find(part=>part.startsWith(slotsName+'='))?.slice(slotsName.length+1)||'';
    const result=new Map();
    for(const candidate of value.split('.').slice(0,5)){
     if(!/^[A-Za-z0-9_-]{43}$/.test(candidate))continue;
     const details=accounts.status(candidate,{touch:false});
     if(details.user&&!details.user.parentId&&details.accountId!==active.accountId)result.set(details.accountId,{raw:candidate,user:details.user});
    }
    return [...result.values()];
   }
   function writeSavedAccounts(tokens){appendCookie(slotsName+'='+tokens.slice(0,5).join('.')+cookieFlags+'; Max-Age='+(tokens.length?34560000:0));}
   if(url.pathname==='/api/account/sessions'&&method==='POST'){
    const active=accounts.status(raw);
    accounts.verifyCSRF(raw,req.headers['x-lumen-csrf']);
    if(active.user.parentId)throw fail('Open the owner profile to switch accounts.',403);
    const input=await jsonBody(req),saved=savedAccounts(active);
    if(input.accountId){
     const target=saved.find(entry=>entry.user.id===input.accountId);
     if(!target)throw fail('That account session is unavailable.',404);
     await accounts.linkDevices([raw,...saved.map(entry=>entry.raw)]);
     writeSavedAccounts([raw,...saved.filter(entry=>entry!==target).map(entry=>entry.raw)]);
     writeSessionCookie({raw:target.raw,until:accounts.sessionExpiry(target.raw)});
     return send(200,accounts.status(target.raw));
    }
    const next=await accounts.login({...input,remember:'persistent'},req.socket.remoteAddress,device);
    await accounts.linkDevices([raw,next.raw,...saved.map(entry=>entry.raw)]);
    if(next.accountId!==active.accountId)writeSavedAccounts([raw,...saved.filter(entry=>entry.user.id!==next.accountId).map(entry=>entry.raw)]);
    else writeSavedAccounts(saved.map(entry=>entry.raw));
    return send(200,setSession(next));
   }
   if(url.pathname.startsWith('/discover-api/'))throw fail('Discover management is not available on the native dev backend yet.',501);
   if(url.pathname.startsWith('/tv-api/')){const status=accounts.status(raw);if(!['GET','HEAD'].includes(method))accounts.verifyCSRF(raw,req.headers['x-lumen-csrf']);if(await nativeTV(req,res,url,{raw,user:status.user,body:jsonBody,send}))return;}
   if(url.pathname==='/api/status'&&method==='GET'){if(accounts.isPersistent(raw))writeSessionCookie({raw,until:null});const status=accounts.status(raw),saved=savedAccounts(status);if(saved.length)await accounts.linkDevices([raw,...saved.map(entry=>entry.raw)]);return send(200,{savedAccounts:saved.map(entry=>entry.user),application:'lumen-native',version:'0.1.0',serverId:accounts.serverId,setupAllowed:!isPublic&&(allowSetup?allowSetup(req):local(req)),apps:{sports:appAvailable('sports'),liveTV:appAvailable('liveTV')},...status});}
   if(url.pathname==='/api/setup'&&method==='POST'){
    if(isPublic||!(allowSetup?allowSetup(req):local(req)))throw fail('Create the first administrator on the server PC at http://localhost:5180.',403);
    return send(201,setSession(await accounts.setup(await jsonBody(req),device)));
   }
   if(url.pathname==='/api/login'&&method==='POST'){if(accounts.status().setupRequired)throw fail('Complete first-run setup on the server PC.',409);return send(200,setSession(await accounts.login(await jsonBody(req),req.socket.remoteAddress,device)));}
   if(method==='GET'&&url.pathname.startsWith('/sports-capture-api/media/')&&capture.isInternalPlayback(url)&&['127.0.0.1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)&&req.headers.host==='127.0.0.1:'+req.socket.localPort){
    if(await capture(req,res,url))return;
   }
   if(url.pathname.startsWith('/sports-api/')||url.pathname.startsWith('/sports-capture-api/')){
    if(!appAvailable('sports'))throw fail('Sports is disabled on this server.',404);
    const status=accounts.status(raw);if(!status.user)throw fail('Sign in to view Sports.',401);
    const captureRequest=url.pathname.startsWith('/sports-capture-api/');
    requirePermission(status.user,'sports');if(captureRequest){req.lumenPermissions={...status.user.permissions,deleteMedia:status.user.role==='admin'||status.user.permissions.deleteMedia};if(url.pathname.includes('/settings')){if(status.user.role!=='admin')throw fail('Administrator access is required.',403);}else if(method==='DELETE')requirePermission(status.user,'deleteMedia');else if(method==='POST'&&url.pathname!=='/sports-capture-api/jobs'&&!/\/(watch|heartbeat|release|links)$/.test(url.pathname))requirePermission(status.user,'record');}
    if(!['GET','HEAD'].includes(method))accounts.verifyCSRF(raw,req.headers['x-lumen-csrf']);
    if(await (captureRequest?capture:sports)(req,res,url))return;
   }
   if(url.pathname.startsWith('/api/')){
    const status=accounts.status(raw);if(!status.user)throw fail('Sign in to continue.',401);
    if(!['GET','HEAD'].includes(method))accounts.verifyCSRF(raw,req.headers['x-lumen-csrf']);
    const libraryAccess=url.pathname.match(/^\/api\/(?:libraries|ratings)\/([a-f0-9-]{36})(?:\/|$)/);if(libraryAccess)requireLibrary(status.user,libraryAccess[1]);
    const admin=status.user.role==='admin';const requireAdmin=()=>{if(!admin)throw fail('Administrator access is required.',403);};
    if(method==='GET'&&url.pathname==='/api/calendar')return send(200,await connections.calendar(url.searchParams.get('start'),url.searchParams.get('end'),status.user));
    if(method==='GET'&&url.pathname==='/api/connections'){requireAdmin();return send(200,await connections.settings());}
    const connectionRoute=url.pathname.match(/^\/api\/connections\/(radarr|sonarr|qbittorrent)(\/test)?$/);
    if(connectionRoute&&method==='POST'){
      requireAdmin();
      const [,service,test]=connectionRoute;
      return send(200,test?await connections.test(service):await connections.save(service,await jsonBody(req)));
    }
    if(method==='GET'&&url.pathname==='/api/discover')return send(200,await discover.list((url.searchParams.get('q')||'').trim().slice(0,120),id=>canLibrary(status.user,id),url.searchParams.get('category')));
    const discoverRoute=url.pathname.match(/^\/api\/discover\/(movie|tv)\/([1-9]\d{0,9})(?:\/season\/([1-9]\d{0,2}))?(\/trailer)?$/);
    if(method==='GET'&&discoverRoute){
      const [,type,id,season,trailer]=discoverRoute;
      if(type==='movie'&&season)return send(404,{error:'Title unavailable.'});
      return send(200,trailer?{trailer:await discover.trailer(type,id,season)}:{item:await discover.detail(type,id,season)});
    }
    if(url.pathname==='/api/metadata/palette'&&method==='GET'){const art=await metadataArtwork(url.searchParams.get('path'));return send(200,await artworkPalette(art.content));}
    if(url.pathname==='/api/metadata/artwork'&&method==='GET'){const art=await metadataArtwork(url.searchParams.get('path'));res.writeHead(200,{'Content-Type':art.mime,'Cache-Control':'private, max-age=86400'});return res.end(art.content);}
    if(url.pathname==='/api/transcoder/settings'){requireAdmin();if(method==='GET')return send(200,transcoderSettings.get());if(method==='PATCH')return send(200,await transcoderSettings.save(await jsonBody(req)));}
    if(url.pathname==='/api/profiles'&&method==='GET')return send(200,accounts.status(raw));
    if(url.pathname==='/api/profiles/select'&&method==='POST')return send(200,await accounts.selectProfile(raw,await jsonBody(req)));
    const managedRoute=url.pathname.match(/^\/api\/users\/([a-f0-9-]{36})\/managed$/);if(managedRoute&&method==='POST')return send(201,{user:await accounts.createManaged(raw,managedRoute[1],await jsonBody(req,65536))});
    if(url.pathname==='/api/ratings/settings'){requireAdmin();if(method==='GET')return send(200,ratings.status());if(method==='PATCH')return send(200,await ratings.save(await jsonBody(req)));}
    const ratingsRoute=url.pathname.match(/^\/api\/ratings\/([a-f0-9-]{36})\/(item|series)\/([a-f0-9]{32})$/);if(ratingsRoute&&method==='GET'){const [,libraryId,kind,id]=ratingsRoute;return send(200,await ratings.lookup(libraryId,id,kind,admin));}
    if(url.pathname==='/api/metadata/settings'){requireAdmin();if(method==='GET')return send(200,metadata.status());if(method==='PATCH')return send(200,await metadata.save(await jsonBody(req)));}
    const actionsRoute=url.pathname.match(/^\/api\/libraries\/([a-f0-9-]{36})\/actions\/([a-f0-9]{32})$/);
    if(actionsRoute){const [,libraryId,id]=actionsRoute;if(method==='GET'){const kind=url.searchParams.get('kind')||'item',season=url.searchParams.has('season')?Number(url.searchParams.get('season')):null,summary=await progress.summary(status.user.id,libraryId,id,kind,season,admin),selection=await libraries.selection(libraryId,id,kind,season,admin);return send(200,{...summary,files:selection.items.length,kind,season,canDelete:admin||status.user.permissions.deleteMedia});}if(method==='PATCH')return send(200,await progress.mark(status.user.id,libraryId,id,await jsonBody(req),admin));if(method==='DELETE'){requirePermission(status.user,'deleteMedia');return send(200,await libraries.deleteMedia(libraryId,id,await jsonBody(req)));}}
    const artworkRoute=url.pathname.match(/^\/api\/libraries\/([a-f0-9-]{36})\/title-artwork\/(movie|series)\/([a-f0-9]{32})$/);
    if(artworkRoute){requireAdmin();const [,libraryId,kind,id]=artworkRoute;if(method==='GET')return send(200,await titleArtwork.options(libraries,libraryId,id,kind));if(method==='PATCH')return send(200,await titleArtwork.save(libraries,libraryId,id,kind,await jsonBody(req)));}
    if(url.pathname==='/api/search'&&method==='GET'){const page=await libraries.search({q:url.searchParams.get('q')||'',kind:url.searchParams.get('kind')||'titles',sort:url.searchParams.get('sort')||'title',offset:Number(url.searchParams.get('offset')||0),limit:Number(url.searchParams.get('limit')||30),allowedLibraryIds:status.user.permissions.libraryIds});return send(200,{...page,items:await progress.decorateTitles(status.user.id,null,page.items,admin)});}
    if(url.pathname==='/api/playback/profiles'&&method==='GET')return send(200,{profiles:TRANSCODE_PROFILES,limit:transcoderSettings.get().maxSessions});
    const sportsUpscale=url.pathname.match(/^\/api\/playback\/sports-upscale\/([a-f0-9-]{36})$/);
    if(sportsUpscale&&method==='POST'){
      requirePermission(status.user,'sports');
      const {profile='upscale1440p60'}=await jsonBody(req);
      if(typeof profile!=='string'||!/^(?:sdr(?:1080|720|480)|upscale(?:4k|1440p)(?:60)?(?:-[2-4]|-nis|-spline|-anime)?)$/.test(profile))throw fail('Choose a valid upscaling mode.');
      const input=await capture.liveInput(sportsUpscale[1],req.socket.localPort);
      try{return send(202,await transcoding.prepare(status.user.id,null,sportsUpscale[1],admin,{profile,webSubtitles:true},input));}
      catch(error){input.release();throw error;}
    }
    const gpuRoute=url.pathname.match(/^\/api\/playback\/gpu\/([a-f0-9-]{36})(?:\/(index\.m3u8|init\.mp4|segment\d{6}\.m4s))?$/);if(gpuRoute){const [,id,asset]=gpuRoute;const library=transcoding.libraryFor(status.user.id,id);if(library===null)requirePermission(status.user,'sports');else requireLibrary(status.user,library);if(!asset&&method==='GET')return send(200,await transcoding.status(status.user.id,id,admin));if(!asset&&method==='DELETE')return send(200,await transcoding.release(status.user.id,id));if(asset&&['GET','HEAD'].includes(method))return await sendMedia(req,res,await transcoding.asset(status.user.id,id,asset,admin));}
    if(url.pathname==='/api/playback/gpu'&&method==='POST'){const input=await jsonBody(req);return send(202,await (requireLibrary(status.user,input.libraryId),transcoding.prepare(status.user.id,input.libraryId,input.itemId,admin,input)));}
    if(url.pathname==='/api/playback/subtitles'&&method==='POST'){
      const input=await jsonBody(req);requireLibrary(status.user,input.libraryId);
      return send(200,await subtitleDelivery.prepare(status.user.id,input.libraryId,input.itemId,admin,input));
    }
    const subtitleAsset=url.pathname.match(/^\/api\/playback\/subtitles\/([a-f0-9-]{36})\/(subtitles\.(?:ass|vtt)|font-\d+\.(?:ttf|otf))$/);
    if(subtitleAsset&&['GET','HEAD'].includes(method)){requireLibrary(status.user,subtitleDelivery.libraryFor(status.user.id,subtitleAsset[1]));return await sendMedia(req,res,await subtitleDelivery.asset(status.user.id,subtitleAsset[1],subtitleAsset[2]));}
    if(url.pathname==='/api/playback/prepare'&&method==='POST'){const input=await jsonBody(req);return send(202,await (requireLibrary(status.user,input.libraryId),tracks.prepare(status.user.id,input.libraryId,input.itemId,admin,input)));}
    const preparedRoute=url.pathname.match(/^\/api\/playback\/jobs\/([a-f0-9-]{36})(?:\/(media|subtitles))?$/);if(preparedRoute){const [,id,action]=preparedRoute;requireLibrary(status.user,tracks.libraryFor(status.user.id,id));if(!action&&method==='GET')return send(200,await tracks.status(status.user.id,id,admin));if(!action&&method==='DELETE')return send(200,tracks.release(status.user.id,id));if(action&&['GET','HEAD'].includes(method))return await sendMedia(req,res,await tracks.media(status.user.id,id,action==='subtitles',admin));}
    if(url.pathname.startsWith('/api/live-tv/')){if(!appAvailable('liveTV'))throw fail('Live TV is disabled on this server.',404);requirePermission(status.user,'liveTV');const route=url.pathname.slice('/api/live-tv/'.length);
     const allowed=libraryId=>canLibrary(status.user,libraryId);
     if(route==='dvr'&&method==='GET')return send(200,{...dvr.list(allowed),canRecord:admin||status.user.permissions.record,destinations:dvr.destinations(allowed)});
     if(route==='dvr'&&method==='POST'){
       requirePermission(status.user,'record');
       const input=await jsonBody(req);
       return send(202,await dvr.create(input,allowed,input.streamId?()=>liveTV.release(status.user.id,input.streamId):null));
     }
     if(route==='dvr/channel'&&method==='GET')return send(200,{recording:dvr.channel(url.searchParams.get('id'),allowed)});
     const dvrRoute=route.match(/^dvr\/([a-f0-9-]{36})(?:\/(media|index\.m3u8|segment\d{6}\.ts|rule))?$/);
     if(dvrRoute){
       const [,id,asset]=dvrRoute;
       if(method==='DELETE'&&(!asset||asset==='rule')){requirePermission(status.user,'record');return send(200,await dvr.cancel(id,allowed,asset==='rule'));}
       if(method==='PATCH'&&!asset){requirePermission(status.user,'record');return send(200,await dvr.update(id,await jsonBody(req),allowed));}
       if(method==='GET'&&!asset)return send(200,await dvr.playback(id,allowed));
       if(asset&&asset!=='rule'&&['GET','HEAD'].includes(method))return await sendMedia(req,res,await dvr.asset(id,asset,allowed));
     }
     if(route==='tuners'){requireAdmin();if(method==='GET')return send(200,{tuners:liveTV.tuners()});if(method==='POST')return send(200,{tuners:await liveTV.add(await jsonBody(req))});if(method==='DELETE')return send(200,{tuners:await liveTV.remove((await jsonBody(req)).id)});}
     if(route==='channels'&&method==='GET')return send(200,await liveTV.guideChannels());
     if(route==='guide'&&method==='GET')return send(200,await liveTV.guideWindow(Number(url.searchParams.get('start')),Number(url.searchParams.get('end')),url.searchParams.get('q')||''));
     if(route==='streams'&&method==='POST')return send(202,await liveTV.start(status.user.id,await jsonBody(req)));
     const stream=route.match(/^streams\/([a-f0-9-]{36})(?:\/(index\.m3u8|segment\d{6}\.ts))?$/);if(stream){const [,id,asset]=stream;if(asset&&['GET','HEAD'].includes(method))return await sendMedia(req,res,await liveTV.asset(status.user.id,id,asset));if(!asset&&method==='GET')return send(200,await liveTV.status(status.user.id,id));if(!asset&&method==='DELETE')return send(200,await liveTV.release(status.user.id,id));}
    }
    if(url.pathname==='/api/media-analysis'){requireAdmin();
     if(method==='GET')return send(200,url.searchParams.has('coverage')?{...mediaAnalysis.status(),libraries:await mediaAnalysis.libraryCoverage()}:mediaAnalysis.status());
     if(method==='PATCH')return send(200,await mediaAnalysis.save(await jsonBody(req)));
     if(method==='POST'){for(const library of libraries.list(true).filter(entry=>entry.enabled))mediaAnalysis.enqueue(library.id,await libraries.analysisItems(library.id));return send(202,mediaAnalysis.status());}
    }
    if(url.pathname==='/api/dashboard'&&method==='GET'){requireAdmin();const snapshot=await dashboard.snapshot(url.searchParams.get("range")),sessions=dashboard.sessions(),users=new Map(accounts.list(cookie(req)).map(user=>[user.id,user.displayName||user.name]));const jobs=new Map(transcoding.sessions().map(job=>[job.gpuId,job]));const active=sessions.map(session=>{const job=jobs.get(session.gpuId);if(!job)return session;jobs.delete(session.gpuId);return {...session,profile:job.profile,bitrate:job.bitrate,targetBitrate:job.targetBitrate};});const gpu=[...jobs.values()].map(({userId,...job})=>({...job,user:users.get(userId)||'Viewer',device:'Processed stream'}));return send(200,{...snapshot,devices:accounts.devices(raw),sessions:[...active,...gpu]});}
    const bootDevice=url.pathname.match(/^\/api\/dashboard\/devices\/([a-f0-9]{64})$/);
    if(bootDevice&&method==='DELETE')return send(200,await accounts.revokeDevice(raw,bootDevice[1]));
    const endSession=url.pathname.match(/^\/api\/dashboard\/sessions\/([^/]+)$/);
    if(endSession&&method==='DELETE'){requireAdmin();const key=decodeURIComponent(endSession[1]),entry=dashboard.end(key),gpuId=entry?.gpuId||(key.startsWith('gpu:')?key.slice(4):null);if(gpuId)await transcoding.end(gpuId);return send(200,{ok:true});} 
    if(url.pathname==='/api/server/updates'&&(method==='GET'||method==='PATCH')){
     requireAdmin();
     const value=method==='PATCH'?await serverPreferences.saveUpdateChannel(await jsonBody(req)):serverPreferences.get();
     return send(200,{channel:value.updateChannel});
    }
    if(url.pathname==='/api/server/updates/check'&&method==='GET'){
     requireAdmin();return send(200,await checkUpdates(serverPreferences.get().updateChannel));
    }
    if(url.pathname==='/api/server/network'&&(method==='GET'||method==='PATCH')){
     requireAdmin();
     const value=method==='PATCH'?await serverPreferences.saveNetwork(await jsonBody(req)):serverPreferences.get();
     return send(200,{publicOrigin:value.publicOrigin});
    }
    if(url.pathname==='/api/server/apps'&&(method==='GET'||method==='PATCH')){
     requireAdmin();
     const value=method==='PATCH'?await serverPreferences.saveApps(await jsonBody(req)):serverPreferences.get();
     return send(200,{sports:value.sports,liveTV:value.liveTV});
    }
    if(url.pathname==='/api/storage/usage'&&method==='GET'){requireAdmin();return send(200,await dashboard.dataFolder());}
    if(url.pathname==='/api/storage'&&method==='GET'){requireAdmin();return send(200,{program:directory,data:dataDirectory,move:await storageMove.status()});}
    if(url.pathname==='/api/storage/move'&&method==='POST'){
     requireAdmin();
     const {folder}=await jsonBody(req);
     const roots=libraries.list(true).flatMap(library=>library.paths||[]);
     return send(202,{move:await storageMove.queue(folder,roots)});
    }
    if(url.pathname==='/api/playback/home'&&method==='GET'){return send(200,await recommendations.watching(status.user.id,libraries.list(false).filter(l=>canLibrary(status.user,l.id)).map(l=>l.id)));}
    if(url.pathname==='/api/filesystem'&&method==='GET'){requireAdmin();return send(200,await libraries.browse(url.searchParams.get('path')||''));}
    if(url.pathname==='/api/library-types'&&method==='GET')return send(200,{types:LIBRARY_TYPES});
    if(url.pathname==='/api/libraries/rescan'&&method==='POST'){
     requireAdmin();
     const entries=libraries.list(true);
     let queued=0,skipped=0;
     for(const library of entries){try{libraries.startScan(library.id);queued++;}catch(error){if(error.status!==409&&error.status!==404)throw error;skipped++;}}
     return send(202,{queued,skipped});
    }
    if(url.pathname==='/api/libraries'&&method==='GET')return send(200,{libraries:libraries.list(admin).filter(l=>canLibrary(status.user,l.id))});
    if(url.pathname==='/api/libraries'&&method==='POST'){requireAdmin();return send(202,{library:await libraries.create(await jsonBody(req))});}
    const libraryRoute=url.pathname.match(/^\/api\/libraries\/([a-f0-9-]{36})(?:\/(scan|recommended|hide-continue|items|artwork|thumbnail|item|match|series|series-play|media|progress|preferences|markers)(?:\/([a-f0-9]{32}))?)?$/);
    if(libraryRoute){const [,id,action,itemId]=libraryRoute;
     if(!action&&method==='PATCH'){requireAdmin();return send(202,{library:await libraries.update(id,await jsonBody(req))});}
     if(!action&&method==='DELETE'){requireAdmin();return send(200,await libraries.remove(id));}
     if(action==='scan'&&method==='POST'){requireAdmin();return send(202,{library:libraries.startScan(id)});}
     if(action==='preferences'&&itemId){if(method==='GET')return send(200,{preferences:await languages.series(status.user.id,id,itemId,admin,url.searchParams.get('scope')==='item')});if(method==='PATCH')return send(200,{preferences:await languages.save(status.user.id,id,itemId,await jsonBody(req),admin,url.searchParams.get('scope')==='item')});}
     if(action==='progress'&&itemId&&method==='POST'){
       const input=await jsonBody(req),key=status.user.id+'/'+String(input.sessionId||id+'/'+itemId);if(dashboard.isEnded(key)||input.gpuId&&dashboard.isEnded('gpu:'+input.gpuId))return send(200,{ended:true});if(input.gpuId)try{transcoding.libraryFor(status.user.id,input.gpuId);}catch{input.gpuId=null;}const playback=await progress.save(status.user.id,id,itemId,input,admin);
       const item=input.position>0||typeof input.playing==='boolean'?await libraries.item(id,itemId,admin):null;
       if(input.position>0&&recommendations.hidden(status.user.id,id,item))await mediaState.setHidden(status.user.id,tvId(id,item.seriesId?'series':'file',item.seriesId||item.id),false);
       if(typeof input.playing==='boolean')dashboard.playback(key,item,{...playback,playing:input.playing,stopped:input.stopped===true,user:status.user.displayName||status.user.name||'Viewer',device:'Web browser',network:dashboard.networkType(url),bitrate:input.gpuId?null:item.size*8/playback.duration,gpuId:typeof input.gpuId==='string'?input.gpuId:null,eventAt:Number(input.eventAt)||Date.now()});
       return send(200,{playback});
     }
     if(action==='recommended'&&method==='GET'){requireLibrary(status.user,id);return send(200,await recommendations.rows(status.user.id,id,admin));}
     if(action==='hide-continue'&&itemId&&method==='POST'){
       requireLibrary(status.user,id);
       const item=await libraries.item(id,itemId,admin);
       await mediaState.setHidden(status.user.id,tvId(id,item.seriesId?'series':'file',item.seriesId||item.id),true);
       return send(200,{ok:true});
     }
     if(action==='items'&&method==='GET'){const page=await libraries.listItems(id,{admin,view:url.searchParams.get('view')||'items',folder:url.searchParams.get('folder'),jump:url.searchParams.get('jump')||'',series:url.searchParams.get('series')||'',season:url.searchParams.get('season')??'',q:url.searchParams.get('q')||'',sort:url.searchParams.get('sort')||undefined,offset:Number(url.searchParams.get('offset')||0),limit:Number(url.searchParams.get('limit')||60)});return send(200,{...page,items:await progress.decorateTitles(status.user.id,id,page.items,admin)});}
     if(action==='match'&&itemId&&method==='POST'){requireAdmin();const input=await jsonBody(req);return send(200,{item:await libraries.matchMovie(id,itemId,input.tmdbId)});}
     if(action==='series-play'&&itemId&&method==='GET')return send(200,await progress.seriesStart(status.user.id,id,itemId,admin));
     if(action==='series'&&itemId&&method==='GET'){const series=await libraries.series(id,itemId,admin);series.playback=await progress.summary(status.user.id,id,itemId,'series',null,admin);for(const season of series.seasons)if(season.season!==null)season.playback=await progress.summary(status.user.id,id,itemId,'season',season.season,admin);return send(200,{series});}
     if(action==='markers'&&itemId){await libraries.item(id,itemId,admin);if(method==='GET')return send(200,{markers:playbackMarkers.get(id,itemId)});if(method==='PATCH'){requireAdmin();return send(200,{markers:await playbackMarkers.save(id,itemId,await jsonBody(req))});}}
     if(action==='media'&&itemId&&['GET','HEAD'].includes(method))return await sendMedia(req,res,await libraries.openMedia(id,itemId,admin));
     if(action==='item'&&itemId&&method==='GET'){const item=progress.decorate(status.user.id,id,[await libraries.item(id,itemId,admin)])[0],markers=playbackMarkers.get(id,itemId),detected=markers.intro||await mediaAnalysis.intro(id,item),credits=markers.credits||await mediaAnalysis.credits(id,item);const info=url.searchParams.get('playback')==='1'?await mediaInfo(id,itemId,admin):null;return send(200,{item,qualityOptions:info?playbackQualityOptions(transcoderSettings.get(),info.sourceBitrate,info.videoDetails):undefined,adjacent:await progress.adjacent(id,itemId,admin),markers:{...markers,...(detected?{intro:detected}:{}),...(credits?{credits}:{})},preferences:languages.effective(status.user.id,id,item,admin)});}
     if(action==='thumbnail'&&itemId&&method==='GET'){if(url.searchParams.get('info')==='1')return send(200,{generated:await videoThumbnails.available(id,itemId,admin)});const art=await videoThumbnails.get(id,itemId,admin,url.searchParams.has('at')?Math.min(86400,Math.max(0,Math.floor((Number(url.searchParams.get('at'))||0)/15)*15)):null);res.writeHead(200,{'Content-Type':art.mime,'Cache-Control':'private, no-cache'});res.end(art.content);return;}
     if(action==='artwork'&&itemId&&method==='GET'){const art=await libraries.artwork(id,itemId,admin);res.writeHead(200,{'Content-Type':art.mime,'Cache-Control':'private, no-cache'});res.end(art.content);return;}
    }
    if(url.pathname==='/api/logout'&&method==='POST'){await accounts.logout(raw);writeSavedAccounts([]);appendCookie(accounts.cookieName+'='+cookieFlags+'; Max-Age=0');return send(200,{ok:true});}
    if(url.pathname==='/api/account'&&method==='PATCH')return send(200,{user:await accounts.profile(raw,await jsonBody(req,32768))});
    if(url.pathname==='/api/account/password'&&method==='POST')return send(200,setSession(await accounts.changePassword(raw,await jsonBody(req))));
    if(url.pathname==='/api/users'&&method==='GET')return send(200,{users:accounts.list(raw)});
    if(url.pathname==='/api/users'&&method==='POST')return send(201,{user:await accounts.create(raw,await jsonBody(req,65536))});
    const match=url.pathname.match(/^\/api\/users\/([a-f0-9-]{36})(\/password)?$/);
    if(match&&method==='PATCH'&&!match[2])return send(200,{user:await accounts.update(raw,match[1],await jsonBody(req,65536))});
    if(match&&method==='POST'&&match[2])return send(200,await accounts.resetPassword(raw,match[1],await jsonBody(req)));
    return send(404,{error:'This endpoint is not available in Boreas.'});
   }
   if(method!=='GET'&&method!=='HEAD')throw fail('Method not allowed.',405);
   const relative=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);if(relative.includes('\0'))throw fail('Invalid path.');const filename=path.resolve(publicRoot,'.'+relative);if(!filename.startsWith(path.resolve(publicRoot)+path.sep))throw fail('Not found.',404);
   const mime={'.woff2':'font/woff2','.wasm':'application/wasm','.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon'};
   if(!mime[path.extname(filename)])throw fail('Not found.',404);
   let content;try{if(!(await stat(filename)).isFile())throw Error();content=await readFile(filename);}catch{throw fail('Not found.',404);}
   res.writeHead(200,{'Content-Type':mime[path.extname(filename)],'Cache-Control':'no-cache'});res.end(method==='HEAD'?undefined:content);
  }catch(error){if(!res.headersSent)send(error.status||500,{error:error.status?error.message:'Boreas could not complete the request. Try again.'});else res.destroy();}
 });
 server.requestTimeout=15000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
 server.on('close',()=>{dashboard.close();stopScanListener();void mediaAnalysis.close();void playbackMarkers.close();void dvr.close().catch(error=>console.error('Live TV DVR:',error.message)).finally(()=>liveTV.close());void videoThumbnails.close();void mediaState.close();void titleArtwork.close();void capture.close();libraryWatcher.close();void libraries.close();void progress.close();void languages.close();void subtitleDelivery.close();void tracks.close();void transcoding.close();void ratings.close();void transcoderSettings.close();});
 return {server,videoThumbnails,accounts,libraries,metadata,progress,languages,tracks,titleArtwork,transcoding,ratings,transcoderSettings,libraryWatcher};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{await stat(path.join(process.env.BOREAS_RUNTIME||here,'.storage-move.lock'));throw Error('Data move is in progress.');}catch(e){if(e.code!=='ENOENT')throw e;}
 const config=JSON.parse(await readFile(path.join(process.env.BOREAS_RUNTIME||here,'boreas.config.json'),'utf8').catch(error=>{if(error.code!=='ENOENT')throw error;return readFile(path.join(here,'lumen-native.config.json'),'utf8');}));
 const port=Number(process.env.LUMEN_NATIVE_PORT||config.port||5180),host=process.env.LUMEN_NATIVE_HOST||config.host||'0.0.0.0';if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Choose a port from 1024 to 65535.');
 const {server,libraries,metadata}=await createApplication({enableMediaAnalysis:true,publicOrigin:config.publicOrigin||'',appDefaults:config.apps,dataDirectory:path.resolve(here,config.dataDirectory||'data'),sportsDirectory:process.env.BOREAS_RUNTIME||here});
 if(process.env.LUMEN_NATIVE_REFRESH_ANIME==='1'&&metadata.status().configured)for(const library of libraries.list(true).filter(l=>l.type==='anime'))libraries.startScan(library.id);
 if(process.env.LUMEN_NATIVE_REFRESH_TV==='1'&&metadata.status().configured)for(const library of libraries.list(true).filter(l=>['shows','anime'].includes(l.type)))libraries.startScan(library.id);
 if(process.env.LUMEN_NATIVE_REFRESH_MOVIES==='1'&&metadata.status().configured)for(const library of libraries.list(true).filter(l=>l.type==='movies'))libraries.startScan(library.id);
 server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`Port ${port} is already in use. No existing server was stopped.`:error.message);process.exitCode=1;});
 if(host==='0.0.0.0'){
   const discovery=dgram.createSocket('udp4');
   discovery.on('error',error=>console.warn('Native TV discovery:',error.message));
   discovery.on('message',(message,remote)=>{
     if(message.length>512)return;
     const subnet=remote.address.split('.').slice(0,3).join('.')+'.';
     const address=localAddresses().find(ip=>ip.startsWith(subnet));
     if(!address)return;
     let query;
     try{query=JSON.parse(message.toString());}catch{return;}
     if(query?.protocol!=='lumen-tv/1'||query.type!=='discover'||typeof query.nonce!=='string'||!/^[a-zA-Z0-9_-]{8,64}$/.test(query.nonce))return;
     discovery.send(JSON.stringify({protocol:query.protocol,type:'server',nonce:query.nonce,backend:'lumen-native',name:'Boreas',url:'http://'+address+':'+port}),remote.port,remote.address);
   });
   discovery.bind(47778,'0.0.0.0',()=>discovery.unref());
   server.on('close',()=>{try{discovery.close();}catch{}});
 }
 server.listen(port,host,()=>{console.log(`Boreas: http://localhost:${port}`);for(const address of localAddresses())console.log(`LAN: http://${address}:${port}`);console.log('Independent local accounts. First-run setup is available on this PC.');});
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit()));
}
