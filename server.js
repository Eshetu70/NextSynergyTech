/**
 * NextSynergy Tech — server.js
 * Backend for existing public/index.html
 *
 * Main files:
 *   1) public/index.html  (frontend — same visual format)
 *   2) server.js          (backend + MongoDB Atlas + optional seed)
 *
 * Run:
 *   npm install
 *   npm run seed
 *   npm run dev
 */

'use strict';

require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const nodemailer = require('nodemailer');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const { body, validationResult } = require('express-validator');

const app = express();

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'NST_dev_secret_change_in_production';
const MONGO_URI = process.env.MONGO_URI;
const MONGO_DIRECT_URI = process.env.MONGO_DIRECT_URI || '';
const MONGO_DB_NAME = process.env.MONGO_DB_NAME || 'Next_Synergy_Tech';

console.log(`🗄️ MongoDB database target: ${MONGO_DB_NAME}`);

if (!MONGO_URI && !MONGO_DIRECT_URI) {
  console.error('❌ MONGO_URI is missing. Add it to your .env file.');
  console.error('Use SRV:    mongodb+srv://nextsynergy:NextSynergy2026@cluster0.qli7n5o.mongodb.net/Next_Synergy_Tech?retryWrites=true&w=majority&appName=Cluster0');
  console.error('Or DIRECT: mongodb://nextsynergy:NextSynergy2026@ac-6lnk4yh-shard-00-00.qli7n5o.mongodb.net:27017,ac-6lnk4yh-shard-00-01.qli7n5o.mongodb.net:27017,ac-6lnk4yh-shard-00-02.qli7n5o.mongodb.net:27017/Next_Synergy_Tech?tls=true&replicaSet=atlas-riw458-shard-0&authSource=admin&retryWrites=true&w=majority&appName=Cluster0');
  process.exit(1);
}

function maskMongoUri(uri = '') {
  return uri.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:***@');
}

// ─────────────────────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:5000,http://localhost:3000')
  .split(',')
  .map((v) => v.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return callback(null, true);
    // Development friendly. For production, replace this with callback(new Error('Not allowed by CORS')).
    return callback(null, true);
  },
  credentials: true,
}));

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(morgan('dev'));

const publicDir = path.join(__dirname, 'public');
const uploadsDir = path.join(__dirname, 'uploads');

if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

app.use(express.static(publicDir));
app.use('/uploads', express.static(uploadsDir));

// Small cookie parser for admin login, no extra package needed
app.use((req, _res, next) => {
  req.cookies = {};
  const raw = req.headers.cookie || '';
  raw.split(';').forEach((item) => {
    const [key, ...value] = item.trim().split('=');
    if (key) req.cookies[key.trim()] = decodeURIComponent(value.join('='));
  });
  next();
});

// ─────────────────────────────────────────────────────────────
// MongoDB Atlas connection
// Tries MONGO_URI first. If that fails and MONGO_DIRECT_URI exists,
// it tries the direct shard URI. This helps when SRV/TLS has issues.
// ─────────────────────────────────────────────────────────────
let dbConnected = false;
let isConnecting = false;
let retryTimer = null;
let lastDbError = '';
let connectedUsing = '';

const mongoOptions = {
  dbName: MONGO_DB_NAME,
  serverSelectionTimeoutMS: 30000,
  socketTimeoutMS: 45000,
  maxPoolSize: 10,
  heartbeatFrequencyMS: 10000,
};

function scheduleReconnect(delayMs = 10000) {
  if (retryTimer) return;
  console.log(`🔄 Retrying MongoDB connection in ${delayMs / 1000} seconds...`);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    connectDB();
  }, delayMs);
}

async function tryMongoConnection(uri, label) {
  if (!uri) throw new Error(`${label} URI is missing`);

  console.log(`🔌 Trying MongoDB ${label}: ${maskMongoUri(uri)}`);

  await mongoose.connect(uri, mongoOptions);

  dbConnected = true;
  connectedUsing = label;
  lastDbError = '';

  console.log(`✅ MongoDB Atlas connected using ${label} → db: ${mongoose.connection.name}`);
}

async function connectDB() {
  if (isConnecting) return;

  if (mongoose.connection.readyState === 1) {
    dbConnected = true;
    return;
  }

  try {
    isConnecting = true;

    const errors = [];

    if (MONGO_URI) {
      try {
        await tryMongoConnection(MONGO_URI, 'MONGO_URI');
        return;
      } catch (err) {
        errors.push(`MONGO_URI: ${err.message}`);
        console.error('❌ MongoDB MONGO_URI failed:', err.message);
        try { await mongoose.disconnect(); } catch (_) {}
      }
    }

    if (MONGO_DIRECT_URI) {
      try {
        await tryMongoConnection(MONGO_DIRECT_URI, 'MONGO_DIRECT_URI');
        return;
      } catch (err) {
        errors.push(`MONGO_DIRECT_URI: ${err.message}`);
        console.error('❌ MongoDB MONGO_DIRECT_URI failed:', err.message);
        try { await mongoose.disconnect(); } catch (_) {}
      }
    }

    throw new Error(errors.join(' | ') || 'No MongoDB URI available');
  } catch (err) {
    dbConnected = false;
    connectedUsing = '';
    lastDbError = err.message;
    console.error('❌ MongoDB connection failed completely:', err.message);

    const msg = String(err.message || '').toLowerCase();
    if (msg.includes('whitelist') || msg.includes('ip') || msg.includes('server selection')) {
      console.error('👉 Atlas check: Network Access must include 0.0.0.0/0 or your current IP.');
      console.error('👉 Also verify Database Access user/password and cluster status.');
    }
    if (msg.includes('tls') || msg.includes('socket') || msg.includes('srv')) {
      console.error('👉 TLS/SRV issue detected. Use MONGO_DIRECT_URI in .env and test with MongoDB Compass.');
    }

    scheduleReconnect(10000);
  } finally {
    isConnecting = false;
  }
}

mongoose.connection.on('connected', () => {
  dbConnected = true;
  console.log('✅ MongoDB connected event');
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
  lastDbError = err.message;
  console.error('❌ MongoDB error:', err.message);
});

function requireDB(req, res, next) {
  if (!dbConnected || mongoose.connection.readyState !== 1) {
    return res.status(503).json({
      error: 'Database is not connected. Check /api/health for details.',
      db: 'disconnected',
      connectedUsing,
      lastDbError,
    });
  }
  next();
}

// ─────────────────────────────────────────────────────────────
// Schemas and Models
// ─────────────────────────────────────────────────────────────
const lessonSchema = new mongoose.Schema({
  title: { type: String, default: '' },
  videoUrl: { type: String, default: '' },
  duration: { type: String, default: '' },
  isFree: { type: Boolean, default: true },
  order: { type: Number, default: 0 },
});

const courseSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, required: true },
  category: { type: String, required: true, trim: true },
  thumbnail: { type: String, default: '📚' },
  price: { type: Number, default: 0 },
  isFree: { type: Boolean, default: false },
  level: { type: String, default: 'beginner' },
  lessons: [lessonSchema],
  instructor: { type: String, default: 'NextSynergy Team' },
  tags: [{ type: String }],
  enrolled: { type: Number, default: 0 },
  rating: { type: Number, default: 0 },
  published: { type: Boolean, default: true },
}, { timestamps: true });

const tutorialSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  videoId: { type: String, required: true, trim: true },
  thumbnail: { type: String, default: '🎬' },
  duration: { type: String, default: '' },
  topic: { type: String, default: '' },
  isFree: { type: Boolean, default: true },
  lessons: [{ label: String, vid: String }],
  views: { type: Number, default: 0 },
  published: { type: Boolean, default: true },
}, { timestamps: true });

const userSchema = new mongoose.Schema({
  firstName: { type: String, required: true, trim: true },
  lastName: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, minlength: 6 },
  role: { type: String, enum: ['student', 'admin'], default: 'student' },
  isActive: { type: Boolean, default: true },
  goal: { type: String, default: '' },
  enrolledCourses: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Course' }],
  lastLogin: { type: Date },
  streak: { type: Number, default: 0 },
  hoursWatched: { type: Number, default: 0 },
}, { timestamps: true });

userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

const orderSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  firstName: { type: String, required: true, trim: true },
  lastName: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true },
  phone: { type: String, default: '' },
  packageName: { type: String, required: true },
  budget: { type: String, default: '' },
  description: { type: String, required: true },
  status: {
    type: String,
    enum: ['pending', 'in-progress', 'delivered', 'cancelled'],
    default: 'pending',
  },
  paymentStatus: {
    type: String,
    enum: ['unpaid', 'paid', 'refunded'],
    default: 'unpaid',
  },
  paymentAmount: { type: Number, default: 0 },
  paymentDate: { type: Date },
  adminNotes: { type: String, default: '' },
}, { timestamps: true });

const Course = mongoose.model('Course', courseSchema);
const Tutorial = mongoose.model('Tutorial', tutorialSchema);
const User = mongoose.model('User', userSchema);
const Order = mongoose.model('Order', orderSchema);

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function safeUser(user) {
  return {
    id: String(user._id),
    _id: String(user._id),
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    role: user.role,
    goal: user.goal,
    isActive: user.isActive,
    enrolledCourses: user.enrolledCourses || [],
    lastLogin: user.lastLogin,
    streak: user.streak || 0,
    hoursWatched: user.hoursWatched || 0,
    createdAt: user.createdAt,
  };
}

function genToken(user) {
  return jwt.sign(
    { id: user._id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function authRequired(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Login required' });
  }

  try {
    req.user = jwt.verify(header.split(' ')[1], JWT_SECRET);
    next();
  } catch (_err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function adminRequired(req, res, next) {
  authRequired(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  });
}

function adminCookieAuth(req, res, next) {
  const token = req.cookies?.nst_admin || req.headers['x-admin-token'];
  if (!token) return res.redirect('/admin/login');

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') return res.redirect('/admin/login');
    req.admin = decoded;
    next();
  } catch (_err) {
    return res.redirect('/admin/login');
  }
}

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(422).json({ errors: errors.array(), error: errors.array()[0]?.msg || 'Validation failed' });
    return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────
// Email
// ─────────────────────────────────────────────────────────────
const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendEmail(to, subject, html) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS || process.env.SMTP_PASS.includes('your_')) return;

  try {
    await mailer.sendMail({
      from: `"NextSynergy Tech" <${process.env.SMTP_USER}>`,
      to,
      subject,
      html,
    });
  } catch (err) {
    console.warn('Email skipped:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────
// Built-in seed data. No separate seed.js needed.
// ─────────────────────────────────────────────────────────────
const starterCourses = [
  {
    title: 'AI & Machine Learning',
    description: 'Learn Python for AI, TensorFlow, ML algorithms and model deployment. Build real projects from day one.',
    category: 'ai', thumbnail: '🤖', price: 199, isFree: false, level: 'intermediate',
    instructor: 'Eshetu T. Wekjira', tags: ['python','ai','tensorflow','ml'], enrolled: 0, rating: 4.9, published: true,
    lessons: [
      { title: 'Introduction to AI & ML', videoUrl: 'SzMiJFOa6w8', duration: '18 min', isFree: true, order: 1 },
      { title: 'Python for Data Science', videoUrl: 'j5v8D-alAKE', duration: '25 min', isFree: true, order: 2 },
      { title: 'Building Your First ML Model', videoUrl: 'mgxDfCTIgJQ', duration: '40 min', isFree: false, order: 3 },
    ],
  },
  {
    title: 'React + Node Full Stack',
    description: 'Build complete web applications with React, Node.js, Express, and MongoDB from scratch.',
    category: 'web', thumbnail: '⚛️', price: 179, isFree: false, level: 'intermediate',
    instructor: 'Eshetu T. Wekjira', tags: ['react','nodejs','express','mongodb'], enrolled: 0, rating: 4.8, published: true,
    lessons: [
      { title: 'React Fundamentals', videoUrl: 'iwRneX7GIGI', duration: '30 min', isFree: true, order: 1 },
      { title: 'Building a REST API with Node', videoUrl: 'Oe421EPjeBE', duration: '45 min', isFree: false, order: 2 },
    ],
  },
  {
    title: 'Cybersecurity Pro',
    description: 'Network security, ethical hacking, penetration testing, and zero-trust architecture.',
    category: 'security', thumbnail: '🔐', price: 229, isFree: false, level: 'advanced',
    instructor: 'NextSynergy Team', tags: ['cybersecurity','network','security'], enrolled: 0, rating: 4.9, published: true,
    lessons: [
      { title: 'Intro to Cybersecurity', videoUrl: 'kd33UVZhnAA', duration: '20 min', isFree: true, order: 1 },
    ],
  },
  {
    title: 'Java Fundamentals',
    description: 'Core Java programming, OOP, data structures, and enterprise patterns. Beginner-friendly.',
    category: 'web', thumbnail: '☕', price: 0, isFree: true, level: 'beginner',
    instructor: 'Eshetu T. Wekjira', tags: ['java','oop','programming'], enrolled: 0, rating: 4.7, published: true,
    lessons: [
      { title: 'Setting Up Java Environment', videoUrl: 'UQrBgnm8bhU', duration: '15 min', isFree: true, order: 1 },
      { title: 'Java Classes and Objects', videoUrl: 'tTR3Wn5Mbwg', duration: '22 min', isFree: true, order: 2 },
    ],
  },
  {
    title: 'Mobile App Dev with React Native',
    description: 'Build cross-platform iOS & Android apps with React Native, hooks, and Firebase.',
    category: 'mobile', thumbnail: '📱', price: 189, isFree: false, level: 'intermediate',
    instructor: 'NextSynergy Team', tags: ['mobile','react-native','firebase'], enrolled: 0, rating: 4.8, published: true,
    lessons: [
      { title: 'React Native Setup', videoUrl: 'j5v8D-alAKE', duration: '20 min', isFree: true, order: 1 },
      { title: 'Firebase Integration', videoUrl: 'Z9QbYZh1YXY', duration: '40 min', isFree: false, order: 2 },
    ],
  },
  {
    title: 'Cloud Computing with AWS',
    description: 'Deploy scalable infrastructure on AWS, Docker, Kubernetes and master DevOps pipelines.',
    category: 'cloud', thumbnail: '☁️', price: 219, isFree: false, level: 'advanced',
    instructor: 'NextSynergy Team', tags: ['aws','cloud','docker','devops'], enrolled: 0, rating: 4.9, published: true,
    lessons: [
      { title: 'AWS Overview & IAM', videoUrl: 'G5rhGNbrV9I', duration: '25 min', isFree: true, order: 1 },
    ],
  },
];

const starterTutorials = [
  { title: 'Tech Innovations 2025', videoId: 'SzMiJFOa6w8', thumbnail: '🚀', duration: '18 min', topic: 'Emerging Tech', isFree: true, views: 0, published: true, lessons: [{ label: 'Watch Full', vid: 'SzMiJFOa6w8' }] },
  { title: 'Agile Development Masterclass', videoId: 'j5v8D-alAKE', thumbnail: '🔄', duration: '22 min', topic: 'Dev Methods', isFree: true, views: 0, published: true, lessons: [{ label: 'Agile Overview', vid: 'j5v8D-alAKE' }] },
  { title: 'Node.js REST API from Scratch', videoId: 'Oe421EPjeBE', thumbnail: '⚙️', duration: '35 min', topic: 'Backend', isFree: true, views: 0, published: true, lessons: [{ label: 'REST APIs', vid: 'Oe421EPjeBE' }] },
  { title: 'Java OOP Complete Guide', videoId: 'tTR3Wn5Mbwg', thumbnail: '☕', duration: '26 min', topic: 'Java', isFree: true, views: 0, published: true, lessons: [{ label: 'Classes', vid: 'tTR3Wn5Mbwg' }] },
  { title: 'AWS + Cloud Fundamentals', videoId: 'G5rhGNbrV9I', thumbnail: '☁️', duration: '33 min', topic: 'Cloud', isFree: true, views: 0, published: true, lessons: [{ label: 'AWS Basics', vid: 'G5rhGNbrV9I' }] },
];

async function seedDatabase() {
  console.log('🌱 Starting seed from server.js...');

  await connectDB();

  if (!dbConnected || mongoose.connection.readyState !== 1) {
    throw new Error(`Database is not connected. Last error: ${lastDbError}`);
  }

  console.log(`✅ Connected for seed using ${connectedUsing} → db: ${mongoose.connection.name}`);

  await Course.deleteMany({});
  await Tutorial.deleteMany({});

  await Course.insertMany(starterCourses);
  await Tutorial.insertMany(starterTutorials);

  const adminEmail = 'admin@nextsynergytech.com';
  let admin = await User.findOne({ email: adminEmail });

  if (!admin) {
    admin = new User({
      firstName: 'NextSynergy',
      lastName: 'Admin',
      email: adminEmail,
      password: 'Admin@NST2025',
      role: 'admin',
      isActive: true,
    });
    await admin.save();
  } else {
    admin.role = 'admin';
    admin.isActive = true;
    await admin.save();
  }

  console.log('✅ Seed complete');
  console.log('Admin login: admin@nextsynergytech.com');
  console.log('Admin password: Admin@NST2025');

  await mongoose.connection.close();
}

// ─────────────────────────────────────────────────────────────
// API Routes
// ─────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    db: dbConnected && mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    dbName: mongoose.connection.name || MONGO_DB_NAME,
    readyState: mongoose.connection.readyState,
    connectedUsing,
    lastDbError: lastDbError || null,
    hasMongoUri: Boolean(MONGO_URI),
    hasMongoDirectUri: Boolean(MONGO_DIRECT_URI),
    collectionsExpected: ['users', 'courses', 'tutorials', 'orders'],
    time: new Date().toISOString(),
  });
});

app.get('/api/db-info', requireDB, async (_req, res) => {
  const collections = await mongoose.connection.db.listCollections().toArray();
  res.json({
    dbName: mongoose.connection.name,
    connected: true,
    collections: collections.map(c => c.name).sort(),
    expectedCollections: ['users', 'courses', 'tutorials', 'orders'],
  });
});

const auth = express.Router();

auth.post('/register', requireDB,
  body('firstName').trim().notEmpty().withMessage('First name is required'),
  body('lastName').trim().notEmpty().withMessage('Last name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  async (req, res) => {
    if (!validate(req, res)) return;

    try {
      const { firstName, lastName, email, password, goal = '' } = req.body;
      const cleanEmail = email.toLowerCase().trim();

      const existing = await User.findOne({ email: cleanEmail });
      if (existing) return res.status(409).json({ error: 'This email is already registered. Please login.' });

      const user = await User.create({
        firstName,
        lastName,
        email: cleanEmail,
        password,
        goal,
        role: 'student',
        isActive: true,
      });

      res.status(201).json({
        message: 'Account created successfully',
        token: genToken(user),
        user: safeUser(user),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

auth.post('/login', requireDB,
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required'),
  async (req, res) => {
    if (!validate(req, res)) return;

    try {
      const { email, password } = req.body;
      const user = await User.findOne({ email: email.toLowerCase().trim() });

      if (!user) return res.status(401).json({ error: 'Account not found. Please register first.' });
      if (!user.isActive) return res.status(403).json({ error: 'Account is inactive. Contact admin.' });

      const ok = await user.comparePassword(password);
      if (!ok) return res.status(401).json({ error: 'Wrong password.' });

      user.lastLogin = new Date();
      await user.save();

      res.json({
        message: 'Login successful',
        token: genToken(user),
        user: safeUser(user),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// Your index.html expects /api/auth/me to return the user directly.
auth.get('/me', requireDB, authRequired, async (req, res) => {
  const user = await User.findById(req.user.id).populate('enrolledCourses');
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(safeUser(user));
});

auth.put('/profile', requireDB, authRequired,
  body('firstName').optional().trim().notEmpty().withMessage('First name cannot be empty'),
  body('email').optional().isEmail().withMessage('Valid email is required'),
  async (req, res) => {
    if (!validate(req, res)) return;

    try {
      const update = {};
      if (req.body.firstName !== undefined) update.firstName = req.body.firstName;
      if (req.body.lastName !== undefined) update.lastName = req.body.lastName;
      if (req.body.email !== undefined) update.email = req.body.email.toLowerCase().trim();

      const user = await User.findByIdAndUpdate(req.user.id, update, { new: true }).select('-password');
      if (!user) return res.status(404).json({ error: 'User not found' });

      res.json(safeUser(user));
    } catch (err) {
      if (err.code === 11000) return res.status(409).json({ error: 'Email already exists' });
      res.status(500).json({ error: err.message });
    }
  }
);

app.use('/api/auth', auth);

// Courses and tutorials are public so the existing index page can load them.
app.get('/api/courses', requireDB, async (_req, res) => {
  const courses = await Course.find({ published: true }).sort({ createdAt: -1 });
  res.json(courses);
});

app.get('/api/tutorials', requireDB, async (_req, res) => {
  const tutorials = await Tutorial.find({ published: true }).sort({ createdAt: -1 });
  res.json(tutorials);
});

// Customer must login before order. This matches your index.html behavior.
app.post('/api/orders', requireDB, authRequired,
  body('firstName').trim().notEmpty().withMessage('First name is required'),
  body('lastName').trim().notEmpty().withMessage('Last name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('packageName').trim().notEmpty().withMessage('Package/service is required'),
  body('description').trim().isLength({ min: 10 }).withMessage('Project description must be at least 10 characters'),
  async (req, res) => {
    if (!validate(req, res)) return;

    try {
      const order = await Order.create({
        user: req.user.id,
        firstName: req.body.firstName,
        lastName: req.body.lastName,
        email: req.body.email,
        phone: req.body.phone || '',
        packageName: req.body.packageName,
        budget: req.body.budget || '',
        description: req.body.description,
      });

      if (process.env.ADMIN_EMAIL) {
        sendEmail(
          process.env.ADMIN_EMAIL,
          'New NextSynergy Tech Project Request',
          `<h2>New Project Request</h2>
           <p><b>Name:</b> ${order.firstName} ${order.lastName}</p>
           <p><b>Email:</b> ${order.email}</p>
           <p><b>Phone:</b> ${order.phone || '-'}</p>
           <p><b>Package:</b> ${order.packageName}</p>
           <p><b>Budget:</b> ${order.budget || '-'}</p>
           <p><b>Description:</b><br>${order.description}</p>`
        );
      }

      res.status(201).json({ message: 'Project request submitted successfully', order });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// Admin APIs
app.get('/api/orders', requireDB, adminRequired, async (_req, res) => {
  const orders = await Order.find().populate('user', 'firstName lastName email').sort({ createdAt: -1 });
  res.json(orders);
});

app.put('/api/orders/:id/status', requireDB, adminRequired, async (req, res) => {
  const update = {};
  if (req.body.status) update.status = req.body.status;
  if (req.body.adminNotes !== undefined) update.adminNotes = req.body.adminNotes;
  if (req.body.paymentStatus) {
    update.paymentStatus = req.body.paymentStatus;
    if (req.body.paymentStatus === 'paid') update.paymentDate = new Date();
  }
  if (req.body.paymentAmount !== undefined) update.paymentAmount = Number(req.body.paymentAmount) || 0;

  const order = await Order.findByIdAndUpdate(req.params.id, update, { new: true });
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json(order);
});

app.delete('/api/orders/:id', requireDB, adminRequired, async (req, res) => {
  await Order.findByIdAndDelete(req.params.id);
  res.json({ message: 'Order deleted' });
});

app.get('/api/admin/stats', requireDB, adminRequired, async (_req, res) => {
  const [totalUsers, totalOrders, pendingOrders, totalCourses, totalTutorials, paidOrders] = await Promise.all([
    User.countDocuments(),
    Order.countDocuments(),
    Order.countDocuments({ status: 'pending' }),
    Course.countDocuments(),
    Tutorial.countDocuments(),
    Order.countDocuments({ paymentStatus: 'paid' }),
  ]);

  const enrollAgg = await Course.aggregate([{ $group: { _id: null, total: { $sum: '$enrolled' } } }]);

  res.json({
    totalUsers,
    totalOrders,
    pendingOrders,
    totalCourses,
    totalTutorials,
    totalEnrollments: enrollAgg[0]?.total || 0,
    paidOrders,
  });
});

app.get('/api/admin/users', requireDB, adminRequired, async (_req, res) => {
  const users = await User.find().select('-password').sort({ createdAt: -1 });
  res.json(users);
});

app.post('/api/courses', requireDB, adminRequired, async (req, res) => {
  const course = await Course.create(req.body);
  res.status(201).json(course);
});

app.put('/api/courses/:id', requireDB, adminRequired, async (req, res) => {
  const course = await Course.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!course) return res.status(404).json({ error: 'Course not found' });
  res.json(course);
});

app.delete('/api/courses/:id', requireDB, adminRequired, async (req, res) => {
  await Course.findByIdAndDelete(req.params.id);
  res.json({ message: 'Course deleted' });
});

app.post('/api/tutorials', requireDB, adminRequired, async (req, res) => {
  const tutorial = await Tutorial.create(req.body);
  res.status(201).json(tutorial);
});

app.put('/api/tutorials/:id', requireDB, adminRequired, async (req, res) => {
  const tutorial = await Tutorial.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!tutorial) return res.status(404).json({ error: 'Tutorial not found' });
  res.json(tutorial);
});

app.delete('/api/tutorials/:id', requireDB, adminRequired, async (req, res) => {
  await Tutorial.findByIdAndDelete(req.params.id);
  res.json({ message: 'Tutorial deleted' });
});

// ─────────────────────────────────────────────────────────────
// Simple Admin Dashboard
// ─────────────────────────────────────────────────────────────
app.get('/admin/login', (_req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>NextSynergy Admin Login</title>
<style>
body{margin:0;background:#05080f;color:#f0f4ff;font-family:Arial,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{background:#141928;border:1px solid rgba(255,255,255,.1);border-radius:20px;padding:36px;max-width:420px;width:100%}
h1{color:#00e5ff;margin:0 0 8px}.muted{color:#8892aa;margin-bottom:24px}
label{display:block;margin:14px 0 6px;color:#8892aa}input{width:100%;box-sizing:border-box;background:#0f1525;border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:13px;color:#fff}
button{width:100%;border:0;border-radius:10px;background:#00e5ff;color:#000;font-weight:800;padding:14px;margin-top:20px;cursor:pointer}.err{display:none;color:#ff6b6b;background:rgba(255,107,107,.12);border:1px solid rgba(255,107,107,.3);border-radius:10px;padding:12px;margin-top:14px}
</style>
</head>
<body>
<div class="card">
<h1>NextSynergy Tech</h1><div class="muted">Admin Dashboard Login</div>
<label>Email</label><input id="email" type="email" placeholder="admin@nextsynergytech.com">
<label>Password</label><input id="password" type="password" placeholder="Password" onkeydown="if(event.key==='Enter')login()">
<button onclick="login()">Sign In</button><div id="err" class="err"></div>
</div>
<script>
async function login(){
 const err=document.getElementById('err');err.style.display='none';
 try{
  const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email.value,password:password.value})});
  const d=await r.json(); if(!r.ok) throw new Error(d.error||'Login failed');
  if(d.user.role!=='admin') throw new Error('Admin access required');
  document.cookie='nst_admin='+d.token+';path=/;max-age=604800';
  location.href='/admin';
 }catch(e){err.textContent=e.message;err.style.display='block'}
}
</script>
</body></html>`);
});

app.get('/admin/logout', (_req, res) => {
  res.setHeader('Set-Cookie', 'nst_admin=;path=/;max-age=0');
  res.redirect('/admin/login');
});

app.get('/admin', adminCookieAuth, (_req, res) => {
  res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NST Admin</title>
<style>
body{margin:0;background:#05080f;color:#f0f4ff;font-family:Arial,sans-serif}.wrap{max-width:1100px;margin:auto;padding:24px}.top{display:flex;justify-content:space-between;align-items:center}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.card{background:#141928;border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:18px}.num{font-size:30px;font-weight:900;color:#00e5ff}.muted{color:#8892aa}.btn{border:0;border-radius:10px;padding:10px 14px;background:#00e5ff;color:#000;font-weight:800;cursor:pointer}.ghost{background:transparent;color:#f0f4ff;border:1px solid rgba(255,255,255,.15)}table{width:100%;border-collapse:collapse;background:#141928;border-radius:14px;overflow:hidden;margin-top:18px}th,td{padding:12px;border-bottom:1px solid rgba(255,255,255,.1);text-align:left;font-size:13px}th{color:#8892aa;background:#0f1525}.pill{padding:4px 9px;border-radius:999px;background:rgba(0,229,255,.12);color:#00e5ff}
@media(max-width:800px){.grid{grid-template-columns:1fr 1fr}}
</style></head><body><div class="wrap">
<div class="top"><h1>NextSynergy Admin</h1><div><button class="btn ghost" onclick="loadAll()">Refresh</button> <button class="btn" onclick="location.href='/admin/logout'">Logout</button></div></div>
<div class="grid" id="stats"></div><h2>Orders</h2><table><thead><tr><th>Client</th><th>Email</th><th>Package</th><th>Status</th><th>Payment</th><th>Date</th></tr></thead><tbody id="orders"></tbody></table>
<h2>Users</h2><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th></tr></thead><tbody id="users"></tbody></table>
</div><script>
const token=(document.cookie.match(/nst_admin=([^;]+)/)||[])[1]||'';
async function api(p){const r=await fetch('/api'+p,{headers:{Authorization:'Bearer '+token}});const d=await r.json();if(!r.ok)throw new Error(d.error||'Request failed');return d}
async function loadAll(){try{
 const [s,o,u]=await Promise.all([api('/admin/stats'),api('/orders'),api('/admin/users')]);
 stats.innerHTML=[['Users',s.totalUsers],['Orders',s.totalOrders],['Pending',s.pendingOrders],['Courses',s.totalCourses]].map(x=>'<div class="card"><div class="num">'+x[1]+'</div><div class="muted">'+x[0]+'</div></div>').join('');
 orders.innerHTML=o.map(x=>'<tr><td>'+x.firstName+' '+x.lastName+'</td><td>'+x.email+'</td><td>'+x.packageName+'</td><td><span class="pill">'+x.status+'</span></td><td>'+x.paymentStatus+'</td><td>'+new Date(x.createdAt).toLocaleDateString()+'</td></tr>').join('');
 users.innerHTML=u.map(x=>'<tr><td>'+x.firstName+' '+x.lastName+'</td><td>'+x.email+'</td><td>'+x.role+'</td><td>'+new Date(x.createdAt).toLocaleDateString()+'</td></tr>').join('');
}catch(e){alert(e.message)}}loadAll();
</script></body></html>`);
});

// Serve index.html. Static middleware also does this, but this fallback is safe.
app.get('/', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found', path: req.path });
});

app.use((err, _req, res, _next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: err.message || 'Server error' });
});

// ─────────────────────────────────────────────────────────────
// Start / Seed
// ─────────────────────────────────────────────────────────────
async function startServer() {
  await connectDB();

  app.listen(PORT, () => {
    console.log(`🚀 NextSynergy Tech running: http://localhost:${PORT}`);
    console.log(`🔐 Admin dashboard: http://localhost:${PORT}/admin`);
    console.log(`🩺 MongoDB health: http://localhost:${PORT}/api/health`);
  });
}

process.on('SIGINT', async () => {
  try {
    await mongoose.connection.close();
    console.log('\nMongoDB connection closed');
  } finally {
    process.exit(0);
  }
});

if (process.argv.includes('--seed')) {
  seedDatabase()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Seed failed:', err);
      process.exit(1);
    });
} else {
  startServer().catch((err) => {
    console.error('Server failed to start:', err);
    process.exit(1);
  });
}
