import * as V from './views.js';
import { openAssignmentBuilder } from './assignment-builder.js';
const $=selector=>document.querySelector(selector);
const state={data:null,route:'overview',analytics:{days:30,student:'',assignment:'',first:false},bank:{},filters:{},selected:new Set(),practice:null,repeat:false,guided:false};
let activeSeconds=0,tick=Date.now(),renderVersion=0;
setInterval(()=>{const now=Date.now();if(state.practice?.question&&!state.practice.result&&!document.hidden)activeSeconds+=Math.min((now-tick)/1000,2);tick=now;},1000);
document.addEventListener('visibilitychange',()=>{tick=Date.now();});
async function api(path,method='GET',body) {
  const response=await fetch('/api/'+path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
  const result=await response.json();
  if(!response.ok)throw new Error(result.error||'Something went wrong.');
  return result;
}
function toast(message) {const node=$('#toast');node.textContent=message;node.classList.add('visible');setTimeout(()=>node.classList.remove('visible'),4500);}
function download(value,name) {const blob=new Blob([JSON.stringify(value,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function modal(title,body,wide=false) {
  const m=$('#modal');m.className=wide?'wide':'';
  m.innerHTML='<div class="modal-head"><h2>'+V.esc(title)+'</h2><button class="icon-btn" data-action="close-modal" aria-label="Close dialog">'+V.icon('close')+'</button></div>'+body+'<div class="form-error" role="alert"></div>';
  if(!m.open)m.showModal();
}
const closeModal=()=>$('#modal').close();
const input=(name,value='',extra='')=>'<input name="'+name+'" value="'+V.esc(value)+'" '+extra+'>';
const area=(name,value='',rows=3)=>'<textarea name="'+name+'" rows="'+rows+'">'+V.esc(value)+'</textarea>';
const actions=(title='Save')=>'<div class="modal-actions">'+V.btn('Cancel','close-modal','ghost')+'<button class="btn primary" type="submit">'+title+'</button></div>';
const lines=s=>String(s||'').split('\n').map(s=>s.trim()).filter(Boolean);
const comma=s=>String(s||'').split(',').map(s=>s.trim()).filter(Boolean);
async function refresh() {state.data=await api('data');}
function go(route) {if(location.hash==='#'+route){state.route=route;render();}else location.hash=route;}
async function render() {
  if(!state.data)return;
  const version=++renderVersion,d=state.data;
  state.route=location.hash.slice(1)||'overview';
  if(!['overview','students','questions','assignments','analytics','practice','settings','about','review'].includes(state.route))state.route='overview';
  if(d.role!=='tutor'&&['students','questions','review'].includes(state.route))state.route='overview';
  if(d.role==='parent'&&state.route==='practice')state.route='overview';
  let html;
  try {
    if(state.route==='overview') html=V.overview(d,await api('analytics?days=30'));
    else if(state.route==='analytics')html=V.analytics(d,await api('analytics?'+new URLSearchParams(state.analytics)),state.analytics);
    else if(state.route==='students')html=V.studentPage(d);
    else if(state.route==='questions')html=V.questionPage(d,state.bank,state.selected);
    else if(state.route==='assignments')html=V.heading('PURPOSEFUL QUESTION SETS','The next steps, all in one place.','A little structure for steady progress.',d.role==='tutor'?V.btn(V.icon('plus')+'Create assignment','new-assignment','primary'):'')+V.assignmentCards(d);
    else if(state.route==='practice')html=V.practicePage(d,state.filters,state.practice,state.repeat,state.guided);
    else if(state.route==='settings')html=V.settingsPage(d);
    else if(state.route==='about')html=V.aboutPage(d);
    else if(state.route==='review')html=V.heading('A HUMAN TOUCH','Give their thinking a closer look.','Review saved responses when automatic grading needs a human look.')+(d.pending.length?d.pending.map(a=>'<section class="card review-card"><div class="chips">'+V.badge(d.students.find(s=>s.id===a.studentId)?.name||'Student')+V.badge('Awaiting review','amber')+'</div><h3>'+V.esc(a.question.prompt)+'</h3><div class="review-answer">'+V.esc(a.answer)+'</div><p><strong>Answer key / rubric:</strong> '+V.esc(a.question.answer)+'</p><div class="button-row">'+V.btn('Mark correct','grade-writing','primary','data-id="'+a.id+'" data-correct="1"')+V.btn('Needs practice','grade-writing','','data-id="'+a.id+'" data-correct="0"')+'</div></section>').join(''):V.empty('All caught up','Responses that need review will appear here.'));
    if(version!==renderVersion)return;
    $('#app').innerHTML=V.shell(html,d,state.route);
    if(innerWidth<=640) {
      const footer=$('footer');
      footer.insertAdjacentHTML('beforeend','<div class="mobile-utility"><a href="#settings">Settings</a><a href="#about">About</a><button data-action="logout">Sign out</button></div>');
    }
    setupMath();
  } catch(error) {toast(error.message);}
}
async function setupMath() {
  const mf=$('#math-answer'); if(!mf)return;
  await customElements.whenDefined('math-field');
  mf.mathVirtualKeyboardPolicy='manual';
  // Use MathLive's public typed-input command for printable hardware keys.
  // This bypasses its delayed native focus buffer while preserving shortcuts.
  // Navigation, deletion, IME composition and modifier shortcuts stay native.
  let shortcutBuffer='';
  mf.addEventListener('pointerdown',()=>{shortcutBuffer='';HTMLElement.prototype.focus.call(mf);},true);
  mf.addEventListener('keydown',event=>{
    if(!mf.readOnly && event.key.length===1 && !event.ctrlKey && !event.metaKey && !event.altKey && !event.isComposing) {
      event.preventDefault();event.stopImmediatePropagation();
      mf.executeCommand(['typedText',event.key,{simulateKeystroke:true,feedback:false}]);
      shortcutBuffer=/^[a-z]$/.test(event.key)?(shortcutBuffer+event.key).slice(-4):'';
      const shortcut=shortcutBuffer.endsWith('sqrt')?'sqrt':shortcutBuffer.endsWith('pi')?'pi':null;
      if(shortcut && mf.getValue([Math.max(0,mf.position-shortcut.length),mf.position])===shortcut) {
        for(let i=0;i<shortcut.length;i++)mf.executeCommand('deleteBackward');
        mf.insert(shortcut==='sqrt'?'\\sqrt{#0}':'\\pi');shortcutBuffer='';
      }
    }
  },true);
  mf.inlineShortcuts={...mf.inlineShortcuts,sqrt:'\\sqrt{#0}',pi:'\\pi'};
  if(state.practice?.submitted)mf.value=state.practice.submitted;
  mf.addEventListener('input',()=>{state.practice.draft=mf.value;});
  if(state.practice?.draft&&!state.practice.result)mf.value=state.practice.draft;
  mf.removeAttribute('inert');mf.removeAttribute('aria-busy');
  if(!state.practice.result){mf.focus();HTMLElement.prototype.focus.call(mf);}
  mf.dataset.ready='true';
}
async function boot() {
  const settings=await api('public');
  document.title=settings.name+' · Thoughtful practice';
  const params=new URLSearchParams(location.hash.slice(1));
  const access=params.get('access');
  if(access) {
    history.replaceState(null,'',location.pathname+'#overview');
    try {await api('session','POST',{token:access});}catch(error){$('#app').innerHTML=V.landing(settings,error.message);return;}
  }
  try {await refresh();await render();}
  catch {$('#app').innerHTML=V.landing(settings);}
}
function linkModal(links) {
  modal('A private link. A personal start.','<p class="modal-description">Copy these now and share them directly. Full links are only shown when created or replaced. Replacing a link invalidates the previous one.</p>'+
    Object.entries(links).filter(([key])=>key.endsWith('Link')||key==='link').map(([key,value])=>'<div class="link-box"><h3>'+({studentLink:'Student practice link',parentLink:'Parent link · read only',link:'New access link'}[key])+'</h3><input aria-label="'+key+'" readonly value="'+V.esc(value)+'"><button class="btn small" data-action="copy-link">'+V.icon('link')+'Copy link</button></div>').join('')+
    '<div class="modal-actions">'+V.btn('Done','close-modal','primary')+'</div>');
}
function questionModal(q={}) {
  modal(q.id?'Make this question work for you.':'Add a reusable question.',
    '<form id="question-form" data-id="'+(q.id||'')+'">'+V.field('Question prompt',area('prompt',q.prompt,3))+
    '<div class="form-grid">'+V.field('Topics · comma separated',input('topics',q.topics?.join(', '),'required placeholder="Factoring, Quadratics"'))+V.field('Courses · comma separated',input('courses',q.courses?.join(', '),'placeholder="Algebra I, SAT, GED"'))+'</div>'+
    '<div class="form-grid">'+V.field('Answer format','<select name="type">'+['multiple-choice','short-response','written-response'].map(t=>'<option value="'+t+'" '+(q.type===t?'selected':'')+'>'+V.label(t)+'</option>').join('')+'</select>')+V.field('Difficulty','<select name="difficulty">'+['easy','medium','hard','harder'].map(t=>'<option value="'+t+'" '+(q.difficulty===t?'selected':'')+'>'+V.label(t)+'</option>').join('')+'</select>')+'</div>'+
    V.field('Multiple-choice options · one per line',area('choices',q.choices?.join('\n'),3),'Leave blank for math or writing responses.')+
    V.field('Correct answer / writing rubric',area('answer',q.answer,2),'Math: use a number, expression, or LaTeX. Multiple choice: match one choice exactly. Writing: give the LLM clear grading criteria.')+
    V.field('Other accepted math answers · one per line',area('alternatives',q.alternatives?.join('\n'),2))+
    '<div class="form-grid">'+V.field('Numeric rounding tolerance',input('tolerance',q.tolerance??0,'type="number" min="0" max="1" step="any"'))+V.field('Math answer matching','<select name="mathMatch"><option value="equivalent" '+(q.mathMatch!=='exact'?'selected':'')+'>Accept equivalent expressions</option><option value="exact" '+(q.mathMatch==='exact'?'selected':'')+'>Require listed form(s)</option></select>','Use listed forms when factoring or simplifying is the skill being tested.')+'</div>'+
    V.field('Explanation shown after submission',area('explanation',q.explanation,3))+
    V.field('Step-by-step hints · one per line',area('steps',q.steps?.join('\n'),3),'Teach the method without giving away the final answer.')+
    (q.id?'<p class="muted">Existing assignments and attempts keep their original question version.</p>':'')+
    actions(q.id?'Save question':'Add to question bank')+'</form>'+
    (q.id?V.btn('Archive this question','archive-question','danger small','data-id="'+q.id+'"'):''),
    true);
}
function assignmentModal() {
  const d=state.data;
  if(!d.students.length){modal('First, add a learner.','<p>Assignments need a student to belong to.</p>'+V.btn('Add student','add-student','primary'));return;}
  openAssignmentBuilder({data:d,selected:state.selected,api,modal,closeModal,toast,onCreated:async()=>{state.selected.clear();await refresh();go('assignments');}});
}
async function nextQuestion(assignmentId=null) {
  const result=await api('practice/next','POST',{assignmentId,filters:state.filters,repeat:state.repeat,guided:state.guided});
  state.practice=result; activeSeconds=0; tick=Date.now();
  await refresh(); go('practice');
}
document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-action]');if(!button)return;
  event.preventDefault();if(button.disabled)return;
  const action=button.dataset.action,id=button.dataset.id;
  button.disabled=true;
  try {
    if(action==='close-modal')closeModal();
    else if(action==='logout'){await api('logout','POST',{});state.data=null;state.practice=null;history.replaceState(null,'','/');await boot();}
    else if(action==='add-student')modal('Start with a first name.','<p class="modal-description">No email address, birthday, school, or contact information. A nickname works too.</p><form id="student-form">'+V.field('First name or nickname',input('name','','required maxlength="40" autocomplete="off" placeholder="e.g. Alex"'))+actions('Create private links')+'</form>');
    else if(action==='copy-link'){const value=button.parentElement.querySelector('input').value;try{await navigator.clipboard.writeText(value);toast('Private link copied.');}catch{button.parentElement.querySelector('input').select();toast('Select and copy the link above.');}}
    else if(action==='student-links'){
      const s=state.data.students.find(s=>s.id===id);
      modal('Access for '+s.name,'<p class="modal-description">Existing links cannot be retrieved. Creating a replacement signs out sessions using that link. The other role’s access stays active.</p><div class="link-box"><h3>Student practice</h3><p>Can practice, submit answers, and see progress.</p>'+V.btn('Replace student link','rotate-link','','data-id="'+id+'" data-role="student"')+'</div><div class="link-box"><h3>Parent view</h3><p>Can view only this learner’s assignments and progress.</p>'+V.btn('Replace parent link','rotate-link','','data-id="'+id+'" data-role="parent"')+'</div>');
    }
    else if(action==='rotate-link')linkModal(await api('students/'+id+'/links','POST',{role:button.dataset.role}));
    else if(action==='manage-student'){
      const s=state.data.students.find(s=>s.id===id);
      modal('Manage '+s.name,'<p class="modal-description">Export this learner’s records or permanently delete their profile, links, question history, assignments, and answers.</p>'+V.btn('Export learning records','export-student','','data-id="'+id+'"')+'<hr><form id="delete-student-form" data-id="'+id+'" data-name="'+V.esc(s.name)+'">'+V.field('Type '+V.esc(s.name)+' to confirm deletion',input('confirm','','required autocomplete="off"'))+'<button class="btn danger" type="submit">Delete student and history</button></form>');
    }
    else if(action==='export-student')download(await api('students/'+id+'/export'),'progresspoint-student-records.json');
    else if(action==='student-results'){state.analytics={...state.analytics,student:id,assignment:''};go('analytics');}
    else if(action==='assignment-results'){state.analytics={...state.analytics,assignment:id,student:state.data.assignments.find(a=>a.id===id)?.studentId||''};go('analytics');}
    else if(action==='add-question')questionModal();
    else if(action==='edit-question')questionModal(state.data.questions.find(q=>q.id===id));
    else if(action==='archive-question'){
      modal('Archive this question?','<p>It will leave the practice bank. Existing assignments and results remain available.</p><div class="modal-actions">'+V.btn('Cancel','close-modal')+V.btn('Archive question','confirm-archive','danger','data-id="'+id+'"')+'</div>');
    }
    else if(action==='confirm-archive'){await api('questions/'+id,'DELETE',{});state.selected.delete(id);closeModal();await refresh();await render();toast('Question archived.');}
    else if(action==='export-bank')download({version:1,questions:state.data.questions},'progresspoint-question-bank.json');
    else if(action==='import-bank')modal('Bring your questions with you.','<p class="modal-description">Import a JSON file with a questions array. Export the existing bank for an example. Imports are validated together; if any question is invalid, none are added.</p><form id="import-form">'+V.field('Question bank file','<input type="file" name="file" accept=".json,application/json" required>')+actions('Import questions')+'</form>');
    else if(action==='new-assignment')assignmentModal();
    else if(action==='start-assignment')await nextQuestion(id);
    else if(action==='start-practice')await nextQuestion();
    else if(action==='next-question')await nextQuestion(state.practice?.assignmentId);
    else if(action==='leave-practice'){state.practice=null;go('practice');}
    else if(action==='choose-topic'){state.filters={...state.filters,topic:button.dataset.topic};await render();$('#practice-filters').scrollIntoView({behavior:'smooth',block:'center'});}
    else if(action==='grade-writing'){await api('attempts/'+id+'/grade','POST',{correct:Number(button.dataset.correct)});await refresh();await render();toast('Feedback saved.');}
    else if(action==='rotate-tutor')modal('Replace your tutor link?','<p>Other tutor sessions and the previous link will stop working. Copy the new link when it appears. This browser stays signed in.</p>'+V.btn('Replace tutor link','confirm-rotate-tutor','primary'));
    else if(action==='confirm-rotate-tutor')linkModal(await api('tutor-link','POST',{}));
    else if(action==='math-insert'){const mf=$('#math-answer');mf.focus();mf.insert(button.dataset.latex);state.practice.draft=mf.value;}
    else if(action==='math-keyboard'){const mf=$('#math-answer');mf.focus();window.mathVirtualKeyboard?.show();}
  }catch(error){if($('#modal').open)$('#modal .form-error').textContent=error.message;else toast(error.message);}
  finally{button.disabled=false;}
});
document.addEventListener('submit',async event=>{
  event.preventDefault();const form=event.target;
  const submit=form.querySelector('button[type="submit"]')||form.querySelector('button');
  if(submit?.disabled)return;
  if(submit)submit.disabled=true;
  const f=new FormData(form),value=Object.fromEntries(f);
  try {
    if(form.id==='access-form'){
      const url=new URL(value.link,location.origin),key=new URLSearchParams(url.hash.slice(1)).get('access');
      if(!key)throw new Error('Paste the complete private link from your tutor.');
      await api('session','POST',{token:key});history.replaceState(null,'','/#overview');await refresh();await render();
    }
    else if(form.id==='student-form'){const result=await api('students','POST',{name:value.name});await refresh();await render();linkModal(result);}
    else if(form.id==='delete-student-form'){
      if(value.confirm!==form.dataset.name)throw new Error('The confirmation name does not match.');
      await api('students/'+form.dataset.id,'DELETE',{});closeModal();await refresh();await render();toast('Student and learning history deleted.');
    }
    else if(form.id==='question-form'){
      const question={...value,topics:comma(value.topics),courses:comma(value.courses),choices:lines(value.choices),alternatives:lines(value.alternatives),steps:lines(value.steps),tolerance:Number(value.tolerance)};
      await api(form.dataset.id?'questions/'+form.dataset.id:'questions',form.dataset.id?'PUT':'POST',question);
      closeModal();await refresh();await render();toast('Question saved to your bank.');
    }
    else if(form.id==='import-form'){
      const file=f.get('file');if(file.size>2_000_000)throw new Error('Use a JSON file smaller than 2 MB.');
      let data;try{data=JSON.parse(await file.text());}catch{throw new Error('This file is not valid JSON.');}
      const result=await api('questions/import','POST',{questions:Array.isArray(data)?data:data.questions});
      closeModal();await refresh();await render();toast(result.count+' questions imported.');
    }
    else if(form.id==='settings-form'){
      await api('settings','PUT',{...value,autoGenerate:f.has('autoGenerate'),autoGradeWriting:f.has('autoGradeWriting'),dailyLimit:Number(value.dailyLimit)});
      await refresh();await render();toast('Workspace settings saved.');
    }
    else if(form.id==='answer-form'){
      const mf=$('#math-answer');const answer=mf?mf.value:value.answer;
      if(!answer?.trim())throw new Error('Enter an answer first.');
      state.practice.submitted=answer;
      state.practice.result=await api('practice/answer','POST',{ticketId:state.practice.ticketId,answer,seconds:Math.min(3600,Math.round(activeSeconds))});
      await refresh();await render();
    }
  } catch(error){if($('#modal').open)$('#modal .form-error').textContent=error.message;else toast(error.message);}
  finally{if(submit)submit.disabled=false;}
});
document.addEventListener('change',async event=>{
  const node=event.target;
  if(node.dataset.question){if(node.checked)state.selected.add(node.dataset.question);else state.selected.delete(node.dataset.question);await render();}
  else if(node.closest('#analytics-filters')){
    const f=new FormData($('#analytics-filters')),previousStudent=state.analytics.student;
    state.analytics={student:f.get('student')||'',days:Number(f.get('days')),assignment:f.get('assignment')||'',first:f.has('first')};
    if(previousStudent!==state.analytics.student)state.analytics.assignment='';
    await render();
  }
  else if(node.closest('#bank-filters')){state.bank=Object.fromEntries(new FormData($('#bank-filters')));await render();}
  else if(node.closest('#practice-filters'))state.filters=Object.fromEntries(new FormData($('#practice-filters')));
  else if(node.id==='repeat-toggle')state.repeat=node.checked;
  else if(node.id==='guided-toggle')state.guided=node.checked;
});
let searchTimer;
document.addEventListener('input',event=>{
  if(event.target.matches('#bank-filters input[name="search"]')){
    const field=event.target,position=field.selectionStart;clearTimeout(searchTimer);
    searchTimer=setTimeout(async()=>{state.bank=Object.fromEntries(new FormData($('#bank-filters')));await render();const current=$('#bank-filters input[name="search"]');current?.focus();current?.setSelectionRange(position,position);},250);
  }
  if(event.target.closest('#practice-filters'))state.filters=Object.fromEntries(new FormData($('#practice-filters')));
});
window.addEventListener('hashchange',()=>render());
$('#modal').addEventListener('click',event=>{if(event.target===$('#modal')){const r=event.target.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeModal();}});
boot().catch(error=>{$('#app').textContent='The workspace could not be opened: '+error.message;});
