// Read the published JSON catalog without executing provider scripts.
export function streamChoices(html, source) {
 const raw=String(html).match(/\b(?:const|let|var)\s+allStreams\s*=\s*(\[[^\r\n]*\])\s*;/)?.[1];
 if(!raw)return [];
 let entries;try{entries=JSON.parse(raw);}catch{return [];}
 if(!Array.isArray(entries))return [];
 return entries.slice(0,30).flatMap((entry,index)=>{
  if(!entry||typeof entry.label!=='string'||!entry.label.trim()||entry.label.length>100)return [];
  return [{label:entry.label.trim(),variant:index,url:source}];
 });
}
export function streamVariant(value){if(value===undefined)return null;if(!Number.isInteger(value)||value<0||value>29)throw Object.assign(Error('Choose a valid stream option.'),{status:400});return value;}

