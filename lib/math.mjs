import { Worker } from 'node:worker_threads';
export function gradeMath(question,answer) {
  if(answer.length>400)return Promise.resolve(null);
  return new Promise(resolve=>{
    const worker=new Worker(new URL('./math-worker.mjs',import.meta.url),{workerData:{answer,expected:[question.answer,...question.alternatives],tolerance:question.tolerance},resourceLimits:{maxOldGenerationSizeMb:128}});
    let settled=false;
    const finish=value=>{if(settled)return;settled=true;clearTimeout(timer);worker.terminate();resolve(value);};
    const timer=setTimeout(()=>finish(null),3000);
    worker.once('message',finish);worker.once('error',()=>finish(null));worker.once('exit',()=>finish(null));
  });
}
