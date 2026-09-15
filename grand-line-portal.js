import { installGrandLineLearningParent } from './grand-line-learning-parent.js?v=3.2.0';
import { pirateRiftScope } from './pirate-rift-portal.js?v=1.0.0';

const CSS = `.grand-line-portal{position:fixed;inset:0;z-index:100002;background:#09131b;color:#f9eed0;display:flex;flex-direction:column;font:14px/1.5 system-ui,sans-serif}.grand-line-portal>header{display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:#132331;padding:10px 16px;border-bottom:1px solid #927b48}.grand-line-portal h2{flex:1;margin:0;font:700 18px Georgia,serif}.grand-line-portal h2 small{font:700 9px system-ui;color:#dcbb68}.grand-line-portal label{display:flex;gap:7px;align-items:center}.grand-line-portal button,.grand-line-portal select{border:1px solid #8d7954;color:#fff2ce;background:#1a3040;border-radius:5px;padding:8px 12px;min-height:44px;font:inherit;cursor:pointer}.grand-line-portal button:focus-visible,.grand-line-portal select:focus-visible{outline:3px solid #72d8d4;outline-offset:2px}.grand-line-stage{flex:1;min-height:0;display:flex}.grand-line-stage iframe{flex:1;width:100%;height:100%;min-height:0;border:0;background:#09131b}.grand-line-intro{margin:auto;max-width:640px;text-align:center;padding:24px}.grand-line-intro h3{font:30px Georgia,serif;color:#edca81}.grand-line-status{margin:0;padding:5px 16px;background:#132331;font-size:12px;color:#c9d7df}.grand-line-portal [hidden]{display:none!important}@media(max-width:640px){.grand-line-portal>header{padding:8px;gap:7px}.grand-line-portal h2{min-width:100%;font-size:16px}.grand-line-portal label{flex:1}.grand-line-portal button,.grand-line-portal select{font-size:12px;padding:7px 9px}}`;

export function installGrandLinePortal(env) {
  const win=env.window||window, doc=win.document;
  const subject=env.subject==='Science'?'Science':'Math';
  let overlay=null, frame=null, bridge=null, level='', runIdentity='', priorFocus=null, priorOverflow='', inert=[];
  const allowed=()=>!!env.getUser()?.uid&&['admin','student'].includes(env.getUser()?.role);
  const baseIdentity=()=>allowed()?JSON.stringify([env.getUser().uid,env.getUser().role,env.getProfileKey?.()||'',env.getLevel?.()||'']):'';
  const resolvedLevel=()=>{
    const saved=env.getLevel?.();
    if(env.isLevel(saved))return saved;
    const preview=env.getUser()?.role==='admin'?env.getPreviewLevel?.():'';
    return env.isLevel(preview)?preview:'';
  };
  let openedIdentity='';
  const current=()=>!!overlay&&allowed()&&baseIdentity()===openedIdentity&&env.isLevel(level)&&
    level===resolvedLevel();
  const context=()=>({level,admin:env.getUser()?.role==='admin',identity:runIdentity,profileKey:pirateRiftScope(runIdentity),subject});
  function stopFrame(message='The learning session changed. Start again to continue.') {
    bridge?.invalidate(message);bridge?.destroy();bridge=null;frame?.remove();frame=null;runIdentity='';
  }
  function close() {
    if(!overlay)return;
    stopFrame('Crew Defense was closed.');
    if(doc.fullscreenElement&&overlay.contains(doc.fullscreenElement))Promise.resolve(doc.exitFullscreen?.()).catch(()=>{});
    overlay.remove();overlay=null;level='';openedIdentity='';
    for(const [element,value] of inert)element.inert=value;inert=[];doc.body.style.overflow=priorOverflow;
    win.removeEventListener('focus',sync);doc.removeEventListener('visibilitychange',sync);
    if(priorFocus?.isConnected)priorFocus.focus();priorFocus=null;
  }
  function sync(){if(overlay&&(baseIdentity()!==openedIdentity||(frame&&level!==resolvedLevel())))close();}
  async function guarded(action, args, ctx) {
    if(!current()||ctx.identity!==runIdentity)throw new Error('Learning profile changed.');
    const result=await action?.(args,ctx);
    if(!current()||ctx.identity!==runIdentity)throw new Error('Learning profile changed.');
    return result;
  }
  function start() {
    if(!allowed()||baseIdentity()!==openedIdentity){close();return false;}
    level=resolvedLevel();
    if(!env.isLevel(level))return false;
    stopFrame();runIdentity=JSON.stringify([subject,openedIdentity,level,env.getUser().role==='admin'?'preview':'student']);
    const ctx=Object.freeze(context());env.onStart?.(ctx);
    const isAdmin=()=>current()&&ctx.admin===true&&env.getUser()?.role==='admin';
    const stage=overlay.querySelector('.grand-line-stage');stage.replaceChildren();
    frame=doc.createElement('iframe');frame.title='Grand Line Chronicles — Crew Defense';
    frame.setAttribute('allow','fullscreen; autoplay');frame.setAttribute('referrerpolicy','no-referrer');
    bridge=installGrandLineLearningParent({window:win,subject,getFrame:()=>frame,isAllowed:current,isActive:()=>!!overlay?.isConnected,
      getIdentity:()=>current()?runIdentity:'',getProfileKey:()=>ctx.profileKey,
      getQuestions:()=>guarded(()=>env.getQuestions(ctx),null,ctx),
      ...(env.getSnapshot?{getSnapshot:()=>guarded(()=>env.getSnapshot(ctx),null,ctx)}:{}),
      ...(env.buyPack?{buyPack:request=>guarded(env.buyPack,request,ctx)}:{}),
      ...(env.saveCollection?{saveCollection:request=>guarded(env.saveCollection,request,ctx)}:{}),
      isAdmin,
      ...(env.adminAction?{adminAction:request=>guarded((value,scope)=>{
        if(!isAdmin())throw new Error('Administrator access is required.');
        return env.adminAction(value,scope);
      },request,ctx)}:{}),
      ...(env.gradeQuestion?{gradeQuestion:request=>guarded(env.gradeQuestion,request,ctx)}:{}),
      markShown:q=>{if(current()&&ctx.identity===runIdentity)env.markShown?.(q,ctx);},
      recordAnswer:result=>guarded(env.recordAnswer,result,ctx),
      onImageFailure:(q,url)=>{if(current())env.onImageFailure?.(q,url,ctx);},
      onQuestionUnavailable:q=>{if(current())env.onQuestionUnavailable?.(q,ctx);}
    });
    const url=new URL('./grand-line.html',win.location.href);url.searchParams.set('v','3.2.0');url.searchParams.set('subject',subject.toLowerCase());url.searchParams.set('profile',ctx.profileKey);url.searchParams.set('learning','1');
    frame.src=url.href;stage.append(frame);frame.focus();return true;
  }
  function open() {
    if(!allowed()){close();env.notify?.('Sign in as a student or administrator to play Crew Defense.');return false;}
    close();env.beforeOpen?.();priorFocus=doc.activeElement;openedIdentity=baseIdentity();
    if(!doc.getElementById('grand-line-portal-style')){const style=doc.createElement('style');style.id='grand-line-portal-style';style.textContent=CSS;doc.head.append(style);}
    overlay=doc.createElement('section');overlay.className='grand-line-portal';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label','Crew Defense');
    overlay.innerHTML='<header><h2>CREW DEFENSE <small>GRAND LINE CHRONICLES · BETA</small></h2><span class="grand-line-level" aria-label="School level"></span><button type="button" data-rift>Pirate Rift</button><button type="button" data-fullscreen>Fullscreen</button><button type="button" data-close>Close</button></header><p class="grand-line-status" role="status">Summon any owned character, counter dense enemy waves, and answer three questions after every wave to level up. Buy one-character packs with your portal reward points.</p><div class="grand-line-stage"><div class="grand-line-intro"><h3>Your school level is missing</h3><p>Your saved school level is missing or unavailable in the portal profile. Update your level in the portal, then reopen Crew Defense. Ask your teacher if you need help.</p></div></div>';
    const stored=resolvedLevel();
    overlay.querySelector('.grand-line-level').textContent=stored?`${env.isLevel(env.getLevel?.())?'School level':'Preview'} · ${stored}`:'School level unavailable';
    if(!stored)overlay.querySelector('.grand-line-status').textContent='A saved school level is required before questions, reward points or your card collection can be opened.';
    overlay.addEventListener('keydown',event=>{if(event.key==='Escape'&&!doc.querySelector('.grand-line-learning-overlay')){event.preventDefault();close();}});
    overlay.querySelector('[data-close]').onclick=close;
    overlay.querySelector('[data-rift]').onclick=()=>{close();env.openRift?.();};
    overlay.querySelector('[data-fullscreen]').onclick=async()=>{try{if(doc.fullscreenElement)await doc.exitFullscreen();else await overlay.requestFullscreen();}catch{const status=overlay?.querySelector('[role="status"]');if(status)status.textContent='Fullscreen is unavailable. You can keep playing in this window.';}};
    inert=[...doc.body.children].map(element=>[element,element.inert]);for(const [element]of inert)element.inert=true;
    priorOverflow=doc.body.style.overflow;doc.body.style.overflow='hidden';doc.body.append(overlay);
    win.addEventListener('focus',sync);doc.addEventListener('visibilitychange',sync);
    if(stored)start();else overlay.querySelector('[data-close]').focus();return true;
  }
  const onCompanion=event=>{
    if(event.origin!==win.location.origin||!allowed())return;
    const rift=env.getRiftFrame?.();
    if(event.data?.type==='PIRATE_RIFT_OPEN_TCG'&&rift&&event.source===rift.contentWindow)open();
    if(event.data?.type==='GLTCG_OPEN_RIFT'&&event.source===frame?.contentWindow&&current()){close();env.openRift?.();}
  };
  win.addEventListener('message',onCompanion);
  return {open,close,sync,allowed,isCurrent:ctx=>current()&&ctx?.identity===runIdentity,getFrame:()=>frame,destroy(){close();win.removeEventListener('message',onCompanion);}};
}
