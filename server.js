const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const session = require('express-session');
const multer = require('multer');
const { PrismaClient } = require('@prisma/client');

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3003;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'CHANGE_THIS_ADMIN_PASSWORD';
const SESSION_SECRET = process.env.SESSION_SECRET || 'CHANGE_THIS_SESSION_SECRET';

const uploadDir = path.join(__dirname, 'uploads', 'profile-pictures');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    cb(null, allowed.includes(file.mimetype));
  }
});

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: false, maxAge: 8 * 60 * 60 * 1000 }
}));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(__dirname));

async function trackEvent(type, req, extra = {}) {
  try {
    await prisma.event.create({
      data: {
        type,
        path: req.path,
        username: extra.username || null,
        sodaCount: Number.isInteger(extra.sodaCount) ? extra.sodaCount : null
      }
    });
  } catch (error) {
    console.error('Analytics error:', error.message);
  }
}

function requireAdmin(req, res, next) {
  if (!req.session.isAdmin) return res.status(401).json({ error: 'Admin authentication required' });
  next();
}

app.get('/api/test', (_req, res) => res.json({ message: 'Server is working!' }));

app.post('/api/register', upload.single('profilePicture'), async (req, res) => {
  try {
    const { name, email, username, password, paypalMe, bio = '' } = req.body;
    if (!name || !email || !username || !password || !paypalMe) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedUsername = username.trim().toLowerCase();
    const exists = await prisma.user.findFirst({ where: { OR: [{ email: normalizedEmail }, { username: normalizedUsername }] } });
    if (exists) return res.status(409).json({ error: 'Email or username already exists' });

    const hashedPassword = await bcrypt.hash(password, 12);
    const profilePicture = req.file ? `/uploads/profile-pictures/${req.file.filename}` : '';
    const user = await prisma.user.create({
      data: { name: name.trim(), email: normalizedEmail, username: normalizedUsername, password: hashedPassword, paypalMe: paypalMe.trim(), bio: bio.trim(), profilePicture }
    });
    await trackEvent('signup', req, { username: user.username });
    res.status(201).json({ id: user.id, name: user.name, email: user.email, username: user.username, paypalMe: user.paypalMe, bio: user.bio, profilePicture: user.profilePicture });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email: String(email || '').trim().toLowerCase() } });
    if (!user || user.isSuspended) return res.status(401).json({ error: 'Invalid email or password' });
    const valid = await bcrypt.compare(password || '', user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });
    await trackEvent('login', req, { username: user.username });
    res.json({ id: user.id, name: user.name, email: user.email, username: user.username, paypalMe: user.paypalMe, bio: user.bio, profilePicture: user.profilePicture });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/creator/:username', async (req, res) => {
  try {
    const username = req.params.username.toLowerCase();
    const creator = await prisma.user.findUnique({ where: { username } });
    if (!creator || creator.isSuspended) return res.status(404).json({ error: 'Creator not found' });
    await trackEvent('creator_view', req, { username });
    res.json({ id: creator.id, name: creator.name, username: creator.username, paypalMe: creator.paypalMe, bio: creator.bio, profilePicture: creator.profilePicture });
  } catch (error) {
    console.error('Creator error:', error);
    res.status(500).json({ error: 'Server error' });
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

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/admin/stats', requireAdmin, async (_req, res) => {
  try {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const [totalUsers, newToday, pageViewsToday, creatorViewsToday, qrViewsToday, sodaClicksToday, totalEvents, latestUsers, recentEvents] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: start } } }),
      prisma.event.count({ where: { type: 'page_view', createdAt: { gte: start } } }),
      prisma.event.count({ where: { type: 'creator_view', createdAt: { gte: start } } }),
      prisma.event.count({ where: { type: 'qr_view', createdAt: { gte: start } } }),
      prisma.event.count({ where: { type: 'soda_click', createdAt: { gte: start } } }),
      prisma.event.count(),
      prisma.user.findMany({ orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, name: true, email: true, username: true, createdAt: true, isSuspended: true } }),
      prisma.event.findMany({ orderBy: { createdAt: 'desc' }, take: 20 })
    ]);
    res.json({ totalUsers, newToday, viewsToday: pageViewsToday + creatorViewsToday + qrViewsToday, pageViewsToday, creatorViewsToday, qrViewsToday, sodaClicksToday, totalEvents, latestUsers, recentEvents });
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/admin/users', requireAdmin, async (_req, res) => {
  const users = await prisma.user.findMany({ orderBy: { createdAt: 'desc' }, select: { id: true, name: true, email: true, username: true, paypalMe: true, bio: true, profilePicture: true, createdAt: true, isSuspended: true } });
  res.json(users);
});

app.get('/api/creator-dashboard/:username', async (req, res) => {
  try {
    const creator = await prisma.user.findUnique({ where: { username: req.params.username.toLowerCase() } });
    if (!creator || creator.isSuspended) return res.status(404).json({ error: 'Creator not found' });
    const events = await prisma.event.findMany({ where: { username: creator.username }, orderBy: { createdAt: 'desc' }, take: 100 });
    const sodaClicks = events.filter(e => e.type === 'soda_click');
    const sodas = sodaClicks.reduce((sum, e) => sum + (e.sodaCount || 0), 0);
    res.json({ creator: { id: creator.id, name: creator.name, username: creator.username, email: creator.email, paypalMe: creator.paypalMe, bio: creator.bio, profilePicture: creator.profilePicture }, stats: { profileViews: events.filter(e => e.type === 'creator_view').length, sodas, transactionsRecorded: sodaClicks.length }, activity: events });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Pretty creator URLs. Keep utility/static routes out of this handler.
app.get('/:username', async (req, res, next) => {
  const reserved = new Set(['api', 'uploads', 'admin.html', 'creator.html', 'login.html', 'signup.html', 'contact.html', 'how-it-works.html', 'privacy.html', 'terms.html', 'thank-you.html', 'qr.html']);
  if (reserved.has(req.params.username)) return next();
  res.sendFile(path.join(__dirname, 'creator.html'));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Unexpected server error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ BuyMeSoda server running on http://0.0.0.0:${PORT}`);
  console.log(`📸 Profile uploads: ${uploadDir}`);
});
