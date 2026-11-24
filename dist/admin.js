// Super admin portal: one-time setup, login, and a read-only list of accounts.
const content = document.querySelector('#content');
const account = document.querySelector('#account');
const notice = document.querySelector('#notice');
let me = null;
let setupNeeded = false;
let people = null;
let noticeTimer;

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
function ago(time) {
  if (!time) return 'Never';
  const minutes = Math.round((Date.now()-time)/60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return minutes+' min ago';
  if (minutes < 1440) return Math.round(minutes/60)+' h ago';
  return new Intl.DateTimeFormat('en-ZA',{day:'numeric',month:'short',year:'numeric'}).format(new Date(time));
}
function field(name, label, type, autocomplete, hint='') {
  return '<div class="field"><label for="f-'+name+'">'+label+'</label><input id="f-'+name+'" name="'+name+'" type="'+type+'" autocomplete="'+autocomplete+'" required maxlength="254">'+(hint?'<p class="hint">'+hint+'</p>':'')+'</div>';
}
function renderLogin() {
  content.innerHTML = setupNeeded
    ? '<div class="page-head"><h1>Set up the admin account</h1><p>This only happens once. Choose the email and password you’ll use to log in as the super admin.</p></div>'+
      '<form id="auth" class="card auth" novalidate>'+field('code','Setup code','text','off','The one-time code you were given.')+
      field('email','Your email','email','email')+field('password','Choose a password','password','new-password','At least 8 characters.')+
      '<div class="actions"><button class="primary" type="submit">Create admin account</button></div></form>'
    : '<div class="page-head"><h1>Admin login</h1><p>For Rooted &amp; Rising administrators. Customers log in on the <a href="/">main page</a>.</p></div>'+
      '<form id="auth" class="card auth" novalidate>'+field('email','Email','email','email')+field('password','Password','password','current-password')+
      '<div class="actions"><button class="primary" type="submit">Log in</button></div></form>';
}
function renderPeople() {
  const users = people?.users ?? [];
  const customers = users.filter(user=>user.role==='customer');
  const online = customers.filter(user=>user.online).length;
  content.innerHTML = '<div class="page-head"><div class="section-head"><h1>Customers</h1><button type="button" class="secondary" data-action="refresh">Refresh</button></div><p>Who has an account and who is using Car Companion right now. This view is read-only.</p></div>'+
    '<div class="grid summary"><section class="card"><p class="label">Customer accounts</p><p class="number">'+customers.length+'</p></section><section class="card"><p class="label">Online now</p><p class="number">'+online+'</p></section></div>'+
    '<div class="card table-wrap"><table><thead><tr><th scope="col">Email</th><th scope="col">Status</th><th scope="col">Last active</th><th scope="col">Last login</th><th scope="col">Joined</th><th scope="col">Devices logged in</th></tr></thead><tbody>'+
    (customers.map(user=>'<tr><td>'+safe(user.email)+'</td>'+
      '<td><span class="tag'+(user.online?' done':'')+'">'+(user.online?'Online now':user.active_sessions?'Logged in':'Logged out')+'</span></td>'+
      '<td>'+ago(user.last_seen_at)+'</td><td>'+ago(user.last_login_at)+'</td><td>'+ago(user.created_at)+'</td><td>'+user.active_sessions+'</td></tr>').join('')||'<tr><td colspan="6">No customers have signed up yet.</td></tr>')+
    '</tbody></table></div><p class="hint" style="margin-top:14px">“Online now” means active in the last 5 minutes.</p>';
}
function render() {
  account.innerHTML = me ? '<span class="who">'+safe(me.email)+'</span><button type="button" class="quiet" data-action="logout">Log out</button>' : '';
  if (!me) renderLogin(); else renderPeople();
}
async function loadPeople() { people = await api('/api/admin/users'); }
async function start() {
  try {
    me = (await api('/api/me?portal=admin')).user;
    if (me) await loadPeople(); else setupNeeded = (await api('/api/setup')).needed;
  } catch (error) { content.innerHTML = '<div class="card empty"><h3>Can’t load the admin portal</h3><p class="hint">'+safe(error.message)+'</p></div>'; return; }
  render();
}
content.addEventListener('submit', async event => {
  if (event.target.id !== 'auth') return;
  event.preventDefault();
  const submit = event.target.querySelector('[type=submit]');
  const values = Object.fromEntries(new FormData(event.target));
  if (Object.values(values).some(value=>!String(value).trim())) { say('Please fill in every field.'); return; }
  submit.disabled = true;
  try {
    me = setupNeeded
      ? (await api('/api/setup','POST',{code:values.code.trim(),email:values.email.trim(),password:values.password})).user
      : (await api('/api/login','POST',{email:values.email.trim(),password:values.password,portal:'admin'})).user;
    const created = setupNeeded;
    setupNeeded = false;
    await loadPeople();
    render();
    say(created ? 'Admin account created. You’re logged in.' : 'Logged in.');
  } catch (error) { say(error.message); submit.disabled = false; }
});
document.addEventListener('click', async event => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'logout') { try { await api('/api/logout?portal=admin','POST'); } catch {} me = null; people = null; render(); say('Logged out.'); }
  if (action === 'refresh') { try { await loadPeople(); renderPeople(); say('Updated.'); } catch (error) { say(error.message); } }
});
start();
