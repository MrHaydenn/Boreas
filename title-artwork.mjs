import path from 'node:path';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const fields={poster:'posters',backdrop:'backdrops',logo:'logos'};
const image=(file,size)=>typeof file==='string'&&/^\/[a-zA-Z0-9_-]+\.(?:jpg|png|webp)$/i.test(file)?'https://image.tmdb.org/t/p/'+size+file:null;

export async function createTitleArtwork(directory,provider){
 await mkdir(directory,{recursive:true});const file=path.join(directory,'title-artwork.json');let state={version:1,choices:{}};
 try{state=JSON.parse(await readFile(file,'utf8'));if(state.version!==1||!state.choices)throw Error('Invalid artwork choices.');}catch(e){if(e.code!=='ENOENT')throw e;}
 let writes=Promise.resolve();const cache=new Map(),key=(library,id)=>library+'/'+id;
 function apply(library,id,metadata){const selected=state.choices[key(library,id)];return metadata&&selected&&selected.providerId===metadata.tmdbId?{...metadata,...Object.fromEntries(Object.keys(fields).filter(f=>selected[f]).map(f=>[f,selected[f]]))}:metadata;}
 async function target(libraries,library,id,kind){
  if(!['movie','series'].includes(kind))throw fail('Choose a movie or series.');
  const title=kind==='series'?await libraries.series(library,id,true):await libraries.item(library,id,true),metadata=title.metadata;
  if(metadata?.state!=='matched'||!Number.isSafeInteger(metadata.tmdbId)||metadata.kind==='episode')throw fail('Match this title to metadata before choosing artwork.',409);
  return {title:title.title,metadata,providerId:metadata.tmdbId,route:(kind==='series'?'tv/':'movie/')+metadata.tmdbId+'/images'};
 }
 async function options(libraries,library,id,kind){
  const title=await target(libraries,library,id,kind);let cached=cache.get(title.route);
  if(!cached||cached.until<Date.now()){
   const response=await provider.request(title.route,{language:null}),images={};
   for(const [field,list]of Object.entries(fields)){const seen=new Set();images[field]=(response[list]||[]).filter(i=>image(i.file_path,'original')).sort((a,b)=>Number(b.iso_639_1==='en')-Number(a.iso_639_1==='en')||(b.vote_average||0)-(a.vote_average||0)).flatMap(i=>{if(seen.has(i.file_path))return [];seen.add(i.file_path);return [{url:image(i.file_path,field==='backdrop'?'original':'w500'),thumbnail:image(i.file_path,field==='backdrop'?'w780':'w342'),width:i.width,height:i.height,language:i.iso_639_1||'Unspecified'}];});}
   cached={images,until:Date.now()+3600000};if(cache.size>=80)cache.delete(cache.keys().next().value);cache.set(title.route,cached);
  }
  return {title:title.title,providerId:title.providerId,current:Object.fromEntries(Object.keys(fields).map(f=>[f,title.metadata[f]||null])),images:cached.images};
 }
 async function save(libraries,library,id,kind,input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw fail('Choose artwork to save.');if(Object.hasOwn(input,'reset')&&(typeof input.reset!=='boolean'||input.reset&&Object.keys(input).length>1))throw fail('Choose artwork or reset to defaults.');const title=await target(libraries,library,id,kind),available=input.reset===true?null:await options(libraries,library,id,kind);
  for(const field of Object.keys(input)){if(![...Object.keys(fields),'reset'].includes(field))throw fail('Unknown artwork option.');if(field==='reset')continue;if(input[field]!==null&&!available.images[field].some(i=>i.url===input[field])&&input[field]!==available.current[field])throw fail('Choose an image from this title’s metadata artwork.');}
  const pending=writes.then(async()=>{const next=structuredClone(state),entry=key(library,id);if(input.reset===true)delete next.choices[entry];else{const current=next.choices[entry]?.providerId===title.providerId?next.choices[entry]:{providerId:title.providerId};for(const field of Object.keys(fields))if(Object.hasOwn(input,field)){if(input[field]===null)delete current[field];else current[field]=input[field];}next.choices[entry]=current;}const temporary=file+'.'+randomUUID()+'.tmp';await writeFile(temporary,JSON.stringify(next),{mode:0o600});await rename(temporary,file);state=next;return {ok:true};});writes=pending.catch(()=>{});return pending;
 }
 return {apply,options,save,close:()=>writes};
}
