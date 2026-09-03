const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const session = require('express-session');
const multer = require('multer');
const nodemailer = require('nodemailer');
const { PrismaClient } = require('@prisma/client');

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3003;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'CHANGE_THIS_ADMIN_PASSWORD';
const SESSION_SECRET = process.env.SESSION_SECRET || 'CHANGE_THIS_SESSION_SECRET';
const PAYMENT_WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET || '';

const uploadDir = path.join(__dirname, 'uploads', 'profile-pictures');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype))
});

const mailTransport = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || 'false') === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined
    })
  : null;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60 * 1000 }
}));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(__dirname));

async function trackEvent(type, req, extra = {}) {
  try {
    await prisma.event.create({
      data: {
        type: String(type).slice(0, 100),
        path: String(req.path || '').slice(0, 500),
        username: extra.username ? String(extra.username).slice(0, 100) : null,
        sodaCount: Number.isInteger(extra.sodaCount) ? extra.sodaCount : null
      }
    });
  } catch (error) {
    console.error('Analytics error:', error.message);
  }
}

function sanitizeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    username: user.username,
    paypalMe: user.paypalMe,
    bio: user.bio,
    profilePicture: user.profilePicture
  };
}

function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Admin authentication required' });
  next();
}

async function requireCreator(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Creator authentication required' });
  try {
    const user = await prisma.user.findUnique({ where: { id: req.session.userId } });
    if (!user || user.isSuspended) return res.status(401).json({ error: 'Creator authentication required' });
    req.creator = user;
    next();
  } catch (error) {
    next(error);
  }
}

function generateCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function hashCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

function genericResetResponse(res) {
  return res.json({ ok: true, message: 'If that email exists, a reset code has been sent.' });
}

app.get('/api/test', (_req, res) => res.json({ message: 'Server is working!' }));
app.get('/api/me', requireCreator, (req, res) => res.json(sanitizeUser(req.creator)));

app.post('/api/register', upload.single('profilePicture'), async (req, res) => {
  try {
    const { name, email, username, password, paypalMe, bio = '' } = req.body;
    if (!name || !email || !username || !password || !paypalMe) return res.status(400).json({ error: 'Missing required fields' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,30}$/.test(normalizedUsername)) return res.status(400).json({ error: 'Username may use letters, numbers and underscores only' });
    const exists = await prisma.user.findFirst({ where: { OR: [{ email: normalizedEmail }, { username: normalizedUsername }] } });
    if (exists) return res.status(409).json({ error: 'Email or username already exists' });

    const hashedPassword = await bcrypt.hash(password, 12);
    const profilePicture = req.file ? `/uploads/profile-pictures/${req.file.filename}` : '';
    const user = await prisma.user.create({
      data: { name: name.trim(), email: normalizedEmail, username: normalizedUsername, password: hashedPassword, paypalMe: paypalMe.trim(), bio: bio.trim(), profilePicture }
    });
    await trackEvent('signup', req, { username: user.username });
    res.status(201).json(sanitizeUser(user));
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.isSuspended) return res.status(401).json({ error: 'Invalid email or password' });
    if (!await bcrypt.compare(password, user.password)) return res.status(401).json({ error: 'Invalid email or password' });
    req.session.userId = user.id;
    await trackEvent('login', req, { username: user.username });
    res.json(sanitizeUser(user));
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

app.post('/api/password-reset/request', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email) return genericResetResponse(res);
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return genericResetResponse(res);

    await prisma.passwordResetCode.deleteMany({ where: { userId: user.id, usedAt: null } });
    const code = generateCode();
    await prisma.passwordResetCode.create({ data: { userId: user.id, codeHash: hashCode(code), expiresAt: new Date(Date.now() + 10 * 60 * 1000) } });

    if (mailTransport && process.env.SMTP_FROM) {
      await mailTransport.sendMail({
        from: process.env.SMTP_FROM,
        to: user.email,
        subject: 'Your BuyMeSoda password reset code',
        text: `Your BuyMeSoda password reset code is ${code}. It expires in 10 minutes.`
      });
    } else {
      console.warn(`Password reset email is not configured. Code generated for ${user.email}.`);
      if (process.env.NODE_ENV !== 'production') console.log(`DEV RESET CODE for ${user.email}: ${code}`);
    }
    await trackEvent('password_reset_requested', req, { username: user.username });
    genericResetResponse(res);
  } catch (error) {
    console.error('Password reset request error:', error);
    genericResetResponse(res);
  }
});

app.post('/api/password-reset/verify', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const code = String(req.body.code || '').trim();
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(400).json({ error: 'Invalid or expired code' });
    const reset = await prisma.passwordResetCode.findFirst({ where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
    if (!reset || reset.attempts >= 5 || hashCode(code) !== reset.codeHash) {
      if (reset) await prisma.passwordResetCode.update({ where: { id: reset.id }, data: { attempts: { increment: 1 } } });
      return res.status(400).json({ error: 'Invalid or expired code' });
    }
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/password-reset/complete', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const code = String(req.body.code || '').trim();
    const newPassword = String(req.body.newPassword || '');
    if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(400).json({ error: 'Invalid or expired code' });
    const reset = await prisma.passwordResetCode.findFirst({ where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
    if (!reset || reset.attempts >= 5 || hashCode(code) !== reset.codeHash) return res.status(400).json({ error: 'Invalid or expired code' });
    const password = await bcrypt.hash(newPassword, 12);
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { password } }),
      prisma.passwordResetCode.update({ where: { id: reset.id }, data: { usedAt: new Date() } })
    ]);
    await trackEvent('password_reset_completed', req, { username: user.username });
    res.json({ ok: true });
  } catch (error) {
    console.error('Password reset completion error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/creator/:username', async (req, res) => {
  try {
    const username = req.params.username.toLowerCase();
    const creator = await prisma.user.findUnique({ where: { username } });
    if (!creator || creator.isSuspended) return res.status(404).json({ error: 'Creator not found' });
    await trackEvent('creator_view', req, { username });
    res.json(sanitizeUser(creator));
  } catch (error) {
    console.error('Creator error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/support', async (req, res) => {
  try {
    const { username, sodaCount, supporterName = '', supporterEmail = '', message = '' } = req.body;
    const count = Number(sodaCount);
    if (!username || !Number.isInteger(count) || ![1, 3, 5].includes(count)) return res.status(400).json({ error: 'Invalid support request' });
    const creator = await prisma.user.findUnique({ where: { username: String(username).trim().toLowerCase() } });
    if (!creator || creator.isSuspended) return res.status(404).json({ error: 'Creator not found' });

    const amount = count;
    const reference = `SODA-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const transaction = await prisma.transaction.create({
      data: {
        creatorId: creator.id,
        amount,
        currency: 'USD',
        sodaCount: count,
        supporterName: String(supporterName).trim().slice(0, 100) || null,
        supporterEmail: String(supporterEmail).trim().toLowerCase().slice(0, 160) || null,
        message: String(message).trim().slice(0, 500) || null,
        provider: 'paypal.me',
        status: 'pending',
        reference
      }
    });

    if (String(message).trim()) {
      await prisma.supporterMessage.create({
        data: {
          creatorId: creator.id,
          supporterName: String(supporterName).trim().slice(0, 100) || null,
          supporterEmail: String(supporterEmail).trim().toLowerCase().slice(0, 160) || null,
          message: String(message).trim().slice(0, 500),
          transactionId: transaction.id
        }
      });
    }

    await trackEvent('soda_click', req, { username: creator.username, sodaCount: count });
    const paypalBase = creator.paypalMe.replace(/\/$/, '');
    res.status(201).json({ ok: true, reference, amount, status: transaction.status, paymentUrl: `${paypalBase}/${count}`, note: 'Payment is pending confirmation from the payment provider.' });
  } catch (error) {
    console.error('Support error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/creator-dashboard', requireCreator, async (req, res) => {
  try {
    const creator = req.creator;
    const [transactions, messages, events, withdrawals] = await Promise.all([
      prisma.transaction.findMany({ where: { creatorId: creator.id }, orderBy: { createdAt: 'desc' }, take: 100 }),
      prisma.supporterMessage.findMany({ where: { creatorId: creator.id }, orderBy: { createdAt: 'desc' }, take: 50 }),
      prisma.event.findMany({ where: { username: creator.username }, orderBy: { createdAt: 'desc' }, take: 100 }),
      prisma.withdrawal.findMany({ where: { creatorId: creator.id }, orderBy: { createdAt: 'desc' }, take: 50 })
    ]);
    const confirmed = transactions.filter(t => t.status === 'completed');
    const pending = transactions.filter(t => t.status === 'pending');
    const earnings = confirmed.reduce((sum, t) => sum + t.netAmount, 0);
    const pendingAmount = pending.reduce((sum, t) => sum + t.amount, 0);
    const sodas = confirmed.reduce((sum, t) => sum + t.sodaCount, 0);
    const requestedOrPaid = withdrawals.filter(w => ['requested', 'processing', 'paid'].includes(w.status)).reduce((sum, w) => sum + w.amount, 0);
    const availableBalance = Math.max(0, earnings - requestedOrPaid);
    res.json({
      creator: sanitizeUser(creator),
      stats: { profileViews: events.filter(e => e.type === 'creator_view').length, sodas, earnings, pendingAmount, confirmedTransactions: confirmed.length, pendingTransactions: pending.length, unreadMessages: messages.filter(m => !m.isRead).length, availableBalance },
      transactions,
      messages,
      withdrawals,
      activity: events
    });
  } catch (error) {
    console.error('Creator dashboard error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/creator/messages/:id/read', requireCreator, async (req, res) => {
  const message = await prisma.supporterMessage.findFirst({ where: { id: req.params.id, creatorId: req.creator.id } });
  if (!message) return res.status(404).json({ error: 'Message not found' });
  await prisma.supporterMessage.update({ where: { id: message.id }, data: { isRead: true } });
  res.json({ ok: true });
});

app.post('/api/creator/withdrawals', requireCreator, async (req, res) => {
  try {
    const amount = Number(req.body.amount);
    const method = String(req.body.method || '').trim().toLowerCase();
    const destination = String(req.body.destination || '').trim();
    if (!Number.isFinite(amount) || amount <= 0 || !['mpesa', 'paypal'].includes(method) || !destination) return res.status(400).json({ error: 'Invalid withdrawal request' });

    const [transactions, withdrawals] = await Promise.all([
      prisma.transaction.findMany({ where: { creatorId: req.creator.id, status: 'completed' } }),
      prisma.withdrawal.findMany({ where: { creatorId: req.creator.id, status: { in: ['requested', 'processing', 'paid'] } } })
    ]);
    const earnings = transactions.reduce((sum, t) => sum + t.netAmount, 0);
    const alreadyReserved = withdrawals.reduce((sum, w) => sum + w.amount, 0);
    const available = earnings - alreadyReserved;
    if (amount > available) return res.status(400).json({ error: 'Insufficient available balance' });

    const withdrawal = await prisma.withdrawal.create({ data: { creatorId: req.creator.id, amount, currency: 'USD', method, destination: destination.slice(0, 160), status: 'requested' } });
    await trackEvent('withdrawal_requested', req, { username: req.creator.username });
    res.status(201).json({ ok: true, withdrawal, availableBalance: available - amount });
  } catch (error) {
    console.error('Withdrawal error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/payments/webhook', async (req, res) => {
  try {
    if (!PAYMENT_WEBHOOK_SECRET) return res.status(503).json({ error: 'Payment webhook is not configured' });
    const provided = String(req.get('x-payment-webhook-secret') || '');
    if (!crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(PAYMENT_WEBHOOK_SECRET))) return res.status(401).json({ error: 'Invalid webhook secret' });

    const { reference, provider, providerReference, status, feeAmount = 0, netAmount } = req.body;
    if (!reference || !provider || !['completed', 'cancelled'].includes(status)) return res.status(400).json({ error: 'Invalid webhook payload' });
    const existing = await prisma.transaction.findUnique({ where: { reference } });
    if (!existing) return res.status(404).json({ error: 'Transaction not found' });

    const fee = Number(feeAmount) || 0;
    const net = Number.isFinite(Number(netAmount)) ? Number(netAmount) : Math.max(0, existing.amount - fee);
    const updated = await prisma.transaction.update({
      where: { id: existing.id },
      data: { provider, providerReference: providerReference ? String(providerReference).slice(0, 200) : existing.providerReference, status, feeAmount: fee, netAmount: status === 'completed' ? net : 0, completedAt: status === 'completed' ? (existing.completedAt || new Date()) : null }
    });
    await trackEvent(status === 'completed' ? 'payment_completed' : 'payment_cancelled', req, {});
    res.json({ ok: true, transactionId: updated.id });
  } catch (error) {
    console.error('Payment webhook error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/contact', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim().slice(0, 100);
    const email = String(req.body.email || '').trim().toLowerCase().slice(0, 160);
    const subject = String(req.body.subject || '').trim().slice(0, 160);
    const message = String(req.body.message || '').trim().slice(0, 3000);
    if (!name || !email || !subject || !message) return res.status(400).json({ error: 'Please complete all contact fields' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email' });
    await trackEvent('contact_submitted', req);

    if (!mailTransport || !process.env.SMTP_FROM || !process.env.CONTACT_EMAIL) {
      return res.status(503).json({ error: 'Contact email service is not configured yet' });
    }
    await mailTransport.sendMail({
      from: process.env.SMTP_FROM,
      to: process.env.CONTACT_EMAIL,
      replyTo: email,
      subject: `[BuyMeSoda Contact] ${subject}`,
      text: `Name: ${name}\nEmail: ${email}\n\n${message}`
    });
    res.json({ ok: true });
  } catch (error) {
    console.error('Contact error:', error);
    res.status(500).json({ error: 'Could not send message' });
  }
});

app.post('/api/analytics/event', async (req, res) => {
  try {
    const { type, path: eventPath, username, sodaCount } = req.body;
    if (!type) return res.status(400).json({ error: 'Event type is required' });
    await prisma.event.create({ data: { type: String(type).slice(0, 100), path: String(eventPath || req.path).slice(0, 500), username: username ? String(username).slice(0, 100) : null, sodaCount: Number.isInteger(sodaCount) ? sodaCount : null } });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/admin/login', (req, res) => {
  if (req.body.password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Invalid admin password' });
  req.session.isAdmin = true;
  res.json({ ok: true });
});
app.post('/api/admin/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

app.get('/api/admin/stats', requireAdmin, async (_req, res) => {
  try {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const [totalUsers, newToday, pageViewsToday, creatorViewsToday, qrViewsToday, sodaClicksToday, totalEvents, latestUsers, recentEvents, transactions, withdrawals] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: start } } }),
      prisma.event.count({ where: { type: 'page_view', createdAt: { gte: start } } }),
      prisma.event.count({ where: { type: 'creator_view', createdAt: { gte: start } } }),
      prisma.event.count({ where: { type: 'qr_view', createdAt: { gte: start } } }),
      prisma.event.count({ where: { type: 'soda_click', createdAt: { gte: start } } }),
      prisma.event.count(),
      prisma.user.findMany({ orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, name: true, email: true, username: true, createdAt: true, isSuspended: true } }),
      prisma.event.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
      prisma.transaction.findMany({ orderBy: { createdAt: 'desc' }, take: 100, include: { creator: { select: { username: true, name: true } } } }),
      prisma.withdrawal.findMany({ orderBy: { createdAt: 'desc' }, take: 50, include: { creator: { select: { username: true, name: true } } } })
    ]);
    const completedAmount = transactions.filter(t => t.status === 'completed').reduce((sum, t) => sum + t.netAmount, 0);
    const pendingAmount = transactions.filter(t => t.status === 'pending').reduce((sum, t) => sum + t.amount, 0);
    res.json({ totalUsers, newToday, viewsToday: pageViewsToday + creatorViewsToday + qrViewsToday, pageViewsToday, creatorViewsToday, qrViewsToday, sodaClicksToday, totalEvents, completedAmount, pendingAmount, latestUsers, recentEvents, transactions, withdrawals });
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/admin/transactions/:id/complete', requireAdmin, async (req, res) => {
  try {
    const transaction = await prisma.transaction.update({ where: { id: req.params.id }, data: { status: 'completed', feeAmount: 0, netAmount: { set: undefined }, completedAt: new Date() } });
    res.json({ ok: true, transaction });
  } catch (error) {
    res.status(404).json({ error: 'Transaction not found' });
  }
});

app.post('/api/admin/transactions/:id/cancel', requireAdmin, async (req, res) => {
  try {
    const transaction = await prisma.transaction.update({ where: { id: req.params.id }, data: { status: 'cancelled' } });
    res.json({ ok: true, transaction });
  } catch (error) {
    res.status(404).json({ error: 'Transaction not found' });
  }
});

app.post('/api/admin/withdrawals/:id/processing', requireAdmin, async (req, res) => {
  try {
    const withdrawal = await prisma.withdrawal.update({ where: { id: req.params.id }, data: { status: 'processing' } });
    res.json({ ok: true, withdrawal });
  } catch (error) {
    res.status(404).json({ error: 'Withdrawal not found' });
  }
});

app.post('/api/admin/withdrawals/:id/paid', requireAdmin, async (req, res) => {
  try {
    const withdrawal = await prisma.withdrawal.update({ where: { id: req.params.id }, data: { status: 'paid', providerReference: req.body.providerReference ? String(req.body.providerReference).slice(0, 200) : undefined, processedAt: new Date() } });
    res.json({ ok: true, withdrawal });
  } catch (error) {
    res.status(404).json({ error: 'Withdrawal not found' });
  }
});

app.post('/api/admin/withdrawals/:id/reject', requireAdmin, async (req, res) => {
  try {
    const withdrawal = await prisma.withdrawal.update({ where: { id: req.params.id }, data: { status: 'rejected', note: String(req.body.note || '').slice(0, 500), processedAt: new Date() } });
    res.json({ ok: true, withdrawal });
  } catch (error) {
    res.status(404).json({ error: 'Withdrawal not found' });
  }
});

app.get('/api/admin/users', requireAdmin, async (_req, res) => {
  const users = await prisma.user.findMany({ orderBy: { createdAt: 'desc' }, select: { id: true, name: true, email: true, username: true, paypalMe: true, bio: true, profilePicture: true, createdAt: true, isSuspended: true } });
  res.json(users);
});

app.post('/api/admin/users/:id/suspend', requireAdmin, async (req, res) => {
  try {
    const user = await prisma.user.update({ where: { id: req.params.id }, data: { isSuspended: true } });
    res.json({ ok: true, user: { id: user.id, username: user.username, isSuspended: user.isSuspended } });
  } catch (error) {
    res.status(404).json({ error: 'User not found' });
  }
});

app.post('/api/admin/users/:id/unsuspend', requireAdmin, async (req, res) => {
  try {
    const user = await prisma.user.update({ where: { id: req.params.id }, data: { isSuspended: false } });
    res.json({ ok: true, user: { id: user.id, username: user.username, isSuspended: user.isSuspended } });
  } catch (error) {
    res.status(404).json({ error: 'User not found' });
  }
});

app.get('/:username', async (req, res, next) => {
  const reserved = new Set(['api', 'uploads', 'admin.html', 'creator.html', 'creator-dashboard.html', 'login.html', 'signup.html', 'forgot-password.html', 'reset-password.html', 'contact.html', 'how-it-works.html', 'privacy.html', 'terms.html', 'thank-you.html', 'qr.html']);
  if (reserved.has(req.params.username)) return next();
  res.sendFile(path.join(__dirname, 'creator.html'));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Unexpected server error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ BuyMeSoda server running on http://0.0.0.0:${PORT}`);
});
