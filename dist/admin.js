// Super admin portal: login, a read-only list of customers, and the security log.
const content = document.querySelector('#content');
const account = document.querySelector('#account');
const notice = document.querySelector('#notice');
let me = null;
let people = null;
let events = null;
let bot = null;
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
  if (!response.ok) throw Object.assign(new Error(result.error || 'Something went wrong. Please try again.'), {status:response.status});
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
const EVENT_NAMES = {
  'signup':'Customer signed up', 'login':'Customer logged in', 'login-failed':'Wrong password (customer page)',
  'login-locked':'Login blocked: too many wrong passwords', 'admin-login':'Admin logged in',
  'admin-login-failed':'Wrong password (admin page)', 'password-changed':'Password changed',
  'password-change-failed':'Wrong current password when changing password'
};
const ALERT_EVENTS = new Set(['login-failed','admin-login-failed','login-locked','password-change-failed']);
function renderLogin() {
  content.innerHTML = '<div class="page-head"><h1>Admin login</h1><p>For Rooted &amp; Rising administrators. Customers log in on the <a href="/">main page</a>.</p></div>'+
    '<form id="auth" class="card auth" novalidate>'+
    '<div class="field"><label for="f-email">Email</label><input id="f-email" name="email" type="email" autocomplete="username" required maxlength="254"></div>'+
    '<div class="field"><label for="f-password">Password</label><input id="f-password" name="password" type="password" autocomplete="current-password" required maxlength="200"></div>'+
    '<div class="bot-check" id="bot-check"></div><div class="actions"><button class="primary" type="submit">Log in</button></div></form>'+
    '<p class="hint spaced">For your security, admin sessions end after 30 minutes of inactivity.</p>';
  bot = botCheck(document.querySelector('#bot-check'), 'admin-login');
}
function renderPeople() {
  const customers = (people?.users ?? []).filter(user=>user.role==='customer');
  const online = customers.filter(user=>user.online).length;
  const log = events?.events ?? [];
  const alerts = log.filter(item=>ALERT_EVENTS.has(item.event) && Date.now()-item.at < 86400000).length;
  content.innerHTML = '<div class="page-head"><div class="section-head"><h1>Customers</h1><button type="button" class="secondary" data-action="refresh">Refresh</button></div><p>Who has an account and who is using Car Companion right now. This view is read-only.</p></div>'+
    '<div class="grid summary"><section class="card"><p class="label">Customer accounts</p><p class="number">'+customers.length+'</p></section><section class="card"><p class="label">Online now</p><p class="number">'+online+'</p></section><section class="card"><p class="label">Failed logins, last 24 h</p><p class="number">'+alerts+'</p></section></div>'+
    '<div class="card table-wrap"><table><thead><tr><th scope="col">Email</th><th scope="col">Status</th><th scope="col">Last active</th><th scope="col">Last login</th><th scope="col">Joined</th><th scope="col">Devices logged in</th></tr></thead><tbody>'+
    (customers.map(user=>'<tr><td>'+safe(user.email)+'</td>'+
      '<td><span class="tag'+(user.online?' done':'')+'">'+(user.online?'Online now':user.active_sessions?'Logged in':'Logged out')+'</span></td>'+
      '<td>'+ago(user.last_seen_at ?? user.last_login_at)+'</td><td>'+ago(user.last_login_at)+'</td><td>'+ago(user.created_at)+'</td><td>'+user.active_sessions+'</td></tr>').join('')||'<tr><td colspan="6">No customers have signed up yet.</td></tr>')+
    '</tbody></table></div><p class="hint spaced">“Online now” means active in the last 5 minutes.</p>'+
    '<div class="section-head"><h2>Security log</h2></div><p class="hint">Logins, sign-ups and password changes from the last 90 days (newest 100 shown).</p>'+
    '<div class="card table-wrap"><table><thead><tr><th scope="col">When</th><th scope="col">What happened</th><th scope="col">Email</th><th scope="col">IP address</th></tr></thead><tbody>'+
    (log.map(item=>'<tr><td>'+ago(item.at)+'</td><td>'+(ALERT_EVENTS.has(item.event)?'<span class="tag">'+safe(EVENT_NAMES[item.event]??item.event)+'</span>':safe(EVENT_NAMES[item.event]??item.event))+'</td><td>'+safe(item.email)+'</td><td>'+safe(item.ip)+'</td></tr>').join('')||'<tr><td colspan="4">Nothing logged yet.</td></tr>')+
    '</tbody></table></div>';
}
function render() {
  account.innerHTML = me ? '<span class="who">'+safe(me.email)+'</span><button type="button" class="quiet" data-action="password">Password</button><button type="button" class="quiet" data-action="logout">Log out</button>' : '';
  if (!me) renderLogin(); else renderPeople();
}
async function loadPeople() { [people, events] = await Promise.all([api('/api/admin/users'), api('/api/admin/events')]); }
async function start() {
  try {
    me = (await api('/api/me?portal=admin')).user;
    if (me) await loadPeople();
  } catch (error) { content.innerHTML = '<div class="card empty"><h3>Can’t load the admin portal</h3><p class="hint">'+safe(error.message)+'</p></div>'; return; }
  render();
}
content.addEventListener('submit', async event => {
  if (event.target.id !== 'auth') return;
  event.preventDefault();
  const submit = event.target.querySelector('[type=submit]');
  const values = Object.fromEntries(new FormData(event.target));
  if (!values.email.trim() || !values.password) { say('Enter your email and password.'); return; }
  submit.disabled = true;
  try {
    const turnstile = await bot.token();
    me = (await api('/api/login','POST',{email:values.email.trim(),password:values.password,portal:'admin',turnstile})).user;
    await loadPeople();
    render();
    say('Logged in.');
  } catch (error) { say(error.message); submit.disabled = false; bot?.reset(); }
});
document.addEventListener('click', async event => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'password') changePassword();
  if (action === 'logout') { try { await api('/api/logout?portal=admin','POST'); } catch {} me = null; people = null; events = null; render(); say('Logged out.'); }
  if (action === 'refresh') { try { await loadPeople(); renderPeople(); say('Updated.'); } catch (error) { if (error.status !== 401) say(error.message); } }
});
const changePassword = setupPasswordDialog('admin', say);
start();
