async function renderNativeMediaAnalysis(version) {
  const panel = $('#server-content');
  panel.innerHTML = '<p role="status">Loading media analysis settings…</p>';
  try {
    const settings = await api('/media-analysis?coverage=1');
    if (version !== routeVersion) return;
    panel.innerHTML = '<section class="native-panel"><h2>Media analysis</h2><p>After a library scan, Boreas compares episode openings within each season and prepares a timeline preview every 15 seconds. Finished work is reused.</p><form><label>Performance<select name="mode"><option value="light">Light</option><option value="maximum">Maximum</option><option value="off">Off</option></select></label><p class="count">Light runs one low priority job with one decoder thread and limits how quickly it reads the video. Maximum runs up to three libraries in parallel with two decoder threads per preview job. Both use the CPU.</p><label class="check"><input name="autoSkip" type="checkbox"> Automatically skip detected intros in the web player</label><button class="primary" type="submit">Save settings</button><p role="status"></p></form><div class="actions"><button class="subtle" id="native-analyze-existing">Analyze existing libraries</button><button class="subtle" id="native-analysis-refresh">Refresh status</button></div><p id="native-analysis-status" role="status"></p></section><section class="native-panel"><h2>Library progress</h2><p class="count">Counts completed timeline previews and intro analysis where applicable.</p><div id="native-analysis-libraries"></div></section>';
    const form = panel.querySelector('form');
    form.elements.mode.value = settings.mode;
    form.elements.autoSkip.checked = settings.autoSkip;
    const display = state => {
      if (version !== routeVersion) return;
      if(state.libraries){
        $('#native-analysis-libraries').innerHTML=state.libraries.map(library=>{
          const percent=library.total?Math.floor(100*library.complete/library.total):0;
          return '<div class="native-analysis-library"><div><strong>'+esc(library.name)+'</strong><span>'+percent+'%</span></div><progress max="'+Math.max(1,library.total)+'" value="'+library.complete+'" aria-label="'+esc(library.name)+' analysis progress"></progress><small class="count">'+library.complete.toLocaleString()+' of '+library.total.toLocaleString()+' videos analyzed</small></div>';
        }).join('')||'<p class="count">No libraries yet.</p>';
      }
      $('#native-analysis-status').textContent = state.active + ' active libraries · ' + state.queued + ' queued · ' + state.completed + ' videos prepared this session · ' + state.failed + ' errors';
    };
    const request = async (method = 'GET') => {
      try { display(await api(method==='POST'?'/media-analysis':'/media-analysis?coverage=1', method==='POST'?{method,body:{}}:{})); }
      catch (error) { if (version === routeVersion) $('#native-analysis-status').textContent = error.message; }
    };
    display(settings);
    bindForm(form, async () => {
      await api('/media-analysis', {method:'PATCH', body:{mode:form.elements.mode.value, autoSkip:form.elements.autoSkip.checked}});
      await request();
    });
    $('#native-analyze-existing').onclick = () => request('POST');
    $('#native-analysis-refresh').onclick = () => request();
    async function poll(){
      if(version!==routeVersion)return;
      await request();
      if(version===routeVersion)setTimeout(poll,15000);
    }
    setTimeout(poll,15000);
  } catch (error) {
    if (version === routeVersion) panel.textContent = error.message;
  }
}
