/* ---- viewer script block ---- */
const $=id=>document.getElementById(id);
let workspace=window.EPATRIMONIU_WORKSPACE||null,currentFilter='resource',currentWorkspaceId=null,G=null,sourceName='';
let byId,children,positions,nodeEls,edgeEls,edgeLabelEls,groupEls,scale=1,tx=20,ty=20,dragging=false,last=null;
let selectedNodeId=null,focusActive=false,groupsVisible=true;
let comparison=null;

function localName(uri){if(!uri)return'';return String(uri).replace(/\/$/,'').split('/').pop()}
function textOf(v){if(typeof v==='string')return v;if(v&&typeof v==='object')return v.ro||v.en||Object.values(v).find(x=>typeof x==='string')||'';return''}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
function shortId(s){return s?String(s).slice(0,8)+'…':'—'}
function showToast(msg){const t=$('toast');t.textContent=msg;t.style.display='block';clearTimeout(showToast._t);showToast._t=setTimeout(()=>t.style.display='none',4500)}
function uuidOf(ref){if(!ref)return'';if(typeof ref==='string')return ref;if(typeof ref==='object')return String(ref.nodeid||ref.node_id||ref.nodegroupid||ref.nodegroup_id||ref.id||ref.pk||'');return String(ref)}
function extractGraph(raw){
  if(raw&&raw.graph&&!Array.isArray(raw.graph)&&Array.isArray(raw.graph.nodes))return raw.graph;
  if(raw&&raw.graphid&&Array.isArray(raw.nodes))return raw;
  if(raw&&Array.isArray(raw.graph)&&raw.graph.length===1&&Array.isArray(raw.graph[0]?.nodes))return raw.graph[0];
  throw new Error('Fișierul nu conține un graf Arches cu nodes/edges.');
}
function normalizeGraph(g){
  const nodes=(g.nodes||[]).map(n=>({
    id:String(n.nodeid||n.node_id||n.id||''),name:textOf(n.name),alias:n.alias||'',crm:localName(n.ontologyclass),
    crm_uri:n.ontologyclass||'',datatype:n.datatype||'',nodegroup:uuidOf(n.nodegroup_id||n.nodegroupid||n.nodegroup),
    collector:!!n.is_collector,required:!!n.isrequired,top:!!n.istopnode,description:textOf(n.description)
  })).filter(n=>n.id);

  const nodeIds=new Set(nodes.map(n=>n.id));
  const rawEdges=(g.edges||[]);
  const edges=rawEdges.map(e=>({
    id:String(e.edgeid||e.edge_id||e.id||(globalThis.crypto?.randomUUID?.())||Math.random()),
    source:uuidOf(e.domainnode_id||e.domainnodeid||e.domainnode||e.domain_node_id||e.source),
    target:uuidOf(e.rangenode_id||e.rangenodeid||e.rangenode||e.range_node_id||e.target),
    property:localName(e.ontologyproperty||e.ontology_property||e.property),
    property_uri:e.ontologyproperty||e.ontology_property||e.property||''
  })).filter(e=>nodeIds.has(e.source)&&nodeIds.has(e.target));

  const nodegroupMeta=new Map();
  (g.nodegroups||g.node_groups||[]).forEach(ng=>{
    const id=uuidOf(ng.nodegroupid||ng.nodegroup_id||ng.id);
    if(id)nodegroupMeta.set(id,{
      id,
      cardinality:ng.cardinality||ng.cardinality_type||'',
      parent:uuidOf(ng.parentnodegroup_id||ng.parentnodegroupid||ng.parent_nodegroup)
    });
  });

  const groupCounts=new Map();
  nodes.forEach(n=>{if(n.nodegroup)groupCounts.set(n.nodegroup,(groupCounts.get(n.nodegroup)||0)+1)});
  groupCounts.forEach((count,id)=>{
    if(!nodegroupMeta.has(id))nodegroupMeta.set(id,{id,cardinality:'',parent:''});
    nodegroupMeta.get(id).count=count;
  });

  const droppedEdges=rawEdges.length-edges.length;
  let root='';
  if(typeof g.root==='string')root=g.root;
  else if(g.root&&typeof g.root==='object')root=uuidOf(g.root);
  root=root||uuidOf(g.root_id||g.rootid);
  if(!nodeIds.has(root))root=nodes.find(n=>n.top)?.id||'';
  if(!nodeIds.has(root))root=nodes.find(n=>!edges.some(e=>e.target===n.id))?.id||nodes[0]?.id||'';

  return{
    graphName:textOf(g.name)||'Arches graph',graphId:String(g.graphid||''),isresource:!!g.isresource,author:g.author||'',
    description:textOf(g.description),root:String(root||''),nodes,edges,nodegroups:nodegroupMeta,droppedEdges,rawEdgeCount:rawEdges.length
  };
}
function formatDate(iso){if(!iso)return'—';const d=new Date(iso);return Number.isNaN(d.getTime())?iso:d.toLocaleString('ro-RO',{dateStyle:'short',timeStyle:'short'})}
function workspaceGraphs(){return workspace?.graphs||[]}

function renderLibrary(){
  const list=$('modelList');list.innerHTML='';const q=$('modelSearch').value.trim().toLowerCase();
  let arr=workspaceGraphs().filter(item=>{
    if(currentFilter==='resource'&&!item.isresource)return false;
    if(currentFilter==='branch'&&item.isresource)return false;
    return !q||[item.name,item.author,item.graphid].join(' ').toLowerCase().includes(q);
  });
  arr.sort((a,b)=>(a.name||'').localeCompare(b.name||'','ro'));
  if(!arr.length){list.innerHTML='<div style="padding:18px;color:#6b7280;font-size:12px">Nu există rezultate.</div>';return}
  const frag=document.createDocumentFragment();
  arr.forEach(item=>{
    const div=document.createElement('div');div.className='modelItem'+(item.graphid===currentWorkspaceId?' active':'');div.dataset.graphid=item.graphid;
    div.innerHTML=`<div class="modelName">${esc(item.name||item.graphid)}</div><div class="modelMeta">${item.isresource?'Resource Model':'Branch'} · ${item.nodes??'?'} noduri · ${item.edges??'?'} muchii${item.history?.length?` · ${item.history.length} versiuni`:''}</div>`;
    div.onclick=()=>openWorkspaceGraph(item.graphid);frag.appendChild(div);
  });list.appendChild(frag);
}
function isArchesLiveMode(){
  try{
    return !!(window.EPatrimoniuArchesGraphClient&&window.EPatrimoniuArchesGraphClient.isConfigured());
  }catch(_){
    return false;
  }
}

async function loadAndOpenArchesGraph(graphid){
  try{
    showToast('Încarc Resource Model din Arches…');
    const raw=await window.EPatrimoniuArchesGraphClient.fetchGraphResponse(graphid);
    const graph=window.EPatrimoniuArchesGraphClient.unwrapGraph(raw);
    const item=workspaceGraphs().find(x=>x.graphid===graphid);
    if(item){
      item.graph=graph;
      item.nodes=Array.isArray(graph.nodes)?graph.nodes.length:null;
      item.edges=Array.isArray(graph.edges)?graph.edges.length:null;
      item.name=item.name||(typeof textOf==='function'?textOf(graph.name):graph.name)||graphid;
      item.isresource=!!graph.isresource;
      item.author=item.author||graph.author||'';
    }
    currentWorkspaceId=graphid;sourceName='arches-api';G=normalizeGraph(graph);
    selectedNodeId=null;focusActive=false;$('focusBtn').classList.remove('active');$('graphSearch').value='';clearComparison(false);
    renderGraph();renderLibrary();
    // Switch views only after G exists. Callers that run enterViewerMode/showGraphView
    // immediately would otherwise see an empty graph and stay on the name list.
    if(typeof enterViewerMode==='function')enterViewerMode('graph');
    else if(typeof showGraphView==='function')showGraphView();
  }catch(err){
    showToast('Nu am putut încărca graful din Arches: '+(err.message||err));
  }
}

function openWorkspaceGraph(graphid){
  const item=workspaceGraphs().find(x=>x.graphid===graphid);
  if(!item){showToast('Graful nu a fost găsit în workspace.');return}
  if(!item.graph||!Array.isArray(item.graph.nodes)){
    if(isArchesLiveMode())return loadAndOpenArchesGraph(graphid);
    showToast('Workspace-ul nu conține structura completă a acestui graf. Rulează din nou Sync.');
    return;
  }
  currentWorkspaceId=graphid;sourceName=isArchesLiveMode()?'arches-api':'workspace-data.js';G=normalizeGraph(item.graph);
  selectedNodeId=null;focusActive=false;$('focusBtn').classList.remove('active');$('graphSearch').value='';clearComparison(false);
  renderGraph();renderLibrary();
}
function renderGraph(){
  $('empty').style.display='none';$('title').textContent=G.graphName;
  const edgeInfo=G.droppedEdges?` · ${G.droppedEdges} muchii neinterpretate`:'';
  const ngCount=[...G.nodegroups.values()].filter(x=>x.count).length;
  $('stats').textContent=`${G.nodes.length} noduri · ${G.edges.length} muchii · ${ngCount} NodeGroups${edgeInfo} · ${G.isresource?'Resource Model':'Branch'}`;
  byId=new Map(G.nodes.map(n=>[n.id,n]));children=new Map(G.nodes.map(n=>[n.id,[]]));
  G.edges.forEach(e=>children.get(e.source)?.push(e.target));
  buildLayout();draw();fit();if(G.root)selectNode(G.root);
  if(G.droppedEdges)showToast(`${G.graphName}: ${G.droppedEdges} muchii nu au putut fi legate de noduri; graful rămas este afișat.`);
}
function subtreeWeight(id,seen=new Set()){if(seen.has(id))return 1;seen.add(id);const ch=children.get(id)||[];if(!ch.length)return 1;return ch.reduce((s,c)=>s+subtreeWeight(c,new Set(seen)),0)}
function buildLayout(){
  positions=new Map();
  function lay(id,depth,y0,y1,seen){
    if(!id||seen.has(id)||positions.has(id))return;
    seen.add(id);positions.set(id,{x:130+depth*235,y:(y0+y1)/2});
    const ch=(children.get(id)||[]).filter(c=>!seen.has(c)&&!positions.has(c));
    if(!ch.length)return;
    const ws=ch.map(c=>subtreeWeight(c)),tot=ws.reduce((a,b)=>a+b,0)||1;let cur=y0;
    ch.forEach((c,i)=>{const h=(y1-y0)*(ws[i]/tot);lay(c,depth+1,cur,cur+h,new Set(seen));cur+=h});
  }
  const roots=[];if(G.root)roots.push(G.root);
  G.nodes.filter(n=>!G.edges.some(e=>e.target===n.id)&&n.id!==G.root).forEach(n=>roots.push(n.id));
  if(!roots.length&&G.nodes[0])roots.push(G.nodes[0].id);
  let blockTop=70;
  roots.forEach(r=>{if(positions.has(r))return;const size=Math.max(280,subtreeWeight(r)*55);lay(r,0,blockTop,blockTop+size,new Set());blockTop+=size+60});
  G.nodes.forEach(n=>{if(!positions.has(n.id)){positions.set(n.id,{x:130,y:blockTop});blockTop+=65}});
}
const NS='http://www.w3.org/2000/svg';
function el(tag,a={}){const x=document.createElementNS(NS,tag);Object.entries(a).forEach(([k,v])=>x.setAttribute(k,v));return x}
function color(n){if(n.id===G.root)return'#7c3aed';if(n.datatype==='resource-instance')return'#d97706';if(n.datatype==='semantic')return'#2563eb';return'#059669'}
function labelLines(n){const m=$('labelMode').value;if(m==='arches')return[n.name||'(fără etichetă)'];if(m==='cidoc')return[n.crm||'(fără clasă)'];return[n.name||'(fără etichetă)',n.crm||'']}

function groupBounds(){
  const map=new Map();
  G.nodes.forEach(n=>{
    if(!n.nodegroup)return;
    const p=positions.get(n.id);if(!p)return;
    if(!map.has(n.nodegroup))map.set(n.nodegroup,{id:n.nodegroup,minx:p.x,maxx:p.x,miny:p.y,maxy:p.y,count:0});
    const b=map.get(n.nodegroup);b.minx=Math.min(b.minx,p.x);b.maxx=Math.max(b.maxx,p.x);b.miny=Math.min(b.miny,p.y);b.maxy=Math.max(b.maxy,p.y);b.count++;
  });
  return map;
}
function drawGroups(){
  $('groups').innerHTML='';groupEls=new Map();
  const bounds=groupBounds();
  bounds.forEach((b,id)=>{
    const padX=62,padTop=48,padBottom=62;
    const gr=el('g',{class:'nodegroup'+(groupsVisible?'':' hidden')});
    const rect=el('rect',{x:b.minx-padX,y:b.miny-padTop,width:(b.maxx-b.minx)+padX*2,height:(b.maxy-b.miny)+padTop+padBottom});
    const meta=G.nodegroups.get(id)||{};
    const card=meta.cardinality?` · ${meta.cardinality}`:'';
    const text=el('text',{x:b.minx-padX+10,y:b.miny-padTop+16});
    text.textContent=`NodeGroup ${shortId(id)} · ${b.count} nod${b.count===1?'':'uri'}${card}`;
    gr.appendChild(rect);gr.appendChild(text);$('groups').appendChild(gr);groupEls.set(id,gr);
  });
}
function draw(){
  $('groups').innerHTML='';$('edges').innerHTML='';$('edgeLabels').innerHTML='';$('nodes').innerHTML='';
  nodeEls=new Map();edgeEls=new Map();edgeLabelEls=new Map();groupEls=new Map();
  drawGroups();
  G.edges.forEach(e=>{
    const a=positions.get(e.source),b=positions.get(e.target);if(!a||!b)return;
    const mx=(a.x+b.x)/2,d=`M ${a.x+23} ${a.y} C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x-23} ${b.y}`;
    const p=el('path',{d,class:'edge'});$('edges').appendChild(p);edgeEls.set(e.id,p);
    const t=el('text',{x:mx,y:(a.y+b.y)/2-5,class:'edge-label'});t.textContent=e.property;$('edgeLabels').appendChild(t);edgeLabelEls.set(e.id,t);
  });
  G.nodes.forEach(n=>{
    const p=positions.get(n.id);if(!p)return;
    const gr=el('g',{class:'node',transform:`translate(${p.x},${p.y})`});gr.appendChild(el('circle',{r:22,fill:color(n)}));
    const t=el('text',{y:34});labelLines(n).forEach((line,i)=>{const sp=el('tspan',{x:0,dy:i?13:0,class:i?'crm':''});sp.textContent=line;t.appendChild(sp)});gr.appendChild(t);
    gr.onclick=e=>{e.stopPropagation();selectNode(n.id)};$('nodes').appendChild(gr);nodeEls.set(n.id,gr);
  });
  if(selectedNodeId)selectNode(selectedNodeId,false);else applyFocus();
}
function updateGroupSelection(){
  groupEls?.forEach(g=>g.classList.remove('active'));
  const n=byId?.get(selectedNodeId);
  if(n?.nodegroup)groupEls?.get(n.nodegroup)?.classList.add('active');
}
function focusSet(){
  if(!focusActive||!selectedNodeId)return null;
  const keep=new Set([selectedNodeId]);
  G.edges.forEach(e=>{if(e.source===selectedNodeId)keep.add(e.target);if(e.target===selectedNodeId)keep.add(e.source)});
  return keep;
}
function applyFocus(){
  if(!G||!nodeEls)return;
  const keep=focusSet();
  nodeEls.forEach((nodeEl,id)=>nodeEl.classList.toggle('dim',!!keep&&!keep.has(id)));
  G.edges.forEach(e=>{
    const isDirect=!!keep&&(e.source===selectedNodeId||e.target===selectedNodeId);
    const dim=!!keep&&!isDirect;
    edgeEls.get(e.id)?.classList.toggle('dim',dim);
    edgeEls.get(e.id)?.classList.toggle('focused',isDirect);
    edgeLabelEls.get(e.id)?.classList.toggle('dim',dim);
  });
  groupEls?.forEach((g,id)=>{
    if(!keep){g.classList.remove('dim');return}
    const memberVisible=G.nodes.some(n=>n.nodegroup===id&&keep.has(n.id));
    g.classList.toggle('dim',!memberVisible);
  });
}
function selectNode(id,renderInspector=true){
  selectedNodeId=id;
  nodeEls?.forEach((e,k)=>e.classList.toggle('selected',k===id));
  updateGroupSelection();
  applyFocus();
  const n=byId?.get(id);if(!n||!renderInspector)return;
  const out=G.edges.filter(e=>e.source===id),inc=G.edges.filter(e=>e.target===id);
  const ng=n.nodegroup?(G.nodegroups.get(n.nodegroup)||{}):null;
  const groupMembers=n.nodegroup?G.nodes.filter(x=>x.nodegroup===n.nodegroup):[];
  $('side').innerHTML=`<h2>${esc(n.name)}</h2><div class="crmTitle">${esc(n.crm)}</div>
  <div class="kv"><div class="k">Datatype</div><div class="v"><span class="badge">${esc(n.datatype||'—')}</span>${n.collector?'<span class="badge">collector</span>':''}${n.required?'<span class="badge">required</span>':''}</div></div>
  <div class="kv"><div class="k">CIDOC CRM class</div><div class="v">${esc(n.crm_uri||'—')}</div></div>
  <div class="kv"><div class="k">NodeGroup / pattern</div><div class="v">${n.nodegroup?`<b>${esc(shortId(n.nodegroup))}</b><br>${groupMembers.length} noduri${ng?.cardinality?` · cardinalitate ${esc(ng.cardinality)}`:''}`:'—'}</div></div>
  <div class="kv"><div class="k">Muchii intrare</div><div class="v">${inc.map(e=>esc(e.property)).join('<br>')||'—'}</div></div>
  <div class="kv"><div class="k">Muchii ieșire</div><div class="v">${out.map(e=>esc(e.property)).join('<br>')||'—'}</div></div>
  <div class="kv"><div class="k">Descriere</div><div class="v">${esc(n.description||'—')}</div></div>
  <div class="kv"><div class="k">Model</div><div class="v">${esc(G.graphName)}<br>${G.isresource?'Resource Model':'Branch'}<br>Graph ID: ${esc(G.graphId||'—')}</div></div>
  <div class="legend"><span><i class="dot" style="background:#7c3aed"></i>root</span><span><i class="dot" style="background:#2563eb"></i>semantic</span><span><i class="dot" style="background:#059669"></i>value</span><span><i class="dot" style="background:#d97706"></i>resource link</span></div>`;
}
function apply(){$('viewport').setAttribute('transform',`translate(${tx},${ty}) scale(${scale})`)}
function fit(){
  if(!G)return;

  // Always measure from a neutral transform. This avoids carrying pan/zoom
  // from the previous graph into the centering calculation.
  tx=0;
  ty=0;
  scale=1;
  apply();

  requestAnimationFrame(()=>{
    requestAnimationFrame(()=>{
      requestAnimationFrame(()=>{
        try{
          const svg=$('svg');
          const vp=$('viewport');
          const svgRect=svg.getBoundingClientRect();
          const graphRect=vp.getBoundingClientRect();

          if(svgRect.width<=0||svgRect.height<=0||graphRect.width<=0||graphRect.height<=0)return;

          // At identity transform, SVG CSS pixels and graph client pixels have
          // the same scale. Use the real rendered bounds, including labels/groups.
          const gx=graphRect.left-svgRect.left;
          const gy=graphRect.top-svgRect.top;
          const gw=Math.max(graphRect.width,1);
          const gh=Math.max(graphRect.height,1);

          const paddingX=58;
          const paddingY=58;
          const maxScale=(G.nodes.length<=4)?1.30:1.45;

          scale=Math.min(
            (svgRect.width-paddingX*2)/gw,
            (svgRect.height-paddingY*2)/gh,
            maxScale
          );
          scale=Math.max(.20,scale);

          const graphCx=gx+gw/2;
          const graphCy=gy+gh/2;

          // Exact center of the graph canvas.
          const targetX=svgRect.width/2;
          const targetY=svgRect.height/2;

          tx=targetX-graphCx*scale;
          ty=targetY-graphCy*scale;
          apply();
        }catch(err){
          showToast('Nu am putut recalcula încadrarea grafului.');
        }
      });
    });
  });
}
$('svg').onmousedown=e=>{dragging=true;last={x:e.clientX,y:e.clientY}};window.onmouseup=()=>dragging=false;
window.onmousemove=e=>{if(!dragging)return;tx+=e.clientX-last.x;ty+=e.clientY-last.y;last={x:e.clientX,y:e.clientY};apply()};
$('svg').addEventListener('wheel',e=>{e.preventDefault();const r=$('svg').getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top,old=scale;scale=Math.max(.2,Math.min(3,scale*(e.deltaY<0?1.1:.9)));tx=mx-(mx-tx)*(scale/old);ty=my-(my-ty)*(scale/old);apply()},{passive:false});
$('fitBtn').onclick=fit;
$('labelMode').onchange=()=>{if(G)draw()};
$('reloadBtn').onclick=()=>location.reload();
$('groupsBtn').onclick=()=>{
  groupsVisible=!groupsVisible;$('groupsBtn').classList.toggle('active',groupsVisible);
  groupEls?.forEach(g=>g.classList.toggle('hidden',!groupsVisible));
};
$('focusBtn').onclick=()=>{
  if(!selectedNodeId){showToast('Selectează mai întâi un nod.');return}
  focusActive=!focusActive;$('focusBtn').classList.toggle('active',focusActive);
  if(focusActive)$('graphSearch').value='';
  applyFocus();
};
$('graphSearch').oninput=e=>{
  if(!G)return;
  const q=e.target.value.trim().toLowerCase();
  if(q&&focusActive){focusActive=false;$('focusBtn').classList.remove('active')}
  if(!q){applyFocus();return}
  const m=new Set(G.nodes.filter(n=>[n.name,n.alias,n.crm,n.datatype].join(' ').toLowerCase().includes(q)).map(n=>n.id));
  G.edges.filter(e=>e.property.toLowerCase().includes(q)).forEach(e=>{m.add(e.source);m.add(e.target)});
  nodeEls.forEach((x,id)=>x.classList.toggle('dim',!m.has(id)));
  G.edges.forEach(e=>{const dim=!(m.has(e.source)&&m.has(e.target))&&!e.property.toLowerCase().includes(q);edgeEls.get(e.id)?.classList.toggle('dim',dim);edgeLabelEls.get(e.id)?.classList.toggle('dim',dim)});
  groupEls?.forEach((g,id)=>{const groupMatch=G.nodes.some(n=>n.nodegroup===id&&m.has(n.id));g.classList.toggle('dim',!groupMatch)});
};
$('modelSearch').oninput=renderLibrary;
document.querySelectorAll('.tab').forEach(btn=>btn.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));btn.classList.add('active');currentFilter=btn.dataset.filter;renderLibrary()});
function openPicker(){$('fileInput').click()}$('openBtn').onclick=openPicker;$('fileInput').onchange=e=>{if(e.target.files[0])readFile(e.target.files[0])};
async function readFile(file){
  try{
    G=normalizeGraph(extractGraph(JSON.parse(await file.text())));currentWorkspaceId=null;sourceName=file.name;
    selectedNodeId=null;focusActive=false;$('focusBtn').classList.remove('active');$('graphSearch').value='';clearComparison(false);
    renderGraph();renderLibrary()
  }catch(err){showToast('Nu am putut deschide fișierul: '+err.message)}
}
async function initWorkspaceFromArches(){
  try{
    $('workspaceInfo').textContent='Încărcare din Arches…';
    workspace=await window.EPatrimoniuArchesGraphClient.buildWorkspaceShell();
    window.EPATRIMONIU_WORKSPACE=workspace;
    $('workspaceInfo').textContent=`${workspace.graphs.length} grafuri · Arches live`;
    renderLibrary();
    const first=workspace.graphs.find(x=>x.isresource)||workspace.graphs[0];
    if(first)openWorkspaceGraph(first.graphid);
  }catch(err){
    $('workspaceInfo').textContent='Arches live eșuat';
    showToast('Nu am putut lista grafurile din Arches: '+(err.message||err));
    renderLibrary();
  }
}

function initWorkspace(){
  if(isArchesLiveMode()){
    initWorkspaceFromArches();
    return;
  }
  if(!workspace||!Array.isArray(workspace.graphs)){$('workspaceInfo').textContent='Pornește aplicația prin ePatrimoniu Viewer.cmd.';renderLibrary();return}
  $('workspaceInfo').textContent=`${workspace.graphs.length} grafuri`;renderLibrary();
  const first=workspace.graphs.find(x=>x.isresource)||workspace.graphs[0];if(first)openWorkspaceGraph(first.graphid);
}
initWorkspace();

/* ---- viewer script block ---- */
/* v0.8 UX + version comparison layer */
function currentWorkspaceItem(){
  return workspaceGraphs().find(x=>x.graphid===currentWorkspaceId)||null;
}
function graphNodeSignature(n){
  return JSON.stringify([n.name,n.alias,n.crm_uri,n.datatype,n.nodegroup,n.collector,n.required,n.description]);
}
function graphEdgeSignature(e){
  return JSON.stringify([e.source,e.target,e.property_uri]);
}
function readableNode(n){
  if(!n)return '(nod necunoscut)';
  return `${n.name||'(fără etichetă)'}${n.crm?` [${n.crm}]`:''}`;
}
function computeComparison(previousRaw){
  const oldG=normalizeGraph(previousRaw);
  const curG=G;
  const oldNodes=new Map(oldG.nodes.map(n=>[n.id,n]));
  const curNodes=new Map(curG.nodes.map(n=>[n.id,n]));
  const oldEdges=new Map(oldG.edges.map(e=>[e.id,e]));
  const curEdges=new Map(curG.edges.map(e=>[e.id,e]));

  const addedNodes=[],removedNodes=[],modifiedNodes=[];
  curNodes.forEach((n,id)=>{
    if(!oldNodes.has(id))addedNodes.push(n);
    else if(graphNodeSignature(n)!==graphNodeSignature(oldNodes.get(id)))modifiedNodes.push({before:oldNodes.get(id),after:n});
  });
  oldNodes.forEach((n,id)=>{if(!curNodes.has(id))removedNodes.push(n)});

  const addedEdges=[],removedEdges=[],modifiedEdges=[];
  curEdges.forEach((e,id)=>{
    if(!oldEdges.has(id))addedEdges.push(e);
    else if(graphEdgeSignature(e)!==graphEdgeSignature(oldEdges.get(id)))modifiedEdges.push({before:oldEdges.get(id),after:e});
  });
  oldEdges.forEach((e,id)=>{if(!curEdges.has(id))removedEdges.push(e)});

  return {oldG,addedNodes,removedNodes,modifiedNodes,addedEdges,removedEdges,modifiedEdges};
}
function applyComparisonStyles(){
  nodeEls?.forEach(el=>el.classList.remove('diff-added','diff-modified'));
  edgeEls?.forEach(el=>el.classList.remove('diff-added','diff-modified'));
  if(!comparison)return;
  comparison.addedNodes.forEach(n=>nodeEls?.get(n.id)?.classList.add('diff-added'));
  comparison.modifiedNodes.forEach(x=>nodeEls?.get(x.after.id)?.classList.add('diff-modified'));
  comparison.addedEdges.forEach(e=>edgeEls?.get(e.id)?.classList.add('diff-added'));
  comparison.modifiedEdges.forEach(x=>edgeEls?.get(x.after.id)?.classList.add('diff-modified'));
}
function listHtml(items,formatter,limit=10){
  if(!items.length)return '<span style="color:#6b7280">—</span>';
  const visible=items.slice(0,limit);
  const more=items.length>limit?`<li>… încă ${items.length-limit}</li>`:'';
  return `<ul class="compareList">${visible.map(x=>`<li>${esc(formatter(x))}</li>`).join('')}${more}</ul>`;
}
function renderComparisonSummary(snapshot){
  const c=comparison;
  $('compareSummary').innerHTML=`
    <div>
      <span class="diffBadge diffAdd">+ ${c.addedNodes.length} noduri</span>
      <span class="diffBadge diffMod">~ ${c.modifiedNodes.length} noduri</span>
      <span class="diffBadge diffRem">− ${c.removedNodes.length} noduri</span>
    </div>
    <div style="margin-top:5px">
      <span class="diffBadge diffAdd">+ ${c.addedEdges.length} muchii</span>
      <span class="diffBadge diffMod">~ ${c.modifiedEdges.length} muchii</span>
      <span class="diffBadge diffRem">− ${c.removedEdges.length} muchii</span>
    </div>
    <div class="compareHint">Comparat cu snapshot: ${esc(formatDate(snapshot.timestamp))}. Verde = adăugat, portocaliu = modificat. Elementele eliminate nu mai există în graful curent și sunt enumerate mai jos.</div>
    <h4>Noduri adăugate</h4>${listHtml(c.addedNodes,readableNode)}
    <h4>Noduri modificate</h4>${listHtml(c.modifiedNodes,x=>readableNode(x.after))}
    <h4>Noduri eliminate</h4>${listHtml(c.removedNodes,readableNode)}
    <h4>Muchii eliminate</h4>${listHtml(c.removedEdges,e=>`${e.property||'(proprietate)'} · ${readableNode(c.oldG.nodes.find(n=>n.id===e.source))} → ${readableNode(c.oldG.nodes.find(n=>n.id===e.target))}`,8)}
  `;
}
function clearComparison(hidePanel=true){
  comparison=null;
  $('compareBtn')?.classList.remove('active');
  nodeEls?.forEach(el=>el.classList.remove('diff-added','diff-modified'));
  edgeEls?.forEach(el=>el.classList.remove('diff-added','diff-modified'));
  if($('compareSummary'))$('compareSummary').innerHTML='';
  if(hidePanel&&$('comparePanel'))$('comparePanel').style.display='none';
}
function openComparePanel(){
  const item=currentWorkspaceItem();
  const history=item?.history||[];
  if(!item){
    showToast('Comparația este disponibilă pentru grafurile deschise din workspace.');
    return;
  }
  if(!history.length){
    showToast('Nu există încă o versiune anterioară pentru acest graf. După o modificare în Arches și un nou sync, versiunea veche va apărea aici.');
    return;
  }
  const sel=$('historySelect');
  sel.innerHTML='';
  history.forEach((h,i)=>{
    const op=document.createElement('option');
    op.value=String(i);
    op.textContent=`${formatDate(h.timestamp)} · ${h.nodes??'?'} noduri / ${h.edges??'?'} muchii`;
    sel.appendChild(op);
  });
  $('comparePanel').style.display='block';
}
function applySelectedComparison(){
  const item=currentWorkspaceItem();
  const history=item?.history||[];
  const idx=Number($('historySelect').value||0);
  const snapshot=history[idx];
  if(!snapshot?.graph){showToast('Snapshot-ul selectat nu conține graful.');return}
  comparison=computeComparison(snapshot.graph);
  $('compareBtn').classList.add('active');
  applyComparisonStyles();
  renderComparisonSummary(snapshot);
}

const originalDraw=draw;
draw=function(){
  originalDraw();
  applyComparisonStyles();
};

$('compareBtn').onclick=openComparePanel;
$('compareClose').onclick=()=>{$('comparePanel').style.display='none'};
$('applyCompare').onclick=applySelectedComparison;
$('clearCompare').onclick=()=>clearComparison(true);

/* Rewire fit button to the v0.8 bounding-box implementation. */
$('fitBtn').onclick=fit;

/* Clear button for model/resource search. */
const modelSearchInput=$('modelSearch');
const modelClearBtn=$('modelClear');
function updateModelClear(){
  modelClearBtn.style.display=modelSearchInput.value?'block':'none';
}
modelSearchInput.addEventListener('input',updateModelClear);
modelClearBtn.onclick=()=>{
  modelSearchInput.value='';
  updateModelClear();
  renderLibrary();
  modelSearchInput.focus();
};
updateModelClear();

/* Recenter the graph already opened by initWorkspace with the corrected method. */
setTimeout(fit,60);

/* ---- viewer script block ---- */
/* v0.9 semantic path analysis */
let pathMode=false;
let pathStartId=null;
let pathEndId=null;
let pathResult=null;

function resetPathVisuals(){
  nodeEls?.forEach(el=>el.classList.remove('path-node','path-start','path-end'));
  edgeEls?.forEach(el=>el.classList.remove('path-edge'));
}
function clearSemanticPath(updateUi=true){
  pathMode=false;
  pathStartId=null;
  pathEndId=null;
  pathResult=null;
  resetPathVisuals();
  $('pathBtn')?.classList.remove('active');
  if($('clearPathBtn'))$('clearPathBtn').style.display='none';
  if($('pathState')){
    $('pathState').style.display='none';
    $('pathState').textContent='';
  }
  if(updateUi && G){
    applyFocus();
    const q=$('graphSearch').value.trim();
    if(q)$('graphSearch').dispatchEvent(new Event('input'));
    if(selectedNodeId)selectNode(selectedNodeId);
  }
}
function neighborsForPath(id){
  const arr=[];
  G.edges.forEach(e=>{
    if(e.source===id)arr.push({next:e.target,edge:e,forward:true});
    if(e.target===id)arr.push({next:e.source,edge:e,forward:false});
  });
  return arr;
}
function shortestSemanticPath(startId,endId){
  if(startId===endId)return {nodes:[startId],steps:[]};
  const queue=[startId];
  const seen=new Set([startId]);
  const prev=new Map();

  while(queue.length){
    const cur=queue.shift();
    for(const rel of neighborsForPath(cur)){
      if(seen.has(rel.next))continue;
      seen.add(rel.next);
      prev.set(rel.next,{from:cur,edge:rel.edge,forward:rel.forward});
      if(rel.next===endId){
        const nodes=[endId],steps=[];
        let walk=endId;
        while(walk!==startId){
          const p=prev.get(walk);
          steps.push({from:p.from,to:walk,edge:p.edge,forward:p.forward});
          nodes.push(p.from);
          walk=p.from;
        }
        nodes.reverse();
        steps.reverse();
        return {nodes,steps};
      }
      queue.push(rel.next);
    }
  }
  return null;
}
function applySemanticPath(){
  resetPathVisuals();
  if(!pathResult)return;

  const keep=new Set(pathResult.nodes);
  pathResult.nodes.forEach(id=>nodeEls?.get(id)?.classList.add('path-node'));
  nodeEls?.get(pathStartId)?.classList.add('path-start');
  nodeEls?.get(pathEndId)?.classList.add('path-end');
  pathResult.steps.forEach(s=>edgeEls?.get(s.edge.id)?.classList.add('path-edge'));

  nodeEls?.forEach((el,id)=>el.classList.toggle('dim',!keep.has(id)));
  G.edges.forEach(e=>{
    const isPath=pathResult.steps.some(s=>s.edge.id===e.id);
    edgeEls.get(e.id)?.classList.toggle('dim',!isPath);
    edgeLabelEls.get(e.id)?.classList.toggle('dim',!isPath);
  });

  groupEls?.forEach((g,id)=>{
    const visible=G.nodes.some(n=>n.nodegroup===id&&keep.has(n.id));
    g.classList.toggle('dim',!visible);
  });

  $('clearPathBtn').style.display='inline-block';
}
function pathDescriptionHtml(){
  if(!pathResult)return '';
  const steps=pathResult.steps.map((s,i)=>{
    const from=byId.get(s.from),to=byId.get(s.to);
    const arrow=s.forward?'→':'←';
    return `<div class="pathStep">
      <strong>${esc(from?.name||from?.crm||s.from)}</strong>
      <div class="pathProp">${arrow} ${esc(s.edge.property||'(proprietate fără etichetă)')}</div>
      <strong>${esc(to?.name||to?.crm||s.to)}</strong>
    </div>`;
  }).join('');
  return `<div class="kv"><div class="k">Traseu semantic</div><div class="v">
    <span class="badge">${pathResult.steps.length} relații</span>
    ${steps||'<div class="pathStep">Același nod.</div>'}
  </div></div>`;
}
function renderPathInspector(){
  if(!pathResult)return;
  const start=byId.get(pathStartId),end=byId.get(pathEndId);
  $('side').innerHTML=`<h2>Traseu semantic</h2>
    <div class="crmTitle">${esc(start?.name||start?.crm||'Start')} → ${esc(end?.name||end?.crm||'Destinație')}</div>
    ${pathDescriptionHtml()}
    <div class="kv"><div class="k">Metodă</div><div class="v">Cea mai scurtă cale în structura grafului. Pentru găsirea căii, relațiile pot fi parcurse în ambele sensuri; săgeata din traseu arată direcția reală a proprietății Arches/CIDOC CRM.</div></div>`;
}
function handlePathNodeSelection(id){
  if(!pathMode)return false;
  if(!pathStartId){
    pathStartId=id;
    $('pathState').style.display='block';
    $('pathState').textContent='Start selectat. Alege nodul destinație.';
    nodeEls?.get(id)?.classList.add('path-start');
    return true;
  }
  pathEndId=id;
  pathResult=shortestSemanticPath(pathStartId,pathEndId);
  pathMode=false;
  $('pathBtn').classList.remove('active');

  if(!pathResult){
    $('pathState').style.display='block';
    $('pathState').textContent='Nu există o cale între cele două noduri.';
    $('clearPathBtn').style.display='inline-block';
    showToast('Nu există o cale între nodurile selectate.');
    return true;
  }

  $('pathState').style.display='block';
  $('pathState').textContent=`Traseu: ${pathResult.steps.length} relații.`;
  applySemanticPath();
  renderPathInspector();
  return true;
}

const v09OriginalSelectNode=selectNode;
selectNode=function(id,renderInspector=true){
  if(pathMode){
    const consumed=handlePathNodeSelection(id);
    if(consumed){
      selectedNodeId=id;
      nodeEls?.forEach((e,k)=>e.classList.toggle('selected',k===id));
      updateGroupSelection();
      return;
    }
  }
  v09OriginalSelectNode(id,renderInspector);
  if(pathResult){
    applySemanticPath();
    renderPathInspector();
  }
};

const v09OriginalDraw=draw;
draw=function(){
  v09OriginalDraw();
  if(pathResult)applySemanticPath();
};

$('pathBtn').onclick=()=>{
  if(!G){
    showToast('Alege mai întâi un graf.');
    return;
  }

  clearSemanticPath(false);

  if(focusActive){
    focusActive=false;
    $('focusBtn').classList.remove('active');
  }

  // Clear any existing search WITHOUT dispatching the input event,
  // because the search input intentionally cancels semantic-path mode.
  $('graphSearch').value='';

  // Restore the full graph before entering path-selection mode.
  nodeEls?.forEach(el=>el.classList.remove('dim'));
  edgeEls?.forEach(el=>el.classList.remove('dim'));
  edgeLabelEls?.forEach(el=>el.classList.remove('dim'));
  groupEls?.forEach(el=>el.classList.remove('dim'));

  pathMode=true;
  pathStartId=null;
  pathEndId=null;
  pathResult=null;

  $('pathBtn').classList.add('active');
  $('pathState').style.display='block';
  $('pathState').textContent='Alege nodul de start (click pe un nod).';
};
$('clearPathBtn').onclick=()=>clearSemanticPath(true);

/* Path state must not leak between graphs or manual files. */
const v09OriginalOpenWorkspaceGraph=openWorkspaceGraph;
openWorkspaceGraph=function(graphid){
  clearSemanticPath(false);
  return v09OriginalOpenWorkspaceGraph(graphid);
};
const v09OriginalReadFile=readFile;
readFile=async function(file){
  clearSemanticPath(false);
  await v09OriginalReadFile(file);
};

/* Focus/search cancel the semantic path visualization to avoid ambiguous dimming rules. */
const v09OldFocusClick=$('focusBtn').onclick;
$('focusBtn').onclick=()=>{
  if(pathResult||pathMode)clearSemanticPath(false);
  v09OldFocusClick();
};
$('graphSearch').addEventListener('input',()=>{
  if(pathResult||pathMode)clearSemanticPath(false);
});

/* ---- viewer script block ---- */
/* v1.0 Workspace Overview / Model Map */
let workspaceMode=true;

function graphNodegroupCount(item){
  const nodes=item?.graph?.nodes||[];
  const ids=new Set();
  nodes.forEach(n=>{
    const id=uuidOf(n.nodegroup_id||n.nodegroupid||n.nodegroup);
    if(id)ids.add(id);
  });
  return ids.size;
}
function overviewFilteredGraphs(){
  const q=$('modelSearch')?.value.trim().toLowerCase()||'';
  return workspaceGraphs().filter(item=>{
    if(currentFilter==='resource'&&!item.isresource)return false;
    if(currentFilter==='branch'&&item.isresource)return false;
    if(q && ![item.name,item.author,item.graphid].join(' ').toLowerCase().includes(q))return false;
    return true;
  });
}
function setLibraryFilter(filter){
  currentFilter=filter;
  document.querySelectorAll('.tab').forEach(btn=>btn.classList.toggle('active',btn.dataset.filter===filter));
  renderLibrary();
  if(workspaceMode){
    renderWorkspaceOverview();
    if($('workspaceMaps'))$('workspaceMaps').scrollTop=0;
  }
}
function overviewSide(){
  if(!$('side'))return;
  const graphs=workspaceGraphs();
  const resources=graphs.filter(x=>x.isresource).length;
  const branches=graphs.length-resources;
  $('side').innerHTML=`<h2>Workspace</h2>
    <div class="crmTitle">${graphs.length} grafuri sincronizate</div>
    <div class="kv"><div class="k">Resource Models</div><div class="v">${resources}</div></div>
    <div class="kv"><div class="k">Branches</div><div class="v">${branches}</div></div>
    <div class="kv"><div class="k">Navigare</div><div class="v">Folosește căutarea și filtrele din stânga. Click pe un element din Model Map sau din listă pentru a deschide graful intern.</div></div>
    <div class="kv"><div class="k">Interpretare</div><div class="v">Dimensiunea barei din fiecare card reflectă relativ numărul de noduri. Harta nu presupune că un Branch a fost reutilizat într-un anumit Resource Model.</div></div>`;
}
function statCard(value,label,filter=null){
  const click=filter?` data-filter="${filter}" class="statCard clickable"`:` class="statCard"`;
  return `<div${click}><div class="statValue">${esc(value)}</div><div class="statLabel">${esc(label)}</div></div>`;
}
const overviewInitialLimit=12;
const workspaceExpanded={resource:false,branch:false};

function mapSection(title,description,items,typeClass,maxNodes,sectionKey){
  if(!items.length){
    return `<div class="workspaceSection"><div class="workspaceSectionHead"><div><h3>${esc(title)}</h3><p>${esc(description)}</p></div><span class="workspaceCount">0 rezultate</span></div><div class="emptyOverview">Niciun graf corespunde filtrului/căutării curente.</div></div>`;
  }

  const hasSearch=!!($('modelSearch')?.value.trim());
  const expanded=hasSearch || workspaceExpanded[sectionKey];

  // IMPORTANT: expanded means ALL items, never a second truncated subset.
  const visibleItems = expanded ? items : items.slice(0,overviewInitialLimit);

  const cards=visibleItems.map(item=>{
    const ng=graphNodegroupCount(item);
    const pct=Math.max(4,Math.round(((item.nodes||0)/Math.max(maxNodes,1))*100));
    const hist=item.history?.length||0;
    return `<div class="mapItem ${typeClass}" data-graphid="${esc(item.graphid)}" title="Deschide ${esc(item.name||item.graphid)}">
      <div class="mapName">${esc(item.name||item.graphid)}</div>
      <div class="mapType">${item.isresource?'Resource Model':'Branch'}</div>
      <div class="mapMetrics"><span>${item.nodes??'?'} noduri</span><span>${item.edges??'?'} muchii</span><span>${ng} NG</span>${hist?`<span>${hist} vers.</span>`:''}</div>
      <div class="complexTrack"><div class="complexFill" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');

  let more='';
  if(!hasSearch && items.length>overviewInitialLimit){
    const hidden=items.length-overviewInitialLimit;
    const label=expanded ? 'Mai puține' : `Mai multe (${hidden})`;
    more=`<div class="moreRow"><button class="moreBtn" data-expand-section="${sectionKey}">${label}</button></div>`;
  }

  const shownText = expanded
    ? `${items.length} din ${items.length} rezultate`
    : `${Math.min(items.length,overviewInitialLimit)} din ${items.length}`;

  return `<div class="workspaceSection" data-section="${sectionKey}">
    <div class="workspaceSectionHead"><div><h3>${esc(title)}</h3><p>${esc(description)}</p></div><span class="workspaceCount">${shownText}</span></div>
    <div class="modelMap">${cards}</div>
    ${more}
  </div>`;
}
function renderWorkspaceOverview(){
  if(!workspace||!Array.isArray(workspace.graphs)){
    if($('workspaceMaps'))$('workspaceMaps').innerHTML='<div class="workspaceSection"><div class="emptyOverview">Workspace-ul nu este disponibil în această pagină. Sync-ul poate fi complet, dar workspace-data.js nu a fost încărcat. Reîncarcă workspace-ul; dacă persistă, verifică Viewer/workspace-data.js.</div></div>';
    return;
  }
  const all=workspaceGraphs();
  const filtered=overviewFilteredGraphs();
  const resources=all.filter(x=>x.isresource);
  const branches=all.filter(x=>!x.isresource);
  const totalNodes=all.reduce((s,x)=>s+(Number(x.nodes)||0),0);
  const totalEdges=all.reduce((s,x)=>s+(Number(x.edges)||0),0);
  const totalNG=all.reduce((s,x)=>s+graphNodegroupCount(x),0);
  const historyCount=all.reduce((s,x)=>s+(x.history?.length||0),0);

  $('workspaceStats').innerHTML=
      statCard(all.length,'Grafuri total','all')+
      statCard(resources.length,'Resource Models','resource')+
      statCard(branches.length,'Branches','branch')+
      statCard(totalNodes,'Noduri total')+
      statCard(totalEdges,'Muchii total')+
      statCard(`${totalNG} · ${historyCount} vers.`,'NodeGroups · snapshots');

  $('workspaceStats').querySelectorAll('[data-filter]').forEach(el=>{
    el.onclick=()=>setLibraryFilter(el.dataset.filter);
  });

  const maxNodes=Math.max(1,...all.map(x=>Number(x.nodes)||0));
  let showResources=filtered.filter(x=>x.isresource).sort((a,b)=>(a.name||'').localeCompare(b.name||'','ro'));
  let showBranches=filtered.filter(x=>!x.isresource).sort((a,b)=>(a.name||'').localeCompare(b.name||'','ro'));

  let out='';
  if(currentFilter!=='branch'){
    out+=mapSection('Resource Models','Modelele de resurse sincronizate; click pentru graful intern.',showResources,'resourceMap',maxNodes,'resource');
  }
  if(currentFilter!=='resource'){
    out+=mapSection('Branches','Componente reutilizabile / grafuri de tip Branch disponibile în Arches.',showBranches,'branchMap',maxNodes,'branch');
  }
  $('workspaceMaps').innerHTML=out;

  $('workspaceMaps').querySelectorAll('.mapItem').forEach(card=>{
    card.onclick=()=>openWorkspaceGraph(card.dataset.graphid);
  });

  $('workspaceMaps').querySelectorAll('[data-expand-section]').forEach(btn=>{
    btn.onclick=()=>{
      const key=btn.dataset.expandSection;
      const willExpand=!workspaceExpanded[key];
      workspaceExpanded[key]=willExpand;
      renderWorkspaceOverview();

      // Keep scrolling inside the card area only.
      const maps=$('workspaceMaps');
      const section=maps?.querySelector(`[data-section="${key}"]`);
      if(willExpand && maps && section){
        maps.scrollTop=Math.max(0,section.offsetTop-maps.offsetTop-8);
      }
    };
  });
}
function showWorkspaceView(){
  workspaceMode=true;
  document.body.classList.add('workspaceMode');
  $('workspaceBtn').classList.add('active');
  $('graphBtn').classList.remove('active');
  $('title').textContent='ePatrimoniu Semantic Graph Viewer';
  $('stats').textContent=`Workspace · ${workspaceGraphs().length} grafuri · sincronizat ${formatDate(workspace?.synced_at)}`;
  renderWorkspaceOverview();
  overviewSide();
}
function showGraphView(){
  if(!G){
    showToast('Nu există încă un graf deschis. Alege un model din Workspace.');
    return;
  }
  workspaceMode=false;
  document.body.classList.remove('workspaceMode');
  $('workspaceBtn').classList.remove('active');
  $('graphBtn').classList.add('active');
  $('title').textContent=G.graphName;
  const ngCount=[...G.nodegroups.values()].filter(x=>x.count).length;
  $('stats').textContent=`${G.nodes.length} noduri · ${G.edges.length} muchii · ${ngCount} NodeGroups · ${G.isresource?'Resource Model':'Branch'} · sincronizat ${formatDate(workspace?.synced_at)}`;
  requestAnimationFrame(()=>requestAnimationFrame(fit));
}

$('workspaceBtn').onclick=showWorkspaceView;
$('graphBtn').onclick=showGraphView;

/* Opening any graph is drill-down from Workspace. */
const v10OpenWorkspaceGraph=openWorkspaceGraph;
openWorkspaceGraph=function(graphid){
  const result=v10OpenWorkspaceGraph(graphid);
  // Live Arches loads the graph asynchronously; showGraphView runs after G is set.
  if(result&&typeof result.then==='function')return result;
  showGraphView();
};

/* Manual JSON also enters Graph mode. */
const v10ReadFile=readFile;
readFile=async function(file){
  await v10ReadFile(file);
  if(G)showGraphView();
};

/* Keep the Model Map synchronized with the existing library filters/search. */
$('modelSearch').addEventListener('input',()=>{if(workspaceMode)setTimeout(renderWorkspaceOverview,0)});
$('modelClear').addEventListener('click',()=>{if(workspaceMode)setTimeout(renderWorkspaceOverview,0)});
document.querySelectorAll('.tab').forEach(btn=>{
  btn.addEventListener('click',()=>{if(workspaceMode)setTimeout(renderWorkspaceOverview,0)});
});

/* Workspace is the default landing page in v1.0. */
setTimeout(showWorkspaceView,80);

/* ---- viewer script block ---- */
/* v1.0.3 scroll UX */
$('modelSearch').addEventListener('input',()=>{
  if(workspaceMode && $('workspaceMaps')){
    $('workspaceMaps').scrollTop=0;
  }
});
$('modelClear').addEventListener('click',()=>{
  if(workspaceMode && $('workspaceMaps')){
    $('workspaceMaps').scrollTop=0;
  }
});

/* ---- viewer script block ---- */
/* v1.1 Pattern reuse / similarity analysis */
let patternsMode=false;
let patternResults=null;
let patternThreshold=0.68;

function featureMultiset(arr){
  const m=new Map();
  arr.forEach(x=>m.set(x,(m.get(x)||0)+1));
  return m;
}
function multisetJaccard(a,b){
  const keys=new Set([...a.keys(),...b.keys()]);
  let inter=0,union=0;
  keys.forEach(k=>{
    const av=a.get(k)||0,bv=b.get(k)||0;
    inter+=Math.min(av,bv);
    union+=Math.max(av,bv);
  });
  return union?inter/union:1;
}
function normalizedPatternFromGraph(rawGraph, restrictNodeIds=null){
  const g=normalizeGraph(rawGraph);
  const allowed=restrictNodeIds?new Set(restrictNodeIds):new Set(g.nodes.map(n=>n.id));
  const nodes=g.nodes.filter(n=>allowed.has(n.id));
  const nodeById=new Map(nodes.map(n=>[n.id,n]));
  const edges=g.edges.filter(e=>allowed.has(e.source)&&allowed.has(e.target));

  const nodeFeatures=nodes.map(n=>`${n.crm_uri||n.crm}|${n.datatype||''}`);
  const edgeFeatures=edges.map(e=>{
    const s=nodeById.get(e.source),t=nodeById.get(e.target);
    return `${s?.crm_uri||s?.crm||''}|${e.property_uri||e.property||''}|${t?.crm_uri||t?.crm||''}`;
  });

  return {
    nodeCount:nodes.length,
    edgeCount:edges.length,
    nodeSet:featureMultiset(nodeFeatures),
    edgeSet:featureMultiset(edgeFeatures),
    nodes,
    edges
  };
}
function branchPattern(item){
  return normalizedPatternFromGraph(item.graph);
}
function nodegroupPatterns(resourceItem){
  const g=normalizeGraph(resourceItem.graph);
  const ids=[...new Set(g.nodes.map(n=>n.nodegroup).filter(Boolean))];
  return ids.map(id=>{
    const members=g.nodes.filter(n=>n.nodegroup===id).map(n=>n.id);
    return {nodegroup:id,pattern:normalizedPatternFromGraph(resourceItem.graph,members),members};
  });
}
function patternSimilarity(a,b){
  const nodeScore=multisetJaccard(a.nodeSet,b.nodeSet);
  const edgeScore=multisetJaccard(a.edgeSet,b.edgeSet);

  // edges are more semantically discriminating, but for single-node patterns
  // node similarity must still be meaningful.
  let score;
  if(a.edgeCount===0 && b.edgeCount===0) score=nodeScore;
  else score=(nodeScore*0.42)+(edgeScore*0.58);

  const exact=
    a.nodeCount===b.nodeCount &&
    a.edgeCount===b.edgeCount &&
    nodeScore===1 &&
    edgeScore===1;

  return {score,exact,nodeScore,edgeScore};
}
function analyzePatterns(){
  const graphs=workspaceGraphs();
  const branches=graphs.filter(x=>!x.isresource && x.graph);
  const resources=graphs.filter(x=>x.isresource && x.graph);

  const branchPatterns=branches.map(item=>({item,pattern:branchPattern(item)}));
  const resourceGroups=[];
  resources.forEach(item=>{
    nodegroupPatterns(item).forEach(ng=>resourceGroups.push({item,...ng}));
  });

  const matches=[];
  branchPatterns.forEach(bp=>{
    resourceGroups.forEach(rg=>{
      const sim=patternSimilarity(bp.pattern,rg.pattern);
      if(sim.exact || sim.score>=patternThreshold){
        matches.push({
          branch:bp.item,
          branchPattern:bp.pattern,
          resource:rg.item,
          nodegroup:rg.nodegroup,
          members:rg.members,
          groupPattern:rg.pattern,
          ...sim
        });
      }
    });
  });

  const branchPairs=[];
  for(let i=0;i<branchPatterns.length;i++){
    for(let j=i+1;j<branchPatterns.length;j++){
      const a=branchPatterns[i],b=branchPatterns[j];
      const sim=patternSimilarity(a.pattern,b.pattern);
      if(sim.exact || sim.score>=0.82){
        branchPairs.push({a:a.item,b:b.item,...sim});
      }
    }
  }

  matches.sort((x,y)=>Number(y.exact)-Number(x.exact)||y.score-x.score||x.branch.name.localeCompare(y.branch.name,'ro'));
  branchPairs.sort((x,y)=>Number(y.exact)-Number(x.exact)||y.score-x.score);

  return {branches,resources,resourceGroups,matches,branchPairs};
}
function scoreClass(m){
  if(m.exact)return 'scoreExact';
  if(m.score>=.85)return 'scoreHigh';
  return 'scoreMed';
}
function scoreText(m){
  return m.exact?'100% exact':`${Math.round(m.score*100)}%`;
}
function patternStat(value,label){
  return `<div class="statCard"><div class="statValue">${esc(value)}</div><div class="statLabel">${esc(label)}</div></div>`;
}
function renderPatterns(){
  if(!workspace||!workspace.graphs)return;
  patternResults=analyzePatterns();
  const exact=patternResults.matches.filter(x=>x.exact);
  const similar=patternResults.matches.filter(x=>!x.exact);
  const exactPairs=patternResults.branchPairs.filter(x=>x.exact);

  $('patternStats').innerHTML=
    patternStat(patternResults.branches.length,'Branches analizate')+
    patternStat(patternResults.resourceGroups.length,'NodeGroups analizate')+
    patternStat(exact.length,'Potriviri exacte')+
    patternStat(similar.length,'Potriviri similare');

  const exactRows=exact.slice(0,250).map(m=>`
    <tr>
      <td><span class="patternLink" data-branch="${esc(m.branch.graphid)}">${esc(m.branch.name)}</span></td>
      <td><span class="patternLink" data-resource="${esc(m.resource.graphid)}" data-nodegroup="${esc(m.nodegroup)}">${esc(m.resource.name)}</span></td>
      <td>${esc(shortId(m.nodegroup))}</td>
      <td><span class="scorePill scoreExact">100% exact</span></td>
      <td>${m.groupPattern.nodeCount} noduri / ${m.groupPattern.edgeCount} muchii</td>
    </tr>`).join('');

  const similarRows=similar.slice(0,250).map(m=>`
    <tr>
      <td><span class="patternLink" data-branch="${esc(m.branch.graphid)}">${esc(m.branch.name)}</span></td>
      <td><span class="patternLink" data-resource="${esc(m.resource.graphid)}" data-nodegroup="${esc(m.nodegroup)}">${esc(m.resource.name)}</span></td>
      <td>${esc(shortId(m.nodegroup))}</td>
      <td><span class="scorePill ${scoreClass(m)}">${scoreText(m)}</span></td>
      <td><span class="patternTag">nodes ${Math.round(m.nodeScore*100)}%</span><span class="patternTag">edges ${Math.round(m.edgeScore*100)}%</span></td>
    </tr>`).join('');

  const dupRows=patternResults.branchPairs.slice(0,200).map(m=>`
    <tr>
      <td><span class="patternLink" data-branch="${esc(m.a.graphid)}">${esc(m.a.name)}</span></td>
      <td><span class="patternLink" data-branch="${esc(m.b.graphid)}">${esc(m.b.name)}</span></td>
      <td><span class="scorePill ${scoreClass(m)}">${scoreText(m)}</span></td>
    </tr>`).join('');

  $('patternScroll').innerHTML=`
    <div class="patternSection">
      <h3>Branch ↔ NodeGroup — potriviri exacte</h3>
      <p>Aceeași combinație de clase/datatype-uri și proprietăți, cu același număr de noduri și muchii.</p>
      ${exactRows?`<table class="patternTable"><thead><tr><th>Branch</th><th>Resource Model</th><th>NodeGroup</th><th>Scor</th><th>Dimensiune</th></tr></thead><tbody>${exactRows}</tbody></table>`:'<div class="patternEmpty">Nu au fost găsite potriviri exacte.</div>'}
    </div>
    <div class="patternSection">
      <h3>Branch ↔ NodeGroup — candidați similari</h3>
      <p>Scor minim ${Math.round(patternThreshold*100)}%. Folosește aceste rezultate ca indicii de analiză, nu ca proveniență confirmată.</p>
      ${similarRows?`<table class="patternTable"><thead><tr><th>Branch</th><th>Resource Model</th><th>NodeGroup</th><th>Scor</th><th>Detaliu</th></tr></thead><tbody>${similarRows}</tbody></table>`:'<div class="patternEmpty">Nu au fost găsiți candidați peste prag.</div>'}
    </div>
    <div class="patternSection">
      <h3>Branch-uri duplicate / foarte asemănătoare</h3>
      <p>Util pentru identificarea componentelor potențial redundante sau convergente.</p>
      ${dupRows?`<table class="patternTable"><thead><tr><th>Branch A</th><th>Branch B</th><th>Scor</th></tr></thead><tbody>${dupRows}</tbody></table>`:'<div class="patternEmpty">Nu au fost identificate perechi peste prag.</div>'}
    </div>`;

  $('patternScroll').querySelectorAll('[data-branch]').forEach(el=>{
    el.onclick=()=>openWorkspaceGraph(el.dataset.branch);
  });
  $('patternScroll').querySelectorAll('[data-resource]').forEach(el=>{
    el.onclick=()=>{
      const gid=el.dataset.resource,ng=el.dataset.nodegroup;
      openWorkspaceGraph(gid);
      setTimeout(()=>highlightPatternNodegroup(ng),120);
    };
  });
}
function clearPatternHighlight(){
  nodeEls?.forEach(el=>el.classList.remove('pattern-match','pattern-dim'));
  edgeEls?.forEach(el=>el.classList.remove('pattern-edge','pattern-dim'));
  edgeLabelEls?.forEach(el=>el.classList.remove('pattern-dim'));
}
function highlightPatternNodegroup(nodegroupId){
  if(!G)return;
  clearPatternHighlight();
  const keep=new Set(G.nodes.filter(n=>n.nodegroup===nodegroupId).map(n=>n.id));
  if(!keep.size){
    showToast('NodeGroup-ul candidat nu a putut fi identificat în graful deschis.');
    return;
  }
  nodeEls?.forEach((el,id)=>{
    el.classList.toggle('pattern-match',keep.has(id));
    el.classList.toggle('pattern-dim',!keep.has(id));
  });
  G.edges.forEach(e=>{
    const inGroup=keep.has(e.source)&&keep.has(e.target);
    edgeEls.get(e.id)?.classList.toggle('pattern-edge',inGroup);
    edgeEls.get(e.id)?.classList.toggle('pattern-dim',!inGroup);
    edgeLabelEls.get(e.id)?.classList.toggle('pattern-dim',!inGroup);
  });
  const first=[...keep][0];
  if(first)selectNode(first);
  showToast(`NodeGroup candidat evidențiat: ${shortId(nodegroupId)}`);
}
function showPatternsView(){
  patternsMode=true;
  workspaceMode=false;
  document.body.classList.remove('workspaceMode');
  document.body.classList.add('patternsMode');
  $('workspaceBtn').classList.remove('active');
  $('graphBtn').classList.remove('active');
  $('patternsBtn').classList.add('active');
  $('title').textContent='ePatrimoniu Semantic Graph Viewer';
  $('stats').textContent=`Patterns · ${workspaceGraphs().length} grafuri · sincronizat ${formatDate(workspace?.synced_at)}`;
  renderPatterns();
}
const v11ShowWorkspaceView=showWorkspaceView;
showWorkspaceView=function(){
  patternsMode=false;
  document.body.classList.remove('patternsMode');
  $('patternsBtn').classList.remove('active');
  v11ShowWorkspaceView();
};
const v11ShowGraphView=showGraphView;
showGraphView=function(){
  patternsMode=false;
  document.body.classList.remove('patternsMode');
  $('patternsBtn').classList.remove('active');
  v11ShowGraphView();
};
$('patternsBtn').onclick=showPatternsView;

/* ---- viewer script block ---- */
/* v1.1.1 unified navigation + panels + pattern accordion */
let activeViewerMode='workspace';
const panelState={workspace:{left:false,right:true},graph:{left:false,right:false},patterns:{left:false,right:true}};

function applyPanelState(){
  const st=panelState[activeViewerMode]||panelState.graph;
  document.body.classList.toggle('leftCollapsed',!!st.left);
  document.body.classList.toggle('rightCollapsed',!!st.right);
  const l=$('toggleLeftPanel'),r=$('toggleRightPanel');
  if(l){l.textContent=st.left?'›':'‹';l.title=st.left?'Extinde panoul stâng':'Restrânge panoul stâng';}
  if(r){r.textContent=st.right?'‹':'›';r.title=st.right?'Extinde panoul drept':'Restrânge panoul drept';}
  if(activeViewerMode==='graph'&&G)requestAnimationFrame(()=>requestAnimationFrame(fit));
}
function patternSide(){
  if(!$('side'))return;const p=patternResults||analyzePatterns();
  const exact=p.matches.filter(x=>x.exact).length,similar=p.matches.filter(x=>!x.exact).length;
  $('side').innerHTML=`<h2>Pattern Analysis</h2><div class="crmTitle">Similaritate structurală în workspace</div>
  <div class="kv"><div class="k">Branches analizate</div><div class="v">${p.branches.length}</div></div>
  <div class="kv"><div class="k">NodeGroups analizate</div><div class="v">${p.resourceGroups.length}</div></div>
  <div class="kv"><div class="k">Potriviri exacte</div><div class="v">${exact}</div></div>
  <div class="kv"><div class="k">Potriviri similare</div><div class="v">${similar}</div></div>
  <div class="kv"><div class="k">Perechi Branch similare</div><div class="v">${p.branchPairs.length}</div></div>
  <div class="kv"><div class="k">Interpretare</div><div class="v">Rezultatele indică similaritate structurală, nu proveniență confirmată.</div></div>`;
}
function enterViewerMode(mode){
  if(!['workspace','graph','patterns'].includes(mode))return;
  if(mode==='graph'&&!G){showToast('Nu există încă un graf deschis. Alege un model din Workspace.');mode='workspace';}
  activeViewerMode=mode;workspaceMode=(mode==='workspace');patternsMode=(mode==='patterns');
  document.body.classList.toggle('workspaceMode',mode==='workspace');document.body.classList.toggle('patternsMode',mode==='patterns');
  $('workspaceBtn')?.classList.toggle('active',mode==='workspace');$('graphBtn')?.classList.toggle('active',mode==='graph');$('patternsBtn')?.classList.toggle('active',mode==='patterns');
  if(mode==='workspace'){$('title').textContent='ePatrimoniu Semantic Graph Viewer';$('stats').textContent=`Workspace · ${workspaceGraphs().length} grafuri · sincronizat ${formatDate(workspace?.synced_at)}`;renderWorkspaceOverview();overviewSide();}
  else if(mode==='patterns'){$('title').textContent='ePatrimoniu Semantic Graph Viewer';$('stats').textContent=`Patterns · ${workspaceGraphs().length} grafuri · sincronizat ${formatDate(workspace?.synced_at)}`;renderPatterns();enhancePatternUI();patternSide();}
  else{$('title').textContent=G.graphName;const ngCount=[...G.nodegroups.values()].filter(x=>x.count).length;$('stats').textContent=`${G.nodes.length} noduri · ${G.edges.length} muchii · ${ngCount} NodeGroups · ${G.isresource?'Resource Model':'Branch'} · sincronizat ${formatDate(workspace?.synced_at)}`;if(selectedNodeId&&byId?.has(selectedNodeId))selectNode(selectedNodeId);else if(G.root)selectNode(G.root);requestAnimationFrame(()=>requestAnimationFrame(fit));}
  applyPanelState();
}
$('workspaceBtn').onclick=()=>enterViewerMode('workspace');$('graphBtn').onclick=()=>enterViewerMode('graph');$('patternsBtn').onclick=()=>enterViewerMode('patterns');
$('toggleLeftPanel').onclick=()=>{
  panelState[activeViewerMode].left=!panelState[activeViewerMode].left;
  applyPanelState();
  if(activeViewerMode==='graph' && G){
    setTimeout(fit,40);
  }
};
$('toggleRightPanel').onclick=()=>{
  panelState[activeViewerMode].right=!panelState[activeViewerMode].right;
  applyPanelState();
  if(activeViewerMode==='graph' && G){
    setTimeout(fit,40);
  }
};

const v111OpenWorkspaceGraph=openWorkspaceGraph;openWorkspaceGraph=function(graphid){const result=v111OpenWorkspaceGraph(graphid);if(result&&typeof result.then==='function')return result;enterViewerMode('graph');};

const patternCategoryOrder=['exact','similar','duplicates'];
function patternCounts(){const p=patternResults||analyzePatterns();return{branches:p.branches.length,nodegroups:p.resourceGroups.length,exact:p.matches.filter(x=>x.exact).length,similar:p.matches.filter(x=>!x.exact).length,duplicates:p.branchPairs.length};}
function rebuildPatternStats(){const c=patternCounts();$('patternStats').innerHTML=patternStat(c.branches,'Branches analizate')+patternStat(c.nodegroups,'NodeGroups analizate')+`<div class="statCard patternNav" data-pattern-nav="exact"><div class="statValue">${c.exact}</div><div class="statLabel">Potriviri exacte</div></div>`+`<div class="statCard patternNav" data-pattern-nav="similar"><div class="statValue">${c.similar}</div><div class="statLabel">Potriviri similare</div></div>`+`<div class="statCard patternNav" data-pattern-nav="duplicates"><div class="statValue">${c.duplicates}</div><div class="statLabel">Branch-uri similare</div></div>`;$('patternStats').querySelectorAll('[data-pattern-nav]').forEach(card=>card.onclick=()=>focusPatternCategory(card.dataset.patternNav));}
function makePatternAccordion(section,key){section.dataset.patternSection=key;if(section.querySelector('.patternSectionHeadToggle'))return;const title=section.querySelector('h3');if(!title)return;const header=document.createElement('div');header.className='patternSectionHeadToggle';const h=document.createElement('h3');h.textContent=title.textContent;const btn=document.createElement('button');btn.className='patternSectionToggleBtn';btn.type='button';btn.textContent='−';btn.title='Restrânge / extinde categoria';header.append(h,btn);const body=document.createElement('div');body.className='patternSectionBody';[...section.children].forEach(ch=>{if(ch!==title)body.appendChild(ch)});title.remove();section.prepend(header);section.appendChild(body);header.onclick=()=>{const collapsed=section.classList.toggle('collapsed');btn.textContent=collapsed?'+':'−';};}
function enhancePatternUI(){rebuildPatternStats();[...$('patternScroll').querySelectorAll('.patternSection')].forEach((s,i)=>{if(patternCategoryOrder[i])makePatternAccordion(s,patternCategoryOrder[i]);});}
function focusPatternCategory(key){const scroll=$('patternScroll'),sections=[...scroll.querySelectorAll('[data-pattern-section]')];sections.forEach(s=>{const target=s.dataset.patternSection===key;s.classList.toggle('collapsed',!target);s.classList.toggle('focusedCategory',target);const b=s.querySelector('.patternSectionToggleBtn');if(b)b.textContent=target?'−':'+';});$('patternStats').querySelectorAll('[data-pattern-nav]').forEach(c=>c.classList.toggle('active',c.dataset.patternNav===key));const target=scroll.querySelector(`[data-pattern-section="${key}"]`);if(target)scroll.scrollTo({top:Math.max(0,target.offsetTop-scroll.offsetTop-4),behavior:'smooth'});}
const v111RenderPatterns=renderPatterns;renderPatterns=function(){v111RenderPatterns();enhancePatternUI();};
setTimeout(()=>enterViewerMode('workspace'),140);

/* ---- viewer script block ---- */
/* v1.2 Export & Analysis Report */

function safeFilename(value,fallback='export'){
  const s=String(value||fallback)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g,'')
    .replace(/[^\w.-]+/g,'_')
    .replace(/^_+|_+$/g,'')
    .slice(0,110);
  return s||fallback;
}
function downloadBlob(filename,blob){
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download=filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1200);
}
function downloadText(filename,text,mime='text/plain;charset=utf-8'){
  downloadBlob(filename,new Blob([text],{type:mime}));
}
function csvCell(v){
  const s=String(v??'');
  return /[",\n\r;]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;
}
function downloadCsv(filename,rows){
  const csv='\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n');
  downloadText(filename,csv,'text/csv;charset=utf-8');
}
function reportCss(){
  return `
  :root{font-family:Inter,Segoe UI,Arial,sans-serif;color:#17212b}
  body{margin:0;background:#f5f6f8}
  main{max-width:1280px;margin:0 auto;padding:32px}
  header{background:#111827;color:#fff;padding:24px 28px;border-radius:14px;margin-bottom:18px}
  header h1{margin:0 0 6px;font-size:26px}
  header p{margin:0;color:#d1d5db;font-size:12px;line-height:1.5}
  section{background:#fff;border:1px solid #dde2e8;border-radius:12px;padding:18px;margin-bottom:15px}
  h2{font-size:17px;margin:0 0 12px}
  h3{font-size:13px;margin:18px 0 8px}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px}
  .stat{border:1px solid #e2e6ec;border-radius:9px;padding:11px}
  .stat b{display:block;font-size:20px}.stat span{font-size:10px;color:#687386;text-transform:uppercase;letter-spacing:.05em}
  table{width:100%;border-collapse:collapse;font-size:11px}
  th{text-align:left;background:#f7f8fa;color:#596273;padding:8px;border-bottom:1px solid #dfe4ea;position:sticky;top:0}
  td{padding:8px;border-bottom:1px solid #edf0f3;vertical-align:top}
  code{font-size:10px;background:#f3f4f6;padding:2px 4px;border-radius:4px}
  .muted{color:#6b7280}.note{font-size:11px;color:#6b7280;line-height:1.5}
  .graphSnapshot{overflow:auto;border:1px solid #e1e5eb;border-radius:10px;background:#fff;padding:8px}
  .graphSnapshot svg{display:block;max-width:100%;height:auto;margin:auto}
  .pill{display:inline-block;padding:3px 7px;border-radius:999px;background:#eef2ff;color:#4338ca;font-weight:650}
  .warn{background:#fff8dd;border:1px solid #eedb91;border-radius:8px;padding:9px 11px;color:#795a15;font-size:11px}
  @media print{body{background:#fff}main{max-width:none;padding:0}section,header{break-inside:avoid}}
  `;
}
function htmlDocument(title,subtitle,body){
  return `<!doctype html><html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${reportCss()}/* v1.3 Workspace Change Overview */
.workspaceChangesBar{
  flex:0 0 auto;
  display:flex;
  align-items:center;
  gap:8px;
  flex-wrap:wrap;
  padding:0 28px 14px;
  background:#f6f7f9;
}
.changeBarLabel{
  font-size:10px;
  color:var(--muted);
  text-transform:uppercase;
  letter-spacing:.055em;
  margin-right:2px;
}
.changeChip{
  border:1px solid #dce1e8;
  background:#fff;
  border-radius:999px;
  padding:6px 9px;
  font-size:10px;
  cursor:pointer;
}
.changeChip:hover{border-color:#aeb8dd;background:#fafaff}
.changeChip.changed{color:#9a3412;background:#fff7ed;border-color:#fed7aa}
.changeChip.new{color:#166534;background:#f0fdf4;border-color:#bbf7d0}
.changeChip.unchanged{color:#475569;background:#f8fafc}
.changeChip.unknown{color:#6b7280;background:#f9fafb}
.changeSection{border-left:4px solid #f59e0b}
.changeSection.noChanges{border-left-color:#94a3b8}
.changeList{display:flex;flex-direction:column;gap:7px}
.changeRow{
  display:grid;
  grid-template-columns:minmax(180px,1.5fr) minmax(100px,.7fr) minmax(270px,1.5fr) auto;
  align-items:center;
  gap:10px;
  border:1px solid #e2e6eb;
  border-radius:9px;
  padding:9px 10px;
  background:#fff;
}
.changeRow:hover{border-color:#c7ced8;background:#fbfcfd}
.changeName{font-size:11px;font-weight:650;line-height:1.3}
.changeMeta{font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.045em;margin-top:3px}
.changeWhen{font-size:10px;color:#667085}
.changeBadges{display:flex;gap:5px;flex-wrap:wrap}
.changeBadge{
  display:inline-block;
  border-radius:999px;
  padding:3px 7px;
  font-size:9px;
  font-weight:650;
  white-space:nowrap;
}
.changeBadge.add{background:#dcfce7;color:#166534}
.changeBadge.mod{background:#ffedd5;color:#9a3412}
.changeBadge.rem{background:#fee2e2;color:#991b1b}
.changeBadge.neutral{background:#eef2f6;color:#475569}
.changeBadge.new{background:#dbeafe;color:#1d4ed8}
.changeActions{display:flex;gap:5px;justify-content:flex-end}
.changeActions button{padding:5px 8px;font-size:10px}
.changeCorner{
  position:absolute;
  top:7px;
  right:7px;
  padding:2px 6px;
  border-radius:999px;
  font-size:8px;
  font-weight:700;
  text-transform:uppercase;
  letter-spacing:.05em;
}
.changeCorner.changed{background:#ffedd5;color:#9a3412}
.changeCorner.new{background:#dcfce7;color:#166534}
.modelItem.syncChanged{border-left:3px solid #f59e0b}
.modelItem.syncNew{border-left:3px solid #22c55e}
.changeMethod{
  font-size:10px;color:var(--muted);line-height:1.45;margin-top:9px;
}
@media(max-width:1050px){
  .changeRow{grid-template-columns:minmax(180px,1fr) auto}
  .changeWhen,.changeBadges{grid-column:1}
  .changeActions{grid-column:2;grid-row:1 / span 3}
}


</style></head><body><main><header><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></header>${body}</main></body></html>`;
}
function currentWorkspaceGraph(){
  return currentWorkspaceId?workspaceGraphs().find(x=>x.graphid===currentWorkspaceId):null;
}

/* ---- SVG / PNG snapshot ---- */

function clonedSvgForExport(){
  if(!G)throw new Error('Nu există un graf deschis.');
  const source=$('svg');
  const rect=source.getBoundingClientRect();
  const w=Math.max(1,Math.round(rect.width));
  const h=Math.max(1,Math.round(rect.height));
  const clone=source.cloneNode(true);

  clone.setAttribute('xmlns','http://www.w3.org/2000/svg');
  clone.setAttribute('width',String(w));
  clone.setAttribute('height',String(h));
  clone.setAttribute('viewBox',`0 0 ${w} ${h}`);
  clone.removeAttribute('style');

  let defs=clone.querySelector('defs');
  if(!defs){
    defs=document.createElementNS('http://www.w3.org/2000/svg','defs');
    clone.prepend(defs);
  }
  const style=document.createElementNS('http://www.w3.org/2000/svg','style');
  style.textContent=[...document.querySelectorAll('style')].map(s=>s.textContent||'').join('\n');
  defs.appendChild(style);

  const bg=document.createElementNS('http://www.w3.org/2000/svg','rect');
  bg.setAttribute('x','0');bg.setAttribute('y','0');
  bg.setAttribute('width',String(w));bg.setAttribute('height',String(h));
  bg.setAttribute('fill','#ffffff');
  const firstGraphic=[...clone.children].find(x=>x.tagName.toLowerCase()!=='defs');
  clone.insertBefore(bg,firstGraphic||null);

  return {clone,w,h};
}
function currentSvgMarkup(){
  const {clone}=clonedSvgForExport();
  return new XMLSerializer().serializeToString(clone);
}
function exportGraphSvg(){
  try{
    const markup=currentSvgMarkup();
    downloadText(`${safeFilename(G.graphName)}_graph.svg`,markup,'image/svg+xml;charset=utf-8');
    showToast('SVG exportat.');
    closeExportModal();
  }catch(e){showToast(`Export SVG: ${e.message}`)}
}
function exportGraphPng(){
  try{
    const {clone,w,h}=clonedSvgForExport();
    const markup=new XMLSerializer().serializeToString(clone);
    const blob=new Blob([markup],{type:'image/svg+xml;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const img=new Image();
    img.onload=()=>{
      try{
        const ratio=2;
        const canvas=document.createElement('canvas');
        canvas.width=w*ratio;canvas.height=h*ratio;
        const ctx=canvas.getContext('2d');
        ctx.setTransform(ratio,0,0,ratio,0,0);
        ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);
        ctx.drawImage(img,0,0,w,h);
        URL.revokeObjectURL(url);
        canvas.toBlob(png=>{
          if(!png){showToast('Nu am putut genera PNG.');return}
          downloadBlob(`${safeFilename(G.graphName)}_graph.png`,png);
          showToast('PNG exportat.');
          closeExportModal();
        },'image/png');
      }catch(err){
        URL.revokeObjectURL(url);
        showToast(`Export PNG: ${err.message}`);
      }
    };
    img.onerror=()=>{URL.revokeObjectURL(url);showToast('Browserul nu a putut rasteriza SVG-ul curent.')};
    img.src=url;
  }catch(e){showToast(`Export PNG: ${e.message}`)}
}

/* ---- Graph semantic content ---- */

function graphNodeRows(){
  return G.nodes.map(n=>[
    n.name||'',
    n.datatype||'',
    n.crm||'',
    n.crm_uri||'',
    n.nodegroup||'',
    n.required?'da':'nu',
    n.collector?'da':'nu',
    n.id||''
  ]);
}
function graphEdgeRows(){
  const names=new Map(G.nodes.map(n=>[n.id,n.name||n.crm||n.id]));
  return G.edges.map(e=>[
    names.get(e.source)||e.source,
    e.property||'',
    e.property_uri||'',
    names.get(e.target)||e.target,
    e.source||'',
    e.target||''
  ]);
}
function semanticPathReportHtml(){
  if(!pathResult)return '<p class="note">Nu există un traseu semantic activ în momentul exportului.</p>';
  const names=new Map(G.nodes.map(n=>[n.id,n.name||n.crm||n.id]));
  const rows=pathResult.steps.map((s,i)=>{
    const arrow=s.forward?'→':'←';
    return `<tr><td>${i+1}</td><td>${esc(names.get(s.from)||s.from)}</td><td>${arrow} ${esc(s.edge.property||s.edge.property_uri||'')}</td><td>${esc(names.get(s.to)||s.to)}</td></tr>`;
  }).join('');
  return `<table><thead><tr><th>#</th><th>Nod</th><th>Proprietate</th><th>Nod</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="note">Calea este calculată structural în ambele sensuri; săgeata indică direcția reală a proprietății.</p>`;
}
function comparisonReportHtml(){
  if(!comparison)return '<p class="note">Nu există o comparație de versiuni activă în momentul exportului.</p>';
  return `<div class="stats">
    <div class="stat"><b>${comparison.addedNodes.length}</b><span>Noduri adăugate</span></div>
    <div class="stat"><b>${comparison.modifiedNodes.length}</b><span>Noduri modificate</span></div>
    <div class="stat"><b>${comparison.removedNodes.length}</b><span>Noduri eliminate</span></div>
    <div class="stat"><b>${comparison.addedEdges.length}</b><span>Muchii adăugate</span></div>
    <div class="stat"><b>${comparison.modifiedEdges.length}</b><span>Muchii modificate</span></div>
    <div class="stat"><b>${comparison.removedEdges.length}</b><span>Muchii eliminate</span></div>
  </div>`;
}
function graphSummaryBody(includeSnapshot=false){
  const ngCount=[...G.nodegroups.values()].filter(x=>x.count).length;
  const item=currentWorkspaceGraph();
  const nodeRows=graphNodeRows().map(r=>`<tr>${r.map(x=>`<td>${esc(x)}</td>`).join('')}</tr>`).join('');
  const edgeRows=graphEdgeRows().map(r=>`<tr>${r.map(x=>`<td>${esc(x)}</td>`).join('')}</tr>`).join('');
  let snapshot='';
  if(includeSnapshot){
    try{snapshot=`<section><h2>Vedere grafică la momentul exportului</h2><div class="graphSnapshot">${currentSvgMarkup()}</div><p class="note">Snapshot-ul păstrează starea vizuală curentă a grafului, inclusiv evidențierile active.</p></section>`}
    catch(e){snapshot=`<section><h2>Vedere grafică</h2><p class="note">Snapshot indisponibil: ${esc(e.message)}</p></section>`}
  }

  return `
  <section><h2>Sumar model</h2>
    <div class="stats">
      <div class="stat"><b>${G.nodes.length}</b><span>Noduri</span></div>
      <div class="stat"><b>${G.edges.length}</b><span>Muchii</span></div>
      <div class="stat"><b>${ngCount}</b><span>NodeGroups</span></div>
      <div class="stat"><b>${item?.history?.length||0}</b><span>Snapshot-uri istorice</span></div>
    </div>
    <p class="note"><b>Tip:</b> ${G.isresource?'Resource Model':'Branch'} · <b>Graph ID:</b> <code>${esc(G.graphId||item?.graphid||'—')}</code></p>
  </section>
  ${snapshot}
  <section><h2>Noduri și clase CIDOC CRM</h2>
    <table><thead><tr><th>Arches node</th><th>Datatype</th><th>Clasă CIDOC</th><th>URI clasă</th><th>NodeGroup</th><th>Required</th><th>Collector</th><th>Node ID</th></tr></thead><tbody>${nodeRows}</tbody></table>
  </section>
  <section><h2>Proprietăți / muchii</h2>
    <table><thead><tr><th>Sursă</th><th>Proprietate</th><th>URI proprietate</th><th>Țintă</th><th>Source ID</th><th>Target ID</th></tr></thead><tbody>${edgeRows}</tbody></table>
  </section>`;
}
function exportSemanticSummary(){
  if(!G){showToast('Deschide mai întâi un graf.');return}
  const body=graphSummaryBody(false);
  const doc=htmlDocument(
    `${G.graphName} — Semantic summary`,
    `${G.isresource?'Resource Model':'Branch'} · generat ${new Date().toLocaleString('ro-RO')}`,
    body
  );
  downloadText(`${safeFilename(G.graphName)}_semantic_summary.html`,doc,'text/html;charset=utf-8');
  closeExportModal();showToast('Semantic summary exportat.');
}
function exportGraphAnalysisReport(){
  if(!G){showToast('Deschide mai întâi un graf.');return}
  const body=graphSummaryBody(true)+`
    <section><h2>Traseu semantic activ</h2>${semanticPathReportHtml()}</section>
    <section><h2>Comparație de versiuni activă</h2>${comparisonReportHtml()}</section>
    <section><h2>Notă metodologică</h2><p class="note">Raportul descrie starea locală sincronizată și vederea curentă din ePatrimoniu Graph Viewer. Nu modifică și nu validează date în Arches.</p></section>`;
  const doc=htmlDocument(
    `${G.graphName} — Analysis report`,
    `${G.isresource?'Resource Model':'Branch'} · Graph ID ${G.graphId||'—'} · generat ${new Date().toLocaleString('ro-RO')}`,
    body
  );
  downloadText(`${safeFilename(G.graphName)}_analysis_report.html`,doc,'text/html;charset=utf-8');
  closeExportModal();showToast('Raportul de analiză a fost exportat.');
}

/* ---- Workspace inventory ---- */

function workspaceInventoryRows(){
  return workspaceGraphs()
    .slice()
    .sort((a,b)=>(a.name||'').localeCompare(b.name||'','ro'))
    .map(item=>[
      item.name||'',
      item.isresource?'Resource Model':'Branch',
      item.graphid||'',
      Number(item.nodes)||0,
      Number(item.edges)||0,
      graphNodegroupCount(item),
      item.history?.length||0,
      item.author||''
    ]);
}
function exportWorkspaceCsv(){
  const rows=[
    ['Name','Type','Graph ID','Nodes','Edges','NodeGroups','History snapshots','Author'],
    ...workspaceInventoryRows()
  ];
  downloadCsv('ePatrimoniu_workspace_inventory.csv',rows);
  closeExportModal();showToast('Inventarul CSV a fost exportat.');
}
function exportWorkspaceHtml(){
  const rows=workspaceInventoryRows();
  const resourceCount=rows.filter(r=>r[1]==='Resource Model').length;
  const branchCount=rows.length-resourceCount;
  const totalNodes=rows.reduce((s,r)=>s+Number(r[3]||0),0);
  const totalEdges=rows.reduce((s,r)=>s+Number(r[4]||0),0);
  const tableRows=rows.map(r=>`<tr>${r.map(x=>`<td>${esc(x)}</td>`).join('')}</tr>`).join('');
  const body=`
    <section><h2>Workspace summary</h2><div class="stats">
      <div class="stat"><b>${rows.length}</b><span>Grafuri</span></div>
      <div class="stat"><b>${resourceCount}</b><span>Resource Models</span></div>
      <div class="stat"><b>${branchCount}</b><span>Branches</span></div>
      <div class="stat"><b>${totalNodes}</b><span>Noduri</span></div>
      <div class="stat"><b>${totalEdges}</b><span>Muchii</span></div>
    </div><p class="note">Ultima sincronizare: ${esc(formatDate(workspace?.synced_at))}</p></section>
    <section><h2>Inventar complet</h2><table><thead><tr><th>Nume</th><th>Tip</th><th>Graph ID</th><th>Noduri</th><th>Muchii</th><th>NodeGroups</th><th>Istoric</th><th>Autor</th></tr></thead><tbody>${tableRows}</tbody></table></section>`;
  const doc=htmlDocument('ePatrimoniu — Workspace inventory',`Inventar generat ${new Date().toLocaleString('ro-RO')}`,body);
  downloadText('ePatrimoniu_workspace_inventory.html',doc,'text/html;charset=utf-8');
  closeExportModal();showToast('Inventarul HTML a fost exportat.');
}

/* ---- Pattern analysis export ---- */

function patternExportRows(){
  const p=patternResults||analyzePatterns();
  return {
    p,
    exact:p.matches.filter(x=>x.exact),
    similar:p.matches.filter(x=>!x.exact),
    pairs:p.branchPairs
  };
}
function exportPatternsCsv(){
  const {exact,similar,pairs}=patternExportRows();
  const rows=[['Category','Branch A','Resource Model / Branch B','NodeGroup','Score','Node score','Edge score']];
  exact.forEach(m=>rows.push(['Exact Branch ↔ NodeGroup',m.branch.name,m.resource.name,m.nodegroup,'1',m.nodeScore,m.edgeScore]));
  similar.forEach(m=>rows.push(['Similar Branch ↔ NodeGroup',m.branch.name,m.resource.name,m.nodegroup,m.score,m.nodeScore,m.edgeScore]));
  pairs.forEach(m=>rows.push(['Branch ↔ Branch',m.a.name,m.b.name,'',m.score,m.nodeScore,m.edgeScore]));
  downloadCsv('ePatrimoniu_pattern_analysis.csv',rows);
  closeExportModal();showToast('Analiza Patterns CSV a fost exportată.');
}
function exportPatternsHtml(){
  const {p,exact,similar,pairs}=patternExportRows();
  const exactRows=exact.map(m=>`<tr><td>${esc(m.branch.name)}</td><td>${esc(m.resource.name)}</td><td><code>${esc(m.nodegroup)}</code></td><td>100%</td><td>${m.groupPattern.nodeCount} / ${m.groupPattern.edgeCount}</td></tr>`).join('');
  const similarRows=similar.map(m=>`<tr><td>${esc(m.branch.name)}</td><td>${esc(m.resource.name)}</td><td><code>${esc(m.nodegroup)}</code></td><td>${Math.round(m.score*100)}%</td><td>${Math.round(m.nodeScore*100)}%</td><td>${Math.round(m.edgeScore*100)}%</td></tr>`).join('');
  const pairRows=pairs.map(m=>`<tr><td>${esc(m.a.name)}</td><td>${esc(m.b.name)}</td><td>${Math.round(m.score*100)}%</td><td>${Math.round(m.nodeScore*100)}%</td><td>${Math.round(m.edgeScore*100)}%</td></tr>`).join('');
  const body=`
    <section><h2>Sumar</h2><div class="stats">
      <div class="stat"><b>${p.branches.length}</b><span>Branches analizate</span></div>
      <div class="stat"><b>${p.resourceGroups.length}</b><span>NodeGroups analizate</span></div>
      <div class="stat"><b>${exact.length}</b><span>Potriviri exacte</span></div>
      <div class="stat"><b>${similar.length}</b><span>Potriviri similare</span></div>
      <div class="stat"><b>${pairs.length}</b><span>Perechi Branch</span></div>
    </div>
    <div class="warn">Aceste rezultate indică similaritate structurală. Ele nu demonstrează proveniența sau inserarea efectivă a unui Branch într-un Resource Model.</div></section>
    <section><h2>Branch ↔ NodeGroup — potriviri exacte</h2>
      ${exactRows?`<table><thead><tr><th>Branch</th><th>Resource Model</th><th>NodeGroup</th><th>Scor</th><th>Noduri / muchii</th></tr></thead><tbody>${exactRows}</tbody></table>`:'<p class="note">Nicio potrivire exactă.</p>'}
    </section>
    <section><h2>Branch ↔ NodeGroup — potriviri similare</h2>
      ${similarRows?`<table><thead><tr><th>Branch</th><th>Resource Model</th><th>NodeGroup</th><th>Scor</th><th>Nodes</th><th>Edges</th></tr></thead><tbody>${similarRows}</tbody></table>`:'<p class="note">Nicio potrivire similară.</p>'}
    </section>
    <section><h2>Branch ↔ Branch</h2>
      ${pairRows?`<table><thead><tr><th>Branch A</th><th>Branch B</th><th>Scor</th><th>Nodes</th><th>Edges</th></tr></thead><tbody>${pairRows}</tbody></table>`:'<p class="note">Nicio pereche relevantă.</p>'}
    </section>`;
  const doc=htmlDocument('ePatrimoniu — Pattern analysis report',`Prag similaritate Branch ↔ NodeGroup: ${Math.round(patternThreshold*100)}% · generat ${new Date().toLocaleString('ro-RO')}`,body);
  downloadText('ePatrimoniu_pattern_analysis_report.html',doc,'text/html;charset=utf-8');
  closeExportModal();showToast('Raportul Patterns a fost exportat.');
}

/* ---- Contextual export dialog ---- */

function exportOption(label,description,format,action){
  return `<button class="exportOption" type="button" data-export-action="${action}"><strong>${esc(label)}</strong><span>${esc(description)}</span><span class="exportFormat">${esc(format)}</span></button>`;
}
function openExportModal(){
  const mode=activeViewerMode||'workspace';
  let title='Export',subtitle='',options='';

  if(mode==='workspace'){
    title='Export Workspace';
    subtitle='Inventarul complet al Resource Models și Branches sincronizate.';
    options=
      exportOption('Workspace inventory','Raport HTML standalone cu sumar și tabelul complet al grafurilor.','HTML','workspace-html')+
      exportOption('Workspace inventory data','Tabel simplu pentru analiză ulterioară în Excel / LibreOffice / alte instrumente.','CSV','workspace-csv');
  }else if(mode==='patterns'){
    title='Export Pattern Analysis';
    subtitle='Exportă toate potrivirile calculate, nu doar rândurile vizibile în interfață.';
    options=
      exportOption('Pattern analysis report','Raport standalone cu potriviri exacte, similare și Branch ↔ Branch.','HTML','patterns-html')+
      exportOption('Pattern analysis data','Toate rezultatele într-un tabel reutilizabil.','CSV','patterns-csv');
  }else{
    if(!G){showToast('Deschide mai întâi un graf.');return}
    title=`Export Graph — ${G.graphName}`;
    subtitle='Export vizual și documentație semantică pentru graful curent.';
    options=
      exportOption('Current graph view','Snapshot vectorial exact al canvasului curent.','SVG','graph-svg')+
      exportOption('Current graph view','Snapshot raster 2× pentru documente și prezentări.','PNG','graph-png')+
      exportOption('Semantic summary','Noduri, clase CIDOC CRM, datatype-uri, NodeGroups și proprietăți.','HTML','graph-summary')+
      exportOption('Analysis report','Snapshot grafic + structură semantică + traseu/comparație active.','HTML','graph-report');
  }

  $('exportTitle').textContent=title;
  $('exportSubtitle').textContent=subtitle;
  $('exportOptions').innerHTML=options;

  const actions={
    'workspace-html':exportWorkspaceHtml,
    'workspace-csv':exportWorkspaceCsv,
    'patterns-html':exportPatternsHtml,
    'patterns-csv':exportPatternsCsv,
    'graph-svg':exportGraphSvg,
    'graph-png':exportGraphPng,
    'graph-summary':exportSemanticSummary,
    'graph-report':exportGraphAnalysisReport
  };
  $('exportOptions').querySelectorAll('[data-export-action]').forEach(btn=>{
    btn.onclick=()=>actions[btn.dataset.exportAction]?.();
  });

  $('exportModal').classList.add('open');
  $('exportModal').setAttribute('aria-hidden','false');
}
function closeExportModal(){
  $('exportModal').classList.remove('open');
  $('exportModal').setAttribute('aria-hidden','true');
}
$('exportBtn').onclick=openExportModal;
$('exportClose').onclick=closeExportModal;
$('exportModal').querySelectorAll('[data-export-close]').forEach(el=>el.onclick=closeExportModal);
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&$('exportModal').classList.contains('open'))closeExportModal();
});

/* ---- viewer script block ---- */
/* v1.3 Workspace Change Overview */

function workspaceGraphDiff(currentRaw,previousRaw){
  if(!currentRaw||!previousRaw)return null;

  const cur=normalizeGraph(currentRaw);
  const old=normalizeGraph(previousRaw);

  const oldNodes=new Map(old.nodes.map(n=>[n.id,n]));
  const curNodes=new Map(cur.nodes.map(n=>[n.id,n]));
  const oldEdges=new Map(old.edges.map(e=>[e.id,e]));
  const curEdges=new Map(cur.edges.map(e=>[e.id,e]));

  const addedNodes=[],removedNodes=[],modifiedNodes=[];
  curNodes.forEach((n,id)=>{
    if(!oldNodes.has(id))addedNodes.push(n);
    else if(graphNodeSignature(n)!==graphNodeSignature(oldNodes.get(id))){
      modifiedNodes.push({before:oldNodes.get(id),after:n});
    }
  });
  oldNodes.forEach((n,id)=>{
    if(!curNodes.has(id))removedNodes.push(n);
  });

  const addedEdges=[],removedEdges=[],modifiedEdges=[];
  curEdges.forEach((e,id)=>{
    if(!oldEdges.has(id))addedEdges.push(e);
    else if(graphEdgeSignature(e)!==graphEdgeSignature(oldEdges.get(id))){
      modifiedEdges.push({before:oldEdges.get(id),after:e});
    }
  });
  oldEdges.forEach((e,id)=>{
    if(!curEdges.has(id))removedEdges.push(e);
  });

  return {
    addedNodes,removedNodes,modifiedNodes,
    addedEdges,removedEdges,modifiedEdges,
    previous:old,current:cur
  };
}

function workspaceChangeInfo(item){
  const status=item?.sync_status||'unknown';
  const previous=item?.history?.[0]||null;

  if(status==='new'){
    return {
      item,status,previous:null,diff:null,
      structuralCount:(Number(item.nodes)||0)+(Number(item.edges)||0)
    };
  }

  if(status==='changed' && previous?.graph && item?.graph){
    const diff=workspaceGraphDiff(item.graph,previous.graph);
    const structuralCount=diff
      ? diff.addedNodes.length+diff.removedNodes.length+diff.modifiedNodes.length+
        diff.addedEdges.length+diff.removedEdges.length+diff.modifiedEdges.length
      : 0;
    return {item,status,previous,diff,structuralCount};
  }

  return {item,status,previous,diff:null,structuralCount:0};
}

function workspaceChanges(){
  return workspaceGraphs().map(workspaceChangeInfo);
}

function ensureWorkspaceChangeBar(){
  let bar=$('workspaceChangesBar');
  if(bar)return bar;

  bar=document.createElement('div');
  bar.id='workspaceChangesBar';
  bar.className='workspaceChangesBar';

  const stats=$('workspaceStats');
  if(stats?.parentNode){
    stats.parentNode.insertBefore(bar,stats.nextSibling);
  }
  return bar;
}

function renderWorkspaceChangeBar(){
  const bar=ensureWorkspaceChangeBar();
  if(!bar)return;

  const changes=workspaceChanges();
  const changed=changes.filter(x=>x.status==='changed').length;
  const added=changes.filter(x=>x.status==='new').length;
  const unchanged=changes.filter(x=>x.status==='unchanged').length;
  const unknown=changes.filter(x=>x.status==='unknown').length;
  const notChecked=changes.filter(x=>x.status==='not_checked').length;

  bar.innerHTML=`
    <span class="changeBarLabel">Ultimul sync</span>
    <button class="changeChip changed" data-change-jump="1">${changed} modificate</button>
    <button class="changeChip new" data-change-jump="1">${added} noi</button>
    <span class="changeChip unchanged">${unchanged} neschimbate</span>
    ${notChecked?`<span class="changeChip unknown">${notChecked} neactualizate în acest sync</span>`:''}${unknown?`<span class="changeChip unknown">${unknown} status necunoscut</span>`:''}
  `;

  bar.querySelectorAll('[data-change-jump]').forEach(btn=>{
    btn.onclick=()=>{
      const maps=$('workspaceMaps');
      if(maps)maps.scrollTo({top:0,behavior:'smooth'});
    };
  });
}

function diffBadgesHtml(info){
  if(info.status==='new'){
    return `<span class="changeBadge new">graf nou</span>
      <span class="changeBadge add">+ ${Number(info.item.nodes)||0} noduri</span>
      <span class="changeBadge add">+ ${Number(info.item.edges)||0} muchii</span>`;
  }

  const d=info.diff;
  if(!d){
    return '<span class="changeBadge neutral">detaliu indisponibil</span>';
  }

  const out=[];
  if(d.addedNodes.length)out.push(`<span class="changeBadge add">+${d.addedNodes.length} noduri</span>`);
  if(d.modifiedNodes.length)out.push(`<span class="changeBadge mod">~${d.modifiedNodes.length} noduri</span>`);
  if(d.removedNodes.length)out.push(`<span class="changeBadge rem">−${d.removedNodes.length} noduri</span>`);
  if(d.addedEdges.length)out.push(`<span class="changeBadge add">+${d.addedEdges.length} muchii</span>`);
  if(d.modifiedEdges.length)out.push(`<span class="changeBadge mod">~${d.modifiedEdges.length} muchii</span>`);
  if(d.removedEdges.length)out.push(`<span class="changeBadge rem">−${d.removedEdges.length} muchii</span>`);

  if(!out.length){
    out.push('<span class="changeBadge neutral">fără diferențe structurale detectate</span>');
  }
  return out.join('');
}

let workspaceChangeCollapsed=true;

function workspaceChangeSectionHtml(){
  const changes=workspaceChanges();
  const relevant=changes
    .filter(x=>x.status==='changed'||x.status==='new')
    .sort((a,b)=>{
      if(a.status!==b.status)return a.status==='changed'?-1:1;
      return (b.structuralCount||0)-(a.structuralCount||0) ||
        (a.item.name||'').localeCompare(b.item.name||'','ro');
    });

  const unknown=changes.filter(x=>x.status==='unknown').length;
  const notChecked=changes.filter(x=>x.status==='not_checked').length;
  const collapsedClass=workspaceChangeCollapsed?' collapsed':'';
  const toggleSymbol=workspaceChangeCollapsed?'+':'−';

  if(!relevant.length){
    const note=(unknown||notChecked)
      ? `${notChecked?`${notChecked} grafuri nu au fost verificate în acest sync rapid. `:''}${unknown?`Status necunoscut pentru ${unknown} grafuri.`:''}`
      : 'Niciun Resource Model sau Branch nu s-a modificat la ultima sincronizare.';

    return `<div class="workspaceSection changeSection noChanges${collapsedClass}" id="workspaceChangeSection">
      <div class="changeSectionHeadToggle" data-change-section-toggle="1">
        <div class="workspaceSectionHead">
          <div><h3>Changes since previous sync</h3><p>Modificările detectate la ultima sincronizare Arches.</p></div>
          <span class="workspaceCount">0 schimbări</span>
        </div>
        <button type="button" class="changeHistoryToggle" aria-label="Restrânge / extinde istoricul">${toggleSymbol}</button>
      </div>
      <div class="changeSectionBody">
        <div class="emptyOverview">${esc(note)}</div>
      </div>
    </div>`;
  }

  const rows=relevant.map(info=>{
    const item=info.item;
    const when=info.status==='changed' && info.previous
      ? `comparat cu ${formatDate(info.previous.timestamp)}`
      : 'apărut pentru prima dată în workspace';

    return `<div class="changeRow" data-change-graphid="${esc(item.graphid)}">
      <div>
        <div class="changeName">${esc(item.name||item.graphid)}</div>
        <div class="changeMeta">${item.isresource?'Resource Model':'Branch'}</div>
      </div>
      <div class="changeWhen">${esc(when)}</div>
      <div class="changeBadges">${diffBadgesHtml(info)}</div>
      <div class="changeActions">
        <button type="button" data-change-open="${esc(item.graphid)}">Deschide</button>
        ${info.status==='changed' && info.previous?.graph
          ? `<button type="button" data-change-compare="${esc(item.graphid)}">Compară</button>`
          : ''}
      </div>
    </div>`;
  }).join('');

  const changedCount=relevant.filter(x=>x.status==='changed').length;
  const newCount=relevant.filter(x=>x.status==='new').length;

  return `<div class="workspaceSection changeSection${collapsedClass}" id="workspaceChangeSection">
    <div class="changeSectionHeadToggle" data-change-section-toggle="1">
      <div class="workspaceSectionHead">
        <div>
          <h3>Changes since previous sync</h3>
          <p>Doar grafurile marcate de worker ca modificate sau noi la ultima sincronizare.</p>
        </div>
        <span class="workspaceCount">${changedCount} modificate · ${newCount} noi</span>
      </div>
      <button type="button" class="changeHistoryToggle" aria-label="Restrânge / extinde istoricul">${toggleSymbol}</button>
    </div>
    <div class="changeSectionBody">
      <div class="changeList">${rows}</div>
      <div class="changeMethod">Pentru grafurile modificate, diferența structurală este calculată între graful curent și cel mai recent snapshot istoric, care reprezintă versiunea locală de dinaintea actualizării. Un update de serializare/metadate poate apărea ca „modificat” chiar dacă nu produce diferențe structurale de noduri sau muchii.</div>
    </div>
  </div>`;
}

function bindWorkspaceChangeSection(){
  const maps=$('workspaceMaps');
  if(!maps)return;

  const toggle=maps.querySelector('[data-change-section-toggle]');
  if(toggle){
    toggle.onclick=e=>{
      if(e.target.closest('[data-change-open],[data-change-compare]'))return;
      workspaceChangeCollapsed=!workspaceChangeCollapsed;
      const section=$('workspaceChangeSection');
      if(section){
        section.classList.toggle('collapsed',workspaceChangeCollapsed);
        const btn=section.querySelector('.changeHistoryToggle');
        if(btn)btn.textContent=workspaceChangeCollapsed?'+':'−';
      }
    };
  }

  maps.querySelectorAll('[data-change-open]').forEach(btn=>{
    btn.onclick=e=>{
      e.stopPropagation();
      openWorkspaceGraph(btn.dataset.changeOpen);
    };
  });

  maps.querySelectorAll('[data-change-compare]').forEach(btn=>{
    btn.onclick=e=>{
      e.stopPropagation();
      openLatestWorkspaceComparison(btn.dataset.changeCompare);
    };
  });
}

function openLatestWorkspaceComparison(graphid){
  const item=workspaceGraphs().find(x=>x.graphid===graphid);
  if(!item?.history?.[0]?.graph){
    showToast('Nu există snapshot anterior pentru comparație.');
    return;
  }

  openWorkspaceGraph(graphid);

  setTimeout(()=>{
    openComparePanel();
    const sel=$('historySelect');
    if(sel){
      sel.value='0';
      applySelectedComparison();
    }
  },60);
}

function decorateWorkspaceChangeCards(){
  const infoById=new Map(workspaceChanges().map(x=>[x.item.graphid,x]));

  document.querySelectorAll('#workspaceMaps .mapItem[data-graphid]').forEach(card=>{
    const info=infoById.get(card.dataset.graphid);
    if(!info || !['changed','new'].includes(info.status))return;
    if(card.querySelector('.changeCorner'))return;

    const badge=document.createElement('span');
    badge.className=`changeCorner ${info.status}`;
    badge.textContent=info.status==='changed'?'modificat':'nou';
    card.appendChild(badge);
  });

  document.querySelectorAll('#modelList .modelItem[data-graphid]').forEach(row=>{
    const info=infoById.get(row.dataset.graphid);
    row.classList.toggle('syncChanged',info?.status==='changed');
    row.classList.toggle('syncNew',info?.status==='new');
  });
}

/* Wrap Workspace rendering without disturbing existing map / scroll behavior. */
const v13RenderWorkspaceOverview=renderWorkspaceOverview;
renderWorkspaceOverview=function(){
  v13RenderWorkspaceOverview();
  renderWorkspaceChangeBar();

  const maps=$('workspaceMaps');
  if(maps){
    maps.insertAdjacentHTML('afterbegin',workspaceChangeSectionHtml());
    bindWorkspaceChangeSection();
    decorateWorkspaceChangeCards();
  }
};

const v13RenderLibrary=renderLibrary;
renderLibrary=function(){
  v13RenderLibrary();
  decorateWorkspaceChangeCards();
};

/* Add status/diff information to Workspace export. */
workspaceInventoryRows=function(){
  return workspaceGraphs()
    .slice()
    .sort((a,b)=>(a.name||'').localeCompare(b.name||'','ro'))
    .map(item=>{
      const info=workspaceChangeInfo(item);
      const d=info.diff;
      return [
        item.name||'',
        item.isresource?'Resource Model':'Branch',
        item.graphid||'',
        Number(item.nodes)||0,
        Number(item.edges)||0,
        graphNodegroupCount(item),
        item.history?.length||0,
        item.author||'',
        info.status||'unknown',
        d?.addedNodes.length||0,
        d?.modifiedNodes.length||0,
        d?.removedNodes.length||0,
        d?.addedEdges.length||0,
        d?.modifiedEdges.length||0,
        d?.removedEdges.length||0
      ];
    });
};

exportWorkspaceCsv=function(){
  const rows=[
    ['Name','Type','Graph ID','Nodes','Edges','NodeGroups','History snapshots','Author','Last sync status',
     'Added nodes','Modified nodes','Removed nodes','Added edges','Modified edges','Removed edges'],
    ...workspaceInventoryRows()
  ];
  downloadCsv('ePatrimoniu_workspace_inventory.csv',rows);
  closeExportModal();showToast('Inventarul CSV a fost exportat.');
};

exportWorkspaceHtml=function(){
  const rows=workspaceInventoryRows();
  const resourceCount=rows.filter(r=>r[1]==='Resource Model').length;
  const branchCount=rows.length-resourceCount;
  const totalNodes=rows.reduce((s,r)=>s+Number(r[3]||0),0);
  const totalEdges=rows.reduce((s,r)=>s+Number(r[4]||0),0);
  const changed=rows.filter(r=>r[8]==='changed').length;
  const added=rows.filter(r=>r[8]==='new').length;

  const tableRows=rows.map(r=>`<tr>${r.map(x=>`<td>${esc(x)}</td>`).join('')}</tr>`).join('');
  const body=`
    <section><h2>Workspace summary</h2><div class="stats">
      <div class="stat"><b>${rows.length}</b><span>Grafuri</span></div>
      <div class="stat"><b>${resourceCount}</b><span>Resource Models</span></div>
      <div class="stat"><b>${branchCount}</b><span>Branches</span></div>
      <div class="stat"><b>${changed}</b><span>Modificate la ultimul sync</span></div>
      <div class="stat"><b>${added}</b><span>Noi la ultimul sync</span></div>
      <div class="stat"><b>${totalNodes}</b><span>Noduri</span></div>
      <div class="stat"><b>${totalEdges}</b><span>Muchii</span></div>
    </div><p class="note">Ultima sincronizare: ${esc(formatDate(workspace?.synced_at))}</p></section>
    <section><h2>Inventar complet + schimbări</h2>
      <table><thead><tr>
        <th>Nume</th><th>Tip</th><th>Graph ID</th><th>Noduri</th><th>Muchii</th><th>NodeGroups</th><th>Istoric</th><th>Autor</th><th>Status sync</th>
        <th>+ noduri</th><th>~ noduri</th><th>− noduri</th><th>+ muchii</th><th>~ muchii</th><th>− muchii</th>
      </tr></thead><tbody>${tableRows}</tbody></table>
    </section>`;
  const doc=htmlDocument('ePatrimoniu — Workspace inventory',`Inventar generat ${new Date().toLocaleString('ro-RO')}`,body);
  downloadText('ePatrimoniu_workspace_inventory.html',doc,'text/html;charset=utf-8');
  closeExportModal();showToast('Inventarul HTML a fost exportat.');
};

/* Re-render current Workspace once the v1.3 wrappers are installed. */
setTimeout(()=>{
  if(activeViewerMode==='workspace'){
    renderWorkspaceOverview();
    renderLibrary();
  }
},160);

/* ---- viewer script block ---- */
/* v1.4 Sync scope presentation */

function syncScopeLabel(){
  const scope=workspace?.sync_scope||'all';
  const labels={
    all:'toate',
    resources:'Resource Models',
    branches:'Branches',
    selected:'selecție'
  };
  return labels[scope]||scope;
}

function workspaceCountLabel(){
  const active=workspaceGraphs().length;
  const total=Number(workspace?.catalog_count)||active;
  const scope=workspace?.sync_scope||'all';

  if(scope==='all' || total===active){
    return `${active} grafuri`;
  }
  return `${active} din ${total} grafuri`;
}

function workspaceSyncLine(prefix){
  return `${prefix} · ${workspaceCountLabel()} · sync: ${syncScopeLabel()} · sincronizat ${formatDate(workspace?.synced_at)}`;
}

/* Rebind the unified controller with the v1.4 header wording. */
const v14EnterViewerMode=enterViewerMode;
enterViewerMode=function(mode){
  v14EnterViewerMode(mode);

  if(mode==='workspace'){
    $('stats').textContent=workspaceSyncLine('Workspace');
  }else if(mode==='patterns'){
    $('stats').textContent=workspaceSyncLine('Patterns');
  }else if(mode==='graph' && G){
    const ngCount=[...G.nodegroups.values()].filter(x=>x.count).length;
    $('stats').textContent=`${G.nodes.length} noduri · ${G.edges.length} muchii · ${ngCount} NodeGroups · ${G.isresource?'Resource Model':'Branch'} · sync: ${syncScopeLabel()} · sincronizat ${formatDate(workspace?.synced_at)}`;
  }
};

/* Rebind final mode buttons to the v1.4 wrapper. */
$('workspaceBtn').onclick=()=>enterViewerMode('workspace');
$('graphBtn').onclick=()=>enterViewerMode('graph');
$('patternsBtn').onclick=()=>enterViewerMode('patterns');

/* Extend the Workspace right panel with sync configuration status. */
const v14OverviewSide=overviewSide;
overviewSide=function(){
  v14OverviewSide();

  const side=$('side');
  if(!side)return;

  const active=workspaceGraphs().length;
  const total=Number(workspace?.catalog_count)||active;

  const kv=document.createElement('div');
  kv.className='kv';
  kv.innerHTML=`<div class="k">Sync scope</div><div class="v">${esc(syncScopeLabel())} · ${active}/${total} grafuri în workspace<br><span style="color:#7b8492">Pentru modificare sau actualizare rapidă, folosește butonul <b>Sync</b> din bara de sus.</span></div>`;
  side.appendChild(kv);
};

setTimeout(()=>{
  if(activeViewerMode==='workspace'){
    $('stats').textContent=workspaceSyncLine('Workspace');
    overviewSide();
  }
},220);

/* ---- viewer script block ---- */
/* v1.5 Integrated Sync */

let syncCatalog=null;
let syncCatalogSelection=new Set();
let syncBusy=false;

/* v1.10.2: Sync was moved from the old top toolbar to the left panel.
   Always resolve the currently existing trigger button instead of
   assuming #syncBtn still exists. */
function syncTriggerButton(){
  return $('leftSyncBtn') || $('syncBtn') || null;
}

function syncApiAvailable(){
  return location.protocol==='http:' &&
    (location.hostname==='127.0.0.1'||location.hostname==='localhost') &&
    !!EP_SESSION_TOKEN;
}

function openSyncModal(){
  if(isArchesLiveMode()){
    // Live Arches mode: refresh catalog/workspace from graphs API (no local PowerShell).
    refreshArchesLiveWorkspace();
    return;
  }

  if(!syncApiAvailable()){
    showToast('Sesiunea locală de Sync nu este disponibilă. Pornește aplicația prin ePatrimoniu Viewer.cmd.');
    return;
  }

  const currentChoice=$('syncCurrentChoice');
  const currentLabel=$('syncCurrentLabel');

  if(G && currentWorkspaceId){
    currentChoice.disabled=false;
    currentLabel.textContent=`${G.graphName} · ${G.isresource?'Resource Model':'Branch'}`;
  }else{
    currentChoice.disabled=true;
    currentLabel.textContent='Deschide un graf pentru această opțiune.';
  }

  $('syncCatalogArea').style.display='none';
  $('syncStatusBox').style.display='none';
  $('syncPersistChoice').checked=false;
  document.querySelectorAll('.syncChoice').forEach(x=>x.classList.remove('active'));

  $('syncModal').classList.add('open');
  $('syncModal').setAttribute('aria-hidden','false');
}

async function refreshArchesLiveWorkspace(){
  if(!isArchesLiveMode())return;
  const keepId=currentWorkspaceId;
  try{
    showToast('Reîmproaspătez lista din Arches…');
    workspace=await window.EPatrimoniuArchesGraphClient.buildWorkspaceShell();
    window.EPATRIMONIU_WORKSPACE=workspace;
    syncCatalog={graphs:workspace.graphs,graph_count:workspace.graphs.length,refreshed_at:workspace.synced_at};
    $('workspaceInfo').textContent=`${workspace.graphs.length} grafuri · Arches live`;
    renderLibrary();
    if(keepId && workspace.graphs.some(g=>g.graphid===keepId)){
      await loadAndOpenArchesGraph(keepId);
    }else{
      const first=workspace.graphs.find(x=>x.isresource)||workspace.graphs[0];
      if(first)openWorkspaceGraph(first.graphid);
    }
    showToast('Catalog Arches actualizat.');
  }catch(err){
    showToast('Reîmprospătare Arches eșuată: '+(err.message||err));
  }
}

function closeSyncModal(){
  if(syncBusy)return;
  $('syncModal').classList.remove('open');
  $('syncModal').setAttribute('aria-hidden','true');
}

function setSyncStatus(type,text){
  const box=$('syncStatusBox');
  box.className=`syncStatusBox ${type||''}`;
  box.textContent=text;
  box.style.display='block';
}

async function loadSyncCatalog(forceRefresh=false){
  if(syncCatalog && !forceRefresh)return syncCatalog;

  if(isArchesLiveMode()){
    const list=await window.EPatrimoniuArchesGraphClient.listGraphs();
    syncCatalog={
      graphs:list,
      graph_count:list.length,
      refreshed_at:new Date().toISOString(),
      source:'arches-api'
    };
    return syncCatalog;
  }

  // v1.10.3: the selectable catalog must reflect graphs created in Arches
  // after the Viewer was opened. The local service refreshes /graphs first.
  const path=forceRefresh?'/api/catalog?refresh=1':'/api/catalog';
  const res=await window.epApiFetch(path);
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(data.error || 'Catalogul Arches nu este disponibil.');

  syncCatalog=data;
  return syncCatalog;
}

function filteredSyncCatalog(){
  const graphs=syncCatalog?.graphs||[];
  const q=$('syncCatalogSearch').value.trim().toLowerCase();
  const type=$('syncCatalogType').value;

  return graphs.filter(g=>{
    if(type==='resource' && !g.isresource)return false;
    if(type==='branch' && g.isresource)return false;

    if(q){
      const hay=[g.name,g.graphid,g.author].join(' ').toLowerCase();
      if(!hay.includes(q))return false;
    }

    return true;
  });
}

function renderSyncCatalog(){
  const list=$('syncCatalogList');
  const graphs=filteredSyncCatalog();

  list.innerHTML=graphs.map(g=>{
    const checked=syncCatalogSelection.has(g.graphid)?'checked':'';
    return `<label class="syncCatalogRow">
      <input type="checkbox" data-sync-graph="${esc(g.graphid)}" ${checked}>
      <span><strong>${esc(g.name||g.graphid)}</strong><br><span style="color:#8a93a4">${esc(g.graphid)}</span></span>
      <span class="syncCatalogType">${g.isresource?'Resource Model':'Branch'}</span>
    </label>`;
  }).join('') || '<div class="patternEmpty">Niciun graf nu corespunde filtrului.</div>';

  list.querySelectorAll('[data-sync-graph]').forEach(cb=>{
    cb.onchange=()=>{
      if(cb.checked)syncCatalogSelection.add(cb.dataset.syncGraph);
      else syncCatalogSelection.delete(cb.dataset.syncGraph);
      updateSyncCatalogCount();
    };
  });

  updateSyncCatalogCount();
}

function updateSyncCatalogCount(){
  $('syncCatalogCount').textContent=`${syncCatalogSelection.size} selectate`;
  $('syncSelectedNow').disabled=syncCatalogSelection.size===0;
}

async function openCatalogSyncChoice(){
  document.querySelectorAll('.syncChoice').forEach(x=>x.classList.remove('active'));
  document.querySelector('.syncChoice[data-sync-mode="selected"]')?.classList.add('active');

  $('syncCatalogArea').style.display='block';

  try{
    setSyncStatus('running','Încarc catalogul…');
    await loadSyncCatalog(true);
    $('syncStatusBox').style.display='none';
    renderSyncCatalog();
  }catch(err){
    setSyncStatus('error',err.message);
  }
}

async function runIntegratedSync(mode,graphIds=[]){
  if(syncBusy)return;

  syncBusy=true;
  syncTriggerButton()?.classList.add('running');
  document.querySelectorAll('.syncChoice,#syncSelectedNow').forEach(x=>x.disabled=true);

  const persist=$('syncPersistChoice').checked;

  setSyncStatus('running','Sincronizez din Arches… această operație poate dura.');

  try{
    const res=await window.epApiFetch('/api/sync',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        mode,
        graph_ids:graphIds,
        persist
      })
    });

    const data=await res.json().catch(()=>({ok:false,error:'Răspuns invalid de la serviciul local.'}));

    if(!res.ok || !data.ok){
      throw new Error(data.error || `Sync eșuat (cod ${data.exit_code??res.status}).`);
    }

    const idx=data.index||{};
    const changed=Number(idx.changed)||0;
    const unchanged=Number(idx.unchanged)||0;
    const failed=Number(idx.failed)||0;

    setSyncStatus(
      failed?'error':'ok',
      `Sync terminat: ${changed} modificate/noi, ${unchanged} neschimbate${failed?`, ${failed} erori`:''}. Reîncarc workspace-ul…`
    );

    // Any sync may add/remove graphs in the Arches catalog.
    syncCatalog=null;
    setTimeout(()=>location.reload(),700);
  }catch(err){
    setSyncStatus('error',err.message||String(err));
    syncBusy=false;
    syncTriggerButton()?.classList.remove('running');
    document.querySelectorAll('.syncChoice,#syncSelectedNow').forEach(x=>x.disabled=false);

    if(!$('syncCurrentChoice').dataset.wasEnabled && !(G&&currentWorkspaceId)){
      $('syncCurrentChoice').disabled=true;
    }
  }
}

{
  const trigger=syncTriggerButton();
  if(trigger)trigger.onclick=openSyncModal;
}
$('syncClose').onclick=closeSyncModal;
$('syncModal').querySelectorAll('[data-sync-close]').forEach(el=>el.onclick=closeSyncModal);

document.querySelectorAll('.syncChoice').forEach(choice=>{
  choice.onclick=async()=>{
    const mode=choice.dataset.syncMode;

    document.querySelectorAll('.syncChoice').forEach(x=>x.classList.remove('active'));
    choice.classList.add('active');

    if(mode==='selected'){
      await openCatalogSyncChoice();
      return;
    }

    $('syncCatalogArea').style.display='none';

    if(mode==='current'){
      if(!currentWorkspaceId)return;
      await runIntegratedSync('current',[currentWorkspaceId]);
      return;
    }

    await runIntegratedSync(mode,[]);
  };
});

$('syncCatalogSearch').addEventListener('input',renderSyncCatalog);
$('syncCatalogType').addEventListener('change',renderSyncCatalog);
$('syncSelectedNow').onclick=()=>runIntegratedSync('selected',[...syncCatalogSelection]);

document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&$('syncModal').classList.contains('open'))closeSyncModal();
});

/* Explain if the HTML is opened directly instead of through the app launcher. */
setTimeout(()=>{
  if(!syncApiAvailable()){
    {
      const trigger=syncTriggerButton();
      if(trigger)trigger.title='Pornește prin ePatrimoniu Viewer.cmd pentru Sync integrat și sesiune locală securizată';
    }
  }
},120);

/* ---- viewer script block ---- */
/* v1.6 Analysis / Decision Layer */

const DECISION_STATUS={
  review:{label:'De analizat'},
  candidate:{label:'Candidat'},
  canonical:{label:'Canonic'},
  decide:{label:'De decis'},
  rejected:{label:'Respins'}
};

let decisionsStore={version:1,updated_at:null,items:[]};
let decisionsByKey=new Map();
let decisionFilter='all';
let decisionEditorTarget=null;

if(typeof panelState!=='undefined'){
  panelState.decisions={left:false,right:true};
}

function decisionStatusLabel(status){
  return DECISION_STATUS[status]?.label||status||'—';
}

function decisionKey(type,graphid,nodegroupid=''){
  if(type==='nodegroup')return `nodegroup:${graphid}:${nodegroupid}`;
  return `${type}:${graphid}`;
}

function decisionItemByKey(key){
  return decisionsByKey.get(key)||null;
}

function rebuildDecisionMap(){
  decisionsByKey=new Map((decisionsStore?.items||[]).map(item=>[item.key,item]));
}

function unicodeToBase64(text){
  const bytes=new TextEncoder().encode(text);
  let binary='';
  bytes.forEach(b=>binary+=String.fromCharCode(b));
  return btoa(binary);
}

async function loadDecisions(){
  if(!syncApiAvailable()){
    decisionsStore={version:1,updated_at:null,items:[]};
    rebuildDecisionMap();
    return decisionsStore;
  }

  try{
    const res=await window.epApiFetch('/api/decisions');

    if(!res.ok)throw new Error('Decision register unavailable.');

    decisionsStore=await res.json();
    if(!Array.isArray(decisionsStore.items))decisionsStore.items=[];
    rebuildDecisionMap();
  }catch(err){
    console.warn('Decisions:',err);
    decisionsStore={version:1,updated_at:null,items:[]};
    rebuildDecisionMap();
  }

  return decisionsStore;
}

async function saveDecisionItem(item){
  const payload={
    action:'upsert',
    data_b64:unicodeToBase64(JSON.stringify(item))
  };

  const res=await window.epApiFetch('/api/decisions',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(payload)
  });

  const data=await res.json().catch(()=>({ok:false,error:'Răspuns invalid'}));

  if(res.status===409||data.conflict)throw new Error('Decizia a fost modificată între timp. Reîncarcă registrul înainte de salvare.');
  if(!res.ok||!data.ok)throw new Error(data.error||'Nu am putut salva decizia.');

  decisionsStore=data.store||decisionsStore;
  if(!Array.isArray(decisionsStore.items))decisionsStore.items=[];
  rebuildDecisionMap();
  refreshDecisionDecorations();
  return data.item||item;
}

async function deleteDecisionKey(key){
  const res=await window.epApiFetch('/api/decisions',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action:'delete',key})
  });

  const data=await res.json().catch(()=>({ok:false,error:'Răspuns invalid'}));

  if(!res.ok||!data.ok)throw new Error(data.error||'Nu am putut șterge decizia.');

  decisionsStore=data.store||decisionsStore;
  if(!Array.isArray(decisionsStore.items))decisionsStore.items=[];
  rebuildDecisionMap();
  refreshDecisionDecorations();
}

function branchDecisionTarget(item){
  if(!item)return null;
  return {
    key:decisionKey('branch',item.graphid),
    target_type:'branch',
    graphid:item.graphid,
    nodegroupid:'',
    subject:item.name||item.graphid,
    context:'Branch'
  };
}

function resourceDecisionTarget(item){
  if(!item)return null;
  return {
    key:decisionKey('resource',item.graphid),
    target_type:'resource',
    graphid:item.graphid,
    nodegroupid:'',
    subject:item.name||item.graphid,
    context:'Resource Model'
  };
}

function nodegroupDecisionTarget(graphid,nodegroupid,subjectOverride=''){
  const item=workspaceGraphs().find(x=>x.graphid===graphid);
  const raw=item?.graph;
  const g=raw?normalizeGraph(raw):null;
  const members=g?.nodes.filter(n=>n.nodegroup===nodegroupid)||[];
  const labels=[...new Set(members.map(n=>n.name).filter(Boolean))].slice(0,3);
  const subject=subjectOverride||
    `${item?.name||graphid} · NodeGroup ${shortId(nodegroupid)}${labels.length?` · ${labels.join(' / ')}`:''}`;

  return {
    key:decisionKey('nodegroup',graphid,nodegroupid),
    target_type:'nodegroup',
    graphid,
    nodegroupid,
    subject,
    context:`NodeGroup în ${item?.name||graphid}`
  };
}

function currentDecisionTarget(){
  const item=currentWorkspaceId?workspaceGraphs().find(x=>x.graphid===currentWorkspaceId):null;
  if(!item||!G)return null;

  if(!G.isresource){
    return branchDecisionTarget(item);
  }

  const n=selectedNodeId?byId?.get(selectedNodeId):null;

  if(n?.nodegroup){
    return nodegroupDecisionTarget(item.graphid,n.nodegroup);
  }

  return resourceDecisionTarget(item);
}

function openDecisionEditor(target){
  if(!target){
    showToast('Nu există un Branch sau NodeGroup selectat.');
    return;
  }

  if(!syncApiAvailable()){
    showToast('Registrul de decizii necesită pornirea prin ePatrimoniu Viewer.cmd.');
    return;
  }

  decisionEditorTarget=target;
  const existing=decisionItemByKey(target.key);

  $('decisionKey').value=target.key;
  $('decisionTargetLabel').textContent=`${target.context} · ${target.subject}`;
  $('decisionStatus').value=existing?.status||'review';
  $('decisionCanonicalId').value=existing?.canonical_id||'';
  $('decisionTags').value=(existing?.tags||[]).join(', ');
  $('decisionNote').value=existing?.note||'';
  $('decisionDelete').style.display=existing?'inline-block':'none';
  $('decisionSaveStatus').textContent='';

  $('decisionModal').classList.add('open');
  $('decisionModal').setAttribute('aria-hidden','false');
  setTimeout(()=>$('decisionNote').focus(),40);
}

function closeDecisionEditor(){
  $('decisionModal').classList.remove('open');
  $('decisionModal').setAttribute('aria-hidden','true');
  decisionEditorTarget=null;
}

async function commitDecisionEditor(){
  if(!decisionEditorTarget)return;

  const tags=$('decisionTags').value
    .split(',')
    .map(x=>x.trim())
    .filter(Boolean);

  const existing=decisionItemByKey(decisionEditorTarget.key);
  const item={
    ...decisionEditorTarget,
    revision:Number(existing?.revision)||0,
    status:$('decisionStatus').value,
    canonical_id:$('decisionCanonicalId').value.trim(),
    tags,
    note:$('decisionNote').value.trim(),
    created_at:existing?.created_at||null,
    updated_at:existing?.updated_at||null,
    created_by:existing?.created_by||null,
    updated_by:existing?.updated_by||null,
    workspace_id:existing?.workspace_id||null
  };

  $('decisionSaveStatus').textContent='Salvez…';
  $('decisionSave').disabled=true;

  try{
    await saveDecisionItem(item);
    $('decisionSaveStatus').textContent='Salvat.';
    setTimeout(()=>{
      closeDecisionEditor();
      if(activeViewerMode==='decisions')renderDecisions();
    },250);
  }catch(err){
    $('decisionSaveStatus').textContent=err.message;
  }finally{
    $('decisionSave').disabled=false;
  }
}

async function removeDecisionEditorItem(){
  if(!decisionEditorTarget)return;
  if(!confirm('Ștergi această decizie din registrul local?'))return;

  $('decisionSaveStatus').textContent='Șterg…';

  try{
    await deleteDecisionKey(decisionEditorTarget.key);
    closeDecisionEditor();
    if(activeViewerMode==='decisions')renderDecisions();
  }catch(err){
    $('decisionSaveStatus').textContent=err.message;
  }
}

$('decisionBtn').onclick=()=>openDecisionEditor(currentDecisionTarget());
$('decisionClose').onclick=closeDecisionEditor;
$('decisionCancel').onclick=closeDecisionEditor;
$('decisionSave').onclick=commitDecisionEditor;
$('decisionDelete').onclick=removeDecisionEditorItem;
$('decisionModal').querySelectorAll('[data-decision-close]').forEach(x=>x.onclick=closeDecisionEditor);

function appendDecisionInspector(){
  if(activeViewerMode!=='graph'||!G||!$('side'))return;
  const target=currentDecisionTarget();
  if(!target)return;

  const current=decisionItemByKey(target.key);
  const box=document.createElement('div');
  box.className='decisionInspector';

  box.innerHTML=`
    <div class="decisionInspectorHead">
      <span class="decisionInspectorTitle">Analysis / Decision</span>
      ${current?`<span class="decisionStatusPill decisionStatus-${esc(current.status)}">${esc(decisionStatusLabel(current.status))}</span>`:'<span class="decisionStatusPill decisionStatus-review">fără decizie</span>'}
    </div>
    <div class="decisionInspectorBody">
      <b>${esc(target.target_type==='nodegroup'?'NodeGroup':'Graph')}</b><br>
      ${current?.canonical_id?`ID: <span class="decisionCode">${esc(current.canonical_id)}</span><br>`:''}
      ${current?.note?esc(current.note.slice(0,180))+(current.note.length>180?'…':''):'Nicio notă de analiză salvată.'}
    </div>
    <button type="button" class="editDecisionInspector">Editează decizia</button>
  `;

  box.querySelector('.editDecisionInspector').onclick=()=>openDecisionEditor(target);
  $('side').appendChild(box);
}

const v16SelectNode=selectNode;
selectNode=function(id,renderInspector=true){
  v16SelectNode(id,renderInspector);
  if(renderInspector)setTimeout(appendDecisionInspector,0);
};

function decisionForWorkspaceGraph(item){
  if(!item)return null;
  const type=item.isresource?'resource':'branch';
  return decisionItemByKey(decisionKey(type,item.graphid));
}

function decorateDecisionCards(){
  document.querySelectorAll('#workspaceMaps .mapItem[data-graphid]').forEach(card=>{
    const item=workspaceGraphs().find(x=>x.graphid===card.dataset.graphid);
    const decision=decisionForWorkspaceGraph(item);
    card.querySelector('.decisionCorner')?.remove();

    if(!decision)return;

    const badge=document.createElement('span');
    badge.className=`decisionCorner ${decision.status}`;
    badge.textContent=decisionStatusLabel(decision.status);
    card.appendChild(badge);
  });
}

function decoratePatternDecisionButtons(){
  const scroll=$('patternScroll');
  if(!scroll)return;

  scroll.querySelectorAll('tr').forEach(row=>{
    if(row.querySelector('.patternDecisionBtn'))return;

    const ngLink=row.querySelector('[data-resource][data-nodegroup]');
    const branchLinks=[...row.querySelectorAll('[data-branch]')];

    if(ngLink){
      const td=row.lastElementChild;
      if(td){
        const btn=document.createElement('button');
        btn.type='button';
        btn.className='patternDecisionBtn';
        btn.textContent='Decizie NG';
        btn.onclick=e=>{
          e.stopPropagation();
          openDecisionEditor(nodegroupDecisionTarget(
            ngLink.dataset.resource,
            ngLink.dataset.nodegroup
          ));
        };
        td.appendChild(btn);
      }
    }else if(branchLinks.length){
      const td=row.lastElementChild;
      branchLinks.slice(0,2).forEach((link,i)=>{
        const btn=document.createElement('button');
        btn.type='button';
        btn.className='patternDecisionBtn';
        btn.textContent=branchLinks.length>1?`Decizie ${i===0?'A':'B'}`:'Decizie';
        btn.onclick=e=>{
          e.stopPropagation();
          const item=workspaceGraphs().find(x=>x.graphid===link.dataset.branch);
          openDecisionEditor(branchDecisionTarget(item));
        };
        td?.appendChild(btn);
      });
    }
  });
}

function refreshDecisionDecorations(){
  decorateDecisionCards();
  decoratePatternDecisionButtons();
  if(activeViewerMode==='graph')appendDecisionInspector();
  if(activeViewerMode==='decisions')renderDecisions();
}

const v16RenderWorkspaceOverview=renderWorkspaceOverview;
renderWorkspaceOverview=function(){
  v16RenderWorkspaceOverview();
  decorateDecisionCards();
};

const v16RenderPatterns=renderPatterns;
renderPatterns=function(){
  v16RenderPatterns();
  decoratePatternDecisionButtons();
};

/* ---------------- Decision Register mode ---------------- */

function decisionStatCard(status,label,count){
  const active=decisionFilter===status?' active':'';
  return `<div class="decisionStat${active}" data-decision-filter="${status}">
    <div class="decisionStatValue">${count}</div>
    <div class="decisionStatLabel">${esc(label)}</div>
  </div>`;
}

function decisionCanonicalDuplicates(items){
  const map=new Map();
  items.forEach(item=>{
    const code=(item.canonical_id||'').trim().toLowerCase();
    if(!code)return;
    if(!map.has(code))map.set(code,[]);
    map.get(code).push(item);
  });
  return [...map.entries()].filter(([,arr])=>arr.length>1);
}

function filteredDecisions(){
  const q=$('decisionSearch')?.value.trim().toLowerCase()||'';
  return (decisionsStore.items||[])
    .filter(item=>decisionFilter==='all'||item.status===decisionFilter)
    .filter(item=>{
      if(!q)return true;
      return [
        item.subject,item.context,item.canonical_id,
        ...(item.tags||[]),item.note,item.graphid,item.nodegroupid
      ].join(' ').toLowerCase().includes(q);
    })
    .sort((a,b)=>(b.updated_at||'').localeCompare(a.updated_at||''));
}

function renderDecisionStats(){
  const items=decisionsStore.items||[];
  const counts={
    all:items.length,
    review:items.filter(x=>x.status==='review').length,
    candidate:items.filter(x=>x.status==='candidate').length,
    canonical:items.filter(x=>x.status==='canonical').length,
    decide:items.filter(x=>x.status==='decide').length,
    rejected:items.filter(x=>x.status==='rejected').length
  };

  $('decisionStats').innerHTML=
    decisionStatCard('all','Total',counts.all)+
    decisionStatCard('review','De analizat',counts.review)+
    decisionStatCard('candidate','Candidați',counts.candidate)+
    decisionStatCard('canonical','Canonice',counts.canonical)+
    decisionStatCard('decide','De decis',counts.decide)+
    decisionStatCard('rejected','Respinse',counts.rejected);

  $('decisionStats').querySelectorAll('[data-decision-filter]').forEach(card=>{
    card.onclick=()=>{
      decisionFilter=card.dataset.decisionFilter;
      $('decisionStatusFilter').value=decisionFilter;
      renderDecisions();
    };
  });
}

function openDecisionTarget(item){
  if(!item)return;

  openWorkspaceGraph(item.graphid);

  if(item.target_type==='nodegroup'&&item.nodegroupid){
    setTimeout(()=>highlightPatternNodegroup(item.nodegroupid),100);
  }
}

function renderDecisions(){
  renderDecisionStats();
  const items=filteredDecisions();
  const duplicates=decisionCanonicalDuplicates(decisionsStore.items||[]);

  let warning='';
  if(duplicates.length){
    const codes=duplicates.map(([code,arr])=>`${code.toUpperCase()} (${arr.length})`).join(', ');
    warning=`<div class="decisionDuplicateWarning"><b>Atenție:</b> există ID-uri canonice folosite de mai multe ori: ${esc(codes)}.</div>`;
  }

  if(!items.length){
    $('decisionScroll').innerHTML=`${warning}<div class="decisionSection"><div class="decisionEmpty">Nu există decizii care corespund filtrului curent.</div></div>`;
    return;
  }

  const rows=items.map(item=>`
    <tr data-decision-key="${esc(item.key)}">
      <td>
        <div class="decisionSubject">${esc(item.subject||item.key)}</div>
        <div class="decisionSubmeta">${esc(item.context||item.target_type||'')} · ${esc(item.target_type||'')}</div>
      </td>
      <td><span class="decisionStatusPill decisionStatus-${esc(item.status)}">${esc(decisionStatusLabel(item.status))}</span></td>
      <td><span class="decisionCode">${esc(item.canonical_id||'—')}</span></td>
      <td>${esc((item.tags||[]).join(', ')||'—')}</td>
      <td class="decisionNoteCell">${esc(item.note||'—')}</td>
      <td>${esc(item.updated_at?new Date(item.updated_at).toLocaleString('ro-RO'):'—')}</td>
      <td>
        <div class="decisionRowActions">
          <button type="button" data-decision-open="${esc(item.key)}">Deschide</button>
          <button type="button" data-decision-edit="${esc(item.key)}">Editează</button>
        </div>
      </td>
    </tr>
  `).join('');

  $('decisionScroll').innerHTML=`
    ${warning}
    <div class="decisionSection">
      <table class="decisionTable">
        <thead><tr><th>Subiect</th><th>Status</th><th>ID canonic</th><th>Etichete</th><th>Notă</th><th>Actualizat</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  $('decisionScroll').querySelectorAll('[data-decision-open]').forEach(btn=>{
    btn.onclick=()=>openDecisionTarget(decisionItemByKey(btn.dataset.decisionOpen));
  });

  $('decisionScroll').querySelectorAll('[data-decision-edit]').forEach(btn=>{
    btn.onclick=()=>{
      const item=decisionItemByKey(btn.dataset.decisionEdit);
      if(!item)return;
      openDecisionEditor({
        key:item.key,
        target_type:item.target_type,
        graphid:item.graphid,
        nodegroupid:item.nodegroupid||'',
        subject:item.subject,
        context:item.context
      });
    };
  });
}

function decisionsSide(){
  if(!$('side'))return;
  const items=decisionsStore.items||[];
  $('side').innerHTML=`<h2>Decision Register</h2>
    <div class="crmTitle">Registru local de pre-analiză</div>
    <div class="kv"><div class="k">Decizii</div><div class="v">${items.length}</div></div>
    <div class="kv"><div class="k">Candidați</div><div class="v">${items.filter(x=>x.status==='candidate').length}</div></div>
    <div class="kv"><div class="k">Canonice</div><div class="v">${items.filter(x=>x.status==='canonical').length}</div></div>
    <div class="kv"><div class="k">Persistență</div><div class="v">Decisions/decisions.json<br>Separat de Arches și de sync.</div></div>`;
}

/* Extend the final mode controller without modifying old controllers. */
const v16EnterViewerMode=enterViewerMode;
enterViewerMode=function(mode){
  if(mode==='decisions'){
    activeViewerMode='decisions';
    workspaceMode=false;
    patternsMode=false;

    document.body.classList.remove('workspaceMode','patternsMode');
    document.body.classList.add('decisionsMode');

    $('workspaceBtn')?.classList.remove('active');
    $('graphBtn')?.classList.remove('active');
    $('patternsBtn')?.classList.remove('active');
    $('decisionsBtn')?.classList.add('active');

    $('title').textContent='ePatrimoniu Semantic Graph Viewer';
    $('stats').textContent=`Decisions · ${(decisionsStore.items||[]).length} înregistrări`;

    renderDecisions();
    decisionsSide();
    applyPanelState();
    return;
  }

  document.body.classList.remove('decisionsMode');
  $('decisionsBtn')?.classList.remove('active');
  v16EnterViewerMode(mode);
};

$('workspaceBtn').onclick=()=>enterViewerMode('workspace');
$('graphBtn').onclick=()=>enterViewerMode('graph');
$('patternsBtn').onclick=()=>enterViewerMode('patterns');
$('decisionsBtn').onclick=()=>enterViewerMode('decisions');

$('decisionSearch').addEventListener('input',renderDecisions);
$('decisionStatusFilter').addEventListener('change',()=>{
  decisionFilter=$('decisionStatusFilter').value;
  renderDecisions();
});

/* ---------------- Decision export ---------------- */

function decisionRowsForExport(){
  return (decisionsStore.items||[])
    .slice()
    .sort((a,b)=>(a.subject||'').localeCompare(b.subject||'','ro'));
}

function exportDecisionsCsv(){
  const rows=[
    ['Subject','Target type','Status','Canonical ID','Tags','Note','Graph ID','NodeGroup ID','Updated at'],
    ...decisionRowsForExport().map(item=>[
      item.subject||'',
      item.target_type||'',
      decisionStatusLabel(item.status),
      item.canonical_id||'',
      (item.tags||[]).join(', '),
      item.note||'',
      item.graphid||'',
      item.nodegroupid||'',
      item.updated_at||''
    ])
  ];

  downloadCsv('ePatrimoniu_decision_register.csv',rows);
  closeExportModal();
  showToast('Registrul de decizii CSV a fost exportat.');
}

function exportDecisionsHtml(){
  const items=decisionRowsForExport();
  const rows=items.map(item=>`
    <tr>
      <td>${esc(item.subject||'')}</td>
      <td>${esc(item.target_type||'')}</td>
      <td>${esc(decisionStatusLabel(item.status))}</td>
      <td><code>${esc(item.canonical_id||'')}</code></td>
      <td>${esc((item.tags||[]).join(', '))}</td>
      <td>${esc(item.note||'')}</td>
      <td><code>${esc(item.graphid||'')}</code></td>
      <td><code>${esc(item.nodegroupid||'')}</code></td>
      <td>${esc(item.updated_at||'')}</td>
    </tr>`).join('');

  const body=`
    <section><h2>Sumar</h2><div class="stats">
      <div class="stat"><b>${items.length}</b><span>Total</span></div>
      <div class="stat"><b>${items.filter(x=>x.status==='candidate').length}</b><span>Candidați</span></div>
      <div class="stat"><b>${items.filter(x=>x.status==='canonical').length}</b><span>Canonice</span></div>
      <div class="stat"><b>${items.filter(x=>x.status==='decide').length}</b><span>De decis</span></div>
      <div class="stat"><b>${items.filter(x=>x.status==='rejected').length}</b><span>Respinse</span></div>
    </div>
    <p class="note">Registru local de pre-analiză. Nu reprezintă date scrise în Arches.</p></section>
    <section><h2>Decision Register</h2>
      <table><thead><tr><th>Subiect</th><th>Tip</th><th>Status</th><th>ID canonic</th><th>Etichete</th><th>Notă</th><th>Graph ID</th><th>NodeGroup ID</th><th>Actualizat</th></tr></thead>
      <tbody>${rows}</tbody></table>
    </section>`;

  const doc=htmlDocument(
    'ePatrimoniu — Decision Register',
    `Generat ${new Date().toLocaleString('ro-RO')}`,
    body
  );

  downloadText('ePatrimoniu_decision_register.html',doc,'text/html;charset=utf-8');
  closeExportModal();
  showToast('Registrul de decizii HTML a fost exportat.');
}

const v16OpenExportModal=openExportModal;
openExportModal=function(){
  if(activeViewerMode!=='decisions'){
    return v16OpenExportModal();
  }

  $('exportTitle').textContent='Export Decision Register';
  $('exportSubtitle').textContent='Exportă registrul local de analiză și decizie.';
  $('exportOptions').innerHTML=
    exportOption('Decision Register','Raport standalone cu toate deciziile și notele.','HTML','decisions-html')+
    exportOption('Decision Register data','Registrul complet pentru analiză în Excel sau alte instrumente.','CSV','decisions-csv');

  const actions={
    'decisions-html':exportDecisionsHtml,
    'decisions-csv':exportDecisionsCsv
  };

  $('exportOptions').querySelectorAll('[data-export-action]').forEach(btn=>{
    btn.onclick=()=>actions[btn.dataset.exportAction]?.();
  });

  $('exportModal').classList.add('open');
  $('exportModal').setAttribute('aria-hidden','false');
};
$('exportBtn').onclick=openExportModal;

/* Load persisted register at startup. */
loadDecisions().then(()=>{
  refreshDecisionDecorations();
  if(activeViewerMode==='decisions')renderDecisions();
});

/* ---- viewer script block ---- */
/* v1.7 Ergonomic toolbar organization */

function moveControlToSlot(id,slotId){
  const el=$(id);
  const slot=$(slotId);
  if(el&&slot){
    el.classList.remove('graphOnly');
    slot.appendChild(el);
  }
}

function buildErgonomicGraphToolbar(){
  /* Visualization */
  const labelCaption=[...document.querySelectorAll('label')].find(x=>x.textContent.trim()==='Etichete');
  if(labelCaption){
    labelCaption.classList.remove('graphOnly');
    $('visualToolsSlot')?.appendChild(labelCaption);
  }

  moveControlToSlot('labelMode','visualToolsSlot');
  moveControlToSlot('groupsBtn','visualToolsSlot');
  moveControlToSlot('focusBtn','visualToolsSlot');

  /* Analysis */
  moveControlToSlot('pathBtn','analysisToolsSlot');
  moveControlToSlot('clearPathBtn','analysisToolsSlot');
  moveControlToSlot('compareBtn','analysisToolsSlot');
  moveControlToSlot('decisionBtn','analysisToolsSlot');

  /* Canvas / file */
  moveControlToSlot('fitBtn','canvasToolsSlot');
  moveControlToSlot('openBtn','canvasToolsSlot');

  // Ensure toolbar-only controls don't retain old absolute visibility assumptions.
  ['labelMode','groupsBtn','focusBtn','pathBtn','clearPathBtn','compareBtn','decisionBtn','fitBtn','openBtn']
    .forEach(id=>{
      const el=$(id);
      if(el)el.style.display='';
    });
}

function updateLeftSyncSummary(){
  const meta=$('leftSyncMeta');
  const scope=$('leftSyncScope');
  if(!meta||!scope)return;

  const count=workspaceGraphs().length;
  const total=Number(workspace?.catalog_count)||count;
  meta.textContent=`${formatDate(workspace?.synced_at)} · ${count}/${total} grafuri`;
  scope.textContent=`Scope: ${syncScopeLabel?.()||workspace?.sync_scope||'all'}`;
}

if($('leftSyncBtn')){
  $('leftSyncBtn').onclick=()=>{
    if(typeof openSyncModal==='function')openSyncModal();
  };
}

function contextualModeRefresh(){
  const mode=activeViewerMode||'workspace';
  document.body.dataset.contextMode=mode;

  const graphTools=$('graphContextTools');
  const workspaceTools=$('workspaceContextTools');
  const patternsTools=$('patternsContextTools');
  const decisionsTools=$('decisionsContextTools');

  if(graphTools)graphTools.style.display=mode==='graph'?'flex':'none';
  if(workspaceTools)workspaceTools.style.display=mode==='workspace'?'flex':'none';
  if(patternsTools)patternsTools.style.display=mode==='patterns'?'flex':'none';
  if(decisionsTools)decisionsTools.style.display=mode==='decisions'?'flex':'none';

  updateLeftSyncSummary();
}

/* Wrap final mode controller */
const v17EnterViewerMode=enterViewerMode;
enterViewerMode=function(mode){
  v17EnterViewerMode(mode);
  setTimeout(contextualModeRefresh,0);
};

/* Rebind final mode buttons */
$('workspaceBtn').onclick=()=>enterViewerMode('workspace');
$('graphBtn').onclick=()=>enterViewerMode('graph');
$('patternsBtn').onclick=()=>enterViewerMode('patterns');
$('decisionsBtn').onclick=()=>enterViewerMode('decisions');

/* Reload remains global; Export remains contextual */
setTimeout(()=>{
  buildErgonomicGraphToolbar();
  contextualModeRefresh();
  updateLeftSyncSummary();
},180);

/* Refresh sync summary after every workspace reload */
window.addEventListener('pageshow',()=>setTimeout(updateLeftSyncSummary,80));

/* ---- viewer script block ---- */
/* v1.8 Mapping Registry */

const MAPPING_STATUS={
  unmapped:{label:'De mapat'},
  draft:{label:'Ciornă'},
  review:{label:'De verificat'},
  approved:{label:'Aprobat'},
  decide:{label:'De decis'},
  rejected:{label:'Respins'}
};

let mappingsStore={version:1,updated_at:null,items:[]};
let mappingsById=new Map();
let mappingFilter='all';
let mappingEditorTarget=null;
let mappingAssignmentId=null;

if(typeof panelState!=='undefined'){
  panelState.mappings={left:false,right:true};
}

function mappingStatusLabel(status){
  return MAPPING_STATUS[status]?.label||status||'—';
}

function rebuildMappingsMap(){
  mappingsById=new Map((mappingsStore.items||[]).map(item=>[item.id,item]));
}

function makeMappingId(){
  if(globalThis.crypto?.randomUUID)return crypto.randomUUID();
  return 'map-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,11);
}

async function loadMappings(){
  if(!syncApiAvailable()){
    mappingsStore={version:1,updated_at:null,items:[]};
    rebuildMappingsMap();
    return mappingsStore;
  }

  try{
    const res=await window.epApiFetch('/api/mappings');
    if(!res.ok)throw new Error('Mapping Registry unavailable.');
    mappingsStore=await res.json();
    if(!Array.isArray(mappingsStore.items))mappingsStore.items=[];
    rebuildMappingsMap();
  }catch(err){
    console.warn('Mappings:',err);
    mappingsStore={version:1,updated_at:null,items:[]};
    rebuildMappingsMap();
  }
  return mappingsStore;
}

async function saveMappingItem(item){
  const res=await window.epApiFetch('/api/mappings',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      action:'upsert',
      data_b64:unicodeToBase64(JSON.stringify(item))
    })
  });

  const data=await res.json().catch(()=>({ok:false,error:'Răspuns invalid'}));

  if(res.status===409||data.conflict){
    throw new Error('Această mapare a fost modificată după deschiderea editorului. Reîncarcă registrul și încearcă din nou.');
  }

  if(!res.ok||!data.ok)throw new Error(data.error||'Nu am putut salva maparea.');

  mappingsStore=data.store||mappingsStore;
  if(!Array.isArray(mappingsStore.items))mappingsStore.items=[];
  rebuildMappingsMap();
  refreshMappingUI();
  return data.item||item;
}

async function deleteMappingItem(id){
  const res=await window.epApiFetch('/api/mappings',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({action:'delete',id})
  });
  const data=await res.json().catch(()=>({ok:false,error:'Răspuns invalid'}));
  if(!res.ok||!data.ok)throw new Error(data.error||'Nu am putut șterge maparea.');
  mappingsStore=data.store||mappingsStore;
  if(!Array.isArray(mappingsStore.items))mappingsStore.items=[];
  rebuildMappingsMap();
  refreshMappingUI();
}

function selectedSemanticTarget(){
  if(!G||!currentWorkspaceId||!selectedNodeId)return null;
  const n=byId?.get(selectedNodeId);
  if(!n)return null;
  const item=workspaceGraphs().find(x=>x.graphid===currentWorkspaceId);

  return {
    graphid:currentWorkspaceId,
    graph_name:G.graphName||item?.name||currentWorkspaceId,
    graph_type:G.isresource?'resource':'branch',
    nodeid:n.id||selectedNodeId,
    node_name:n.name||n.crm||n.id||selectedNodeId,
    nodegroupid:n.nodegroup||'',
    crm_class:n.crm||'',
    crm_class_uri:n.crm_uri||'',
    datatype:n.datatype||''
  };
}

function targetSummary(target){
  if(!target?.nodeid)return 'Nicio țintă selectată.';
  const group=target.nodegroupid?` · NodeGroup ${shortId(target.nodegroupid)}`:'';
  const crm=target.crm_class?` · ${target.crm_class}`:'';
  return `${target.graph_name||target.graphid} → ${target.node_name||target.nodeid}${crm}${group}`;
}

function fillCanonicalPatternList(){
  const list=$('canonicalPatternList');
  if(!list)return;
  const ids=[...new Set(
    (decisionsStore.items||[])
      .map(x=>(x.canonical_id||'').trim())
      .filter(Boolean)
  )].sort((a,b)=>a.localeCompare(b,'ro'));

  list.innerHTML=ids.map(id=>`<option value="${esc(id)}"></option>`).join('');
}

function openMappingEditor(item=null,targetOverride=null){
  if(!syncApiAvailable()){
    showToast('Mapping Registry necesită pornirea prin ePatrimoniu Viewer.cmd.');
    return;
  }

  const existing=item||null;
  const target=targetOverride||
    (existing?.target?.nodeid?existing.target:null)||
    null;

  mappingEditorTarget=target;

  $('mappingId').value=existing?.id||makeMappingId();
  $('mappingRevision').value=existing?.revision||0;
  $('mappingFieldId').value=existing?.field_id||'';
  $('mappingFieldLabel').value=existing?.field_label||'';
  $('mappingForm').value=existing?.form||'';
  $('mappingSection').value=existing?.section||'';
  $('mappingSource').value=existing?.source||'';
  $('mappingStatus').value=existing?.status||(target?'draft':'unmapped');
  $('mappingPatternId').value=existing?.canonical_pattern_id||'';
  $('mappingTags').value=(existing?.tags||[]).join(', ');
  $('mappingJustification').value=existing?.justification||'';
  $('mappingDelete').style.display=existing?'inline-block':'none';
  $('mappingSaveStatus').textContent='';
  $('mappingTargetSummary').textContent=targetSummary(target);
  $('mappingTargetLabel').textContent=existing
    ? `${existing.field_id||'Mapare'} · rev. ${existing.revision||0}`
    : (target?'Ținta semantică este preluată din nodul curent.':'Înregistrare nouă, încă fără țintă semantică.');

  fillCanonicalPatternList();

  $('mappingModal').classList.add('open');
  $('mappingModal').setAttribute('aria-hidden','false');
  setTimeout(()=>$('mappingFieldId').focus(),40);
}

function closeMappingEditor(){
  $('mappingModal').classList.remove('open');
  $('mappingModal').setAttribute('aria-hidden','true');
  mappingEditorTarget=null;
}

function useCurrentNodeInMapping(){
  const target=selectedSemanticTarget();
  if(!target){
    $('mappingSaveStatus').textContent='Selectează mai întâi un nod în Graph.';
    return;
  }
  mappingEditorTarget=target;
  $('mappingTargetSummary').textContent=targetSummary(target);
  if($('mappingStatus').value==='unmapped')$('mappingStatus').value='draft';
}

function clearMappingTarget(){
  mappingEditorTarget=null;
  $('mappingTargetSummary').textContent='Nicio țintă selectată.';
  if($('mappingStatus').value==='draft')$('mappingStatus').value='unmapped';
}

async function commitMappingEditor(){
  const fieldId=$('mappingFieldId').value.trim();
  if(!fieldId){
    $('mappingSaveStatus').textContent='Field ID este obligatoriu.';
    $('mappingFieldId').focus();
    return;
  }

  const tags=$('mappingTags').value.split(',').map(x=>x.trim()).filter(Boolean);
  const old=mappingsById.get($('mappingId').value);
  const item={
    id:$('mappingId').value,
    revision:Number($('mappingRevision').value)||0,
    field_id:fieldId,
    field_label:$('mappingFieldLabel').value.trim(),
    form:$('mappingForm').value.trim(),
    section:$('mappingSection').value.trim(),
    source:$('mappingSource').value.trim(),
    status:$('mappingStatus').value,
    canonical_pattern_id:$('mappingPatternId').value.trim(),
    tags,
    justification:$('mappingJustification').value.trim(),
    target:mappingEditorTarget||null,
    created_at:old?.created_at||null,
    updated_at:old?.updated_at||null,
    created_by:old?.created_by||null,
    updated_by:old?.updated_by||null
  };

  if(!item.target?.nodeid && item.status!=='unmapped'){
    item.status='unmapped';
  }

  $('mappingSave').disabled=true;
  $('mappingSaveStatus').textContent='Salvez…';

  try{
    const saved=await saveMappingItem(item);
    $('mappingSaveStatus').textContent=`Salvat · rev. ${saved.revision||'?'}`;
    if(mappingAssignmentId===saved.id)mappingAssignmentId=null;
    setTimeout(()=>{
      closeMappingEditor();
      updateMappingAssignmentPill();
      if(activeViewerMode==='mappings')renderMappings();
    },250);
  }catch(err){
    $('mappingSaveStatus').textContent=err.message;
  }finally{
    $('mappingSave').disabled=false;
  }
}

async function removeMappingEditorItem(){
  const id=$('mappingId').value;
  if(!mappingsById.has(id))return;
  if(!confirm('Ștergi această mapare din registru?'))return;

  $('mappingSaveStatus').textContent='Șterg…';
  try{
    await deleteMappingItem(id);
    if(mappingAssignmentId===id)mappingAssignmentId=null;
    closeMappingEditor();
    updateMappingAssignmentPill();
    if(activeViewerMode==='mappings')renderMappings();
  }catch(err){
    $('mappingSaveStatus').textContent=err.message;
  }
}

$('mappingClose').onclick=closeMappingEditor;
$('mappingCancel').onclick=closeMappingEditor;
$('mappingSave').onclick=commitMappingEditor;
$('mappingDelete').onclick=removeMappingEditorItem;
$('mappingUseCurrentNode').onclick=useCurrentNodeInMapping;
$('mappingClearTarget').onclick=clearMappingTarget;
$('mappingModal').querySelectorAll('[data-mapping-close]').forEach(x=>x.onclick=closeMappingEditor);

function graphMappingButton(){
  const target=selectedSemanticTarget();
  if(!target){
    showToast('Selectează un nod pentru mapare.');
    return;
  }

  if(mappingAssignmentId){
    const existing=mappingsById.get(mappingAssignmentId);
    if(existing){
      openMappingEditor(existing,target);
      return;
    }
  }

  openMappingEditor(null,target);
}
$('mappingBtn').onclick=graphMappingButton;

function startMappingAssignment(id){
  const item=mappingsById.get(id);
  if(!item)return;
  mappingAssignmentId=id;
  updateMappingAssignmentPill();

  if(G){
    enterViewerMode('graph');
    showToast(`Mapezi ${item.field_id}. Selectează nodul și apasă „Mapare câmp”.`);
  }else{
    enterViewerMode('workspace');
    showToast(`Mapezi ${item.field_id}. Deschide un graf, selectează nodul și apasă „Mapare câmp”.`);
  }
}

function cancelMappingAssignment(){
  mappingAssignmentId=null;
  updateMappingAssignmentPill();
}

function updateMappingAssignmentPill(){
  let pill=$('mappingAssignmentPill');
  const slot=$('analysisToolsSlot');

  if(!pill&&slot){
    pill=document.createElement('div');
    pill.id='mappingAssignmentPill';
    pill.className='mappingAssignmentPill';
    pill.innerHTML='<span></span><button type="button" title="Anulează maparea">×</button>';
    pill.querySelector('button').onclick=cancelMappingAssignment;
    slot.appendChild(pill);
  }

  if(!pill)return;

  const item=mappingAssignmentId?mappingsById.get(mappingAssignmentId):null;
  if(!item){
    pill.classList.remove('show');
    return;
  }

  pill.querySelector('span').textContent=`Mapezi: ${item.field_id}${item.field_label?` · ${item.field_label}`:''}`;
  pill.classList.add('show');
}

/* ---------------- Mapping Registry mode ---------------- */

function mappingStatCard(status,label,count){
  const active=mappingFilter===status?' active':'';
  return `<div class="mappingStat${active}" data-mapping-filter="${status}">
    <div class="mappingStatValue">${count}</div>
    <div class="mappingStatLabel">${esc(label)}</div>
  </div>`;
}

function mappingDuplicateTargets(){
  const map=new Map();
  (mappingsStore.items||[]).forEach(item=>{
    if(!item.field_id||!item.target?.nodeid)return;
    const key=`${item.field_id.toLowerCase()}|${item.target.graphid}|${item.target.nodeid}`;
    if(!map.has(key))map.set(key,[]);
    map.get(key).push(item);
  });
  return [...map.values()].filter(arr=>arr.length>1);
}

function filteredMappings(){
  const q=$('mappingSearch')?.value.trim().toLowerCase()||'';
  return (mappingsStore.items||[])
    .filter(item=>mappingFilter==='all'||item.status===mappingFilter)
    .filter(item=>{
      if(!q)return true;
      const t=item.target||{};
      return [
        item.field_id,item.field_label,item.form,item.section,item.source,
        item.canonical_pattern_id,item.justification,...(item.tags||[]),
        t.graph_name,t.node_name,t.crm_class,t.crm_class_uri,t.datatype
      ].join(' ').toLowerCase().includes(q);
    })
    .sort((a,b)=>
      (a.form||'').localeCompare(b.form||'','ro')||
      (a.section||'').localeCompare(b.section||'','ro')||
      (a.field_id||'').localeCompare(b.field_id||'','ro')
    );
}

function renderMappingStats(){
  const items=mappingsStore.items||[];
  const count=status=>items.filter(x=>x.status===status).length;

  $('mappingStats').innerHTML=
    mappingStatCard('all','Total',items.length)+
    mappingStatCard('unmapped','De mapat',count('unmapped'))+
    mappingStatCard('draft','Ciorne',count('draft'))+
    mappingStatCard('review','De verificat',count('review'))+
    mappingStatCard('approved','Aprobate',count('approved'))+
    mappingStatCard('decide','De decis',count('decide'))+
    mappingStatCard('rejected','Respinse',count('rejected'));

  $('mappingStats').querySelectorAll('[data-mapping-filter]').forEach(card=>{
    card.onclick=()=>{
      mappingFilter=card.dataset.mappingFilter;
      $('mappingStatusFilter').value=mappingFilter;
      renderMappings();
    };
  });
}

function openMappingTarget(item){
  if(!item?.target?.graphid){
    showToast('Această mapare nu are încă o țintă semantică.');
    return;
  }

  openWorkspaceGraph(item.target.graphid);
  setTimeout(()=>{
    if(item.target.nodeid&&byId?.has(item.target.nodeid)){
      selectNode(item.target.nodeid);
      if(item.target.nodegroupid)highlightPatternNodegroup(item.target.nodegroupid);
    }
  },100);
}

function renderMappings(){
  renderMappingStats();
  const items=filteredMappings();
  const duplicates=mappingDuplicateTargets();

  let warning='';
  if(duplicates.length){
    warning=`<div class="mappingConflictWarning"><b>Atenție:</b> există ${duplicates.length} mapări duplicate pentru același Field ID și aceeași țintă semantică.</div>`;
  }

  if(!items.length){
    $('mappingScroll').innerHTML=`${warning}<div class="mappingSection"><div class="mappingEmpty">Nu există mapări care corespund filtrului curent.</div></div>`;
    return;
  }

  const rows=items.map(item=>{
    const t=item.target||{};
    const target=t.nodeid
      ? `<div>${esc(t.graph_name||t.graphid)} → <b>${esc(t.node_name||t.nodeid)}</b></div>
         <div class="mappingTargetCrm">${esc(t.crm_class||'')} ${t.nodegroupid?`· NG ${esc(shortId(t.nodegroupid))}`:''}</div>`
      : '<span style="color:#8a93a4">Nemap-at</span>';

    return `<tr>
      <td>
        <div class="mappingFieldId">${esc(item.field_id||'')}</div>
        <div class="mappingLabel">${esc(item.field_label||'')}</div>
      </td>
      <td>
        <div>${esc(item.form||'—')}</div>
        <div class="mappingMeta">${esc(item.section||'')}</div>
      </td>
      <td><span class="mappingStatusPill mappingStatus-${esc(item.status)}">${esc(mappingStatusLabel(item.status))}</span></td>
      <td><span class="mappingFieldId">${esc(item.canonical_pattern_id||'—')}</span></td>
      <td class="mappingTargetCell">${target}</td>
      <td class="mappingJustificationCell">${esc(item.justification||'—')}</td>
      <td><span class="mappingMeta">rev. ${esc(item.revision||0)}<br>${esc(item.updated_at?new Date(item.updated_at).toLocaleString('ro-RO'):'—')}</span></td>
      <td>
        <div class="mappingRowActions">
          ${t.graphid?`<button type="button" data-map-open="${esc(item.id)}">Deschide</button>`:''}
          <button type="button" data-map-assign="${esc(item.id)}">Mapează</button>
          <button type="button" data-map-edit="${esc(item.id)}">Editează</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  $('mappingScroll').innerHTML=`
    ${warning}
    <div class="mappingSection">
      <table class="mappingTable">
        <thead><tr><th>Câmp</th><th>Formular / secțiune</th><th>Status</th><th>Pattern ID</th><th>Țintă semantică</th><th>Justificare</th><th>Revizie</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  $('mappingScroll').querySelectorAll('[data-map-open]').forEach(btn=>{
    btn.onclick=()=>openMappingTarget(mappingsById.get(btn.dataset.mapOpen));
  });
  $('mappingScroll').querySelectorAll('[data-map-assign]').forEach(btn=>{
    btn.onclick=()=>startMappingAssignment(btn.dataset.mapAssign);
  });
  $('mappingScroll').querySelectorAll('[data-map-edit]').forEach(btn=>{
    btn.onclick=()=>openMappingEditor(mappingsById.get(btn.dataset.mapEdit));
  });
}

function mappingSide(){
  if(!$('side'))return;
  const items=mappingsStore.items||[];
  $('side').innerHTML=`<h2>Mapping Registry</h2>
    <div class="crmTitle">Field → semantic target</div>
    <div class="kv"><div class="k">Mapări</div><div class="v">${items.length}</div></div>
    <div class="kv"><div class="k">De mapat</div><div class="v">${items.filter(x=>x.status==='unmapped').length}</div></div>
    <div class="kv"><div class="k">Aprobate</div><div class="v">${items.filter(x=>x.status==='approved').length}</div></div>
    <div class="kv"><div class="k">Persistență</div><div class="v">Mappings/mappings.json<br>ID stabil + revision + timestamps.</div></div>`;
}

/* Mapping inspector in Graph */
function mappingsForCurrentNode(){
  if(!currentWorkspaceId||!selectedNodeId)return [];
  return (mappingsStore.items||[]).filter(item=>
    item.target?.graphid===currentWorkspaceId &&
    item.target?.nodeid===selectedNodeId
  );
}

function appendMappingInspector(){
  if(activeViewerMode!=='graph'||!G||!$('side'))return;
  $('side').querySelector('.mappingInspector')?.remove();

  const items=mappingsForCurrentNode();
  const box=document.createElement('div');
  box.className='mappingInspector';
  box.innerHTML=`
    <div class="mappingInspectorTitle">Mapping Registry</div>
    <div class="mappingInspectorBody">
      ${items.length
        ? `${items.length} câmp${items.length===1?'':'uri'} mapat${items.length===1?'':'e'} aici:<br>${items.slice(0,5).map(x=>`<span class="mappingInspectorField">${esc(x.field_id)}</span>`).join('<br>')}${items.length>5?'<br>…':''}`
        : 'Niciun câmp din registru nu este mapat la nodul selectat.'}
    </div>
    <button type="button" class="mappingInspectorAdd">Mapare câmp</button>
  `;
  box.querySelector('.mappingInspectorAdd').onclick=graphMappingButton;
  $('side').appendChild(box);
}

const v18SelectNode=selectNode;
selectNode=function(id,renderInspector=true){
  v18SelectNode(id,renderInspector);
  if(renderInspector)setTimeout(appendMappingInspector,0);
};

function refreshMappingUI(){
  updateMappingAssignmentPill();
  if(activeViewerMode==='mappings')renderMappings();
  if(activeViewerMode==='graph')appendMappingInspector();
}

/* Extend final mode controller. */
const v18EnterViewerMode=enterViewerMode;
enterViewerMode=function(mode){
  if(mode==='mappings'){
    activeViewerMode='mappings';
    workspaceMode=false;
    patternsMode=false;

    document.body.classList.remove('workspaceMode','patternsMode','decisionsMode');
    document.body.classList.add('mappingsMode');

    $('workspaceBtn')?.classList.remove('active');
    $('graphBtn')?.classList.remove('active');
    $('patternsBtn')?.classList.remove('active');
    $('decisionsBtn')?.classList.remove('active');
    $('mappingsBtn')?.classList.add('active');

    $('title').textContent='ePatrimoniu Semantic Graph Viewer';
    $('stats').textContent=`Mappings · ${(mappingsStore.items||[]).length} înregistrări`;

    renderMappings();
    mappingSide();
    applyPanelState();
    contextualModeRefresh?.();
    return;
  }

  document.body.classList.remove('mappingsMode');
  $('mappingsBtn')?.classList.remove('active');
  v18EnterViewerMode(mode);
  updateMappingAssignmentPill();
};

$('workspaceBtn').onclick=()=>enterViewerMode('workspace');
$('graphBtn').onclick=()=>enterViewerMode('graph');
$('patternsBtn').onclick=()=>enterViewerMode('patterns');
$('decisionsBtn').onclick=()=>enterViewerMode('decisions');
$('mappingsBtn').onclick=()=>enterViewerMode('mappings');
$('addMappingBtn').onclick=()=>openMappingEditor();

$('mappingSearch').addEventListener('input',renderMappings);
$('mappingStatusFilter').addEventListener('change',()=>{
  mappingFilter=$('mappingStatusFilter').value;
  renderMappings();
});

/* Extend contextual toolbar refresh from v1.7 */
const v18ContextualModeRefresh=contextualModeRefresh;
contextualModeRefresh=function(){
  v18ContextualModeRefresh();
  const mode=activeViewerMode||'workspace';
  const mappingsTools=$('mappingsContextTools');
  if(mappingsTools)mappingsTools.style.display=mode==='mappings'?'flex':'none';
  updateMappingAssignmentPill();
};

/* Graph toolbar: move Mapping button into Analysis. */
setTimeout(()=>{
  moveControlToSlot('mappingBtn','analysisToolsSlot');
  updateMappingAssignmentPill();
},220);

/* ---------------- Mapping export ---------------- */

function mappingRowsForExport(){
  return (mappingsStore.items||[])
    .slice()
    .sort((a,b)=>(a.field_id||'').localeCompare(b.field_id||'','ro'));
}

function exportMappingsCsv(){
  const rows=[[
    'Mapping ID','Field ID','Field label','Form','Section','Source','Status',
    'Canonical Pattern ID','Tags','Justification',
    'Graph ID','Graph name','Graph type','Node ID','Node name','NodeGroup ID',
    'CIDOC CRM class','CIDOC CRM class URI','Datatype',
    'Revision','Created at','Updated at','Created by','Updated by'
  ]];

  mappingRowsForExport().forEach(item=>{
    const t=item.target||{};
    rows.push([
      item.id||'',item.field_id||'',item.field_label||'',item.form||'',item.section||'',item.source||'',
      mappingStatusLabel(item.status),item.canonical_pattern_id||'',(item.tags||[]).join(', '),item.justification||'',
      t.graphid||'',t.graph_name||'',t.graph_type||'',t.nodeid||'',t.node_name||'',t.nodegroupid||'',
      t.crm_class||'',t.crm_class_uri||'',t.datatype||'',
      item.revision||0,item.created_at||'',item.updated_at||'',item.created_by||'',item.updated_by||''
    ]);
  });

  downloadCsv('ePatrimoniu_mapping_registry.csv',rows);
  closeExportModal();
  showToast('Mapping Registry CSV a fost exportat.');
}

function exportMappingsHtml(){
  const items=mappingRowsForExport();
  const rows=items.map(item=>{
    const t=item.target||{};
    return `<tr>
      <td><code>${esc(item.field_id||'')}</code><br>${esc(item.field_label||'')}</td>
      <td>${esc(item.form||'')}<br><span class="muted">${esc(item.section||'')}</span></td>
      <td>${esc(mappingStatusLabel(item.status))}</td>
      <td><code>${esc(item.canonical_pattern_id||'')}</code></td>
      <td>${t.nodeid?`${esc(t.graph_name||t.graphid)} → ${esc(t.node_name||t.nodeid)}<br><span class="muted">${esc(t.crm_class||'')}</span>`:'—'}</td>
      <td>${esc(item.justification||'')}</td>
      <td>${esc(item.revision||0)}</td>
    </tr>`;
  }).join('');

  const body=`
    <section><h2>Sumar</h2><div class="stats">
      <div class="stat"><b>${items.length}</b><span>Total</span></div>
      <div class="stat"><b>${items.filter(x=>x.status==='unmapped').length}</b><span>De mapat</span></div>
      <div class="stat"><b>${items.filter(x=>x.status==='review').length}</b><span>De verificat</span></div>
      <div class="stat"><b>${items.filter(x=>x.status==='approved').length}</b><span>Aprobate</span></div>
      <div class="stat"><b>${items.filter(x=>x.status==='decide').length}</b><span>De decis</span></div>
    </div>
    <p class="note">Registru local de pre-analiză. Câmpurile sunt legate de Graph ID / Node ID stabile din snapshot-ul Arches sincronizat.</p></section>
    <section><h2>Mapping Registry</h2>
      <table><thead><tr><th>Câmp</th><th>Formular / secțiune</th><th>Status</th><th>Pattern ID</th><th>Țintă semantică</th><th>Justificare</th><th>Rev.</th></tr></thead>
      <tbody>${rows}</tbody></table>
    </section>`;

  const doc=htmlDocument('ePatrimoniu — Mapping Registry',`Generat ${new Date().toLocaleString('ro-RO')}`,body);
  downloadText('ePatrimoniu_mapping_registry.html',doc,'text/html;charset=utf-8');
  closeExportModal();
  showToast('Mapping Registry HTML a fost exportat.');
}

const v18OpenExportModal=openExportModal;
openExportModal=function(){
  if(activeViewerMode!=='mappings'){
    return v18OpenExportModal();
  }

  $('exportTitle').textContent='Export Mapping Registry';
  $('exportSubtitle').textContent='Exportă registrul Field ID → țintă semantică.';
  $('exportOptions').innerHTML=
    exportOption('Mapping Registry','Raport standalone cu status, ținte și justificări.','HTML','mappings-html')+
    exportOption('Mapping Registry data','Tabel complet, inclusiv identificatorii tehnici și reviziile.','CSV','mappings-csv');

  const actions={
    'mappings-html':exportMappingsHtml,
    'mappings-csv':exportMappingsCsv
  };
  $('exportOptions').querySelectorAll('[data-export-action]').forEach(btn=>{
    btn.onclick=()=>actions[btn.dataset.exportAction]?.();
  });
  $('exportModal').classList.add('open');
  $('exportModal').setAttribute('aria-hidden','false');
};
$('exportBtn').onclick=openExportModal;

/* Load registry after session bootstrap / decision load. */
loadMappings().then(()=>{
  refreshMappingUI();
});

/* ---- viewer script block ---- */
/* v1.9 Canonical Pattern Library */
const LIBRARY_STATUS={candidate:'Candidat',canonical:'Canonic',deprecated:'Înlocuit',rejected:'Respins'};
let patternsStore={version:1,items:[]},patternsById=new Map(),libraryFilter='all',patternView='analysis',patternEditorTarget=null,validationIssues=[];
function rebuildPatternsMap(){patternsById=new Map((patternsStore.items||[]).map(x=>[x.id,x]));}
function makePatternRecordId(){return crypto?.randomUUID?.()||('pat-'+Date.now().toString(36)+Math.random().toString(36).slice(2));}
async function loadPatternLibrary(){try{const r=await window.epApiFetch('/api/patterns');if(!r.ok)throw 0;patternsStore=await r.json();if(!Array.isArray(patternsStore.items))patternsStore.items=[];}catch(e){patternsStore={version:1,items:[]};}rebuildPatternsMap();return patternsStore;}
async function savePatternLibraryItem(item){const r=await window.epApiFetch('/api/patterns',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'upsert',data_b64:unicodeToBase64(JSON.stringify(item))})});const d=await r.json().catch(()=>({}));if(r.status===409||d.conflict)throw new Error('Pattern-ul a fost modificat între timp. Reîncarcă biblioteca.');if(!r.ok||!d.ok)throw new Error(d.error||'Salvare eșuată.');patternsStore=d.store;rebuildPatternsMap();return d.item;}
async function deletePatternLibraryItem(id){const r=await window.epApiFetch('/api/patterns',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'delete',id})});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||'Ștergere eșuată.');patternsStore=d.store;rebuildPatternsMap();}
function structureSig(p){const n=[...p.nodeSet.entries()].sort().map(([k,v])=>k+'#'+v);const e=[...p.edgeSet.entries()].sort().map(([k,v])=>k+'#'+v);return 'N:'+n.join('|')+'::E:'+e.join('|');}
function currentCanonicalSource(){if(!G||!currentWorkspaceId)return null;const item=workspaceGraphs().find(x=>x.graphid===currentWorkspaceId);if(!item)return null;if(!G.isresource){const p=normalizedPatternFromGraph(item.graph);return{source_type:'branch',graphid:item.graphid,graph_name:item.name,label:item.name,nodegroupid:'',signature:structureSig(p),node_count:p.nodeCount,edge_count:p.edgeCount};}const n=selectedNodeId?byId?.get(selectedNodeId):null;if(!n?.nodegroup)return null;const members=G.nodes.filter(x=>x.nodegroup===n.nodegroup).map(x=>x.id);const p=normalizedPatternFromGraph(item.graph,members);return{source_type:'nodegroup',graphid:item.graphid,graph_name:item.name,label:item.name+' · NodeGroup '+shortId(n.nodegroup),nodegroupid:n.nodegroup,signature:structureSig(p),node_count:p.nodeCount,edge_count:p.edgeCount};}
function currentSourceStructure(s){const item=workspaceGraphs().find(x=>x.graphid===s?.graphid);if(!item?.graph)return null;if(s.source_type==='branch')return normalizedPatternFromGraph(item.graph);const g=normalizeGraph(item.graph),ids=g.nodes.filter(n=>n.nodegroup===s.nodegroupid).map(n=>n.id);return ids.length?normalizedPatternFromGraph(item.graph,ids):null;}
function suggestPatternId(){const used=new Set((patternsStore.items||[]).map(x=>(x.canonical_id||'').toUpperCase()));for(let i=1;i<1000;i++){const id='EP.BR.'+String(i).padStart(3,'0');if(!used.has(id))return id;}return 'EP.BR.XXX';}
function sourceSummary(s){return s?.graphid?`${s.source_type==='branch'?'Branch':'NodeGroup'}: ${s.label||s.graph_name} · ${s.node_count||0} noduri / ${s.edge_count||0} muchii`:'Nicio sursă.';}
function openCanonicalPatternEditor(item=null,target=null){const s=target||item?.source||null;patternEditorTarget=s;$('canonicalPatternRecordId').value=item?.id||makePatternRecordId();$('canonicalPatternRevision').value=item?.revision||0;$('canonicalPatternId').value=item?.canonical_id||suggestPatternId();$('canonicalPatternStatus').value=item?.status||'candidate';$('canonicalPatternName').value=item?.name||s?.label||'';$('canonicalPatternTags').value=(item?.tags||[]).join(', ');$('canonicalPatternDescription').value=item?.description||'';$('canonicalPatternGovernance').value=item?.governance_note||'';$('canonicalPatternTargetSummary').textContent=sourceSummary(s);$('canonicalPatternTargetLabel').textContent=item?`${item.canonical_id} · rev. ${item.revision||0}`:'Pattern nou';$('canonicalPatternDelete').style.display=item?'inline-block':'none';$('canonicalPatternSaveStatus').textContent='';$('canonicalPatternModal').classList.add('open');}
function closeCanonicalPatternEditor(){$('canonicalPatternModal').classList.remove('open');patternEditorTarget=null;}
$('canonicalPatternUseCurrent').onclick=()=>{const s=currentCanonicalSource();if(!s){$('canonicalPatternSaveStatus').textContent='Deschide un Branch sau selectează un NodeGroup.';return;}patternEditorTarget=s;$('canonicalPatternTargetSummary').textContent=sourceSummary(s);if(!$('canonicalPatternName').value)$('canonicalPatternName').value=s.label||'';};$('canonicalPatternClearTarget').onclick=()=>{patternEditorTarget=null;$('canonicalPatternTargetSummary').textContent='Nicio sursă.';};$('canonicalPatternClose').onclick=closeCanonicalPatternEditor;$('canonicalPatternCancel').onclick=closeCanonicalPatternEditor;$('canonicalPatternModal').querySelectorAll('[data-pattern-close]').forEach(x=>x.onclick=closeCanonicalPatternEditor);
$('canonicalPatternSave').onclick=async()=>{const cid=$('canonicalPatternId').value.trim();if(!cid){$('canonicalPatternSaveStatus').textContent='Pattern ID obligatoriu.';return;}const old=patternsById.get($('canonicalPatternRecordId').value);const item={id:$('canonicalPatternRecordId').value,revision:Number($('canonicalPatternRevision').value)||0,canonical_id:cid,name:$('canonicalPatternName').value.trim(),status:$('canonicalPatternStatus').value,tags:$('canonicalPatternTags').value.split(',').map(x=>x.trim()).filter(Boolean),description:$('canonicalPatternDescription').value.trim(),governance_note:$('canonicalPatternGovernance').value.trim(),source:patternEditorTarget||null,created_at:old?.created_at||null,updated_at:old?.updated_at||null};try{await savePatternLibraryItem(item);closeCanonicalPatternEditor();setPatternView('library');renderPatternLibrary();}catch(e){$('canonicalPatternSaveStatus').textContent=e.message;}};
$('canonicalPatternDelete').onclick=async()=>{const id=$('canonicalPatternRecordId').value;if(!patternsById.has(id)||!confirm('Ștergi pattern-ul?'))return;try{await deletePatternLibraryItem(id);closeCanonicalPatternEditor();renderPatternLibrary();}catch(e){$('canonicalPatternSaveStatus').textContent=e.message;}};
$('canonicalPatternBtn').onclick=()=>{const s=currentCanonicalSource();if(!s){showToast('Pentru Resource Model selectează un nod din NodeGroup.');return;}openCanonicalPatternEditor(null,s);};$('addCanonicalPatternBtn').onclick=()=>openCanonicalPatternEditor();
function patternUsage(p){const id=(p.canonical_id||'').toLowerCase();return{mappings:(mappingsStore.items||[]).filter(x=>(x.canonical_pattern_id||'').toLowerCase()===id).length,decisions:(decisionsStore.items||[]).filter(x=>(x.canonical_id||'').toLowerCase()===id).length};}
function filteredLibrary(){const q=$('librarySearch').value.trim().toLowerCase();return(patternsStore.items||[]).filter(x=>libraryFilter==='all'||x.status===libraryFilter).filter(x=>!q||[x.canonical_id,x.name,x.description,...(x.tags||[]),x.source?.label,x.source?.graph_name].join(' ').toLowerCase().includes(q)).sort((a,b)=>(a.canonical_id||'').localeCompare(b.canonical_id||''));}
function validation(severity,title,detail,action=null,label='Deschide'){return{severity,title,detail,action,label};}
function runLibraryValidation(){const out=[],patterns=patternsStore.items||[],ids=new Map();for(const p of patterns){const cid=(p.canonical_id||'').trim();const k=cid.toLowerCase();if(!ids.has(k))ids.set(k,[]);ids.get(k).push(p);if(p.status==='canonical'&&!p.source?.graphid)out.push(validation('error',`${cid} fără sursă structurală`,'Un pattern canonic trebuie legat de un Branch sau NodeGroup.',()=>openCanonicalPatternEditor(p),'Editează'));if(p.source?.graphid){const cur=currentSourceStructure(p.source);if(!cur)out.push(validation('error',`${cid}: sursă indisponibilă`,p.source.label||p.source.graph_name,()=>openCanonicalPatternEditor(p),'Editează'));else if(p.source.signature&&structureSig(cur)!==p.source.signature)out.push(validation('warning',`Drift structural: ${cid}`,'Structura Arches curentă diferă de snapshot-ul pattern-ului.',()=>openWorkspaceGraph(p.source.graphid),'Inspectează'));}}
for(const [cid,arr] of ids){if(cid&&arr.length>1)out.push(validation('error',`Pattern ID duplicat: ${arr[0].canonical_id}`,`${arr.length} înregistrări folosesc același ID.`,()=>openCanonicalPatternEditor(arr[0]),'Editează'));}
const known=new Set(patterns.filter(p=>p.status!=='rejected').map(p=>(p.canonical_id||'').toLowerCase()));for(const m of mappingsStore.items||[]){const pid=(m.canonical_pattern_id||'').trim();if(pid&&!known.has(pid.toLowerCase()))out.push(validation('warning',`Mapping către Pattern necunoscut: ${pid}`,m.field_id||'',()=>openMappingEditor(m),'Mapping'));if(m.status==='approved'&&!m.target?.nodeid)out.push(validation('error',`Mapping aprobat fără țintă: ${m.field_id}`,'Lipsește Graph/Node.',()=>openMappingEditor(m),'Editează'));}
return out;}
function renderPatternLibrary(){const items=patternsStore.items||[],count=s=>items.filter(x=>x.status===s).length;$('libraryStats').innerHTML=[['all','Total',items.length],['candidate','Candidați',count('candidate')],['canonical','Canonice',count('canonical')],['deprecated','Înlocuite',count('deprecated')],['rejected','Respinse',count('rejected')]].map(([s,l,c])=>`<div class="libraryStat${libraryFilter===s?' active':''}" data-library-filter="${s}"><div class="libraryStatValue">${c}</div><div class="libraryStatLabel">${l}</div></div>`).join('');$('libraryStats').querySelectorAll('[data-library-filter]').forEach(x=>x.onclick=()=>{libraryFilter=x.dataset.libraryFilter;$('libraryStatusFilter').value=libraryFilter;renderPatternLibrary();});validationIssues=runLibraryValidation();const ec=validationIssues.filter(x=>x.severity==='error').length,wc=validationIssues.filter(x=>x.severity==='warning').length;$('libraryValidationSummary').innerHTML=`<div class="validationSummaryBox"><b>Validare:</b>${ec?`<span class="validationSeverity validation-error">${ec} erori</span>`:''}${wc?`<span class="validationSeverity validation-warning">${wc} avertismente</span>`:''}${!validationIssues.length?'<span class="validationSeverity validation-ok">fără probleme detectate</span>':''}</div>`;const rows=filteredLibrary().map(p=>{const u=patternUsage(p),s=p.source||{};return`<tr><td><div class="patternIdCode">${esc(p.canonical_id||'')}</div><div class="patternNameCell">${esc(p.name||'')}</div></td><td><span class="patternStatusPill patternStatus-${esc(p.status)}">${esc(LIBRARY_STATUS[p.status]||p.status)}</span></td><td>${esc(s.label||'—')}<div class="patternMetaCell">${s.node_count||0} noduri · ${s.edge_count||0} muchii</div></td><td><span class="patternUsagePill">${u.mappings} mappings</span><span class="patternUsagePill">${u.decisions} decisions</span></td><td><div class="libraryActions">${s.graphid?`<button data-lib-open="${esc(p.id)}">Deschide</button>`:''}<button data-lib-edit="${esc(p.id)}">Editează</button></div></td></tr>`;}).join('');const table=`<div class="librarySection">${rows?`<table class="libraryTable"><thead><tr><th>Pattern</th><th>Status</th><th>Sursă</th><th>Utilizare</th><th></th></tr></thead><tbody>${rows}</tbody></table>`:'<div class="libraryEmpty">Niciun pattern.</div>'}</div>`;const issues=validationIssues.length?`<div class="librarySection"><h3 style="margin:0 0 8px">Validation report</h3>${validationIssues.map((i,n)=>`<div class="validationIssue"><div><span class="validationSeverity validation-${i.severity}">${i.severity}</span></div><div class="validationIssueTitle">${esc(i.title)}</div><div class="validationIssueDetail">${esc(i.detail)}</div><div>${i.action?`<button data-val="${n}">${i.label}</button>`:''}</div></div>`).join('')}</div>`:'';$('libraryScroll').innerHTML=table+issues;$('libraryScroll').querySelectorAll('[data-lib-edit]').forEach(b=>b.onclick=()=>openCanonicalPatternEditor(patternsById.get(b.dataset.libEdit)));$('libraryScroll').querySelectorAll('[data-lib-open]').forEach(b=>b.onclick=()=>openWorkspaceGraph(patternsById.get(b.dataset.libOpen).source.graphid));$('libraryScroll').querySelectorAll('[data-val]').forEach(b=>b.onclick=()=>validationIssues[Number(b.dataset.val)]?.action?.());}
function setPatternView(v){patternView=v==='library'?'library':'analysis';document.body.classList.toggle('patternLibraryActive',patternView==='library');$('patternAnalysisTab').classList.toggle('active',patternView==='analysis');$('patternLibraryTab').classList.toggle('active',patternView==='library');if(activeViewerMode==='patterns'){if(patternView==='library')renderPatternLibrary();else renderPatterns();}}
$('patternAnalysisTab').onclick=()=>setPatternView('analysis');$('patternLibraryTab').onclick=()=>setPatternView('library');$('runValidationBtn').onclick=()=>{setPatternView('library');renderPatternLibrary();showToast(`Validare: ${validationIssues.length} observații.`);};$('librarySearch').oninput=renderPatternLibrary;$('libraryStatusFilter').onchange=()=>{libraryFilter=$('libraryStatusFilter').value;renderPatternLibrary();};
const v19Enter=enterViewerMode;enterViewerMode=function(mode){v19Enter(mode);if(mode==='patterns')setTimeout(()=>setPatternView(patternView),0);else document.body.classList.remove('patternLibraryActive');};$('workspaceBtn').onclick=()=>enterViewerMode('workspace');$('graphBtn').onclick=()=>enterViewerMode('graph');$('patternsBtn').onclick=()=>enterViewerMode('patterns');$('decisionsBtn').onclick=()=>enterViewerMode('decisions');$('mappingsBtn').onclick=()=>enterViewerMode('mappings');setTimeout(()=>moveControlToSlot('canonicalPatternBtn','analysisToolsSlot'),240);
const oldFill=fillCanonicalPatternList;fillCanonicalPatternList=function(){const list=$('canonicalPatternList');if(!list)return;const ids=[...new Set([...(patternsStore.items||[]).filter(x=>x.status!=='rejected').map(x=>x.canonical_id),...(decisionsStore.items||[]).map(x=>x.canonical_id)].filter(Boolean))].sort();list.innerHTML=ids.map(id=>`<option value="${esc(id)}"></option>`).join('');};
function exportLibraryCsv(){const rows=[['Pattern ID','Name','Status','Tags','Description','Source type','Graph ID','Graph name','NodeGroup ID','Nodes','Edges','Mappings','Decisions','Revision']];for(const p of patternsStore.items||[]){const s=p.source||{},u=patternUsage(p);rows.push([p.canonical_id||'',p.name||'',LIBRARY_STATUS[p.status]||p.status,(p.tags||[]).join(', '),p.description||'',s.source_type||'',s.graphid||'',s.graph_name||'',s.nodegroupid||'',s.node_count||0,s.edge_count||0,u.mappings,u.decisions,p.revision||0]);}downloadCsv('ePatrimoniu_canonical_pattern_library.csv',rows);closeExportModal();}
function exportValidationCsv(){const rows=[['Severity','Title','Detail'],...runLibraryValidation().map(i=>[i.severity,i.title,i.detail])];downloadCsv('ePatrimoniu_validation_report.csv',rows);closeExportModal();}
const v19Export=openExportModal;openExportModal=function(){if(activeViewerMode==='patterns'&&patternView==='library'){$('exportTitle').textContent='Export Canonical Pattern Library';$('exportSubtitle').textContent='Bibliotecă + validare';$('exportOptions').innerHTML=exportOption('Canonical Pattern Library','Pattern-uri și utilizări.','CSV','libcsv')+exportOption('Validation report','Probleme de consistență detectate.','CSV','valcsv');$('exportOptions').querySelector('[data-export-action="libcsv"]').onclick=exportLibraryCsv;$('exportOptions').querySelector('[data-export-action="valcsv"]').onclick=exportValidationCsv;$('exportModal').classList.add('open');return;}return v19Export();};$('exportBtn').onclick=openExportModal;
loadPatternLibrary().then(()=>{fillCanonicalPatternList();});

/* ---- viewer script block ---- */
/* ================================================================
   v1.9.1 — contextual interaction layer
   ================================================================ */

function v191GraphModeActive(){
  return activeViewerMode==='graph';
}

function updateV191ModeClass(){
  document.body.classList.toggle('v191GraphMode',v191GraphModeActive());
  if(!v191GraphModeActive()){
    closeViewMenu();
    closeMoreMenu();
  }
}

/* ---------- Global ⋯ menu ---------- */

function positionMoreMenu(){
  const btn=$('moreBtn'), menu=$('moreMenu');
  if(!btn||!menu)return;
  const r=btn.getBoundingClientRect();
  const width=Math.max(menu.offsetWidth||210,210);
  const left=Math.min(window.innerWidth-width-10,Math.max(10,r.right-width));
  menu.style.left=`${left}px`;
  menu.style.top=`${r.bottom+7}px`;
}
function openMoreMenu(){
  const menu=$('moreMenu');
  menu.classList.add('open');
  menu.setAttribute('aria-hidden','false');
  requestAnimationFrame(positionMoreMenu);
}
function closeMoreMenu(){
  const menu=$('moreMenu');
  if(!menu)return;
  menu.classList.remove('open');
  menu.setAttribute('aria-hidden','true');
}
$('moreBtn').onclick=e=>{
  e.stopPropagation();
  $('moreMenu').classList.contains('open')?closeMoreMenu():openMoreMenu();
};

/* ---------- View menu ---------- */

function closeViewMenu(){
  const p=$('viewMenuPopup');
  if(!p)return;
  p.classList.remove('open');
  p.setAttribute('aria-hidden','true');
}
$('viewMenuBtn').onclick=e=>{
  e.stopPropagation();
  const p=$('viewMenuPopup');
  const opening=!p.classList.contains('open');
  closeMoreMenu();
  p.classList.toggle('open',opening);
  p.setAttribute('aria-hidden',opening?'false':'true');
};

document.addEventListener('click',e=>{
  if(!$('viewMenuPopup')?.contains(e.target)&&e.target!==$('viewMenuBtn'))closeViewMenu();
  if(!$('moreMenu')?.contains(e.target)&&e.target!==$('moreBtn'))closeMoreMenu();
});
window.addEventListener('resize',()=>{
  if($('moreMenu')?.classList.contains('open'))positionMoreMenu();
});

/* ---------- Reorganize existing controls ---------- */

function ensurePatternsLocalNav(){
  let nav=$('patternsLocalNav');
  if(!nav){
    nav=document.createElement('div');
    nav.id='patternsLocalNav';
    nav.className='patternsLocalNav';
    $('patternsOverview')?.appendChild(nav);
  }
  if($('patternAnalysisTab'))nav.appendChild($('patternAnalysisTab'));
  if($('patternLibraryTab'))nav.appendChild($('patternLibraryTab'));
}

function placeModuleActions(){
  const mappingTop=document.querySelector('.mappingsTop');
  if(mappingTop&&$('addMappingBtn')){
    $('addMappingBtn').classList.add('moduleTitleAction');
    $('addMappingBtn').textContent='+ Adaugă câmp';
    mappingTop.appendChild($('addMappingBtn'));
  }

  const libraryTop=document.querySelector('.libraryTop');
  if(libraryTop&&$('addCanonicalPatternBtn')){
    $('addCanonicalPatternBtn').classList.add('moduleTitleAction');
    $('addCanonicalPatternBtn').textContent='+ Adaugă pattern';
    libraryTop.appendChild($('addCanonicalPatternBtn'));
  }
}

function placeValidationAction(){
  const box=document.querySelector('#libraryValidationSummary .validationSummaryBox');
  if(box&&$('runValidationBtn')){
    $('runValidationBtn').textContent='Rulează din nou';
    box.appendChild($('runValidationBtn'));
  }
}

function organizeV191Controls(){
  /* Graph quick actions */
  if($('pathBtn'))$('quickAnalysisSlot')?.appendChild($('pathBtn'));
  if($('compareBtn'))$('quickAnalysisSlot')?.appendChild($('compareBtn'));

  /* View dropdown */
  if($('labelMode'))$('viewLabelSlot')?.appendChild($('labelMode'));
  if($('groupsBtn')){
    $('groupsBtn').textContent='NodeGroups';
    $('viewGroupsSlot')?.appendChild($('groupsBtn'));
  }
  if($('fitBtn')){
    $('fitBtn').textContent='Încadrează graful';
    $('viewFitSlot')?.appendChild($('fitBtn'));
  }

  /* Technical tools */
  if($('reloadBtn')){
    $('reloadBtn').textContent='Reîncarcă workspace';
    $('moreMenuActions')?.appendChild($('reloadBtn'));
  }
  if($('openBtn')){
    $('openBtn').classList.remove('graphOnly');
    $('openBtn').textContent='Deschide JSON…';
    $('moreMenuActions')?.appendChild($('openBtn'));
  }

  ensurePatternsLocalNav();
  placeModuleActions();
  placeValidationAction();

  /* Any old "Etichete" label that was moved to the legacy toolbar is redundant. */
  [...document.querySelectorAll('#visualToolsSlot label')].forEach(x=>x.style.display='none');

  updateV191ModeClass();
  updateActiveStateTray();
}

/* Old versions move controls on delayed timers; run after them and once more. */
setTimeout(organizeV191Controls,360);
setTimeout(organizeV191Controls,760);

/* ---------- Active canvas state chips ---------- */

function chipHtml(kind,label,text){
  return `<div class="activeStateChip ${kind}">
    <div class="activeStateChipText"><strong>${esc(label)}</strong>${text?` · ${esc(text)}`:''}</div>
    <button type="button" class="activeStateClose" data-state-close="${kind}" title="Închide">×</button>
  </div>`;
}

function compareChipText(){
  const option=$('historySelect')?.selectedOptions?.[0];
  if(option?.textContent){
    return option.textContent.split(' · ')[0];
  }
  return 'versiune anterioară';
}

function pathChipText(){
  if(pathMode&&!pathResult){
    if(pathStartId){
      const n=byId?.get(pathStartId);
      return `start: ${n?.name||n?.crm||shortId(pathStartId)}`;
    }
    return 'alege nodul de start';
  }
  if(pathResult){
    const a=byId?.get(pathStartId), b=byId?.get(pathEndId);
    const names=`${a?.name||a?.crm||'Start'} → ${b?.name||b?.crm||'Destinație'}`;
    return `${names} · ${pathResult.steps.length} relații`;
  }
  return '';
}

function updateActiveStateTray(){
  const tray=$('activeStateTray');
  if(!tray)return;

  const chips=[];

  if(focusActive&&selectedNodeId){
    const n=byId?.get(selectedNodeId);
    chips.push(chipHtml('focus','Focus',n?.name||n?.crm||shortId(selectedNodeId)));
  }

  if(pathMode||pathResult){
    chips.push(chipHtml('path','Traseu semantic',pathChipText()));
  }

  if(comparison){
    chips.push(chipHtml('compare','Comparare',compareChipText()));
  }

  tray.innerHTML=chips.join('');

  tray.querySelectorAll('[data-state-close]').forEach(btn=>{
    btn.onclick=e=>{
      e.stopPropagation();
      const kind=btn.dataset.stateClose;

      if(kind==='focus'){
        if(focusActive){
          const old=$('focusBtn').onclick;
          if(typeof old==='function')old.call($('focusBtn'),new Event('click'));
        }
      }else if(kind==='path'){
        clearSemanticPath(true);
      }else if(kind==='compare'){
        clearComparison(true);
      }

      setTimeout(()=>{
        updateActiveStateTray();
        renderInspectorActions();
      },0);
    };
  });
}

/* Focus can still be invoked programmatically by the inspector. */
const v191FocusClick=$('focusBtn').onclick;
$('focusBtn').onclick=function(e){
  const result=v191FocusClick?.call(this,e);
  setTimeout(()=>{
    updateActiveStateTray();
    renderInspectorActions();
  },0);
  return result;
};

/* Path button: update chip both during selection and after result. */
const v191PathClick=$('pathBtn').onclick;
$('pathBtn').onclick=function(e){
  const result=v191PathClick?.call(this,e);
  setTimeout(updateActiveStateTray,0);
  return result;
};

/* Final selectNode wrapper: contextual actions + path state. */
const v191SelectNode=selectNode;
selectNode=function(id,renderInspector=true){
  const result=v191SelectNode(id,renderInspector);
  setTimeout(()=>{
    updateActiveStateTray();
    if(renderInspector&&!pathResult)renderInspectorActions();
  },35);
  return result;
};

/* Compare: applying comparison collapses the setup panel into a canvas chip. */
const v191ApplySelectedComparison=applySelectedComparison;
applySelectedComparison=function(){
  const result=v191ApplySelectedComparison();
  if(comparison&&$('comparePanel'))$('comparePanel').style.display='none';
  setTimeout(updateActiveStateTray,0);
  return result;
};
$('applyCompare').onclick=applySelectedComparison;

const v191ClearComparison=clearComparison;
clearComparison=function(hidePanel=true){
  const result=v191ClearComparison(hidePanel);
  setTimeout(updateActiveStateTray,0);
  return result;
};

const v191ClearSemanticPath=clearSemanticPath;
clearSemanticPath=function(updateUi=true){
  const result=v191ClearSemanticPath(updateUi);
  setTimeout(updateActiveStateTray,0);
  return result;
};

$('graphSearch').addEventListener('input',()=>setTimeout(updateActiveStateTray,0));

/* ---------- Unified inspector actions ---------- */

function inspectorContext(){
  if(!G||!selectedNodeId)return null;
  const node=byId?.get(selectedNodeId);
  if(!node)return null;

  return {
    node,
    isBranch:!G.isresource,
    hasNodeGroup:!!node.nodegroup
  };
}

function renderInspectorActions(){
  const side=$('side');
  if(!side||activeViewerMode!=='graph'||pathResult)return;

  side.querySelector('.inspectorActions')?.remove();

  const ctx=inspectorContext();
  if(!ctx)return;

  /* A simple Resource Model node should not expose a graph-level Decision card. */
  if(G.isresource&&!ctx.hasNodeGroup){
    side.querySelectorAll('.decisionInspector').forEach(x=>x.remove());
  }

  const actions=[];

  if(!focusActive){
    actions.push({
      label:'Focus pe nod',
      run:()=>{$('focusBtn').click();}
    });
  }

  actions.push({
    label:'Mapare câmp',
    run:()=>graphMappingButton()
  });

  if(ctx.isBranch||ctx.hasNodeGroup){
    actions.push({
      label:'Decizie',
      run:()=>openDecisionEditor(currentDecisionTarget())
    });

    actions.push({
      label:'Pattern canonic',
      run:()=>{
        const source=currentCanonicalSource();
        if(!source){
          showToast('Nu există o sursă structurală validă pentru selecția curentă.');
          return;
        }
        openCanonicalPatternEditor(null,source);
      }
    });
  }

  if(!actions.length)return;

  const box=document.createElement('div');
  box.className='inspectorActions';
  box.innerHTML=`<div class="inspectorActionsTitle">Acțiuni</div><div class="inspectorActionGrid"></div>`;
  const grid=box.querySelector('.inspectorActionGrid');

  actions.forEach(action=>{
    const btn=document.createElement('button');
    btn.type='button';
    btn.textContent=action.label;
    btn.onclick=action.run;
    grid.appendChild(btn);
  });

  side.appendChild(box);
}

/* ---------- Pattern Library: validation action stays next to validation ---------- */

const v191RenderPatternLibrary=renderPatternLibrary;
renderPatternLibrary=function(){
  const result=v191RenderPatternLibrary();
  placeValidationAction();
  return result;
};

/* ---------- Mode controller ---------- */

const v191EnterViewerMode=enterViewerMode;
enterViewerMode=function(mode){
  const result=v191EnterViewerMode(mode);
  setTimeout(()=>{
    updateV191ModeClass();
    if(mode==='patterns'){
      ensurePatternsLocalNav();
      placeModuleActions();
      if(patternView==='library')placeValidationAction();
    }
    if(mode==='mappings')placeModuleActions();
    if(mode==='graph'){
      organizeV191Controls();
      updateActiveStateTray();
      setTimeout(renderInspectorActions,40);
    }
  },0);
  return result;
};

$('workspaceBtn').onclick=()=>enterViewerMode('workspace');
$('graphBtn').onclick=()=>enterViewerMode('graph');
$('patternsBtn').onclick=()=>enterViewerMode('patterns');
$('decisionsBtn').onclick=()=>enterViewerMode('decisions');
$('mappingsBtn').onclick=()=>enterViewerMode('mappings');

/* Graph changes reset several state variables in earlier layers. */
const v191OpenWorkspaceGraph=openWorkspaceGraph;
openWorkspaceGraph=function(graphid){
  const result=v191OpenWorkspaceGraph(graphid);
  setTimeout(()=>{
    updateV191ModeClass();
    updateActiveStateTray();
    renderInspectorActions();
  },80);
  return result;
};

/* Start clean. */
setTimeout(()=>{
  organizeV191Controls();
  updateV191ModeClass();
  updateActiveStateTray();
},900);

/* ---- viewer script block ---- */
/* v1.9.2 — semantic path prompt placement */

function ensurePathStateCloseButton(){
  const state=$('pathState');
  if(!state||state.style.display==='none')return;

  if(!state.querySelector('.pathStateClose')){
    const btn=document.createElement('button');
    btn.type='button';
    btn.className='pathStateClose';
    btn.title='Închide traseul semantic';
    btn.setAttribute('aria-label','Închide traseul semantic');
    btn.textContent='×';
    btn.onclick=e=>{
      e.stopPropagation();
      clearSemanticPath(true);
      updateActiveStateTray?.();
    };
    state.appendChild(btn);
  }
}

/* The legacy path workflow updates pathState.textContent.
   Re-attach the contextual close control after every such update. */
const pathStateObserver=new MutationObserver(()=>{
  queueMicrotask(ensurePathStateCloseButton);
});
if($('pathState')){
  pathStateObserver.observe($('pathState'),{
    childList:true,
    characterData:true,
    subtree:true,
    attributes:true,
    attributeFilter:['style']
  });
}

/* Override only the rendering of canvas state chips:
   path guidance is now exclusively under graph search. */
updateActiveStateTray=function(){
  const tray=$('activeStateTray');
  if(!tray)return;

  const chips=[];

  if(focusActive&&selectedNodeId){
    const n=byId?.get(selectedNodeId);
    chips.push(chipHtml('focus','Focus',n?.name||n?.crm||shortId(selectedNodeId)));
  }

  if(comparison){
    chips.push(chipHtml('compare','Comparare',compareChipText()));
  }

  tray.innerHTML=chips.join('');

  tray.querySelectorAll('[data-state-close]').forEach(btn=>{
    btn.onclick=e=>{
      e.stopPropagation();
      const kind=btn.dataset.stateClose;

      if(kind==='focus'){
        if(focusActive){
          const old=$('focusBtn').onclick;
          if(typeof old==='function')old.call($('focusBtn'),new Event('click'));
        }
      }else if(kind==='compare'){
        clearComparison(true);
      }

      setTimeout(()=>{
        updateActiveStateTray();
        renderInspectorActions();
      },0);
    };
  });

  ensurePathStateCloseButton();
};

/* Make sure an already active path is immediately represented correctly. */
setTimeout(()=>{
  updateActiveStateTray();
  ensurePathStateCloseButton();
},250);

/* ---- viewer script block ---- */
/* ================================================================
   v1.9.3 — contextual Actions dropdown
   ================================================================ */

function closeActionsMenu(){
  const popup=$('actionsMenuPopup');
  if(!popup)return;
  popup.classList.remove('open');
  popup.setAttribute('aria-hidden','true');
}

function actionsContext(){
  if(activeViewerMode!=='graph'||!G||!selectedNodeId)return null;
  const node=byId?.get(selectedNodeId);
  if(!node)return null;

  return {
    node,
    isBranch:!G.isresource,
    hasNodeGroup:!!node.nodegroup
  };
}

function currentActions(){
  const ctx=actionsContext();
  if(!ctx)return [];

  const actions=[];

  if(!focusActive){
    actions.push({
      label:'Focus pe nod',
      run:()=>{$('focusBtn').click();}
    });
  }

  actions.push({
    label:'Mapare câmp',
    run:()=>graphMappingButton()
  });

  if(ctx.isBranch||ctx.hasNodeGroup){
    actions.push({
      label:'Decizie',
      run:()=>openDecisionEditor(currentDecisionTarget())
    });

    actions.push({
      label:'Pattern canonic',
      run:()=>{
        const source=currentCanonicalSource();
        if(!source){
          showToast('Nu există o sursă structurală validă pentru selecția curentă.');
          return;
        }
        openCanonicalPatternEditor(null,source);
      }
    });
  }

  return actions;
}

function renderActionsMenu(){
  const btn=$('actionsMenuBtn');
  const box=$('actionsMenuItems');
  if(!btn||!box)return;

  const actions=currentActions();
  btn.disabled=!actions.length;

  if(!actions.length){
    box.innerHTML='<div class="actionsMenuEmpty">Selectează un nod pentru a vedea acțiunile disponibile.</div>';
    return;
  }

  box.innerHTML='';
  actions.forEach(action=>{
    const b=document.createElement('button');
    b.type='button';
    b.textContent=action.label;
    b.onclick=()=>{
      closeActionsMenu();
      action.run();
      setTimeout(()=>{
        renderActionsMenu();
        updateActiveStateTray?.();
      },0);
    };
    box.appendChild(b);
  });
}

function openActionsMenu(){
  renderActionsMenu();
  if($('actionsMenuBtn').disabled)return;

  closeViewMenu?.();
  closeMoreMenu?.();

  const popup=$('actionsMenuPopup');
  popup.classList.add('open');
  popup.setAttribute('aria-hidden','false');
}

$('actionsMenuBtn').onclick=e=>{
  e.stopPropagation();
  const popup=$('actionsMenuPopup');
  popup.classList.contains('open')?closeActionsMenu():openActionsMenu();
};

document.addEventListener('click',e=>{
  const popup=$('actionsMenuPopup');
  const btn=$('actionsMenuBtn');
  if(popup&&!popup.contains(e.target)&&e.target!==btn){
    closeActionsMenu();
  }
});

/* Keep popup below the path prompt when that prompt is visible. */
function updatePathPromptLayoutState(){
  const state=$('pathState');
  const visible=!!state && state.style.display!=='none' && state.offsetParent!==null;
  document.body.classList.toggle('pathPromptVisible',visible);
}

const v193PathObserver=new MutationObserver(()=>{
  queueMicrotask(updatePathPromptLayoutState);
});
if($('pathState')){
  v193PathObserver.observe($('pathState'),{
    attributes:true,
    attributeFilter:['style','class'],
    childList:true,
    subtree:true
  });
}
setTimeout(updatePathPromptLayoutState,50);

/* Remove the old action section from the inspector if an earlier layer
   inserts it, but retain all informational decision/mapping cards. */
function suppressInspectorActions(){
  $('side')?.querySelectorAll('.inspectorActions').forEach(x=>x.remove());
}

/* Refresh whenever node/context changes. */
const v193SelectNode=selectNode;
selectNode=function(id,renderInspector=true){
  const result=v193SelectNode(id,renderInspector);
  setTimeout(()=>{
    renderActionsMenu();
    suppressInspectorActions();
  },45);
  return result;
};

const v193EnterViewerMode=enterViewerMode;
enterViewerMode=function(mode){
  const result=v193EnterViewerMode(mode);
  setTimeout(()=>{
    if(mode==='graph'){
      renderActionsMenu();
      suppressInspectorActions();
    }else{
      closeActionsMenu();
    }
  },0);
  return result;
};

$('workspaceBtn').onclick=()=>enterViewerMode('workspace');
$('graphBtn').onclick=()=>enterViewerMode('graph');
$('patternsBtn').onclick=()=>enterViewerMode('patterns');
$('decisionsBtn').onclick=()=>enterViewerMode('decisions');
$('mappingsBtn').onclick=()=>enterViewerMode('mappings');

/* Focus state changes the available actions. */
const v193FocusClick=$('focusBtn').onclick;
$('focusBtn').onclick=function(e){
  const result=v193FocusClick?.call(this,e);
  setTimeout(()=>{
    renderActionsMenu();
    suppressInspectorActions();
  },0);
  return result;
};

/* Graph changes reset selection/context. */
const v193OpenWorkspaceGraph=openWorkspaceGraph;
openWorkspaceGraph=function(graphid){
  const result=v193OpenWorkspaceGraph(graphid);
  closeActionsMenu();
  setTimeout(()=>{
    renderActionsMenu();
    suppressInspectorActions();
  },100);
  return result;
};

/* Periodic safety refresh after delayed legacy renderers. */
setTimeout(()=>{
  renderActionsMenu();
  suppressInspectorActions();
  updatePathPromptLayoutState();
},500);
setTimeout(suppressInspectorActions,1000);

/* ---- viewer script block ---- */
/* ================================================================
   v1.10 — Collaboration Foundation + left contextual focus
   ================================================================ */

let collaborationState=null;
let auditState={total:0,events:[]};

const ROLE_LABELS={viewer:'Viewer',analyst:'Analyst',curator:'Curator',admin:'Admin'};
const PERMISSION_LABELS={
  'decisions.write':'Decision Register',
  'mappings.write':'Mapping Registry',
  'patterns.write':'Canonical Pattern Library',
  'collaboration.manage':'Administrare colaborare'
};

/* ---------- Focus under search ---------- */
function updateFocusStateV110(){
  const box=$('focusState');
  if(!box)return;

  if(!(activeViewerMode==='graph'&&focusActive&&selectedNodeId)){
    box.style.display='none';
    box.innerHTML='';
    positionActionsMenuV110();
    return;
  }

  const n=byId?.get(selectedNodeId);
  const label=n?.name||n?.crm||shortId(selectedNodeId);
  box.style.display='block';
  box.innerHTML=`<strong>Focus</strong> · ${esc(label)}<button type="button" class="focusStateClose" title="Închide Focus" aria-label="Închide Focus">×</button>`;
  box.querySelector('.focusStateClose').onclick=e=>{
    e.stopPropagation();
    if(focusActive)$('focusBtn').click();
    setTimeout(()=>{updateFocusStateV110();updateActiveStateTray();renderActionsMenu?.();},0);
  };
  positionActionsMenuV110();
}

/* Right tray is now comparison-only. */
updateActiveStateTray=function(){
  const tray=$('activeStateTray');
  if(!tray)return;
  const chips=[];
  if(comparison)chips.push(chipHtml('compare','Comparare',compareChipText()));
  tray.innerHTML=chips.join('');
  tray.querySelectorAll('[data-state-close="compare"]').forEach(btn=>{
    btn.onclick=e=>{e.stopPropagation();clearComparison(true);setTimeout(updateActiveStateTray,0);};
  });
  ensurePathStateCloseButton?.();
  updateFocusStateV110();
};

/* The Actions popup follows the actual height of search + Path + Focus. */
function positionActionsMenuV110(){
  const popup=$('actionsMenuPopup');
  const search=document.querySelector('.searchbox');
  if(!popup||!search)return;
  popup.style.left=`${search.offsetLeft}px`;
  popup.style.top=`${search.offsetTop+search.offsetHeight+8}px`;
}

openActionsMenu=function(){
  renderActionsMenu();
  if($('actionsMenuBtn').disabled)return;
  closeViewMenu?.();
  closeMoreMenu?.();
  const popup=$('actionsMenuPopup');
  popup.classList.add('open');
  popup.setAttribute('aria-hidden','false');
  requestAnimationFrame(positionActionsMenuV110);
};

const v110SearchStackObserver=new MutationObserver(()=>{
  queueMicrotask(()=>{
    updateFocusStateV110();
    if($('actionsMenuPopup')?.classList.contains('open'))positionActionsMenuV110();
  });
});
if(document.querySelector('.searchbox')){
  v110SearchStackObserver.observe(document.querySelector('.searchbox'),{childList:true,subtree:true,attributes:true,attributeFilter:['style','class']});
}
window.addEventListener('resize',()=>{if($('actionsMenuPopup')?.classList.contains('open'))positionActionsMenuV110();});

/* ---------- Collaboration state ---------- */
function collaborationAvailable(){return syncApiAvailable();}

function updateCollabMenuMeta(){
  const meta=$('collabMenuMeta');
  if(!meta)return;
  if(!collaborationState?.actor){meta.textContent='Colaborare locală · neinițializată';return;}
  meta.textContent=`${collaborationState.actor.display_name||'Utilizator'} · ${ROLE_LABELS[collaborationState.actor.role]||collaborationState.actor.role}`;
}

async function loadCollaboration(){
  if(!collaborationAvailable())return null;
  try{
    const r=await window.epApiFetch('/api/collaboration');
    const d=await r.json();
    if(!r.ok||!d.ok)throw new Error(d.error||'Collaboration unavailable.');
    collaborationState=d;
    updateCollabMenuMeta();
    return d;
  }catch(e){console.warn('Collaboration:',e);return null;}
}

function renderCollabProfile(){
  const s=collaborationState;
  if(!s)return;
  $('collabWorkspaceName').value=s.workspace?.name||'';
  $('collabDisplayName').value=s.actor?.display_name||'';
  $('collabRole').value=s.actor?.role||'viewer';
  $('collabWorkspaceId').textContent=s.workspace?.workspace_id||'—';
  $('collabActorId').textContent=s.actor?.actor_id||'—';
  const p=(s.permissions||[]).map(x=>PERMISSION_LABELS[x]||x);
  $('collabPermissions').textContent=p.length?p.join(' · '):'doar citire';
}

function setCollabTab(tab){
  const audit=tab==='audit';
  $('collabProfileTab').classList.toggle('active',!audit);
  $('collabAuditTab').classList.toggle('active',audit);
  $('collabProfilePane').classList.toggle('active',!audit);
  $('collabAuditPane').classList.toggle('active',audit);
  if(audit)loadAudit();
}

async function openCollaborationModal(tab='profile'){
  closeMoreMenu?.();
  await loadCollaboration();
  if(!collaborationState){showToast('Serviciul local de colaborare nu este disponibil.');return;}
  renderCollabProfile();
  $('collaborationStatus').textContent='';
  $('collaborationModal').classList.add('open');
  $('collaborationModal').setAttribute('aria-hidden','false');
  setCollabTab(tab);
}

function closeCollaborationModal(){
  $('collaborationModal').classList.remove('open');
  $('collaborationModal').setAttribute('aria-hidden','true');
}

async function saveCollaborationProfile(){
  $('collaborationSave').disabled=true;
  $('collaborationStatus').textContent='Salvez…';
  try{
    const r=await window.epApiFetch('/api/collaboration',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        workspace_name:$('collabWorkspaceName').value.trim(),
        display_name:$('collabDisplayName').value.trim(),
        role:$('collabRole').value
      })
    });
    const d=await r.json();
    if(!r.ok||!d.ok)throw new Error(d.error||'Salvare eșuată.');
    collaborationState=d;
    renderCollabProfile();updateCollabMenuMeta();
    $('collaborationStatus').textContent='Salvat. Rolul este aplicat imediat operațiilor de scriere.';
  }catch(e){$('collaborationStatus').textContent=e.message;}
  finally{$('collaborationSave').disabled=false;}
}

async function loadAudit(){
  $('auditList').innerHTML='<div class="auditEmpty">Încarc audit trail…</div>';
  try{
    const r=await window.epApiFetch('/api/audit');
    const d=await r.json();
    if(!r.ok||!d.ok)throw new Error(d.error||'Audit unavailable.');
    auditState=d;
    renderAudit();
  }catch(e){$('auditList').innerHTML=`<div class="auditEmpty">${esc(e.message)}</div>`;}
}

function renderAudit(){
  const events=auditState.events||[];
  $('auditSummary').textContent=`${auditState.total||events.length} evenimente · ultimele ${events.length} afișate`;
  if(!events.length){$('auditList').innerHTML='<div class="auditEmpty">Nu există încă evenimente de audit.</div>';return;}
  $('auditList').innerHTML=events.map(ev=>`<div class="auditRow">
    <div class="auditWhen">${esc(ev.timestamp?new Date(ev.timestamp).toLocaleString('ro-RO'):'—')}</div>
    <div class="auditActor">${esc(ev.actor_name||ev.actor_id||'—')}<br><span style="font-weight:400;color:#7a8492">${esc(ROLE_LABELS[ev.role]||ev.role||'')}</span></div>
    <div class="auditEntity">${esc(ev.action||'')} · ${esc(ev.entity_type||'')}<br><code>${esc(ev.entity_id||'')}</code></div>
    <div class="auditSummaryText">${esc(ev.summary||'—')}${ev.revision?`<br><span style="color:#8a93a4">rev. ${esc(ev.revision)}</span>`:''}</div>
  </div>`).join('');
}

function exportAudit(){
  const rows=[['Timestamp','Actor ID','Actor','Role','Entity type','Entity ID','Action','Revision','Summary','Workspace ID']];
  for(const ev of auditState.events||[])rows.push([ev.timestamp||'',ev.actor_id||'',ev.actor_name||'',ev.role||'',ev.entity_type||'',ev.entity_id||'',ev.action||'',ev.revision||0,ev.summary||'',ev.workspace_id||'']);
  downloadCsv('ePatrimoniu_audit_trail.csv',rows);
}

$('collaborationBtn').onclick=()=>openCollaborationModal('profile');
$('collaborationClose').onclick=closeCollaborationModal;
$('collaborationCancel').onclick=closeCollaborationModal;
$('collaborationSave').onclick=saveCollaborationProfile;
$('collabProfileTab').onclick=()=>setCollabTab('profile');
$('collabAuditTab').onclick=()=>setCollabTab('audit');
$('auditRefresh').onclick=loadAudit;
$('auditExport').onclick=exportAudit;
$('collaborationModal').querySelectorAll('[data-collab-close]').forEach(x=>x.onclick=closeCollaborationModal);

/* Refresh contextual focus and collaboration metadata after delayed legacy layers. */
setTimeout(()=>{loadCollaboration();updateFocusStateV110();updateActiveStateTray();},450);
setTimeout(()=>{updateFocusStateV110();if($('actionsMenuPopup')?.classList.contains('open'))positionActionsMenuV110();},900);

/* ---- viewer script block ---- */
/* ================================================================
   v1.10.1 — left contextual stack + Focus freeze fix
   ================================================================ */

/*
  v1.10 observed .searchbox subtree mutations, while updateFocusStateV110()
  rewrote #focusState inside that same subtree. Activating Focus could
  therefore schedule updateFocusStateV110() indefinitely.
*/
try{
  if(typeof v110SearchStackObserver!=='undefined'){
    v110SearchStackObserver.disconnect();
  }
}catch(_){}

/* Anchor the contextual stack to the ACTUAL bottom of the search box. */
function positionLeftContextStackV1101(){
  const stack=$('leftContextStack');
  const search=document.querySelector('.searchbox');
  const canvas=$('canvasWrap');
  if(!stack||!search||!canvas)return;

  const sr=search.getBoundingClientRect();
  const cr=canvas.getBoundingClientRect();

  stack.style.left=`${Math.round(sr.left-cr.left)}px`;
  stack.style.top=`${Math.round(sr.bottom-cr.top+8)}px`;
  stack.style.width=`${Math.round(sr.width)}px`;
}

/*
  Actions no longer computes its own absolute Y. It simply opens as the
  next item in the stack after Path and Focus.
*/
positionActionsMenuV110=function(){
  positionLeftContextStackV1101();
};

openActionsMenu=function(){
  renderActionsMenu();
  if($('actionsMenuBtn').disabled)return;

  closeViewMenu?.();
  closeMoreMenu?.();

  const popup=$('actionsMenuPopup');
  popup.classList.add('open');
  popup.setAttribute('aria-hidden','false');

  positionLeftContextStackV1101();
};

/* Keep Focus rendering idempotent and outside the observed search node. */
const v1101UpdateFocusState=updateFocusStateV110;
updateFocusStateV110=function(){
  const box=$('focusState');
  if(!box)return;

  if(!(activeViewerMode==='graph'&&focusActive&&selectedNodeId)){
    if(box.style.display!=='none')box.style.display='none';
    if(box.innerHTML)box.innerHTML='';
    positionLeftContextStackV1101();
    return;
  }

  const n=byId?.get(selectedNodeId);
  const label=n?.name||n?.crm||shortId(selectedNodeId);
  const safeLabel=esc(label);
  const wanted=`<strong>Focus</strong> · ${safeLabel}<button type="button" class="focusStateClose" title="Închide Focus" aria-label="Închide Focus">×</button>`;

  if(box.style.display!=='block')box.style.display='block';
  if(box.innerHTML!==wanted)box.innerHTML=wanted;

  const close=box.querySelector('.focusStateClose');
  if(close){
    close.onclick=e=>{
      e.stopPropagation();
      if(focusActive)$('focusBtn').click();
      setTimeout(()=>{
        updateFocusStateV110();
        updateActiveStateTray();
        renderActionsMenu?.();
        positionLeftContextStackV1101();
      },0);
    };
  }

  positionLeftContextStackV1101();
};

/* Path visibility/content can change independently; just reposition stack. */
const pathForStack=$('pathState');
if(pathForStack){
  const v1101PathObserver=new MutationObserver(()=>{
    requestAnimationFrame(positionLeftContextStackV1101);
  });
  v1101PathObserver.observe(pathForStack,{
    attributes:true,
    attributeFilter:['style','class'],
    childList:true,
    characterData:true,
    subtree:true
  });
}

/* Focus is outside search now; observe visibility only for layout, not updates. */
const focusForStack=$('focusState');
if(focusForStack){
  const v1101FocusLayoutObserver=new MutationObserver(()=>{
    requestAnimationFrame(positionLeftContextStackV1101);
  });
  v1101FocusLayoutObserver.observe(focusForStack,{
    attributes:true,
    attributeFilter:['style','class']
  });
}

/* Resize / panel changes can alter canvas coordinates. */
window.addEventListener('resize',positionLeftContextStackV1101);
$('toggleLeftPanel')?.addEventListener('click',()=>setTimeout(positionLeftContextStackV1101,40));
$('toggleRightPanel')?.addEventListener('click',()=>setTimeout(positionLeftContextStackV1101,40));

/* Close menus normally, but never let search cover them. */
const v1101SelectNode=selectNode;
selectNode=function(id,renderInspector=true){
  const result=v1101SelectNode(id,renderInspector);
  setTimeout(positionLeftContextStackV1101,0);
  return result;
};

const v1101EnterViewerMode=enterViewerMode;
enterViewerMode=function(mode){
  const result=v1101EnterViewerMode(mode);
  setTimeout(()=>{
    positionLeftContextStackV1101();
    if(mode!=='graph')closeActionsMenu?.();
  },0);
  return result;
};

$('workspaceBtn').onclick=()=>enterViewerMode('workspace');
$('graphBtn').onclick=()=>enterViewerMode('graph');
$('patternsBtn').onclick=()=>enterViewerMode('patterns');
$('decisionsBtn').onclick=()=>enterViewerMode('decisions');
$('mappingsBtn').onclick=()=>enterViewerMode('mappings');

setTimeout(()=>{
  updateFocusStateV110();
  positionLeftContextStackV1101();
},120);
setTimeout(positionLeftContextStackV1101,650);

