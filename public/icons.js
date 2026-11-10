const animeNavIcon='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11 L7 14 C6.5 10.5 8.5 8 12 8 C11.5 4.5 15.5 2.5 18.5 6.5 C22 2 27 4.5 29 10 C31 15 30 19 26 21 C30 21 30 26 25.5 27 C23.5 27.5 22 26 21 24 C20 29 14 29 13 24 C8 24 3 21 3 17 Z"/><path d="M18.5 6.5 C21 12 18 15 16 12 C15.5 11.4 15.5 10.6 16 10"/><path d="M26 21 C22 21 21.5 18 23 16 C24.5 14 27 15 27.5 16.5"/><path d="M13 24 C10.5 21 10.5 18 12.5 17 C14.5 16 16 18 15.5 20"/></svg>';
// Same 24-unit paths and 1.7-unit stroke used by Android TV's TvShell.Icon.
function navIcon(kind){
 if(kind==='anime')return animeNavIcon.replace('<svg ','<svg aria-hidden="true" focusable="false" ');
 const paths={
  profile:'<circle cx="12" cy="8" r="4"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/>',
  home:'<path d="M3 11 12 3 21 11M6 9v12h4v-6h4v6h4V9"/>',
  search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  sports:'<circle cx="12" cy="12" r="9"/><path d="m6 5 12 14M5 15l14-6"/>',
  more:'<path d="M4 6h16M4 12h16M4 18h16"/>',
  discover:'<circle cx="12" cy="12" r="9"/><path d="m8 16 3-7 5-1-3 7Z"/>',
  movie:'<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M7 5v14M17 5v14M3 9h4m10 0h4M3 15h4m10 0h4"/>',
  tv:'<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M8 22h8"/>',
  live:'<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M8 22h8M9 1l3 4 3-4"/>',
  favorites:'<path d="M12 21 3.8 13a5.3 5.3 0 0 1 7.5-7.5l.7.7.7-.7a5.3 5.3 0 0 1 7.5 7.5Z"/>',
  users:'<circle cx="10" cy="7" r="4"/><path d="M3 18.5a7 6.5 0 0 1 14 0M17 8h5m-2-3 3 3-3 3"/>',
  settings:'<circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="8"/><path d="M20 12h2M17.66 17.66l1.41 1.41M12 20v2m-5.66-4.34-1.41 1.41M4 12H2m4.34-5.66L4.93 4.93M12 4V2m5.66 4.34 1.41-1.41"/>',
  logout:'<path d="M12 3H4v18h8M10 12h12m-4-4 4 4-4 4"/>',
  refresh:'<path d="M20 9a8 8 0 1 0 .2 5M20 3v6h-6"/>'
 };
 return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true" focusable="false">'+(paths[kind]||paths.tv)+'</svg>';
}

