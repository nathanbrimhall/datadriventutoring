import { id, token, hash, text, check, fail, validateQuestion, publicQuestion, matches, grade, summarize } from './domain.mjs';
import { assignmentPlanner, questionHistory } from './assignments.mjs';
import { gradeMath } from './math.mjs';
import { gradeWriting } from './writing.mjs';
import { generateQuestion, providerStatus } from './generation.mjs';

export function createAPI(store, { env = process.env, fetchImpl = fetch } = {}) {
  const {db} = store;
  let generating = false;
  const planner=assignmentPlanner(store);
  const requireRole=(session,role)=>check(session?.role===role,'This action is not available for this access link.',403);
  const studentExists=studentId=>check(db.prepare('SELECT id FROM students WHERE id=?').get(studentId),'Student not found.',404);
  const ticketResult=row=>({ticketId:row.id,question:publicQuestion(JSON.parse(row.question),!!row.guided),guided:!!row.guided,assignmentId:row.assignmentId});
  return async function api({req,res,path,url,session,body,send,origin}) {
    const method=req.method;
    if(path==='/api/health') return send(200,{ok:true});
    if(path==='/api/public' && method==='GET') {
      const s=store.getConfig('settings');
      return send(200,{name:s.name,tagline:s.tagline,about:s.about});
    }
    if(path==='/api/session' && method==='POST') {
      const key=text(body.token,'Access link',100), digest=hash(key);
      let role='tutor',studentId=null;
      if(digest!==store.getConfig('adminHash')) {
        const student=db.prepare('SELECT id,studentHash,parentHash FROM students WHERE studentHash=? OR parentHash=?').get(digest,digest);
        check(student,'This link is invalid or has been replaced. Ask your tutor for a new link.',401);
        role=student.studentHash===digest?'student':'parent'; studentId=student.id;
      }
      const keySession=token();
      db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
      db.prepare('INSERT INTO sessions(hash,role,studentId,expires) VALUES(?,?,?,?)').run(hash(keySession),role,studentId,Date.now()+7*86400000);
      res.setHeader('Set-Cookie','baseline='+keySession+'; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800'+(origin.startsWith('https:')?'; Secure':''));
      return send(200,{role});
    }
    check(session,'Open your private access link to continue.',401);
    if(path==='/api/logout' && method==='POST') {
      db.prepare('DELETE FROM sessions WHERE hash=?').run(session.hash);
      res.setHeader('Set-Cookie','baseline=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
      return send(200,{ok:true});
    }
    if(path==='/api/data' && method==='GET') {
      const settings=store.getConfig('settings');
      const rows=store.attempts(session.role==='tutor'?undefined:session.studentId);
      const assignments=store.assignments(session.role==='tutor'?undefined:session.studentId).map(a=>{
        const attempts=rows.filter(r=>r.assignmentId===a.id);
        const graded=attempts.filter(r=>r.correct!==null);
        return {...a,questions:session.role==='tutor'?a.questions:undefined,
          count:a.questions.length,completed:attempts.length,pending:attempts.length-graded.length,
          accuracy:graded.length?Math.round(graded.reduce((n,r)=>n+r.correct,0)/graded.length*100):null,
          topics:[...new Set(a.questions.flatMap(q=>q.topics))]};
      });
      const questions=store.questions();
      const catalog={topics:[...new Set(questions.flatMap(q=>q.topics))].sort(),courses:[...new Set(questions.flatMap(q=>q.courses))].sort(),count:questions.length};
      const identity=session.role==='tutor'?null:db.prepare('SELECT id,name FROM students WHERE id=?').get(session.studentId);
      return send(200,{role:session.role,identity,catalog,assignments,
        settings:session.role==='tutor'?{...settings,...providerStatus(settings,env)}:{name:settings.name,tagline:settings.tagline,about:settings.about},
        students:session.role==='tutor'?store.students().map(s=>({...s,stats:summarize(rows.filter(a=>a.studentId===s.id),30)})):[],
        questions:session.role==='tutor'?questions:[],
        pending:session.role==='tutor'?rows.filter(a=>a.correct===null):[]});
    }
    if(path==='/api/analytics' && method==='GET') {
      const studentId=session.role==='tutor'?(url.searchParams.get('student')||undefined):session.studentId;
      const days=Number(url.searchParams.get('days')||30); check([14,30,90].includes(days),'Choose 14, 30, or 90 days.');
      const assignmentId=url.searchParams.get('assignment');
      let attempts=store.attempts(studentId);
      if(url.searchParams.get('first')==='true') {
        const seen=new Set();attempts=attempts.filter(a=>{const key=a.studentId+':'+a.questionId;const first=!seen.has(key);seen.add(key);return first&&!a.guided;});
      }
      if(assignmentId) attempts=attempts.filter(a=>a.assignmentId===assignmentId);
      return send(200,summarize(attempts,days));
    }
    if(path==='/api/students' && method==='POST') {
      requireRole(session,'tutor');
      const name=text(body.name,'First name',40); check(!/\s/.test(name),'Use a first name or nickname only, without spaces.');
      const studentId=id(),studentToken=token(),parentToken=token();
      db.prepare('INSERT INTO students VALUES(?,?,?,?,?)').run(studentId,name,hash(studentToken),hash(parentToken),new Date().toISOString());
      return send(201,{id:studentId,name,studentLink:origin+'/#access='+studentToken,parentLink:origin+'/#access='+parentToken});
    }
    const studentMatch=path.match(/^\/api\/students\/([^/]+)(?:\/(links|export))?$/);
    if(studentMatch) {
      requireRole(session,'tutor'); const studentId=studentMatch[1]; studentExists(studentId);
      if(method==='DELETE' && !studentMatch[2]) {
        db.prepare('DELETE FROM students WHERE id=?').run(studentId); return send(200,{ok:true});
      }
      if(method==='GET' && studentMatch[2]==='export') return send(200,{student:store.students().find(s=>s.id===studentId),assignments:store.assignments(studentId),attempts:store.attempts(studentId)});
      if(method==='POST' && studentMatch[2]==='links') {
        const role=body.role; check(['student','parent'].includes(role),'Choose student or parent access.');
        const newToken=token();
        store.transaction(()=>{
          db.prepare('UPDATE students SET '+(role==='student'?'studentHash':'parentHash')+'=? WHERE id=?').run(hash(newToken),studentId);
          db.prepare('DELETE FROM sessions WHERE studentId=? AND role=?').run(studentId,role);
        });
        return send(200,{role,link:origin+'/#access='+newToken});
      }
    }
    if(path==='/api/questions' && method==='POST') {
      requireRole(session,'tutor'); return send(201,store.putQuestion({...validateQuestion(body),reviewed:true}));
    }
    if(path==='/api/questions/import' && method==='POST') {
      requireRole(session,'tutor'); check(Array.isArray(body.questions)&&body.questions.length>0&&body.questions.length<=500,'Import 1–500 questions at a time.');
      const questions=body.questions.map(validateQuestion);
      store.transaction(()=>questions.forEach(q=>store.putQuestion({...q,reviewed:true})));
      return send(201,{count:questions.length});
    }
    const questionMatch=path.match(/^\/api\/questions\/([^/]+)$/);
    if(questionMatch) {
      requireRole(session,'tutor');
      const q=store.questions().find(q=>q.id===questionMatch[1]); check(q,'Question not found.',404);
      if(method==='PUT') return send(200,store.putQuestion({...validateQuestion(body),id:q.id,source:q.source,reviewed:true}));
      if(method==='DELETE') {
        db.prepare('UPDATE questions SET archived=1 WHERE id=?').run(q.id);
        return send(200,{ok:true});
      }
    }
    if(path==='/api/question-history' && method==='GET') {
      requireRole(session,'tutor');
      const studentId=text(url.searchParams.get('student'),'Student',100);studentExists(studentId);
      return send(200,{studentId,history:Object.fromEntries(questionHistory(store,studentId))});
    }
    if(path==='/api/assignments/preview' && method==='POST') {
      requireRole(session,'tutor');return send(200,planner.prepare(body,session.hash));
    }
    if(path==='/api/assignments' && method==='POST') {
      requireRole(session,'tutor');
      const title=text(body.title,'Assignment title',100),due=text(body.due??'','Due date',10,true);
      check(!due||(/^\d{4}-\d{2}-\d{2}$/.test(due)&&!isNaN(Date.parse(due))&&new Date(due).toISOString().slice(0,10)===due),'Use a valid due date.');
      if(body.previewId!==undefined) return send(201,planner.commit(text(body.previewId,'Preview',100),session.hash,title,due));
      check(Array.isArray(body.studentIds)&&body.studentIds.length>0&&body.studentIds.length<=100,'Choose 1–100 students.');
      const studentIds=[...new Set(body.studentIds)]; studentIds.forEach(studentExists);
      check(Array.isArray(body.questionIds)&&body.questionIds.length>0&&body.questionIds.length<=100,'Choose 1–100 questions.');
      const bank=store.questions();
      const questions=[...new Set(body.questionIds)].map(qid=>{const q=bank.find(q=>q.id===qid);check(q,'An assigned question is unavailable.');return q;});
      store.transaction(()=>studentIds.forEach(studentId=>db.prepare('INSERT INTO assignments VALUES(?,?,?,?,?,?)').run(id(),studentId,title,due,JSON.stringify(questions),new Date().toISOString())));
      return send(201,{count:studentIds.length});
    }
    if(path==='/api/practice/next' && method==='POST') {
      requireRole(session,'student');
      const assignmentId=body.assignmentId||null;
      let question, guided=false;
      if(assignmentId) {
        const assignment=store.assignments(session.studentId).find(a=>a.id===assignmentId);
        check(assignment,'Assignment not found.',404);
        const answered=new Set(store.attempts(session.studentId).filter(a=>a.assignmentId===assignmentId).map(a=>a.questionId));
        question=assignment.questions.find(q=>!answered.has(q.id));
        if(!question) return send(200,{complete:true,message:'Assignment complete. Your progress has been saved.'});
        const active=db.prepare('SELECT * FROM tickets WHERE studentId=? AND assignmentId=? AND used=0 ORDER BY createdAt DESC').all(session.studentId,assignmentId).find(row=>JSON.parse(row.question).id===question.id);
        if(active) return send(200,ticketResult(active));
      } else {
        const f=body.filters||{};
        const filters={};
        for(const key of ['topic','course','type','difficulty','search']) filters[key]=text(f[key]??'',key,100,true);
        filters.guided=body.guided===true; guided=filters.guided;
        const seen=new Set(db.prepare('SELECT questionId FROM seen WHERE studentId=?').all(session.studentId).map(r=>r.questionId));
        const bank=store.questions();
        const candidates=bank.filter(q=>matches(q,filters)&&(body.repeat===true||!seen.has(q.id)));
        if(candidates.length) question=candidates[Math.floor(Math.random()*candidates.length)];
        else {
          const settings=store.getConfig('settings');
          if(!settings.autoGenerate||!providerStatus(settings,env).configured) return send(200,{exhausted:true,message:'You have reached the end of the matching questions. Try another topic, allow repeats, or ask your tutor to add more.',canGenerate:false});
          check(!generating,'Another question is being generated. Try again in a moment.',429);
          const day=new Date().toISOString().slice(0,10);
          const usage=db.prepare('SELECT count FROM generation_usage WHERE day=?').get(day)?.count??0;
          check(usage<settings.dailyLimit,'Today’s question-generation limit has been reached. Try another topic or allow repeats.',429);
          generating=true;
          db.prepare('INSERT INTO generation_usage(day,count) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET count=count+1').run(day);
          try {
            const examples=bank.filter(q=>matches(q,{...filters,search:''})).slice(0,3).map(({id,source,reviewed,archived,...q})=>q);
            const generated=await generateQuestion({settings,filters,examples,fetchImpl,env});
            // Re-check authorization after the external request; links may have been revoked meanwhile.
            check(db.prepare('SELECT hash FROM sessions WHERE hash=? AND expires>?').get(session.hash,Date.now()),'Your access link has been replaced. Open the new link.',401);
            check(!store.questions().some(q=>q.prompt.trim().toLowerCase()===generated.prompt.trim().toLowerCase()),'The provider returned a duplicate question. Try later or enable repeats.',502);
            question=store.putQuestion(generated);
          } finally { generating=false; }
        }
      }
      const ticket={id:id(),studentId:session.studentId,assignmentId,question:JSON.stringify(question),guided:guided?1:0,createdAt:new Date().toISOString()};
      store.transaction(()=>{
        db.prepare('INSERT INTO tickets(id,studentId,assignmentId,question,guided,createdAt) VALUES(?,?,?,?,?,?)').run(ticket.id,ticket.studentId,ticket.assignmentId,ticket.question,ticket.guided,ticket.createdAt);
        db.prepare('INSERT OR IGNORE INTO seen VALUES(?,?)').run(session.studentId,question.id);
      });
      return send(200,ticketResult(ticket));
    }
    if(path==='/api/practice/answer' && method==='POST') {
      requireRole(session,'student');
      const ticket=db.prepare('SELECT * FROM tickets WHERE id=? AND studentId=?').get(text(body.ticketId,'Question session',100),session.studentId);
      check(ticket,'Question session not found.',404);
      const q=JSON.parse(ticket.question);
      const existing=db.prepare('SELECT * FROM attempts WHERE ticketId=?').get(ticket.id);
      if(existing) return send(200,{...db.prepare('SELECT feedback,source AS gradingSource FROM reviews WHERE attemptId=?').get(existing.id),correct:existing.correct,answer:q.answer,explanation:q.explanation,steps:q.steps,pending:existing.correct===null});
      check(!ticket.used,'This question session is closed.',409);
      const answer=text(body.answer,'Your answer',4000);
      const seconds=Number(body.seconds);
      check(Number.isFinite(seconds)&&seconds>=0&&seconds<=3600,'Time spent must be between 0 and 3600 seconds.');
      if(q.type==='multiple-choice') check(q.choices.includes(answer),'Choose one of the available answers.');
      let correct=grade(q,answer);
      if(q.type==='short-response' && correct===0 && q.mathMatch!=='exact')correct=null;
      const attemptId=id();
      store.transaction(()=>{
        if(ticket.assignmentId) check(!db.prepare('SELECT id FROM attempts WHERE studentId=? AND assignmentId=? AND questionId=?').get(session.studentId,ticket.assignmentId,q.id),'This assignment question has already been submitted.',409);
        db.prepare('INSERT INTO attempts VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(attemptId,ticket.id,session.studentId,ticket.assignmentId,q.id,ticket.question,answer,correct,Math.round(seconds),ticket.guided,new Date().toISOString());
        db.prepare('UPDATE tickets SET used=1 WHERE id=?').run(ticket.id);
      });
      let feedback, gradingSource;
      if(q.type==='short-response' && correct===null) {
        correct=await gradeMath(q,answer);
        db.prepare('UPDATE attempts SET correct=? WHERE id=?').run(correct,attemptId);
      }
      if(q.type==='written-response') {
        const settings=store.getConfig('settings');
        const day=new Date().toISOString().slice(0,10);
        const usage=db.prepare('SELECT count FROM generation_usage WHERE day=?').get(day)?.count??0;
        if(settings.autoGradeWriting!==false && providerStatus(settings,env).configured && usage<settings.dailyLimit) {
          db.prepare('INSERT INTO generation_usage(day,count) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET count=count+1').run(day);
          try {
            const result=await gradeWriting({settings,question:q,answer,fetchImpl,env});
            if(db.prepare('SELECT id FROM attempts WHERE id=?').get(attemptId)) {
              correct=result.correct; feedback=result.feedback; gradingSource='ai';
              store.transaction(()=>{db.prepare('UPDATE attempts SET correct=? WHERE id=?').run(correct,attemptId);db.prepare('INSERT INTO reviews VALUES(?,?,?)').run(attemptId,feedback,'ai');});
            }
          } catch { feedback='Your response is saved. AI grading was unavailable, so your tutor will review it.'; }
        }
      }
      return send(200,{correct,answer:q.answer,explanation:q.explanation,steps:q.steps,pending:correct===null,feedback,gradingSource});
    }
    const reviewMatch=path.match(/^\/api\/attempts\/([^/]+)\/grade$/);
    if(reviewMatch && method==='POST') {
      requireRole(session,'tutor'); check(body.correct===0||body.correct===1,'Choose correct or needs practice.');
      const a=db.prepare('SELECT * FROM attempts WHERE id=?').get(reviewMatch[1]); check(a,'Attempt not found.',404);
      check(JSON.parse(a.question).type!=='multiple-choice','Multiple-choice responses are graded from their answer key.');
      store.transaction(()=>{db.prepare('UPDATE attempts SET correct=? WHERE id=?').run(body.correct,a.id);db.prepare('INSERT INTO reviews VALUES(?,?,?) ON CONFLICT(attemptId) DO UPDATE SET feedback=excluded.feedback,source=excluded.source').run(a.id,'Reviewed by your tutor.','tutor');}); return send(200,{ok:true});
    }
    if(path==='/api/settings' && method==='PUT') {
      requireRole(session,'tutor');
      const settings={
        name:text(body.name,'Workspace name',50),tagline:text(body.tagline,'Tagline',120),
        about:text(body.about,'About',4000),provider:body.provider,model:text(body.model??'','Model',100,true),
        autoGenerate:body.autoGenerate===true,autoGradeWriting:body.autoGradeWriting!==false,dailyLimit:Number(body.dailyLimit),
        guidelines:text(body.guidelines,'Generation guidelines',8000),
      };
      check(['openai','gemini','compatible'].includes(settings.provider),'Choose a supported provider.');
      check(Number.isInteger(settings.dailyLimit)&&settings.dailyLimit>=1&&settings.dailyLimit<=100,'Use a daily limit from 1 to 100.');
      check(!settings.autoGenerate||providerStatus(settings,env).configured,'Add the provider key on the server and set a model before enabling generation.');
      store.setConfig('settings',settings); return send(200,{...settings,...providerStatus(settings,env)});
    }
    if(path==='/api/tutor-link' && method==='POST') {
      requireRole(session,'tutor'); const newToken=token();
      store.transaction(()=>{store.setConfig('adminHash',hash(newToken));db.prepare("DELETE FROM sessions WHERE role='tutor' AND hash<>?").run(session.hash);});
      return send(200,{link:origin+'/#access='+newToken});
    }
    fail(404,'This endpoint does not exist.');
  };
}
