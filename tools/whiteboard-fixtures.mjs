// Deterministic source questions and model replies; never contact a live bank,
// student account or paid model from these fixtures.
export const image = name => 'https://whiteboard.test/images/' + name + '.svg';
export function questions() {
  return [
    {id:'heat-1',title:'Cooling water',topic:'Heat',category:'MCQ',answerKeyNote:'PRIVATE MODEL ANSWER',blocks:[
      {id:'stem',type:'text',content:'<p>Water cooled from <b>80°C</b> to 50°C. Why did it cool?</p>'},
      {id:'picture',type:'image',url:image('cup'),caption:'Cup of water',answerImg:image('answer-only')},
      {id:'choices',type:'mcq',correctId:'a',options:[{id:'a',text:'Heat moves to the surroundings.'},{id:'b',text:'Cold enters the water.'}]},
      {id:'solution',type:'plainanswer',content:'PRIVATE MODEL ANSWER'},
      {id:'explain',type:'explanation',content:'PRIVATE EXPLANATION'},
    ]},
    {id:'light-1',title:'A shadow',topic:'Light',category:'Explanation',blocks:[
      {id:'stem',type:'text',content:'<p>Why does the opaque object form a shadow?</p>'},
      {id:'diagram',type:'image',url:image('tall-shadow'),caption:'Torch, object and screen'},
      {id:'answer',type:'answer',claim:'PRIVATE CLAIM',evidence:'PRIVATE EVIDENCE',reasoning:'PRIVATE REASONING'},
    ]},
    {id:'fill-1',title:'Heat direction',topic:'Heat',category:'Fill in the blanks',blocks:[
      {id:'stem',type:'fillblank',text:'Heat travels from a [[hotter]] object to a [[cooler]] object.',answers:['hotter','cooler'],content:'Heat travels from a [[hotter]] object to a [[cooler]] object.'},
    ]},
    {id:'table-1',title:'Cooling table',topic:'Heat',category:'Explanation',blocks:[
      {id:'stem',type:'text',content:'Which cup cooled faster?'},
      {id:'table',type:'table',rows:2,cols:3,data:[['Cup','Initial / °C','Final / °C'],['A','80','50']]},
      {id:'answer',type:'plainanswer',content:'PRIVATE TABLE ANSWER'},
    ]},
  ];
}
export const teacher = () => ({uid:'teacher-1',role:'admin',name:'Fixture teacher'});
export const student = () => ({uid:'student-1',role:'student',name:'Fixture student',adminLevel:'P5'});
export const appSuggestion = () => ({title:'Explore cooling',height:340,html:'<h1>Cooling explorer</h1><button id="cool">Cool</button><output id="temperature">80</output><script>document.getElementById("cool").onclick=()=>document.getElementById("temperature").textContent="50";</script>'});
export function deferred() { let resolve,reject; const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject}; }
export async function settle() { for(let i=0;i<20;i++)await Promise.resolve(); }
