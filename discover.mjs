const fail=(message,status=400)=>Object.assign(Error(message),{status});
const image=(value,size)=>/^\/[\w.-]+\.(?:jpg|png|webp)$/i.test(value||'')?'https://image.tmdb.org/t/p/'+size+value:null;
const isAnime=row=>(row.genre_ids||row.genres?.map(genre=>genre.id)||[]).includes(16)&&(row.original_language==='ja'||row.origin_country?.includes('JP'));
const kind=(type,row)=>type==='movie'?'movie':isAnime(row)?'anime':'show';

function card(type,row,season){
  return {
    type,id:row.id,season:season?.season_number??null,kind:kind(type,row),title:row.title||row.name,
    subtitle:season?.name||'',date:season?.air_date||(type==='movie'?row.release_date:row.first_air_date),
    poster:image(season?.poster_path||row.poster_path,'w500'),backdrop:image(row.backdrop_path,'original'),
    overview:season?.overview||row.overview||'',popularity:Number(row.popularity)||0
  };
}

export function createDiscover(metadata,libraries){
  const cache=new Map();
  function cached(key,ms,load){
    key=metadata.status().language+':'+key;
    if(!metadata.status().configured)throw fail('Configure TMDB in Server → Metadata to use Discover.',409);
    const entry=cache.get(key);
    if(entry&&entry.until>Date.now())return entry.result;
    if(cache.size>=400)cache.delete(cache.keys().next().value);
    const result=Promise.resolve().then(load);
    cache.set(key,{until:Date.now()+ms,result});
    void result.catch(()=>{if(cache.get(key)?.result===result)cache.delete(key);});
    return result;
  }
  const request=(route,params)=>metadata.request(route,params);
  const details=(type,id)=>cached(type+'/'+id,3600000,()=>request(type+'/'+id,{append_to_response:'credits,images',include_image_language:metadata.status().language.split('-')[0]+',en,null'}));
  const trailer=(type,id,season)=>cached('trailer/'+type+'/'+id+'/'+(season||''),3600000,async()=>{
    const route=type+'/'+id+(season?'/season/'+season:'')+'/videos';
    const {results=[]}=await request(route);
    const entries=results.filter(row=>row.site==='YouTube'&&row.type==='Trailer'&&/^[\w-]{11}$/.test(row.key));
    entries.sort((a,b)=>Number(!!b.official)-Number(!!a.official)||String(b.published_at||'').localeCompare(String(a.published_at||'')));
    return entries[0]?.key||null;
  });
  async function candidates(days=180){
    const today=new Date().toISOString().slice(0,10);
    const until=new Date(Date.now()+days*86400000).toISOString().slice(0,10);
    const common={sort_by:'popularity.desc',include_adult:false};
    const animeFilter={with_genres:16,with_original_language:'ja'};
    const premieres={...common,'first_air_date.gte':today,'first_air_date.lte':until};
    const upcoming={...common,'air_date.gte':today,'air_date.lte':until,'first_air_date.lte':today,with_status:'0|2|3'};
    const [movies,...television]=await Promise.all([
      request('discover/movie',{...common,'primary_release_date.gte':today,'primary_release_date.lte':until}),
      request('discover/tv',{...premieres,with_type:'2|4'}),
      request('discover/tv',{...premieres,...animeFilter}),
      request('discover/tv',{...upcoming,with_type:'2|4'}),
      request('discover/tv',{...upcoming,...animeFilter})
    ]);
    const entries=[...new Map(television.flatMap(group=>group.results||[]).map(row=>[row.id,row])).values()];
    const returning=entries.filter(row=>row.first_air_date<today);
    const seasons=[];
    for(let offset=0;offset<returning.length;offset+=8){
      await Promise.all(returning.slice(offset,offset+8).map(async row=>{
        const info=await cached('tv-seasons/'+row.id,3600000,()=>request('tv/'+row.id)).catch(()=>null);
        for(const season of info?.seasons||[]){
          if(season.season_number>0&&season.air_date>=today&&season.air_date<=until)seasons.push(card('tv',row,season));
        }
      }));
    }
    return [...(movies.results||[]).filter(row=>row.release_date>=today&&row.release_date<=until).map(row=>card('movie',row)),
      ...entries.filter(row=>row.first_air_date>=today&&row.first_air_date<=until).map(row=>card('tv',row)),...seasons];
  }
  async function ranked(category){
    const options={sort_by:'popularity.desc',include_adult:false};
    const trending=category==='trending';
    const [overall,movies,shows,...extraTV]=await Promise.all(trending?[
      request('trending/all/week'),
      request('trending/movie/week'),
      request('trending/tv/week'),
      ...[2,3,4,5].map(page=>request('trending/tv/week',{page}))
    ]:[
      Promise.resolve(null),
      request('discover/movie',options),
      request('discover/tv',options),
      request('discover/tv',{...options,with_genres:16,with_original_language:'ja'})
    ]);
    const media=(group,type)=>(group?.results||[]).filter(row=>!row.adult&&(!row.media_type||row.media_type===type)).map(row=>card(type,row));
    const films=media(movies,'movie');
    const tv=[...new Map([...media(shows,'tv'),...extraTV.flatMap(group=>media(group,'tv'))].map(item=>[item.id,item])).values()];
    if(!trending)tv.sort((a,b)=>b.popularity-a.popularity);
    const featured=trending
      ?(overall.results||[]).filter(row=>!row.adult&&['movie','tv'].includes(row.media_type)).map(row=>card(row.media_type,row))
      :[...films,...tv].sort((a,b)=>b.popularity-a.popularity);
    const label=trending?'Trending':'Popular';
    return {rows:[
      {title:label+' Overall',items:featured.slice(0,20)},
      {title:label+' Movies',items:films.slice(0,20)},
      {title:label+' TV Shows',items:tv.filter(item=>item.kind==='show').slice(0,20)},
      {title:label+' Anime',items:tv.filter(item=>item.kind==='anime').slice(0,trending?100:20)}
    ]};
  }
  return {
    async list(query,allowed,category='upcoming'){
      if(query){
        const results=await cached('search/'+query.toLowerCase(),300000,()=>request('search/multi',{query,include_adult:false}));
        return {rows:[{title:'Search results',items:(results.results||[]).filter(row=>['movie','tv'].includes(row.media_type)&&!row.adult).map(row=>card(row.media_type,row))}]};
      }
      if(category==='popular')return cached(category,1800000,()=>ranked(category));
      if(category==='trending'){
        const [{rows},owned]=await Promise.all([cached(category,1800000,()=>ranked(category)),libraries.discoverOwnership(allowed)]);
        return {rows:rows.map(row=>({...row,items:row.items.filter(item=>item.kind!=='anime'||!owned.shows.has(item.id)).slice(0,20)}))};
      }
      const anticipated=category==='anticipated';
      const [items,owned]=await Promise.all([
        cached(anticipated?'anticipated':'upcoming',1800000,()=>candidates(anticipated?1095:180)),
        libraries.discoverOwnership(allowed)
      ]);
      const unseen=items.filter(item=>item.type==='movie'?!owned.movies.has(item.id):item.season?!owned.shows.get(item.id)?.has(item.season):!owned.shows.has(item.id));
      const nearTerm=new Date(Date.now()+180*86400000).toISOString().slice(0,10);
      const compare=(a,b)=>(anticipated?Number(b.date>nearTerm)-Number(a.date>nearTerm):0)||b.popularity-a.popularity;
      const byKind=['movie','show','anime'].map(value=>unseen.filter(item=>item.kind===value).sort(compare).slice(0,20));
      const featured=byKind.flatMap(list=>list.slice(0,4)).sort((a,b)=>b.popularity-a.popularity);
      if(anticipated){
        const overall=unseen.slice().sort(compare).slice(0,20);
        const titles=['Highly Anticipated Movies','Highly Anticipated TV Shows & Seasons','Highly Anticipated Anime & Seasons'];
        return {rows:[{title:'Highly Anticipated',items:overall},...titles.map((title,i)=>({title,items:byKind[i]}))]};
      }
      return {rows:[{title:'Coming Soon',items:featured},...['Upcoming Movies','Upcoming Shows & Seasons','Upcoming Anime & Seasons'].map((title,i)=>({title,items:byKind[i]}))]};
    },
    async detail(type,id,season){
      const [row,part]=await Promise.all([details(type,id),season?cached('season/'+id+'/'+season,3600000,()=>request('tv/'+id+'/season/'+season)):null]);
      if(row.adult||part?.season_number===0)throw fail('Title unavailable.',404);
      const item=card(type,row,part);
      item.logo=image(row.images?.logos?.find(entry=>entry.iso_639_1===metadata.status().language.split('-')[0])?.file_path,'w500');
      item.genres=(row.genres||[]).map(entry=>entry.name);
      item.runtime=row.runtime;
      item.cast=(row.credits?.cast||[]).slice(0,16).map(entry=>({name:entry.name,role:entry.character,photo:image(entry.profile_path,'w185')}));
      return item;
    },
    trailer
  };
}
