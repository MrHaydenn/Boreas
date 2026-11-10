const easternDay=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
const dayMs=86400000;

export function upcomingMovieHoliday(now=new Date()){
 const today=Date.parse(easternDay.format(now)+'T00:00:00Z'),year=new Date(today).getUTCFullYear();
 const date=(month,day)=>Date.UTC(year,month-1,day);
 const thanksgiving=date(11,1)+(21+(4-new Date(date(11,1)).getUTCDay()+7)%7)*dayMs;
 const holidays=[
  [date(1,1),"New Year's Day",/\bnew year(?:['’]s)?(?: eve| day)?\b/i],
  [date(2,14),"Valentine's Day",/\bvalentine(?:['’]s)?\b/i],
  [date(3,17),"St. Patrick's Day",/\b(?:st\.?|saint) patrick(?:['’]s)?\b/i],
  [date(7,4),'Independence Day',/\b(?:independence day|fourth of july|4th of july)\b/i],
  [date(10,31),'Halloween',/\bhalloween\b/i],
  [thanksgiving,'Thanksgiving',/\bthanksgiving\b/i],
  [date(12,25),'Christmas',/\b(?:christmas|xmas|santa claus)\b/i],
  [Date.UTC(year+1,0,1),"New Year's Day",/\bnew year(?:['’]s)?(?: eve| day)?\b/i]
 ];
 const [,name,match]=holidays.find(([day])=>day>=today);
 return {name,match};
}

export function createLibraryRecommendations({libraries,progress,mediaState,tvId}){
 const hidden=(user,library,item)=>mediaState?.hidden(user,tvId(library,item.seriesId?'series':'file',item.seriesId||item.id));
 async function watching(user,allowedLibraryIds=null,includeUnpinned=false){
  return progress.home(user,allowedLibraryIds,{includeUnpinned,exclude:(library,item)=>hidden(user,library,item)});
 }
 async function rows(user,library,admin){
  const {library:info,items}=await libraries.listItems(library,{admin,view:'series',sort:'added',all:true});
  const shelves=[];
  async function add(kind,title,entries){
   if(entries.length)shelves.push({kind,title,items:await progress.decorateTitles(user,library,entries.slice(0,18),admin)});
  }
  const history=(await watching(user,[library],true)).items;
  if(history.length)shelves.push({kind:'personal',title:'Continue Watching',items:history.slice(0,18)});
  await add('recent','Recently Added in '+info.name,items);
  const unwatched=item=>!progress.get(user,library,item.id)?.completed;
  const rated=entries=>entries.filter(item=>Number(item.metadata?.voteAverage)>0).sort((a,b)=>b.metadata.voteAverage-a.metadata.voteAverage||(b.metadata.voteCount||0)-(a.metadata.voteCount||0));
  if(info.type==='home-videos'){
   await add('unwatched','Unwatched Videos',items.filter(unwatched));
   await add('watched','Recently Watched',items.filter(item=>!unwatched(item)).sort((a,b)=>(progress.get(user,library,b.id)?.eventAt||0)-(progress.get(user,library,a.id)?.eventAt||0)));
  }else if(['shows','anime'].includes(info.type)){
   const started=await progress.startedSeries(user,library,admin);
   await add('start','Start Watching',items.filter(item=>!started.has(item.id)));
   await add('rated','Top Rated Shows',rated(items));
  }else if(info.type==='movies'){
   await add('rated','Top Unwatched Movies',rated(items.filter(unwatched)));
   const holiday=upcomingMovieHoliday();
   await add('holiday','Holiday Movies · '+holiday.name,items.filter(item=>holiday.match.test([item.title,item.metadata?.overview,item.metadata?.tagline].join(' '))));
  }
  return {library:info,rows:shelves};
 }
 return {watching,rows,hidden};
}
