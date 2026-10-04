import { check, text, tags, TYPES, DIFFICULTIES, id, hash } from './domain.mjs';

export const emptyHistory = () => ({
  seen:false,attempts:0,graded:0,correct:0,pending:0,guided:0,accuracy:null,lastAttemptAt:null,
});

// Counts are taken from all submitted attempts, including guided practice and repeats.
// A view without a submission is "seen", never a 0%-correct attempt.
export function questionHistory(store,studentId) {
  const history=new Map();
  for(const row of store.db.prepare('SELECT questionId FROM seen WHERE studentId=?').all(studentId)) history.set(row.questionId,{...emptyHistory(),seen:true});
  const rows=store.db.prepare([
    'SELECT questionId, COUNT(*) AS attempts, SUM(correct IS NOT NULL) AS graded,',
    'COALESCE(SUM(correct),0) AS correct, SUM(correct IS NULL) AS pending,',
    'SUM(guided) AS guided, MAX(createdAt) AS lastAttemptAt',
    'FROM attempts WHERE studentId=? GROUP BY questionId',
  ].join(' ')).all(studentId);
  for(const row of rows) {
    const {questionId,...stats}=row;
    history.set(questionId,{...stats,seen:true,accuracy:stats.graded?100*stats.correct/stats.graded:null});
  }
  return history;
}

export function validateSelection(input={}) {
  check(input&&typeof input==='object'&&!Array.isArray(input),'Choose assignment filters.');
  const criteria={
    topics:tags(input.topics??[],'Topics'),courses:tags(input.courses??[],'Courses'),
    difficulties:tags(input.difficulties??[],'Difficulties'),types:tags(input.types??[],'Formats'),
    history:input.history??'all',accuracyBelow:null,minAttempts:1,
  };
  check(criteria.difficulties.every(v=>DIFFICULTIES.includes(v)),'Choose supported difficulty levels.');
  check(criteria.types.every(v=>TYPES.includes(v)),'Choose supported answer formats.');
  check(['all','unseen','seen'].includes(criteria.history),'Choose all, unseen, or seen questions.');
  if(input.accuracyBelow!==undefined&&input.accuracyBelow!==null&&input.accuracyBelow!=='') {
    const raw=input.accuracyBelow;
    check((typeof raw==='number'||typeof raw==='string')&&String(raw).trim()!=='','Enter a percentage.');
    criteria.accuracyBelow=Number(raw);
    check(Number.isFinite(criteria.accuracyBelow)&&criteria.accuracyBelow>0&&criteria.accuracyBelow<=100,'Accuracy cutoff must be greater than 0 and at most 100%.');
  }
  if(input.minAttempts!==undefined) {
    check(typeof input.minAttempts==='number'||typeof input.minAttempts==='string','Enter a minimum graded-attempt count.');
    criteria.minAttempts=Number(input.minAttempts);
    check(Number.isInteger(criteria.minAttempts)&&criteria.minAttempts>=1&&criteria.minAttempts<=1000,'Use 1–1000 minimum graded attempts.');
  }
  return criteria;
}

export function eligible(question,history,criteria) {
  return (!criteria.topics.length||criteria.topics.some(t=>question.topics.includes(t)))
    &&(!criteria.courses.length||criteria.courses.some(c=>question.courses.includes(c)))
    &&(!criteria.difficulties.length||criteria.difficulties.includes(question.difficulty))
    &&(!criteria.types.length||criteria.types.includes(question.type))
    &&(criteria.history==='all'||(criteria.history==='seen'?history.seen:!history.seen))
    // Compare unrounded counts: "below 65%" excludes exactly 65%.
    &&(criteria.accuracyBelow===null||(history.graded>=criteria.minAttempts&&history.correct*100<history.graded*criteria.accuracyBelow));
}

function mix(rows) {
  const shuffled=[...rows];
  for(let i=shuffled.length-1;i>0;i--) {const j=Math.floor(Math.random()*(i+1));[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];}
  return shuffled.sort((a,b)=>Number(a.history.seen)-Number(b.history.seen)||(a.history.accuracy??101)-(b.history.accuracy??101));
}
const fingerprint=value=>hash(JSON.stringify(value));
export function assignmentPlanner(store) {
  const previews=new Map();
  function prepare(body,sessionHash) {
    const studentIds=body.studentIds;
    check(Array.isArray(studentIds)&&studentIds.length>0&&studentIds.length<=100,'Choose 1–100 students.');
    const students=[...new Set(studentIds)].map(studentId=>{
      text(studentId,'Student',100);
      const student=store.db.prepare('SELECT id,name FROM students WHERE id=?').get(studentId);
      check(student,'A selected student is no longer available.',404);return student;
    });
    const mode=body.mode??'automatic';
    check(['automatic','manual'].includes(mode),'Choose automatic or manual selection.');
    const criteria=validateSelection(body.criteria);
    const bank=store.questions();
    let count=null,manual=[];
    if(mode==='automatic'&&body.allMatching!==true) {
      check(typeof body.count==='number'&&Number.isInteger(body.count)&&body.count>=1&&body.count<=100,'Choose 1–100 problems per student.');
      count=body.count;
    } else if(mode==='manual') {
      check(Array.isArray(body.questionIds)&&body.questionIds.length>0&&body.questionIds.length<=100,'Choose 1–100 questions manually.');
      manual=[...new Set(body.questionIds)].map(questionId=>{
        const q=bank.find(q=>q.id===questionId);check(q,'A selected question is no longer available.');return q;
      });
    }
    const plans=students.map(student=>{
      const history=questionHistory(store,student.id);
      const candidates=bank.map(question=>({question,history:history.get(question.id)??emptyHistory()})).filter(row=>eligible(row.question,row.history,criteria));
      const requested=mode==='manual'?manual.length:count??candidates.length;
      const chosen=mode==='manual'?manual.map(question=>({question,history:history.get(question.id)??emptyHistory()})):mix(candidates).slice(0,Math.min(requested,100));
      let issue=null;
      if(!requested)issue='No questions match these filters.';
      else if(requested>100)issue='More than 100 questions match. Narrow the filters or choose a problem count.';
      else if(chosen.length<requested)issue='Only '+chosen.length+' match. Choose '+chosen.length+' or fewer, or broaden the filters.';
      return {studentId:student.id,name:student.name,available:candidates.length,requested,issue,chosen};
    });
    const ready=plans.every(plan=>!plan.issue);
    const now=Date.now();
    for(const [key,value]of previews)if(value.expires<=now)previews.delete(key);
    while(previews.size>=20)previews.delete(previews.keys().next().value);
    const previewId=ready?id():null;
    if(ready) previews.set(previewId,{
      sessionHash,expires:now+15*60*1000,
      plans:plans.map(p=>({studentId:p.studentId,selected:p.chosen.map(row=>({
        question:row.question,questionFingerprint:fingerprint(row.question),historyFingerprint:fingerprint(row.history),
      }))})),
    });
    return {previewId,ready,mode,criteria,expiresInMinutes:15,students:plans.map(p=>({
      studentId:p.studentId,name:p.name,available:p.available,requested:p.requested,issue:p.issue,
      questions:p.chosen.map(({question:q,history})=>({
        id:q.id,prompt:q.prompt,topics:q.topics,courses:q.courses,difficulty:q.difficulty,type:q.type,history,
      })),
    }))};
  }
  function commit(previewId,sessionHash,title,due) {
    const preview=previews.get(previewId);
    check(preview&&preview.sessionHash===sessionHash&&preview.expires>Date.now(),'This preview has expired. Preview the question sets again.',409);
    const bank=new Map(store.questions().map(q=>[q.id,q]));
    const created=store.transaction(()=>{
      // Validate all learners and all questions before inserting any assignment.
      for(const plan of preview.plans) {
        check(store.db.prepare('SELECT id FROM students WHERE id=?').get(plan.studentId),'A student was removed. Preview the sets again.',409);
        const history=questionHistory(store,plan.studentId);
        for(const item of plan.selected) {
          check(bank.has(item.question.id)&&fingerprint(bank.get(item.question.id))===item.questionFingerprint,'A question was edited or archived. Preview the sets again.',409);
          check(fingerprint(history.get(item.question.id)??emptyHistory())===item.historyFingerprint,'Student practice changed after this preview. Preview the sets again.',409);
        }
      }
      return preview.plans.map(plan=>{
        const assignmentId=id();
        store.db.prepare('INSERT INTO assignments VALUES(?,?,?,?,?,?)').run(assignmentId,plan.studentId,title,due,JSON.stringify(plan.selected.map(item=>item.question)),new Date().toISOString());
        return {id:assignmentId,studentId:plan.studentId,count:plan.selected.length};
      });
    });
    previews.delete(previewId);
    return {count:created.length,assignments:created};
  }
  return {prepare,commit};
}
