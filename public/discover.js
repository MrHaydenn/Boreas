function discoverPath(item){
  return '/'+item.type+'/'+item.id+(item.season?'/season/'+item.season:'');
}

function discoverDate(date){
  return /^\d{4}-\d{2}-\d{2}$/.test(date||'')?new Date(date+'T12:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}):'';
}

async function bindNativeTrailer(version,button,type,id,season=null){
  if(!id||!button?.isConnected)return;
  try{
    const path=discoverPath({type,id,season});
    let {trailer}=await api('/discover'+path+'/trailer').catch(()=>({trailer:null}));
    if(!trailer&&season)({trailer}=await api('/discover'+discoverPath({type,id})+'/trailer'));
    if(version!==routeVersion||!button.isConnected||!trailer||!/^[\w-]{11}$/.test(trailer))return;
    const link=document.createElement('a');
    link.className='title-action native-trailer';
    const title=$('#main .title-summary h1')?.textContent.trim()||'Trailer';
    const item=[type,id,season].filter(Boolean).join('~')+'?'+new URLSearchParams({title});
    link.href='#watch/trailer/'+item;
    link.onclick=event=>{
      if(event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
      event.preventDefault();
      NativePlayer.open('trailer',item);
    };
    link.textContent='▷ Trailer';
    link.setAttribute('aria-label','Watch trailer in Boreas');
    button.after(link);
  }catch{}
}

async function renderNativeDiscover(version,params){
  const main=$('#main'),query=params.get('q')?.slice(0,120)||'';
  const categories=[['upcoming','Upcoming'],['anticipated','Highly Anticipated'],['trending','Trending'],['popular','Popular']];
  const category=categories.find(([id])=>id===params.get('category'))?.[0]||'upcoming';
  const browseHash=category==='upcoming'?'discover':'discover?'+new URLSearchParams({category});
  const categoryNav='<nav class="native-discover-categories" aria-label="Discover categories">'+categories.map(([id,label])=>
    '<a href="#discover'+(id==='upcoming'?'':'?category='+id)+'" '+(id===category&&!query?'aria-current="page"':'')+'>'+label+'</a>').join('')+'</nav>';
  main.innerHTML='<form class="native-discover-search"><input name="q" type="search" maxlength="120" aria-label="Search movies, shows and anime" placeholder="Search Discover" autocomplete="off"><button class="native-discover-submit" type="submit" aria-label="Search Discover" title="Search Discover">'+navIcon('search')+'</button></form><div class="web-home-hero native-discover-hero"><section id="native-discover-feature" aria-label="Featured release" hidden></section>'+categoryNav+'</div><div id="home-rows"><p class="count" role="status">Loading Discover…</p></div>';
  const form=main.querySelector('form');
  form.elements.q.value=query;
  form.onsubmit=event=>{
    event.preventDefault();
    const value=form.elements.q.value.trim();
    location.hash=value?'discover?'+new URLSearchParams({category,q:value}):browseHash;
  };
  form.elements.q.addEventListener('search',()=>{if(!form.elements.q.value&&query)location.hash=browseHash;});
  try{
    const {rows}=await api('/discover?'+new URLSearchParams({category,q:query}));
    if(version!==routeVersion)return;
    const cards=[],feature=$('#native-discover-feature');
    $('#home-rows').innerHTML=rows.map(row=>'<div data-row-kind="discover"><section class="section"><div class="section-heading"><h2>'+esc(row.title)+'</h2><div class="row-controls"><button data-home-scroll="-1" aria-label="Scroll '+esc(row.title)+' left" hidden>‹</button><button data-home-scroll="1" aria-label="Scroll '+esc(row.title)+' right" hidden>›</button></div></div><div class="poster-row">'+row.items.map(item=>{
      const index=cards.push(item)-1;
      return '<a class="card" data-home-item="'+index+'" href="#discover'+discoverPath(item)+'"><div class="poster"><img src="'+esc(item.poster||'/branding/lumen-wolf.png')+'" alt="" loading="lazy"></div><span class="card-title">'+esc(item.title)+'</span><span class="card-sub">'+esc([item.subtitle,discoverDate(item.date)].filter(Boolean).join(' · '))+'</span></a>';
    }).join('')+'</div>'+(!row.items.length?'<p class="count">No titles found.</p>':'')+'</section></div>').join('');
    function select(item){
      if(!item)return;
      NativeAtmosphere.show(item.backdrop||item.poster);
      feature.hidden=false;
      feature.innerHTML='<div class="web-hero-copy"><h1><a href="#discover'+discoverPath(item)+'">'+esc(item.title)+'</a></h1><p class="web-hero-meta">'+esc([item.subtitle,discoverDate(item.date)].filter(Boolean).join(' · '))+'</p><p class="web-hero-description">'+esc(item.overview)+'</p></div>';
    }
    main.querySelectorAll('[data-home-item]').forEach(card=>{
      const show=()=>select(cards[Number(card.dataset.homeItem)]);
      card.onfocus=show;card.onpointerenter=show;
    });
    main.querySelectorAll('[data-home-scroll]').forEach(button=>button.onclick=()=>{
      const row=button.closest('.section').querySelector('.poster-row');
      row.scrollBy({left:Number(button.dataset.homeScroll)*row.clientWidth*.8,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
    });
    main.querySelectorAll('#home-rows img').forEach(img=>bindNativeThumbnailFallback(img));
    setupNativeHomeRows(main,cards,select);
  }catch(error){
    if(version===routeVersion)$('#home-rows').innerHTML='<p role="alert">'+esc(error.message)+'</p>';
  }
}

async function renderNativeDiscoverTitle(version,path){
  const main=$('#main');
  main.innerHTML='<p role="status">Loading title…</p>';
  try{
    const {item}=await api('/discover'+path);
    if(version!==routeVersion)return;
    document.title=item.title+' · Boreas';
    NativeAtmosphere.show(item.backdrop||item.poster);
    const info=[item.subtitle,discoverDate(item.date),item.runtime&&item.runtime+' min',...(item.genres||[])].filter(Boolean);
    main.innerHTML='<article class="title-page native-title-page"><div class="title-content"><div class="title-hero"><div class="title-poster poster"><img src="'+esc(item.poster||'/branding/lumen-wolf.png')+'" alt=""></div><div class="title-summary">'+
      nativeTitleHeading(item.title,item.logo)+'<div class="title-meta">'+info.map(value=>'<span>'+esc(value)+'</span>').join('')+'</div><div class="actions title-actions"><button type="button" class="primary" id="discover-download" disabled title="Downloads will be added later">↓ Download</button></div><p class="title-overview">'+esc(item.overview||'No description available.')+'</p></div></div>'+
      (item.cast?.length?'<section class="section"><div class="section-heading"><h2>Cast & crew</h2></div><div class="poster-row people-row">'+item.cast.map(person=>'<article class="person"><div class="person-photo">'+(person.photo?'<img src="'+esc(person.photo)+'" alt="" loading="lazy">':'<span>'+esc(person.name.slice(0,1))+'</span>')+'</div><div class="person-name">'+esc(person.name)+'</div><div class="person-role">'+esc(person.role)+'</div></article>').join('')+'</div></section>':'')+
      '<p class="count">Metadata and artwork provided by TMDB. This product is not endorsed or certified by TMDB.</p></div></article>';
    bindNativeTitleHeading(main);
    
    void bindNativeTrailer(version,$('#discover-download'),item.type,item.id,item.season);
  }catch(error){if(version===routeVersion)main.innerHTML=emptyPage('Title unavailable',error.message);}
}
