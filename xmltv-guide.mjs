import {gunzip} from 'node:zlib';
import {promisify} from 'node:util';

const maxBytes=32*1024*1024;
const uncompress=promisify(gunzip);
const channelNumber=/^\d{1,5}(?:\.\d{1,4})?$/;

export function guideAddress(value) {
  const input=String(value??'').trim();
  if(!input)return '';
  try {
    const url=new URL(input);
    if(input.length<=4096&&['http:','https:'].includes(url.protocol)&&!url.username&&!url.password)return url.href;
  } catch {}
  throw Object.assign(Error('Enter an HTTP or HTTPS XMLTV guide URL.'),{status:400});
}

function decode(text) {
  return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>|&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(full,cdata,entity)=>{
    if(cdata!==undefined)return cdata;
    if(entity[0]==='#'){
      const hex=entity[1].toLowerCase()==='x',code=parseInt(entity.slice(hex?2:1),hex?16:10);
      return code<=0x10ffff?String.fromCodePoint(code):full;
    }
    return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[entity]??full;
  }).trim();
}

function attributes(text) {
  return new Map([...text.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(([,key,a,b])=>[key,decode(a??b)]));
}

function timestamp(value) {
  const match=/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(?:\s+([+-]\d{4}|Z|UTC|GMT))?$/i.exec(value||'');
  if(!match)return NaN;
  const [,year,month,day,hour,minute,second='00',zone='Z']=match;
  const offset=/^[+-]/.test(zone)?zone.slice(0,3)+':'+zone.slice(3):'Z';
  return Date.parse(year+'-'+month+'-'+day+'T'+hour+':'+minute+':'+second+offset);
}

export function parseXmltv(xml, now=Date.now()) {
  if(!/<tv(?:\s|>)/.test(xml)||!/<\/tv\s*>/.test(xml))throw Error('The guide did not contain XMLTV listings.');
  const channels=new Map(),programs=new Map();
  for(const [,header,body] of xml.matchAll(/<channel\b([^>]*)>([\s\S]*?)<\/channel\s*>/g)){
    const id=attributes(header).get('id');
    if(id)channels.set(id,[...body.matchAll(/<display-name\b[^>]*>([\s\S]*?)<\/display-name\s*>/g)].map(match=>decode(match[1])));
  }
  for(const [,header,body] of xml.matchAll(/<programme\b([^>]*)>([\s\S]*?)<\/programme\s*>/g)){
    const fields=attributes(header),id=fields.get('channel'),start=timestamp(fields.get('start')),end=timestamp(fields.get('stop'));
    const title=decode(body.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/)?.[1]||'').slice(0,200);
    if(!id||!title||!Number.isFinite(start)||start>now+15*86400000||end<=now-86400000||start<now-86400000)continue;
    const list=programs.get(id)||[];
    const episode=decode(body.match(/<sub-title\b[^>]*>([\s\S]*?)<\/sub-title\s*>/)?.[1]||'').slice(0,200);
    const overview=decode(body.match(/<desc\b[^>]*>([\s\S]*?)<\/desc\s*>/)?.[1]||'').slice(0,600);
    list.push({title,episode,overview,start,end:Number.isFinite(end)&&end>start?end:null});
    programs.set(id,list);
    if(!channels.has(id))channels.set(id,[]);
  }
  for(const list of programs.values()){
    list.sort((a,b)=>a.start-b.start);
    for(let i=0;i<list.length-1;i++)list[i].end??=list[i+1].start;
  }
  return {channels,programs};
}

export function guideChannelId(guide, channel) {
  const normalize=value=>String(value).toLowerCase().replace(/[^a-z0-9]/g,'');
  const name=normalize(channel.name);
  const exact=[],numbered=[];
  for(const [id,labels] of guide.channels){
    if(id===channel.number||labels.some(label=>label===channel.number||label.startsWith(channel.number+' ')))numbered.push(id);
    if(name&&[id,...labels.filter(label=>!channelNumber.test(label))].some(label=>normalize(label)===name))exact.push(id);
  }
  return numbered.length===1?numbered[0]:exact.length===1?exact[0]:null;
}

export function guideForChannel(guide, channel, now=Date.now()) {
  const id=guideChannelId(guide,channel);
  if(!id)return {};
  const rows=guide.programs.get(id)||[];
  return {now:rows.findLast(row=>row.start<=now&&row.end>now),next:rows.find(row=>row.start>now)};
}

export async function fetchXmltv(url, fetcher) {
  const response=await fetcher(url,{signal:AbortSignal.timeout(10000)});
  if(!response.ok||!response.body)throw Error('The guide URL could not be downloaded.');
  const chunks=[];
  let size=0;
  for await(const chunk of response.body){
    size+=chunk.length;
    if(size>maxBytes)throw Error('The guide exceeds 32 MiB.');
    chunks.push(chunk);
  }
  let data=Buffer.concat(chunks);
  if(data[0]===31&&data[1]===139)data=await uncompress(data,{maxOutputLength:maxBytes});
  return parseXmltv(data.toString('utf8'));
}
