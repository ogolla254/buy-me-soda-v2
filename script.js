// BuyMeSoda browser application logic
class UserSession {
  static isLoggedIn() { return localStorage.getItem('user') !== null; }
  static getCurrentUser() { const raw = localStorage.getItem('user'); return raw ? JSON.parse(raw) : null; }
  static setUser(user) { localStorage.setItem('user', JSON.stringify(user)); }
  static logout() { localStorage.removeItem('user'); }
}

class API {
  static getBaseUrl() { return window.location.origin; }
  static async request(path, options = {}) {
    const response = await fetch(`${API.getBaseUrl()}${path}`, { credentials: 'same-origin', ...options });
    let data = {};
    try { data = await response.json(); } catch (_) {}
    if (!response.ok) throw new Error(data.error || 'Request failed');
    return data;
  }
  static register(formData) { return API.request('/api/register', { method: 'POST', body: formData }); }
  static login(credentials) { return API.request('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credentials) }); }
  static logout() { return API.request('/api/logout', { method: 'POST' }); }
  static me() { return API.request('/api/me'); }
  static getCreator(username) { return API.request(`/api/creator/${encodeURIComponent(username)}`); }
  static getCreatorDashboard() { return API.request('/api/creator-dashboard'); }
  static createSupport(data) { return API.request('/api/support', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); }
  static trackEvent(type, extra = {}) { return API.request('/api/analytics/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, path: window.location.pathname, ...extra }) }).catch(() => null); }
}

function validateEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim()); }
function validatePaypalMe(url) { return /^https:\/\/paypal\.me\/[A-Za-z0-9._-]+\/?$/.test(String(url || '').trim()); }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function showMessage(message, type = 'info') {
  const div = document.createElement('div'); div.textContent = message;
  div.style.cssText = `position:fixed;top:20px;right:20px;padding:12px 20px;border-radius:8px;color:white;font-weight:600;z-index:9999;max-width:340px;background:${type === 'error' ? '#ef4444' : type === 'success' ? '#10b981' : '#3b82f6'};box-shadow:0 8px 24px rgba(0,0,0,.18)`;
  document.body.appendChild(div); setTimeout(() => div.remove(), 3500);
}

function initializeMainPage() {
  const loggedOutView = document.getElementById('loggedOutView'), loggedInView = document.getElementById('loggedInView'), logoutBtn = document.getElementById('logoutBtn'), user = UserSession.getCurrentUser();
  if (loggedOutView && loggedInView) { loggedOutView.style.display = user ? 'none' : 'flex'; loggedInView.style.display = user ? 'flex' : 'none'; }
  if (user) { document.getElementById('username')?.replaceChildren(document.createTextNode(user.username)); document.getElementById('paypalMe')?.replaceChildren(document.createTextNode(user.paypalMe)); }
  logoutBtn?.addEventListener('click', async () => { await API.logout().catch(() => {}); UserSession.logout(); location.reload(); });
  API.trackEvent('page_view');
}

function initializeSignupPage() {
  const form = document.getElementById('signupForm'); if (!form) return;
  form.addEventListener('submit', async event => {
    event.preventDefault(); const data = new FormData(form);
    const name = String(data.get('name') || '').trim(), email = String(data.get('email') || '').trim(), username = String(data.get('username') || '').trim(), password = String(data.get('password') || ''), paypalMe = String(data.get('paypalMe') || '').trim();
    if (name.length < 2) return showMessage('Please enter your name', 'error');
    if (!validateEmail(email)) return showMessage('Please enter a valid email', 'error');
    if (username.length < 3) return showMessage('Username must be at least 3 characters', 'error');
    if (password.length < 6) return showMessage('Password must be at least 6 characters', 'error');
    if (!validatePaypalMe(paypalMe)) return showMessage('Please enter a valid PayPal.Me link', 'error');
    try { const user = await API.register(data); UserSession.setUser(user); showMessage('Account created successfully!', 'success'); setTimeout(() => { window.location.href = 'login.html'; }, 1000); }
    catch (error) { showMessage(error.message || 'Error creating account', 'error'); }
  });
}

function initializeLoginPage() {
  const form = document.getElementById('loginForm'); if (!form) return;
  form.addEventListener('submit', async event => {
    event.preventDefault(); const data = new FormData(form), email = String(data.get('email') || '').trim(), password = String(data.get('password') || '');
    if (!validateEmail(email)) return showMessage('Please enter a valid email', 'error');
    if (!password) return showMessage('Please enter your password', 'error');
    try { const user = await API.login({ email, password }); UserSession.setUser(user); showMessage(`Welcome back, ${user.name || user.username}!`, 'success'); setTimeout(() => { window.location.href = 'creator-dashboard.html'; }, 800); }
    catch (error) { showMessage(error.message || 'Invalid email or password', 'error'); }
  });
}

function initializeQRPage() {
  if (!UserSession.isLoggedIn()) return void (window.location.href = 'login.html');
  const user = UserSession.getCurrentUser(), paypalMe = document.getElementById('paypalMe'), downloadBtn = document.getElementById('downloadBtn');
  if (paypalMe) paypalMe.textContent = user.paypalMe; API.trackEvent('qr_view', { username: user.username });
  setTimeout(() => { const container = document.getElementById('qrcode'); if (container && typeof QRCode !== 'undefined') { container.innerHTML = ''; new QRCode(container, { text: `${window.location.origin}/${user.username}`, width: 256, height: 256, correctLevel: QRCode.CorrectLevel.H }); } }, 100);
  downloadBtn?.addEventListener('click', () => { const canvas = document.querySelector('#qrcode canvas'); if (!canvas) return; const link = document.createElement('a'); link.download = `${user.username}-soda-qr.png`; link.href = canvas.toDataURL(); link.click(); API.trackEvent('qr_download', { username: user.username }); });
}

let currentCreator = null, selectedSodaCount = 1;
function openSupportModal(sodaCount) {
  selectedSodaCount = sodaCount; const modal = document.getElementById('supportModal'), amount = document.getElementById('supportAmount'), form = document.getElementById('supportForm');
  if (!modal || !amount || !form) return; amount.textContent = `You are supporting with $${sodaCount}.`; form.reset(); modal.classList.add('open'); modal.setAttribute('aria-hidden', 'false'); document.getElementById('supporterName')?.focus();
}
function closeSupportModal() { const modal = document.getElementById('supportModal'); if (!modal) return; modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true'); }

function initializeCreatorPage() {
  const parts = window.location.pathname.split('/').filter(Boolean), username = parts[parts.length - 1]; if (!username || username.includes('.')) return;
  API.getCreator(username).then(creator => {
    currentCreator = creator; document.title = `${creator.name || creator.username} - Buy Me a Soda 🥤`;
    if (document.getElementById('creatorName')) document.getElementById('creatorName').textContent = creator.name || creator.username;
    if (document.getElementById('creatorBio')) document.getElementById('creatorBio').textContent = creator.bio || 'Support me by buying me a soda! 🥤';
    if (document.getElementById('profileImage') && creator.profilePicture) document.getElementById('profileImage').src = creator.profilePicture;
    setTimeout(() => { const qr = document.getElementById('qrcode'); if (qr && typeof QRCode !== 'undefined') { qr.innerHTML = ''; new QRCode(qr, { text: `${window.location.origin}/${creator.username}`, width: 200, height: 200 }); } }, 100);
    document.querySelectorAll('.soda-btn').forEach(button => button.addEventListener('click', () => openSupportModal(Number(button.dataset.sodas || 1))));
    document.getElementById('supportCancel')?.addEventListener('click', closeSupportModal);
    document.getElementById('supportModal')?.addEventListener('click', event => { if (event.target.id === 'supportModal') closeSupportModal(); });
    document.getElementById('supportForm')?.addEventListener('submit', async event => {
      event.preventDefault(); const button = document.getElementById('supportPay'), supporterName = String(document.getElementById('supporterName')?.value || '').trim(), supporterEmail = String(document.getElementById('supporterEmail')?.value || '').trim(), message = String(document.getElementById('supporterMessage')?.value || '').trim();
      if (supporterEmail && !validateEmail(supporterEmail)) return showMessage('Please enter a valid email', 'error');
      button.disabled = true; button.textContent = 'Preparing payment...';
      try { const result = await API.createSupport({ username: currentCreator.username, sodaCount: selectedSodaCount, supporterName, supporterEmail, message }); closeSupportModal(); showMessage(`Support reference ${result.reference} created. Opening PayPal...`, 'success'); window.open(result.paymentUrl, '_blank', 'noopener'); }
      catch (error) { showMessage(error.message || 'Could not start support', 'error'); }
      finally { button.disabled = false; button.textContent = 'Continue to PayPal'; }
    });
    document.getElementById('copyLinkBtn')?.addEventListener('click', async () => { const url = `${window.location.origin}/${creator.username}`; try { await navigator.clipboard.writeText(url); showMessage('Link copied to clipboard!', 'success'); } catch (_) { showMessage(url); } });
    document.getElementById('shareQRBtn')?.addEventListener('click', () => { const canvas = document.querySelector('#qrcode canvas'); if (!canvas) return; canvas.toBlob(async blob => { const file = new File([blob], 'qr-code.png', { type: 'image/png' }); try { if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ title: `Support ${creator.name || creator.username}`, text: 'Buy me a soda! 🥤', files: [file] }); else { const a = document.createElement('a'); a.download = `${creator.username}-qr.png`; a.href = canvas.toDataURL(); a.click(); } API.trackEvent('qr_share', { username: creator.username }); } catch (_) {} }); });
  }).catch(() => { showMessage('Creator not found', 'error'); setTimeout(() => { window.location.href = 'index.html'; }, 1500); });
}

function initializeCreatorDashboard() {
  if (!UserSession.isLoggedIn()) return void (window.location.href = 'login.html');
  const elements = { name: document.getElementById('dashboardName'), username: document.getElementById('dashboardUsername'), profileViews: document.getElementById('profileViews'), sodas: document.getElementById('sodas'), transactions: document.getElementById('transactions'), paypalMe: document.getElementById('dashboardPaypalMe'), bio: document.getElementById('dashboardBio'), image: document.getElementById('dashboardImage'), activity: document.getElementById('activityList'), earnings: document.getElementById('earnings'), pending: document.getElementById('pendingAmount'), messages: document.getElementById('messagesCount'), transactionList: document.getElementById('transactionList') };
  API.getCreatorDashboard().then(data => {
    const c = data.creator, s = data.stats;
    if (elements.name) elements.name.textContent = c.name; if (elements.username) elements.username.textContent = `@${c.username}`; if (elements.profileViews) elements.profileViews.textContent = s.profileViews; if (elements.sodas) elements.sodas.textContent = s.sodas; if (elements.transactions) elements.transactions.textContent = s.confirmedTransactions; if (elements.earnings) elements.earnings.textContent = `$${Number(s.earnings).toFixed(2)}`; if (elements.pending) elements.pending.textContent = `$${Number(s.pendingAmount).toFixed(2)}`; if (elements.messages) elements.messages.textContent = s.unreadMessages; if (elements.paypalMe) elements.paypalMe.textContent = c.paypalMe; if (elements.bio) elements.bio.textContent = c.bio || 'No bio yet.'; if (elements.image && c.profilePicture) elements.image.src = c.profilePicture;
    if (elements.activity) elements.activity.innerHTML = data.activity.slice(0, 15).map(e => `<div class="activity-item"><strong>${escapeHtml(e.type.replaceAll('_', ' '))}</strong><span>${new Date(e.createdAt).toLocaleString()}</span></div>`).join('') || '<p>No activity yet.</p>';
    if (elements.transactionList) elements.transactionList.innerHTML = data.transactions.slice(0, 20).map(t => `<div class="activity-item"><strong>$${Number(t.amount).toFixed(2)} · ${t.sodaCount} soda${t.sodaCount === 1 ? '' : 's'}</strong><span>${escapeHtml(t.status)} · ${new Date(t.createdAt).toLocaleString()}</span></div>`).join('') || '<p>No support activity yet.</p>';
  }).catch(error => { if (error.message.includes('authentication')) { UserSession.logout(); window.location.href = 'login.html'; } else showMessage(error.message || 'Could not load dashboard', 'error'); });
  document.getElementById('dashboardLogout')?.addEventListener('click', async () => { await API.logout().catch(() => {}); UserSession.logout(); window.location.href = 'login.html'; });
}

document.addEventListener('DOMContentLoaded', () => {
  const page = window.location.pathname.split('/').pop() || 'index.html';
  if (!page.includes('.') && page) return initializeCreatorPage();
  switch (page) { case 'index.html': initializeMainPage(); break; case 'signup.html': initializeSignupPage(); break; case 'login.html': initializeLoginPage(); break; case 'qr.html': initializeQRPage(); break; case 'creator-dashboard.html': initializeCreatorDashboard(); break; }
});
