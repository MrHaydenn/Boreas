import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {createDiscoveryServices,publicConnections} from './connection-services.mjs';
import {calendarRange,calendarEvents} from './discovery-calendar.mjs';

export function createNativeConnections(directory,libraries){
  const file=path.join(directory,'connections.local.json');
  async function readConfig(){
    try{return JSON.parse(await readFile(file,'utf8'));}
    catch(error){if(error.code==='ENOENT')return {};throw error;}
  }
  async function saveConfig(config){
    const temporary=file+'.'+randomUUID()+'.tmp';
    await writeFile(temporary,JSON.stringify(config,null,2),{mode:0o600});
    await rename(temporary,file);
  }
  const services=createDiscoveryServices({readConfig,saveConfig});
  const nameOf=name=>({radarr:'Radarr',sonarr:'Sonarr',qbittorrent:'qBittorrent'})[name];
  const cache=new Map();
  return {
    async settings(){return publicConnections(await readConfig());},
    async save(name,input){const result=await services.update(name,input);cache.clear();return result;},
    async test(name){return {message:await services.testConnection(await readConfig(),name)};},
    async calendar(start,end,user){
      let range;
      try{range=calendarRange(start,end);}
      catch(error){throw Object.assign(error,{status:400});}
      const config=await readConfig(),warnings=[];
      async function load(name){
        if(!publicConnections(config)[name].configured){
          warnings.push(nameOf(name)+' is not configured.');
          return [];
        }
        const key=name+':'+range.start+':'+range.end;
        try{
          const existing=cache.get(key);
          if(existing&&existing.until>Date.now())return await existing.result;
          if(cache.size>=60)cache.delete(cache.keys().next().value);
          const result=services.arr(config,name,'/calendar',{...range,unmonitored:false,...(name==='sonarr'?{includeSeries:true}:{})}).then(rows=>{
            if(!Array.isArray(rows))throw Error('Invalid calendar response.');
            return rows;
          });
          cache.set(key,{result,until:Date.now()+120000});
          return await result;
        }catch{
          warnings.push(nameOf(name)+' calendar could not be loaded. Check its connection.');
          return [];
        }
      }
      const restricted=user.permissions.libraryIds!==null;
      const [movies,episodes,owned]=await Promise.all([
        load('radarr'),load('sonarr'),restricted?libraries.discoverOwnership(id=>user.permissions.libraryIds.includes(id)):null
      ]);
      const items=calendarEvents({movies,episodes,...range,
        ...(owned?{visibleMovie:movie=>owned.movies.has(movie.tmdbId),visibleSeries:series=>owned.shows.has(series.tmdbId)}:{})
      }).map(item=>({...item,poster:/^https:\/\/(?:image\.tmdb\.org\/t\/p\/|artworks\.thetvdb\.com\/)/.test(item.poster||'')?item.poster:null}));
      return {...range,items,warnings};
    }
  };
}
