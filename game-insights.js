// Admin-only presentation of observed game activity. No writes or SDK imports.
const DAY = 86400000, SGT = 8 * 3600000;
export const GAME_INSIGHTS_CATALOG = Object.freeze([
  ['defenders','Science Defenders','🧪',true],['raiders','Science Raiders','👾',true],
  ['spire','Science Spire','🃏',true],['legends','Science Legends','⚔️',true],
  ['slayers','Science Slayers','🗡️',true],['fps','Science Strike','🔫',true],
  ['hades','Hades Sanctuary','🔥',true],['grand-line','Crew Defense','🃏',true],
  ['tcg-train','Embers Training','🎓',true],['tcg-duel','Ember Duel','🎴',true],
  ['tcg-siege','Ember Siege','🌋',true],['tcg-legends','Ember Legends','⚔️',true],
  ['pirate-rift','Pirate Rift','🏴‍☠️',false],['adventure','Adventure','🏰',false],
  ['ghost-arena','Ghost Arena','👻',false],['tcg-arena','Battle Arena','🛡️',false],
  ['tcg-dungeon','Infinite Dungeon','🏰',false]
].map(([id,name,icon,questions])=>Object.freeze({id,name,icon,questions})));
const catalog = new Map(GAME_INSIGHTS_CATALOG.map(g=>[g.id,g]));
const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const finite = value => typeof value === 'number' && Number.isFinite(value);
const count = value => finite(value) ? Math.min(1000000,Math.max(0,value)) : 0;
const dayOf = at => new Date(at+SGT).toISOString().slice(0,10);
export function gameInsightTime(value) {
  try {
    if (finite(value)) return value;
    if (value?.toMillis) return value.toMillis();
    if (value?.toDate) return value.toDate().getTime();
    if (finite(value?.seconds)) return value.seconds*1000;
    return typeof value==='string' ? Date.parse(value) || 0 : 0;
  } catch { return 0; }
}
function credit(attempt) {
  const total=Number(attempt.totalBlanks);
  if (!Number.isFinite(total)||total<=0) return null;
  const override=attempt.override?.score;
  const raw=override!=null&&override!==''&&Number.isFinite(Number(override)) ? override : attempt.score;
  if (raw==null||raw===''||!Number.isFinite(Number(raw))) return null;
  return Math.max(0,Math.min(1,Number(raw)/total));
}
export function aggregateGameInsights({attempts=[],profiles=[],dailySummaries=[],excludedUids=[],now=Date.now(),days=30,coverage={}}={}) {
  days=[7,30,90].includes(Number(days))?Number(days):30;
  const today=Date.parse(dayOf(now)+'T00:00:00+08:00');
  const currentCut=today-(days-1)*DAY, previousCut=currentCut-days*DAY;
  const excluded=new Set(excludedUids), seen=new Set(), allPlayers=new Set();
  for (const p of profiles) if(p.retired||p.supersededBy||(p.role&&p.role!=='student')) { if(p.uid)excluded.add(p.uid);if(p.id)excluded.add(p.id); }
  const rows=GAME_INSIGHTS_CATALOG.map(g=>({...g,hasQuestions:g.questions,players:0,questions:0,graded:0,accuracy:null,returners:0,returnRate:null,
    previousPlayers:0,trend:null,lastAt:0,answerMs:0,timedAnswers:0,quickAnswers:0,starts:0,activeMs:0,completedRuns:0,wins:0,losses:0,
    measuredPlay:false,measuredStarts:false,measuredTime:false,measuredCompletions:false,questionDays:new Map(),playerDays:new Map(),questionPlayers:new Set(),previousQuestionPlayers:new Set(),daily:new Map()}));
  const byId=new Map(rows.map(g=>[g.id,g]));
  function addPlayer(row,uid,day) { if(!row.playerDays.has(uid))row.playerDays.set(uid,new Set());row.playerDays.get(uid).add(day);allPlayers.add(uid); }
  for (const a of attempts) {
    const row=byId.get(String(a.mode||'')),uid=String(a.uid||''),at=gameInsightTime(a.timestamp);
    if(!row||!row.hasQuestions||!uid||excluded.has(uid)||!at||at<previousCut||at>now)continue;
    const key=a.id||a._id;
    if(key&&seen.has(key))continue;if(key)seen.add(key);
    if(at<currentCut){row.previousQuestionPlayers.add(uid);continue;}
    const day=dayOf(at);addPlayer(row,uid,day);row.questionPlayers.add(uid);row.questions++;
    row.lastAt=Math.max(row.lastAt,at);row.daily.set(day,(row.daily.get(day)||0)+1);
    const c=credit(a);if(c!==null){row.graded++;row._credit=(row._credit||0)+c;}
    const ms=Number(a.ms);if(Number.isFinite(ms)&&ms>0&&ms<=3600000){row.answerMs+=ms;row.timedAnswers++;if(ms<4000)row.quickAnswers++;}
  }
  // The collector adapter supplies daily records rather than leaking player docs
  // into the renderer. Player-account sets prevent double counting answer logs.
  for(const s of dailySummaries){
    const row=byId.get(String(s.gameId||s.mode||'')),uid=String(s.uid||'');
    if(!row||!uid||excluded.has(uid)||!/^\d{4}-\d{2}-\d{2}$/.test(s.day||''))continue;
    const at=Date.parse(s.day+'T00:00:00+08:00');if(!Number.isFinite(at)||dayOf(at)!==s.day||at<currentCut||at>today)continue;
    const starts=count(s.starts),activeMs=finite(s.activeMs)?Math.min(DAY,Math.max(0,s.activeMs)):0,completed=count(s.completedRuns);
    row.measuredPlay=true;row.measuredStarts ||= Object.hasOwn(s,'starts');row.measuredTime ||= Object.hasOwn(s,'activeMs');row.measuredCompletions ||= Object.hasOwn(s,'completedRuns');row.starts+=starts;row.activeMs+=activeMs;row.completedRuns+=completed;row.wins+=count(s.wins);row.losses+=count(s.losses);
    if(starts||activeMs||completed){addPlayer(row,uid,s.day);row.lastAt=Math.max(row.lastAt,gameInsightTime(s.lastAt)||at);}
  }
  for(const row of rows){
    row.players=row.playerDays.size;row.returners=[...row.playerDays.values()].filter(d=>d.size>=2).length;
    row.returnRate=row.players?row.returners/row.players:null;row.accuracy=row.graded?(row._credit||0)/row.graded:null;
    row.previousPlayers=row.previousQuestionPlayers.size;
    row.trend=!coverage.attemptsTruncated&&row.previousPlayers ? (row.questionPlayers.size-row.previousPlayers)/row.previousPlayers : null;
    row.daily=[...row.daily].map(([day,questions])=>({day,questions})).sort((a,b)=>a.day.localeCompare(b.day));
    row.measured=row.questions>0||row.measuredPlay;
    delete row._credit;delete row.playerDays;delete row.questionDays;delete row.questionPlayers;delete row.previousQuestionPlayers;
  }
  rows.sort((a,b)=>b.players-a.players||b.questions-a.questions||a.name.localeCompare(b.name));
  let rank=0;for(const row of rows)row.rank=row.players?++rank:null;
  const totalQuestions=rows.reduce((s,r)=>s+r.questions,0),graded=rows.reduce((s,r)=>s+r.graded,0);
  return {days,now,currentCut,previousCut,rows,coverage,totalQuestions,players:allPlayers.size,
    accuracy:graded?rows.reduce((s,r)=>s+(r.accuracy||0)*r.graded,0)/graded:null,
    measuredGames:rows.filter(r=>r.measured).length,activeMs:rows.reduce((s,r)=>s+r.activeMs,0)};
}

const number = n=>Math.round(n).toLocaleString('en-SG');
const percent = n=>n==null?'—':Math.round(n*100)+'%';
const duration = ms=>ms>0?(ms<60000?Math.round(ms/1000)+'s':Math.round(ms/60000)+'m'):'—';
function trend(row){return row.trend==null?'—':(row.trend>=0?'+':'')+Math.round(row.trend*100)+'%';}
function advice(data){
  const top=data.rows.find(r=>r.players),difficult=data.rows.filter(r=>r.graded>=20&&r.accuracy<.7).sort((a,b)=>b.players-a.players||a.accuracy-b.accuracy)[0];
  return [top?{title:'Most played by observed accounts',text:top.name+' leads with '+number(top.players)+' player accounts and '+number(top.questions)+' answers in this window.'}:{title:'Waiting for activity',text:'No game activity was recorded in this window. Widen the dates or refresh after students play.'},
    difficult?{title:'Review learning difficulty',text:difficult.name+' has '+percent(difficult.accuracy)+' accuracy across '+number(difficult.graded)+' graded answers. Check question difficulty and feedback before changing combat.'}:{title:'Read accuracy with its sample size',text:'A low score on a handful of answers is weak evidence. Games need at least 20 graded answers before they appear as a difficulty review.'},
    {title:'Compare reach before volume',text:'Player accounts are the default popularity measure. Games ask questions at different rates, so answer counts alone are not comparable playtime.'}];
}

export function createGameInsightsController(env){
  let generation=0,owner='',raw=null,data=null,selected='legends',days=30,loading=false;
  const host=()=>env.document.getElementById('gameInsightsRoot');
  const allowed=()=>!!(env.isAdmin()&&env.getUser()?.uid);
  function current(uid,epoch){return allowed()&&env.getUser().uid===uid&&generation===epoch;}
  function reset(){generation++;owner='';raw=null;data=null;loading=false;const h=host();if(h)h.replaceChildren();}
  function render(){
    const h=host();if(!h)return;
    if(!allowed()||env.getUser().uid!==owner){reset();return;}
    if(!data){h.innerHTML='<p class="gi-empty" role="status">'+(loading?'Loading recent game activity…':'No activity loaded.')+'</p>';return;}
    const rows=data.rows,active=rows.find(r=>r.id===selected)||rows[0];
    const warning=[data.coverage.attemptsTruncated?'The newest '+number(data.coverage.attemptLimit||20000)+' answers reached the read limit. Older activity may be missing; narrow the window. Trends are hidden.':'',data.coverage.boardsTruncated?'The launch-summary read limit was reached; some player accounts may be missing.':'',data.coverage.profilesTruncated?'The account-profile read limit was reached; account exclusions may be incomplete.':''].filter(Boolean).join(' ');
    h.innerHTML='<div class="gi-toolbar"><label>Window <select data-gi-days>'+[7,30,90].map(n=>'<option value="'+n+'"'+(n===days?' selected':'')+'>Last '+n+' days</option>').join('')+'</select></label><button type="button" class="btn btn-outline" data-gi-refresh'+(loading?' disabled':'')+'>'+(loading?'Refreshing…':'Refresh')+'</button><button type="button" class="btn btn-outline" data-gi-export>Export CSV</button><span class="gi-updated">Updated '+escape(new Date(data.now).toLocaleString('en-SG',{timeZone:'Asia/Singapore'}))+' SGT</span></div>'
      +(warning?'<p class="gi-warning" role="status">'+escape(warning)+'</p>':'')
      +'<div class="gi-summary">'+[['Player accounts',number(data.players)],['Game answers',number(data.totalQuestions)],['Answer accuracy',percent(data.accuracy)],['Games with observations',data.measuredGames+' / '+rows.length]].map(([label,value])=>'<article><strong>'+value+'</strong><span>'+label+'</span></article>').join('')+'</div>'
      +'<p class="gi-note">Ranked by unique player accounts with recorded activity, then answers. Family profiles sharing one historical account count together. A returning account was active on two or more dates in this window. Dates use Singapore time.</p>'
      +'<div class="gi-table-scroll" tabindex="0" role="region" aria-label="Game popularity rankings; scroll horizontally for all statistics"><table class="gi-table"><thead><tr>'+['Rank','Game','Player accounts','Answers','Accuracy','Returning','Answering-player trend','Recorded starts','Last activity'].map(x=>'<th scope="col">'+x+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr'+(r.id===active.id?' class="selected"':'')+'><td>'+(r.rank||'—')+'</td><th scope="row"><button type="button" data-gi-game="'+r.id+'" aria-pressed="'+(r.id===active.id)+'">'+r.icon+' '+escape(r.name)+'</button>'+(r.measured?'':'<small>Not measured in this window</small>')+'</th><td>'+number(r.players)+'</td><td>'+(r.hasQuestions?number(r.questions):'—')+'</td><td>'+percent(r.accuracy)+'</td><td>'+percent(r.returnRate)+'</td><td>'+trend(r)+'</td><td>'+(r.measuredStarts?number(r.starts):'Not recorded')+'</td><td>'+(r.lastAt?escape(new Date(r.lastAt).toLocaleDateString('en-SG',{timeZone:'Asia/Singapore'})):'—')+'</td></tr>').join('')+'</tbody></table></div>'
      +'<p class="gi-note">Historical answer logs measure answer time, not total playing time. Pure action games have no historical question log. Launch summaries retain 190 days. Start counts began being recorded with this release; historical starts and total playtime are unavailable. Recorded starts appear only where launch summaries are available; an unmeasured game is not evidence of low popularity. Trends compare answering accounts with the previous '+days+' days and include today.</p>'
      +'<section class="gi-detail" aria-label="Selected game details"><h3>'+active.icon+' '+escape(active.name)+'</h3><div class="gi-detail-stats">'+[['Answers per player',active.hasQuestions&&active.players?(active.questions/active.players).toFixed(1):'—'],['Time answering',duration(active.answerMs)],['Answers under 4 seconds',active.timedAnswers?percent(active.quickAnswers/active.timedAnswers):'—'],['Recorded launches',active.measuredStarts?number(active.starts):'Not recorded'],['Recorded completed runs',active.measuredCompletions?number(active.completedRuns):'Not recorded']].map(([l,v])=>'<div><b>'+v+'</b><span>'+l+'</span></div>').join('')+'</div><div class="gi-chart" aria-label="Daily recorded question answers">'+(active.daily.length?active.daily.map(d=>'<div><span>'+escape(d.day.slice(5))+'</span><i style="--gi-bar:'+Math.max(2,Math.round(d.questions/Math.max(...active.daily.map(x=>x.questions))*100))+'%"></i><b>'+number(d.questions)+'</b></div>').join(''):'<p>No question-answer observations for this game in this window.</p>')+'</div></section>'
      +'<div class="gi-advice">'+advice(data).map(a=>'<article><h3>'+escape(a.title)+'</h3><p>'+escape(a.text)+'</p></article>').join('')+'</div>';
    h.querySelector('[data-gi-days]').onchange=e=>{days=Number(e.target.value);open();};
    h.querySelector('[data-gi-refresh]').onclick=()=>open(true);
    h.querySelector('[data-gi-export]').onclick=exportCsv;
    h.querySelectorAll('[data-gi-game]').forEach(b=>b.onclick=()=>{selected=b.dataset.giGame;render();h.querySelector('[data-gi-game="'+selected+'"]').focus();});
  }
  async function open(force=false){
    if(!allowed()){reset();return false;}
    const uid=env.getUser().uid;if(owner!==uid){reset();owner=uid;}
    const epoch=++generation,now=env.now?.()||Date.now();loading=true;render();
    try{
      if(force||!raw||raw.days<days){
        const since=Date.parse(dayOf(now)+'T00:00:00+08:00')-(days*2-1)*DAY;
        const result=await env.loadRecords({uid,days,since,limit:20000});
        if(!current(uid,epoch)){if(!allowed()||env.getUser()?.uid!==owner)reset();return false;}
        raw={...result,days};
      }
      if(!current(uid,epoch)){if(!allowed()||env.getUser()?.uid!==owner)reset();return false;}
      data=aggregateGameInsights({...raw,now,days});loading=false;render();return true;
    }catch(error){
      if(!current(uid,epoch)){if(!allowed()||env.getUser()?.uid!==owner)reset();return false;}loading=false;raw=null;data=null;
      const h=host();if(h){h.innerHTML='<div class="gi-empty" role="alert">Could not load game activity. Check your connection and try again.<p><button type="button" class="btn btn-outline" data-gi-retry>Try again</button></p></div>';h.querySelector('[data-gi-retry]').onclick=()=>open(true);}
      env.onError?.(error);return false;
    }
  }
  function exportCsv(){
    if(!allowed()||env.getUser().uid!==owner||!data)return false;
    const csv=[['Game','Observed player accounts','Answers','Accuracy percent','Returning accounts','Answering-player trend percent','Answer time ms','Recorded play time ms','Recorded launches','Recorded completed runs','Last activity SGT','Window days','Window start SGT','Window end SGT','Answer sample capped','Launch sample capped','Profile exclusions capped'],...data.rows.map(r=>[r.name,r.players,r.questions,r.accuracy==null?'':Math.round(r.accuracy*100),r.returners,r.trend==null?'':Math.round(r.trend*100),r.answerMs,r.measuredTime?r.activeMs:'',r.measuredStarts?r.starts:'',r.measuredCompletions?r.completedRuns:'',r.lastAt?dayOf(r.lastAt):'',days,dayOf(data.currentCut),dayOf(data.now),!!data.coverage.attemptsTruncated,!!data.coverage.boardsTruncated,!!data.coverage.profilesTruncated])].map(row=>row.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\r\n');
    env.download?.(csv,'game-insights-'+dayOf(data.now)+'.csv');return csv;
  }
  return {open,reset,exportCsv};
}
