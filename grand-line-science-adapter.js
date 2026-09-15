import { questionQualitySignature } from './science-feed-quality.js';

export function createGrandLineScienceAdapter(env) {
  const unavailable=new Map();
  const profile=ctx=>ctx.admin?{name:'Grand Line preview '+ctx.level,level:ctx.level}:undefined;
  return {
    async getQuestions(ctx){
      const learner=profile(ctx),rows=new Map();
      if(env.ensure && !await env.ensure(learner)) return [];
      const candidates=env.getBank().filter(q=>q&&q.status!=='pending'&&q.status!=='flagged'&&env.isReleased(q)&&env.isInSyllabus(q)
        &&unavailable.get(String(q.id))!==questionQualitySignature(q)).filter(q=>{const row=env.extractMcq(q);if(row)rows.set(String(q.id),row);return !!row;});
      const context=env.makeContext(learner,ctx.level);
      const planned=env.plan(candidates,{game:true,profile:learner,context,randomize:true,onePerFamily:true,limit:3});
      if(planned.questions.length!==3 || env.claim && !await env.claim(planned.questions,learner)) return [];
      return planned.questions.slice(0,3).map(q=>({...rows.get(String(q.id)),id:String(q.id),title:q.title||''}));
    },
    markShown:(q,ctx)=>env.mark(q.id,profile(ctx)),
    recordAnswer({question,correct,ms},ctx){env.remember(question.id,correct?1:0,1,profile(ctx));if(!ctx.admin){env.awardPoints?.(question.id,correct,ms);env.recordAttempt({questionId:question.id,questionTitle:question.title,correct,ms,mode:'grand-line'});}},
    onImageFailure(row,url){const q=env.getBank().find(q=>String(q.id)===row.id);if(q)env.imageResult(q,url,true);},
    onQuestionUnavailable(row){const q=env.getBank().find(q=>String(q.id)===row.id);if(q)unavailable.set(row.id,questionQualitySignature(q));}
  };
}
