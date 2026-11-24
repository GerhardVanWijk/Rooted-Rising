const key = 'rr-car-companion-v1';
const fresh = () => ({ car: null, records: [], reminders: [] });
let data = fresh();
let me = null; // { email, role } once logged in
let authMode = 'login';
const content = document.querySelector('#content');
const tabs = document.querySelector('#tabs');
const dialog = document.querySelector('#editor');
const form = document.querySelector('#form');
const notice = document.querySelector('#notice');
const account = document.querySelector('#account');
let page = 'Home';
let editing;
let noticeTimer;
const sections = { Home:'⌂', Garage:'◇', Records:'▤', Reminders:'◷' };
const fields = {
  car: [
    ['name','Car nickname','text',true], ['model','Make, model and year','text',true],
    ['plate','Registration number','text'], ['tyre','Tyre size','text'],
    ['roadside','Roadside assistance number','tel'], ['contact','Emergency contact number','tel']
  ],
  records: [
    ['title','What did you pay for?','text',true], ['type','Type',['Tyres','Service','Repair','Other'],true],
    ['date','Date','date',true], ['cost','Total paid (R)','number'],
    ['supplier','Fitment centre or workshop','text'], ['note','Notes','textarea']
  ],
  reminders: [
    ['title','What should we remind you about?','text',true],
    ['type','Type',['Licence disc','Service','Tyre check','Other'],true],
    ['date','Due date','date',true],
    ['lead','Calendar alert',['On the due date','7 days before','14 days before','30 days before'],true]
  ]
};
function safe(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}
function say(message) {
  clearTimeout(noticeTimer);
  notice.textContent = message;
  noticeTimer = setTimeout(() => { notice.textContent = ''; }, 5500);
}
async function api(path, method='GET', body) {
  const response = await fetch(path, {
    method, credentials:'same-origin',
    headers: body ? {'content-type':'application/json'} : {},
    body: body ? JSON.stringify(body) : undefined
  });
  const result = await response.json().catch(()=>({}));
  if (response.status === 401 && me) { me = null; render(); say('Your session ended. Please log in again.'); }
  if (!response.ok) throw new Error(result.error || 'Something went wrong. Please try again.');
  return result;
}
async function save(next, message) {
  try { await api('/api/data','PUT',{data:next}); }
  catch (error) { say('Couldn’t save: '+error.message); return false; }
  data = next;
  render();
  say(message);
  return true;
}
async function loadAccount() {
  const result = await api('/api/data');
  data = result.data ?? fresh();
  // Move anything saved in this browser before accounts existed into the account, once.
  let local = null;
  try { local = JSON.parse(localStorage.getItem(key)); } catch {}
  if (!result.data && local && (local.car || local.records?.length || local.reminders?.length)) {
    if (await save({...fresh(),...local}, 'We moved the details saved in this browser into your account.')) localStorage.removeItem(key);
  }
}
async function start() {
  try { me = (await api('/api/me')).user; }
  catch { content.innerHTML = blank('Can’t reach Car Companion','Check your connection and reload the page.'); return; }
  try {
    if (me?.role === 'customer') await loadAccount();
  } catch (error) { say(error.message); }
  render();
}
function renderAuth() {
  const signup = authMode === 'signup';
  content.innerHTML = '<section class="hero"><h1>'+(signup?'Create your account':'Welcome back')+'</h1><p>'+(signup?'Keep your car details, records and reminders safe in one place.':'Log in to see your car details, records and reminders.')+'</p></section>'+
    '<form id="auth" class="card auth" novalidate><div class="field"><label for="auth-email">Email</label><input id="auth-email" name="email" type="email" autocomplete="email" required maxlength="254"></div>'+
    '<div class="field"><label for="auth-password">Password</label><input id="auth-password" name="password" type="password" autocomplete="'+(signup?'new-password':'current-password')+'" required minlength="8" maxlength="200">'+(signup?'<p class="hint">At least 8 characters.</p>':'')+'</div>'+
    '<div class="actions"><button class="primary" type="submit">'+(signup?'Create account':'Log in')+'</button></div></form>'+
    '<div class="card auth switch"><p>'+(signup?'Already have an account?':'New to Car Companion?')+'</p>'+button(signup?'Log in instead':'Create an account','auth-mode','secondary')+'</div>';
}
function day() {
  const now = new Date();
  return [now.getFullYear(), String(now.getMonth()+1).padStart(2,'0'), String(now.getDate()).padStart(2,'0')].join('-');
}
function formatDate(date) {
  return new Intl.DateTimeFormat('en-ZA',{day:'numeric',month:'short',year:'numeric'}).format(new Date(date+'T12:00:00'));
}
function amount(value) {
  return new Intl.NumberFormat('en-ZA',{style:'currency',currency:'ZAR'}).format(Number(value));
}
function button(label, action, kind='secondary', id='') {
  return '<button type="button" class="'+kind+'" data-action="'+action+'" data-id="'+safe(id)+'">'+label+'</button>';
}
function listDetails(items) {
  return '<dl class="details">'+items.filter(([,value])=>value).map(([label,value])=>'<div><dt>'+label+'</dt><dd>'+safe(value)+'</dd></div>').join('')+'</dl>';
}
function blank(title,body) {
  return '<div class="card empty"><h3>'+title+'</h3><p class="hint">'+body+'</p></div>';
}
function reminderCard(item) {
  const past = item.date < day();
  const status = item.done ? 'Done' : past ? 'Overdue' : item.date === day() ? 'Due today' : 'Upcoming';
  return '<article class="card"><div class="card-head"><h3>'+safe(item.title)+'</h3><span class="tag'+(item.done?' done':'')+'">'+status+'</span></div>'+
    '<p class="label">'+safe(item.type)+' · '+formatDate(item.date)+'</p><div class="actions">'+
    (item.done ? '' : button('Add to calendar','calendar','secondary',item.id))+
    button(item.done?'Reopen':'Mark done','toggle','secondary',item.id)+button('Edit','edit-reminders','quiet',item.id)+'</div></article>';
}
function render() {
  account.innerHTML = me ? '<span class="who">'+safe(me.email)+'</span>'+button('Log out','logout','quiet') : '';
  tabs.hidden = me?.role !== 'customer';
  if (!me) { renderAuth(); return; }
  const due = data.reminders.filter(item=>!item.done).sort((a,b)=>a.date.localeCompare(b.date));
  tabs.innerHTML = Object.entries(sections).map(([name,icon])=>'<button type="button" data-action="page" data-id="'+name+'" '+(page===name?'aria-current="page"':'')+'><span aria-hidden="true">'+icon+'</span>'+name+'</button>').join('');
  if (page === 'Home') {
    content.innerHTML = '<section class="hero"><h1>Car Companion</h1><p>Your car details, tyre records and due dates, all in one place.</p>'+
      (data.car?button('Set a reminder','edit-reminders','primary'):button('Add my car','edit-car','primary'))+
      '</section><div class="grid summary"><section class="card"><p class="label">My car</p><h3>'+safe(data.car?.name ?? 'Your garage is empty')+'</h3><p class="hint">'+safe(data.car?.model ?? 'Save the details you reach for most.')+'</p></section>'+
      '<section class="card"><p class="label">Open reminders</p><p class="number">'+due.length+'</p></section></div>'+
      '<div class="section-head"><h2>Next up</h2>'+button('New reminder','edit-reminders')+'</div>'+
      '<div class="grid">'+(due.length?due.slice(0,3).map(reminderCard).join(''):blank('Nothing due yet','Add your next service, licence disc renewal or tyre check.'))+'</div>';
  }
  if (page === 'Garage') {
    const car = data.car;
    content.innerHTML = '<div class="page-head"><h1>Garage</h1><p>Keep the details you need at the fitment counter or on a call.</p></div>'+
      (car?'<article class="card"><h2>'+safe(car.name)+'</h2>'+listDetails([['Vehicle',car.model],['Registration',car.plate],['Tyre size',car.tyre],['Roadside assistance',car.roadside],['Emergency contact',car.contact]])+'</article>':blank('Add your car','Save your first car’s details and useful phone numbers.'))+
      '<div class="actions">'+button(car?'Edit car':'Add my car','edit-car','primary')+(car?button('Remove car','delete-car','quiet'):'')+'</div>'+
      '<p class="hint" style="margin-top:18px">Saved to your account, so it’s there on any device you log in from.</p>';
  }
  if (page === 'Records') {
    content.innerHTML = '<div class="page-head"><div class="section-head"><h1>Records</h1>'+button('New record','edit-records','primary')+'</div><p>Log tyre purchases, services and repairs.</p></div><div class="grid">'+
      ([...data.records].sort((a,b)=>b.date.localeCompare(a.date)).map(item=>'<article class="card"><div class="card-head"><h3>'+safe(item.title)+'</h3><span class="tag">'+safe(item.type)+'</span></div><p class="label">'+formatDate(item.date)+'</p>'+
        listDetails([['Paid',item.cost!==''?amount(item.cost):''],['Workshop',item.supplier],['Notes',item.note]])+button('Edit','edit-records','quiet',item.id)+'</article>').join('')||
        blank('No records yet','Add the work done, what you paid and where you took the car.'))+'</div>';
  }
  if (page === 'Reminders') {
    content.innerHTML = '<div class="page-head"><div class="section-head"><h1>Reminders</h1>'+button('New reminder','edit-reminders','primary')+'</div><p>Add an alert to your phone’s calendar for a reminder when this app is closed.</p></div><div class="grid">'+
      (due.length?due.map(reminderCard).join(''):blank('No open reminders','Pick a due date for your next car task.'))+'</div>'+
      (data.reminders.some(item=>item.done)?'<div class="section-head"><h2>Completed</h2></div><div class="grid">'+data.reminders.filter(item=>item.done).map(reminderCard).join('')+'</div>':'');
  }
}
function openEditor(group,id) {
  const item = group === 'car' ? data.car : data[group].find(entry=>entry.id===id);
  editing = {group,item};
  const singular = {car:'car',records:'record',reminders:'reminder'}[group];
  document.querySelector('#form-title').textContent = (item?'Edit ':'Add ')+singular;
  document.querySelector('#fields').innerHTML = fields[group].map(([name,label,type,required])=>{
    const value = item?.[name] ?? (name==='date'&&group==='records'?day():'');
    const attrs = ' id="field-'+name+'" name="'+name+'"'+(required?' required':'');
    const input = Array.isArray(type) ? '<select'+attrs+'>'+type.map(option=>'<option'+(option===(value|| (name==='lead'?'7 days before':''))?' selected':'')+'>'+option+'</option>').join('')+'</select>'
      : type==='textarea' ? '<textarea'+attrs+' rows="3" maxlength="500">'+safe(value)+'</textarea>'
      : '<input'+attrs+' type="'+type+'" value="'+safe(value)+'"'+(type==='number'?' min="0" step="0.01"':type==='date'?' min="1900-01-01" max="2199-12-31"':' maxlength="100"')+'>';
    return '<div class="field"><label for="field-'+name+'">'+label+'</label>'+input+'</div>';
  }).join('')+(item?.id?'<div class="actions">'+button('Delete '+singular,'delete-item','quiet',item.id)+'</div>':'');
  dialog.showModal();
}
content.addEventListener('submit',async event=>{
  if (event.target.id !== 'auth') return;
  event.preventDefault();
  const submit = event.target.querySelector('[type=submit]');
  const {email,password} = Object.fromEntries(new FormData(event.target));
  if (!email.trim() || !password) { say('Enter your email and password.'); return; }
  submit.disabled = true;
  try {
    me = (await api(authMode==='signup'?'/api/signup':'/api/login','POST',{email:email.trim(),password,portal:'customer'})).user;
    await loadAccount();
    page = 'Home';
    render();
    say(authMode==='signup'?'Account created. Welcome!':'Logged in.');
  } catch (error) { say(error.message); submit.disabled = false; }
});
form.addEventListener('submit',async event=>{
  event.preventDefault();
  const {group,item}=editing;
  const input=Object.fromEntries([...new FormData(form)].map(([name,value])=>[name,value.trim()]));
  if (fields[group].some(([name,,,required])=>required&&!input[name])) { say('Please fill in the required details.'); return; }
  const entry={...item,...input};
  const next={...data};
  if (group==='car') next.car=entry;
  else {
    entry.id ??= globalThis.crypto?.randomUUID?.() ?? Date.now()+'-'+Math.random().toString(36).slice(2);
    next[group]=item?data[group].map(old=>old.id===item.id?entry:old):[...data[group],entry];
  }
  if (await save(next,'Saved.')) dialog.close();
});
function calendar(item) {
  const stamp = new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
  const date = item.date.replace(/-/g,'');
  const lead = {'On the due date':'PT0S','7 days before':'-P7D','14 days before':'-P14D','30 days before':'-P30D'}[item.lead];
  const escape = text=>text.replaceAll('\\','\\\\').replaceAll(',','\\,').replaceAll(';','\\;').replaceAll('\n','\\n');
  const payload=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Rooted and Rising//Car Companion//EN','BEGIN:VEVENT','UID:'+item.id+'@car-companion','DTSTAMP:'+stamp,'DTSTART:'+date+'T090000','DURATION:PT15M','SUMMARY:'+escape(item.title),'BEGIN:VALARM','ACTION:DISPLAY','DESCRIPTION:Car Companion reminder','TRIGGER:'+lead,'END:VALARM','END:VEVENT','END:VCALENDAR',''].join('\r\n');
  const url=URL.createObjectURL(new Blob([payload],{type:'text/calendar;charset=utf-8'}));
  const link=document.createElement('a');
  link.href=url; link.download='car-reminder.ics'; link.click();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
  say('Calendar file downloaded. Open it in your calendar and check the alert is enabled.');
}
document.addEventListener('click',async event=>{
  if (event.target.closest('.close')) { dialog.close(); return; }
  const button=event.target.closest('[data-action]');
  if (!button) return;
  const {action,id}=button.dataset;
  if (action==='auth-mode') { authMode = authMode==='signup'?'login':'signup'; renderAuth(); document.querySelector('#auth-email').focus(); }
  else if (action==='logout') { try { await api('/api/logout','POST'); } catch {} me = null; data = fresh(); authMode = 'login'; render(); say('Logged out.'); }
  else if (action==='page') { page=id; render(); window.scrollTo(0,0); }
  else if (action.startsWith('edit-')) openEditor(action.slice(5),id);
  else if (action==='calendar') calendar(data.reminders.find(item=>item.id===id));
  else if (action==='toggle') save({...data,reminders:data.reminders.map(item=>item.id===id?{...item,done:!item.done}:item)},'Reminder updated.');
  else if (action==='delete-car' && confirm('Remove the saved car details?')) save({...data,car:null},'Car details removed.');
  else if (action==='delete-item' && confirm('Delete this entry?')) {
    const {group}=editing;
    if(await save({...data,[group]:data[group].filter(item=>item.id!==id)},'Entry deleted.')) dialog.close();
  }
});
start();
