/* Optional live Arches acquisition (plugin or window.EPATRIMONIU_ARCHES).
   Does not replace normalizeGraph / renderGraph / draw. */
(function(){
  try{
    const params=new URLSearchParams(location.search);
    if(params.get('arches')==='1'||params.get('arches')==='true'){
      const cfg=window.EPATRIMONIU_ARCHES||{};
      if(params.get('base_url'))cfg.baseUrl=params.get('base_url');
      if(params.get('locale'))cfg.locale=params.get('locale');
      if(params.get('graphs_list_url'))cfg.graphsListUrl=params.get('graphs_list_url');
      if(params.get('graph_detail_base')){
        cfg.graphDetailUrl=params.get('graph_detail_base');
      }
      window.EPATRIMONIU_ARCHES=cfg;
    }
  }catch(_){}
})();
