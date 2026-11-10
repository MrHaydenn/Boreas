function nativeBackdrop(item){return item?.metadata?.backdrop||item?.thumbnail||'';}
/* Native artwork presentation: shared visual behavior, independent data. */
const NativeAtmosphere=(()=>{
 const palettes=new Map();let root,layer,serial=0,active='',timer;
 const reduced=()=>document.body.classList.contains('reduce-motion')||matchMedia('(prefers-reduced-motion: reduce)').matches;
 function palette(img){const key=img.src;if(palettes.has(key))return palettes.get(key);let result=['#10141b','#171b24'];try{const canvas=document.createElement('canvas');canvas.width=48;canvas.height=28;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0,48,28);const pixels=ctx.getImageData(0,0,48,28).data,bins=Array.from({length:18},()=>({w:0,r:0,g:0,b:0}));for(let i=0;i<pixels.length;i+=4){const r=pixels[i]/255,g=pixels[i+1]/255,b=pixels[i+2]/255,max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min,sat=max?delta/max:0;if(sat<.22||max<.12||max>.94)continue;let h=max===r?((g-b)/delta)%6:max===g?(b-r)/delta+2:(r-g)/delta+4;h=(h*60+360)%360;const bin=bins[Math.min(17,Math.floor(h/20))],w=sat*(.4+max);bin.w+=w;bin.r+=r*w;bin.g+=g*w;bin.b+=b*w;}const order=bins.map((v,i)=>({...v,i})).sort((a,b)=>b.w-a.w),first=order[0],second=order.find(v=>Math.min(Math.abs(v.i-first.i),18-Math.abs(v.i-first.i))>=3&&v.w>first.w*.08)||first;const color=(v,strength)=>{if(!v.w)return '#10141b';const scale=strength/Math.max(v.r,v.g,v.b);return 'rgb('+[v.r,v.g,v.b].map(x=>Math.round(x*scale)).join(',')+')';};result=[color(first,74),color(second,92)];}catch{}palettes.set(key,result);if(palettes.size>80)palettes.delete(palettes.keys().next().value);return result;}
 function ensure(){if(root)return;root=document.createElement('div');root.id='web-atmosphere';root.setAttribute('aria-hidden','true');document.body.prepend(root);}
 function clear(){clearTimeout(timer);serial++;active='';root?.classList.remove('visible');document.body.classList.remove('artwork-browse','artwork-ready');const old=layer;layer=null;setTimeout(()=>old?.remove(),650);}
 const serverPalettes=new Map();
 function serverPalette(path){
   const cached=serverPalettes.get(path);
   if(cached)return cached;
   if(serverPalettes.size>=80)serverPalettes.delete(serverPalettes.keys().next().value);
   const result=fetch('/api/metadata/palette?path='+encodeURIComponent(path),{credentials:'same-origin',signal:AbortSignal.timeout(1800)})
     .then(async response=>{
       if(!response.ok)return null;
       const {primary,secondary}=await response.json();
       const color=/^rgb\(\d+,\d+,\d+\)$|^#[a-f0-9]{6}$/i;
       return color.test(primary)&&color.test(secondary)?[primary,secondary]:null;
     }).catch(()=>null);
   serverPalettes.set(path,result);
   void result.then(colors=>{if(!colors&&serverPalettes.get(path)===result)serverPalettes.delete(path);});
   return result;
 }
 async function show(src){
   clearTimeout(timer);ensure();
   if(!src){if(!layer)clear();return;}
   document.body.classList.add('artwork-browse');
   if(src===active)return;
   const revision=++serial;active=src;
   const img=new Image(),source=new URL(src,location.href);
   const tmdbPath=source.hostname==='image.tmdb.org'?source.pathname.replace('/original/','/w1280/'):null;
   if(!tmdbPath&&source.origin!==location.origin)img.crossOrigin='anonymous';
   img.alt='';img.src=tmdbPath?'/api/metadata/artwork?path='+encodeURIComponent(tmdbPath):src;
   const colors=tmdbPath?serverPalette(tmdbPath):null;
   try{await img.decode();}catch{if(revision===serial){active='';if(!layer)clear();}return;}
   if(revision!==serial)return;
   const serverColors=await colors;
   if(revision!==serial)return;
   const [primary,secondary]=serverColors||palette(img);
   const next=document.createElement('div');next.className='atmosphere-layer';const gradient='linear-gradient(135deg,'+primary+','+secondary+')';next.style.background=gradient;root.style.background=gradient;next.style.setProperty('--art-primary',primary);next.style.setProperty('--art-secondary',secondary);next.append(img);const shade=document.createElement('div');shade.className='native-atmosphere-shade';shade.style.background='linear-gradient(90deg,rgba(0,0,0,.3),transparent 72%),linear-gradient(0deg,'+secondary+',transparent 82%)';next.append(shade);root.append(next);root.classList.add('visible');document.body.classList.add('artwork-ready');const old=layer;layer=next;requestAnimationFrame(()=>requestAnimationFrame(()=>{if(layer!==next){next.remove();return;}next.classList.add('visible');old?.classList.remove('visible');}));setTimeout(()=>old?.remove(),reduced()?0:650);}
 function teamColors(away,home){
   if(!/^#[0-9a-f]{6}$/i.test(away)||!/^#[0-9a-f]{6}$/i.test(home))return;
   ensure();
   const key='teams:'+away+':'+home;
   if(active===key)return;
   active=key;++serial;
   document.body.classList.add('artwork-browse','artwork-ready');
   const next=document.createElement('div');
   next.className='atmosphere-layer sports-team-colors';
   next.style.setProperty('--away-team',away);
   next.style.setProperty('--home-team',home);
   root.append(next);root.classList.add('visible');
   const old=layer;layer=next;
   requestAnimationFrame(()=>requestAnimationFrame(()=>{
     if(layer!==next){next.remove();return;}
     next.classList.add('visible');old?.classList.remove('visible');
   }));
   setTimeout(()=>old?.remove(),reduced()?0:650);
 }
 function select(src){clearTimeout(timer);timer=setTimeout(()=>show(src),110);}
 return {show,select,teamColors,clear};
})();
