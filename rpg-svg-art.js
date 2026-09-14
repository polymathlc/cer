/* Science Quest wardrobe. Authored vector silhouettes; no generated image assets.
 * Stable item ids are presentation keys only: inventory and combat stay in app.js.
 * Each fragment owns its gradient definitions; repeated avatars cannot collide.
 */
(function (root) {
  'use strict';
  const profiles = Object.create(null);
  function catalogue(slot, rows) {
    rows.trim().split('\n').forEach(row => {
      const [id, form, material, motif, variation] = row.trim().split(/\s+/);
      profiles[id] = Object.freeze({ id, slot, form, material, motif, variation: Number(variation) || 0 });
    });
  }
  // Every collectible has an intentional silhouette, material and carved emblem.
  catalogue('weapon', `
wood_sword sword timber leaf 0
iron_sword sword steel gear 1
steel_sword sword silver chevron 2
silver_rapier rapier silver fleur 0
shadow_dagger dagger shadow moon 0
knight_sword sword royal crown 3
corsair_cutlass cutlass bronze compass 0
frost_brand sword frost snow 4
elven_blade katana forest leaf 0
flame_sword sword ember flame 5
dragon_blade sword dragon dragon 6
obsidian_greatsword greatsword shadow eye 0
excalibur greatsword dawn crown 1
apprentice_staff staff timber gear 0
oak_staff staff forest leaf 1
ember_staff staff ember flame 2
sprout_staff staff forest leaf 3
arcane_staff staff astral eye 4
glacier_staff staff frost snow 5
rune_staff staff timber rune 6
crystal_staff staff frost star 7
void_staff staff shadow moon 8
royal_crook staff royal crown 9
star_wand wand dawn star 0
comet_wand wand astral comet 1
sun_scepter wand dawn sun 2
soldier_spear spear steel chevron 0
battle_axe axe steel gear 0
war_hammer hammer bronze gear 0
executioner_axe axe shadow eye 1
reaper_scythe scythe shadow moon 0
golden_trident trident dawn wave 0
crown_halberd halberd royal crown 0
shortbow bow timber leaf 0
longbow bow bronze compass 1
elven_bow bow forest leaf 2
shadow_bow bow shadow moon 3
frostfang_bow bow frost snow 4
stormpiercer bow dawn bolt 5
ember_dagger dagger ember flame 1
glacier_spear spear frost snow 1
elven_rapier rapier forest leaf 1
sunblade sword dawn sun 7
obsidian_axe axe shadow rune 2
starfall_katana katana astral star 1
worldender greatsword rose eye 2
staff_of_creation staff rose infinity 10
eclipse_reaper scythe rose moon 1
celestial_edge sword frost star 8
galaxy_greatblade greatsword astral constellation 3
phoenix_talon katana ember feather 2
astral_scythe scythe astral constellation 2
heavens_halberd halberd dawn feather 1
starfire_staff staff dawn star 11
tempest_bow bow astral bolt 6
`);
  catalogue('shield', `
wooden_shield round timber leaf 0
swift_buckler round steel gear 1
iron_shield heater steel chevron 0
kite_shield kite forest leaf 0
knight_shield heater royal crown 1
grimoire book shadow eye 0
tower_shield tower steel gear 0
mirror_shield oval silver mirror 0
aegis_shield kite astral eye 1
royal_bulwark tower royal crown 1
dragonscale_ward scale dragon dragon 0
fallen_star_aegis star astral star 0
aegis_eternity winged rose infinity 0
aurora_aegis crystal frost snow 0
solar_bulwark sun dawn sun 0
void_ward crescent shadow moon 0
`);
  catalogue('armor', `
cloth_tunic tunic forest leaf 0
leather_armor leather timber gear 0
travelers_garb leather forest compass 1
chainmail chain steel chevron 0
mage_robe robe royal star 0
bronze_plate plate bronze gear 0
ninja_garb leather shadow moon 2
knight_plate plate silver crown 1
emerald_scale scale forest leaf 0
frost_plate plate frost snow 2
archmage_robe robe astral eye 1
gilded_plate plate dawn sun 3
dragon_plate scale dragon dragon 1
starweaver_robe robe astral constellation 2
dawnforged_plate plate rose infinity 4
celestial_plate plate frost star 5
phoenix_mantle robe ember feather 3
astral_scalemail scale astral constellation 2
`);
  catalogue('helmet', `
leather_cap cap timber gear 0
adventurers_hood hood forest compass 0
warrior_headband band ember chevron 0
iron_helm helm steel gear 0
shadow_hood hood shadow moon 1
wizard_hat hat royal star 0
knight_helm helm silver crown 1
berserker_horns horns bronze dragon 0
glacier_helm helm frost snow 2
gilded_helm helm dawn sun 3
seer_circlet circlet astral eye 0
crown_wisdom crown dawn crown 0
dragonfang_helm horns dragon dragon 1
seraph_halo halo dawn feather 0
crown_infinity circlet rose infinity 1
astral_hat hat astral constellation 1
cosmos_crown crown astral star 1
`);
  catalogue('accessory', `
scholar_cape cape royal chevron 0
forest_cloak cape forest leaf 1
hero_cape cape ember crown 2
elven_cloak cape forest leaf 3
phoenix_cape cape ember feather 4
dragon_wings wings dragon dragon 0
starfall_cape cape astral constellation 5
angel_wings wings silver feather 1
lucky_amulet pendant forest clover 0
ruby_pendant pendant ember star 1
hawk_feather feather bronze feather 0
wolf_fang fang silver dragon 0
sage_amulet pendant astral eye 2
royal_medallion medal dawn crown 0
phoenix_amulet phoenix ember feather 0
warlords_banner banner dragon crown 0
thieves_dice dice shadow gear 0
archmage_orb orb royal infinity 0
wings_eternity wings rose infinity 2
wings_dawn wings dawn sun 3
cosmos_amulet orrery astral constellation 0
`);
  catalogue('pet', `
loyal_pup hound timber compass 0
shadow_cat cat shadow moon 0
tortoise_knight turtle forest gear 0
frost_penguin penguin frost snow 0
wisp_familiar wisp frost star 0
ember_fox fox ember flame 0
storm_chick bird dawn bolt 0
owl_familiar owl bronze eye 0
star_unicorn unicorn silver star 0
pocket_dragon dragon dragon flame 0
eternal_phoenix phoenix ember sun 0
streak_sprite wisp ember flame 1
nova_dragon dragon rose star 1
astral_drake dragon astral constellation 2
prism_peacock peacock forest eye 0
cosmic_wyrm wyrm astral infinity 0
`);
  Object.freeze(profiles);
  const materials = {
    timber: ['#976039','#d6a963','#75bd9a','#3b2520'],
    steel: ['#637f91','#c8dbe0','#65cde7','#253a4a'],
    silver: ['#c4d3df','#fff2cf','#62c8df','#42536d'],
    bronze: ['#a5693e','#f6c875','#5dd4c0','#463132'],
    royal: ['#315991','#efd18d','#65d4ec','#202d55'],
    forest: ['#397f69','#dac785','#9aefc6','#173d37'],
    frost: ['#68a8c9','#e2f7ff','#abfff3','#305574'],
    ember: ['#b64c39','#ffd58b','#ffae65','#512c40'],
    dragon: ['#783d50','#e3b86d','#ffbc5e','#34233d'],
    shadow: ['#454058','#aa9cc8','#b8a0fc','#201e37'],
    dawn: ['#c99747','#fff0ba','#fff2c3','#594144'],
    astral: ['#66518b','#c5bce8','#83e5f5','#292648'],
    rose: ['#99517a','#ffe1c2','#ffb2df','#412741']
  };
  const boxes = { weapon: [-32,-92,64,118], shield: [-26,-32,52,66], armor: [58,106,84,96], helmet: [54,2,92,88], accessory: [60,108,80,100], pet: [10,80,50,54] };
  const cache = new Map();
  let serial = 0;
  const outline = '#253044';
  const path = (d, fill, stroke = outline, width = 1.5, extra = '') => `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;
  const circle = (x,y,r,fill,stroke='none',width=1) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${width}"/>`;
  const ellipse = (x,y,rx,ry,fill,stroke='none',width=1) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${fill}" stroke="${stroke}" stroke-width="${width}"/>`;
  const line = (d,stroke,width=1,extra='') => path(d,'none',stroke,width,extra);
  const group = (transform,body) => `<g transform="${transform}">${body}</g>`;
  const polygon = (points,fill,stroke=outline,width=1) => `<polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round"/>`;
  function star(x,y,r,fill,points=4) {
    const a=[]; for(let i=0;i<points*2;i++){const t=i*Math.PI/points-Math.PI/2,s=i%2?r*.38:r;a.push(`${(x+Math.cos(t)*s).toFixed(2)},${(y+Math.sin(t)*s).toFixed(2)}`);}
    return polygon(a.join(' '),fill,'none');
  }
  function gem(x,y,r,c) {
    return circle(x,y,r+1.4,c.trim,outline,.8)+polygon(`${x},${y-r} ${x+r*.75},${y-r*.2} ${x+r*.6},${y+r*.65} ${x},${y+r} ${x-r*.6},${y+r*.65} ${x-r*.75},${y-r*.2}`,c.jewel,c.dark,.6)+
      polygon(`${x},${y-r} ${x},${y+r*.2} ${x-r*.75},${y-r*.2}`,'#ffffff88','none')+line(`M${x} ${y+r*.2} L${x+r*.6} ${y+r*.65}`,c.light,.6);
  }
  function emblem(kind,x,y,r,c) {
    const k = {
      leaf: 'M0 9 Q-11 0 0-10 Q12-4 0 9 M0 6 L0-6 M0 1 L-5-3 M0-2 L5-6',
      flame: 'M0 9 Q-12 4-5-5 Q-4 1 0-10 Q12 2 0 9 M0 6 Q-4 2 1-2',
      feather: 'M-6 9 Q-12-4 6-10 Q12 2-6 9 M-6 9 L6-8 M-2 3 L6 1 M1-2 L8-4',
      bolt: 'M2-10 L-7 2 H0 L-2 10 L8-3 H2 Z',
      moon: 'M5-9 A10 10 0 1 0 5 9 A8 8 0 0 1 5-9 Z',
      sun: 'M0-11 V-8 M0 8 V11 M-11 0 H-8 M8 0 H11 M-8-8 L-6-6 M6 6 L8 8 M-8 8 L-6 6 M6-6 L8-8',
      snow: 'M0-10 V10 M-9-5 L9 5 M-9 5 L9-5 M-3-7 L0-4 L3-7 M-3 7 L0 4 L3 7',
      crown: 'M-9-5 L-5 0 L0-9 L5 0 L9-5 L7 7 H-7 Z M-6 3 H6',
      chevron: 'M-9-6 L0 0 L9-6 M-9 0 L0 6 L9 0 M-6 6 L0 10 L6 6',
      fleur: 'M0 9 V-7 Q-8-1 0 2 Q8-1 0-7 M-2 4 Q-11-5-9 4 Q-5 10 0 6 Q5 10 9 4 Q11-5 2 4',
      compass: 'M0-11 L3-3 L11 0 L3 3 L0 11 L-3 3 L-11 0 L-3-3 Z M0-7 L0 7 M-7 0 H7',
      rune: 'M-5 10 V-10 L7-4 L-5 2 L7 9 M-1-8 V8',
      dragon: 'M-8 9 Q-10-1-2-4 L-4-10 L3-7 L9-2 L5 1 L9 4 L3 5 L0 9 M1-3 L3-2',
      eye: 'M-11 0 Q0-12 11 0 Q0 12-11 0 Z M0-4 V4',
      infinity: 'M0 0 C-14-15-14 15 0 0 C14-15 14 15 0 0',
      wave: 'M-10-3 Q-5-10 0-3 T10-3 M-10 4 Q-5-3 0 4 T10 4',
      clover: 'M0 1 C-14-1-10-13 0-5 C10-13 14-1 0 1 C11 5 6 14 0 6 C-6 14-11 5 0 1 M0 6 L4 11',
      constellation: 'M-9 6 L-3-6 L5 1 L10-8 M5 1 L8 9',
      comet: 'M-9 9 L1-1 M-6 10 L4 0 M-10 5 L0-5',
      gear: 'M-3-10 H3 L4-6 L8-7 L11-2 L7 1 L8 5 L3 9 L0 6 L-4 9 L-9 5 L-7 1 L-11-2 L-8-7 L-4-6 Z',
      mirror: 'M-6 6 L6-6 M-2 8 L8-2'
    };
    let body = k[kind] ? line(k[kind],c.trim,1.5) : star(0,0,10,c.trim,5);
    if(kind==='sun'||kind==='gear')body+=circle(0,0,4,c.jewel,c.trim,1);
    if(kind==='constellation')body+=[[-9,6],[-3,-6],[5,1],[10,-8],[8,9]].map(p=>circle(...p,1.6,c.light)).join('');
    if(kind==='comet')body+=star(4,-4,6,c.jewel);
    return group(`translate(${x},${y}) scale(${r/11})`,body);
  }
  function scroll(x,y,s,c) {return group(`translate(${x},${y}) scale(${s})`,line('M0 0 Q-9-9-11-1 Q-11 6-5 4 Q0 1-4-2 M0 0 Q9-9 11-1 Q11 6 5 4 Q0 1 4-2',c.trim,1.1));}
  function rivets(points,c,r=.9){return points.map(p=>circle(p[0],p[1],r,c.light,c.dark,.45)).join('');}
  function defs(p) {
    const [base,trim,jewel,dark]=materials[p.material]||materials.royal;
    const stop=(o,c)=>`<stop offset="${o}" stop-color="${c}"/>`;
    return { body:`<defs><linearGradient id="__ID__metal" x1="0" y1="0" x2="1" y2=".7">${stop('0',trim)}${stop('.22',base)}${stop('.48',trim)}${stop('.58',base)}${stop('1',dark)}</linearGradient><linearGradient id="__ID__trim" x1="0" y1="0" x2=".8" y2="1">${stop('0','#fff4d6')}${stop('.35',trim)}${stop('1',base)}</linearGradient><radialGradient id="__ID__jewel" cx=".3" cy=".25" r=".8">${stop('0','#fff')}${stop('.26',jewel)}${stop('1',base)}</radialGradient><linearGradient id="__ID__cloth" x1="0" y1="0" x2="1" y2="0">${stop('0',dark)}${stop('.3',base)}${stop('.6',dark)}${stop('.83',base)}${stop('1',dark)}</linearGradient></defs>`,
      c:{metal:'url(#__ID__metal)',trim:'url(#__ID__trim)',jewel:'url(#__ID__jewel)',cloth:'url(#__ID__cloth)',base,light:trim,glow:jewel,dark} };
  }
  function grip(c,long=false){
    let s=path(`M-3-5 H3 L3 ${long?23:16} Q0 ${long?27:20}-3 ${long?23:16} Z`,c.cloth);
    for(let y=-2;y<(long?24:17);y+=3)s+=line(`M-2.5 ${y} L2.5 ${y-1.5}`,c.light,.8);
    return s+gem(0,long?23:17,2.5,c);
  }
  function signatureWeapon(p,c){
    const shaft=()=>path('M-3-60 H3 V22 H-3Z',c.metal)+line('M0-54 V17',c.glow,1)+[-39,-24,-8,9].map(y=>path(`M-5 ${y} L0 ${y-3} L5 ${y} L0 ${y+3}Z`,c.trim,c.dark,.7)).join('')+gem(0,21,3,c);
    const wings=(y)=>{
      let w='';for(const side of [-1,1])for(let i=0;i<4;i++)w+=group(`translate(0,${y}) scale(${side},1)`,path(`M3 0 Q${12+i*2} ${-3-i*2} ${23-i*3} ${-21+i*2} Q${29-i*2} ${-7+i*3} ${9+i*2} 5Z`,i%2?c.metal:c.trim,c.dark,.65));
      return w;
    };
    let s='';
    switch(p.id){
      case 'worldender':
        // Two suspended prongs expose a luminous core; the shards are structural.
        for(const side of [-1,1])s+=group(`scale(${side},1)`,path('M3-10 L3-64 L10-87 L16-70 L12-60 L15-47 L11-36 L13-18Z',c.metal)+line('M8-17 L7-61 L11-76',c.glow,1.1)+polygon('18,-72 23,-63 17,-57',c.jewel)+polygon('19,-46 22,-39 16,-31',c.metal)+path('M4-13 L19-24 L25-21 L16-10 L5-7Z',c.trim));
        s+=path('M0-75 L2-63 V-19 L0-10 L-2-19 V-63Z',c.jewel,'none')+gem(0,-8,5,c)+grip(c)+emblem('eye',0,-41,5,c);
        break;
      case 'celestial_edge':
        s+=polygon('0,-88 10,-68 7,-57 10,-42 5,-17 0,-11 -5,-17 -10,-42 -7,-57 -10,-68',c.jewel)+line('M0-87 L-4-64 L4-44 L0-14 M-9-67 L0-60 L9-67 M-9-42 L0-35 L9-42',c.light,1.1)+wings(-8)+gem(0,-11,5,c)+grip(c)+star(0,-57,4,c.light);
        break;
      case 'galaxy_greatblade':
        s+=path('M0-88 L15-70 L12-56 L15-19 L8-10 H-8 L-15-19 L-12-56 L-15-70Z',c.metal)+path('M0-81 L8-68 L7-28 L0-19 L-7-28 L-8-68Z',c.cloth,c.light,.8);
        for(const [x,y,r] of [[0,-64,5],[3,-43,4],[-2,-29,3]])s+=star(x,y,r,c.dark,5)+star(x,y,r*.45,c.glow,5);
        s+=line('M0-64 L3-43 L-2-29',c.light,.7)+group('rotate(-23 0 -10)',ellipse(0,-10,23,6,'none',c.trim,2.4))+group('rotate(28 0 -10)',ellipse(0,-10,20,5,'none',c.glow,1))+gem(-21,-3,3,c)+gem(20,-16,2.8,c)+gem(0,-10,5,c)+grip(c);
        break;
      case 'staff_of_creation':
        s+=shaft()+path('M-3-42 L-14-51 L-19-76 L-13-85 L-12-62 L0-53 L12-62 L13-85 L19-76 L14-51 L3-42Z',c.metal);
        s+=circle(-7,-70,10,'none',c.trim,2.3)+circle(7,-70,10,'none',c.trim,2.3)+circle(0,-59,10,'none',c.trim,2.3)+gem(0,-66,5,c)+star(-23,-73,3,c.light)+star(23,-59,3,c.light)+emblem('infinity',0,-35,5,c);
        break;
      case 'eclipse_reaper':
        s+=shaft()+path('M3-68 Q-20-87-30-42 Q-13-62 3-52Z',c.metal)+line('M-26-48 Q-16-75-1-65',c.light,1.2)+path('M6-80 A16 16 0 1 1 6-48 A13 13 0 0 0 6-80Z',c.trim)+circle(11,-64,9,c.dark,c.glow,.8)+gem(0,-61,5,c)+emblem('moon',-14,-66,5,c)+path('M4-53 L11-45 L4-40',c.metal);
        break;
      case 'phoenix_talon':
        s+=path('M-5-10 Q16-38 3-87 L12-78 L13-63 L20-67 L16-49 L23-48 L14-31 L17-28 L4-9Z',c.metal)+line('M8-76 Q14-47 1-16',c.light,1.6)+path('M11-66 L17-60 M13-52 L19-46 M11-39 L17-33', 'none',c.glow,1.4)+path('M0-8 L-8-21 L-22-28 L-16-13 L-8-10 L-18-7 L-7-3 H7 L18-7 L8-10 L16-17 L21-28 L8-20Z',c.trim)+gem(0,-8,5,c)+grip(c);
        break;
      case 'astral_scythe':
        s+=shaft()+path('M2-74 Q-20-84-30-39 Q-14-59 2-57 L9-60 Q18-65 25-54 Q18-79 2-74Z',c.metal)+line('M-26-46 Q-15-72-1-69',c.light,1.3)+ellipse(-3,-65,23,19,'none',c.trim,1)+group('rotate(-33 -3 -65)',ellipse(-3,-65,28,8,'none',c.glow,.9))+star(-22,-77,5,c.jewel,5)+star(19,-51,5,c.trim,5)+gem(0,-65,5,c)+emblem('constellation',-12,-64,6,c);
        break;
      case 'heavens_halberd':
        s+=shaft()+polygon('0,-89 8,-70 4,-62 0,-58 -4,-62 -8,-70',c.metal)+line('M0-85 V-61',c.light,1.1)+wings(-49)+path('M3-65 Q24-73 28-49 Q15-59 3-51Z',c.metal)+emblem('sun',16,-61,5,c)+gem(0,-51,5,c)+path('M-4-45 L-14-26 L-10-23 L-1-40',c.trim);
        break;
      case 'starfire_staff':
        s+=shaft()+circle(0,-64,15,c.dark,c.trim,2)+circle(0,-64,10,c.jewel,c.trim,1.2);
        for(let i=0;i<8;i++)s+=group(`rotate(${i*45} 0 -64)`,path('M-3-78 L0-88 L3-78 L0-80Z',c.trim,c.dark,.7));
        s+=path('M-15-55 L-10-44 L-5-51 L0-41 L5-51 L10-44 L15-55',c.metal)+emblem('sun',0,-64,7,c)+gem(0,-43,3,c)+path('M-5-24 L-10-12 L-4-15 M5-24 L10-12 L4-15',c.trim);
        break;
      case 'tempest_bow':
        s+=path('M-3-84 L13-72 L9-62 L23-53 L15-42 L24-31 L17-19 L23-7 L13 4 L15 14 L-3 23 L5 9 L3-1 L11-13 L7-28 L13-40 L6-52 L8-62Z',c.metal)+path('M-5-77 L2-66 L0-55 L9-42 L4-29 L9-15 L1-4 L3 9 L-5 17', 'none',c.trim,2.5)+line('M-3-84 L-20-29 L-3 23',c.glow,1.3)+path('M-22-29 H17 L14-34 L28-29 L14-24 L17-29', 'none',c.glow,2)+gem(16,-30,5,c)+gem(9,-61,3,c)+gem(11,1,3,c)+emblem('bolt',13,-48,5,c);
        break;
      default:return '';
    }
    return s;
  }
  function weapon(p,c){
    const v=p.variation, motif=p.motif;
    const signature=signatureWeapon(p,c);if(signature)return signature;
    let s='';
    if(['sword','greatsword','dagger','katana','rapier','cutlass'].includes(p.form)){
      const len=p.form==='dagger'?48:p.form==='greatsword'?86:78, w=p.form==='greatsword'?11:p.form==='rapier'?3:6+(v%3);
      let d=`M0 ${-len} L${w} ${-len+15} L${w-1}-12 L0-6 L${-w+1}-12 L${-w} ${-len+15} Z`;
      if(p.form==='katana'||p.form==='cutlass')d=`M-4-8 Q${p.form==='cutlass'?26:19}-40 8 ${-len} L15 ${-len+8} Q23-39 3-8 Z`;
      if(v===4||v===6||v===8)d=`M0 ${-len} L${w} ${-len+18} L${w-3} ${-len+28} L${w+2} ${-len+35} L${w-2} ${-len+45} L${w}-14 L0-6 L${-w}-14 L${-w+2} ${-len+45} L${-w-2} ${-len+35} L${-w+3} ${-len+28} L${-w} ${-len+18} Z`;
      s+=path(d,c.metal)+line(`M0 ${-len+5} L0-14`,c.light,1.3)+line(`M${w-2} ${-len+17} L${w-3}-17`,c.dark,.8);
      if(p.form==='greatsword')s+=path(`M0 ${-len+15} L4 ${-len+23} L3-22 L0-17 L-3-22 L-4 ${-len+23} Z`,c.dark,c.light,.7)+emblem(motif,0,-49,5,c);
      else if(p.form==='katana'||p.form==='cutlass')s+=line('M9-64 Q13-34 1-13',c.light,1.1);
      else s+=emblem(motif,0,-28,p.form==='rapier'?2.5:4,c);
      const guard=p.form==='rapier'?path('M-10-12 Q18-19 12 2 Q7 10 1 3 Q-1-3 4-8', 'none',c.trim,2.5):path(`M-${13+v%3}-9 L-12-15 L-5-13 L0-16 L5-13 L12-15 L${13+v%3}-9 L6-8 L0-10 L-6-8 Z`,c.trim);
      s+=guard+grip(c)+gem(0,-10,3.1,c);
      if(v>=3)s+=scroll(0,-17,.6,c);
      if(v===7||v===8)s+=emblem(motif,0,-59,5,c);
      if(p.id==='excalibur')s+=path('M-5-18 L-11-35 L-19-41 L-15-25 L-24-28 L-18-16 M5-18 L11-35 L19-41 L15-25 L24-28 L18-16',c.trim)+gem(0,-54,5,c)+emblem('crown',0,-71,5,c);
      if(p.id==='obsidian_greatsword')s+=path('M-10-69 L-19-59 L-14-46 L-21-34 L-13-27 M10-69 L19-59 L14-46 L21-34 L13-27',c.metal)+line('M-12-55 L-16-36 M12-55 L16-36',c.glow,1.1)+gem(0,-49,4,c);
      if(p.id==='dragon_blade')s+=path('M-3-12 L-10-26 L-19-29 L-16-18 L-24-15 L-14-8 M3-12 L10-26 L19-29 L16-18 L24-15 L14-8',c.metal)+gem(0,-30,4,c)+rivets([[-17,-18],[17,-18]],c,1.3);
      if(p.id==='frost_brand')s+=polygon('-6,-16 -19,-28 -15,-12 -6,-9',c.jewel)+polygon('6,-16 19,-28 15,-12 6,-9',c.jewel);
      if(p.id==='flame_sword')s+=path('M-6-17 Q-18-18-14-31 Q-12-24-8-27 L-3-14 M6-17 Q18-18 14-31 Q12-24 8-27 L3-14',c.trim);
      if(p.id==='elven_blade')s+=emblem('leaf',-10,-15,8,c)+emblem('leaf',10,-15,8,c);
      if(p.form==='cutlass')s+=path('M-12-10 Q-18 8-1 12', 'none',c.trim,2.3);
      if(p.form==='dagger')s+=path('M-5-7 L-13 2 L-10 4 L-2-2 M5-7 L13 2 L10 4 L2-2',c.trim);
      return s;
    }
    if(p.form==='bow'){
      const top=-76+(v===0?17:0), reach=19+v%4;
      s+=path(`M0 ${top} Q${reach+10} ${top+13} ${reach-3}-30 Q${reach+12} 0 0 21 L3 12 Q${reach+1}-6 ${reach-9}-30 Q${reach+2} ${top+19} 3 ${top+8} Z`,c.metal);
      s+=line(`M0 ${top} L-13-28 L0 21`,c.light,1)+line('M-19-28 H27',c.dark,2)+line('M-19-29 H27',c.trim,1)+polygon('29,-29 21,-34 23,-28 21,-23',c.metal);
      s+=path('M-19-28 L-25-33 L-26-28 L-25-23 Z',c.cloth)+gem(reach-3,-30,4,c)+scroll(reach-4,-49,.6,c);
      if(v>=2)s+=path(`M9 ${top+12} L-2 ${top+3} L4 ${top+22} M11 9 L-1 21 L5-1`,c.trim)+emblem(motif,reach-3,-55,5,c);
      if(p.id==='stormpiercer')s+=path('M6-68 L16-58 L10-47 L20-38 L14-24 L20-12 L10-4 L14 8', 'none',c.trim,2.5)+gem(13,-56,3,c)+gem(13,-7,3,c)+polygon('-11,-28 -5,-35 0,-28 -5,-21',c.jewel);
      return s;
    }
    // Staffs and polearms share a wrapped shaft, never a generic icon outline.
    s+=path('M-2.8-64 Q-1-68 2.8-64 L2.8 22 L-2.8 22 Z',c.cloth)+line('M-1.4-61 V18',c.light,.9);
    for(let y=-12;y<19;y+=4)s+=line(`M-3 ${y} L3 ${y-2}`,c.trim,1.4);
    s+=gem(0,21,2.5,c);
    if(p.form==='staff'||p.form==='wand'){
      const y=p.form==='wand'?-51:-66;
      if(p.form==='wand')s+=path('M-2-60 H2 V-48 H-2Z',c.trim);
      if(v===1||v===3)s+=path(`M-2 ${y+17} Q-22 ${y+3}-11 ${y-13} Q-10 ${y+4} 0 ${y+5} Q15 ${y+1} 11 ${y-13} Q23 ${y+6} 2 ${y+18}`,c.metal)+emblem('leaf',-12,y-4,7,c)+emblem('leaf',10,y+1,6,c);
      else if(v===2)s+=path(`M0 ${y+12} Q-19 ${y+5}-8 ${y-10} L-5 ${y-2} Q2 ${y-11} 0 ${y-22} Q20 ${y-4} 6 ${y+9} Z`,c.metal)+gem(0,y,6,c);
      else if(v===5||v===7)s+=polygon(`0,${y-20} 10,${y-7} 5,${y+12} -6,${y+12} -11,${y-7}`,c.jewel)+line(`M0 ${y-19} L-3 ${y+11} M0 ${y-19} L8 ${y-6} L-3 ${y+11}`,c.light,1.1)+polygon(`-10,${y+10} -17,${y-8} -10,${y-12} -4,${y+10}`,c.metal);
      else if(v===8)s+=circle(0,y,16,c.dark,c.trim,2)+circle(4,y-3,12,c.metal)+circle(7,y-6,11,c.dark)+star(-6,y+5,6,c.jewel);
      else if(v===9)s+=path(`M-1 ${y+17} V${y-6} C-1 ${y-28} 27 ${y-17} 19 ${y-2} C12 ${y+10} 2 ${y-2} 11 ${y-8}`, 'none',c.trim,5)+gem(12,y-6,4,c);
      else s+=circle(0,y,14,c.dark,c.trim,2)+ellipse(0,y,18,7,'none',c.trim,1)+gem(0,y,9,c)+path(`M-12 ${y+9} L-7 ${y+17} H7 L12 ${y+9}`,c.metal);
      s+=emblem(motif,0,y,v===8?4:6,c)+scroll(0,y+21,.5,c);
      if(v===3)s+=path(`M0 ${y+14} Q-16 ${y+22}-18 ${y+6} M0 ${y+8} Q15 ${y+18} 18 ${y+1}`,'none',c.trim,2)+gem(-17,y+6,3,c)+gem(18,y+1,3,c)+emblem('leaf',-11,y+17,5,c);
      if(v>=10)s+=star(-17,y-13,4,c.light)+star(17,y+9,3,c.light)+ellipse(0,y,20,12,'none',c.glow,.8);
      if(p.id==='royal_crook')s+=path('M-4-45 L-15-55 L-18-72 L-11-66 L-7-71 L-4-61',c.trim)+gem(-12,-59,4,c)+emblem('crown',0,-32,5,c);
      if(p.id==='rune_staff')s+=path('M-7-81 L-15-75 L-13-53 L-6-47 M7-81 L15-75 L13-53 L6-47',c.metal)+line('M-10-72 L-8-67 L-11-62 M10-72 L8-67 L11-62',c.light,1.2);
      if(p.id==='sun_scepter')s+=circle(0,y,22,'none',c.trim,1)+[-1,1].map(side=>group(`scale(${side},1)`,path(`M8 ${y+15} L18 ${y+5} L15 ${y+23} L6 ${y+27}`,c.trim))).join('');
      if(p.form==='wand')s+=star(0,y,18,c.trim,5)+gem(0,y,6,c)+line('M-6-21 L7-24 M-6-16 L7-19',c.trim,1.5);
    }else if(p.form==='axe'){
      const split=v===2;
      s+=path(`M-3-63 Q-17-76-27-62 L-27-34 Q-17-47-3-47 M3-63 Q17-76 27-62 L27-34 Q17-47 3-47`,c.metal)+line('M-25-60 V-39 M25-60 V-39',c.light,1.3)+gem(0,-56,4,c)+emblem(motif,15,-53,5,c)+emblem(motif,-15,-53,5,c);
      if(split)s+=polygon('-26,-64 -18,-79 -10,-63',c.metal)+polygon('26,-64 18,-79 10,-63',c.metal);
      else if(v===1)s+=line('M-23-46 L-18-54 M23-46 L18-54',c.dark,2);
    }else if(p.form==='hammer')s+=path('M-21-76 H21 L25-70 V-51 L21-47 H-21 L-25-51 V-70 Z',c.metal)+path('M-18-76 V-47 M18-76 V-47','none',c.trim,3)+emblem(motif,0,-61,9,c)+rivets([[-21,-68],[-21,-54],[21,-68],[21,-54]],c,1.5);
    else if(p.form==='scythe'){
      s+=path(`M4-66 Q-19-82-30-45 Q-12-62 4-53 Z`,c.metal)+line('M-26-51 Q-14-72 2-63',c.light,1.3)+gem(0,-60,4,c)+emblem(motif,-13,-63,5,c);
      if(v)s+=ellipse(-10,-64,15,18,'none',c.trim,1)+star(-20,-78,3,c.light);
    }else if(p.form==='spear')s+=polygon('0,-89 9,-66 3,-56 -3,-56 -9,-66',c.metal)+line('M0-87 V-57',c.light,1.2)+gem(0,-56,3,c)+path('M-4-55 L-12-35 L-5-39 L-1-50',c.cloth)+emblem(motif,0,-69,4,c);
    else if(p.form==='trident')s+=path('M-2-89 L-7-69 L-3-71 V-55 H-13 V-74 L-19-83 L-21-66 L-17-51 H17 L21-66 L19-83 L13-74 V-55 H3 V-71 L7-69 Z',c.metal)+emblem(motif,0,-57,6,c)+gem(0,-48,4,c);
    else s+=path('M0-89 L7-71 L3-65 Q25-71 27-47 Q14-56 3-51 L3-42 L-3-42 V-53 L-16-58 L-3-64 L-7-71 Z',c.metal)+line('M0-85 V-48 M7-64 Q21-64 24-51',c.light,1.2)+gem(0,-48,4,c)+emblem(motif,13,-59,5,c)+(v?path('M-4-60 Q-19-69-25-57 L-9-47 Z',c.trim):'');
    if(p.id==='golden_trident')s+=path('M-18-61 Q-31-52-21-42 Q-12-36-9-44 M18-61 Q31-52 21-42 Q12-36 9-44', 'none',c.trim,2.2)+gem(-18,-48,3,c)+gem(18,-48,3,c)+emblem('wave',0,-31,5,c);
    if(p.id==='crown_halberd')s+=path('M-4-64 L-15-72 L-24-61 L-19-52 L-27-49 L-14-44 L-3-51',c.trim)+emblem('crown',-15,-59,5,c)+gem(0,-37,3,c);
    return s;
  }
  function shield(p,c){
    const forms={heater:'M0-29 L22-21 V0 Q21 19 0 31 Q-21 19-22 0 V-21Z',kite:'M0-29 L21-13 L16 11 L0 31 L-16 11 L-21-13Z',tower:'M-20-29 H20 L23-23 V25 L17 31 H-17 L-23 25 V-23Z',scale:'M0-29 L8-24 L15-26 L22-15 L19-8 L24-2 L17 17 L0 31 L-17 17 L-24-2 L-19-8 L-22-15 L-15-26 L-8-24Z',star:'M0-29 L8-15 L22-19 L19-4 L25 7 L11 12 L0 31 L-11 12 L-25 7 L-19-4 L-22-19 L-8-15Z',winged:'M0-26 L12-19 L24-25 L21-5 L24 8 L12 18 L0 31 L-12 18 L-24 8 L-21-5 L-24-25 L-12-19Z',crystal:'M0-30 L20-19 L23 9 L0 31 L-23 9 L-20-19Z',crescent:'M0-29 Q26-23 22-1 Q19 24 0 31 Q-19 24-22-1 Q-26-23 0-29Z'};
    let s='';
    if(p.form==='book'){
      s+=path('M-20-24 H16 L21-19 V25 H-17 L-21 20 Z',c.cloth)+path('M-16-21 H16 V21 H-16Z',c.metal)+path('M-12-17 H12 V17 H-12Z',c.dark,c.trim,1)+line('M-20-17 V17 M-17 21 H18 M-17 24 H18',c.light,1)+emblem('eye',0,0,10,c)+path('M-5-25 H2 V-14 L-1-17 L-5-14Z',c.trim)+gem(15,0,3,c);
    }else{
      const d=forms[p.form];
      s+=p.form==='round'||p.form==='sun'?circle(0,1,p.form==='sun'?21:p.variation?22:24,c.metal,c.dark,1.6):p.form==='oval'?ellipse(0,1,21,29,c.metal,c.dark,1.6):path(d||forms.heater,c.metal);
      s+=group('translate(0,1) scale(.82)',d?path(d,c.cloth,c.trim,1.5):ellipse(0,0,22,27,c.cloth,c.trim,1.5));
      if(p.material==='timber')s+=[-12,-6,0,6,12].map(x=>line(`M${x}-18 Q${x+2} 0 ${x} 20`,c.dark,.8)).join('');
      if(p.form==='scale')for(let y=-14;y<17;y+=7)for(let x=-12;x<=12;x+=8)s+=line(`M${x-3} ${y} Q${x} ${y+5} ${x+3} ${y}`,c.light,.8);
      if(p.form==='crystal')s+=line('M0-26 L-17-16 L0 0 L17-16 L0-26 V27 M-17-16 L-19 8 L0 27 L19 8 L17-16 M-19 8 L0 0 L19 8',c.glow,1);
      if(p.form==='sun')for(let a=0;a<12;a++)s+=group(`rotate(${a*30} 0 1)`,polygon('-2,-18 0,-24 2,-18',c.trim));
      s+=scroll(0,-13,.75,c)+emblem(p.motif,0,2,12,c)+gem(0,16,3,c)+rivets([[-16,-17],[16,-17],[-18,1],[18,1],[-10,19],[10,19]],c,1.1);
      if(p.form==='crescent')s+=path('M7-16 A17 17 0 1 0 7 19 A14 14 0 0 1 7-16Z',c.trim,'none')+star(11,-2,5,c.jewel);
      if(p.form==='winged')s+=path('M-8-7 L-20-16 L-15-4 L-22-6 L-13 4 M8-7 L20-16 L15-4 L22-6 L13 4','none',c.trim,2);
    }
    return s;
  }
  function armor(p,c){
    const v=p.variation, robe=p.form==='robe', bottom=robe?98:79;
    let d=`M22 11 Q50 3 78 11 L${robe?89:84} ${bottom} Q50 ${bottom+5} ${robe?11:16} ${bottom}Z`;
    let s=path(d,c.cloth)+path('M16 13 Q24 5 34 13 L29 27 L8 23Z',c.metal)+path('M84 13 Q76 5 66 13 L71 27 L92 23Z',c.metal);
    if(p.form==='plate'){
      s+=path(`M25 14 L50 9 L75 14 L76 40 L64 58 H36 L24 40Z`,c.metal)+path('M50 12 V54 M26 29 L45 36 M74 29 L55 36','none',c.light,1.5);
      for(let y=52;y<75;y+=7)s+=path(`M${29-(y-52)/4} ${y} Q50 ${y+5} ${71+(y-52)/4} ${y} L${72+(y-52)/4} ${y+6} Q50 ${y+11} ${28-(y-52)/4} ${y+6}Z`,c.metal,c.dark,.9);
      if(v>=2)s+=polygon(`9,16 14,${v===2?-1:4} 23,14 30,6 31,22`,c.trim)+polygon(`91,16 86,${v===2?-1:4} 77,14 70,6 69,22`,c.trim);
      if(v>=4)s+=path('M29 21 L36 14 L42 25 M71 21 L64 14 L58 25',c.trim)+gem(50,29,6,c);
    }else if(p.form==='chain'||p.form==='scale'){
      for(let row=0;row<7;row++)for(let col=0;col<7;col++){
        const x=26+col*8+(row%2)*2,y=22+row*6.5;
        s+=p.form==='chain'?ellipse(x,y,3,2,'none',col%2?c.light:c.base,.9):path(`M${x-4} ${y-2} Q${x} ${y-5} ${x+4} ${y-2} Q${x+3} ${y+3} ${x} ${y+5} Q${x-3} ${y+3} ${x-4} ${y-2}`,c.metal,c.dark,.55);
      }
      s+=path('M24 13 Q50 5 76 13 L72 21 Q50 14 28 21Z',c.trim)+gem(50,19,4,c);
      if(v)s+=path('M15 12 L12 1 L24 9 L31 4 L34 19 M85 12 L88 1 L76 9 L69 4 L66 19',c.metal);
    }else if(robe){
      s+=path('M29 10 L48 28 L40 88 L23 94 L34 30 L22 15 M71 10 L52 28 L60 88 L77 94 L66 30 L78 15',c.metal,c.dark,1)+line('M21 92 Q50 100 79 92 M27 68 L24 89 M73 68 L76 89',c.trim,1.5);
      for(let y=39;y<85;y+=17)s+=emblem(p.motif,50,y,5,c);
      if(v)s+=path('M17 14 L26 7 L36 24 L28 31 L11 25 M83 14 L74 7 L64 24 L72 31 L89 25',c.trim);
      if(v===3)s+=path('M30 75 L24 96 L38 89 L50 99 L62 89 L76 96 L70 75',c.trim,c.dark,1);
    }else{
      s+=line('M29 18 L28 63 M71 18 L72 63 M34 74 H66',c.light,1,'stroke-dasharray="2 3"');
      s+=path(v===2?'M25 17 L72 46 L69 55 L22 26Z':'M23 16 L32 13 L75 52 L69 61Z',c.metal,c.dark,1)+rivets([[30,20],[40,30],[51,40],[63,51]],c,1.2);
      if(v===1)s+=path('M20 49 H36 V64 H20Z',c.cloth,c.trim,1)+circle(28,53,2,c.trim);
      s+=emblem(p.motif,56,32,9,c);
    }
    s+=path('M20 68 H80 V76 H20Z',c.dark,c.trim,1)+path('M43 67 H57 V77 H43Z',c.trim)+path('M46 70 H54 V74 H46Z',c.dark,'none');
    if(!robe)s+=emblem(p.motif,50,39,p.form==='plate'?10:7,c);
    return s;
  }
  function helmet(p,c,custom){
    let s='';const v=p.variation;
    if(p.form==='halo'){
      s+=ellipse(50,43,43,17,'none',c.dark,9)+ellipse(50,40,43,17,'none',c.trim,6)+ellipse(50,40,35,11,'none',c.glow,1.3);
      for(let i=0;i<7;i++)s+=star(16+i*11,48-Math.sin(i*Math.PI/6)*23,3,c.light);
      return s+gem(50,59,5,c)+path('M13 54 L2 35 L17 42 M87 54 L98 35 L83 42',c.trim);
    }
    if(p.form==='circlet'){
      s+=path('M4 51 Q50 82 96 51 L92 71 Q50 98 8 71Z',c.metal)+line('M8 57 Q50 85 92 57',c.light,1.5);
      s+=path(v?'M16 55 Q28 15 42 44 L50 9 L58 44 Q72 15 84 55':'M18 60 L29 38 L42 56 L50 23 L58 56 L71 38 L82 60',c.trim);
      return s+gem(50,56,12,c)+gem(24,64,4,c)+gem(76,64,4,c)+emblem(p.motif,50,56,7,c);
    }
    if(p.form==='hat'){
      s+=path(v?'M23 57 Q30 33 31 6 Q59 9 68 34 L75 57Z':'M25 57 L48 4 Q49 18 61 29 L75 57Z',c.cloth)+path('M6 60 Q50 46 94 60 Q99 72 50 78 Q1 72 6 60Z',c.metal)+path('M24 51 Q50 62 76 51 L78 60 Q50 71 22 60Z',c.trim);
      s+=emblem(p.motif,49,35,12,c)+gem(50,59,5,c)+line('M42 16 L36 43',c.light,1)+star(61,43,3,c.light);
      if(v)s+=path('M32 8 Q63-5 73 20 Q58 10 56 28',c.cloth)+circle(68,23,3,c.jewel);
      return s;
    }
    if(p.form==='band')return path('M10 63 Q50 53 90 63 L89 75 Q50 65 11 75Z',c.cloth)+path('M85 68 L98 89 L86 84 L80 72 M84 65 L98 72 L91 75 L79 72',c.metal)+line('M14 66 Q50 59 85 66',c.light,1)+emblem(p.motif,50,67,7,c)+rivets([[25,67],[75,67]],c,1.4);
    if(p.form==='crown'){
      s+=path(v?'M13 48 L8 27 L27 41 L34 16 L50 38 L66 16 L73 41 L92 27 L87 48 L85 67 Q50 80 15 67Z':'M15 52 L10 29 L30 44 L50 20 L70 44 L90 29 L85 52 L84 66 Q50 78 16 66Z',c.metal)+path('M15 57 Q50 70 85 57 V66 Q50 79 15 66Z',c.trim)+gem(50,52,8,c)+gem(26,57,4,c)+gem(74,57,4,c)+scroll(50,69,1.1,c);
      if(v)s+=ellipse(50,24,24,10,'none',c.glow,1.2)+star(50,19,7,c.jewel);
      return s;
    }
    if(p.form==='hood'){
      s+=path(v?'M49 27 Q9 31 6 77 L19 98 L24 70 Q50 47 76 70 L81 98 L94 77 Q91 31 49 27Z':'M50 30 Q13 29 9 77 L17 94 L27 66 Q50 48 73 66 L83 94 L91 77 Q87 29 50 30Z',c.cloth)+line('M18 84 Q16 49 50 39 Q84 49 82 84',c.light,1.6)+path('M30 47 L50 30 L70 47 L50 56Z',c.metal)+emblem(p.motif,50,45,7,c)+scroll(50,35,.6,c);
      return s;
    }
    const horns=p.form==='horns';
    if(horns){
      s+=path(v?'M26 52 L8 39 L4 4 L22 27 L37 40 M74 52 L92 39 L96 4 L78 27 L63 40':'M26 49 Q5 40 6 8 Q20 28 35 35 M74 49 Q95 40 94 8 Q80 28 65 35',c.metal)+line('M12 23 L23 29 M14 33 L28 36 M88 23 L77 29 M86 33 L72 36',c.dark,1.4);
    }
    const cap=p.form==='cap';
    s+=path(`M14 72 Q12 ${cap?37:29} 50 ${cap?36:29} Q88 ${cap?37:29} 86 72 L74 78 Q50 60 26 78Z`,c.metal)+path('M16 65 Q50 53 84 65 V73 Q50 63 16 73Z',c.trim)+line('M49 33 V62',c.light,2)+rivets([[24,63],[38,60],[62,60],[76,63]],c,1.4);
    if(cap)s+=path('M16 71 L8 81 L33 74Z',c.cloth)+line('M25 47 Q50 37 75 47',c.light,1,'stroke-dasharray="2 3"');
    else{s+=path('M18 69 H29 L27 92 L16 83Z M82 69 H71 L73 92 L84 83Z',c.metal)+gem(50,62,5,c);if(v===1||v===3)s+=path('M45 33 Q31 12 48 5 Q66 11 55 33Z',c.cloth)+line('M50 9 L49 31',c.trim,1.4);if(v===2)s+=polygon('30,36 30,12 43,32 50,6 57,32 70,12 70,36',c.jewel);}
    return s+emblem(p.motif,50,46,7,c);
  }
  function accessory(p,c){
    const v=p.variation;let s='';
    if(p.form==='wings'){
      for(const side of [-1,1]){
        let half='';
        if(v===0){
          half+=path('M49 82 Q31 24 4 4 L5 61 Q18 51 22 79 Q33 64 49 92Z',c.cloth)+line('M49 86 L4 5 L22 78 M4 5 L5 61 M4 5 Q28 39 37 79',c.trim,2)+gem(28,49,4,c);
        }else{
          for(let i=0;i<8;i++){const x=5+i*4.5,y=4+i*5.5;half+=path(`M48 84 Q${x+7} ${y+15} ${x} ${y} Q${x-5} ${y+28} ${18+i*3} ${67+i*3} Q35 92 48 91Z`,i%2?c.metal:c.trim,c.dark,.8);}
          half+=path('M49 79 Q40 44 23 33 Q32 65 45 87Z',c.metal)+line('M46 79 Q34 56 25 39',c.light,1.2);
          if(v===2)half+=emblem('infinity',28,65,10,c);if(v===3)half+=emblem('sun',29,56,10,c);
        }
        s+=side===-1?half:group('translate(100,0) scale(-1,1)',half);
      }
      return s+gem(50,83,5,c);
    }
    if(p.form==='cape'||p.form==='banner'){
      const bottom=v===3?'L71 89 L60 98 L50 90 L40 98 L29 89 L5 98':v===4?'L76 83 L83 100 L61 91 L50 99 L39 91 L17 100 L24 83 L5 98':'Q50 91 5 98';
      s+=path(`M26 3 Q50-1 74 3 L95 98 ${bottom} Z`,c.cloth)+line('M27 8 L13 90 M73 8 L87 90',c.trim,2)+line('M33 14 L26 82 M67 14 L74 82',c.light,1)+scroll(50,81,2,c)+emblem(p.motif,50,45,22,c);
      s+=path('M26 3 Q50 17 74 3 L70 13 Q50 25 30 13Z',c.metal)+gem(30,9,3,c)+gem(70,9,3,c);
      if(v===1||v===3)for(let i=0;i<4;i++)s+=emblem('leaf',19+i*2,30+i*15,5,c)+emblem('leaf',81-i*2,30+i*15,5,c);
      if(v===5)s+=star(34,35,3,c.light)+star(67,68,3,c.light)+line('M34 35 L45 58 L67 68',c.glow,.7);
      if(p.form==='banner')s+=path('M5 6 H95 V12 H5Z',c.metal)+circle(5,9,3,c.trim)+circle(95,9,3,c.trim)+path('M23 96 L33 86 L50 98 L67 86 L77 96',c.trim);
      return s;
    }
    s+=line('M5 3 Q14 17 29 27 Q50 38 71 27 Q86 17 95 3',c.dark,3)+line('M5 3 Q14 17 29 27 Q50 38 71 27 Q86 17 95 3',c.trim,1.7);
    for(let i=0;i<7;i++)s+=circle(17+i*11,17+Math.sin(i*Math.PI/6)*16,1.8,c.trim,c.dark,.5);
    if(p.form==='feather')s+=path('M49 34 Q21 51 36 91 Q75 85 73 46 Q65 30 49 34Z',c.metal)+line('M39 94 L64 43 M43 78 L63 70 M48 65 L66 55 M43 77 L39 61 M51 58 L49 44',c.dark,1.8);
    else if(p.form==='fang')s+=path('M35 39 Q67 29 65 58 Q64 84 35 96 Q51 69 35 39Z',c.metal)+path('M34 37 Q50 46 66 37 L64 49 Q50 58 36 49Z',c.trim)+emblem('dragon',50,44,7,c);
    else if(p.form==='dice')s+=group('rotate(-15 48 66)',path('M25 43 H62 L68 49 V84 L60 92 H25 L18 84 V51Z',c.metal)+path('M25 50 H59 V84 H25Z',c.dark,c.trim,1)+[ [31,57],[51,57],[41,67],[31,77],[51,77]].map(pt=>circle(...pt,3,c.light)).join(''))+gem(67,43,4,c);
    else if(p.form==='orb'||p.form==='orrery'){
      s+=circle(50,63,23,c.jewel,c.trim,2)+ellipse(50,63,37,10,'none',c.trim,2)+group('rotate(-48 50 63)',ellipse(50,63,33,13,'none',c.trim,1.6))+star(42,53,7,c.light)+gem(20,70,4,c)+gem(75,45,4,c);
      if(p.form==='orrery')s+=emblem('constellation',52,63,15,c)+star(50,30,5,c.light);
    }else if(p.form==='phoenix')s+=path('M50 86 Q25 90 13 52 L33 64 L21 36 L44 58 L50 39 L56 58 L79 36 L67 64 L87 52 Q75 90 50 86Z',c.metal)+gem(50,70,12,c)+line('M23 58 L42 77 M77 58 L58 77',c.light,2);
    else{
      s+=p.form==='medal'?circle(50,65,27,c.metal,c.dark,2):path(v===1?'M50 34 L76 55 L66 81 L50 96 L34 81 L24 55Z':v===2?'M50 34 L70 44 L78 65 L69 85 L50 95 L31 85 L22 65 L30 44Z':'M50 36 Q80 44 74 68 Q70 87 50 94 Q30 87 26 68 Q20 44 50 36Z',c.metal);
      s+=scroll(50,48,1.7,c)+gem(50,67,17,c)+emblem(p.motif,50,67,11,c)+rivets([[28,57],[72,57],[35,85],[65,85]],c,1.5);
    }
    return s+gem(50,33,4,c);
  }
  function pet(p,c,stage){
    // A bounded 100-unit drawing is fitted into each pet's own original box.
    // Evolution adds visible anatomy/equipment, rather than swapping to emoji.
    const v=p.variation, form=p.form;let s=ellipse(50,91,29,5,'#26334922');
    const eye=(x,y,r=3)=>circle(x,y,r+1,'#fff1d2')+circle(x+.4,y+.4,r,outline)+circle(x-.5,y-.8,r*.32,'#fff');
    const crest=()=>stage?path(stage===2?'M37 23 L38 11 L47 18 L52 7 L58 18 L67 11 L66 23Z':'M42 23 L45 13 L52 20 L59 13 L62 23Z',c.trim)+gem(52,21,3,c):'';
    if(['hound','cat','fox'].includes(form)){
      const fox=form==='fox', cat=form==='cat';
      s+=path(fox?'M61 66 Q91 44 91 74 Q85 95 62 86Z':cat?'M69 77 Q94 81 90 54 Q83 43 79 55':'M67 69 Q82 47 91 56 Q91 71 73 76',c.metal,c.dark,2);
      if(fox)s+=path('M84 59 Q96 80 79 86 L74 79Z',c.trim);
      s+=ellipse(50,70,26,20,c.cloth,c.dark,1.5)+path('M30 72 L28 89 Q36 96 43 89 L44 72 M59 74 L59 91 Q70 96 76 89 L71 73',c.metal);
      s+=path(cat||fox?'M25 35 L23 12 L42 23 Q54 18 65 25 L81 12 L77 41Z':'M28 27 Q5 20 14 57 L28 49 M69 27 Q92 23 87 56 L73 50',c.metal);
      s+=ellipse(51,42,28,23,c.metal,c.dark,1.5)+path('M29 47 Q37 34 51 44 Q65 34 76 47 Q70 67 51 64 Q34 66 29 47Z',c.trim,c.dark,.8)+eye(40,39)+eye(65,39)+polygon('47,49 56,49 52,54',outline,'none')+line('M52 54 V58 M45 58 Q52 63 59 58',c.dark,1.2);
      if(cat)s+=line('M31 48 L16 45 M31 53 L14 54 M72 48 L89 45 M72 53 L90 54',c.light,1.1);
      s+=path('M30 62 Q51 73 73 62 L71 71 Q51 80 32 71Z',c.cloth)+gem(52,71,5,c);
      if(stage)s+=path('M28 72 L37 67 L45 77 L32 83 M74 73 L67 66 L59 77 L72 84',c.metal)+emblem(p.motif,51,83,6,c);
      s+=crest();
    }else if(form==='turtle'){
      s+=path('M25 75 L18 88 L34 90 L39 78 M61 78 L69 91 L81 88 L75 75',c.trim)+ellipse(49,67,33,22,c.metal,c.dark,2);
      for(const [x,y] of [[34,61],[49,54],[64,61],[41,74],[59,74]])s+=polygon(`${x},${y-9} ${x+8},${y-4} ${x+8},${y+5} ${x},${y+10} ${x-8},${y+5} ${x-8},${y-4}`,c.cloth,c.trim,1.2);
      s+=ellipse(79,64,13,12,c.trim,c.dark,1.5)+eye(82,60,2.5)+line('M82 70 H89',c.dark,1)+path('M19 69 L6 74 L18 79',c.metal);
      if(stage)s+=path('M22 52 L30 35 L40 46 L51 26 L61 46 L72 35 L78 53',c.trim)+gem(50,44,stage===2?9:5,c);
    }else if(['penguin','bird','owl','phoenix','peacock'].includes(form)){
      if(form==='peacock')for(let i=0;i<9;i++){const a=(i-4)*.26,x=50+Math.sin(a)*37,y=42-Math.cos(a)*24;s+=group(`rotate(${(i-4)*10} 50 75)`,ellipse(50,36,8,31,i%2?c.metal:c.trim,c.dark,.8)+ellipse(50,23,5,9,c.cloth)+gem(50,23,3,c));}
      if(form==='phoenix')for(const dir of [-1,1])s+=group(`translate(50,52) scale(${dir},1)`,path('M-6 18 Q-39 14-43-23 L-25-9 L-33-32 L-12-10 L-4-23 L8 13Z',c.metal)+line('M-32-14 L-10 13 M-22-17 L-5 9',c.light,1.6));
      s+=path('M33 82 L27 93 H44 L46 82 M59 82 L59 93 H77 L68 82',c.trim)+ellipse(50,65,25,25,c.metal,c.dark,1.5)+ellipse(50,69,16,18,c.trim)+path('M27 55 Q9 67 19 81 L34 68 M73 55 Q91 67 81 81 L66 68',c.cloth);
      if(form==='owl')s+=path('M27 33 L24 12 L43 23 L57 23 L76 12 L73 33',c.metal);
      s+=ellipse(50,39,25,23,c.metal,c.dark,1.5);
      if(form==='owl')s+=ellipse(39,38,12,15,c.trim)+ellipse(61,38,12,15,c.trim)+eye(40,37,4.2)+eye(60,37,4.2);
      else s+=path('M28 33 Q38 20 49 37 Q61 20 73 33 L68 51 Q49 64 32 51Z',c.trim)+eye(40,37,3)+eye(61,37,3);
      s+=polygon('45,47 56,47 50,56',c.light,c.dark,.8)+emblem(p.motif,50,71,8,c);
      if(form==='bird'||form==='phoenix')s+=path('M43 20 L40 5 L49 13 L56 3 L62 21',c.trim);
      if(stage)s+=path('M23 53 L10 36 L16 69 L31 77 M77 53 L90 36 L84 69 L69 77',c.metal)+crest();
      if(stage===2)s+=star(15,27,5,c.glow)+star(85,24,5,c.glow);
    }else if(form==='wisp'){
      s+=path(v?'M48 87 Q5 77 24 43 L32 53 Q30 24 52 7 Q48 35 72 41 Q96 65 75 82 L62 92 L65 76Z':'M48 87 Q15 85 17 56 Q16 25 50 13 Q85 26 83 56 Q85 79 67 84 L64 94 L53 87 L43 95Z',c.jewel,c.dark,1.5)+ellipse(46,40,19,17,'#ffffff44')+eye(38,53,3)+eye(61,53,3)+line('M42 65 Q50 72 59 64',c.dark,1.5)+emblem(p.motif,50,31,9,c);
      if(stage)s+=ellipse(50,65,41,12,'none',c.trim,2)+gem(13,65,4,c)+gem(86,65,4,c);
      if(stage===2)s+=star(15,27,6,c.light)+star(85,27,6,c.light)+crest();
    }else if(form==='unicorn'){
      s+=path('M31 71 Q12 57 10 80 L22 91 L24 78',c.cloth)+ellipse(49,69,25,16,c.metal,c.dark,1.5)+path('M32 71 L30 90 H41 L45 73 M60 74 L63 92 H73 L69 69',c.trim);
      s+=path('M62 66 Q61 48 52 40 L57 20 L75 23 L85 38 L92 43 L87 54 L70 53 L73 67Z',c.metal)+path('M57 24 Q38 28 44 63 L56 57 L48 51 L59 45 L50 41 L61 35Z',c.cloth)+polygon('66,23 70,2 75,25',c.trim)+eye(73,35,2.4)+line('M81 47 L87 47',c.dark,1)+emblem('star',44,65,9,c);
      if(stage)s+=path('M45 58 Q29 30 11 29 Q12 49 42 69 M43 58 Q24 46 19 32',c.trim);
      if(stage===2)s+=ellipse(73,12,17,5,'none',c.trim,2)+gem(40,65,4,c);
    }else{
      if(form==='wyrm')s+=path('M26 49 C2 45 2 87 37 89 C69 91 69 63 47 68 C33 71 41 81 50 75 M36 74 Q12 65 32 55', 'none',c.metal,12)+line('M25 85 Q46 87 52 78',c.light,1.5);
      else s+=path('M41 66 Q16 66 12 84 Q21 93 31 81 L47 83',c.metal)+ellipse(53,71,23,17,c.metal,c.dark,1.5)+path('M41 74 L33 91 H48 L52 78 M63 76 L65 91 H80 L72 72',c.trim);
      for(const dir of [-1,1])s+=group(`translate(53,53) scale(${dir},1)`,path(`M-2 10 L-8-23 L-32-${stage?28:17} L-29 6 L-19-1 L-14 16Z`,c.cloth)+line('M-8-22 L-14 13 M-8-22 L-29 4',c.trim,1));
      s+=path('M35 37 L31 15 L46 24 L61 23 L76 13 L71 39',c.trim)+ellipse(54,43,25,20,c.metal,c.dark,1.5)+path('M35 44 Q54 34 77 45 L76 58 Q51 67 36 54Z',c.trim)+eye(44,38,3)+eye(66,38,3)+circle(64,52,1.3,c.dark)+circle(72,50,1.3,c.dark)+line('M46 54 Q54 59 62 56',c.dark,1.1)+emblem(p.motif,53,72,8,c);
      if(v===1)s+=star(52,25,7,c.jewel);if(v===2||form==='wyrm')s+=line('M34 45 Q17 36 18 51 M75 44 Q93 34 92 51',c.trim,1.5);
      if(stage)s+=path('M40 66 L36 56 L49 62 L55 54 L61 63 L71 57 L68 69',c.metal)+gem(54,66,5,c);
      if(stage===2)s+=crest()+star(14,18,5,c.light)+star(86,19,5,c.light);
    }
    return s;
  }
  function item(it, options) {
    if(!it||!boxes[it.slot])return '';
    const stage=it.slot==='pet'?Math.max(0,Math.min(2,Math.floor(Number(options&&options.stage)||0))):0;
    const profile=profiles[it.id]||{slot:it.slot,form:{weapon:'sword',shield:'heater',armor:'plate',helmet:'helm',accessory:it.layer==='back'?'cape':'pendant',pet:'dragon'}[it.slot],material:'royal',motif:'compass',variation:0};
    const requested=String(it.box||'').trim().split(/\s+/).map(Number);
    const box=requested.length===4&&requested.every(Number.isFinite)&&requested[2]>0&&requested[3]>0?requested:boxes[it.slot];
    const key=[it.id,it.slot,stage,box.join(',')].join('|');
    let template=cache.get(key);
    if(!template){
      const d=defs(profile);let body;
      if(it.slot==='weapon')body=weapon(profile,d.c);
      else if(it.slot==='shield')body=shield(profile,d.c);
      else{
        const render={armor,helmet,accessory,pet}[it.slot];
        body=render(profile,d.c,it.slot==='pet'?stage:!!it.box);
        body=group(`translate(${box[0]},${box[1]}) scale(${box[2]/100},${box[3]/100})`,body);
      }
      template=d.body+`<g class="rpg-vector-item" data-art-slot="${it.slot}" data-art-stage="${stage}">${body}</g>`;
      if(cache.size>=256)cache.delete(cache.keys().next().value);
      cache.set(key,template);
    }
    return template.replace(/__ID__/g,`rpgv${++serial}_`);
  }
  root.RpgSvgArt=Object.freeze({item,profiles,ids:Object.freeze(Object.keys(profiles)),version:1});
})(globalThis);
