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
  const ready=fetch('./assets/grand-line/manifest.json?v=2.0.0').then(r=>{if(!r.ok)throw Error('Card manifest unavailable');return r.json();}).then(rows=>{
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
