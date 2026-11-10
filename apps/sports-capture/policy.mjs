export function publicIPv4(ip){
 const p=ip.split('.').map(Number);if(p.length!==4||p.some(n=>!Number.isInteger(n)||n<0||n>255))return false;
 const [a,b]=p;return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===2)||a===198&&(b===18||b===19||b===51)||a===203&&b===0||a===100&&b>=64&&b<=127);
}
export function sourceURL(value){const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port||u.hostname!=='crackstreams.mx'||!/^\/stream\/[a-z0-9-]+\/?$/.test(u.pathname))throw Error('Choose a CrackStreams game page (/stream/…), not the league listing.');return u.origin+u.pathname;}
export function shouldStop(job,now){return !job.recording&&now-job.lastViewer>90000||now-job.created>6*3600000;}
export function safeName(title,id){return String(title).replace(/[^a-z0-9 _-]/gi,'').trim().slice(0,90)+' - '+id+'.mp4';}
