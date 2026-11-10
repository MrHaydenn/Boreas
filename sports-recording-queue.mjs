import {readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createSportsHandler} from './sports.mjs';
export function createRecordingQueue({directory,workerJSON,fetcher=fetch,now=()=>Date.now(),enabled=()=>true}){
 const file=path.join(directory,'sports-recording-queue.local.json'),sports=createSportsHandler({authorize:async()=>true,fetcher,now});let entries=[],writing=Promise.resolve(),busy=false,polling=null,adding=Promise.resolve();
 const ready=readFile(file,'utf8').then(s=>{entries=JSON.parse(s);if(!Array.isArray(entries))throw Error('Invalid recording queue');}).catch(e=>{if(e.code!=='ENOENT')throw e;});
 function save(){const snapshot=JSON.stringify(entries,null,2);writing=writing.catch(()=>{}).then(async()=>{await writeFile(file+'.tmp',snapshot);await rename(file+'.tmp',file);});return writing;}
 async function data(league,action,date,game){let code,value;await sports({method:'GET',headers:{}},{writeHead(s){code=s;},end(s){value=JSON.parse(s);}},new URL('/sports-api/'+league+'/'+action+'?date='+date+(game?'&game='+encodeURIComponent(game):''),'http://local'));if(code!==200)throw Error(value.error);return value;}
 function view(e){return {...e,recording:true,ready:false};}
 async function addRequest(b){await ready;if(!['nhl','nfl','f1'].includes(b.league)||!/^20\d\d-\d\d-\d\d$/.test(b.date||'')||typeof b.game!=='string'||b.game.length>80)throw Object.assign(Error('Choose a scheduled sports event.'),{status:400});
 const existing=entries.find(e=>e.league===b.league&&e.date===b.date&&e.game===b.game&&e.state!=='failed');if(existing)return view(existing);
 if(entries.length>=100)throw Object.assign(Error('The recording queue is full. Remove an old request first.'),{status:409});
 const schedule=await data(b.league,'schedule',b.date),game=schedule.days.flatMap(d=>d.games).find(g=>String(g.id)===b.game);if(!game)throw Object.assign(Error('Event not found.'),{status:404});
 if(['FINAL','OFF'].includes(game.state)||Date.parse(game.start)+6*3600000<now())throw Object.assign(Error('This event has finished.'),{status:409});
 const e={id:randomUUID(),league:b.league,date:b.date,game:b.game,title:game.title||game.away.name+' at '+game.home.name,start:game.start,created:now(),state:'scheduled',message:'Will record the first available stream.'};entries.push(e);await save();void poll();return view(e);}
 function add(b){const task=adding.catch(()=>{}).then(()=>addRequest(b));adding=task;return task;}
 async function cancel(id){await ready;const e=entries.find(e=>e.id===id);if(!e)return false;entries=entries.filter(x=>x!==e);await save();return true;}
 async function runPoll(){await ready;if(busy||!enabled())return;busy=true;try{for(const e of [...entries]){if(e.state==='failed'||!entries.includes(e))continue;
 if(now()>Date.parse(e.start)+6*3600000){e.state='failed';e.message='No recording started before this event ended.';await save();continue;}
 try{const result=await data(e.league,'sources',e.date,e.game);if(!entries.includes(e)||!enabled())continue;const source=result.sources?.[0];if(!source){e.state='scheduled';e.message='Waiting for the first available stream.';await save();continue;}
 const job=await workerJSON('/jobs','POST',{source:source.url,variant:source.variant,title:e.title,recording:true,scheduleId:e.id});
 if(!entries.includes(e)){await workerJSON('/jobs/'+job.id+'/stop','POST',{});continue;}entries=entries.filter(x=>x!==e);await save();
 }catch(error){if(entries.includes(e)){e.state='scheduled';e.message=error.status===409?'Waiting for a free recorder.': 'Waiting to retry stream availability.';await save();}}
 }}finally{busy=false;}}
 function poll(){if(!polling)polling=runPoll().finally(()=>{polling=null;});return polling;}
 const timer=setInterval(()=>void poll().catch(()=>{}),30000);timer.unref();void ready.then(()=>poll()).catch(()=>{});
 return {close:async()=>{clearInterval(timer);await polling?.catch(()=>{});await writing;},add,cancel,poll,list:async()=>{await ready;return entries.map(view);}};
}
