// A minute of near-total black or stalled/missing video is required before recovery.
export function isBlackFrame(pixels){if(!pixels?.length)return false;let dark=0;for(const value of pixels)if(value<24)dark++;return dark/pixels.length>=0.985;}
export function healthUpdate(previous,unhealthy,now){const since=unhealthy?(previous??now):null;return {since,recover:since!==null&&now-since>=60000};}
export function nextVariant(choices,current){if(choices.length<2)return null;const index=choices.findIndex(c=>c.variant===(current??0));return choices[(index+1)%choices.length]?.variant??null;}
