import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {createRapidAiRouter, createOptionalKimiKeyReader, rapidAiOrder} from '../ai-routing.js';
import {parseReply} from '../core.js';

const jsonReply = (text='{"questions":[]}', finishReason='STOP') => ({text, candidates:[{finishReason}]});
const chatReply = (text='{"questions":[]}', finish_reason='stop') => ({ok:true, json:async () => ({choices:[{finish_reason, message:{content:text}}]})});
function route(options={}) {
  const calls=[];
  const ask=createRapidAiRouter({
    openaiKey:()=>'openai-test-key', openaiModel:()=>'gpt-6.1-sol',
    getKimiKey:async()=>'kimi-test-key', kimiModel:()=>'kimi-k3',
    generateGemini:async(prompt,images)=>{calls.push({engine:'gemini',prompt,images});return jsonReply();},
    fetchImpl:async(url,init)=>{calls.push({engine:url.includes('moonshot')?'kimi':'openai',url,request:JSON.parse(init.body)});return chatReply();},
    ...options
  });
  return {ask,calls};
}

test('default and old saved orders receive all three engines, with explicit choices retained',()=>{
  assert.deepEqual(rapidAiOrder(),['openai','gemini','kimi']);
  assert.deepEqual(rapidAiOrder(['openai','gemini']),['openai','gemini','kimi']);
  assert.deepEqual(rapidAiOrder(['gemini']),['gemini','openai','kimi']);
  assert.deepEqual(rapidAiOrder(['kimi','evil','kimi']),['kimi','openai','gemini']);
  assert.deepEqual(rapidAiOrder([]),['openai','gemini','kimi']);
});

test('default text and vision use the requested GPT model with reasoning; backups stay idle',async()=>{
  let secrets=0;
  const {ask,calls}=route({getKimiKey:async()=>{secrets++;return 'key';}});
  await ask('Read this question',['image-a','image-b']);
  assert.equal(calls.length,1);assert.equal(calls[0].engine,'openai');assert.equal(secrets,0);
  const request=calls[0].request;
  assert.equal(request.model,'gpt-6.1-sol');assert.equal(request.reasoning_effort,'medium');
  assert.deepEqual(request.response_format,{type:'json_object'});
  assert.deepEqual(request.messages[0].content.map(part=>part.type),['text','image_url','image_url']);
  assert.equal(request.messages[0].content[2].image_url.url,'data:image/jpeg;base64,image-b');
});

test('provider errors try Gemini next without fetching the optional Kimi secret',async()=>{
  let secrets=0;
  const {ask,calls}=route({getKimiKey:async()=>{secrets++;throw new Error('must stay lazy');},
    fetchImpl:async()=>{calls.push({engine:'openai'});return {ok:false,status:429};}});
  await ask('Read',['image']);
  assert.deepEqual(calls.map(c=>c.engine),['openai','gemini']);assert.equal(secrets,0);
  assert.deepEqual(calls[1].images,['image']);
});

test('incomplete OpenAI and empty Gemini output reach Kimi with the same vision prompt',async()=>{
  const {ask,calls}=route({generateGemini:async(prompt,images)=>{calls.push({engine:'gemini',prompt,images});return jsonReply('   ');},
    fetchImpl:async(url,init)=>{
      const engine=url.includes('moonshot')?'kimi':'openai';calls.push({engine,request:JSON.parse(init.body)});
      return engine==='openai'?chatReply('{"questions":[','length'):chatReply();
    }});
  const result=await ask('Read',['source']);
  assert.deepEqual(calls.map(c=>c.engine),['openai','gemini','kimi']);
  assert.equal(result.text,'{"questions":[]}');
  assert.equal(calls[2].request.model,'kimi-k3');assert.equal(calls[2].request.reasoning_effort,'high');
  assert.equal(calls[2].request.max_completion_tokens,24000);
  assert.equal(calls[2].request.messages[0].content[1].image_url.url,'data:image/jpeg;base64,source');
  assert.ok(!('thinking' in calls[2].request),'Kimi K3 must not receive the retired K2 thinking schema');
  assert.ok(!('temperature' in calls[2].request),'Kimi K3 uses its provider default sampling');
  assert.ok(!('max_tokens' in calls[2].request),'Kimi K3 uses the documented completion token limit');
});

test('malformed JSON or incomplete question blocks also trigger provider failover',async()=>{
  const {ask,calls}=route({generateGemini:async()=>{calls.push({engine:'gemini'});return jsonReply('{"questions":[{"title":"Missing blocks"}]}');},
    fetchImpl:async(url)=>{const engine=url.includes('moonshot')?'kimi':'openai';calls.push({engine});return engine==='openai'?chatReply('{invalid'):chatReply();}});
  assert.deepEqual(parseReply(await ask('Read',[],{},parseReply)),[]);
  assert.deepEqual(calls.map(c=>c.engine),['openai','gemini','kimi']);
});

test('missing optional Kimi credentials produce no unauthenticated provider request',async()=>{
  const {ask,calls}=route({getKimiKey:async()=>'',generateGemini:async()=>{calls.push({engine:'gemini'});throw new Error('unavailable');},
    fetchImpl:async()=>{calls.push({engine:'openai'});throw new Error('offline');}});
  await assert.rejects(ask('Read'),/kimi backup is not configured/);
  assert.deepEqual(calls.map(c=>c.engine),['openai','gemini']);
});

test('blocked or truncated Gemini cannot be accepted when explicitly selected',async()=>{
  const {ask,calls}=route({generateGemini:async()=>{calls.push({engine:'gemini'});return jsonReply('{"questions":[]}','MAX_TOKENS');}});
  await ask('Read',[],{engineOrder:['gemini']});
  assert.deepEqual(calls.map(c=>c.engine),['gemini','openai']);
});

test('all three providers receive bounded deadlines with room for a figure redraw and verification',async()=>{
  const timer=mock.method(AbortSignal,'timeout');
  try {
    const {ask}=route({generateGemini:async(prompt,images,timeout)=>{
      assert.equal(timeout,60000);return jsonReply('', 'MAX_TOKENS');
    },fetchImpl:async(url)=>url.includes('moonshot')?chatReply():{ok:false,status:503}});
    await ask('Read');
    assert.deepEqual(timer.mock.calls.map(call=>call.arguments[0]),[60000,60000]);
    assert.ok(2 * 3 * 60000 + 120000 + 10000 < 540000,'both reading passes and the lazy secret lookup must fit with the redraw');
  } finally { timer.mock.restore(); }
});

test('successful optional secret reads use the trusted server identity and are cached',async()=>{
  let tokens=0,reads=0;
  const read=createOptionalKimiKeyReader({projectId:'mathgen--app',envKey:()=>'',getAccessToken:async()=>{tokens++;return {access_token:'server-token'};},
    fetchImpl:async(url,init)=>{
      reads++;assert.equal(url,'https://secretmanager.googleapis.com/v1/projects/mathgen--app/secrets/MOONSHOT_API_KEY/versions/latest:access');
      assert.equal(init.headers.Authorization,'Bearer server-token');
      return {ok:true,json:async()=>({payload:{data:Buffer.from('shared-key').toString('base64')}})};
    }});
  assert.deepEqual(await Promise.all([read(),read()]),['shared-key','shared-key']);
  assert.equal(await read(),'shared-key');assert.equal(tokens,1);assert.equal(reads,1);
});

test('missing secret permissions are optional and retried after bounded backoff',async()=>{
  let time=1000, reads=0;
  const read=createOptionalKimiKeyReader({projectId:'mathgen--app',envKey:()=>'',now:()=>time,getAccessToken:async()=>({access_token:'server-token'}),
    fetchImpl:async()=>{reads++;return {ok:false,status:403};}});
  assert.equal(await read(),'');assert.equal(await read(),'');assert.equal(reads,1);
  time+=60000;assert.equal(await read(),'');assert.equal(reads,2);
});

test('configured server environment uses no additional secret lookup',async()=>{
  const read=createOptionalKimiKeyReader({projectId:'mathgen--app',envKey:()=>' key ',getAccessToken:()=>{throw new Error('unexpected lookup');}});
  assert.equal(await read(),'key');
});
