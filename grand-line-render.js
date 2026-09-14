const TAU=Math.PI*2;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const hash=text=>{let n=2166136261;for(const c of String(text))n=Math.imul(n^c.charCodeAt(0),16777619);return n>>>0;};

// Each untouched source PNG contains painted card art beside its battle avatar.
// The manifest preserves the actual generated split rather than guessing 50/50.
export function createArtManager(){
  const metadata=new Map(), images=new Map(), nodes=new Set();
  let pruneQueued=false;
  const fallback={artRect:{x:0,y:0,w:.52,h:1},avatarRect:{x:.52,y:0,w:.48,h:1}};
  const path=id=>`./assets/grand-line/${id}.webp`;
  const apply=(node,id)=>{
    const rect=metadata.get(id)?.artRect||fallback.artRect;
    node.style.backgroundImage=`url("${path(id)}")`;
    node.style.backgroundSize=`${100/rect.w}% ${100/rect.h}%`;
    node.style.backgroundPosition=`${rect.w===1?0:rect.x/(1-rect.w)*100}% ${rect.h===1?0:rect.y/(1-rect.h)*100}%`;
    node.dataset.loaded='true';
  };
  const observer=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{
    for(const entry of entries)if(entry.isIntersecting){apply(entry.target,entry.target.dataset.art);observer.unobserve(entry.target);}
  },{rootMargin:'250px'}):null;
  function attach(node,id,eager=false){node.dataset.art=id;nodes.add(node);if(eager||!observer)apply(node,id);else observer.observe(node);if(!pruneQueued){pruneQueued=true;queueMicrotask(()=>{pruneQueued=false;for(const old of nodes)if(!old.isConnected){nodes.delete(old);observer?.unobserve(old);}});}}
  const ready=fetch('./assets/grand-line/manifest.json?v=1.1.0').then(r=>{if(!r.ok)throw Error('Card manifest unavailable');return r.json();}).then(rows=>{
    for(const row of Array.isArray(rows)?rows:rows.assets||[])if(row?.id&&row.artRect&&row.avatarRect)metadata.set(row.id,row);
    for(const node of nodes){if(!node.isConnected){nodes.delete(node);observer?.unobserve(node);}else if(node.dataset.loaded)apply(node,node.dataset.art);}
    return metadata;
  }).catch(()=>metadata);
  function load(id){
    if(images.has(id))return images.get(id);
    const item={image:new Image(),loaded:false,failed:false,bounds:null};images.set(id,item);
    item.promise=ready.then(()=>new Promise(resolve=>{
      item.image.onload=()=>{
        item.loaded=true;const im=item.image,r=metadata.get(id)?.avatarRect||fallback.avatarRect;
        const sx=Math.round(r.x*im.width)+3,sy=Math.round(r.y*im.height),sw=Math.max(1,Math.round(r.w*im.width)-3),sh=Math.max(1,Math.round(r.h*im.height));
        item.bounds={x:sx,y:sy,w:sw,h:sh};
        try{
          // Trim only the avatar's transparent padding once at load time.
          const tiny=document.createElement('canvas');tiny.width=sw;tiny.height=sh;const c=tiny.getContext('2d',{willReadFrequently:true});c.drawImage(im,sx,sy,sw,sh,0,0,sw,sh);const pixels=c.getImageData(0,0,sw,sh).data;
          let minX=sw,minY=sh,maxX=0,maxY=0;
          for(let y=0;y<sh;y+=2)for(let x=0;x<sw;x+=2)if(pixels[(y*sw+x)*4+3]>80){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
          if(maxX>minX&&maxY>minY)item.bounds={x:sx+minX,y:sy+minY,w:Math.min(sw-minX,maxX-minX+3),h:Math.min(sh-minY,maxY-minY+3)};
        }catch(_){/* Original panel remains a usable fallback. */}
        resolve(item);
      };
      item.image.onerror=()=>{item.failed=true;resolve(item);};item.image.src=path(id);
    }));return item;
  }
  return {ready,attach,load,metadata,path,destroy(){observer?.disconnect();nodes.clear();images.clear();}};
}

export function createBattleRenderer(canvas,art){
  const ctx=canvas.getContext('2d');let width=1,height=1,dpr=1,backdrop=null,battleId=null;
  let positions=new Map(),seen=new Set(),animations=[],lastEvents=[];
  function resize(){const r=canvas.getBoundingClientRect();width=Math.max(1,r.width);height=Math.max(1,r.height);dpr=Math.min(2,devicePixelRatio||1);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);backdrop=null;}
  const ro=new ResizeObserver(resize);ro.observe(canvas);
  function background(chapter){
    const c=document.createElement('canvas');c.width=Math.round(width*dpr);c.height=Math.round(height*dpr);const g=c.getContext('2d');g.scale(dpr,dpr);
    const palettes=[['#090e23','#344b63','#283d4b'],['#10132e','#484163','#333957'],['#180e27','#6b3d50','#342c42']];const p=palettes[clamp((chapter||1)-1,0,2)];
    let grad=g.createLinearGradient(0,0,0,height);grad.addColorStop(0,p[0]);grad.addColorStop(.56,p[1]);grad.addColorStop(1,'#091623');g.fillStyle=grad;g.fillRect(0,0,width,height);
    const sun=g.createRadialGradient(width*.75,height*.2,0,width*.75,height*.2,height*.48);sun.addColorStop(0,'#ccb58226');sun.addColorStop(1,'#ccb58200');g.fillStyle=sun;g.fillRect(0,0,width,height);
    g.fillStyle='#f3dfbc';for(let i=0;i<75;i++){const x=((i*73.91+39)%997)/997*width,y=((i*127.33+53)%733)/733*height*.5;g.globalAlpha=.1+(i%4)*.12;g.fillRect(x,y,i%7===0?2:1,i%7===0?2:1);}g.globalAlpha=1;
    for(let layer=0;layer<3;layer++){g.fillStyle=['#16243b','#1a2b3e','#101c2b'][layer];g.beginPath();g.moveTo(0,height*(.41+layer*.06));for(let i=0;i<=18;i++){const x=i/18*width,y=height*(.28+layer*.06)-Math.sin(i*2.8+layer)*height*.07+(i%3)*11;g.lineTo(x,y);}g.lineTo(width,height*.66);g.lineTo(0,height*.66);g.fill();}
    g.fillStyle=p[2];g.beginPath();g.moveTo(0,height*.64);g.lineTo(width,height*.52);g.lineTo(width,height);g.lineTo(0,height);g.fill();
    g.strokeStyle='#adbbbd12';g.lineWidth=1;for(let x=-width;x<width*2;x+=width/8){g.beginPath();g.moveTo(width*.5+(x-width*.5)*.35,height*.57);g.lineTo(x,height);g.stroke();}for(let i=0;i<10;i++){const y=height*.58+Math.pow(i/9,1.6)*height*.45;g.beginPath();g.moveTo(0,y+10);g.lineTo(width,y-18);g.stroke();}
    g.save();g.translate(width*.5,height*.73);g.scale(1,.28);g.strokeStyle='#d7c29518';for(const radius of [height*.48,height*.52,height*.72]){g.beginPath();g.arc(0,0,radius,0,TAU);g.stroke();}g.beginPath();for(let i=0;i<16;i++){const a=i/16*TAU,r=i%2?height*.25:height*.42;i?g.lineTo(Math.cos(a)*r,Math.sin(a)*r):g.moveTo(Math.cos(a)*r,Math.sin(a)*r);}g.closePath();g.stroke();g.restore();
    grad=g.createLinearGradient(0,0,0,height);grad.addColorStop(0,'#00000044');grad.addColorStop(.4,'#00000000');grad.addColorStop(1,'#030914bb');g.fillStyle=grad;g.fillRect(0,0,width,height);backdrop={canvas:c,chapter};
  }
  function locate(b){
    const mobile=width<650;const result=new Map();
    for(const side of ['allies','enemies']){
      const units=b[side]||[],ally=side==='allies';units.forEach((u,i)=>{
        let x,y,h;
        if(mobile){x=width*(.1+.2*i);y=height*(ally?.86:.41)+(i%2)*8;h=height*(ally?.27:.24);}
        else{const row=Math.floor(i/3),col=i%3;x=width*(ally?.12+.12*col+row*.07:.63+.12*col-row*.045);y=height*(ally?.62+row*.25:.39+row*.22);h=height*(u.stars===7?.35:.3);}
        h=clamp(h,60,mobile?118:210);result.set(u.id,{x,y,h,w:h*.62,ally,mobile});
      });
    }positions=result;return result;
  }
  function ellipse(x,y,rx,ry,color){ctx.fillStyle=color;ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,TAU);ctx.fill();}
  function line(points,color,thickness=2){ctx.strokeStyle=color;ctx.lineWidth=thickness;ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();}
  function star(x,y,r,color){ctx.save();ctx.translate(x,y);ctx.fillStyle=color;ctx.beginPath();for(let i=0;i<8;i++){const a=i/8*TAU,v=i%2?r*.23:r;i?ctx.lineTo(Math.cos(a)*v,Math.sin(a)*v):ctx.moveTo(Math.cos(a)*v,Math.sin(a)*v);}ctx.closePath();ctx.fill();ctx.restore();}
  function paintUnit(u,b,now,options){
    const pos=positions.get(u.id);if(!pos)return;let {x,y,h,mobile}=pos;const alive=u.hp>0;const active=b.activeId===u.id&&alive;
    const sourceEvent=animations.find(a=>a.event.sourceId===u.id&&now-a.start<600),hitEvent=animations.find(a=>a.event.targetIds?.includes(u.id)&&now-a.start<650);
    if(!options.reducedMotion){if(sourceEvent){const t=(now-sourceEvent.start)/600;x+=Math.sin(t*Math.PI)*(pos.ally?15:-15);}if(hitEvent&&now-hitEvent.start>180)x+=Math.sin((now-hitEvent.start)*.09)*3*(1-(now-hitEvent.start)/650);}
    ctx.save();ctx.globalAlpha=alive?1:.22;ellipse(x,y+3,h*.3,h*.095,'#00000066');
    if(options.selectedTarget===u.id||active){ctx.strokeStyle=active?'#ffe1a0':'#91dae9';ctx.lineWidth=active?2:1.5;ctx.beginPath();ctx.ellipse(x,y+2,h*.29,h*.09,0,0,TAU);ctx.stroke();}
    if(u.shield>0){ctx.strokeStyle='#91d6ff6b';ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(x,y-h*.45,h*.32,h*.5,0,0,TAU);ctx.stroke();}
    const asset=art.load(u.characterId);if(asset.loaded){const r=asset.bounds;const w=h*r.w/r.h;ctx.save();ctx.translate(x,y);if(pos.ally)ctx.scale(-1,1);ctx.drawImage(asset.image,r.x,r.y,r.w,r.h,-w/2,-h,w,h);ctx.restore();}else{
      ctx.fillStyle=u.side==='ally'?'#4c7693':'#926879';ctx.beginPath();ctx.arc(x,y-h*.75,h*.14,0,TAU);ctx.fill();ctx.beginPath();ctx.moveTo(x,y-h*.6);ctx.lineTo(x+h*.2,y);ctx.lineTo(x-h*.2,y);ctx.fill();ctx.fillStyle='#e1d0a6';ctx.font=`${Math.round(h*.18)}px Georgia`;ctx.textAlign='center';ctx.fillText(u.name[0],x,y-h*.27);
    }
    ctx.restore();
    const bw=mobile?Math.min(56,width/5-12):82,by=y+10;ctx.fillStyle='#06111ce0';ctx.fillRect(x-bw/2-2,by-2,bw+4,8);ctx.fillStyle=pos.ally?'#78bcad':'#c37a84';ctx.fillRect(x-bw/2,by,bw*clamp(u.hp/u.maxHp,0,1),4);
    ctx.textAlign='center';ctx.font=`${mobile?7:9}px "Segoe UI",sans-serif`;ctx.fillStyle=alive?'#dce2da':'#7f8391';const short=u.name.replace('Monkey D. ','').replace('Admiral ','').replace(' the Beast','');ctx.fillText(short.length>(mobile?10:18)?short.slice(0,mobile?9:17)+'…':short,x,by+16);
    if(!mobile){ctx.font='8px "Segoe UI",sans-serif';ctx.fillStyle='#90a9ba';ctx.fillText(`${Math.max(0,Math.ceil(u.hp))} / ${u.maxHp}`,x,by+28);}
    const marks=(u.statuses||[]).map(s=>({burn:'♨',poison:'●',freeze:'❄',stun:'✧',weaken:'↓',slow:'◷',regen:'✚',taunt:'!',guard:'⬡','attack-up':'↑'}[s.type]||'•'));
    if(marks.length){ctx.font=`${mobile?11:14}px "Segoe UI",sans-serif`;ctx.fillStyle='#f0d28b';ctx.fillText(marks.slice(0,4).join(' '),x,y-h-8);}
    if(active){ctx.fillStyle='#f6dc95';ctx.beginPath();ctx.moveTo(x-4,y-h-19);ctx.lineTo(x+4,y-h-19);ctx.lineTo(x,y-h-12);ctx.fill();}
  }
  function effects(now,reducedMotion){
    for(const a of animations){const t=clamp((now-a.start)/1050,0,1),e=a.event,from=positions.get(e.sourceId),targets=e.targetIds?.map(id=>positions.get(id)).filter(Boolean)||[];if(!from||!targets.length)continue;
      const color=e.color||'#ead297',seed=hash(e.animation),fade=Math.sin(t*Math.PI);ctx.save();ctx.globalAlpha=fade;
      for(const to of targets){const x=to.x,y=to.y-to.h*.48,r=(to.mobile?31:52),kind=e.kind;
        if(reducedMotion){ctx.strokeStyle=color;ctx.lineWidth=3;ctx.beginPath();ctx.arc(x,y,r*.7,0,TAU);ctx.stroke();continue;}
        const phase=Math.min(1,t*2.3),sx=from.x,sy=from.y-from.h*.45,px=sx+(x-sx)*phase,py=sy+(y-sy)*phase;
        if(['punch','slash','string'].includes(kind)){
          if(kind==='punch'){const tier=Number((e.skillId||e.animation||'').match(/-(\d)(?:-|$)/)?.[1]||0),hits=tier===2?7:tier===1?3:1;for(let i=0;i<hits;i++){const offset=hits===1?0:Math.sin(i*2.4+seed)*r*.45,hitPhase=clamp(t*2.8-i*.06,0,1),xx=sx+(x-sx)*hitPhase,yy=sy+(y-sy)*hitPhase+offset;line([{x:sx,y:sy+offset*.3},{x:xx,y:yy}],color,r*(tier===2?.11:.15));ellipse(xx,yy,r*(tier===2?.15:.21),r*.16,color);}ellipse(x,y,r*t,r*t*.55,color+'33');}
          else if(kind==='string'){for(let i=0;i<7;i++)line([{x:sx,y:sy+i*3},{x:x+Math.cos(i)*r*phase,y:y+Math.sin(i)*r}],color,1);}
          else{ctx.translate(x,y);ctx.rotate(-.8+(seed%8)*.3);ctx.strokeStyle=color;ctx.lineWidth=3;for(let i=0;i<3;i++){ctx.beginPath();ctx.ellipse(i*9-9,0,r*.9*phase,r*.32,0,-2.6,.6);ctx.stroke();}ctx.setTransform(dpr,0,0,dpr,0,0);}
        }else if(['lightning','light'].includes(kind)){
          const pts=[];for(let i=0;i<=9;i++)pts.push({x:x+(i===0||i===9?0:Math.sin(i*7+seed)*r*.5),y:y-r*2.5+i/9*r*2.7});line(pts,color,kind==='light'?7:3);line(pts,'#fff9df',1);star(x,y,r*.65*phase,'#fff3c5');
        }else if(['heal','revive','shield'].includes(kind)){
          ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();for(let i=0;i<=6;i++){const angle=i/6*TAU-Math.PI/2;const xx=x+Math.cos(angle)*r,yy=y+Math.sin(angle)*r;i?ctx.lineTo(xx,yy):ctx.moveTo(xx,yy);}ctx.stroke();for(let i=0;i<7;i++){const angle=i/7*TAU+t*3;star(x+Math.cos(angle)*r*.75,y+Math.sin(angle)*r*.75-r*t*.3,r*.09,color);}if(kind!=='shield'){line([{x:x-r*.22,y},{x:x+r*.22,y}],color,5);line([{x,y:y-r*.22},{x,y:y+r*.22}],color,5);}
        }else if(['fire','explosion','dragon'].includes(kind)){
          if(kind==='dragon'){const pts=[];for(let i=0;i<=25;i++){const f=i/25;pts.push({x:sx+(x-sx)*f*phase,y:sy+(y-sy)*f+Math.sin(f*TAU*2+t*8)*r*.25});}line(pts,color,12);line(pts,'#fff0b3',3);}
          else ellipse(px,py,r*.17,r*.17,color);
          for(let i=0;i<14;i++){const ang=i/14*TAU+seed*.1,rr=r*(t*.9+.1);ellipse(x+Math.cos(ang)*rr,y+Math.sin(ang)*rr-r*t*.4,r*.13*(1-t+.2),r*.2*(1-t+.2),i%2?color:'#ffe1a1');}star(x,y,r*.65*fade,'#ffe8a7');
        }else if(['ice','earth'].includes(kind)){
          for(let i=0;i<6;i++){const xx=x+(i-2.5)*r*.3,yy=y+r*.4-Math.sin(i)*r*.3;ctx.fillStyle=i%2?color:'#d8e8db';ctx.beginPath();ctx.moveTo(xx-r*.12,yy+r*.3);ctx.lineTo(xx+r*.03,yy-r*(.2+phase*.8));ctx.lineTo(xx+r*.16,yy+r*.25);ctx.closePath();ctx.fill();}line([{x:x-r,y:y+r*.4},{x:x-r*.3,y:y+r*.1},{x:x+r*.2,y:y+r*.45},{x:x+r,y:y+r*.2}],color,2);
        }else if(['water','wind','sand','smoke','soul'].includes(kind)){
          for(let i=0;i<6;i++){ctx.strokeStyle=color;ctx.lineWidth=kind==='water'?5:kind==='sand'?2:3;ctx.beginPath();ctx.ellipse(x+Math.sin(i*2+t*4)*r*.2,y+(i-3)*r*.19,r*(.35+i*.1)*phase,r*.25,t+i*.2,0,Math.PI*1.5);ctx.stroke();}for(let i=0;i<8;i++)star(x+Math.cos(i*8+seed)*r*t,y+Math.sin(i*5)*r-r*t,r*.05,color);
        }else if(['dark','gravity','magnet'].includes(kind)){
          const glow=ctx.createRadialGradient(x,y,0,x,y,r);glow.addColorStop(0,'#040514');glow.addColorStop(.45,color+'aa');glow.addColorStop(1,color+'00');ctx.fillStyle=glow;ctx.fillRect(x-r,y-r,r*2,r*2);ctx.strokeStyle=color;ctx.lineWidth=2;for(let i=0;i<3;i++){ctx.beginPath();ctx.ellipse(x,y,r*(.45+i*.25),r*(.2+i*.15),t*4+i,0,TAU);ctx.stroke();}if(kind==='magnet'){star(x-r*.75,y,r*.24,'#fa7d8c');star(x+r*.75,y,r*.24,'#7dc5fa');}
        }else if(kind==='plant'){
          for(let i=0;i<5;i++){const xx=x+(i-2)*r*.3;ctx.strokeStyle=color;ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(xx,y+r*.7);ctx.quadraticCurveTo(xx-r*.3,y,xx+r*.1,y-r*phase);ctx.stroke();ellipse(xx-r*.1,y-r*.1,r*.18,r*.06,color);}
        }else{
          for(let i=0;i<10;i++){const angle=i/10*TAU+seed;ellipse(x+Math.cos(angle)*r*t,y+Math.sin(angle)*r*t-r*.4*t,r*(.04+(i%3)*.04),r*(.04+(i%3)*.04),color);}ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,y,r*phase,0,TAU);ctx.stroke();
        }
        if(t>.2){ctx.fillStyle='#fff1d0';ctx.textAlign='center';ctx.font=`700 ${to.mobile?13:19}px Georgia`;ctx.shadowColor='#000';ctx.shadowBlur=4;const amount=Number.isFinite(e.amount)?Math.round(e.amount):null;if(amount!==null)ctx.fillText((['heal','revive'].includes(kind)?'+':'')+amount,x,y-r*.6-t*22);if(e.critical){ctx.fillStyle='#ffdb7b';ctx.font=`700 ${to.mobile?10:14}px Georgia`;ctx.fillText('CRITICAL!',x,y-r-t*22);}ctx.shadowBlur=0;}
      }ctx.restore();
    }
  }
  function draw(b,now,options={}){
    if(!b||!ctx)return;
    if(b.id!==battleId){battleId=b.id;seen.clear();animations=[];backdrop=null;}
    if(width<2||height<2)resize();
    const chapter=Math.ceil((b.encounter?.id||b.encounter||1)/3);if(!backdrop||backdrop.chapter!==chapter)background(chapter);
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);ctx.drawImage(backdrop.canvas,0,0,width,height);locate(b);
    lastEvents=[];for(const event of b.effects||[]){if(seen.has(event.id))continue;seen.add(event.id);animations.push({event,start:now});lastEvents.push(event);}if(seen.size>500)seen=new Set([...seen].slice(-250));
    const recent=animations.filter(a=>now-a.start<1100);animations=[...recent.filter(a=>a.event.skillId).slice(-6),...recent.filter(a=>!a.event.skillId).slice(-18)];
    const units=[...(b.allies||[]),...(b.enemies||[])].sort((a,z)=>positions.get(a.id).y-positions.get(z.id).y);
    for(const u of units)paintUnit(u,b,now,options);effects(now,options.reducedMotion);return lastEvents;
  }
  function hitTest(clientX,clientY){const r=canvas.getBoundingClientRect(),x=clientX-r.left,y=clientY-r.top;return [...positions].reverse().find(([,p])=>Math.abs(x-p.x)<Math.max(25,p.w*.55)&&y>p.y-p.h&&y<p.y+32)?.[0]||null;}
  return {draw,resize,hitTest,get positions(){return positions;},destroy(){ro.disconnect();animations=[];}};
}
