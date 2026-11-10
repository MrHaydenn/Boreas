import path from 'node:path';
const fail=message=>Object.assign(Error(message),{status:415});
export function upscaleArguments(filename,probe,tracks,start,destination,{fps60=false,resolution='3840x2160',live=false,strength=1,scaler='vsr'}={}){
  const video=tracks.video;
  if(!video||!['h264','hevc'].includes(video.codec_name))throw fail('AI Upscaling currently requires an H.264 or HEVC source with hardware decoding.');
  if(!(video.width>0&&video.height>0)||video.width>1920||video.height>1080)throw fail('AI Upscaling currently supports video up to 1080p.');
  if(['smpte2084','arib-std-b67'].includes(video.color_transfer)||video.color_primaries==='bt2020')throw fail('AI Upscaling currently supports SDR video. Choose Maximum for HDR sources.');
  const [numerator,denominator=1]=String((video.avg_frame_rate&&video.avg_frame_rate!=='0/0'?video.avg_frame_rate:video.r_frame_rate)||'24/1').split('/').map(Number);
  const rate=denominator>0&&numerator>0?numerator/denominator:24;
  if(live&&fps60&&(rate<59.9||rate>60.1))throw fail('Live 60 fps upscaling requires a source already running at 60 fps. Choose Off for this feed.');
  const outputRate=fps60&&rate<59.9?60:rate;
  const audio=(probe.streams||[]).filter(stream=>stream.codec_type==='audio').findIndex(stream=>stream.index===tracks.audio?.index)+1;
  const resize={nis:'algo=nis,sharpness=0.25',spline:'algo=spline36',anime:'algo=spline36'}[scaler]||'algo=ngx-vsr,vsr-quality='+strength;
  return [
    '--avhw','-i',filename,...(live?[]:['--seek',String(start)]),'--avsync','vfr',
    '--output-res',resolution+',preserve_aspect_ratio=decrease',
    '--vpp-resize',resize,
    ...(scaler==='anime'?['--vpp-anime4k-shader','mode=ani4k_original,scale=1']:[]),
    ...(fps60&&rate<59.9?['--vpp-fruc','fps=60']:[]),
    '--codec','h264','--cqp','18','--gop-len',String(Math.round(outputRate*4)),
    '--max-procfps',String(Math.max(1,Math.ceil(outputRate*1.25))),
    ...(audio?['--audio-codec',audio+'?aac','--audio-bitrate',audio+'?320','--audio-stream',audio+'?:stereo']:[]),
    '--output-format','hls','--mux-option','hls_time:4','--mux-option',live?'hls_list_size:8':'hls_list_size:0',
    '--mux-option','hls_segment_type:fmp4','--mux-option',live?'hls_flags:independent_segments+temp_file+delete_segments':'hls_flags:independent_segments+temp_file',
    '--mux-option','hls_segment_filename:'+path.join(destination,'segment%06d.m4s'),
    '-o',path.join(destination,'index.m3u8')
  ];
}
