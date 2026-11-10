import path from 'node:path';
import {mkdir, readFile, writeFile, rename} from 'node:fs/promises';
import {randomUUID, createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {analysisProcess, compareIntros} from './intro-analysis.mjs';

export async function createMediaAnalysis(directory, libraries, thumbnails, {
  ffmpeg = process.env.LUMEN_NATIVE_FFMPEG || 'C:/Program Files/Jellyfin/Server/ffmpeg.exe',
  ffprobe = process.env.LUMEN_NATIVE_FFPROBE || 'C:/Program Files/Jellyfin/Server/ffprobe.exe'
} = {}) {
  const root = path.join(directory, 'media-analysis');
  await mkdir(root, {recursive: true});
  const settingsFile = path.join(root, 'settings.json');
  let settings = {mode: 'light', autoSkip: true};
  try { settings = {...settings, ...JSON.parse(await readFile(settingsFile, 'utf8'))}; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }

  const children = new Set(), scans = new Map(), active = new Map();
  const work = new Set(), details = new Map();
  let closed = false, writes = Promise.resolve(), journalWrites = Promise.resolve(), completed = 0, failed = 0, revision = 0;
  const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const identity = item => hash([item.id, item.size, item.modifiedAt]);
  const seasonKey = (libraryId, item) => hash([libraryId, item.seriesId, item.season]);
  async function put(file, value) {
    const temp = file + '.' + randomUUID() + '.tmp';
    await writeFile(temp, JSON.stringify(value));
    await rename(temp, file);
  }
  async function get(file) {
    try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; }
  }

  const journal = path.join(root, 'pending.json');
  const savedQueue = await get(journal);
  function saveQueue() {
    const ids = [...new Set([...scans.keys(), ...active.keys()])];
    journalWrites = journalWrites.catch(() => {}).then(() => put(journal, ids)).catch(() => { failed++; });
  }

  async function source(libraryId, item) {
    const media = await libraries.openMedia(libraryId, item.id, true);
    try {
      const stat = await media.handle.stat();
      if (stat.size !== item.size || stat.mtime.toISOString() !== item.modifiedAt) throw Error('File changed after scan.');
      return {filename: media.filename, size: stat.size, mtime: stat.mtimeMs};
    } finally { await media.handle.close(); }
  }

  async function fingerprint(libraryId, item, stopped, credits) {
    const file = path.join(root, identity(item) + (credits ? '.credits-audio.json' : '.audio.json'));
    const cached = await get(file);
    if (cached) return cached;
    const media = await source(libraryId, item);
    const light = settings.mode === 'light';
    const raw = await analysisProcess(children, ffprobe, ['-v','error','-show_entries','format=duration:stream=index,codec_type','-of','json',media.filename], {light, timeout: 20000});
    const probe = JSON.parse(raw.toString()), duration = Number(probe.format?.duration);
    const audio = probe.streams?.find(stream => stream.codec_type === 'audio');
    if (!audio || !Number.isFinite(duration) || duration < 45) return credits ? {words: [], offset: 0, duration: 0} : [];
    if (stopped()) throw Error('Analysis stopped.');
    const offset = credits ? Math.max(duration * .8, duration - 150) : 0;
    const output = await analysisProcess(children, ffmpeg, ['-nostdin','-v','error','-threads','1',...(credits ? ['-ss',String(offset)] : []),'-i',media.filename,'-map','0:'+audio.index,'-t',String(Math.min(600, duration / 2)),'-vn','-sn','-ac','1','-ar','11025','-fp_format','raw','-f','chromaprint','pipe:1'], {light, timeout: 120000});
    const words = [];
    for (let index = 0; index + 4 <= output.length; index += 4) words.push(output.readUInt32LE(index));
    const result = credits ? {words, offset, duration} : words;
    await put(file, result);
    return result;
  }

  async function analyzeSeason(libraryId, episodes, stopped, report, credits = false) {
    const distinct = [...new Map(episodes.map(item => [item.episode ?? item.id, item])).values()];
    if (distinct.length < 2) return;
    const file = path.join(root, seasonKey(libraryId, episodes[0]) + (credits ? '.credits.json' : '.intro.json'));
    const signature = hash(distinct.map(identity));
    if ((await get(file))?.signature === signature) return;
    const fingerprints = [];
    for (const item of distinct) {
      if (stopped()) return;
      report({phase:credits?'Fingerprinting credits audio':'Fingerprinting intro audio',title:item.metadata?.title||item.title,done:fingerprints.length,total:distinct.length});
      try { fingerprints.push({item, words: await fingerprint(libraryId, item, stopped, credits)}); }
      catch { failed++; }
      await delay(settings.mode === 'light' ? 200 : 0);
    }
    const markers = {};
    for (let index = 0; index < fingerprints.length; index++) {
      if (stopped()) return;
      const current = fingerprints[index];
      report({phase:credits?'Comparing episode credits':'Comparing episode intros',title:current.item.metadata?.title||current.item.title,done:index,total:fingerprints.length});
      let best;
      for (let offset = 1; offset <= Math.min(5, fingerprints.length - 1); offset++) {
        const peer = fingerprints[(index + offset) % fingerprints.length];
        const match = credits ? compareIntros(current.words.words, peer.words.words) : compareIntros(current.words, peer.words);
        if (credits && match && (current.words.duration-current.words.offset-match.end>35 || peer.words.duration-peer.words.offset-match.otherEnd>35)) continue;
        if (match && (!best || match.length > best.length)) best = match;
        await delay(0);
      }
      if (best) markers[identity(current.item)] = credits ? {start: current.words.offset+best.start, end: current.words.duration} : {start: best.start, end: best.end};
    }
    await put(file, {signature: fingerprints.length === distinct.length ? signature : null, markers});
  }

  function groupSeasons(libraryId,items){
    const seasons=new Map();
    for(const item of items)if(item.seriesId&&item.season>0){
      const key=seasonKey(libraryId,item);
      if(!seasons.has(key))seasons.set(key,[]);
      seasons.get(key).push(item);
    }
    return seasons;
  }
  let coverage=null,coverageAt=0,coverageRequest;
  async function libraryCoverage(){
    if(coverage&&Date.now()-coverageAt<12000)return coverage;
    if(coverageRequest)return coverageRequest;
    coverageRequest=(async()=>{
      const rows=[];
      for(const library of libraries.list(true)){
        const items=await libraries.analysisItems(library.id);
        const previews=await thumbnails.completedPreviews(items);
        let complete=previews.size;
        for(const [key,episodes] of groupSeasons(library.id,items)){
          const distinct=[...new Map(episodes.map(item=>[item.episode??item.id,item])).values()];
          if(distinct.length<2||!episodes.some(item=>previews.has(item.id)))continue;
          const manifest=await get(path.join(root,key+'.intro.json'));
          if(manifest?.signature!==hash(distinct.map(identity)))complete-=episodes.filter(item=>previews.has(item.id)).length;
        }
        rows.push({id:library.id,name:library.name,complete,total:items.length});
      }
      coverage=rows;coverageAt=Date.now();return rows;
    })().finally(()=>{coverageRequest=null;});
    return coverageRequest;
  }
  async function drain(libraryId, items, version) {
    const stopped = () => closed || settings.mode === 'off' || version !== revision;
    const report = value => details.set(libraryId, {libraryId,...value});
    const seasons=groupSeasons(libraryId,items);
    for (const episodes of seasons.values()) {
      if (stopped()) return;
      try { await analyzeSeason(libraryId, episodes, stopped, report); } catch { failed++; }
      if (stopped()) return;
      try { await analyzeSeason(libraryId, episodes, stopped, report, true); } catch { failed++; }
    }
    for (const [index,item] of items.entries()) {
      if (stopped()) return;
      const preview = {phase:'Generating timeline previews',title:item.metadata?.title||item.title,done:index,total:items.length};
      report(preview);
      try {
        const media = await source(libraryId, item);
        if (await thumbnails.prebuild(media, {
          light: () => settings.mode === 'light',
          stopped,
          progress: (frames,totalFrames) => report({...preview,frames,totalFrames}),
          run: (binary, args, light) => analysisProcess(children, binary, args, {light})
        })) completed++;
      } catch { failed++; }
    }
  }

  function pump() {
    if (closed || settings.mode === 'off') return;
    const limit = settings.mode === 'maximum' ? 3 : 1;
    for (const [id, items] of scans) {
      if (active.size >= limit) break;
      if (active.has(id)) continue;
      scans.delete(id);
      active.set(id, items);
      const task = drain(id, items, revision).catch(() => { failed++; }).finally(() => {
        active.delete(id);
        details.delete(id);
        work.delete(task);
        if (!closed) saveQueue();
        pump();
      });
      work.add(task);
    }
  }

  return {
    enqueue(id, items) {
      if (!closed) { coverageAt=0;scans.set(id, items); saveQueue(); pump(); }
    },
    async resume() {
      if (!Array.isArray(savedQueue)) return;
      const enabled = new Set(libraries.list(true).filter(entry => entry.enabled).map(entry => entry.id));
      for (const id of savedQueue) {
        if (!enabled.has(id) || scans.has(id) || active.has(id)) continue;
        try { scans.set(id, await libraries.analysisItems(id)); } catch { failed++; }
      }
      saveQueue();
      pump();
    },
    libraryCoverage,
    status() { return {...settings, active: active.size, jobs: [...details.values()], queued: scans.size, completed, failed}; },
    save(input) {
      if (!['off', 'light', 'maximum'].includes(input.mode) || typeof input.autoSkip !== 'boolean') {
        throw Object.assign(Error('Choose a valid analysis mode.'), {status: 400});
      }
      const next = {mode: input.mode, autoSkip: input.autoSkip};
      const task = writes.then(async () => {
        await put(settingsFile, next);
        const previousMode = settings.mode;
        settings = next;
        if (previousMode !== next.mode) {
          revision++;
          for (const [id, items] of active) if (!scans.has(id)) scans.set(id, items);
          for (const child of children) child.kill();
          saveQueue();
        }
        pump();
        return settings;
      });
      writes = task.catch(() => {});
      return task;
    },
    async credits(libraryId, item) {
      if (!item.seriesId || !(item.season > 0)) return null;
      const data = await get(path.join(root, seasonKey(libraryId, item) + ".credits.json"));
      return data?.markers?.[identity(item)] || null;
    },
    async intro(libraryId, item) {
      if (!item.seriesId || !(item.season > 0)) return null;
      const data = await get(path.join(root, seasonKey(libraryId, item) + '.intro.json'));
      const intro = data?.markers?.[identity(item)];
      return intro ? {...intro, automatic: settings.autoSkip} : null;
    },
    async close() {
      closed = true;
      for (const child of children) child.kill();
      await Promise.allSettled([...work, writes, journalWrites]);
    }
  };
}
