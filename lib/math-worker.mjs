import { parentPort, workerData } from 'node:worker_threads';
import { ComputeEngine } from '@cortex-js/compute-engine';
const ce=new ComputeEngine();
ce.iterationLimit=100;
const latex=value=>String(value).replace(/²/g,'^{2}').replace(/³/g,'^{3}').replace(/−/g,'-').replace(/×/g,'\\times ').replace(/÷/g,'\\div ').replace(/π/g,'\\pi ').replace(/(?<!\\)\bsqrt\(([^()]*)\)/g,'\\sqrt{$1}');
const allowed=new Set(['Add','Subtract','Multiply','Divide','Rational','Negate','Power','Square','Sqrt','Root','Sin','Cos','Tan','Ln','Log','Abs','Equal']);
function safe(node,depth=0) {
  if(depth>18)return false;
  if(typeof node==='number')return Number.isFinite(node)&&Math.abs(node)<1e12;
  if(typeof node==='string')return /^[a-zA-Z]$/.test(node)||['Pi','ExponentialE','Half'].includes(node);
  if(Array.isArray(node))return allowed.has(node[0])&&node.length<50&&node.slice(1).every(n=>safe(n,depth+1));
  if(node?.num)return /^-?\d+(\.\d+)?$/.test(node.num)&&node.num.length<30;
  return false;
}
try {
  const a=ce.parse(latex(workerData.answer));
  if(!a.isValid||!safe(a.json))parentPort.postMessage(null);
  else {
    let known=false,result=null;
    for(const expected of workerData.expected) {
      const b=ce.parse(latex(expected));
      if(!b.isValid||!safe(b.json))continue;
      let equal=a.isIdenticallyEqual(b);
      if(equal===undefined)equal=a.isEqual(b);
      if(equal===true){result=1;break;}
      if(equal===false)known=true;
      if(workerData.tolerance>0) {
        const an=Number(a.N().valueOf()),bn=Number(b.N().valueOf());
        if(Number.isFinite(an)&&Number.isFinite(bn)&&Math.abs(an-bn)<=workerData.tolerance){result=1;break;}
      }
    }
    parentPort.postMessage(result===1?1:known?0:null);
  }
} catch { parentPort.postMessage(null); }
