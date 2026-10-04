import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';
import { grade, summarize, validateQuestion } from '../lib/domain.mjs';
import { gradeMath } from '../lib/math.mjs';
import { generateQuestion } from '../lib/generation.mjs';

async function fixture(t,options={}) {
  const app=createApp({dataDir:':memory:',...options});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{app.server.close();app.store.db.close();});
  const base='http://127.0.0.1:'+app.server.address().port;
  const request=async(path,method='GET',body,cookie)=>{
    const r=await fetch(base+'/api/'+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},body:body?JSON.stringify(body):undefined});
    return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
  };
  const login=async token=>(await request('session','POST',{token})).cookie;
  const tutor=await login(app.store.bootstrapToken);
  const create=async name=>{
    const {data}=await request('students','POST',{name},tutor);
    return {...data,student:await login(data.studentLink.split('access=')[1]),parent:await login(data.parentLink.split('access=')[1])};
  };
  return {...app,request,login,tutor,create};
}

test('private links enforce role isolation and parent read-only access',async t=>{
  const f=await fixture(t),a=await f.create('Alex'),b=await f.create('Sam');
  assert.equal((await f.request('data')).status,401);
  const view=await f.request('data','GET',undefined,a.parent);
  assert.equal(view.data.identity.name,'Alex');
  assert.deepEqual(view.data.students,[]); assert.deepEqual(view.data.questions,[]);
  assert.equal((await f.request('students','POST',{name:'Bad'},a.parent)).status,403);
  assert.equal((await f.request('practice/next','POST',{},a.parent)).status,403);
  assert.equal((await f.request('students/'+b.id+'/export','GET',undefined,a.student)).status,403);
  assert.equal((await f.request('students','POST',{name:'Full Name'},f.tutor)).status,400);
  const rotation=await f.request('students/'+a.id+'/links','POST',{role:'student'},f.tutor);
  assert.equal((await f.request('data','GET',undefined,a.student)).status,401);
  assert.equal((await f.request('session','POST',{token:a.studentLink.split('access=')[1]})).status,401);
  assert.equal((await f.request('data','GET',undefined,a.parent)).status,200);
  assert.ok(await f.login(rotation.data.link.split('access=')[1]));
});

test('assignments preserve snapshots, validate ownership, and record an answer once',async t=>{
  const f=await fixture(t),a=await f.create('Alex'),b=await f.create('Sam');
  const q=f.store.questions().find(q=>q.type==='multiple-choice');
  assert.equal((await f.request('assignments','POST',{title:'Factoring',studentIds:[a.id],questionIds:[q.id],due:''},f.tutor)).status,201);
  const assignment=f.store.assignments(a.id)[0];
  assert.equal((await f.request('practice/next','POST',{assignmentId:assignment.id},b.student)).status,404);
  await f.request('questions/'+q.id,'PUT',{...q,prompt:'Edited bank question'},f.tutor);
  await f.request('questions/'+q.id,'DELETE',{},f.tutor);
  const next=await f.request('practice/next','POST',{assignmentId:assignment.id},a.student);
  assert.equal(next.data.question.prompt,q.prompt);
  assert.equal(next.data.question.answer,undefined);assert.equal(next.data.question.explanation,undefined);
  assert.equal((await f.request('practice/next','POST',{assignmentId:assignment.id},a.student)).data.ticketId,next.data.ticketId);
  const payload={ticketId:next.data.ticketId,answer:q.answer,seconds:24};
  assert.equal((await f.request('practice/answer','POST',payload,b.student)).status,404);
  assert.equal((await f.request('practice/answer','POST',payload,a.student)).data.correct,1);
  await f.request('practice/answer','POST',payload,a.student);
  assert.equal(f.store.attempts(a.id).length,1);
  assert.equal((await f.request('practice/next','POST',{assignmentId:assignment.id},a.student)).data.complete,true);
  const analytics=await f.request('analytics?student='+b.id,'GET',undefined,a.parent);
  assert.equal(analytics.data.attempts,1);
  assert.equal(analytics.data.accuracy,100);
});

test('unseen practice counts viewed questions, repeats work, imports are atomic',async t=>{
  const f=await fixture(t),a=await f.create('Alex');
  const payload={filters:{topic:'Median'},repeat:false};
  const first=await f.request('practice/next','POST',payload,a.student);
  assert.ok(first.data.ticketId);
  const second=await f.request('practice/next','POST',payload,a.student);
  assert.equal(second.data.exhausted,true);
  assert.ok((await f.request('practice/next','POST',{...payload,repeat:true},a.student)).data.ticketId);
  const count=f.store.questions().length;
  assert.equal((await f.request('questions/import','POST',{questions:[f.store.questions()[0],{prompt:'bad'}]},f.tutor)).status,400);
  assert.equal(f.store.questions().length,count);
});

test('math notation and equivalence handle exponents, fractions, radicals, and incorrect answers',async()=>{
  const base={type:'short-response',alternatives:[],tolerance:0,mathMatch:'equivalent'};
  for(const [answer,expected] of [['2^3','8'],['\\frac{1}{2}','0.5'],['\\sqrt{8}','2\\sqrt{2}'],['(x+2)(x+3)','x^2+5x+6']]) {
    assert.equal(await gradeMath({...base,answer:expected},answer),1,answer+' equals '+expected);
  }
  assert.equal(await gradeMath({...base,answer:'8'},'9'),0);
  assert.equal(grade({...base,answer:'3/8'},'0.375'),1);
  assert.equal(await gradeMath({...base,answer:'2'},'\\sqrt{'),null);
});

test('writing LLM grading sends only prompt, rubric, and response; tutor can override',async t=>{
  let sent;
  const f=await fixture(t,{env:{OPENAI_API_KEY:'test-key'},fetchImpl:async(url,options)=>{
    sent=JSON.parse(options.body);
    return {ok:true,json:async()=>({output:[{content:[{type:'output_text',text:JSON.stringify({correct:true,feedback:'Your explanation clearly connects the factors to the coefficients.'})}]}]})};
  }});
  f.store.setConfig('settings',{...f.store.getConfig('settings'),model:'test-model'});
  const a=await f.create('UniqueFirstName');
  const q=f.store.questions().find(q=>q.type==='written-response');
  await f.request('assignments','POST',{title:'Explain',studentIds:[a.id],questionIds:[q.id],due:''},f.tutor);
  const next=await f.request('practice/next','POST',{assignmentId:f.store.assignments(a.id)[0].id},a.student);
  const result=await f.request('practice/answer','POST',{ticketId:next.data.ticketId,answer:'2 times 3 is 6, and 2 plus 3 is 5. Expanding checks both coefficients.',seconds:90},a.student);
  assert.equal(result.data.correct,1);assert.equal(result.data.gradingSource,'ai');assert.match(result.data.feedback,/explanation/);
  assert.ok(!JSON.stringify(sent).includes('UniqueFirstName'));assert.ok(!JSON.stringify(sent).includes(a.id));
  assert.equal(sent.store,false);
  const attempt=f.store.attempts(a.id)[0];
  assert.equal(attempt.review.source,'ai');
  await f.request('attempts/'+attempt.id+'/grade','POST',{correct:0},f.tutor);
  assert.equal(f.store.attempts(a.id)[0].correct,0);
  assert.equal(f.store.attempts(a.id)[0].review.source,'tutor');
});

test('writing is saved for review when provider fails or is not connected',async t=>{
  const f=await fixture(t,{env:{OPENAI_API_KEY:'test-key'},fetchImpl:async()=>{throw new Error('offline');}});
  f.store.setConfig('settings',{...f.store.getConfig('settings'),model:'test-model'});
  const a=await f.create('Alex');
  const next=await f.request('practice/next','POST',{filters:{type:'written-response'}},a.student);
  const result=await f.request('practice/answer','POST',{ticketId:next.data.ticketId,answer:'Some reasoning.',seconds:10},a.student);
  assert.equal(result.status,200);assert.equal(result.data.pending,true);
  assert.equal(f.store.attempts(a.id).length,1);
  assert.equal((await f.request('analytics','GET',undefined,a.student)).data.accuracy,null);
});

test('generation validates filters and rejects malformed provider output',async()=>{
  const q=validateQuestion({prompt:'What is 2 + 2?',topics:['Arithmetic'],courses:['GED'],type:'short-response',difficulty:'easy',answer:'4',choices:[],alternatives:[],steps:[],explanation:'Add 2 and 2.',tolerance:0});
  const settings={provider:'openai',model:'test',guidelines:'Be accurate.'};
  const fake=async()=>({ok:true,json:async()=>({output:[{content:[{type:'output_text',text:JSON.stringify(q)}]}]})});
  const result=await generateQuestion({settings,filters:{topic:'Arithmetic'},examples:[],env:{OPENAI_API_KEY:'test'},fetchImpl:fake});
  assert.equal(result.source,'ai');assert.equal(result.reviewed,false);
  await assert.rejects(()=>generateQuestion({settings,filters:{topic:'Factoring'},examples:[],env:{OPENAI_API_KEY:'test'},fetchImpl:fake}),/did not match/);
});

test('analytics excludes pending and identifies first unguided attempts; deletion cascades',async t=>{
  const q={topics:['Factoring'],courses:['SAT'],difficulty:'easy',type:'short-response'};
  const now=new Date().toISOString();
  const rows=[
    {studentId:'a',questionId:'q',question:q,correct:0,seconds:30,guided:false,createdAt:now},
    {studentId:'a',questionId:'q',question:q,correct:1,seconds:30,guided:false,createdAt:now},
    {studentId:'a',questionId:'b',question:q,correct:null,seconds:30,guided:false,createdAt:now},
    {studentId:'a',questionId:'c',question:q,correct:1,seconds:30,guided:true,createdAt:now},
  ];
  assert.equal(summarize(rows,30).accuracy,67);
  assert.equal(summarize(rows,30,true).accuracy,0);
  assert.equal(summarize(rows,30).pending,1);
  const f=await fixture(t),a=await f.create('Alex');
  await f.request('practice/next','POST',{},a.student);
  assert.equal((await f.request('students/'+a.id,'DELETE',{},f.tutor)).status,200);
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM seen').get().n,0);
  assert.equal(f.store.db.prepare('SELECT count(*) n FROM tickets').get().n,0);
  assert.equal((await f.request('data','GET',undefined,a.parent)).status,401);
});

test('cross-origin writes and private files are blocked',async t=>{
  const f=await fixture(t);
  const base='http://127.0.0.1:'+f.server.address().port;
  const r=await fetch(base+'/api/students',{method:'POST',headers:{Origin:'https://attacker.example','Content-Type':'application/json',Cookie:f.tutor},body:JSON.stringify({name:'Alex'})});
  assert.equal(r.status,403);
  for(const path of ['/.env','/.data/tutor-access.txt','/server.mjs'])assert.equal((await fetch(base+path)).status,404);
});

test('automatic generation is reusable and enforces the shared daily cap',async t=>{
  let calls=0;
  const generated={prompt:'What is 17 + 26?',topics:['Fresh practice'],courses:['GED'],type:'short-response',difficulty:'easy',choices:[],answer:'43',alternatives:[],explanation:'17 + 26 = 43.',steps:[],tolerance:0};
  const f=await fixture(t,{env:{OPENAI_API_KEY:'test'},fetchImpl:async()=>{calls++;return{ok:true,json:async()=>({output:[{content:[{type:'output_text',text:JSON.stringify(generated)}]}]})};}});
  f.store.setConfig('settings',{...f.store.getConfig('settings'),model:'test-model',autoGenerate:true,dailyLimit:1});
  const a=await f.create('Alex'),b=await f.create('Sam');
  const payload={filters:{topic:'Fresh practice'},repeat:false};
  const first=await f.request('practice/next','POST',payload,a.student);
  assert.equal(first.status,200);assert.equal(first.data.question.source,'ai');assert.equal(first.data.question.reviewed,false);assert.equal(first.data.question.answer,undefined);
  assert.equal(calls,1);
  assert.equal((await f.request('practice/next','POST',payload,a.student)).status,429);
  const reused=await f.request('practice/next','POST',payload,b.student);
  assert.equal(reused.data.question.id,first.data.question.id);assert.equal(calls,1);
  const saved=f.store.questions().find(q=>q.id===first.data.question.id);
  await f.request('questions/'+saved.id,'PUT',saved,f.tutor);
  assert.equal(f.store.questions().find(q=>q.id===saved.id).reviewed,true);
});

test('math grading preserves superscripts and variable case',()=>{
  const q={type:'short-response',answer:'x²',alternatives:[],tolerance:0};
  assert.equal(grade(q,'x2'),0);
  assert.equal(grade({...q,answer:'x'},'X'),0);
});

function recordAttempt(store,studentId,q,correct,guided=0) {
  const ticketId=crypto.randomUUID(),attemptId=crypto.randomUUID(),at=new Date().toISOString();
  store.db.prepare('INSERT INTO tickets(id,studentId,question,guided,used,createdAt) VALUES(?,?,?,?,1,?)').run(ticketId,studentId,JSON.stringify(q),guided,at);
  store.db.prepare('INSERT INTO attempts VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(attemptId,ticketId,studentId,null,q.id,JSON.stringify(q),correct===1?q.answer:'Test response',correct,30,guided,at);
  store.db.prepare('INSERT OR IGNORE INTO seen VALUES(?,?)').run(studentId,q.id);
  return attemptId;
}
function selectionQuestion(store,prompt,extra={}) {
  return store.putQuestion({prompt,topics:['Recovery'],courses:['Algebra I','SAT'],type:'short-response',difficulty:'easy',choices:[],answer:'4',alternatives:[],explanation:'Test explanation.',steps:[],tolerance:0,...extra});
}

test('student history distinguishes unseen, viewed, pending, and exact per-question accuracy',async t=>{
  const f=await fixture(t),a=await f.create('Alex'),b=await f.create('Sam');
  const weak=selectionQuestion(f.store,'Weak for Alex'),boundary=selectionQuestion(f.store,'Exactly 65 for Alex'),below=selectionQuestion(f.store,'64.5 for Alex');
  const pending=selectionQuestion(f.store,'Pending'),viewed=selectionQuestion(f.store,'Viewed only'),unseen=selectionQuestion(f.store,'Unseen');
  [1,0,0].forEach((result,i)=>recordAttempt(f.store,a.id,weak,result,i===0?1:0));
  for(let i=0;i<20;i++)recordAttempt(f.store,a.id,boundary,i<13?1:0);
  for(let i=0;i<200;i++)recordAttempt(f.store,a.id,below,i<129?1:0);
  recordAttempt(f.store,a.id,pending,null);
  f.store.db.prepare('INSERT INTO seen VALUES(?,?)').run(a.id,viewed.id);
  recordAttempt(f.store,b.id,weak,1);
  recordAttempt(f.store,b.id,boundary,0);
  const response=await f.request('question-history?student='+a.id,'GET',undefined,f.tutor);
  assert.equal(response.status,200);
  assert.equal(response.data.history[weak.id].graded,3);
  assert.equal(response.data.history[weak.id].guided,1);
  assert.equal(response.data.history[boundary.id].accuracy,65);
  assert.equal(response.data.history[below.id].accuracy,64.5);
  assert.equal(response.data.history[pending.id].accuracy,null);
  assert.equal(response.data.history[viewed.id].seen,true);
  assert.equal(response.data.history[viewed.id].attempts,0);
  assert.equal(response.data.history[unseen.id],undefined);
  assert.equal((await f.request('question-history?student='+a.id,'GET',undefined,a.student)).status,403);
  assert.equal((await f.request('question-history?student='+a.id,'GET',undefined,a.parent)).status,403);
  const p=await f.request('assignments/preview','POST',{studentIds:[a.id,b.id],mode:'automatic',allMatching:true,criteria:{topics:['Recovery'],courses:['Algebra I'],accuracyBelow:65,minAttempts:1}},f.tutor);
  assert.equal(p.status,200);assert.equal(p.data.ready,true);
  assert.deepEqual(new Set(p.data.students[0].questions.map(q=>q.id)),new Set([weak.id,below.id]));
  assert.deepEqual(p.data.students[1].questions.map(q=>q.id),[boundary.id]);
  assert.equal(f.store.assignments().length,0);
  const made=await f.request('assignments','POST',{previewId:p.data.previewId,title:'Targeted review',due:''},f.tutor);
  assert.equal(made.status,201);assert.equal(made.data.count,2);
  for(const plan of p.data.students) {
    const saved=f.store.assignments(plan.studentId)[0];
    assert.deepEqual(saved.questions.map(q=>q.id),plan.questions.map(q=>q.id));
  }
  assert.equal((await f.request('assignments','POST',{previewId:p.data.previewId,title:'Duplicate',due:''},f.tutor)).status,409);
  assert.equal(f.store.assignments().length,2);
  // A previously answered question can be assigned again in a new assignment.
  const assigned=f.store.assignments(b.id)[0];
  const next=await f.request('practice/next','POST',{assignmentId:assigned.id},b.student);
  assert.equal(next.data.question.id,boundary.id);
});

test('tag groups, seen filters, count shortages, and minimum attempts are enforced',async t=>{
  const f=await fixture(t),a=await f.create('Alex');
  const q1=selectionQuestion(f.store,'One unseen'),q2=selectionQuestion(f.store,'Two unseen',{topics:['Another topic']});
  const q3=selectionQuestion(f.store,'Already viewed');
  f.store.db.prepare('INSERT INTO seen VALUES(?,?)').run(a.id,q3.id);
  const request=criteria=>f.request('assignments/preview','POST',{studentIds:[a.id],mode:'automatic',count:2,criteria},f.tutor);
  let p=await request({topics:['Recovery','Another topic'],courses:['SAT'],history:'unseen'});
  assert.equal(p.data.ready,true);assert.deepEqual(new Set(p.data.students[0].questions.map(q=>q.id)),new Set([q1.id,q2.id]));
  p=await request({topics:['Recovery'],history:'unseen'});
  assert.equal(p.data.ready,false);assert.equal(p.data.previewId,null);assert.equal(p.data.students[0].available,1);assert.match(p.data.students[0].issue,/Only 1/);
  assert.equal(f.store.assignments().length,0);
  p=await request({topics:['Recovery'],courses:['Nonmatching course']});
  assert.equal(p.data.ready,false);assert.equal(p.data.students[0].available,0);
  recordAttempt(f.store,a.id,q1,0);
  p=await f.request('assignments/preview','POST',{studentIds:[a.id],allMatching:true,criteria:{topics:['Recovery'],accuracyBelow:65,minAttempts:2}},f.tutor);
  assert.equal(p.data.ready,false);
  recordAttempt(f.store,a.id,q1,0);
  p=await f.request('assignments/preview','POST',{studentIds:[a.id],allMatching:true,criteria:{topics:['Recovery'],accuracyBelow:65,minAttempts:2}},f.tutor);
  assert.equal(p.data.ready,true);assert.equal(p.data.students[0].questions.length,1);
  for(const criteria of [{accuracyBelow:101},{accuracyBelow:0},{accuracyBelow:false},{minAttempts:0},{history:'something'},{difficulties:['impossible']},{types:['bad']}]) {
    assert.equal((await request(criteria)).status,400);
  }
  assert.equal((await f.request('assignments/preview','POST',{studentIds:[a.id],count:1.5},f.tutor)).status,400);
  assert.equal((await f.request('assignments/preview','POST',{studentIds:[a.id],count:1},a.parent)).status,403);
});

test('stale or cross-session assignment previews cannot create any assignments',async t=>{
  const f=await fixture(t),a=await f.create('Alex'),b=await f.create('Sam');
  const q=selectionQuestion(f.store,'A reviewed preview');
  const payload={studentIds:[a.id,b.id],count:1,criteria:{topics:['Recovery'],history:'unseen'}};
  let p=(await f.request('assignments/preview','POST',payload,f.tutor)).data;
  const otherTutor=await f.login(f.store.bootstrapToken);
  const commit=()=>f.request('assignments','POST',{previewId:p.previewId,title:'Review',due:''},f.tutor);
  assert.equal((await f.request('assignments','POST',{previewId:p.previewId,title:'Review',due:''},otherTutor)).status,409);
  f.store.db.prepare('INSERT INTO seen VALUES(?,?)').run(b.id,q.id);
  assert.equal((await commit()).status,409);assert.equal(f.store.assignments().length,0);
  p=(await f.request('assignments/preview','POST',{...payload,criteria:{topics:['Recovery']}},f.tutor)).data;
  f.store.putQuestion({...q,prompt:'Changed after preview'});
  assert.equal((await commit()).status,409);assert.equal(f.store.assignments().length,0);
  p=(await f.request('assignments/preview','POST',{...payload,criteria:{topics:['Recovery']}},f.tutor)).data;
  f.store.db.prepare('UPDATE questions SET archived=1 WHERE id=?').run(q.id);
  assert.equal((await commit()).status,409);assert.equal(f.store.assignments().length,0);
});

test('manual previews preserve explicit reassignment and per-student history badges',async t=>{
  const f=await fixture(t),a=await f.create('Alex'),b=await f.create('Sam');
  const q=f.store.questions()[0];
  recordAttempt(f.store,a.id,q,0);
  const p=(await f.request('assignments/preview','POST',{mode:'manual',studentIds:[a.id,b.id],questionIds:[q.id,q.id],criteria:{}},f.tutor)).data;
  assert.equal(p.ready,true);
  assert.equal(p.students[0].questions[0].history.accuracy,0);
  assert.equal(p.students[1].questions[0].history.seen,false);
  assert.equal(p.students[0].questions.length,1);
  assert.equal((await f.request('assignments','POST',{previewId:p.previewId,title:'Try this again',due:''},f.tutor)).status,201);
  assert.equal(f.store.assignments(a.id)[0].questions.length,1);
  assert.equal(f.store.assignments(b.id)[0].questions.length,1);
});
