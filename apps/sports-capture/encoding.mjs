import {spawn} from 'node:child_process';

export function videoEncodingArgs(encoder) {
 const codec=encoder==='nvenc'
  ? ['-c:v','h264_nvenc','-preset','p4','-tune','ll','-rc','vbr','-cq','19','-profile:v','high']
  : ['-c:v','libx264','-preset','veryfast','-crf','18','-threads','4','-sc_threshold','0'];
 return [...codec,'-b:v','8M','-maxrate','10M','-bufsize','16M','-pix_fmt','yuv420p','-g','120','-keyint_min','120'];
}
export function hlsOutputArgs(encoder,dir) {
 return ['-map','0:v:0','-map','1:a:0',...videoEncodingArgs(encoder),'-c:a','aac','-b:a','192k','-ac','2',
  '-af','aresample=async=1000:first_pts=0','-f','hls','-hls_time','2','-hls_list_size','0','-hls_playlist_type','event',
  '-hls_flags','independent_segments+temp_file','-hls_segment_filename',dir+'/seg%08d.ts',dir+'/index.m3u8'];
}

export async function selectEncoder(preference = 'auto', probe = probeNVENC) {
  if (!['auto','nvenc','cpu'].includes(preference)) throw Error('Invalid capture encoder.');
  if (preference === 'cpu') return {encoder:'cpu',encoderMessage:'CPU encoding selected.'};
  if (await probe()) return {encoder:'nvenc',encoderMessage:'NVIDIA hardware encoding is ready.'};
  if (preference === 'nvenc') throw Error('NVIDIA encoding is unavailable. Choose Automatic or CPU in Sports capture settings.');
  return {encoder:'cpu',encoderMessage:'NVIDIA encoding is unavailable; using CPU encoding.'};
}

function probeNVENC() {
  return new Promise(resolve => {
    const child = spawn('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','color=size=1920x1080:rate=60','-frames:v','2',...videoEncodingArgs('nvenc'),'-f','null','-'],{stdio:'ignore'});
    const timeout = setTimeout(() => { child.kill('SIGKILL'); resolve(false); },10000);
    child.once('error',() => { clearTimeout(timeout); resolve(false); });
    child.once('close',code => { clearTimeout(timeout); resolve(code === 0); });
  });
}
