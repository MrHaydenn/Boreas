/* Live TV calculations and recording payloads, independent of the UI. */
globalThis.LumenTV={
 window(date=Date.now()){const start=new Date(date);start.setMinutes(start.getMinutes()<30?0:30,0,0);return {start:start.getTime(),end:start.getTime()+4*3600000};},
 segment(program,start,end){const a=Date.parse(program.StartDate),b=Date.parse(program.EndDate);if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a||b<=start||a>=end)return null;return {left:Math.max(0,a-start)/(end-start)*100,width:(Math.min(end,b)-Math.max(start,a))/(end-start)*100};},
 channels(items){return [...items].sort((a,b)=>Number(!!b.UserData?.IsFavorite)-Number(!!a.UserData?.IsFavorite)||Number(a.LumenSource==='plex-streaming')-Number(b.LumenSource==='plex-streaming')||String(a.ChannelNumber||'').localeCompare(String(b.ChannelNumber||''),undefined,{numeric:true})||String(a.Name).localeCompare(String(b.Name)));},
 active(timer){return !['Cancelled','Completed'].includes(timer.Status);}
};
