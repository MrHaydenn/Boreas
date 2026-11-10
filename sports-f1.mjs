const eastern=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'});
export function normalizeF1(feeds){
 const days=new Map(),seen=new Set();
 for(const feed of feeds)for(const event of feed.events||[])for(const session of event.competitions||[]){
  if(seen.has(session.id)||!Number.isFinite(Date.parse(session.date)))continue;seen.add(session.id);
  const date=eastern.format(new Date(session.date)),status=session.status?.type||{},kind=session.type?.abbreviation||'Race',label=({FP1:'Practice 1',FP2:'Practice 2',FP3:'Practice 3',Qual:'Qualifying',Race:'Race',Sprint:'Sprint',SQ:'Sprint qualifying'})[kind]||kind;
  if(!days.has(date))days.set(date,{date,games:[]});
  days.get(date).games.push({id:session.id,title:event.name+' · '+label,eventName:event.name,start:session.date,state:status.completed?'FINAL':status.state==='in'?'LIVE':'FUT',scheduleState:/postpon/i.test(status.name)?'PPD':/cancel/i.test(status.name)?'CNCL':'OK',statusDetail:status.state==='in'?'Session in progress':'',venue:session.venue?.fullName||'',away:{name:event.name,abbrev:'F1',logo:'https://a.espncdn.com/i/teamlogos/leagues/500/f1.png',score:null},home:{name:label,abbrev:kind,logo:'',score:null},broadcasts:[...new Set((session.broadcasts||[]).flatMap(b=>b.names||[]))],period:0});
 }
 return [...days.values()].sort((a,b)=>a.date.localeCompare(b.date));
}
