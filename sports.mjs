import {normalizeF1} from './sports-f1.mjs';
import {normalizeNFL,parseNFLListings} from './sports-nfl.mjs';
import {streamChoices} from './apps/sports-capture/sources.mjs';
const normalize=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
export function normalizeNHL(data){const team=t=>({name:[t.placeName?.default,t.commonName?.default].filter(Boolean).join(' '),abbrev:t.abbrev,logo:/^[A-Z]{2,3}$/.test(t.abbrev||'')?'https://assets.nhle.com/logos/nhl/svg/'+t.abbrev+'_dark.svg':'',score:t.score??null});return (data.gameWeek||[]).map(day=>({date:day.date,games:(day.games||[]).map(g=>({id:g.id,start:g.startTimeUTC,state:g.gameState,scheduleState:g.gameScheduleState,venue:g.venue?.default||'',away:team(g.awayTeam),home:team(g.homeTeam),broadcasts:[...new Set((g.tvBroadcasts||[]).map(b=>b.network.trim()))],period:g.periodDescriptor?.number||0,gameCenter:'https://www.nhl.com'+(g.gameCenterLink?.startsWith('/gamecenter/')?g.gameCenterLink:'/scores')}))}));}
function projectedLines(html,game){
 const published=html.match(/"datePublished"\s*:\s*"([^"]+)"/)?.[1];
 if(!published||!Number.isFinite(Date.parse(published)))return null;
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(published));
 if(date!==game.gameDate)return null;
 const plain=value=>value.replace(/<[^>]+>/g,'').replace(/&(?:nbsp|#160);/g,' ').replace(/&(?:apos|#39);/g,"'").replace(/&amp;/g,'&').trim();
 const names=[game.awayTeam?.commonName?.default,game.homeTeam?.commonName?.default];
 if(names.some(name=>!name))return null;
 const matchup=html.split(/<h2\b[^>]*>/i).slice(1).find(section=>{
  const [away,home]=plain(section.split(/<\/h2>/i)[0]).split(/\s+at\s+/i);
  return normalize(away).startsWith(normalize(names[0]))&&normalize(home).startsWith(normalize(names[1]));
 });
 if(!matchup)return null;
 const paragraphs=[...matchup.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(match=>plain(match[1]));
 return names.map(name=>{
  const index=paragraphs.findIndex(line=>normalize(line)===normalize(name+' projected lineup'));
  if(index<0)return null;
  const lines=[],pairs=[],goalies=[];
  for(const line of paragraphs.slice(index+1)){
   if(/^(scratched|injured|status report)|projected lineup/i.test(line))break;
   const players=line.split(/\s+(?:--|–|—)\s+/).map(name=>name.trim()).filter(Boolean);
   if(players.length===3)lines.push(players);
   else if(players.length===2)pairs.push(players);
   else if(players.length===1)goalies.push(players[0]);
  }
  return lines.length||pairs.length?{lines,pairs,goalies:goalies.slice(-2)}:null;
 });
}
export function createSportsHandler({authorize,fetcher=fetch,now=()=>Date.now()}={}){
 const cache=new Map();
 const lineupCache=new Map();
 async function json(url,ttl){const old=cache.get(url);if(old&&old.until>now())return old.value;const r=await fetcher(url,{signal:AbortSignal.timeout(12000),redirect:'error'});if(!r.ok)throw Error('The sports data provider is unavailable. Try again shortly.');const value=await r.json();if(cache.size>64)cache.delete(cache.keys().next().value);cache.set(url,{value,until:now()+ttl});return value;}
 return async(req,res,url)=>{if(!url.pathname.startsWith('/sports-api/'))return false;const send=(status,value)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));return true;};try{
  if(req.method!=='GET')return send(405,{error:'Method not allowed.'});if(!await authorize(req.headers.authorization))return send(401,{error:'Sign in to Boreas to view Sports.'});
  if(url.pathname==='/sports-api/nhl/standings'){
   const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now()));
   const data=await json('https://api-web.nhle.com/v1/standings/'+date,600000);
   const teams=Object.fromEntries((data.standings||[]).filter(team=>team.teamAbbrev?.default).map(team=>[
    team.teamAbbrev.default,{record:[team.wins,team.losses,team.otLosses].join('–'),points:team.points,division:team.divisionName,rank:team.divisionSequence,streak:team.streakCode&&team.streakCount?team.streakCode+team.streakCount:null}
   ]));
   return send(200,{teams});
  }
  const boxscore=url.pathname.match(/^\/sports-api\/nhl\/game\/(\d{10})$/);
  if(boxscore){
   const game=await json('https://api-web.nhle.com/v1/gamecenter/'+boxscore[1]+'/boxscore',30000);
   const side=async(sideName)=>{
    const team=game[sideName],abbrev=team?.abbrev,season=String(game.season||'');
    if(!/^[A-Z]{2,3}$/.test(abbrev||'')||!/^\d{8}$/.test(season))return {players:[],source:'unavailable'};
    const box=game.playerByGameStats?.[sideName];
    const groups=['forwards','defense','goalies'];
    const gamePlayers=groups.flatMap(group=>(box?.[group]||[]).map(player=>({
      id:player.playerId,name:player.name?.default,number:player.sweaterNumber,position:player.position,group,
      starter:group==='goalies'&&player.starter===true
    })));
    let players=gamePlayers,source='game';
    if(!players.length){
      source='season';
      const roster=await json('https://api-web.nhle.com/v1/roster/'+abbrev+'/'+season,3600000).catch(()=>null);
      players=groups.flatMap(group=>(roster?.[group==='defense'?'defensemen':group]||[]).map(player=>({
        id:player.id,name:[player.firstName?.default,player.lastName?.default].filter(Boolean).join(' '),
        number:player.sweaterNumber,position:player.positionCode,group,starter:false
      })));
    }
    return {source,score:team.score??null,shots:team.sog??null,players:players.filter(player=>player.name).map(player=>({
      ...player,headshot:Number.isSafeInteger(player.id)?'https://assets.nhle.com/mugs/nhl/'+season+'/'+abbrev+'/'+player.id+'.png':null
    }))};
   };
   const year=Number(String(game.season||'').slice(0,4));
   const article=year>=2025&&year<=2100?'https://www.nhl.com/news/nhl-lineup-projections-'+year+'-'+String(year+1).slice(-2)+'-season':null;
   async function projections(){
    if(!article||!game.gameDate||!['FUT','PRE','LIVE','CRIT'].includes(game.gameState))return null;
    let entry=lineupCache.get(article);
    if(!entry||entry.until<=now()){
     if(lineupCache.size>=4)lineupCache.clear();
     const request=fetcher(article,{signal:AbortSignal.timeout(5000),redirect:'error'}).then(response=>response.ok?response.text():'').catch(()=>'');
     entry={until:now()+300000,request};lineupCache.set(article,entry);
    }
    return projectedLines(await entry.request,game);
   }
   const [away,home,lines]=await Promise.all([side('awayTeam'),side('homeTeam'),projections()]);
   return send(200,{away:{...away,projection:lines?.[0]},home:{...home,projection:lines?.[1]},projectionSource:lines?.some(Boolean)?article:null});
  }
  const route=url.pathname.match(/^\/sports-api\/(nhl|nfl|f1)\/(schedule|sources)$/);if(!route)return send(404,{error:'Sports endpoint not found.'});const league=route[1],action=route[2];
  async function choices(source){const r=await fetcher(source,{signal:AbortSignal.timeout(12000),redirect:'error'});if(!r.ok)throw Error('Stream options are temporarily unavailable.');return streamChoices(await r.text(),source);}
  if(league==='nfl'&&action==='sources'&&url.searchParams.get('game')==='nfl-network'){const sources=await choices('https://crackstreams.mx/stream/nfl-network');return send(200,{sources,message:sources.length?'Choose a stream to watch inside Lumen.':'No stream options are published right now.'});}
  const date=url.searchParams.get('date');if(!/^20\d\d-\d\d-\d\d$/.test(date||'')||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)return send(400,{error:'Choose a valid date.'});
  let days;if(league==='nhl')days=normalizeNHL(await json('https://api-web.nhle.com/v1/schedule/'+date,30000));else {const dates=Array.from({length:7},(_,i)=>new Date(Date.parse(date)+i*86400000).toISOString().slice(0,10));const feeds=await Promise.all(dates.map(d=>json('https://site.api.espn.com/apis/site/v2/sports/'+(league==='f1'?'racing/f1':'football/nfl')+'/scoreboard?dates='+d.replaceAll('-',''),60000)));days=(league==='f1'?normalizeF1(feeds):normalizeNFL(feeds)).filter(d=>dates.includes(d.date));}
  if(action==='schedule')return send(200,{days,updatedAt:new Date(now()).toISOString()});
  const game=days.flatMap(d=>d.games).find(g=>String(g.id)===url.searchParams.get('game'));if(!game)return send(404,{error:'Game not found in this schedule.'});
  if(['OFF','FINAL'].includes(game.state))return send(200,{sources:[],message:'This game has finished. Live sources are no longer listed.'});
  const r=await fetcher('https://crackstreams.mx/league/'+league+'streams',{signal:AbortSignal.timeout(12000),redirect:'error'});if(!r.ok)throw Error('Stream listings are temporarily unavailable.');
  const eastern=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(game.start));
  const listings=parseNFLListings(await r.text()).filter(s=>s.date===eastern&&(league==='f1'?(normalize(game.eventName).includes(normalize(s.name))||normalize(s.name).includes(normalize(game.eventName))):[game.away,game.home].every(t=>normalize(s.name).includes(normalize(t.name)))));
  const results=await Promise.allSettled(listings.slice(0,5).map(s=>choices(s.url)));
  const sources=results.flatMap(r=>r.status==='fulfilled'?r.value:[]);
  return send(200,{sources,message:sources.length?'Choose a stream to watch inside Lumen.':results.some(r=>r.status==='rejected')?'Stream options could not be loaded. Please retry.':'No stream options are published for this game yet. Check again near game time.'});
 }catch(error){return send(error.status===401?401:502,{error:error.status===401?'Please sign in again.':error.message||'Sports is temporarily unavailable.'});}};
}
