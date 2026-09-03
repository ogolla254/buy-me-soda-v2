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
    const response = await fetch(`${API.getBaseUrl()}${path}`, options);
    let data = {};
    try { data = await response.json(); } catch (_) {}
    if (!response.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  static register(formData) {
    return API.request('/api/register', { method: 'POST', body: formData });
  }

  static login(credentials) {
    return API.request('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credentials)
    });
  }

  static getCreator(username) { return API.request(`/api/creator/${encodeURIComponent(username)}`); }
  static getCreatorDashboard(username) { return API.request(`/api/creator-dashboard/${encodeURIComponent(username)}`); }
  static trackEvent(type, extra = {}) {
    return API.request('/api/analytics/event', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, path: window.location.pathname, ...extra })
    }).catch(() => null);
  }
}

function validateEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim()); }
function validatePaypalMe(url) { return /^https:\/\/paypal\.me\/[A-Za-z0-9._-]+\/?$/.test(String(url || '').trim()); }

function showMessage(message, type = 'info') {
  const div = document.createElement('div');
  div.textContent = message;
  div.style.cssText = `position:fixed;top:20px;right:20px;padding:12px 20px;border-radius:8px;color:white;font-weight:600;z-index:9999;max-width:340px;background:${type === 'error' ? '#ef4444' : type === 'success' ? '#10b981' : '#3b82f6'};box-shadow:0 8px 24px rgba(0,0,0,.18)`;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3500);
}

function initializeMainPage() {
  const loggedOutView = document.getElementById('loggedOutView');
  const loggedInView = document.getElementById('loggedInView');
  const logoutBtn = document.getElementById('logoutBtn');
  const user = UserSession.getCurrentUser();
  if (loggedOutView && loggedInView) {
    loggedOutView.style.display = user ? 'none' : 'flex';
    loggedInView.style.display = user ? 'flex' : 'none';
  }
  if (user) {
    const username = document.getElementById('username');
    const paypalMe = document.getElementById('paypalMe');
    if (username) username.textContent = user.username;
    if (paypalMe) paypalMe.textContent = user.paypalMe;
  }
  if (logoutBtn) logoutBtn.addEventListener('click', () => { UserSession.logout(); location.reload(); });
  API.trackEvent('page_view');
}

function initializeSignupPage() {
  const form = document.getElementById('signupForm');
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const name = String(data.get('name') || '').trim();
    const email = String(data.get('email') || '').trim();
    const username = String(data.get('username') || '').trim();
    const password = String(data.get('password') || '');
    const paypalMe = String(data.get('paypalMe') || '').trim();
    if (name.length < 2) return showMessage('Please enter your name', 'error');
    if (!validateEmail(email)) return showMessage('Please enter a valid email', 'error');
    if (username.length < 3) return showMessage('Username must be at least 3 characters', 'error');
    if (password.length < 6) return showMessage('Password must be at least 6 characters', 'error');
    if (!validatePaypalMe(paypalMe)) return showMessage('Please enter a valid PayPal.Me link', 'error');
    try {
      await API.register(data);
      API.trackEvent('signup', { username });
      showMessage('Account created successfully!', 'success');
      setTimeout(() => { window.location.href = 'login.html'; }, 1200);
    } catch (error) { showMessage(error.message || 'Error creating account', 'error'); }
  });
}

function initializeLoginPage() {
  const form = document.getElementById('loginForm');
  if (!form) return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const email = String(data.get('email') || '').trim();
    const password = String(data.get('password') || '');
    if (!validateEmail(email)) return showMessage('Please enter a valid email', 'error');
    if (!password) return showMessage('Please enter your password', 'error');
    try {
      const user = await API.login({ email, password });
      UserSession.setUser(user);
      API.trackEvent('login', { username: user.username });
      showMessage(`Welcome back, ${user.name || user.username}!`, 'success');
      setTimeout(() => { window.location.href = `/${user.username}`; }, 900);
    } catch (error) { showMessage(error.message || 'Invalid email or password', 'error'); }
  });
}

function initializeQRPage() {
  if (!UserSession.isLoggedIn()) return void (window.location.href = 'login.html');
  const user = UserSession.getCurrentUser();
  const paypalMe = document.getElementById('paypalMe');
  const downloadBtn = document.getElementById('downloadBtn');
  if (paypalMe) paypalMe.textContent = user.paypalMe;
  API.trackEvent('qr_view', { username: user.username });
  setTimeout(() => {
    const container = document.getElementById('qrcode');
    if (container && typeof QRCode !== 'undefined') {
      container.innerHTML = '';
      new QRCode(container, { text: `${window.location.origin}/${user.username}`, width: 256, height: 256, correctLevel: QRCode.CorrectLevel.H });
    }
  }, 100);
  if (downloadBtn) downloadBtn.addEventListener('click', () => {
    const canvas = document.querySelector('#qrcode canvas');
    if (!canvas) return;
    const link = document.createElement('a'); link.download = `${user.username}-soda-qr.png`; link.href = canvas.toDataURL(); link.click();
    API.trackEvent('qr_download', { username: user.username });
  });
}

function initializeCreatorPage() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const username = parts[parts.length - 1];
  if (!username || username.includes('.')) return;
  API.getCreator(username).then(creator => {
    document.title = `${creator.name || creator.username} - Buy Me a Soda 🥤`;
    const name = document.getElementById('creatorName');
    const bio = document.getElementById('creatorBio');
    const image = document.getElementById('profileImage');
    if (name) name.textContent = creator.name || creator.username;
    if (bio) bio.textContent = creator.bio || 'Support me by buying me a soda! 🥤';
    if (image && creator.profilePicture) image.src = creator.profilePicture;
    API.trackEvent('creator_view', { username: creator.username });
    setTimeout(() => {
      const qr = document.getElementById('qrcode');
      if (qr && typeof QRCode !== 'undefined') { qr.innerHTML = ''; new QRCode(qr, { text: `${window.location.origin}/${creator.username}`, width: 200, height: 200 }); }
    }, 100);
    document.querySelectorAll('.soda-btn').forEach(button => button.addEventListener('click', () => {
      const sodas = Number(button.dataset.sodas || 1);
      API.trackEvent('soda_click', { username: creator.username, sodaCount: sodas });
      const paypalUrl = `${creator.paypalMe}/${sodas}`;
      window.open(paypalUrl, '_blank', 'noopener');
    }));
    const copyBtn = document.getElementById('copyLinkBtn');
    if (copyBtn) copyBtn.addEventListener('click', async () => {
      const url = `${window.location.origin}/${creator.username}`;
      try { await navigator.clipboard.writeText(url); showMessage('Link copied to clipboard!', 'success'); } catch (_) { showMessage(url); }
    });
    const shareQRBtn = document.getElementById('shareQRBtn');
    if (shareQRBtn) shareQRBtn.addEventListener('click', () => {
      const canvas = document.querySelector('#qrcode canvas');
      if (!canvas) return;
      canvas.toBlob(async blob => {
        const file = new File([blob], 'qr-code.png', { type: 'image/png' });
        try {
          if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ title: `Support ${creator.name || creator.username}`, text: 'Buy me a soda! 🥤', files: [file] });
          else { const a = document.createElement('a'); a.download = `${creator.username}-qr.png`; a.href = canvas.toDataURL(); a.click(); }
          API.trackEvent('qr_share', { username: creator.username });
        } catch (_) {}
      });
    });
  }).catch(() => { showMessage('Creator not found', 'error'); setTimeout(() => { window.location.href = 'index.html'; }, 1500); });
}

function initializeCreatorDashboard() {
  const username = UserSession.getCurrentUser()?.username;
  if (!username) return void (window.location.href = 'login.html');
  const elements = {
    name: document.getElementById('dashboardName'),
    username: document.getElementById('dashboardUsername'),
    profileViews: document.getElementById('profileViews'),
    sodas: document.getElementById('sodas'),
    transactions: document.getElementById('transactions'),
    paypalMe: document.getElementById('dashboardPaypalMe'),
    bio: document.getElementById('dashboardBio'),
    image: document.getElementById('dashboardImage'),
    activity: document.getElementById('activityList')
  };
  API.getCreatorDashboard(username).then(data => {
    const c = data.creator, s = data.stats;
    if (elements.name) elements.name.textContent = c.name;
    if (elements.username) elements.username.textContent = `@${c.username}`;
    if (elements.profileViews) elements.profileViews.textContent = s.profileViews;
    if (elements.sodas) elements.sodas.textContent = s.sodas;
    if (elements.transactions) elements.transactions.textContent = s.transactionsRecorded;
    if (elements.paypalMe) elements.paypalMe.textContent = c.paypalMe;
    if (elements.bio) elements.bio.textContent = c.bio || 'No bio yet.';
    if (elements.image && c.profilePicture) elements.image.src = c.profilePicture;
    if (elements.activity) elements.activity.innerHTML = data.activity.slice(0, 20).map(event => `<div class="activity-item"><strong>${event.type.replaceAll('_', ' ')}</strong><span>${new Date(event.createdAt).toLocaleString()}</span></div>`).join('') || '<p>No activity yet.</p>';
  }).catch(error => showMessage(error.message || 'Could not load dashboard', 'error'));
  const logout = document.getElementById('dashboardLogout');
  if (logout) logout.addEventListener('click', () => { UserSession.logout(); window.location.href = 'login.html'; });
}

document.addEventListener('DOMContentLoaded', () => {
  const page = window.location.pathname.split('/').pop() || 'index.html';
  if (!page.includes('.') && page) return initializeCreatorPage();
  switch (page) {
    case 'index.html': initializeMainPage(); break;
    case 'signup.html': initializeSignupPage(); break;
    case 'login.html': initializeLoginPage(); break;
    case 'qr.html': initializeQRPage(); break;
    case 'creator-dashboard.html': initializeCreatorDashboard(); break;
  }
});
