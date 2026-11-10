let sportsTimer=null,sportsAbort=null,sportsTransition=null;
function trySportsTransition(route){return sportsTransition?.(route)===true;}
function cleanupSports(){sportsTransition=null;globalThis.SportsCapture?.cleanup();clearTimeout(sportsTimer);sportsAbort?.abort();sportsAbort=null;}
function sportsDate(){const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');}
async function sportsAPI(path,signal,league='nhl'){const r=await fetch('/sports-api/'+league+'/'+path,{credentials:'same-origin',signal});const data=await r.json();if(!r.ok)throw Error(data.error||'Unable to load Sports.');return data;}
function sportsState(g){if(g.state==='REPLAY')return 'Replay';if(g.scheduleState==='PPD')return 'Postponed';if(g.scheduleState==='CNCL')return 'Cancelled';if(['LIVE','CRIT'].includes(g.state))return '● Live'+(g.statusDetail?' · '+g.statusDetail:g.period?' · Period '+g.period:'');if(['OFF','FINAL'].includes(g.state))return 'Final';return new Date(g.start).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});}
function sportsGameLive(game){return ['LIVE','CRIT'].includes(game.state);}
function compareSportsGames(a,b){return (Date.parse(a.start)||Infinity)-(Date.parse(b.start)||Infinity);}
const sportsLeagues={nhl:{name:'NHL',sport:'Hockey',headline:'The ice is calling.',description:'Your week in hockey. Games, scores, and places to watch.',mark:'🏒',credit:'NHL'},nfl:{name:'NFL',sport:'Football',headline:'Every down. Every game.',description:'Kickoff times, matchups, and places to watch.',mark:'🏈',credit:'ESPN'},f1:{name:'F1',sport:'Formula 1',mark:'🏎️',credit:'ESPN'}};
function sportsTabLinks(){
 return [['','Home'],['recordings','Recordings']]
   .map(([id,label])=>'<a href="#sports'+(id?'/'+id:'')+'">'+esc(label)+'</a>').join('');
}
function sportsDayOffset(date,offset){const d=new Date(date+'T12:00:00');d.setDate(d.getDate()+offset);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');}
function sportsLanding(){return '<section class="sports-page"><div class="sports-leagues">'+Object.entries(sportsLeagues).map(([id,l])=>`<a class="card sports-league sports-league-${id}" href="#sports/${id}"><div class="poster sports-league-art"><span class="sports-league-icon" aria-hidden="true">${l.mark}</span><span class="sports-league-wordmark">${l.name}</span><span class="sports-league-tag">${l.sport}</span></div><span class="card-title">${l.name} · ${l.sport}</span></a>`).join('')+'</div></section>';}
async function renderSports(gen,league='',gameId,params){
 cleanupSports();
 if(league==='recordings'){$('#main').innerHTML='<section class="sports-page" id="sports-recordings"></section>';await SportsCapture.mount();return;}
 if(!sportsLeagues[league]){$('#main').innerHTML=sportsLanding();return;}
 const info=sportsLeagues[league],main=$('#main');
 main.innerHTML='<section class="web-home-hero sports-feature" aria-label="Featured matchup"><h1>'+esc(info.name)+'</h1></section><p id="sports-message" role="status"></p><div id="home-rows" class="sports-home-rows"></div>';
 const feature=main.querySelector('.sports-feature');
 if(gameId){
   main.querySelector('#home-rows').remove();
   feature.classList.add('sports-game-detail');
   main.insertAdjacentHTML('beforeend','<section class="sports-detail-stats" aria-label="Game details"></section>');
 }
 const colors={ANA:'#F47A38',BOS:'#FFB81C',BUF:'#003087',CGY:'#C8102E',CAR:'#CC0000',CHI:'#CF0A2C',COL:'#6F263D',CBJ:'#002654',DAL:'#006847',DET:'#CE1126',EDM:'#FF4C00',FLA:'#C8102E',LAK:'#A2AAAD',MIN:'#154734',MTL:'#AF1E2D',NSH:'#FFB81C',NJD:'#CE1126',NYI:'#00539B',NYR:'#0038A8',OTT:'#C52032',PHI:'#F74902',PIT:'#FCB514',SJS:'#006D75',SEA:'#355464',STL:'#002F87',TBL:'#002868',TOR:'#00205B',UTA:'#6CACE4',VAN:'#00205B',VGK:'#B4975A',WSH:'#C8102E',WPG:'#041E42'};
 let selected=null,standings=null;
 const formatDate=start=>new Date(start).toLocaleString([],{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
 const logo=team=>'<div class="sports-logo-stack"><strong>'+esc(team.name)+'</strong>'+(team.logo?'<img class="sports-feature-logo" src="'+esc(team.logo)+'" alt="">':'<span class="sports-feature-logo">'+esc(team.abbrev||'')+'</span>')+'</div>';
 function teamPanel(team,side){
   const stats=standings?.[team.abbrev],record=stats?.record||team.record;
   const details=[stats?.points!=null?stats.points+' points':null,stats?.division&&stats?.rank?'#'+stats.rank+' in '+stats.division:null,stats?.streak?'Streak '+stats.streak:null].filter(Boolean);
   return '<section class="sports-team-info"><span class="sports-side">'+(side==='away'?'Away':'Home')+'</span><strong>'+esc(record||'Record unavailable')+'</strong>'+details.map(detail=>'<p>'+esc(detail)+'</p>').join('')+'</section>';
 }
 function select(game,force=false){
   if(!game||(!force&&selected===game))return;
   selected=game;
   const date='<p class="sports-game-date">'+esc(formatDate(game.start))+'</p>';
   const actions=gameId?'<div class="sports-detail-actions"></div>':'';
   const details='<div class="sports-game-meta"><p>'+esc(game.venue||'')+'</p><p>'+esc((game.broadcasts||[]).join(' · '))+'</p>'+actions+'</div>';
   if(game.title){
     feature.innerHTML='<div class="sports-game-info"><h1>'+esc(game.title)+'</h1>'+date+details+'</div>';
     if(gameId)bindSportsActions(feature,game,params.get('date'),gen,league);
     NativeAtmosphere.teamColors('#53252e','#181c2e');
     return;
   }
   feature.innerHTML='<div class="sports-matchup-details">'+teamPanel(game.away,'away')+logo(game.away)+'<div class="sports-game-info">'+date+'<span class="sports-versus" aria-label="Versus">VS</span>'+details+'</div>'+logo(game.home)+teamPanel(game.home,'home')+'</div>';
   if(gameId)bindSportsActions(feature,game,params.get('date'),gen,league);
   const color=team=>team.color||(league==='nhl'?colors[team.abbrev]:null)||'#27364b';
   NativeAtmosphere.teamColors(color(game.away),color(game.home));
 }
 if(league==='nhl')sportsAPI('standings',undefined,league).then(data=>{
   if(gen!==routeVersion&&!feature.dataset.gameOpened)return;
   if(!feature.isConnected)return;
   standings=data.teams;
   if((gameId||feature.dataset.gameOpened)&&selected){feature.querySelectorAll('.sports-team-info').forEach((panel,index)=>{panel.outerHTML=teamPanel(index?selected.home:selected.away,index?'home':'away');});}
   else select(selected,true);
 }).catch(()=>{});
 if(gameId){
   const date=params.get('date');
   const message=$('#sports-message');
   const controller=new AbortController();sportsAbort=controller;
   if(!/^20\d{2}-\d{2}-\d{2}$/.test(date||'')){message.textContent='Choose a game from the schedule.';return;}
   message.textContent='Loading matchup…';
   try{
     const data=await sportsAPI('schedule?date='+encodeURIComponent(date),controller.signal,league);
     if(gen!==routeVersion)return;
     const game=data.days.flatMap(day=>day.games).find(game=>String(game.id)===gameId);
     if(!game)throw Error('This game is no longer in the schedule.');
     message.textContent='';
     select(game);
     const stats=main.querySelector('.sports-detail-stats');
     showSportsGameStats(stats,game,league);
     if(league==='nhl')sportsAPI('game/'+encodeURIComponent(game.id),controller.signal,league).then(box=>{
       if(gen===routeVersion)showSportsGameStats(stats,game,league,box);
     }).catch(()=>{if(gen===routeVersion)showSportsGameStats(stats,game,league,{});});
   }catch(error){if(gen===routeVersion&&error.name!=='AbortError')message.textContent=error.message;}
   return;
 }
 let revision=0;
 async function load(quiet=false){
  const rev=++revision;clearTimeout(sportsTimer);sportsAbort?.abort();sportsAbort=new AbortController();
  const today=sportsDate(),start=sportsDayOffset(today,-1),end=sportsDayOffset(today,6);
  if(!quiet)$('#sports-message').textContent='Loading games…';
  try{
   const results=await Promise.all([start,end].map(date=>sportsAPI('schedule?date='+date,sportsAbort.signal,league)));
   if(gen!==routeVersion||rev!==revision)return;
   const days=new Map();for(const result of results)for(const day of result.days){if(day.date<start||day.date>end)continue;if(!days.has(day.date))days.set(day.date,new Map());for(const game of day.games)days.get(day.date).set(String(game.id),game);}
   const ordered=Array.from({length:8},(_,i)=>{const date=sportsDayOffset(today,i-1);const games=[...(days.get(date)?.values()||[])];return [date,date<today?games.filter(sportsGameLive):games];});
   $('#sports-message').textContent='';
   const pane=main.querySelector('#home-rows'),cards=[];
   const previousScroll=pane.scrollTop;
   const focused=document.activeElement?.dataset.game;
   const sections=ordered.filter(([,games])=>games.length).map(([date,games])=>{
     const label=date===today?'Today':new Date(date+'T12:00:00').toLocaleDateString([],{weekday:'long',month:'short',day:'numeric'});
     return '<div data-row-kind="sports"><section class="section sports-day"><div class="section-heading"><h2>'+esc(label)+'</h2><div class="row-controls"><button data-home-scroll="-1" aria-label="Scroll games left">‹</button><button data-home-scroll="1" aria-label="Scroll games right">›</button></div></div><div class="poster-row sports-grid">'+games.sort(compareSportsGames).map(game=>{
       const index=cards.push(game)-1,live=sportsGameLive(game);
       const teams=game.title?[game.away]:[game.away,game.home];
       const art=teams.map(team=>team.logo?'<img src="'+esc(team.logo)+'" alt="" loading="lazy">':'<span>'+esc(team.abbrev||team.name)+'</span>').join(teams.length>1?'<span class="sports-card-vs">VS</span>':'');
       return '<button class="sports-game sports-simple-card" data-home-item="'+index+'" data-game="'+esc(game.id)+'" data-date="'+esc(date)+'" aria-label="'+esc(game.title||game.away.name+' vs '+game.home.name)+'"><span class="sports-simple-art">'+art+'</span>'+(live?'<span class="sports-card-time is-live">● Live</span>':'<time class="sports-card-time" datetime="'+esc(game.start)+'">'+esc(new Date(game.start).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}))+'</time>')+'<span class="sports-simple-title">'+esc(game.title||game.away.abbrev+' vs '+game.home.abbrev)+'</span></button>';
     }).join('')+'</div></section></div>';
   });
   pane.innerHTML=sections.join('')||'<div class="sports-empty">No games scheduled this week.</div>';
   for(const button of pane.querySelectorAll('[data-home-item]')){
     const game=cards[Number(button.dataset.homeItem)];
     button.onfocus=button.onpointerenter=()=>select(game);
     button.onclick=()=>{location.hash='sports/'+league+'/'+encodeURIComponent(game.id)+'?date='+encodeURIComponent(button.dataset.date);};
   }
   for(const button of pane.querySelectorAll('[data-home-scroll]'))button.onclick=()=>{
     const row=button.closest('.section').querySelector('.poster-row');
     row.scrollBy({left:Number(button.dataset.homeScroll)*row.clientWidth*.8,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
   };
   sportsTransition=route=>{
     const [path,query]=route.split('?');
     const [section,routeLeague,id]=path.split('/');
     if(section!=='sports'||routeLeague!==league||!id||!pane.isConnected)return false;
     const date=new URLSearchParams(query).get('date');
     const game=days.get(date)?.get(id);
     if(!game)return false;
     sportsTransition=null;
     clearTimeout(sportsTimer);
     sportsAbort?.abort();
     const controller=new AbortController();sportsAbort=controller;
     if(selected!==game)select(game);
     feature.dataset.gameOpened='true';
     feature.style.height=feature.getBoundingClientRect().height+'px';
     feature.style.minHeight='0';
     const transitionVersion=++routeVersion;
     const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches||document.body.classList.contains('reduce-motion');
     pane.inert=true;
     pane.classList.add('sports-rows-leaving');
     const ready=league==='nhl'?sportsAPI('game/'+encodeURIComponent(game.id),controller.signal,league).catch(()=>({})):Promise.resolve({});
     setTimeout(()=>{
       if(routeVersion!==transitionVersion||!pane.isConnected)return;
       cleanupNativeHomeRows();
       pane.remove();
       const actions=document.createElement('div');
       actions.className='sports-detail-actions sports-detail-enter';
       feature.querySelector('.sports-game-meta').append(actions);
       bindSportsActions(feature,game,date,transitionVersion,league);
       const stats=document.createElement('section');
       stats.className='sports-detail-stats sports-detail-enter';
       stats.setAttribute('aria-label','Game details');
       main.append(stats);
       showSportsGameStats(stats,game,league);
       ready.then(box=>{if(routeVersion===transitionVersion&&stats.isConnected)showSportsGameStats(stats,game,league,box);});
       actions.querySelector('button')?.focus({preventScroll:true});
     },reduce?0:180);
     return true;
   };
   setupNativeHomeRows(main,cards,select);
   if(previousScroll)pane.scrollTop=previousScroll;
   if(focused)[...pane.querySelectorAll('[data-game]')].find(button=>button.dataset.game===focused)?.focus({preventScroll:true});
  }catch(e){if(e.name==='AbortError'||gen!==routeVersion||rev!==revision)return;$('#sports-message').textContent=e.message;}
  if(gen===routeVersion&&rev===revision)sportsTimer=setTimeout(()=>load(true),60000);
 }
 await load();
}

function bindSportsActions(feature,game,date,gen,league){
 const host=feature.querySelector('.sports-detail-actions');
 const status=$('#sports-message');
 const title=game.title||game.away.name+' at '+game.home.name;
 const finished=['OFF','FINAL'].includes(game.state)||['PPD','CNCL'].includes(game.scheduleState);
 if(finished)return;
 const add=(label,action)=>{
   const button=document.createElement('button');
   button.className=label==='Play'?'primary':'subtle';
   button.textContent=label;
   button.onclick=async()=>{
     for(const control of host.querySelectorAll('button'))control.disabled=true;
     try{await action(button);}
     catch(error){if(gen===routeVersion)status.textContent=error.message;}
     finally{if(gen===routeVersion)for(const control of host.querySelectorAll('button'))control.disabled=control.dataset.saved==='true';}
   };
   host.append(button);
 };
 add('Play',async()=>{
   status.textContent='Finding the first stream…';
   const result=await sportsAPI('sources?'+new URLSearchParams({date,game:String(game.id)}),sportsAbort?.signal,league);
   if(gen!==routeVersion)return;
   if(!result.sources?.length)throw Error(result.message||'No stream is available yet.');
   NativePlayer.openSports(result.sources[0],title,false);
 });
 if(session.role==='admin'||session.permissions?.record)add('Record',async button=>{
   status.textContent='Scheduling recording…';
   await SportsCapture.api('schedule','POST',{league,date,game:String(game.id)});
   if(gen!==routeVersion)return;
   button.textContent='Recording scheduled';button.dataset.saved='true';
   status.textContent='Boreas will record the first available stream.';
 });
}
function showSportsGameStats(host,game,league,box){
 if(league!=='nhl'){
   host.innerHTML='<h2>Game status</h2><p>'+esc(sportsState(game))+'</p>';
   return;
 }
 if(!box){host.innerHTML='<p role="status">Loading team rosters…</p>';return;}
 const card=player=>'<article class="sports-player-card"><div class="sports-headshot">'+
   (player.headshot?'<img src="'+esc(player.headshot)+'" alt="" loading="lazy">':'')+'</div><div><strong>'+esc(player.name)+'</strong><small>'+
   esc([player.number!=null?'#'+player.number:'',player.position,player.starter?'Starting goalie':''].filter(Boolean).join(' · '))+'</small></div></article>';
 function side(team,data,label){
   const players=data?.players||[];
   const groups=[['goalies','Goalies'],['forwards','Forwards'],['defense','Defense']];
   const projection=data?.projection;
   if(projection){
     const key=value=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z]/g,'');
     const lookup=name=>{
       const words=name.split(/\s+/),short=key(words[0][0]+words.slice(1).join(''));
       const player=players.find(player=>key(player.name)===key(name)||key(player.name)===short);
       return {...player,name};
     };
     const line=(names,title)=>'<div class="sports-line"><h3>'+title+'</h3><div class="sports-player-grid">'+names.map(name=>card(lookup(name))).join('')+'</div></div>';
     return '<section class="sports-roster-team"><h2>'+esc(team.name)+'</h2><p class="sports-roster-note">'+label+' · Projected lineup</p>'+
       projection.lines.map((names,index)=>line(names,'Line '+(index+1))).join('')+
       projection.pairs.map((names,index)=>line(names,'Defense pair '+(index+1))).join('')+
       (projection.goalies.length?line(projection.goalies,'Goalies'):'')+'</section>';
   }
   return '<section class="sports-roster-team"><h2>'+esc(team.name)+'</h2><p class="sports-roster-note">'+label+' · '+(data?.source==='game'?'Game roster':'Season roster')+'</p>'+
     (players.length?groups.map(([group,title])=>{
       const members=players.filter(player=>player.group===group);
       if(!members.length)return '';
       return '<h3>'+title+'</h3><div class="sports-player-grid">'+members.map(card).join('')+'</div>';
     }).join(''):'<p>Roster unavailable for this matchup.</p>')+'</section>';
 }
 const source=box.projectionSource?'<a class="sports-roster-note" href="'+esc(box.projectionSource)+'" target="_blank" rel="noopener noreferrer">NHL lineup projections</a>':'';
 host.innerHTML='<div class="sports-rosters">'+side(game.away,box.away,'Away')+side(game.home,box.home,'Home')+'</div>'+source;
 for(const image of host.querySelectorAll('.sports-headshot img'))image.onerror=()=>image.remove();
}
