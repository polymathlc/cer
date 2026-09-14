import test from 'node:test';
import assert from 'node:assert/strict';
import {createHadesLearningController,validHadesQuestions} from '../hades-learning-parent.js';
const rows=Array.from({length:5},(_,i)=>({id:'remote-'+i,html:'<p>Bank question</p>',options:['A','B'],grading:'remote',answer:null}));
function fixture(gradeQuestion,presentQuestions){
 const messages=[];const source={postMessage:d=>messages.push(d)};let identity='student:P6';
 const controller=createHadesLearningController({origin:'https://portal.test',subject:'Math',getFrame:()=>({contentWindow:source}),getIdentity:()=>identity,isAllowed:()=>true,isActive:()=>true,makeSessionId:()=> 'session',getQuestions:()=>rows,gradeQuestion,presentQuestions});
 const send=data=>controller.handleMessage({origin:'https://portal.test',source,data});
 return {controller,messages,send,change:()=>identity='other:P4'};
}
test('private-key-free rows require an explicit parent marker',()=>{
 assert.equal(validHadesQuestions(rows).length,0);assert.equal(validHadesQuestions(rows,true).length,5);
});
test('remote marks complete once, remain outside iframe, and replay no server calls',async()=>{
 let calls=0;
 const f=fixture(async()=>{calls++;return {correct:true,answer:0};},async({grade})=>{for(let i=0;i<5;i++)assert.equal((await grade(i,0,1000)).correct,true);return true;});
 await f.send({type:'HADES_HELLO',requestId:'hello'});
 await f.send({type:'HADES_ROUND_REQUEST',requestId:'round',sessionId:'session',round:1});
 assert.equal(calls,5);assert.equal(f.messages.at(-1).healPercent,40);
 await f.send({type:'HADES_ROUND_REQUEST',requestId:'retry',sessionId:'session',round:1});
 assert.equal(calls,5);assert.equal(JSON.stringify(f.messages).includes('answer'),false);
});
test('in-flight double clicks and profile changes cannot grant rewards',async()=>{
 let finish,calls=0;
 const f=fixture(()=>{calls++;return new Promise(r=>finish=r);},async({grade})=>{
  const pending=grade(0,0,100);assert.equal(await grade(0,0,100),null);
  f.change();finish({correct:true,answer:0});assert.equal(await pending,null);return true;
 });
 await f.send({type:'HADES_HELLO',requestId:'hello'});
 await f.send({type:'HADES_ROUND_REQUEST',requestId:'round',sessionId:'session',round:1});
 assert.equal(calls,1);assert.ok(f.messages.every(m=>m.type!=='HADES_ROUND_RESULT'));
});
test('invalid or unavailable marks block advancement',async()=>{
 for(const marker of [async()=>({correct:true,answer:1}),async()=>{throw Error('offline');}]){
  const f=fixture(marker,async({grade})=>{await grade(0,0,100);return true;});
  await f.send({type:'HADES_HELLO',requestId:'hello'});
  await f.send({type:'HADES_ROUND_REQUEST',requestId:'round',sessionId:'session',round:1});
  assert.equal(f.messages.at(-1).type,'HADES_ROUND_BLOCKED');
 }
});
