import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {opendir,lstat,statfs,readFile,writeFile,rename} from 'node:fs/promises';

const run = promisify(execFile);
const options = {windowsHide:true, timeout:4500, maxBuffer:512*1024};
const windows = process.platform === 'win32';
const cpuTimes = () => os.cpus().reduce((sum,cpu) => {
  sum.idle += cpu.times.idle;
  sum.total += Object.values(cpu.times).reduce((a,b)=>a+b,0);
  return sum;
}, {idle:0,total:0});
const numeric = value => value?.trim() && Number.isFinite(Number(value)) ? Number(value) : null;

async function hardware() {
  const [gpu, sensors] = await Promise.allSettled([
    run(windows?path.join(process.env.SystemRoot||'C:/Windows','System32','nvidia-smi.exe'):'nvidia-smi',['--query-gpu=name,utilization.gpu,temperature.gpu,memory.used,memory.total','--format=csv,noheader,nounits'],options),
    windows ? run('powershell.exe',['-NoProfile','-NonInteractive','-Command',[
      "$sensor = @('root/LibreHardwareMonitor','root/OpenHardwareMonitor') | ForEach-Object { Get-CimInstance -Namespace $_ -ClassName Sensor -ErrorAction SilentlyContinue } | Where-Object { $_.SensorType -eq 'Temperature' -and $_.Name -match 'CPU Package|CPU \\(Tctl/Tdie\\)|CPU Die' } | Select-Object -First 1",
      "$adapters = @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object Status -eq 'Up' | Get-NetAdapterStatistics -ErrorAction SilentlyContinue)",
      "$drives = @([IO.DriveInfo]::GetDrives() | Where-Object { $_.IsReady -and $_.DriveType -in 'Fixed','Network','Removable' } | ForEach-Object { $_.RootDirectory.FullName })",
      "@{ cpuTemperature = $sensor.Value; received = if ($adapters.Count) { ($adapters | Measure-Object ReceivedBytes -Sum).Sum }; sent = if ($adapters.Count) { ($adapters | Measure-Object SentBytes -Sum).Sum }; drives = $drives } | ConvertTo-Json -Compress"
    ].join('\n')],options) : Promise.resolve({stdout:'{}'})
  ]);
  let host = {};
  if (sensors.status === 'fulfilled') {
    try { host = JSON.parse(sensors.value.stdout); } catch {}
  }
  const gpus = gpu.status === 'fulfilled' ? gpu.value.stdout.trim().split(/\r?\n/).filter(Boolean).map(line => {
    const [name,usage,temperature,used,total] = line.split(',').map(field=>field.trim());
    return {name,usage:numeric(usage),temperature:numeric(temperature),memoryUsed:numeric(used),memoryTotal:numeric(total)};
  }) : [];
  return {host,gpus};
}

export function createServerDashboard({libraries, directory, publicOrigin, activities, historyFile}) {
  const origin=()=>typeof publicOrigin==='function'?publicOrigin():publicOrigin;
  const publicHost=()=>origin()?new URL(origin()).hostname.toLowerCase():'';
  const traffic = {local:{bytes:0,buckets:new Map()},public:{bytes:0,buckets:new Map()}};
  const minute=60000,retention=30*24*60;
  const ranges={hour:[60,1],day:[1440,15],week:[10080,60],month:[43200,360]};
  const history=new Map();
  let baseline=[traffic.local.bytes,traffic.public.bytes],sampled=Date.now(),persisting=Promise.resolve();
  const ready=historyFile?readFile(historyFile,'utf8').then(text=>{
    for(const [tick,local,external] of JSON.parse(text)){
      if(Number.isInteger(tick)&&tick>=Math.floor(Date.now()/minute)-retention&&Number.isFinite(local)&&Number.isFinite(external))history.set(tick,[local,external]);
    }
  }).catch(()=>{}):Promise.resolve();
  function sampleNetwork(){
    const now=Date.now(),tick=Math.floor(now/minute)-1,seconds=(now-sampled)/1000;
    if(seconds<30)return;
    const counts=[traffic.local.bytes,traffic.public.bytes];
    history.set(tick,counts.map((value,index)=>(value-baseline[index])/seconds));
    baseline=counts;sampled=now;
    for(const key of history.keys())if(key<tick-retention)history.delete(key);
    if(historyFile)persisting=persisting.catch(()=>{}).then(async()=>{
      await ready;
      const temp=historyFile+'.tmp';
      await writeFile(temp,JSON.stringify([...history].map(([key,rates])=>[key,...rates])));
      await rename(temp,historyFile);
    }).catch(()=>{});
  }
  const timer=historyFile?setInterval(sampleNetwork,minute):null;
  timer?.unref();
  function networkHistory(range){
    const [span,interval]=Object.hasOwn(ranges,range)?ranges[range]:ranges.hour,end=Math.floor(Date.now()/minute),start=end-span,points=[];
    for(let tick=start;tick<end;tick+=interval){
      let local=0,external=0,count=0;
      for(let minute=tick;minute<tick+interval;minute++){
        const entry=history.get(minute);
        if(entry){local+=entry[0];external+=entry[1];count++;}
      }
      points.push([tick*60000,count?local/count:null,count?external/count:null]);
    }
    return {start:start*minute,end:end*minute,points};
  }
  const streams = new Map(), playback = new Map(), ended = new Map();
  let previousCpu = cpuTimes(), previousNetwork, system, pending, storage, storagePending, storageTime=0;
  const sampleInterval = 5000;
  let dataUsage, dataScan;
  async function measureData() {
    const groups = new Map();
    let partial = false;
    async function walk(folder, group) {
      try {
        const entries = await opendir(folder);
        for await (const entry of entries) {
          const filename = path.join(folder, entry.name);
          try {
            const info = await lstat(filename);
            if (info.isSymbolicLink()) continue;
            if (info.isDirectory()) await walk(filename, group ?? entry.name);
            else if (info.isFile()) {
              const name = group ?? 'Server files';
              groups.set(name, (groups.get(name) || 0) + info.size);
            }
          } catch (error) { if (error.code !== 'ENOENT') partial = true; }
        }
      } catch { partial = true; }
    }
    await walk(directory);
    const folders = [...groups].map(([name,bytes]) => ({name,bytes})).sort((a,b)=>b.bytes-a.bytes);
    return {path:directory,bytes:folders.reduce((sum,entry)=>sum+entry.bytes,0),folders,partial,sampledAt:Date.now()};
  }

  function dataFolder() {
    if ((!dataUsage || Date.now()-dataUsage.sampledAt >= 60000) && !dataScan) {
      dataScan = measureData().then(result=>{dataUsage=result;return result;}).finally(()=>{dataScan=null;});
    }
    return dataUsage ? Promise.resolve(dataUsage) : dataScan;
  }

  const networkType = url => url.hostname.toLowerCase() === publicHost() ? 'public' : 'local';
  function observe(req,res,url) {
    const category = networkType(url);
    const counter = traffic[category];
    const key = url.pathname;
    const media = /\/media\/[a-f0-9]{32}$|\/playback\/(?:gpu|jobs)\/[^/]+\/(?:media|segment\d+\.m4s)$|\/live-tv\/streams\/[^/]+\/segment\d+\.ts$|\/sports-capture-api\/(?:media\/|jobs\/[^/]+\/file$)/.test(key);
    function count(chunk,encoding) {
      if (chunk == null || typeof chunk === 'function') return;
      const size = typeof chunk === 'string' ? Buffer.byteLength(chunk,typeof encoding==='string'?encoding:'utf8') : chunk.byteLength;
      if (!size) return;
      counter.bytes += size;
      const now = Date.now(), second = Math.floor(now/1000);
      counter.buckets.set(second,(counter.buckets.get(second)||0)+size);
      for (const tick of counter.buckets.keys()) if (tick < second-5) counter.buckets.delete(tick);
      if (media && res.statusCode < 400) {
        const stream = key.replace(/\/(?:segment\d+\.(?:ts|m4s)|seg\d+\.ts)$/, '');
        streams.set(category+':'+stream,{category,last:now});
        if (streams.size>512) streams.delete(streams.keys().next().value);
      }
    }
    const write=res.write, end=res.end;
    res.write=function(chunk,encoding,...rest){count(chunk,encoding);return write.call(this,chunk,encoding,...rest);};
    res.end=function(chunk,encoding,...rest){count(chunk,encoding);return end.call(this,chunk,encoding,...rest);};
  }

  async function sampleSystem() {
    if(system && Date.now()-system.sampledAt < sampleInterval) return system;
    if(pending) return pending;
    pending = (async()=>{
      const {host,gpus}=await hardware(), now=Date.now(), cpu=cpuTimes();
      const total=cpu.total-previousCpu.total, idle=cpu.idle-previousCpu.idle;
      previousCpu=cpu;
      let network=null;
      if(Number.isFinite(host.received)&&Number.isFinite(host.sent)){
        if(previousNetwork){
          const seconds=(now-previousNetwork.time)/1000;
          network={received:Math.max(0,(host.received-previousNetwork.received)/seconds),sent:Math.max(0,(host.sent-previousNetwork.sent)/seconds)};
        }
        previousNetwork={received:host.received,sent:host.sent,time:now};
      }
      system={sampledAt:now,cpu:{name:os.cpus()[0]?.model,usage:total>0?Math.max(0,Math.min(100,100*(1-idle/total))):null,temperature:host.cpuTemperature??null},memory:{total:os.totalmem(),used:os.totalmem()-os.freemem()},gpus,network,drives:host.drives||[]};
      return system;
    })().finally(()=>{pending=null;});
    return pending;
  }

  async function getStorage(driveNames) {
    if(storage&&Date.now()-storageTime<30000) return storage;
    const usage=await libraries.storageUsage();
    const roots=new Set([...driveNames,path.parse(directory).root,...usage.map(entry=>entry.drive)].map(drive=>windows?drive.toUpperCase():drive));
    storage=(await Promise.all([...roots].filter(Boolean).sort().map(async drive=>{
      try {
        const info=await statfs(drive);
        return {drive,total:info.blocks*info.bsize,free:info.bfree*info.bsize,libraries:usage.filter(entry=>entry.drive===drive)};
      } catch { return {drive,total:null,free:null,libraries:usage.filter(entry=>entry.drive===drive)}; }
    })));
    storageTime=Date.now();
    return storage;
  }

  return {observe,dataFolder,networkType,close(){if(timer)clearInterval(timer);},
    isEnded(key){return (ended.get(key)||0)>Date.now();},
    sessions(){return [...playback.values()].filter(entry=>Date.now()-entry.last<45000);},
    end(key){const entry=playback.get(key);for(const [id,until] of ended)if(until<Date.now())ended.delete(id);if(ended.size>=2048)ended.delete(ended.keys().next().value);ended.set(key,Date.now()+86400000);playback.delete(key);return entry;},
    playback(key,item,input){
    if(typeof input.playing!=='boolean')return;
    if((playback.get(key)?.eventAt||0)>input.eventAt)return;
    if((ended.get(key)||0)>Date.now())return;
    if(input.stopped){playback.delete(key);return;}
    playback.set(key,{id:key,user:input.user,device:input.device,gpuId:input.gpuId,profile:input.profile,network:input.network,bitrate:Number.isFinite(input.bitrate)&&input.bitrate>0?input.bitrate:null,poster:item.metadata?.seriesPoster||item.artwork||item.metadata?.poster||null,title:[item.series,item.title].filter(Boolean).join(' · '),phase:input.playing?'Playing':'Paused',done:Math.round(input.position),total:Math.round(input.duration),playing:input.playing,eventAt:input.eventAt,last:Date.now()});
    if(playback.size>512)playback.delete(playback.keys().next().value);
  },async snapshot(range){
    void sampleSystem().catch(()=>{});
    void dataFolder().catch(()=>{});
    if(!storagePending&&(!storage||Date.now()-storageTime>=30000)){
      storagePending=getStorage(system?.drives||[]).catch(()=>{}).finally(()=>{storagePending=null;});
    }
    const dataFolderUsage=dataUsage,drives=storage||[];
    const systemSummary=system||{cpu:{name:os.cpus()[0]?.model},memory:{total:os.totalmem(),used:os.totalmem()-os.freemem()},gpus:[],network:null};
    const now=Date.now(), tick=Math.floor(now/1000);
    for(const [key,stream] of streams)if(now-stream.last>15000)streams.delete(key);
    const network=Object.fromEntries(Object.entries(traffic).map(([name,value])=>[name,{
      sent:value.bytes,
      rate:[...value.buckets].filter(([second])=>second>=tick-4).reduce((sum,[,bytes])=>sum+bytes,0)/5,
      streams:[...streams.values()].filter(stream=>stream.category===name).length
    }]));
    for(const [key,entry] of playback)if(now-entry.last>45000)playback.delete(key);
    return {system:systemSummary,drives,network,networkHistory:networkHistory(range),dataFolder:dataFolderUsage,overview:{libraryCount:libraries.list(true).length,publicOrigin:origin()},activities:{...await activities(),playback:[...playback.values()]}};
  }};
}
