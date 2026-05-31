/**
 * NextSynergy Tech — server.js  (v2 — with Admin Dashboard)
 *
 * Install:  npm install express mongoose bcryptjs jsonwebtoken cors
 *                       multer express-validator nodemailer dotenv morgan
 * Run:      node server.js   (or: npx nodemon server.js)
 *
 * Admin dashboard: http://localhost:5000/admin
 * API base:        http://localhost:5000/api
 */

'use strict';
require('dotenv').config();

const express    = require('express');
const mongoose   = require('mongoose');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const cors       = require('cors');
const multer     = require('multer');
const nodemailer = require('nodemailer');
const morgan     = require('morgan');
const path       = require('path');
const fs         = require('fs');
const { body, validationResult } = require('express-validator');

const app  = express();
const PORT = process.env.PORT || 5000;

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.CLIENT_URL || '*', credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ─── MONGODB CONNECTION (Atlas + safe retry) ─────────────────────────────────
// IMPORTANT:
// - Do NOT hardcode your MongoDB username/password in this file.
// - Put your real connection string in a .env file as MONGO_URI.
// - If your password has special characters, URL-encode them. Example: @ becomes %40.
// - In MongoDB Atlas, add your current IP under Network Access.

const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB_NAME = process.env.MONGO_DB_NAME || 'Seeds';

if (!MONGO_URI) {
  console.error('❌ MONGO_URI is missing. Add it to your .env file.');
  console.error('Example: MONGO_URI=mongodb+srv://eshetu:Mygrace%40%4007!@cluster0.xxxxx.mongodb.net/Seeds?retryWrites=true&w=majority');
  process.exit(1);
}

let dbConnected = false;
let isConnecting = false;
let retryTimer = null;

function scheduleReconnect(delayMs = 10000) {
  if (retryTimer) return;

  console.log(`🔄 Retrying MongoDB connection in ${delayMs / 1000} seconds...`);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    connectDB();
  }, delayMs);
}

async function connectDB() {
  if (isConnecting) return;

  // readyState: 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
  if (mongoose.connection.readyState === 1) {
    dbConnected = true;
    return;
  }

  try {
    isConnecting = true;

    await mongoose.connect(MONGO_URI, {
      dbName: MONGO_DB_NAME,
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      maxPoolSize: 10,
      heartbeatFrequencyMS: 10000,
    });

    dbConnected = true;
    console.log(`✅ MongoDB Atlas connected → db: ${mongoose.connection.name}`);
  } catch (err) {
    dbConnected = false;
    console.error('❌ MongoDB connection failed:', err.message);

    if (err.message && err.message.toLowerCase().includes('whitelist')) {
      console.error('👉 Fix: Atlas → Network Access → Add Current IP Address, or use 0.0.0.0/0 for Render/deployment.');
    }

    scheduleReconnect(10000);
  } finally {
    isConnecting = false;
  }
}

connectDB();

mongoose.connection.on('connected', () => {
  dbConnected = true;
  console.log('✅ MongoDB connected');
});

mongoose.connection.on('disconnected', () => {
  dbConnected = false;
  console.warn('⚠️ MongoDB disconnected');
  scheduleReconnect(10000);
});

mongoose.connection.on('reconnected', () => {
  dbConnected = true;
  console.log('✅ MongoDB reconnected');
});

mongoose.connection.on('error', (err) => {
  dbConnected = false;
  console.error('❌ MongoDB error:', err.message);
});

process.on('SIGINT', async () => {
  try {
    await mongoose.connection.close();
    console.log('MongoDB connection closed because app terminated');
  } finally {
    process.exit(0);
  }
});

// Middleware to check DB is live before hitting data routes
function requireDB(req, res, next) {
  if (!dbConnected) return res.status(503).json({ error: 'Database not connected. Please try again shortly.' });
  next();
}

// ─── SCHEMAS ─────────────────────────────────────────────────────────────────
const userSchema = new mongoose.Schema({
  firstName:       { type: String, required: true, trim: true },
  lastName:        { type: String, required: true, trim: true },
  email:           { type: String, required: true, unique: true, lowercase: true, trim: true },
  password:        { type: String, required: true, minlength: 6 },
  role:            { type: String, enum: ['student','admin'], default: 'student' },
  goal:            { type: String, default: '' },
  avatar:          { type: String, default: '' },
  enrolledCourses: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Course' }],
  isActive:        { type: Boolean, default: true },
  lastLogin:       { type: Date },
  streak:          { type: Number, default: 0 },
  hoursWatched:    { type: Number, default: 0 },
}, { timestamps: true });
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});
userSchema.methods.comparePassword = function(c) { return bcrypt.compare(c, this.password); };
const User = mongoose.model('User', userSchema);

const lessonSchema = new mongoose.Schema({
  title: String, videoUrl: String, duration: String, isFree: Boolean, order: Number,
});
const courseSchema = new mongoose.Schema({
  title:       { type: String, required: true },
  description: { type: String, required: true },
  category:    { type: String, required: true },
  thumbnail:   { type: String, default: '📚' },
  price:       { type: Number, default: 0 },
  isFree:      { type: Boolean, default: false },
  level:       { type: String, default: 'beginner' },
  lessons:     [lessonSchema],
  instructor:  { type: String, default: 'NextSynergy Team' },
  tags:        [String],
  enrolled:    { type: Number, default: 0 },
  rating:      { type: Number, default: 0 },
  published:   { type: Boolean, default: true },
}, { timestamps: true });
const Course = mongoose.model('Course', courseSchema);

const orderSchema = new mongoose.Schema({
  user:        { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  firstName:   { type: String, required: true },
  lastName:    { type: String, required: true },
  email:       { type: String, required: true },
  phone:       { type: String, default: '' },
  packageName: { type: String, required: true },
  budget:      { type: String, default: '' },
  description: { type: String, required: true },
  status:      { type: String, enum: ['pending','in-progress','delivered','cancelled'], default: 'pending' },
  adminNotes:  { type: String, default: '' },
}, { timestamps: true });
const Order = mongoose.model('Order', orderSchema);

const tutorialSchema = new mongoose.Schema({
  title:     { type: String, required: true },
  videoId:   { type: String, required: true },
  thumbnail: { type: String, default: '🎬' },
  duration:  { type: String, default: '' },
  topic:     { type: String, default: '' },
  isFree:    { type: Boolean, default: true },
  lessons:   [{ label: String, vid: String }],
  views:     { type: Number, default: 0 },
  published: { type: Boolean, default: true },
}, { timestamps: true });
const Tutorial = mongoose.model('Tutorial', tutorialSchema);

const progressSchema = new mongoose.Schema({
  user:             { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  course:           { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
  completedLessons: [{ type: mongoose.Schema.Types.ObjectId }],
  percentComplete:  { type: Number, default: 0 },
  lastLesson:       { type: mongoose.Schema.Types.ObjectId },
}, { timestamps: true });
const Progress = mongoose.model('Progress', progressSchema);

// ─── FILE UPLOAD ──────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'uploads', req.uploadFolder || 'misc');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`),
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// ─── EMAIL ────────────────────────────────────────────────────────────────────
const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});
async function sendEmail(to, subject, html) {
  if (!process.env.SMTP_USER) return;
  try { await mailer.sendMail({ from: `"NextSynergy Tech" <${process.env.SMTP_USER}>`, to, subject, html }); }
  catch(e) { console.warn('Email send skipped:', e.message); }
}

// ─── AUTH HELPERS ─────────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || 'NST_dev_secret_change_in_prod';
function genToken(user) {
  return jwt.sign({ id: user._id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
}
function authRequired(req, res, next) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return res.status(401).json({ error: 'Token required' });
  try { req.user = jwt.verify(h.split(' ')[1], JWT_SECRET); next(); }
  catch { return res.status(401).json({ error: 'Invalid or expired token' }); }
}
function adminRequired(req, res, next) {
  authRequired(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    next();
  });
}
// Admin dashboard session cookie (simple — for the HTML dashboard)
function adminCookieAuth(req, res, next) {
  const token = req.cookies?.nst_admin || req.headers['x-admin-token'];
  if (!token) return res.redirect('/admin/login');
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') return res.redirect('/admin/login');
    req.admin = decoded;
    next();
  } catch { return res.redirect('/admin/login'); }
}
function validate(req, res) {
  const e = validationResult(req);
  if (!e.isEmpty()) { res.status(422).json({ errors: e.array() }); return false; }
  return true;
}

// Cookie parser (inline, no extra dep)
app.use((req, _res, next) => {
  req.cookies = {};
  const raw = req.headers.cookie || '';
  raw.split(';').forEach(c => {
    const [k, ...v] = c.trim().split('=');
    if (k) req.cookies[k.trim()] = decodeURIComponent(v.join('='));
  });
  next();
});

// ═════════════════════════════════════════════════════════════════════════════
//  ADMIN DASHBOARD HTML ROUTES
// ═════════════════════════════════════════════════════════════════════════════

// ─── Admin Login Page ─────────────────────────────────────────────────────────
app.get('/admin/login', (req, res) => {
  res.send(`<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NST Admin Login</title>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@600;800&family=DM+Sans:wght@400;500&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{background:#05080f;color:#f0f4ff;font-family:'DM Sans',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;}
.card{background:#141928;border:1px solid rgba(255,255,255,0.07);border-radius:20px;padding:48px 44px;width:100%;max-width:420px;position:relative;overflow:hidden;}
.card::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,#8b5cf6,#00e5ff,#ffd166);}
.logo{font-family:'Syne',sans-serif;font-size:22px;font-weight:800;color:#00e5ff;text-align:center;margin-bottom:8px;}
.logo span{color:#ffd166;}
h2{font-family:'Syne',sans-serif;font-size:24px;font-weight:800;text-align:center;margin-bottom:4px;}
p{font-size:14px;color:#8892aa;text-align:center;margin-bottom:32px;}
label{font-size:13px;font-weight:500;color:#8892aa;display:block;margin-bottom:6px;}
input{width:100%;background:#0a0d1a;border:1px solid rgba(255,255,255,0.07);border-radius:8px;padding:12px 14px;color:#f0f4ff;font-family:'DM Sans',sans-serif;font-size:14px;outline:none;margin-bottom:16px;transition:.2s;}
input:focus{border-color:#00e5ff;box-shadow:0 0 0 3px rgba(0,229,255,0.1);}
button{width:100%;padding:13px;border-radius:10px;background:#00e5ff;color:#000;font-size:15px;font-weight:700;border:none;cursor:pointer;transition:.25s;margin-top:8px;}
button:hover{background:#00b8cc;transform:translateY(-1px);}
.err{background:rgba(255,107,107,0.1);border:1px solid rgba(255,107,107,0.3);color:#ff6b6b;border-radius:8px;padding:12px;font-size:13px;margin-bottom:16px;display:none;}
</style></head><body>
<div class="card">
  <div class="logo">Next<span>Synergy</span> Tech</div>
  <h2>Admin Login</h2>
  <p>Sign in to the admin dashboard</p>
  <div class="err" id="err"></div>
  <label>Email</label>
  <input type="email" id="email" placeholder="admin@nextsynergytech.com" autocomplete="username">
  <label>Password</label>
  <input type="password" id="pass" placeholder="••••••••" autocomplete="current-password" onkeydown="if(event.key==='Enter')login()">
  <button onclick="login()">Sign In →</button>
</div>
<script>
async function login(){
  const email=document.getElementById('email').value;
  const pass=document.getElementById('pass').value;
  const err=document.getElementById('err');
  err.style.display='none';
  try{
    const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:pass})});
    const d=await r.json();
    if(!r.ok){err.textContent=d.error||'Login failed';err.style.display='block';return;}
    if(d.user.role!=='admin'){err.textContent='Admin access required';err.style.display='block';return;}
    document.cookie='nst_admin='+d.token+';path=/;max-age=604800';
    window.location.href='/admin';
  }catch(e){err.textContent='Server error — is the server running?';err.style.display='block';}
}
</script></body></html>`);
});

// ─── Admin Dashboard (protected) ─────────────────────────────────────────────
app.get('/admin', adminCookieAuth, (req, res) => {
  res.send(adminDashboardHTML());
});
app.get('/admin/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'nst_admin=;path=/;max-age=0');
  res.redirect('/admin/login');
});

function adminDashboardHTML() {
return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NST Admin Dashboard</title>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:wght@400;500&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
:root{
  --bg:#05080f;--bg2:#0a0d1a;--bg3:#0f1525;--surface:#141928;--surface2:#1a2035;
  --border:rgba(255,255,255,0.07);--border2:rgba(255,255,255,0.13);
  --cyan:#00e5ff;--gold:#ffd166;--green:#06d6a0;--coral:#ff6b6b;--purple:#8b5cf6;
  --text:#f0f4ff;--text2:#8892aa;--text3:#4a5568;
}
body{background:var(--bg);color:var(--text);font-family:'DM Sans',sans-serif;font-size:14px;}
a{text-decoration:none;color:inherit;}
button{cursor:pointer;border:none;font-family:'DM Sans',sans-serif;}
.hidden{display:none!important;}

/* LAYOUT */
.layout{display:grid;grid-template-columns:220px 1fr;min-height:100vh;}

/* SIDEBAR */
.sidebar{background:var(--bg2);border-right:1px solid var(--border);padding:0;position:fixed;top:0;left:0;bottom:0;width:220px;overflow-y:auto;z-index:100;display:flex;flex-direction:column;}
.sidebar-logo{padding:20px 20px 16px;border-bottom:1px solid var(--border);}
.sidebar-logo .name{font-family:'Syne',sans-serif;font-size:16px;font-weight:800;color:var(--cyan);}
.sidebar-logo .name span{color:var(--gold);}
.sidebar-logo .sub{font-size:11px;color:var(--text3);margin-top:2px;}
.sidebar-badge{display:inline-flex;align-items:center;gap:4px;background:rgba(0,229,255,0.1);border:1px solid rgba(0,229,255,0.2);border-radius:100px;padding:2px 8px;font-size:10px;color:var(--cyan);font-weight:600;margin-top:6px;}
.sidebar-badge::before{content:'';width:5px;height:5px;border-radius:50%;background:var(--cyan);animation:pulse 2s infinite;}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
nav{padding:12px 10px;flex:1;}
.nav-section{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--text3);padding:12px 10px 6px;}
.nav-item{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;color:var(--text2);font-size:13px;font-weight:500;cursor:pointer;transition:.2s;margin-bottom:2px;border:none;background:none;width:100%;text-align:left;}
.nav-item:hover{background:var(--surface);color:var(--text);}
.nav-item.active{background:var(--surface);color:var(--cyan);border-left:2px solid var(--cyan);padding-left:10px;}
.nav-item .icon{font-size:16px;width:20px;text-align:center;}
.nav-item .badge{margin-left:auto;background:var(--coral);color:#fff;border-radius:100px;padding:1px 7px;font-size:10px;font-weight:700;}
.sidebar-footer{padding:12px 10px;border-top:1px solid var(--border);}
.db-status{display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:8px;background:var(--surface);font-size:12px;margin-bottom:8px;}
.db-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;}
.db-dot.ok{background:var(--green);box-shadow:0 0 6px var(--green);}
.db-dot.err{background:var(--coral);box-shadow:0 0 6px var(--coral);}

/* MAIN */
.main{margin-left:220px;min-height:100vh;background:var(--bg);}
.topbar{background:var(--bg2);border-bottom:1px solid var(--border);padding:0 28px;height:56px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:50;}
.topbar-title{font-family:'Syne',sans-serif;font-size:17px;font-weight:700;}
.topbar-actions{display:flex;align-items:center;gap:12px;}
.btn{padding:8px 18px;border-radius:8px;font-size:13px;font-weight:600;transition:.2s;cursor:pointer;}
.btn-cyan{background:var(--cyan);color:#000;border:none;}
.btn-cyan:hover{background:#00b8cc;}
.btn-ghost{background:transparent;border:1px solid var(--border2);color:var(--text2);}
.btn-ghost:hover{border-color:var(--cyan);color:var(--cyan);}
.btn-danger{background:rgba(255,107,107,0.1);border:1px solid rgba(255,107,107,0.3);color:var(--coral);}
.btn-danger:hover{background:rgba(255,107,107,0.2);}
.btn-sm{padding:5px 12px;font-size:12px;}
.avatar{width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,var(--cyan),var(--purple));display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#000;}
.page-content{padding:28px;}

/* STAT CARDS */
.stats-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:28px;}
.stat-card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:20px;position:relative;overflow:hidden;}
.stat-card::before{content:'';position:absolute;bottom:0;left:0;right:0;height:2px;background:var(--card-accent,var(--cyan));opacity:.6;}
.stat-icon{font-size:28px;margin-bottom:12px;}
.stat-val{font-family:'Syne',sans-serif;font-size:32px;font-weight:800;line-height:1;}
.stat-label{font-size:12px;color:var(--text3);margin-top:4px;}
.stat-change{font-size:11px;color:var(--green);margin-top:6px;font-weight:600;}

/* TABLE */
.table-wrap{background:var(--surface);border:1px solid var(--border);border-radius:14px;overflow:hidden;}
.table-head{padding:16px 20px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border);}
.table-title{font-family:'Syne',sans-serif;font-size:15px;font-weight:700;}
.table-filters{display:flex;gap:8px;align-items:center;}
.filter-input{background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:7px 12px;color:var(--text);font-size:13px;outline:none;width:200px;}
.filter-input:focus{border-color:var(--cyan);}
.filter-sel{background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:7px 12px;color:var(--text);font-size:13px;outline:none;}
table{width:100%;border-collapse:collapse;}
th{background:var(--bg3);padding:11px 16px;text-align:left;font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--text3);border-bottom:1px solid var(--border);}
td{padding:13px 16px;border-bottom:1px solid var(--border);font-size:13px;color:var(--text2);vertical-align:middle;}
tr:last-child td{border-bottom:none;}
tr:hover td{background:rgba(255,255,255,0.02);}
.td-name{color:var(--text);font-weight:500;}
.td-email{color:var(--cyan);}
.td-mono{font-size:11px;color:var(--text3);font-family:monospace;}

/* BADGES */
.badge{display:inline-flex;align-items:center;padding:3px 10px;border-radius:100px;font-size:11px;font-weight:600;}
.badge-green{background:rgba(6,214,160,0.1);color:var(--green);border:1px solid rgba(6,214,160,0.25);}
.badge-cyan{background:rgba(0,229,255,0.1);color:var(--cyan);border:1px solid rgba(0,229,255,0.25);}
.badge-gold{background:rgba(255,209,102,0.1);color:var(--gold);border:1px solid rgba(255,209,102,0.25);}
.badge-coral{background:rgba(255,107,107,0.1);color:var(--coral);border:1px solid rgba(255,107,107,0.25);}
.badge-purple{background:rgba(139,92,246,0.1);color:var(--purple);border:1px solid rgba(139,92,246,0.25);}

/* ACTIONS */
.action-btns{display:flex;gap:6px;}

/* MODAL */
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px;}
.modal{background:var(--surface);border:1px solid var(--border2);border-radius:16px;width:100%;max-width:520px;max-height:90vh;overflow-y:auto;}
.modal-header{padding:20px 24px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--surface);z-index:1;}
.modal-title{font-family:'Syne',sans-serif;font-size:16px;font-weight:700;}
.modal-close{width:32px;height:32px;border-radius:8px;background:var(--surface2);border:none;color:var(--text2);font-size:16px;cursor:pointer;transition:.2s;}
.modal-close:hover{background:rgba(255,107,107,0.15);color:var(--coral);}
.modal-body{padding:24px;}
.form-group{margin-bottom:16px;}
.form-label{font-size:12px;font-weight:600;color:var(--text2);display:block;margin-bottom:6px;}
.form-input,.form-select,.form-textarea{width:100%;background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:10px 13px;color:var(--text);font-family:'DM Sans',sans-serif;font-size:13px;transition:.2s;outline:none;}
.form-input:focus,.form-select:focus,.form-textarea:focus{border-color:var(--cyan);box-shadow:0 0 0 3px rgba(0,229,255,0.1);}
.form-select option{background:var(--bg3);}
.form-textarea{min-height:80px;resize:vertical;}
.modal-footer{padding:16px 24px;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:10px;}

/* TOAST */
.toast{position:fixed;bottom:24px;right:24px;background:var(--surface2);border:1px solid var(--border2);border-radius:12px;padding:14px 20px;font-size:13px;font-weight:500;z-index:9999;transform:translateY(100px);opacity:0;transition:.3s;max-width:320px;}
.toast.show{transform:translateY(0);opacity:1;}
.toast.success{border-color:rgba(6,214,160,.35);color:var(--green);}
.toast.error{border-color:rgba(255,107,107,.35);color:var(--coral);}

/* CHART BAR */
.mini-chart{display:flex;align-items:flex-end;gap:4px;height:48px;}
.mini-bar{flex:1;background:var(--cyan);border-radius:3px 3px 0 0;opacity:.7;transition:.3s;}

/* LOADING */
.loading{text-align:center;padding:40px;color:var(--text3);}
.spinner{width:24px;height:24px;border:2px solid var(--border2);border-top-color:var(--cyan);border-radius:50%;animation:spin .8s linear infinite;display:inline-block;margin-bottom:8px;}
@keyframes spin{to{transform:rotate(360deg)}}

/* EMPTY */
.empty{text-align:center;padding:48px;color:var(--text3);}
.empty-icon{font-size:40px;margin-bottom:12px;}

/* PAGINATION */
.pagination{display:flex;justify-content:space-between;align-items:center;padding:12px 20px;border-top:1px solid var(--border);}
.page-info{font-size:12px;color:var(--text3);}
.page-btns{display:flex;gap:6px;}
.page-btn{padding:5px 12px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--text2);font-size:12px;cursor:pointer;transition:.2s;}
.page-btn:hover,.page-btn.active{background:var(--cyan);color:#000;border-color:var(--cyan);}
.page-btn:disabled{opacity:.4;cursor:not-allowed;}

@media(max-width:900px){
  .layout{grid-template-columns:1fr;}
  .sidebar{display:none;}
  .main{margin-left:0;}
  .stats-grid{grid-template-columns:repeat(2,1fr);}
}
</style></head>
<body>
<div class="toast" id="toast"></div>

<!-- MODALS -->
<div class="modal-overlay hidden" id="modal">
  <div class="modal">
    <div class="modal-header">
      <div class="modal-title" id="modalTitle">Modal</div>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" id="modalBody"></div>
    <div class="modal-footer" id="modalFooter"></div>
  </div>
</div>

<div class="layout">
  <!-- SIDEBAR -->
  <aside class="sidebar">
    <div class="sidebar-logo">
      <div class="name">Next<span>Synergy</span> Tech</div>
      <div class="sub">Admin Dashboard</div>
      <div class="sidebar-badge">● Live</div>
    </div>
    <nav>
      <div class="nav-section">Main</div>
      <button class="nav-item active" onclick="showTab('overview',this)">
        <span class="icon">📊</span> Overview
      </button>
      <button class="nav-item" onclick="showTab('orders',this)">
        <span class="icon">📦</span> Orders
        <span class="badge" id="pendingBadge">0</span>
      </button>
      <button class="nav-item" onclick="showTab('users',this)">
        <span class="icon">👥</span> Users
      </button>
      <button class="nav-item" onclick="showTab('courses',this)">
        <span class="icon">📚</span> Courses
      </button>
      <button class="nav-item" onclick="showTab('tutorials',this)">
        <span class="icon">🎬</span> Tutorials
      </button>
      <div class="nav-section">System</div>
      <button class="nav-item" onclick="showTab('settings',this)">
        <span class="icon">⚙️</span> Settings
      </button>
      <button class="nav-item" onclick="showTab('dbstatus',this)">
        <span class="icon">🗄️</span> DB Status
      </button>
    </nav>
    <div class="sidebar-footer">
      <div class="db-status" id="sideDbStatus">
        <div class="db-dot err" id="sideDbDot"></div>
        <span id="sideDbText">Checking...</span>
      </div>
      <button class="nav-item" onclick="logout()" style="color:var(--coral);">
        <span class="icon">🚪</span> Logout
      </button>
    </div>
  </aside>

  <!-- MAIN -->
  <div class="main">
    <div class="topbar">
      <div class="topbar-title" id="topbarTitle">Overview</div>
      <div class="topbar-actions">
        <button class="btn btn-ghost btn-sm" onclick="refreshAll()">↻ Refresh</button>
        <div class="avatar" id="adminAvatar">A</div>
      </div>
    </div>

    <div class="page-content">

      <!-- ── OVERVIEW ── -->
      <div id="tab-overview">
        <div class="stats-grid" id="statsGrid">
          <div class="loading"><div class="spinner"></div><br>Loading stats...</div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
          <div class="table-wrap">
            <div class="table-head"><div class="table-title">Recent Orders</div>
              <button class="btn btn-ghost btn-sm" onclick="showTab('orders',null)">View all →</button>
            </div>
            <div id="recentOrdersTable"><div class="loading"><div class="spinner"></div></div></div>
          </div>
          <div class="table-wrap">
            <div class="table-head"><div class="table-title">Recent Users</div>
              <button class="btn btn-ghost btn-sm" onclick="showTab('users',null)">View all →</button>
            </div>
            <div id="recentUsersTable"><div class="loading"><div class="spinner"></div></div></div>
          </div>
        </div>
      </div>

      <!-- ── ORDERS ── -->
      <div id="tab-orders" class="hidden">
        <div class="table-wrap">
          <div class="table-head">
            <div class="table-title">All Orders</div>
            <div class="table-filters">
              <input class="filter-input" placeholder="Search name or email…" oninput="filterOrders(this.value)">
              <select class="filter-sel" onchange="filterOrdersByStatus(this.value)">
                <option value="">All Status</option>
                <option value="pending">Pending</option>
                <option value="in-progress">In Progress</option>
                <option value="delivered">Delivered</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>
          <div id="ordersTableWrap"><div class="loading"><div class="spinner"></div></div></div>
        </div>
      </div>

      <!-- ── USERS ── -->
      <div id="tab-users" class="hidden">
        <div class="table-wrap">
          <div class="table-head">
            <div class="table-title">All Users</div>
            <div class="table-filters">
              <input class="filter-input" placeholder="Search name or email…" oninput="filterUsers(this.value)">
              <select class="filter-sel" onchange="filterUsersByRole(this.value)">
                <option value="">All Roles</option>
                <option value="student">Student</option>
                <option value="admin">Admin</option>
              </select>
              <button class="btn btn-cyan btn-sm" onclick="openAddUserModal()">+ Add User</button>
            </div>
          </div>
          <div id="usersTableWrap"><div class="loading"><div class="spinner"></div></div></div>
        </div>
      </div>

      <!-- ── COURSES ── -->
      <div id="tab-courses" class="hidden">
        <div class="table-wrap">
          <div class="table-head">
            <div class="table-title">Courses</div>
            <button class="btn btn-cyan btn-sm" onclick="openAddCourseModal()">+ Add Course</button>
          </div>
          <div id="coursesTableWrap"><div class="loading"><div class="spinner"></div></div></div>
        </div>
      </div>

      <!-- ── TUTORIALS ── -->
      <div id="tab-tutorials" class="hidden">
        <div class="table-wrap">
          <div class="table-head">
            <div class="table-title">Tutorials</div>
            <button class="btn btn-cyan btn-sm" onclick="openAddTutorialModal()">+ Add Tutorial</button>
          </div>
          <div id="tutorialsTableWrap"><div class="loading"><div class="spinner"></div></div></div>
        </div>
      </div>

      <!-- ── SETTINGS ── -->
      <div id="tab-settings" class="hidden">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
          <div class="table-wrap" style="padding:24px;">
            <div class="table-title" style="margin-bottom:20px;">Admin Profile</div>
            <div class="form-group"><label class="form-label">Display Name</label>
              <input class="form-input" id="settingsName" placeholder="Admin name"></div>
            <div class="form-group"><label class="form-label">Email</label>
              <input class="form-input" id="settingsEmail" type="email"></div>
            <div class="form-group"><label class="form-label">New Password (leave blank to keep)</label>
              <input class="form-input" id="settingsPass" type="password" placeholder="••••••••"></div>
            <button class="btn btn-cyan" onclick="saveSettings()" style="margin-top:4px;">Save Changes</button>
          </div>
          <div class="table-wrap" style="padding:24px;">
            <div class="table-title" style="margin-bottom:20px;">Site Settings</div>
            <div class="form-group"><label class="form-label">Site Name</label>
              <input class="form-input" value="NextSynergy Tech"></div>
            <div class="form-group"><label class="form-label">Contact Email</label>
              <input class="form-input" value="eshetuwek1@gmail.com"></div>
            <div class="form-group"><label class="form-label">Support Phone</label>
              <input class="form-input" value="+1 (704) 488-8465"></div>
            <button class="btn btn-cyan" onclick="toast('Settings saved','success')" style="margin-top:4px;">Save Settings</button>
          </div>
        </div>
      </div>

      <!-- ── DB STATUS ── -->
      <div id="tab-dbstatus" class="hidden">
        <div class="table-wrap" style="padding:28px;max-width:600px;">
          <div class="table-title" style="margin-bottom:20px;">MongoDB Atlas Status</div>
          <div id="dbStatusDetail"><div class="loading"><div class="spinner"></div></div></div>
          <button class="btn btn-cyan" style="margin-top:20px;" onclick="loadDbStatus()">↻ Re-check Connection</button>
        </div>
        <div class="table-wrap" style="padding:24px;margin-top:20px;max-width:600px;">
          <div class="table-title" style="margin-bottom:12px;">Connection Info</div>
          <table style="width:100%;">
            <tr><td style="color:var(--text3);padding:8px 0;font-size:13px;">Host</td><td style="color:var(--text);font-size:13px;">cluster0.qli7n5o.mongodb.net</td></tr>
            <tr><td style="color:var(--text3);padding:8px 0;font-size:13px;">Database</td><td style="color:var(--cyan);font-size:13px;">seeds</td></tr>
            <tr><td style="color:var(--text3);padding:8px 0;font-size:13px;">User</td><td style="color:var(--text);font-size:13px;">eshetu</td></tr>
            <tr><td style="color:var(--text3);padding:8px 0;font-size:13px;">Provider</td><td style="color:var(--text);font-size:13px;">MongoDB Atlas (AWS)</td></tr>
          </table>
        </div>
      </div>

    </div><!-- /page-content -->
  </div><!-- /main -->
</div><!-- /layout -->

<script>
// ── State ──────────────────────────────────────────────────────────────────
let allOrders=[], allUsers=[], allCourses=[], allTutorials=[];
let filteredOrders=[], filteredUsers=[];
const token = (document.cookie.match(/nst_admin=([^;]+)/)||[])[1]||'';

// ── API helper ─────────────────────────────────────────────────────────────
async function api(path, method='GET', body=null) {
  const opts = { method, headers: { 'Authorization': 'Bearer '+token, 'Content-Type': 'application/json' }};
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch('/api'+path, opts);
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'Request failed');
  return d;
}

// ── Toast ──────────────────────────────────────────────────────────────────
function toast(msg, type='success') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast '+type+' show';
  setTimeout(()=>t.classList.remove('show'), 3000);
}

// ── Tab switching ──────────────────────────────────────────────────────────
function showTab(id, btnEl) {
  document.querySelectorAll('[id^="tab-"]').forEach(el=>el.classList.add('hidden'));
  document.getElementById('tab-'+id).classList.remove('hidden');
  document.querySelectorAll('.nav-item').forEach(b=>b.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');
  const titles = {overview:'Overview',orders:'Orders',users:'Users',courses:'Courses',tutorials:'Tutorials',settings:'Settings',dbstatus:'Database Status'};
  document.getElementById('topbarTitle').textContent = titles[id]||id;
  if (id==='orders') loadOrders();
  if (id==='users') loadUsers();
  if (id==='courses') loadCourses();
  if (id==='tutorials') loadTutorials();
  if (id==='dbstatus') loadDbStatus();
}

// ── Modal ──────────────────────────────────────────────────────────────────
function openModal(title, bodyHTML, footerHTML) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = bodyHTML;
  document.getElementById('modalFooter').innerHTML = footerHTML;
  document.getElementById('modal').classList.remove('hidden');
}
function closeModal() { document.getElementById('modal').classList.add('hidden'); }

// ── Status badge ───────────────────────────────────────────────────────────
function statusBadge(s) {
  const map = { pending:'badge-gold', 'in-progress':'badge-cyan', delivered:'badge-green', cancelled:'badge-coral' };
  return \`<span class="badge \${map[s]||'badge-purple'}">\${s}</span>\`;
}
function roleBadge(r) {
  return r==='admin' ? '<span class="badge badge-coral">Admin</span>' : '<span class="badge badge-cyan">Student</span>';
}

// ─────────────────────────────────────────────────────────────────
//  OVERVIEW
// ─────────────────────────────────────────────────────────────────
async function loadOverview() {
  try {
    const stats = await api('/admin/stats');
    document.getElementById('pendingBadge').textContent = stats.pendingOrders||0;
    document.getElementById('statsGrid').innerHTML = \`
      <div class="stat-card" style="--card-accent:var(--cyan)">
        <div class="stat-icon">👥</div>
        <div class="stat-val" style="color:var(--cyan)">\${stats.totalUsers||0}</div>
        <div class="stat-label">Total Users</div>
        <div class="stat-change">↑ Active students</div>
      </div>
      <div class="stat-card" style="--card-accent:var(--gold)">
        <div class="stat-icon">📦</div>
        <div class="stat-val" style="color:var(--gold)">\${stats.totalOrders||0}</div>
        <div class="stat-label">Total Orders</div>
        <div class="stat-change" style="color:var(--coral)">\${stats.pendingOrders||0} pending</div>
      </div>
      <div class="stat-card" style="--card-accent:var(--green)">
        <div class="stat-icon">📚</div>
        <div class="stat-val" style="color:var(--green)">\${stats.totalCourses||0}</div>
        <div class="stat-label">Published Courses</div>
        <div class="stat-change">Active curriculum</div>
      </div>
      <div class="stat-card" style="--card-accent:var(--purple)">
        <div class="stat-icon">🎓</div>
        <div class="stat-val" style="color:var(--purple)">\${stats.totalEnrollments||0}</div>
        <div class="stat-label">Enrollments</div>
        <div class="stat-change">All time</div>
      </div>\`;

    // Recent orders
    const orders = await api('/orders?limit=5');
    const recentO = (Array.isArray(orders)?orders:orders.data||[]).slice(0,5);
    document.getElementById('recentOrdersTable').innerHTML = recentO.length ? \`<table>
      <thead><tr><th>Client</th><th>Package</th><th>Status</th><th>Date</th></tr></thead>
      <tbody>\${recentO.map(o=>\`<tr>
        <td><div class="td-name">\${o.firstName} \${o.lastName}</div><div class="td-email">\${o.email}</div></td>
        <td style="color:var(--text);max-width:140px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">\${o.packageName}</td>
        <td>\${statusBadge(o.status)}</td>
        <td class="td-mono">\${new Date(o.createdAt).toLocaleDateString()}</td>
      </tr>\`).join('')}</tbody></table>\` : '<div class="empty"><div class="empty-icon">📭</div>No orders yet</div>';

    // Recent users
    const users = await api('/admin/users?limit=5');
    const recentU = (Array.isArray(users)?users:users.data||[]).slice(0,5);
    document.getElementById('recentUsersTable').innerHTML = recentU.length ? \`<table>
      <thead><tr><th>Name</th><th>Role</th><th>Joined</th></tr></thead>
      <tbody>\${recentU.map(u=>\`<tr>
        <td><div class="td-name">\${u.firstName} \${u.lastName}</div><div class="td-email">\${u.email}</div></td>
        <td>\${roleBadge(u.role)}</td>
        <td class="td-mono">\${new Date(u.createdAt).toLocaleDateString()}</td>
      </tr>\`).join('')}</tbody></table>\` : '<div class="empty"><div class="empty-icon">👤</div>No users yet</div>';

  } catch(e) { document.getElementById('statsGrid').innerHTML = \`<div class="empty" style="grid-column:1/-1"><div class="empty-icon">⚠️</div>\${e.message}</div>\`; }
}

// ─────────────────────────────────────────────────────────────────
//  ORDERS
// ─────────────────────────────────────────────────────────────────
async function loadOrders() {
  document.getElementById('ordersTableWrap').innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    allOrders = await api('/orders');
    if (!Array.isArray(allOrders)) allOrders = allOrders.data || [];
    filteredOrders = [...allOrders];
    renderOrdersTable(filteredOrders);
  } catch(e) { document.getElementById('ordersTableWrap').innerHTML = \`<div class="empty"><div class="empty-icon">⚠️</div>\${e.message}</div>\`; }
}
function renderOrdersTable(orders) {
  document.getElementById('ordersTableWrap').innerHTML = orders.length ? \`
    <table>
      <thead><tr><th>Client</th><th>Package</th><th>Budget</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead>
      <tbody>\${orders.map(o=>\`<tr>
        <td><div class="td-name">\${o.firstName} \${o.lastName}</div><div class="td-email">\${o.email}</div>\${o.phone?\`<div class="td-mono">\${o.phone}</div>\`:''}</td>
        <td style="color:var(--text);max-width:180px;">\${o.packageName}</td>
        <td><span class="badge badge-purple">\${o.budget||'—'}</span></td>
        <td>\${statusBadge(o.status)}</td>
        <td class="td-mono">\${new Date(o.createdAt).toLocaleDateString()}</td>
        <td><div class="action-btns">
          <button class="btn btn-ghost btn-sm" onclick="viewOrder('\${o._id}')">View</button>
          <button class="btn btn-cyan btn-sm" onclick="editOrderStatus('\${o._id}','\${o.status}')">Status</button>
          <button class="btn btn-danger btn-sm" onclick="deleteOrder('\${o._id}')">✕</button>
        </div></td>
      </tr>\`).join('')}</tbody>
    </table>
    <div class="pagination"><div class="page-info">Showing \${orders.length} of \${allOrders.length} orders</div></div>\`
  : '<div class="empty"><div class="empty-icon">📭</div>No orders found</div>';
}
function filterOrders(q) {
  filteredOrders = allOrders.filter(o=> (o.firstName+' '+o.lastName+' '+o.email+' '+o.packageName).toLowerCase().includes(q.toLowerCase()));
  renderOrdersTable(filteredOrders);
}
function filterOrdersByStatus(s) {
  filteredOrders = s ? allOrders.filter(o=>o.status===s) : [...allOrders];
  renderOrdersTable(filteredOrders);
}
function viewOrder(id) {
  const o = allOrders.find(x=>x._id===id); if(!o) return;
  openModal('Order Details', \`
    <div style="display:grid;gap:12px;">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div><div class="form-label">Client Name</div><div style="color:var(--text);font-weight:500;">\${o.firstName} \${o.lastName}</div></div>
        <div><div class="form-label">Email</div><div style="color:var(--cyan);">\${o.email}</div></div>
        <div><div class="form-label">Phone</div><div>\${o.phone||'—'}</div></div>
        <div><div class="form-label">Budget</div><div>\${o.budget||'—'}</div></div>
        <div><div class="form-label">Package</div><div style="color:var(--text);font-weight:500;">\${o.packageName}</div></div>
        <div><div class="form-label">Status</div>\${statusBadge(o.status)}</div>
        <div><div class="form-label">Order Date</div><div class="td-mono">\${new Date(o.createdAt).toLocaleString()}</div></div>
      </div>
      <div><div class="form-label">Project Description</div>
        <div style="background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:12px;font-size:13px;line-height:1.6;">\${o.description}</div>
      </div>
      \${o.adminNotes?'<div><div class="form-label">Admin Notes</div><div style="color:var(--gold);font-size:13px;">'+o.adminNotes+'</div></div>':''}
    </div>\`,
    \`<button class="btn btn-ghost" onclick="closeModal()">Close</button>
     <button class="btn btn-cyan" onclick="closeModal();editOrderStatus('\${o._id}','\${o.status}')">Update Status →</button>\`);
}
function editOrderStatus(id, current) {
  openModal('Update Order Status', \`
    <div class="form-group"><label class="form-label">New Status</label>
      <select class="form-select" id="newStatus">
        \${['pending','in-progress','delivered','cancelled'].map(s=>\`<option value="\${s}"\${s===current?' selected':''}>\${s}</option>\`).join('')}
      </select>
    </div>
    <div class="form-group"><label class="form-label">Admin Notes (optional)</label>
      <textarea class="form-textarea" id="adminNotes" placeholder="Internal notes or message to client…"></textarea>
    </div>\`,
    \`<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
     <button class="btn btn-cyan" onclick="doUpdateOrderStatus('\${id}')">Update Status</button>\`);
}
async function doUpdateOrderStatus(id) {
  const status = document.getElementById('newStatus').value;
  const adminNotes = document.getElementById('adminNotes').value;
  try {
    await api('/orders/'+id+'/status','PUT',{status,adminNotes});
    const i = allOrders.findIndex(o=>o._id===id);
    if(i>-1){allOrders[i].status=status;allOrders[i].adminNotes=adminNotes;}
    filteredOrders = [...allOrders];
    renderOrdersTable(filteredOrders);
    document.getElementById('pendingBadge').textContent = allOrders.filter(o=>o.status==='pending').length;
    closeModal(); toast('Order status updated ✓','success');
  } catch(e) { toast(e.message,'error'); }
}
async function deleteOrder(id) {
  if(!confirm('Delete this order? This cannot be undone.')) return;
  try {
    await api('/orders/'+id,'DELETE');
    allOrders = allOrders.filter(o=>o._id!==id);
    filteredOrders = [...allOrders];
    renderOrdersTable(filteredOrders);
    toast('Order deleted','success');
  } catch(e) { toast(e.message,'error'); }
}

// ─────────────────────────────────────────────────────────────────
//  USERS
// ─────────────────────────────────────────────────────────────────
async function loadUsers() {
  document.getElementById('usersTableWrap').innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    allUsers = await api('/admin/users');
    if (!Array.isArray(allUsers)) allUsers = allUsers.data || [];
    filteredUsers = [...allUsers];
    renderUsersTable(filteredUsers);
  } catch(e) { document.getElementById('usersTableWrap').innerHTML = \`<div class="empty"><div class="empty-icon">⚠️</div>\${e.message}</div>\`; }
}
function renderUsersTable(users) {
  document.getElementById('usersTableWrap').innerHTML = users.length ? \`
    <table>
      <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Enrolled</th><th>Status</th><th>Joined</th><th>Actions</th></tr></thead>
      <tbody>\${users.map(u=>\`<tr>
        <td class="td-name">\${u.firstName} \${u.lastName}</td>
        <td class="td-email">\${u.email}</td>
        <td>\${roleBadge(u.role)}</td>
        <td><span class="badge badge-purple">\${(u.enrolledCourses||[]).length} courses</span></td>
        <td>\${u.isActive!==false?'<span class="badge badge-green">Active</span>':'<span class="badge badge-coral">Inactive</span>'}</td>
        <td class="td-mono">\${new Date(u.createdAt).toLocaleDateString()}</td>
        <td><div class="action-btns">
          <button class="btn btn-ghost btn-sm" onclick="viewUser('\${u._id}')">View</button>
          <button class="btn btn-cyan btn-sm" onclick="editUserRole('\${u._id}','\${u.role}')">Role</button>
          <button class="btn btn-danger btn-sm" onclick="toggleUserActive('\${u._id}',\${u.isActive!==false})">\${u.isActive!==false?'Ban':'Unban'}</button>
        </div></td>
      </tr>\`).join('')}</tbody>
    </table>
    <div class="pagination"><div class="page-info">Showing \${users.length} of \${allUsers.length} users</div></div>\`
  : '<div class="empty"><div class="empty-icon">👤</div>No users found</div>';
}
function filterUsers(q) {
  filteredUsers = allUsers.filter(u=>(u.firstName+' '+u.lastName+' '+u.email).toLowerCase().includes(q.toLowerCase()));
  renderUsersTable(filteredUsers);
}
function filterUsersByRole(r) {
  filteredUsers = r ? allUsers.filter(u=>u.role===r) : [...allUsers];
  renderUsersTable(filteredUsers);
}
function viewUser(id) {
  const u = allUsers.find(x=>x._id===id); if(!u) return;
  openModal('User Profile', \`
    <div style="display:flex;align-items:center;gap:16px;margin-bottom:20px;">
      <div style="width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,var(--cyan),var(--purple));display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:800;color:#000;">\${(u.firstName[0]||'').toUpperCase()}</div>
      <div><div style="font-family:'Syne',sans-serif;font-size:18px;font-weight:700;">\${u.firstName} \${u.lastName}</div>
           <div style="color:var(--cyan);font-size:13px;">\${u.email}</div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:13px;">
      <div><div class="form-label">Role</div>\${roleBadge(u.role)}</div>
      <div><div class="form-label">Status</div>\${u.isActive!==false?'<span class="badge badge-green">Active</span>':'<span class="badge badge-coral">Banned</span>'}</div>
      <div><div class="form-label">Courses Enrolled</div><div style="color:var(--text)">\${(u.enrolledCourses||[]).length}</div></div>
      <div><div class="form-label">Hours Watched</div><div style="color:var(--text)">\${(u.hoursWatched||0).toFixed(1)}h</div></div>
      <div><div class="form-label">Streak</div><div style="color:var(--gold)">\${u.streak||0} days 🔥</div></div>
      <div><div class="form-label">Last Login</div><div class="td-mono">\${u.lastLogin?new Date(u.lastLogin).toLocaleString():'Never'}</div></div>
      <div><div class="form-label">Goal</div><div>\${u.goal||'—'}</div></div>
      <div><div class="form-label">Joined</div><div class="td-mono">\${new Date(u.createdAt).toLocaleString()}</div></div>
    </div>\`,
    \`<button class="btn btn-ghost" onclick="closeModal()">Close</button>\`);
}
function editUserRole(id, current) {
  openModal('Change User Role', \`
    <div class="form-group"><label class="form-label">New Role</label>
      <select class="form-select" id="newRole">
        <option value="student"\${current==='student'?' selected':''}>Student</option>
        <option value="admin"\${current==='admin'?' selected':''}>Admin</option>
      </select>
    </div>
    <p style="font-size:12px;color:var(--coral);margin-top:8px;">⚠️ Admin users have full dashboard access.</p>\`,
    \`<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
     <button class="btn btn-cyan" onclick="doUpdateRole('\${id}')">Update Role</button>\`);
}
async function doUpdateRole(id) {
  const role = document.getElementById('newRole').value;
  try {
    await api('/admin/users/'+id+'/role','PUT',{role});
    const i = allUsers.findIndex(u=>u._id===id);
    if(i>-1) allUsers[i].role=role;
    filteredUsers=[...allUsers]; renderUsersTable(filteredUsers);
    closeModal(); toast('Role updated ✓','success');
  } catch(e) { toast(e.message,'error'); }
}
async function toggleUserActive(id, isActive) {
  if(!confirm(isActive?'Ban this user? They will not be able to log in.':'Unban this user?')) return;
  try {
    await api('/admin/users/'+id+'/active','PUT',{isActive:!isActive});
    const i = allUsers.findIndex(u=>u._id===id);
    if(i>-1) allUsers[i].isActive=!isActive;
    filteredUsers=[...allUsers]; renderUsersTable(filteredUsers);
    toast(isActive?'User banned':'User unbanned','success');
  } catch(e) { toast(e.message,'error'); }
}
function openAddUserModal() {
  openModal('Add New User', \`
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div class="form-group"><label class="form-label">First Name</label><input class="form-input" id="nu-fn" placeholder="John"></div>
      <div class="form-group"><label class="form-label">Last Name</label><input class="form-input" id="nu-ln" placeholder="Doe"></div>
    </div>
    <div class="form-group"><label class="form-label">Email</label><input class="form-input" id="nu-em" type="email" placeholder="john@email.com"></div>
    <div class="form-group"><label class="form-label">Password</label><input class="form-input" id="nu-pw" type="password" placeholder="Min 6 characters"></div>
    <div class="form-group"><label class="form-label">Role</label>
      <select class="form-select" id="nu-role"><option value="student">Student</option><option value="admin">Admin</option></select>
    </div>\`,
    \`<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
     <button class="btn btn-cyan" onclick="doAddUser()">Create User</button>\`);
}
async function doAddUser() {
  const fn=document.getElementById('nu-fn').value, ln=document.getElementById('nu-ln').value,
        em=document.getElementById('nu-em').value, pw=document.getElementById('nu-pw').value,
        role=document.getElementById('nu-role').value;
  if(!fn||!ln||!em||!pw){toast('Fill in all fields','error');return;}
  try {
    await api('/admin/users/create','POST',{firstName:fn,lastName:ln,email:em,password:pw,role});
    closeModal(); toast('User created ✓','success'); loadUsers();
  } catch(e) { toast(e.message,'error'); }
}

// ─────────────────────────────────────────────────────────────────
//  COURSES
// ─────────────────────────────────────────────────────────────────
async function loadCourses() {
  document.getElementById('coursesTableWrap').innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    allCourses = await api('/courses');
    if(!Array.isArray(allCourses)) allCourses=[];
    document.getElementById('coursesTableWrap').innerHTML = allCourses.length ? \`
      <table>
        <thead><tr><th>Course</th><th>Category</th><th>Price</th><th>Enrolled</th><th>Published</th><th>Actions</th></tr></thead>
        <tbody>\${allCourses.map(c=>\`<tr>
          <td><div class="td-name">\${c.thumbnail||'📚'} \${c.title}</div><div style="font-size:11px;color:var(--text3);">\${c.instructor||''}</div></td>
          <td><span class="badge badge-cyan">\${c.category}</span></td>
          <td>\${c.isFree?'<span class="badge badge-green">Free</span>':\`<span class="badge badge-gold">$\${c.price}</span>\`}</td>
          <td>\${c.enrolled||0}</td>
          <td>\${c.published?'<span class="badge badge-green">Live</span>':'<span class="badge badge-coral">Draft</span>'}</td>
          <td><div class="action-btns">
            <button class="btn btn-cyan btn-sm" onclick="editCourse('\${c._id}')">Edit</button>
            <button class="btn btn-danger btn-sm" onclick="deleteCourse('\${c._id}')">Delete</button>
          </div></td>
        </tr>\`).join('')}</tbody>
      </table>\` : '<div class="empty"><div class="empty-icon">📚</div>No courses yet — add one above.</div>';
  } catch(e) { document.getElementById('coursesTableWrap').innerHTML=\`<div class="empty"><div class="empty-icon">⚠️</div>\${e.message}</div>\`; }
}
function openAddCourseModal() {
  openModal('Add New Course', \`
    <div class="form-group"><label class="form-label">Title</label><input class="form-input" id="nc-title" placeholder="Course title"></div>
    <div class="form-group"><label class="form-label">Description</label><textarea class="form-textarea" id="nc-desc" placeholder="What will students learn?"></textarea></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div class="form-group"><label class="form-label">Category</label>
        <select class="form-select" id="nc-cat">
          \${['web','mobile','ai','security','cloud','java','design','database'].map(c=>\`<option>\${c}</option>\`).join('')}
        </select>
      </div>
      <div class="form-group"><label class="form-label">Level</label>
        <select class="form-select" id="nc-level">
          <option>beginner</option><option>intermediate</option><option>advanced</option>
        </select>
      </div>
      <div class="form-group"><label class="form-label">Price ($) — 0 for free</label><input class="form-input" id="nc-price" type="number" value="0" min="0"></div>
      <div class="form-group"><label class="form-label">Instructor</label><input class="form-input" id="nc-inst" placeholder="NextSynergy Team"></div>
    </div>\`,
    \`<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
     <button class="btn btn-cyan" onclick="doAddCourse()">Add Course</button>\`);
}
async function doAddCourse() {
  const title=document.getElementById('nc-title').value, desc=document.getElementById('nc-desc').value,
        category=document.getElementById('nc-cat').value, level=document.getElementById('nc-level').value,
        price=Number(document.getElementById('nc-price').value), instructor=document.getElementById('nc-inst').value||'NextSynergy Team';
  if(!title||!desc){toast('Title and description required','error');return;}
  try {
    await api('/courses','POST',{title,description:desc,category,level,price,isFree:price===0,instructor,published:true});
    closeModal(); toast('Course added ✓','success'); loadCourses();
  } catch(e) { toast(e.message,'error'); }
}
function editCourse(id) {
  const c = allCourses.find(x=>x._id===id); if(!c) return;
  openModal('Edit Course', \`
    <div class="form-group"><label class="form-label">Title</label><input class="form-input" id="ec-title" value="\${c.title}"></div>
    <div class="form-group"><label class="form-label">Description</label><textarea class="form-textarea" id="ec-desc">\${c.description}</textarea></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div class="form-group"><label class="form-label">Price ($)</label><input class="form-input" id="ec-price" type="number" value="\${c.price||0}"></div>
      <div class="form-group"><label class="form-label">Published</label>
        <select class="form-select" id="ec-pub"><option value="true"\${c.published?' selected':''}>Published</option><option value="false"\${!c.published?' selected':''}>Draft</option></select>
      </div>
    </div>\`,
    \`<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
     <button class="btn btn-cyan" onclick="doEditCourse('\${id}')">Save Changes</button>\`);
}
async function doEditCourse(id) {
  const title=document.getElementById('ec-title').value, description=document.getElementById('ec-desc').value,
        price=Number(document.getElementById('ec-price').value), published=document.getElementById('ec-pub').value==='true';
  try {
    await api('/courses/'+id,'PUT',{title,description,price,isFree:price===0,published});
    closeModal(); toast('Course updated ✓','success'); loadCourses();
  } catch(e) { toast(e.message,'error'); }
}
async function deleteCourse(id) {
  if(!confirm('Delete this course? All enrollments will be affected.')) return;
  try {
    await api('/courses/'+id,'DELETE');
    toast('Course deleted','success'); loadCourses();
  } catch(e) { toast(e.message,'error'); }
}

// ─────────────────────────────────────────────────────────────────
//  TUTORIALS
// ─────────────────────────────────────────────────────────────────
async function loadTutorials() {
  document.getElementById('tutorialsTableWrap').innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    allTutorials = await api('/tutorials');
    if(!Array.isArray(allTutorials)) allTutorials=[];
    document.getElementById('tutorialsTableWrap').innerHTML = allTutorials.length ? \`
      <table>
        <thead><tr><th>Tutorial</th><th>Topic</th><th>Duration</th><th>Views</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>\${allTutorials.map(t=>\`<tr>
          <td class="td-name">\${t.thumbnail||'🎬'} \${t.title}</td>
          <td><span class="badge badge-gold">\${t.topic||'—'}</span></td>
          <td>\${t.duration||'—'}</td>
          <td>\${t.views||0}</td>
          <td>\${t.published?'<span class="badge badge-green">Live</span>':'<span class="badge badge-coral">Draft</span>'}</td>
          <td><div class="action-btns">
            <button class="btn btn-cyan btn-sm" onclick="editTutorial('\${t._id}')">Edit</button>
            <button class="btn btn-danger btn-sm" onclick="deleteTutorial('\${t._id}')">Delete</button>
          </div></td>
        </tr>\`).join('')}</tbody>
      </table>\` : '<div class="empty"><div class="empty-icon">🎬</div>No tutorials yet.</div>';
  } catch(e) { document.getElementById('tutorialsTableWrap').innerHTML=\`<div class="empty"><div class="empty-icon">⚠️</div>\${e.message}</div>\`; }
}
function openAddTutorialModal() {
  openModal('Add Tutorial', \`
    <div class="form-group"><label class="form-label">Title</label><input class="form-input" id="nt-title" placeholder="Tutorial title"></div>
    <div class="form-group"><label class="form-label">YouTube Video ID</label><input class="form-input" id="nt-vid" placeholder="e.g. SzMiJFOa6w8"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div class="form-group"><label class="form-label">Topic</label><input class="form-input" id="nt-topic" placeholder="AI & ML"></div>
      <div class="form-group"><label class="form-label">Duration</label><input class="form-input" id="nt-dur" placeholder="20 min"></div>
      <div class="form-group"><label class="form-label">Thumbnail emoji</label><input class="form-input" id="nt-thumb" placeholder="🎬"></div>
    </div>\`,
    \`<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
     <button class="btn btn-cyan" onclick="doAddTutorial()">Add Tutorial</button>\`);
}
async function doAddTutorial() {
  const title=document.getElementById('nt-title').value, videoId=document.getElementById('nt-vid').value,
        topic=document.getElementById('nt-topic').value, duration=document.getElementById('nt-dur').value,
        thumbnail=document.getElementById('nt-thumb').value||'🎬';
  if(!title||!videoId){toast('Title and Video ID required','error');return;}
  try {
    await api('/tutorials','POST',{title,videoId,topic,duration,thumbnail,isFree:true,published:true});
    closeModal(); toast('Tutorial added ✓','success'); loadTutorials();
  } catch(e) { toast(e.message,'error'); }
}
function editTutorial(id) {
  const t=allTutorials.find(x=>x._id===id); if(!t) return;
  openModal('Edit Tutorial', \`
    <div class="form-group"><label class="form-label">Title</label><input class="form-input" id="et-title" value="\${t.title}"></div>
    <div class="form-group"><label class="form-label">YouTube Video ID</label><input class="form-input" id="et-vid" value="\${t.videoId}"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div class="form-group"><label class="form-label">Topic</label><input class="form-input" id="et-topic" value="\${t.topic||''}"></div>
      <div class="form-group"><label class="form-label">Duration</label><input class="form-input" id="et-dur" value="\${t.duration||''}"></div>
      <div class="form-group"><label class="form-label">Published</label>
        <select class="form-select" id="et-pub"><option value="true"\${t.published?' selected':''}>Published</option><option value="false"\${!t.published?' selected':''}>Draft</option></select>
      </div>
    </div>\`,
    \`<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
     <button class="btn btn-cyan" onclick="doEditTutorial('\${t._id}')">Save</button>\`);
}
async function doEditTutorial(id) {
  const title=document.getElementById('et-title').value, videoId=document.getElementById('et-vid').value,
        topic=document.getElementById('et-topic').value, duration=document.getElementById('et-dur').value,
        published=document.getElementById('et-pub').value==='true';
  try {
    await api('/tutorials/'+id,'PUT',{title,videoId,topic,duration,published});
    closeModal(); toast('Tutorial updated ✓','success'); loadTutorials();
  } catch(e) { toast(e.message,'error'); }
}
async function deleteTutorial(id) {
  if(!confirm('Delete this tutorial?')) return;
  try {
    await api('/tutorials/'+id,'DELETE');
    toast('Tutorial deleted','success'); loadTutorials();
  } catch(e) { toast(e.message,'error'); }
}

// ─────────────────────────────────────────────────────────────────
//  DB STATUS
// ─────────────────────────────────────────────────────────────────
async function loadDbStatus() {
  document.getElementById('dbStatusDetail').innerHTML='<div class="loading"><div class="spinner"></div></div>';
  try {
    const d = await api('/admin/db-status');
    const ok = d.connected;
    document.getElementById('sideDbDot').className='db-dot '+(ok?'ok':'err');
    document.getElementById('sideDbText').textContent=ok?'Connected':'Disconnected';
    document.getElementById('dbStatusDetail').innerHTML=\`
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">
        <div style="width:14px;height:14px;border-radius:50%;background:\${ok?'var(--green)':'var(--coral)'};box-shadow:0 0 8px \${ok?'var(--green)':'var(--coral)'}"></div>
        <span style="font-size:16px;font-weight:600;color:\${ok?'var(--green)':'var(--coral)'}">\${ok?'Connected to MongoDB Atlas':'Connection Failed'}</span>
      </div>
      \${ok?\`
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:16px;">
        <div style="background:var(--surface2);border-radius:10px;padding:14px;text-align:center;">
          <div style="font-size:22px;font-weight:800;color:var(--cyan)">\${d.collections||0}</div>
          <div style="font-size:11px;color:var(--text3);margin-top:2px;">Collections</div>
        </div>
        <div style="background:var(--surface2);border-radius:10px;padding:14px;text-align:center;">
          <div style="font-size:22px;font-weight:800;color:var(--gold)">\${d.totalDocuments||0}</div>
          <div style="font-size:11px;color:var(--text3);margin-top:2px;">Total Documents</div>
        </div>
        <div style="background:var(--surface2);border-radius:10px;padding:14px;text-align:center;">
          <div style="font-size:22px;font-weight:800;color:var(--green)">\${d.ping||'—'}ms</div>
          <div style="font-size:11px;color:var(--text3);margin-top:2px;">Ping</div>
        </div>
      </div>\`:\`
      <div style="background:rgba(255,107,107,0.1);border:1px solid rgba(255,107,107,0.3);border-radius:10px;padding:16px;color:var(--coral);font-size:13px;">
        <strong>Error:</strong> \${d.error||'Could not reach MongoDB Atlas.'}<br><br>
        <strong>Fix checklist:</strong><br>
        • Check your .env MONGO_URI has the URL-encoded password (@ → %40)<br>
        • In Atlas → Network Access → add your IP (or 0.0.0.0/0 for all)<br>
        • In Atlas → Database Access → confirm user "eshetu" has readWrite on "seeds"<br>
        • Make sure your cluster is not paused
      </div>\`}
      <div style="font-size:12px;color:var(--text3);margin-top:12px;">Last checked: \${new Date().toLocaleTimeString()}</div>\`;
  } catch(e) {
    document.getElementById('sideDbDot').className='db-dot err';
    document.getElementById('sideDbText').textContent='Error';
    document.getElementById('dbStatusDetail').innerHTML=\`<div style="color:var(--coral);">Could not reach server: \${e.message}</div>\`;
  }
}

// ─────────────────────────────────────────────────────────────────
//  SETTINGS
// ─────────────────────────────────────────────────────────────────
async function saveSettings() {
  const name=document.getElementById('settingsName').value;
  const email=document.getElementById('settingsEmail').value;
  const pass=document.getElementById('settingsPass').value;
  try {
    await api('/auth/profile','PUT',{firstName:name.split(' ')[0]||name, lastName:name.split(' ')[1]||'', email});
    if(pass) await api('/auth/change-password','PUT',{currentPassword:'',newPassword:pass});
    toast('Settings saved ✓','success');
  } catch(e) { toast(e.message,'error'); }
}

// ─────────────────────────────────────────────────────────────────
//  MISC
// ─────────────────────────────────────────────────────────────────
function logout() {
  if(confirm('Log out of admin dashboard?')) window.location.href='/admin/logout';
}
function refreshAll() {
  const active=document.querySelector('.nav-item.active');
  loadOverview();
  toast('Refreshed ✓','success');
}

// ─── INIT ──────────────────────────────────────────────────────────────────
loadOverview();
loadDbStatus();
// Poll DB status every 30s
setInterval(loadDbStatus, 30000);
</script>
</body></html>`;
}

// ═════════════════════════════════════════════════════════════════════════════
//  API ROUTES (continued — adding missing admin endpoints for dashboard)
// ═════════════════════════════════════════════════════════════════════════════

// DB status endpoint
app.get('/api/admin/db-status', adminRequired, async (req, res) => {
  const start = Date.now();
  try {
    if (mongoose.connection.readyState !== 1) throw new Error('Not connected');
    await mongoose.connection.db.admin().ping();
    const ping = Date.now() - start;
    const collections = await mongoose.connection.db.listCollections().toArray();
    let totalDocuments = 0;
    for (const col of collections) {
      totalDocuments += await mongoose.connection.db.collection(col.name).countDocuments();
    }
    res.json({ connected: true, ping, collections: collections.length, totalDocuments, dbName: 'seeds' });
  } catch(e) {
    res.json({ connected: false, error: e.message });
  }
});

// Admin create user (used by dashboard "Add User")
app.post('/api/admin/users/create', adminRequired, requireDB, async (req, res) => {
  try {
    const { firstName, lastName, email, password, role } = req.body;
    if (!firstName||!lastName||!email||!password) return res.status(400).json({ error: 'All fields required' });
    const exists = await User.findOne({ email });
    if (exists) return res.status(409).json({ error: 'Email already registered' });
    const user = await User.create({ firstName, lastName, email, password, role: role||'student' });
    res.status(201).json({ id: user._id, firstName, lastName, email, role: user.role });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Toggle user active/ban
app.put('/api/admin/users/:id/active', adminRequired, requireDB, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.id, { isActive: req.body.isActive }, { new: true }).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Delete order
app.delete('/api/orders/:id', adminRequired, requireDB, async (req, res) => {
  try {
    await Order.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── AUTH ROUTES ────────────────────────────────────────────────────────────
const authRouter = express.Router();
authRouter.post('/register', requireDB,
  [body('firstName').trim().notEmpty(), body('lastName').trim().notEmpty(),
   body('email').isEmail().normalizeEmail(), body('password').isLength({min:6})],
  async (req, res) => {
    if (!validate(req,res)) return;
    try {
      const { firstName,lastName,email,password,goal } = req.body;
      if (await User.findOne({email})) return res.status(409).json({ error:'Email already registered' });
      const user = await User.create({firstName,lastName,email,password,goal});
      await sendEmail(email,'🎉 Welcome to NextSynergy Tech!',`<h2>Hi ${firstName}!</h2><p>Your account is ready. Start learning today!</p>`);
      res.status(201).json({ token:genToken(user), user:{id:user._id,firstName,lastName,email,role:user.role} });
    } catch(e) { res.status(500).json({error:e.message}); }
  }
);
authRouter.post('/login', requireDB,
  [body('email').isEmail().normalizeEmail(), body('password').notEmpty()],
  async (req,res) => {
    if (!validate(req,res)) return;
    try {
      const {email,password} = req.body;
      const user = await User.findOne({email});
      if (!user) return res.status(401).json({error:'Invalid credentials'});
      if (!(await user.comparePassword(password))) return res.status(401).json({error:'Invalid credentials'});
      if (user.isActive===false) return res.status(403).json({error:'Account suspended. Contact support.'});
      user.lastLogin = new Date(); await user.save();
      res.json({ token:genToken(user), user:{id:user._id,firstName:user.firstName,lastName:user.lastName,email:user.email,role:user.role,enrolledCourses:user.enrolledCourses,streak:user.streak,hoursWatched:user.hoursWatched} });
    } catch(e) { res.status(500).json({error:e.message}); }
  }
);
authRouter.get('/me', authRequired, requireDB, async (req,res) => {
  try {
    const user = await User.findById(req.user.id).select('-password').populate('enrolledCourses','title category thumbnail price isFree');
    if (!user) return res.status(404).json({error:'Not found'});
    res.json(user);
  } catch(e) { res.status(500).json({error:e.message}); }
});
authRouter.put('/profile', authRequired, requireDB, async (req,res) => {
  try {
    const user = await User.findByIdAndUpdate(req.user.id, {firstName:req.body.firstName,lastName:req.body.lastName,email:req.body.email,goal:req.body.goal}, {new:true,runValidators:true}).select('-password');
    res.json(user);
  } catch(e) { res.status(500).json({error:e.message}); }
});
authRouter.put('/change-password', authRequired, requireDB, async (req,res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!(await user.comparePassword(req.body.currentPassword))) return res.status(401).json({error:'Current password incorrect'});
    user.password = req.body.newPassword; await user.save();
    res.json({message:'Password updated'});
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.use('/api/auth', authRouter);

// ── COURSES ROUTES ─────────────────────────────────────────────────────────
const courseRouter = express.Router();
courseRouter.get('/', async (req,res) => {
  try {
    const filter = {published:true};
    if (req.query.category) filter.category=req.query.category;
    if (req.query.free==='true') filter.isFree=true;
    res.json(await Course.find(filter).select('-lessons'));
  } catch(e) { res.status(500).json({error:e.message}); }
});
courseRouter.get('/:id', async (req,res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).json({error:'Not found'});
    res.json(course);
  } catch(e) { res.status(500).json({error:e.message}); }
});
courseRouter.post('/', adminRequired, requireDB, async (req,res) => {
  try { res.status(201).json(await Course.create(req.body)); }
  catch(e) { res.status(500).json({error:e.message}); }
});
courseRouter.put('/:id', adminRequired, requireDB, async (req,res) => {
  try {
    const c = await Course.findByIdAndUpdate(req.params.id,req.body,{new:true,runValidators:true});
    if (!c) return res.status(404).json({error:'Not found'});
    res.json(c);
  } catch(e) { res.status(500).json({error:e.message}); }
});
courseRouter.delete('/:id', adminRequired, requireDB, async (req,res) => {
  try { await Course.findByIdAndDelete(req.params.id); res.json({message:'Deleted'}); }
  catch(e) { res.status(500).json({error:e.message}); }
});
courseRouter.post('/:id/enroll', authRequired, requireDB, async (req,res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).json({error:'Not found'});
    const user = await User.findById(req.user.id);
    if (user.enrolledCourses.map(String).includes(String(course._id))) return res.status(409).json({error:'Already enrolled'});
    user.enrolledCourses.push(course._id); await user.save();
    course.enrolled+=1; await course.save();
    await Progress.create({user:user._id,course:course._id});
    res.json({message:'Enrolled'});
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.use('/api/courses', courseRouter);

// ── TUTORIALS ROUTES ───────────────────────────────────────────────────────
const tutorialRouter = express.Router();
tutorialRouter.get('/', async (req,res) => {
  try { res.json(await Tutorial.find({published:true})); }
  catch(e) { res.status(500).json({error:e.message}); }
});
tutorialRouter.get('/:id', async (req,res) => {
  try {
    const t = await Tutorial.findById(req.params.id);
    if (!t) return res.status(404).json({error:'Not found'});
    t.views+=1; await t.save(); res.json(t);
  } catch(e) { res.status(500).json({error:e.message}); }
});
tutorialRouter.post('/', adminRequired, requireDB, async (req,res) => {
  try { res.status(201).json(await Tutorial.create(req.body)); }
  catch(e) { res.status(500).json({error:e.message}); }
});
tutorialRouter.put('/:id', adminRequired, requireDB, async (req,res) => {
  try { res.json(await Tutorial.findByIdAndUpdate(req.params.id,req.body,{new:true})); }
  catch(e) { res.status(500).json({error:e.message}); }
});
tutorialRouter.delete('/:id', adminRequired, requireDB, async (req,res) => {
  try { await Tutorial.findByIdAndDelete(req.params.id); res.json({message:'Deleted'}); }
  catch(e) { res.status(500).json({error:e.message}); }
});
app.use('/api/tutorials', tutorialRouter);

// ── ORDERS ROUTES ──────────────────────────────────────────────────────────
const orderRouter = express.Router();
orderRouter.post('/', requireDB,
  [body('firstName').trim().notEmpty(), body('lastName').trim().notEmpty(),
   body('email').isEmail().normalizeEmail(), body('packageName').notEmpty(),
   body('description').isLength({min:10})],
  async (req,res) => {
    if (!validate(req,res)) return;
    try {
      const {firstName,lastName,email,phone,packageName,budget,description} = req.body;
      let userId=null;
      const h = req.headers.authorization?.split(' ')[1];
      if (h) try { userId=jwt.verify(h,JWT_SECRET).id; } catch{}
      const order = await Order.create({user:userId,firstName,lastName,email,phone,packageName,budget,description});
      await sendEmail(email,'✅ Order Received — NextSynergy Tech',
        `<h2>Hi ${firstName}!</h2><p>We received your request for <strong>${packageName}</strong>. We'll contact you within 24 hours.</p><p>Order ID: ${order._id}</p>`);
      await sendEmail(process.env.ADMIN_EMAIL||process.env.SMTP_USER,'🚀 New Order: '+packageName,
        `<p><strong>From:</strong> ${firstName} ${lastName} (${email})</p><p><strong>Package:</strong> ${packageName}</p><p><strong>Description:</strong> ${description}</p>`);
      res.status(201).json({message:'Order submitted',orderId:order._id});
    } catch(e) { res.status(500).json({error:e.message}); }
  }
);
orderRouter.get('/mine', authRequired, requireDB, async (req,res) => {
  try { res.json(await Order.find({user:req.user.id}).sort({createdAt:-1})); }
  catch(e) { res.status(500).json({error:e.message}); }
});
orderRouter.get('/', adminRequired, requireDB, async (req,res) => {
  try { res.json(await Order.find().populate('user','firstName lastName email').sort({createdAt:-1})); }
  catch(e) { res.status(500).json({error:e.message}); }
});
orderRouter.put('/:id/status', adminRequired, requireDB, async (req,res) => {
  try {
    const order = await Order.findByIdAndUpdate(req.params.id,{status:req.body.status,adminNotes:req.body.adminNotes},{new:true});
    if (!order) return res.status(404).json({error:'Not found'});
    await sendEmail(order.email,`📦 Order Update — ${req.body.status}`,
      `<h2>Hi ${order.firstName}!</h2><p>Your order for <strong>${order.packageName}</strong> is now: <strong>${req.body.status}</strong>.</p>${req.body.adminNotes?'<p>Note: '+req.body.adminNotes+'</p>':''}`);
    res.json(order);
  } catch(e) { res.status(500).json({error:e.message}); }
});
orderRouter.delete('/:id', adminRequired, requireDB, async (req,res) => {
  try { await Order.findByIdAndDelete(req.params.id); res.json({message:'Deleted'}); }
  catch(e) { res.status(500).json({error:e.message}); }
});
app.use('/api/orders', orderRouter);

// ── ADMIN STATS ────────────────────────────────────────────────────────────
app.get('/api/admin/stats', adminRequired, requireDB, async (req,res) => {
  try {
    const [totalUsers,totalCourses,totalOrders,pendingOrders,totalEnrollments] = await Promise.all([
      User.countDocuments(),
      Course.countDocuments({published:true}),
      Order.countDocuments(),
      Order.countDocuments({status:'pending'}),
      User.aggregate([{$project:{count:{$size:'$enrolledCourses'}}},{$group:{_id:null,total:{$sum:'$count'}}}])
    ]);
    res.json({totalUsers,totalCourses,totalOrders,pendingOrders,totalEnrollments:totalEnrollments[0]?.total||0});
  } catch(e) { res.status(500).json({error:e.message}); }
});
app.get('/api/admin/users', adminRequired, requireDB, async (req,res) => {
  try { res.json(await User.find().select('-password').sort({createdAt:-1})); }
  catch(e) { res.status(500).json({error:e.message}); }
});
app.put('/api/admin/users/:id/role', adminRequired, requireDB, async (req,res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.id,{role:req.body.role},{new:true}).select('-password');
    res.json(user);
  } catch(e) { res.status(500).json({error:e.message}); }
});

// ── CONTACT ────────────────────────────────────────────────────────────────
app.post('/api/contact',
  [body('name').trim().notEmpty(), body('email').isEmail().normalizeEmail(), body('message').isLength({min:10})],
  async (req,res) => {
    if (!validate(req,res)) return;
    const {name,email,message}=req.body;
    await sendEmail(process.env.ADMIN_EMAIL||process.env.SMTP_USER,`📩 Contact from ${name}`,
      `<p><strong>From:</strong> ${name} (${email})</p><p>${message}</p>`);
    res.json({message:'Sent'});
  }
);

// ── API health check ───────────────────────────────────────────────────────
app.get('/api/health', (req,res) => {
  res.json({ status:'ok', db: dbConnected ? 'connected' : 'disconnected', time: new Date().toISOString() });
});

// ── SPA FALLBACK ───────────────────────────────────────────────────────────
app.get('*', (req,res) => {
  const p = path.join(__dirname,'public','index.html');
  if (fs.existsSync(p)) res.sendFile(p);
  else res.json({message:'NextSynergy Tech API ✅', admin:'/admin', health:'/api/health'});
});

// ── ERROR HANDLER ──────────────────────────────────────────────────────────
app.use((err,req,res,_next) => {
  console.error(err);
  res.status(500).json({error:'Internal server error'});
});

app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════════════╗
  ║   NextSynergy Tech Server v2                     ║
  ║   http://localhost:${PORT}                       ║
  ║   Admin Dashboard → http://localhost:${PORT}/admin ║
  ╚══════════════════════════════════════════════════╝
  `);
});

module.exports = app;

/*
─── .env TEMPLATE ─────────────────────────────────────
PORT=5000
MONGO_DB_NAME=seeds
MONGO_URI=mongodb+srv://USERNAME:YOUR_ENCODED_PASSWORD@cluster0.qli7n5o.mongodb.net/seeds?retryWrites=true&w=majority&appName=Cluster0
JWT_SECRET=NST_SuperSecret_JWT_Key_2025_ChangeInProd!
CLIENT_URL=http://localhost:3000
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=eshetuwek1@gmail.com
SMTP_PASS=your_gmail_app_password
ADMIN_EMAIL=eshetuwek1@gmail.com
───────────────────────────────────────────────────────

─── MONGODB NOT CONNECTING? CHECKLIST ─────────────────
1. Atlas → Network Access → Add IP (0.0.0.0/0 for all)
2. Atlas → Database Access → your database user has readWrite permission
3. Password @ chars are encoded as %40 in MONGO_URI
4. Cluster is not paused (free tier auto-pauses)
5. Run: node -e "require('./server')" to see exact error
───────────────────────────────────────────────────────
*/