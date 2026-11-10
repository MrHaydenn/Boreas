// Dolby Vision stripping is allowed only for a verified HDR10-compatible base layer.
export function hdrDecision(video={},capabilities={},retry=false){
 const dv=video.dolbyVision,base=video.codec==='hevc'&&video.transfer==='smpte2084'&&video.primaries==='bt2020'&&!!dv&&[1,6].includes(dv.compatibilityId);
 const hdr10=capabilities.hdrTypes?.includes(2)===true&&capabilities.hevcMain10===true;
 const profile=capabilities.dolbyVisionProfiles?.find(p=>p.profile===dv?.profile&&p.level>=dv?.level);
 const supported=capabilities.hdrTypes?.includes(1)===true&&!!profile;
 const hdrSource=['smpte2084','arib-std-b67'].includes(video.transfer);
 const displaySupportsSource=video.transfer==='arib-std-b67'?capabilities.hdrTypes?.includes(3)===true&&capabilities.hevcMain10===true:hdr10;
 const sdrFallback=capabilities.reported===true&&hdrSource&&!supported&&!displaySupportsSource&&(!dv||base);
 const fallback=base&&hdr10&&(retry||capabilities.reported===true&&!supported);
 return {sdrFallback,hdr10Fallback:fallback,hdr10BaseAvailable:base&&hdr10,deliveryLabel:fallback?'Original quality · HDR10 base layer':dv?'Original quality · Dolby Vision':'Original quality'};
}
