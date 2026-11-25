{
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const NONE='__none';
const COLORS=['#ff3d9a','#00a99f','#6a2cff','#ff8a00','#1fa2ff','#e0a800','#e5285b','#22b455'];
const slug=s=>s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60)||'x';
const CFG=window.FLOATMATCH_CONFIG||{};
const ls={get(k){try{return localStorage.getItem(k)}catch{return null}},set(k,v){try{localStorage.setItem(k,v)}catch{}},del(k){try{localStorage.removeItem(k)}catch{}}};

/* Supabase REST */
async function api(path,opts={}){
  const r=await fetch(CFG.url+'/rest/v1/'+path,{...opts,headers:{apikey:CFG.anonKey,...(CFG.anonKey.startsWith('sb_')?{}:{Authorization:'Bearer '+CFG.anonKey}),'Content-Type':'application/json',...(opts.headers||{})}});
  const txt=await r.text();let body=null;try{body=txt?JSON.parse(txt):null}catch{body=txt}
  if(!r.ok)throw new Error((body&&body.message)||('HTTP '+r.status));
  return body;
}
const rpc=(fn,args)=>api('rpc/'+fn,{method:'POST',body:JSON.stringify(args)});

let token=ls.get('fm-token');
if(!token){const a=new Uint8Array(18);crypto.getRandomValues(a);token=Array.from(a,b=>b.toString(16).padStart(2,'0')).join('');ls.set('fm-token',token)}
let me=ls.get('fm-id'),hostPin=ls.get('fm-pin'),isHost=false;
let game={performers:[],floats:[],reveals:{},locked:false},cards=[],gameLoaded=false,online=true;
let target={name:'',picks:{}},dirty=false,submitted=null;
let drag=null,sel=null,lastSet={},pending=false;

const floatName=id=>id===NONE?'Not on a float':(game.floats.find(f=>f.id===id)?.name||'a float no longer listed');
const score=c=>game.performers.reduce((n,p)=>n+(game.reveals[p.id]&&c.picks&&c.picks[p.id]===game.reveals[p.id].f?1:0),0);
const revealed=()=>game.performers.filter(p=>game.reveals[p.id]).length;
const allFloats=()=>[...game.floats,{id:NONE,name:'Not on a float (stage or street)'}];
function norm(d){return{performers:Array.isArray(d.performers)?d.performers.filter(p=>p&&p.id):[],floats:Array.isArray(d.floats)?d.floats.filter(f=>f&&f.id):[],reveals:d.reveals&&typeof d.reveals==='object'?d.reveals:{},locked:!!d.locked}}

/* the two boards share one component */
const B={
  card:{get:()=>target.picks,editable:()=>cardEditable(),results:true,
    set(p,f){if(f)target.picks[p]=f;else delete target.picks[p];dirty=true;saveDraft();renderCard()}},
  host:{get:()=>Object.fromEntries(Object.entries(game.reveals).map(([k,v])=>[k,v.f])),editable:()=>isHost,results:false,
    set(p,f){if(f)game.reveals[p]={f,t:Date.now()};else delete game.reveals[p];saveGame();renderAll()}}
};
function boardHTML(b){
  const picks=B[b].get(),ed=B[b].editable();
  const counts={};for(const k in picks)counts[picks[k]]=(counts[picks[k]]||0)+1;
  const stars=game.performers.map((p,i)=>{let res='';const r=game.reveals[p.id],pk=picks[p.id];
    if(B[b].results&&r&&pk)res=pk===r.f?'<span class="res ok">✓ Nailed it</span>':`<span class="res bad">✗ Rode ${esc(floatName(r.f))}</span>`;
    else if(B[b].results&&r)res=`<span class="res bad">Rode ${esc(floatName(r.f))}</span>`;
    return `<div class="chip star${sel&&sel.b===b&&sel.p===p.id?' sel':''}" data-p="${esc(p.id)}" style="--c:${COLORS[i%COLORS.length]}">${esc(p.name)}${res}
      <button class="knob" data-p="${esc(p.id)}" aria-label="Connect ${esc(p.name)} to a float"${ed?'':' disabled'}></button></div>`}).join('');
  const floats=allFloats().map(f=>`<div class="chip float${f.id===NONE?' none':''}${counts[f.id]?' on':''}" data-f="${esc(f.id)}"><span class="sock"></span>${esc(f.name)}${counts[f.id]?`<span class="cnt">${counts[f.id]}</span>`:''}</div>`).join('');
  return `<div class="board${ed?'':' ro'}" data-b="${b}"><svg class="wires" aria-hidden="true"><g></g><path class="under tmpu" d=""/><path class="wire tmp" d=""/></svg>
    <div class="col stars">${stars}</div><div class="col floats">${floats}</div></div>`;
}
const curve=(x1,y1,x2,y2)=>{const dx=Math.max(26,Math.abs(x2-x1)*.55);return `M${x1} ${y1}C${x1+dx} ${y1} ${x2-dx} ${y2} ${x2} ${y2}`};
const mid=(el,R)=>{const a=el.getBoundingClientRect();return[a.left+a.width/2-R.left,a.top+a.height/2-R.top]};
function drawWires(b){
  const el=document.querySelector(`.board[data-b="${b}"]`);if(!el||!el.offsetParent)return;
  const R=el.getBoundingClientRect(),picks=B[b].get();let out='';
  game.performers.forEach((p,i)=>{const f=picks[p.id];if(!f)return;
    const k=el.querySelector(`.knob[data-p="${CSS.escape(p.id)}"]`),s=el.querySelector(`.float[data-f="${CSS.escape(f)}"] .sock`);if(!k||!s)return;
    const[x1,y1]=mid(k,R),[x2,y2]=mid(s,R),d=curve(x1,y1,x2,y2);
    const r=B[b].results&&game.reveals[p.id],wrong=r&&r.f!==f,fresh=lastSet.b===b&&lastSet.p===p.id;
    out+=`<path class="under" d="${d}"/><path class="wire${wrong?' wrong':''}${fresh?' fresh':''}"${fresh?' pathLength="1"':''} stroke="${COLORS[i%COLORS.length]}" d="${d}"/>`});
  el.querySelector('.wires g').innerHTML=out;
}
const drawAll=()=>requestAnimationFrame(()=>{drawWires('card');drawWires('host')});
new ResizeObserver(drawAll).observe(document.body);

/* drawing with a finger or mouse */
function hitFloat(b,x,y){const el=document.elementFromPoint(x,y)?.closest('.float');return el&&el.closest('.board')?.dataset.b===b?el:null}
document.addEventListener('pointerdown',e=>{
  const k=e.target.closest('.knob');if(!k)return;const bd=k.closest('.board'),b=bd.dataset.b;
  if(!B[b].editable())return;e.preventDefault();k.setPointerCapture(e.pointerId);
  drag={b,p:k.dataset.p,k,bd,x:e.clientX,y:e.clientY,x0:e.clientX,y0:e.clientY,moved:false,hot:null,raf:0};
  bd.querySelector('.tmp').setAttribute('stroke',k.parentElement.style.getPropertyValue('--c'));
  const loop=()=>{if(!drag)return;
    if(drag.moved){if(drag.y<56)scrollBy(0,-Math.ceil((56-drag.y)/4));else if(drag.y>innerHeight-56)scrollBy(0,Math.ceil((drag.y-innerHeight+56)/4));
      const R=drag.bd.getBoundingClientRect(),[x1,y1]=mid(drag.k,R),d=curve(x1,y1,drag.x-R.left,drag.y-R.top);
      drag.bd.querySelector('.tmp').setAttribute('d',d);drag.bd.querySelector('.tmpu').setAttribute('d',d);
      const h=hitFloat(drag.b,drag.x,drag.y);if(h!==drag.hot){drag.hot?.classList.remove('hot');h?.classList.add('hot');drag.hot=h}}
    drag.raf=requestAnimationFrame(loop)};
  drag.raf=requestAnimationFrame(loop);
});
document.addEventListener('pointermove',e=>{if(!drag)return;drag.x=e.clientX;drag.y=e.clientY;if(Math.hypot(drag.x-drag.x0,drag.y-drag.y0)>8)drag.moved=true});
function endDrag(e,cancel){
  if(!drag)return;const d=drag;drag=null;cancelAnimationFrame(d.raf);d.hot?.classList.remove('hot');
  d.bd.querySelector('.tmp').setAttribute('d','');d.bd.querySelector('.tmpu').setAttribute('d','');
  pending=false;
  if(!cancel&&d.moved){const h=hitFloat(d.b,e.clientX,e.clientY);if(h){link(d.b,d.p,h.dataset.f);return}}
  else if(!cancel){pick(d.b,d.p);return}
  renderAll();
}
document.addEventListener('pointerup',e=>endDrag(e,false));
document.addEventListener('pointercancel',e=>endDrag(e,true));
function link(b,p,f){sel=null;hideToast();lastSet={b,p};try{navigator.vibrate?.(12)}catch{}B[b].set(p,f);setTimeout(()=>{if(lastSet.p===p)lastSet={}},700)}
function pick(b,p){if(!B[b].editable())return;
  if(sel&&sel.b===b&&sel.p===p){sel=null;hideToast()}
  else{sel={b,p};const name=game.performers.find(x=>x.id===p)?.name||'';$('#toastmsg').textContent=`Now tap a float for ${name}`;$('#tclear').hidden=!B[b].get()[p];$('#toast').hidden=false}
  renderAll()}
document.addEventListener('click',e=>{
  if(e.target.closest('.knob'))return;
  const st=e.target.closest('.star');if(st){pick(st.closest('.board').dataset.b,st.dataset.p);return}
  const fl=e.target.closest('.float');if(fl&&sel&&fl.closest('.board').dataset.b===sel.b)link(sel.b,sel.p,fl.dataset.f);
});
const hideToast=()=>{$('#toast').hidden=true};
$('#tcancel').addEventListener('click',()=>{sel=null;hideToast();renderAll()});
$('#tclear').addEventListener('click',()=>{if(!sel)return;const s=sel;sel=null;hideToast();B[s.b].set(s.p,null)});

/* tabs */
function show(tab){if(!['card','board','host'].includes(tab))tab='card';
  $('#t-host').hidden=!(isHost||tab==='host');
  for(const b of document.querySelectorAll('nav button'))b.setAttribute('aria-selected',b.dataset.tab===tab);
  for(const s of ['card','board','host'])$('#'+s).hidden=s!==tab;sel=null;hideToast();drawAll()}
for(const b of document.querySelectorAll('nav button'))b.addEventListener('click',()=>{location.hash=b.dataset.tab});
addEventListener('hashchange',()=>show(location.hash.slice(1)));

/* scorecard */
function loadDraft(){try{const d=JSON.parse(ls.get('fm-draft')||'null');if(d&&typeof d==='object'){target.name=String(d.name||'');target.picks=d.picks&&typeof d.picks==='object'?{...d.picks}:{};dirty=true}}catch{}}
const saveDraft=()=>ls.set('fm-draft',JSON.stringify(target));
function cardEditable(){return gameLoaded&&!game.locked}
const setStat=t=>{$('#savestat').textContent=t};
const valid=()=>game.performers.filter(p=>target.picks[p.id]);
function same(){if(!submitted)return false;if((submitted.name||'')!==target.name.trim())return false;
  return game.performers.every(p=>(submitted.picks||{})[p.id]===target.picks[p.id])}
function renderCard(){
  let m='';
  if(!gameLoaded)m='<p class="note">Loading the lineup…</p>';
  else if(!game.performers.length)m='<div class="banner">The host hasn\'t posted the lineup yet. Check back soon.</div>';
  else if(game.locked)m=submitted?'<div class="banner">Picks are locked in. The parade is on, so keep an eye on the high scores.</div>':'<div class="banner">Picks are closed. The parade already started, but you can still follow the high scores.</div>';
  $('#cardmsg').innerHTML=m;
  const ed=cardEditable();
  if(document.activeElement!==$('#nm'))$('#nm').value=target.name||'';
  $('#nm').disabled=!ed;
  $('#cardboard').innerHTML=game.performers.length?boardHTML('card'):'';
  const tot=game.performers.length,n=valid().length,named=!!target.name.trim(),btn=$('#submit');
  $('#progtxt').textContent=`${n} / ${tot}`;$('#progbar').style.width=tot?(n/tot*100)+'%':'0';
  btn.classList.remove('done');
  if(!ed){btn.disabled=true;btn.textContent=submitted?'Picks submitted ✓':(gameLoaded?'Submissions closed':'Loading…')}
  else if(submitted&&same()){btn.disabled=true;btn.classList.add('done');btn.textContent='Picks submitted ✓'}
  else if(n<tot){btn.disabled=true;btn.textContent=`Match ${tot-n} more to submit`}
  else if(!named){btn.disabled=true;btn.textContent='Add your name to submit'}
  else{btn.disabled=false;btn.textContent=submitted?'Resubmit my picks':'Submit my picks'}
  if(!$('#savestat').dataset.hold){
    if(submitted&&same())setStat(game.locked?'You\'re locked in. Good luck!':'You\'re in! You can change picks and resubmit until the parade starts.');
    else if(submitted)setStat('You have changes that aren\'t submitted yet.');
    else setStat('');
  }
  drawAll();
}
$('#nm').addEventListener('input',e=>{target.name=e.target.value;dirty=true;saveDraft();renderCard()});
$('#submit').addEventListener('click',async()=>{
  const name=target.name.trim(),st=$('#savestat'),btn=$('#submit');
  if(!name||valid().length<game.performers.length||!cardEditable())return;
  const picks={};for(const p of game.performers)picks[p.id]=target.picks[p.id];
  btn.disabled=true;btn.textContent='Submitting…';st.dataset.hold='1';
  try{const id=await rpc('submit_card',{p_token:token,p_name:name,p_picks:picks});
    me=String(id);ls.set('fm-id',me);submitted={name,picks};dirty=false;ls.del('fm-draft');delete st.dataset.hold;
    await refresh();renderCard();try{navigator.vibrate?.([20,40,20])}catch{}}
  catch(e){delete st.dataset.hold;renderCard();setStat(/locked/i.test(e.message)?'Picks are locked. The parade already started.':'Couldn\'t submit. Check your connection and try again.')}
});
function syncMine(){const c=me&&cards.find(x=>x.id===me);submitted=c?{name:c.name||'',picks:{...(c.picks||{})}}:null;
  if(!dirty&&c){target.name=c.name||'';target.picks={...(c.picks||{})}}}

/* high scores */
function renderBoard(){
  const n=revealed(),tot=game.performers.length;
  $('#revcount').textContent=tot?`${n} of ${tot} stars revealed`:'Waiting for the lineup.';
  const rows=cards.filter(c=>c.name).map(c=>({c,s:score(c)})).sort((a,b)=>b.s-a.s||a.c.name.localeCompare(b.c.name));
  if(!rows.length)$('#lb').innerHTML='<li class="small">Nobody has submitted yet. Be the first.</li>';
  else{const max=Math.max(1,n);let rank=0,prev=-1;
    $('#lb').innerHTML=rows.map((r,i)=>{if(r.s!==prev){rank=i+1;prev=r.s}
      const canSee=game.locked||isHost||r.c.id===me;
      const picks=canSee?game.performers.filter(p=>r.c.picks&&r.c.picks[p.id]).map(p=>{const rv=game.reveals[p.id];return `<div>${esc(p.name)}: ${esc(floatName(r.c.picks[p.id]))}${rv?(r.c.picks[p.id]===rv.f?' ✓':' ✗'):''}</div>`}).join(''):'';
      return `<li class="${rank===1&&r.s>0?'top':''}"><div class="hsr"><span class="rank">${rank}</span><span class="who">${esc(r.c.name)}${r.c.id===me?' (you)':''}</span><span class="pts">${r.s}</span>
        <div class="meter"><i style="width:${(r.s/max*100).toFixed(1)}%"></i></div>${picks?`<details><summary>See picks</summary>${picks}</details>`:''}</div></li>`}).join('')}
  const feed=game.performers.filter(p=>game.reveals[p.id]).sort((a,b)=>(game.reveals[b.id].t||0)-(game.reveals[a.id].t||0));
  $('#feed').innerHTML=feed.length?feed.map(p=>{const f=game.reveals[p.id].f,hits=cards.filter(c=>c.name&&c.picks&&c.picks[p.id]===f).map(c=>c.name);
    return `<li><strong>${esc(p.name)}</strong> rode <strong>${esc(floatName(f))}</strong><div class="small">${hits.length?'Got it: '+esc(hits.join(', ')):'Nobody got this one'}</div></li>`}).join(''):'<li class="small">Nothing revealed yet. Reveals pop up here during the parade.</li>';
}

/* host */
let gameChain=Promise.resolve(),hostEditing=0;
function saveGame(stat){const body=JSON.parse(JSON.stringify(game));hostEditing++;
  gameChain=gameChain.then(()=>rpc('host_save',{p_pin:hostPin,p_game:body})).then(()=>{if(stat)stat.textContent='Saved.'})
  .catch(()=>{(stat||$('#liststat')).textContent='Couldn\'t save. Try again.'}).finally(()=>{hostEditing--})}
function renderHost(){
  $('#pinbox').hidden=isHost;$('#hostbody').hidden=!isHost;
  if(!isHost)return;
  $('#lock').textContent=game.locked?'Unlock scorecards':'Lock scorecards now';
  $('#hostboard').innerHTML=game.performers.length?boardHTML('host'):'<p class="small">Add stars below first.</p>';
  if(document.activeElement!==$('#perfs'))$('#perfs').value=game.performers.map(p=>p.name).join('\n');
  if(document.activeElement!==$('#floats'))$('#floats').value=game.floats.map(f=>f.name).join('\n');
  $('#cardlist').innerHTML=cards.length?cards.map(c=>`<li style="display:flex;justify-content:space-between;align-items:center;gap:8px"><span>${esc(c.name||'Unnamed')} <span class="small">${score(c)} pts</span></span><button class="x" data-del="${esc(c.id)}">Remove</button></li>`).join(''):'<li class="small">No cards yet.</li>';
  drawAll();
}
$('#pinform').addEventListener('submit',async e=>{e.preventDefault();const pin=$('#pin').value.trim();if(!pin)return;
  $('#pinstat').textContent='Checking…';
  try{if(await rpc('host_check',{p_pin:pin})){hostPin=pin;isHost=true;ls.set('fm-pin',pin);$('#pinstat').textContent='';renderAll();show('host')}
    else $('#pinstat').textContent='That PIN didn\'t work.'}catch{$('#pinstat').textContent='Couldn\'t check right now. Try again.'}});
$('#lock').addEventListener('click',()=>{game.locked=!game.locked;saveGame();renderAll()});
function parseList(txt,old){const seen=new Set();return txt.split('\n').map(s=>s.trim()).filter(Boolean).map(name=>{
  const ex=old.find(o=>o.name===name);let id=ex?ex.id:slug(name);while(seen.has(id))id+='-2';seen.add(id);return{id,name}})}
$('#savelists').addEventListener('click',()=>{game.performers=parseList($('#perfs').value,game.performers);game.floats=parseList($('#floats').value,game.floats);
  $('#liststat').textContent='Saving…';saveGame($('#liststat'));renderAll()});
$('#cardlist').addEventListener('click',async e=>{const id=e.target.dataset.del;if(!id)return;
  if(e.target.dataset.sure!=='1'){e.target.dataset.sure='1';e.target.textContent='Tap again to remove';return}
  try{await rpc('host_delete_card',{p_pin:hostPin,p_id:id});await refresh();renderAll()}catch{e.target.textContent='Couldn\'t remove'}});

function renderAll(){if(drag){pending=true;return}renderCard();renderBoard();renderHost()}

/* data: poll every few seconds while the page is visible */
let lastSig='';
async function refresh(){
  const [g,c]=await Promise.all([api('game?id=eq.1&select=performers,floats,reveals,locked'),api('public_cards?select=id,name,picks,submitted_at&order=submitted_at.asc')]);
  if(!hostEditing&&g&&g[0]){game=norm(g[0])}
  gameLoaded=true;cards=Array.isArray(c)?c:[];syncMine();
}
async function tick(){
  try{await refresh();if(!online){online=true;$('#conn').hidden=true}
    const sig=JSON.stringify([game,cards.map(c=>[c.id,c.name,c.picks])]);if(sig!==lastSig){lastSig=sig;renderAll()}}
  catch{online=false;$('#conn').hidden=false;$('#conn').textContent='Can\'t reach the scoreboard right now. Retrying…'}
}
setInterval(()=>{if(document.visibilityState==='visible')tick()},5000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')tick()});

/* boot */
(async()=>{
  loadDraft();show(location.hash.slice(1)||'card');renderAll();
  if(!CFG.url||!CFG.anonKey){$('#conn').hidden=false;$('#conn').textContent='This game isn\'t connected to its database yet.';return}
  if(hostPin){try{isHost=await rpc('host_check',{p_pin:hostPin})}catch{}if(!isHost){hostPin=null;ls.del('fm-pin')}}
  show(location.hash.slice(1)||'card');
  await tick();
})();
}
