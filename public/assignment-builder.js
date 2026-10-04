import {esc,badge,field,icon,label} from './views.js';

const blankHistory=()=>({seen:false,attempts:0,graded:0,correct:0,pending:0,accuracy:null});
const percent=value=>new Intl.NumberFormat(undefined,{maximumFractionDigits:2}).format(value)+'%';
export function historyBadges(h) {
  return '<div class="chips history-badges">'+badge(h.seen?'Seen':'Not seen',h.seen?'subtle':'green')+
    (h.graded?'<span class="badge '+(h.accuracy<65?'amber':'green')+'" title="'+h.correct+' correct out of '+h.graded+' graded attempts">'+esc(percent(h.accuracy))+' correct · '+h.correct+'/'+h.graded+'</span>':badge(h.attempts?'Not yet graded':h.seen?'No answers yet':'Not attempted','subtle'))+
    (h.pending?badge(h.pending+' awaiting grade','subtle'):'')+'</div>';
}
function facet(name,title,values) {
  return '<details class="assignment-facet"><summary>'+title+' <span data-facet-count="'+name+'">Any</span></summary><div class="facet-options">'+values.map(v=>'<label><input type="checkbox" name="'+name+'" value="'+esc(v)+'"><span>'+esc(label(v))+'</span></label>').join('')+'</div></details>';
}
function questionCard(q,h,manual,checked) {
  return '<article class="assignment-question">'+(manual?'<label class="assignment-check"><input type="checkbox" name="manualQuestion" value="'+esc(q.id)+'" '+(checked?'checked':'')+' aria-label="Select '+esc(q.prompt)+'"></label>':'')+'<div><p>'+esc(q.prompt)+'</p><div class="chips">'+q.topics.map(t=>badge(t)).join('')+badge(label(q.difficulty),'subtle')+badge(label(q.type),'subtle')+'</div>'+historyBadges(h)+'</div></article>';
}

export function openAssignmentBuilder({data,selected,api,modal,closeModal,onCreated,toast}) {
  const initialManual=selected.size>0;
  modal('Build a purposeful question set.',
    '<p class="modal-description">Choose what to practice and how much. Preview a tailored set for each learner before assigning it.</p>'+
    '<form id="assignment-builder-form"><div class="form-grid">'+
    field('Assignment name','<input name="title" required maxlength="100" placeholder="A fresh look at factoring">')+
    field('Due date · optional','<input name="due" type="date">')+'</div>'+
    '<fieldset class="builder-students"><legend>1. Choose students</legend><div class="student-pills">'+data.students.map(s=>'<label><input type="checkbox" name="students" value="'+esc(s.id)+'"><span>'+esc(s.name)+'</span></label>').join('')+'</div></fieldset>'+
    '<fieldset class="builder-mode"><legend>2. Build the set</legend><div class="mode-options"><label><input type="radio" name="mode" value="automatic" '+(!initialManual?'checked':'')+'><span><strong>Tags & problem count</strong><small>Choose a different set for each student.</small></span></label><label><input type="radio" name="mode" value="manual" '+(initialManual?'checked':'')+'><span><strong>Choose questions manually</strong><small>Give every selected student the same set.</small></span></label></div></fieldset>'+
    '<div class="assignment-facets">'+facet('topics','Topics',data.catalog.topics)+facet('courses','Courses',data.catalog.courses)+facet('difficulties','Difficulty',['easy','medium','hard','harder'])+facet('types','Format',['multiple-choice','short-response','written-response'])+'</div>'+
    '<p class="builder-help">Any selected tag within a group can match. Different groups must all match. Leave a group empty to include any.</p>'+
    '<div class="builder-filter-grid">'+field('Question history','<select name="history"><option value="all">Seen or unseen</option><option value="unseen">Not seen yet</option><option value="seen">Already seen</option></select>')+
    field('Student accuracy below (%)','<input name="accuracyBelow" type="number" min="0.01" max="100" step="any" placeholder="No accuracy filter">')+
    field('Minimum graded attempts','<input name="minAttempts" type="number" min="1" max="1000" step="1" value="1">')+'</div>'+
    '<p class="builder-help">Accuracy is per student, across all graded attempts, including repeats and guided practice. Pending and unattempted questions are excluded from percentage filters. “Below 65%” excludes exactly 65%.</p>'+
    '<div id="automatic-count" class="builder-count">'+field('Problems per student','<input name="count" type="number" min="1" max="100" step="1" value="10">')+'<label class="check-field"><input name="allMatching" type="checkbox"> Assign all matching problems</label><span class="builder-help">Up to 100 per student. Unseen questions first, then lower accuracy.</span></div>'+
    '<details id="builder-browser" class="builder-browser" '+(initialManual?'open':'')+'><summary><span id="browse-title">Explore questions & student history</span> <span id="manual-count"></span></summary>'+
    '<div class="builder-browse-controls">'+field('Show history for','<select name="inspectStudent" aria-label="Show history for"><option value="">Choose a student above</option></select>')+
    field('Search this list','<input name="browseSearch" placeholder="Search question text or tags">')+'</div>'+
    '<div id="manual-tools" class="button-row"><button type="button" class="btn small" data-builder-action="select-matching">Select all matching</button><button type="button" class="btn small ghost" data-builder-action="clear-selection">Clear selection</button></div>'+
    '<p id="browse-summary" class="builder-help" aria-live="polite"></p><div id="builder-question-list" class="builder-question-list"></div></details>'+
    '<div class="builder-preview-action"><button type="button" class="btn" id="preview-sets">'+icon('tasks')+'Preview question sets</button><span id="preview-status" class="builder-help" aria-live="polite">Preview before assigning.</span></div>'+
    '<div id="assignment-preview" aria-live="polite"></div><div class="builder-error form-error" role="alert"></div>'+
    '<div class="modal-actions"><button class="btn ghost" type="button" data-action="close-modal">Cancel</button><button id="assign-preview" class="btn primary" type="submit" disabled>Assign question set</button></div></form>',true);
  const form=document.querySelector('#assignment-builder-form');
  const find=selector=>form.querySelector(selector);
  let preview=null,version=0,loadingHistory=false,history=null,historyStudent='',historyVersion=0,previewBusy=false,committing=false;
  const manual=new Set(selected);
  const alive=()=>form.isConnected&&document.querySelector('#modal').open;
  const fail=message=>{find('.builder-error').textContent=message;};
  const values=()=>new FormData(form);
  const mode=()=>values().get('mode');
  function criteria() {
    const f=values();
    return {topics:f.getAll('topics'),courses:f.getAll('courses'),difficulties:f.getAll('difficulties'),types:f.getAll('types'),history:f.get('history'),accuracyBelow:f.get('accuracyBelow')===''?null:Number(f.get('accuracyBelow')),minAttempts:Number(f.get('minAttempts')||1)};
  }
  function invalidate() {
    version++;preview=null;find('#assign-preview').disabled=true;
    find('#assignment-preview').innerHTML='';
    find('#preview-status').textContent='Preview the current selection before assigning.';
    fail('');
  }
  function matchingQuestions() {
    if(!history)return [];
    const c=criteria(),search=String(values().get('browseSearch')||'').trim().toLowerCase();
    return data.questions.filter(q=>{
      const h=history[q.id]??blankHistory();
      return (!c.topics.length||c.topics.some(t=>q.topics.includes(t)))
        &&(!c.courses.length||c.courses.some(t=>q.courses.includes(t)))
        &&(!c.difficulties.length||c.difficulties.includes(q.difficulty))
        &&(!c.types.length||c.types.includes(q.type))
        &&(c.history==='all'||(c.history==='seen'?h.seen:!h.seen))
        &&(c.accuracyBelow===null||(h.graded>=c.minAttempts&&h.correct*100<h.graded*c.accuracyBelow))
        &&(!search||[q.prompt,...q.topics,...q.courses].join(' ').toLowerCase().includes(search));
    });
  }
  function renderList() {
    const manualMode=mode()==='manual';
    find('#manual-count').textContent=manualMode?manual.size+' selected':'';
    if(loadingHistory){find('#builder-question-list').innerHTML='<p class="builder-help">Loading this student’s question history…</p>';find('#browse-summary').textContent='';return;}
    if(!history){find('#builder-question-list').innerHTML='<p class="builder-help">Choose a student above to see their history.</p>';find('#browse-summary').textContent='';return;}
    const rows=matchingQuestions();
    const shown=new Set(rows.map(q=>q.id));
    const hiddenSelected=[...manual].filter(qid=>!shown.has(qid)).length;
    find('#browse-summary').textContent=rows.length+' matching question'+(rows.length===1?'':'s')+(manualMode&&hiddenSelected?' · '+hiddenSelected+' selected outside these list filters. Clear selection to remove them.':'.');
    find('#builder-question-list').innerHTML=rows.length?rows.map(q=>questionCard(q,history[q.id]??blankHistory(),manualMode,manual.has(q.id))).join(''):'<p class="builder-help">No questions match. Try different tags or history settings. Questions without graded attempts cannot match an accuracy cutoff.</p>';
  }
  async function loadHistory() {
    const studentId=find('[name="inspectStudent"]').value;
    if(studentId===historyStudent&&history)return renderList();
    const requestVersion=++historyVersion;
    history=null;historyStudent=studentId;loadingHistory=!!studentId;renderList();
    if(!studentId)return;
    try {
      const response=await api('question-history?student='+encodeURIComponent(studentId));
      if(!alive()||requestVersion!==historyVersion)return;
      history=response.history;
    } catch(error) {if(alive()&&requestVersion===historyVersion)fail('Could not load question history: '+error.message);}
    finally {if(alive()&&requestVersion===historyVersion){loadingHistory=false;renderList();}}
  }
  function updateControls() {
    const f=values(),manualMode=f.get('mode')==='manual';
    const selectedStudents=data.students.filter(s=>f.getAll('students').includes(s.id));
    const inspect=find('[name="inspectStudent"]'),previous=inspect.value;
    inspect.innerHTML=selectedStudents.length?selectedStudents.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.name)+'</option>').join(''):'<option value="">Choose a student above</option>';
    if(selectedStudents.some(s=>s.id===previous))inspect.value=previous;
    find('#automatic-count').hidden=manualMode;
    find('[name="count"]').disabled=manualMode||f.has('allMatching');
    find('[name="allMatching"]').disabled=manualMode;
    find('[name="minAttempts"]').disabled=f.get('accuracyBelow')==='';
    find('#manual-tools').hidden=!manualMode;
    find('#browse-title').textContent=manualMode?'Choose individual questions':'Explore questions & student history';
    if(manualMode)find('#builder-browser').open=true;
    for(const name of ['topics','courses','difficulties','types'])find('[data-facet-count="'+name+'"]').textContent=f.getAll(name).length?f.getAll(name).length+' selected':'Any';
    loadHistory();
  }
  async function previewSets() {
    if(previewBusy||committing)return;
    // Validate filter numbers, but the title can be added after exploring a set.
    for(const input of form.querySelectorAll('input[type="number"]:not(:disabled)'))if(!input.reportValidity())return;
    const f=values(),c=criteria();
    if(!f.getAll('students').length)return fail('Choose at least one student.');
    if(c.accuracyBelow!==null&&c.history==='unseen')return fail('Unseen questions have no accuracy yet. Choose “Already seen” or “Seen or unseen” for a percentage filter.');
    invalidate();
    const requestVersion=version;
    previewBusy=true;find('#preview-sets').disabled=true;find('#preview-status').textContent='Building question sets…';
    try {
      const result=await api('assignments/preview','POST',{studentIds:f.getAll('students'),mode:f.get('mode'),criteria:c,count:Number(f.get('count')),allMatching:f.has('allMatching'),questionIds:[...manual]});
      if(!alive()||requestVersion!==version)return;
      preview=result;
      find('#assignment-preview').innerHTML='<h3>3. Review each student’s set</h3>'+result.students.map(s=>'<section class="student-set"><div class="student-set-head"><strong>'+esc(s.name)+'</strong><span>'+s.questions.length+' problem'+(s.questions.length===1?'':'s')+(result.mode==='automatic'?' · '+s.available+' available':'')+'</span></div>'+(s.issue?'<p class="selection-issue">'+esc(s.issue)+'</p>':'')+'<details '+(result.students.length===1?'open':'')+'><summary>See questions & history</summary>'+s.questions.map(q=>questionCard(q,q.history,false,false)).join('')+'</details></section>').join('');
      find('#assign-preview').disabled=!result.ready;
      find('#preview-status').textContent=result.ready?'Ready to assign. This preview is saved for 15 minutes.':'Adjust the filters or problem count, then preview again. Nothing has been assigned.';
      // Re-fetch the explorer so badges reflect the same current server data.
      historyStudent='';await loadHistory();
    }catch(error){if(alive()&&requestVersion===version){fail(error.message);find('#preview-status').textContent='Preview unavailable. Check the selection and try again.';}}
    finally{previewBusy=false;if(alive())find('#preview-sets').disabled=false;}
  }
  form.addEventListener('input',event=>{
    if(event.target.name==='browseSearch'){renderList();return;}
    if(['accuracyBelow','count','minAttempts'].includes(event.target.name)){invalidate();updateControls();}
  });
  form.addEventListener('change',event=>{
    if(event.target.name==='manualQuestion'){
      if(event.target.checked)manual.add(event.target.value);else manual.delete(event.target.value);
      invalidate();renderList();return;
    }
    if(event.target.name==='inspectStudent'){loadHistory();return;}
    if(['title','due','browseSearch'].includes(event.target.name))return;
    invalidate();updateControls();
  });
  find('#preview-sets').addEventListener('click',previewSets);
  form.addEventListener('click',event=>{
    const action=event.target.closest('[data-builder-action]')?.dataset.builderAction;
    if(!action)return;
    if(action==='clear-selection')manual.clear();
    if(action==='select-matching'){
      if(!history)return fail('Wait for the student’s question history to load.');
      const ids=matchingQuestions().map(q=>q.id);
      if(new Set([...manual,...ids]).size>100)return fail('More than 100 questions would be selected. Narrow the filters first.');
      ids.forEach(qid=>manual.add(qid));
    }
    invalidate();renderList();
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();event.stopPropagation();
    if(committing)return;
    if(!preview?.ready)return fail('Preview the question sets before assigning.');
    committing=true;find('#assign-preview').disabled=true;find('#preview-sets').disabled=true;
    const f=values();
    try{
      await api('assignments','POST',{previewId:preview.previewId,title:f.get('title'),due:f.get('due')});
      if(alive())closeModal();
      await onCreated();toast('Question sets assigned.');
    }catch(error){
      if(alive()){invalidate();fail(error.message);}
    }finally{
      committing=false;if(alive())find('#preview-sets').disabled=false;
    }
  });
  updateControls();
}
