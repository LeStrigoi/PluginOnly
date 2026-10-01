/* v1.5.3 session bootstrap: execute before the rest of the viewer. */
window.EP_SESSION_TOKEN=(()=>{
  try{
    const hash=new URLSearchParams(location.hash.replace(/^#/,''));
    const incoming=hash.get('token');

    if(incoming){
      sessionStorage.setItem('epatrimoniu_session_token',incoming);
      history.replaceState(null,'',location.pathname+location.search);
      return incoming;
    }

    return sessionStorage.getItem('epatrimoniu_session_token')||'';
  }catch(_){
    return '';
  }
})();

window.epApiFetch=function(url,options={}){
  const headers=new Headers(options.headers||{});

  if(window.EP_SESSION_TOKEN){
    headers.set('X-ePatrimoniu-Token',window.EP_SESSION_TOKEN);
  }

  return fetch(url,{
    ...options,
    headers,
    cache:'no-store'
  });
};
