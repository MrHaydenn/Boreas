let nativeYouTubeAPI;

function loadNativeYouTube(){
  if(globalThis.YT?.Player)return Promise.resolve(globalThis.YT);
  if(nativeYouTubeAPI)return nativeYouTubeAPI;
  nativeYouTubeAPI=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='https://www.youtube.com/iframe_api';
    const timeout=setTimeout(()=>fail('YouTube did not respond.'),12000);
    function fail(message){
      clearTimeout(timeout);
      script.remove();
      nativeYouTubeAPI=null;
      delete globalThis.onYouTubeIframeAPIReady;
      reject(Error(message));
    }
    globalThis.onYouTubeIframeAPIReady=()=>{
      clearTimeout(timeout);
      delete globalThis.onYouTubeIframeAPIReady;
      resolve(globalThis.YT);
    };
    script.onerror=()=>fail('YouTube playback could not load.');
    document.head.append(script);
  });
  return nativeYouTubeAPI;
}

async function renderNativeTrailer(itemId,signal,show,clock){
  const [source,query]=itemId.split('?');
  const [,type,id,season]=/^(movie|tv)~([1-9]\d{0,9})(?:~([1-9]\d{0,2}))?$/.exec(source)||[];
  const name=(new URLSearchParams(query).get('title')||'Trailer').slice(0,160);
  const playerRoot=$('#player'),video=$('#video'),seek=$('#seek'),toggle=$('#toggle-play');
  let player,interval,ready=false,key,readyTimer;
  video.hidden=true;
  for(const id of ['player-settings','player-settings-panel'])$('#'+id).hidden=true;
  $('#player-title').textContent=name;
  $('#player-subtitle').textContent='Trailer';
  document.title=name+' · Trailer · Boreas';
  const surface=document.createElement('div');
  surface.className='native-trailer-surface';
  playerRoot.prepend(surface);
  signal.addEventListener('abort',()=>{
    clearTimeout(readyTimer);
    clearInterval(interval);
    player?.destroy();
    surface.remove();
  },{once:true});
  function error(message){
    if(signal.aborted)return;
    clearTimeout(readyTimer);
    $('#player-loading').hidden=true;
    $('#player-error').textContent=message;
    if(key){
      const link=document.createElement('a');
      link.href='https://www.youtube.com/watch?v='+key;
      link.target='_blank';
      link.rel='noopener noreferrer';
      link.textContent=' Open on YouTube';
      $('#player-error').append(link);
    }
    show();
  }
  function update(){
    $('#native-player-clock').textContent=new Date().toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
    const duration=ready?player.getDuration()||0:0,position=ready?player.getCurrentTime()||0:0;
    const playing=ready&&player.getPlayerState()===1;
    seek.disabled=!duration;
    seek.max=duration||100;
    if(!seek.matches(':active'))seek.value=position;
    seek.setAttribute('aria-valuetext',clock(position)+' of '+clock(duration));
    seek.style.setProperty('--played',(duration?position/duration*100:0)+'%');
    seek.style.setProperty('--buffered',(ready?(player.getVideoLoadedFraction()||0)*100:0)+'%');
    $('#player-elapsed').textContent=clock(position);
    $('#player-duration').textContent=clock(duration);
    $('#player-remaining').textContent='−'+clock(duration-position);
    setNativePlayerIcon(toggle,playing?'pause':'play');
    toggle.setAttribute('aria-label',playing?'Pause (Space)':'Play (Space)');
    const volume=ready&&!player.isMuted()?player.getVolume()/100:0;
    $('#volume').value=volume;
    setNativePlayerIcon($('#player-mute'),volume?'volume':'muted');
  }
  function seekTo(position){
    if(ready)player.seekTo(Math.max(0,Math.min(player.getDuration(),position)),true);
    show();
  }
  toggle.onclick=()=>{
    if(ready){
      if(player.getPlayerState()===1)player.pauseVideo();
      else player.playVideo();
    }
    show();
  };
  $('#skip-back').onclick=()=>seekTo((ready?player.getCurrentTime():0)-10);
  $('#skip-forward').onclick=()=>seekTo((ready?player.getCurrentTime():0)+30);
  seek.oninput=show;
  seek.onchange=()=>seekTo(Number(seek.value));
  $('#volume').oninput=event=>{
    if(!ready)return;
    const volume=Number(event.target.value);
    player.setVolume(volume*100);
    if(volume)player.unMute();else player.mute();
    show();
  };
  $('#player-mute').onclick=()=>{
    if(ready){if(player.isMuted())player.unMute();else player.mute();}
    update();show();
  };
  update();
  show();
  try{
    if(!type)throw Error('Trailer unavailable.');
    const path=discoverPath({type,id,season});
    const result=await api('/discover'+path+'/trailer').catch(()=>({trailer:null}));
    const fallback=season&&!result.trailer?await api('/discover'+discoverPath({type,id})+'/trailer'):null;
    key=result.trailer||fallback?.trailer;
    if(signal.aborted)return;
    if(!/^[\w-]{11}$/.test(key||''))throw Error('No trailer is available for this title.');
    const YT=await loadNativeYouTube();
    if(signal.aborted)return;
    const frame=document.createElement('iframe');
    frame.title=name+' trailer';
    frame.allow='autoplay; encrypted-media; fullscreen';
    frame.referrerPolicy='strict-origin-when-cross-origin';
    frame.src='https://www.youtube-nocookie.com/embed/'+key+'?'+new URLSearchParams({enablejsapi:1,origin:location.origin,autoplay:1,controls:0,playsinline:1,rel:0,disablekb:1,fs:0});
    surface.append(frame);
    readyTimer=setTimeout(()=>error('YouTube playback did not start.'),15000);
    player=new YT.Player(frame,{
      events:{
        onReady:()=>{
          if(signal.aborted)return;
          clearTimeout(readyTimer);
          ready=true;
          $('#player-loading').hidden=true;
          update();show();
        },
        onStateChange:event=>{
          if(signal.aborted)return;
          $('#player-loading').hidden=event.data!==3;
          update();
          if(event.data!==1)show();
        },
        onAutoplayBlocked:()=>{
          if(signal.aborted)return;
          $('#player-loading').hidden=true;
          show();
        },
        onError:event=>error([101,150].includes(event.data)?'This trailer does not allow embedded playback.':'YouTube could not play this trailer.')
      }
    });
    interval=setInterval(update,250);
  }catch(e){error(e.message);}
}
