/**
 * NextSynergy Tech — server.js
 * Clean fixed version:
 * - MongoDB Atlas + JSON fallback
 * - Register/Login working
 * - Admin dashboard /admin working
 * - Courses, Tutorials, Orders, Owner Posts
 * - 3-click logo can open /admin from index.html
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
const crypto = require('crypto');

const app = express();

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'NST_dev_secret_CHANGE_IN_PRODUCTION';
const MONGO_URI = (process.env.MONGO_URI || '').trim();
const MONGO_DB = (process.env.MONGO_DB_NAME || 'Next_Synergy_Tech').trim();

const publicDir = path.join(__dirname, 'public');
const uploadsDir = path.join(__dirname, 'uploads');
const dataDir = path.join(__dirname, 'data');
const jsonDbPath = path.join(dataDir, 'db.json');

for (const dir of [publicDir, uploadsDir, dataDir]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

console.log('✅ NextSynergy server loaded');
console.log(`🗄️  MongoDB database target: ${MONGO_DB}`);
if (MONGO_URI) {
  console.log(`🔌 Trying MongoDB MONGO_URI: ${MONGO_URI.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:***@')}`);
} else {
  console.warn('⚠️ MONGO_URI not set — JSON fallback only.');
}

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(morgan('dev'));
app.use(express.static(publicDir));
app.use('/uploads', express.static(uploadsDir));

app.use((req, _res, next) => {
  req.cookies = {};
  (req.headers.cookie || '').split(';').forEach((item) => {
    const [k, ...v] = item.trim().split('=');
    if (k) req.cookies[k.trim()] = decodeURIComponent(v.join('='));
  });
  next();
});

app.use('/api', (req, _res, next) => {
  console.log(`➡️ API ${req.method} ${req.originalUrl}`);
  next();
});

app.options('/api/auth/register', (_req, res) => res.sendStatus(204));
app.options('/api/auth/login', (_req, res) => res.sendStatus(204));
app.options('/api/orders', (_req, res) => res.sendStatus(204));

// JSON fallback helpers
const newId = () => crypto.randomBytes(12).toString('hex');
const now = () => new Date().toISOString();

function emptyDb() {
  return { users: [], courses: [], tutorials: [], orders: [], posts: [] };
}

function readDb() {
  if (!fs.existsSync(jsonDbPath)) {
    fs.writeFileSync(jsonDbPath, JSON.stringify(emptyDb(), null, 2));
  }
  try {
    return { ...emptyDb(), ...JSON.parse(fs.readFileSync(jsonDbPath, 'utf8')) };
  } catch {
    const db = emptyDb();
    fs.writeFileSync(jsonDbPath, JSON.stringify(db, null, 2));
    return db;
  }
}

function writeDb(db) {
  fs.writeFileSync(jsonDbPath, JSON.stringify({ ...emptyDb(), ...db }, null, 2));
}

// DB state
let dbMode = 'json-fallback';
let dbConnected = false;
let lastMongoErr = null;
let isConnecting = false;
let retryTimer = null;

// Schemas
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
  tags: [String],
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

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});
userSchema.methods.comparePassword = function(candidate) {
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
  status: { type: String, enum: ['pending', 'in-progress', 'delivered', 'cancelled'], default: 'pending' },
  paymentStatus: { type: String, enum: ['unpaid', 'paid', 'refunded'], default: 'unpaid' },
  paymentAmount: { type: Number, default: 0 },
  paymentDate: { type: Date },
  adminNotes: { type: String, default: '' },
}, { timestamps: true });

const ownerPostSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  category: { type: String, default: 'announcement', trim: true },
  message: { type: String, required: true },
  imageUrl: { type: String, default: '' },
  published: { type: Boolean, default: true },
}, { timestamps: true });

const Course = mongoose.model('Course', courseSchema);
const Tutorial = mongoose.model('Tutorial', tutorialSchema);
const User = mongoose.model('User', userSchema);
const Order = mongoose.model('Order', orderSchema);
const OwnerPost = mongoose.model('OwnerPost', ownerPostSchema);

// Mongo connection
function scheduleRetry(ms = 15000) {
  if (retryTimer) return;
  console.log(`🔄 Retrying MongoDB connection in ${ms / 1000}s...`);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    connectDB();
  }, ms);
}

async function connectDB() {
  if (!MONGO_URI) {
    dbMode = 'json-fallback';
    dbConnected = false;
    return;
  }

  if (isConnecting || mongoose.connection.readyState === 1) return;
  isConnecting = true;

  try {
    await mongoose.connect(MONGO_URI, {
      dbName: MONGO_DB,
      serverSelectionTimeoutMS: 20000,
      connectTimeoutMS: 20000,
      socketTimeoutMS: 45000,
      maxPoolSize: 10,
      heartbeatFrequencyMS: 10000,
      retryWrites: true,
      family: 4,
    });

    dbConnected = true;
    dbMode = 'mongodb-atlas';
    lastMongoErr = null;
    console.log(`✅ MongoDB Atlas connected → db: "${mongoose.connection.name}"`);
  } catch (err) {
    dbConnected = false;
    dbMode = 'json-fallback';
    lastMongoErr = err.message;
    console.error('❌ MongoDB connection failed:', err.message);
    console.log('✅ Continuing with JSON fallback.');
    // Keep retry but never block website
    scheduleRetry(15000);
  } finally {
    isConnecting = false;
  }
}

mongoose.connection.on('connected', () => {
  dbConnected = true;
  dbMode = 'mongodb-atlas';
  console.log('✅ Mongoose: connected');
});
mongoose.connection.on('disconnected', () => {
  dbConnected = false;
  dbMode = 'json-fallback';
  console.warn('⚠️ Mongoose: disconnected');
  scheduleRetry();
});
mongoose.connection.on('error', (e) => {
  dbConnected = false;
  dbMode = 'json-fallback';
  lastMongoErr = e.message;
});

// Helpers
function safeUser(u) {
  return {
    id: String(u._id || u.id),
    _id: String(u._id || u.id),
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    role: u.role || 'student',
    goal: u.goal || '',
    isActive: u.isActive !== false,
    enrolledCourses: u.enrolledCourses || [],
    lastLogin: u.lastLogin || null,
    streak: u.streak || 0,
    hoursWatched: u.hoursWatched || 0,
    createdAt: u.createdAt || null,
  };
}

function genToken(u) {
  return jwt.sign(
    { id: String(u._id || u.id), email: u.email, role: u.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function authRequired(req, res, next) {
  const hdr = req.headers.authorization || '';
  if (!hdr.startsWith('Bearer ')) return res.status(401).json({ error: 'Login required' });
  try {
    req.user = jwt.verify(hdr.slice(7), JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token — please log in again.' });
  }
}

function adminRequired(req, res, next) {
  authRequired(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    return next();
  });
}

function adminCookieAuth(req, res, next) {
  const token = req.cookies?.nst_admin || req.headers['x-admin-token'];
  if (!token) return res.redirect('/admin/login');

  try {
    const d = jwt.verify(token, JWT_SECRET);
    if (d.role !== 'admin') return res.redirect('/admin/login');
    req.admin = d;
    return next();
  } catch {
    return res.redirect('/admin/login');
  }
}

// Email optional
const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

async function sendEmail(to, subject, html) {
  const u = process.env.SMTP_USER || '';
  const p = process.env.SMTP_PASS || '';
  if (!u || !p || p.includes('your_')) return;
  try {
    await mailer.sendMail({ from: `"NextSynergy Tech" <${u}>`, to, subject, html });
  } catch (e) {
    console.warn('Email skipped:', e.message);
  }
}

// Seed
const SEED_COURSES = [
  {
    title: 'AI & Machine Learning',
    category: 'ai',
    thumbnail: '🤖',
    description: 'Learn Python for AI, TensorFlow, ML algorithms and model deployment.',
    price: 199,
    isFree: false,
    level: 'intermediate',
    instructor: 'Eshetu T. Wekjira',
    tags: ['python', 'ai', 'tensorflow', 'ml'],
    rating: 4.9,
    published: true,
    lessons: [
      { title: 'Introduction to AI & ML', videoUrl: 'SzMiJFOa6w8', duration: '18 min', isFree: true, order: 1 },
      { title: 'Python for Data Science', videoUrl: 'j5v8D-alAKE', duration: '25 min', isFree: true, order: 2 },
    ],
  },
  {
    title: 'React + Node Full Stack',
    category: 'web',
    thumbnail: '⚛️',
    description: 'Build complete web applications with React, Node.js, Express, and MongoDB.',
    price: 179,
    isFree: false,
    level: 'intermediate',
    instructor: 'Eshetu T. Wekjira',
    tags: ['react', 'nodejs', 'express', 'mongodb'],
    rating: 4.8,
    published: true,
    lessons: [
      { title: 'React Fundamentals', videoUrl: 'iwRneX7GIGI', duration: '30 min', isFree: true, order: 1 },
      { title: 'REST API with Node', videoUrl: 'Oe421EPjeBE', duration: '45 min', isFree: false, order: 2 },
    ],
  },
  {
    title: 'Java Fundamentals',
    category: 'web',
    thumbnail: '☕',
    description: 'Core Java programming, OOP, data structures, and enterprise patterns.',
    price: 0,
    isFree: true,
    level: 'beginner',
    instructor: 'Eshetu T. Wekjira',
    tags: ['java', 'oop', 'programming'],
    rating: 4.7,
    published: true,
    lessons: [{ title: 'Java Setup', videoUrl: 'UQrBgnm8bhU', duration: '15 min', isFree: true, order: 1 }],
  },
];

const SEED_TUTORIALS = [
  { title: 'Tech Innovations 2025', videoId: 'SzMiJFOa6w8', thumbnail: '🚀', duration: '18 min', topic: 'Emerging Tech', isFree: true, published: true, lessons: [{ label: 'Watch Full', vid: 'SzMiJFOa6w8' }] },
  { title: 'Node.js REST API from Scratch', videoId: 'Oe421EPjeBE', thumbnail: '⚙️', duration: '35 min', topic: 'Backend', isFree: true, published: true, lessons: [{ label: 'REST APIs', vid: 'Oe421EPjeBE' }] },
  { title: 'Java OOP Complete Guide', videoId: 'tTR3Wn5Mbwg', thumbnail: '☕', duration: '26 min', topic: 'Java', isFree: true, published: true, lessons: [{ label: 'Classes', vid: 'tTR3Wn5Mbwg' }] },
];

async function seedDatabase() {
  console.log('\n🌱 Starting seed...');
  await connectDB();

  if (dbMode === 'mongodb-atlas') {
    await Course.deleteMany({});
    await Tutorial.deleteMany({});
    await Course.insertMany(SEED_COURSES);
    await Tutorial.insertMany(SEED_TUTORIALS);

    const adminEmail = 'eshetuwek1@gmail.com';
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
      console.log('✅ Admin user created in Atlas');
    } else {
      admin.role = 'admin';
      admin.isActive = true;
      await admin.save();
      console.log('✅ Admin user updated in Atlas');
    }
  } else {
    const db = emptyDb();
    db.courses = SEED_COURSES.map((c) => ({ ...c, id: newId(), _id: newId(), createdAt: now(), updatedAt: now() }));
    db.tutorials = SEED_TUTORIALS.map((t) => ({ ...t, id: newId(), _id: newId(), createdAt: now(), updatedAt: now() }));

    const id = newId();
    db.users.push({
      id,
      _id: id,
      firstName: 'NextSynergy',
      lastName: 'Admin',
      email: 'eshetuwek1@gmail.com',
      password: await bcrypt.hash('Admin@NST2025', 12),
      role: 'admin',
      isActive: true,
      createdAt: now(),
      updatedAt: now(),
    });

    writeDb(db);
    console.log('✅ JSON fallback seed complete');
  }

  console.log('✅ Seed done');
  console.log('Admin email: eshetuwek1@gmail.com');
  console.log('Admin password: Admin@NST2025\n');
}

// API Routes
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    mode: dbMode,
    db: dbMode === 'mongodb-atlas' ? 'connected' : 'json-fallback',
    dbName: dbMode === 'mongodb-atlas' ? mongoose.connection.name : MONGO_DB,
    mongoReadyState: mongoose.connection.readyState,
    lastMongoError: lastMongoErr,
    localJsonFile: jsonDbPath,
    time: now(),
  });
});

// Auth register
app.post('/api/auth/register', async (req, res) => {
  try {
    console.log('➡️ REGISTER BODY:', req.body);
    const { firstName, lastName, email, password, goal = '' } = req.body || {};

    if (!firstName || !lastName || !email || !password) {
      return res.status(422).json({ error: 'firstName, lastName, email and password are required.' });
    }

    if (String(password).length < 6) {
      return res.status(422).json({ error: 'Password must be at least 6 characters.' });
    }

    const cleanEmail = String(email).toLowerCase().trim();

    if (dbMode === 'mongodb-atlas') {
      if (await User.findOne({ email: cleanEmail })) {
        return res.status(409).json({ error: 'This email is already registered. Please log in.' });
      }

      const user = await User.create({
        firstName: String(firstName).trim(),
        lastName: String(lastName).trim(),
        email: cleanEmail,
        password,
        goal,
        role: 'student',
        isActive: true,
      });

      return res.status(201).json({
        message: 'Account created successfully',
        token: genToken(user),
        user: safeUser(user),
      });
    }

    const db = readDb();
    if (db.users.find((u) => u.email === cleanEmail)) {
      return res.status(409).json({ error: 'This email is already registered. Please log in.' });
    }

    const id = newId();
    const user = {
      id,
      _id: id,
      firstName: String(firstName).trim(),
      lastName: String(lastName).trim(),
      email: cleanEmail,
      password: await bcrypt.hash(password, 12),
      goal,
      role: 'student',
      isActive: true,
      createdAt: now(),
      updatedAt: now(),
    };

    db.users.push(user);
    writeDb(db);

    return res.status(201).json({
      message: 'Account created successfully',
      token: genToken(user),
      user: safeUser(user),
    });
  } catch (err) {
    console.error('Register error:', err);
    if (err.code === 11000) return res.status(409).json({ error: 'Email already registered.' });
    return res.status(500).json({ error: err.message || 'Registration failed.' });
  }
});

// Auth login
app.post('/api/auth/login', async (req, res) => {
  try {
    console.log('➡️ LOGIN BODY:', req.body);
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(422).json({ error: 'Email and password are required.' });
    }

    const cleanEmail = String(email).toLowerCase().trim();

    if (dbMode === 'mongodb-atlas') {
      const user = await User.findOne({ email: cleanEmail });

      if (!user) return res.status(401).json({ error: 'No account found. Please register first.' });
      if (user.isActive === false) return res.status(403).json({ error: 'Account is inactive. Contact support.' });

      const passwordOk = await user.comparePassword(password);
      if (!passwordOk) return res.status(401).json({ error: 'Incorrect password.' });

      user.lastLogin = new Date();
      await user.save();

      return res.json({
        message: 'Login successful',
        token: genToken(user),
        user: safeUser(user),
      });
    }

    const db = readDb();
    const user = db.users.find((u) => u.email === cleanEmail);

    if (!user) return res.status(401).json({ error: 'No account found. Please register first.' });
    if (user.isActive === false) return res.status(403).json({ error: 'Account is inactive. Contact support.' });

    const passwordOk = await bcrypt.compare(password, user.password);
    if (!passwordOk) return res.status(401).json({ error: 'Incorrect password.' });

    user.lastLogin = now();
    writeDb(db);

    return res.json({
      message: 'Login successful',
      token: genToken(user),
      user: safeUser(user),
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: err.message || 'Login failed.' });
  }
});

app.get('/api/auth/me', authRequired, async (req, res) => {
  try {
    if (dbMode === 'mongodb-atlas') {
      const user = await User.findById(req.user.id).populate('enrolledCourses');
      if (!user) return res.status(404).json({ error: 'User not found' });
      return res.json(safeUser(user));
    }

    const db = readDb();
    const user = db.users.find((u) => u.id === req.user.id || u._id === req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json(safeUser(user));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.put('/api/auth/profile', authRequired, async (req, res) => {
  try {
    const update = {};
    if (req.body.firstName !== undefined) update.firstName = String(req.body.firstName).trim();
    if (req.body.lastName !== undefined) update.lastName = String(req.body.lastName).trim();
    if (req.body.email !== undefined) update.email = String(req.body.email).toLowerCase().trim();

    if (dbMode === 'mongodb-atlas') {
      const user = await User.findByIdAndUpdate(req.user.id, update, { new: true }).select('-password');
      if (!user) return res.status(404).json({ error: 'User not found' });
      return res.json(safeUser(user));
    }

    const db = readDb();
    const user = db.users.find((u) => u.id === req.user.id || u._id === req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    Object.assign(user, update);
    user.updatedAt = now();
    writeDb(db);

    return res.json(safeUser(user));
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Email already in use.' });
    return res.status(500).json({ error: err.message });
  }
});

// Public courses/tutorials/posts
app.get('/api/courses', async (_req, res) => {
  try {
    if (dbMode === 'mongodb-atlas') return res.json(await Course.find({ published: true }).sort({ createdAt: -1 }));
    const db = readDb();
    return res.json(db.courses.filter((c) => c.published !== false));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/tutorials', async (_req, res) => {
  try {
    if (dbMode === 'mongodb-atlas') return res.json(await Tutorial.find({ published: true }).sort({ createdAt: -1 }));
    const db = readDb();
    return res.json(db.tutorials.filter((t) => t.published !== false));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/posts', async (_req, res) => {
  try {
    if (dbMode === 'mongodb-atlas') return res.json(await OwnerPost.find({ published: true }).sort({ createdAt: -1 }));
    const db = readDb();
    return res.json((db.posts || []).filter((p) => p.published !== false));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Orders
app.post('/api/orders', authRequired, async (req, res) => {
  try {
    const { firstName, lastName, email, phone = '', packageName, budget = '', description } = req.body || {};

    if (!firstName || !lastName || !email || !packageName || !description) {
      return res.status(422).json({ error: 'firstName, lastName, email, packageName, and description are required.' });
    }

    if (String(description).trim().length < 10) {
      return res.status(422).json({ error: 'Project description must be at least 10 characters.' });
    }

    if (dbMode === 'mongodb-atlas') {
      const order = await Order.create({
        user: req.user.id,
        firstName,
        lastName,
        email,
        phone,
        packageName,
        budget,
        description,
      });

      if (process.env.ADMIN_EMAIL) {
        sendEmail(process.env.ADMIN_EMAIL, 'New Project Request — NextSynergy Tech',
          `<h2>New order from ${firstName} ${lastName}</h2><p><b>Email:</b> ${email}</p><p><b>Package:</b> ${packageName}</p><p><b>Description:</b> ${description}</p>`);
      }

      return res.status(201).json({ message: 'Project request submitted!', order });
    }

    const db = readDb();
    const id = newId();
    const order = {
      id,
      _id: id,
      user: req.user.id,
      firstName,
      lastName,
      email,
      phone,
      packageName,
      budget,
      description,
      status: 'pending',
      paymentStatus: 'unpaid',
      paymentAmount: 0,
      adminNotes: '',
      createdAt: now(),
      updatedAt: now(),
    };

    db.orders.push(order);
    writeDb(db);

    return res.status(201).json({ message: 'Project request submitted!', order });
  } catch (err) {
    console.error('Order error:', err);
    return res.status(500).json({ error: err.message || 'Could not submit order.' });
  }
});

// Admin APIs
app.get('/api/admin/stats', adminRequired, async (_req, res) => {
  try {
    if (dbMode === 'mongodb-atlas') {
      const [totalUsers, totalOrders, pendingOrders, totalCourses, totalTutorials, totalPosts] = await Promise.all([
        User.countDocuments(),
        Order.countDocuments(),
        Order.countDocuments({ status: 'pending' }),
        Course.countDocuments(),
        Tutorial.countDocuments(),
        OwnerPost.countDocuments(),
      ]);

      return res.json({ totalUsers, totalOrders, pendingOrders, totalCourses, totalTutorials, totalPosts, mode: dbMode });
    }

    const db = readDb();
    return res.json({
      totalUsers: db.users.length,
      totalOrders: db.orders.length,
      pendingOrders: db.orders.filter((o) => o.status === 'pending').length,
      totalCourses: db.courses.length,
      totalTutorials: db.tutorials.length,
      totalPosts: (db.posts || []).length,
      mode: dbMode,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/users', adminRequired, async (_req, res) => {
  try {
    if (dbMode === 'mongodb-atlas') {
      const users = await User.find().select('-password').sort({ createdAt: -1 });
      return res.json(users.map(safeUser));
    }

    const db = readDb();
    return res.json(db.users.map(safeUser));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

async function getOrders(_req, res) {
  try {
    if (dbMode === 'mongodb-atlas') return res.json(await Order.find().sort({ createdAt: -1 }));
    const db = readDb();
    return res.json([...db.orders].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

app.get('/api/admin/orders', adminRequired, getOrders);
app.get('/api/orders', adminRequired, getOrders);

async function updateOrderStatus(req, res) {
  try {
    const update = {};
    ['status', 'adminNotes', 'paymentStatus'].forEach((k) => {
      if (req.body[k] !== undefined) update[k] = req.body[k];
    });

    if (req.body.paymentAmount !== undefined) update.paymentAmount = Number(req.body.paymentAmount) || 0;
    if (req.body.paymentStatus === 'paid') update.paymentDate = dbMode === 'mongodb-atlas' ? new Date() : now();

    if (dbMode === 'mongodb-atlas') {
      const order = await Order.findByIdAndUpdate(req.params.id, update, { new: true });
      if (!order) return res.status(404).json({ error: 'Order not found' });
      return res.json(order);
    }

    const db = readDb();
    const order = db.orders.find((o) => o.id === req.params.id || o._id === req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    Object.assign(order, update, { updatedAt: now() });
    writeDb(db);

    return res.json(order);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

app.put('/api/admin/orders/:id/status', adminRequired, updateOrderStatus);
app.put('/api/orders/:id/status', adminRequired, updateOrderStatus);

async function deleteOrder(req, res) {
  try {
    if (dbMode === 'mongodb-atlas') {
      await Order.findByIdAndDelete(req.params.id);
      return res.json({ message: 'Order deleted' });
    }

    const db = readDb();
    db.orders = db.orders.filter((o) => o.id !== req.params.id && o._id !== req.params.id);
    writeDb(db);

    return res.json({ message: 'Order deleted' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

app.delete('/api/admin/orders/:id', adminRequired, deleteOrder);
app.delete('/api/orders/:id', adminRequired, deleteOrder);

// Courses admin
async function createCourse(req, res) {
  try {
    const body = req.body || {};
    if (!body.title) return res.status(422).json({ error: 'Course title is required.' });

    const payload = {
      title: body.title,
      description: body.description || 'Course description',
      category: body.category || 'web',
      thumbnail: body.thumbnail || '📚',
      price: Number(body.price || 0),
      isFree: body.isFree !== undefined ? !!body.isFree : Number(body.price || 0) === 0,
      level: body.level || 'beginner',
      lessons: Array.isArray(body.lessons) ? body.lessons : [],
      instructor: body.instructor || 'NextSynergy Team',
      tags: Array.isArray(body.tags) ? body.tags : [],
      published: body.published !== false,
    };

    if (dbMode === 'mongodb-atlas') return res.status(201).json(await Course.create(payload));

    const db = readDb();
    const id = newId();
    const course = { id, _id: id, ...payload, createdAt: now(), updatedAt: now() };
    db.courses.push(course);
    writeDb(db);

    return res.status(201).json(course);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function updateCourse(req, res) {
  try {
    if (dbMode === 'mongodb-atlas') {
      const course = await Course.findByIdAndUpdate(req.params.id, req.body, { new: true });
      if (!course) return res.status(404).json({ error: 'Course not found' });
      return res.json(course);
    }

    const db = readDb();
    const course = db.courses.find((c) => c.id === req.params.id || c._id === req.params.id);
    if (!course) return res.status(404).json({ error: 'Course not found' });

    Object.assign(course, req.body, { updatedAt: now() });
    writeDb(db);

    return res.json(course);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function deleteCourse(req, res) {
  try {
    if (dbMode === 'mongodb-atlas') {
      await Course.findByIdAndDelete(req.params.id);
      return res.json({ message: 'Course deleted' });
    }

    const db = readDb();
    db.courses = db.courses.filter((c) => c.id !== req.params.id && c._id !== req.params.id);
    writeDb(db);

    return res.json({ message: 'Course deleted' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

app.post('/api/admin/courses', adminRequired, createCourse);
app.put('/api/admin/courses/:id', adminRequired, updateCourse);
app.delete('/api/admin/courses/:id', adminRequired, deleteCourse);

// Tutorials admin
async function createTutorial(req, res) {
  try {
    const body = req.body || {};
    if (!body.title || !body.videoId) return res.status(422).json({ error: 'Tutorial title and videoId are required.' });

    const payload = {
      title: body.title,
      videoId: body.videoId,
      thumbnail: body.thumbnail || '🎬',
      duration: body.duration || '',
      topic: body.topic || 'Tech',
      isFree: body.isFree !== false,
      lessons: Array.isArray(body.lessons) ? body.lessons : [{ label: 'Watch Full', vid: body.videoId }],
      published: body.published !== false,
    };

    if (dbMode === 'mongodb-atlas') return res.status(201).json(await Tutorial.create(payload));

    const db = readDb();
    const id = newId();
    const tutorial = { id, _id: id, ...payload, createdAt: now(), updatedAt: now() };
    db.tutorials.push(tutorial);
    writeDb(db);

    return res.status(201).json(tutorial);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function updateTutorial(req, res) {
  try {
    if (dbMode === 'mongodb-atlas') {
      const tutorial = await Tutorial.findByIdAndUpdate(req.params.id, req.body, { new: true });
      if (!tutorial) return res.status(404).json({ error: 'Tutorial not found' });
      return res.json(tutorial);
    }

    const db = readDb();
    const tutorial = db.tutorials.find((t) => t.id === req.params.id || t._id === req.params.id);
    if (!tutorial) return res.status(404).json({ error: 'Tutorial not found' });

    Object.assign(tutorial, req.body, { updatedAt: now() });
    writeDb(db);

    return res.json(tutorial);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function deleteTutorial(req, res) {
  try {
    if (dbMode === 'mongodb-atlas') {
      await Tutorial.findByIdAndDelete(req.params.id);
      return res.json({ message: 'Tutorial deleted' });
    }

    const db = readDb();
    db.tutorials = db.tutorials.filter((t) => t.id !== req.params.id && t._id !== req.params.id);
    writeDb(db);

    return res.json({ message: 'Tutorial deleted' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

app.post('/api/admin/tutorials', adminRequired, createTutorial);
app.put('/api/admin/tutorials/:id', adminRequired, updateTutorial);
app.delete('/api/admin/tutorials/:id', adminRequired, deleteTutorial);

// Owner posts admin
app.get('/api/admin/posts', adminRequired, async (_req, res) => {
  try {
    if (dbMode === 'mongodb-atlas') return res.json(await OwnerPost.find().sort({ createdAt: -1 }));
    const db = readDb();
    return res.json(db.posts || []);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/posts', adminRequired, async (req, res) => {
  try {
    const { title, category = 'announcement', message, imageUrl = '', published = true } = req.body || {};
    if (!title || !message) return res.status(422).json({ error: 'Title and message are required.' });

    if (dbMode === 'mongodb-atlas') {
      const post = await OwnerPost.create({ title, category, message, imageUrl, published });
      return res.status(201).json(post);
    }

    const db = readDb();
    const id = newId();
    const post = { id, _id: id, title, category, message, imageUrl, published, createdAt: now(), updatedAt: now() };
    db.posts.unshift(post);
    writeDb(db);

    return res.status(201).json(post);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/posts/:id', adminRequired, async (req, res) => {
  try {
    const update = {};
    ['title', 'category', 'message', 'imageUrl', 'published'].forEach((k) => {
      if (req.body[k] !== undefined) update[k] = req.body[k];
    });

    if (dbMode === 'mongodb-atlas') {
      const post = await OwnerPost.findByIdAndUpdate(req.params.id, update, { new: true });
      if (!post) return res.status(404).json({ error: 'Post not found' });
      return res.json(post);
    }

    const db = readDb();
    const post = (db.posts || []).find((p) => p.id === req.params.id || p._id === req.params.id);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    Object.assign(post, update, { updatedAt: now() });
    writeDb(db);

    return res.json(post);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/posts/:id', adminRequired, async (req, res) => {
  try {
    if (dbMode === 'mongodb-atlas') {
      await OwnerPost.findByIdAndDelete(req.params.id);
      return res.json({ message: 'Post deleted' });
    }

    const db = readDb();
    db.posts = (db.posts || []).filter((p) => p.id !== req.params.id && p._id !== req.params.id);
    writeDb(db);

    return res.json({ message: 'Post deleted' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Admin pages
app.get('/admin-test', (_req, res) => {
  res.send('<h1 style="font-family:Arial;color:#00e5ff;background:#05080f;padding:40px">✅ Admin test route is working</h1><p style="font-family:Arial;padding:20px">Now open <a href="/admin">/admin</a>.</p>');
});

app.get('/admin/login', (_req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NST Admin Login</title>
<style>
body{margin:0;background:#05080f;color:#f0f4ff;font-family:Arial,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:20px}
.card{background:#141928;border:1px solid rgba(255,255,255,.12);border-radius:20px;padding:36px;width:min(420px,100%)}
h1{color:#00e5ff;margin:0 0 6px}.sub{color:#8892aa;margin-bottom:22px;font-size:14px}
label{display:block;font-size:13px;color:#8892aa;margin:14px 0 5px}
input{width:100%;box-sizing:border-box;padding:13px;background:#0f1525;border:1px solid rgba(255,255,255,.12);border-radius:10px;color:#fff;font-size:14px}
input:focus{outline:none;border-color:#00e5ff}
button{width:100%;margin-top:20px;padding:14px;background:#00e5ff;color:#000;border:0;border-radius:10px;font-weight:800;font-size:15px;cursor:pointer}
.err{color:#ff6b6b;background:rgba(255,107,107,.1);border:1px solid rgba(255,107,107,.25);border-radius:10px;padding:12px;margin-top:12px;font-size:13px;display:none}
</style>
</head>
<body>
<div class="card">
  <h1>NextSynergy Tech</h1>
  <div class="sub">Admin Dashboard Login</div>
  <label>Email</label><input id="email" type="email" value="admin@nextsynergytech.com">
  <label>Password</label><input id="password" type="password" value="Admin@NST2025" onkeydown="if(event.key==='Enter')login()">
  <button onclick="login()">Sign In →</button>
  <div id="err" class="err"></div>
</div>
<script>
async function login(){
  var err=document.getElementById('err');
  err.style.display='none';
  var email=document.getElementById('email').value.trim();
  var password=document.getElementById('password').value;
  if(!email||!password){err.textContent='Enter email and password.';err.style.display='block';return;}
  try{
    var r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email,password:password})});
    var d=await r.json();
    if(!r.ok) throw new Error(d.error||'Login failed');
    if(!d.user||d.user.role!=='admin') throw new Error('Admin access required. Use admin account.');
    document.cookie='nst_admin='+d.token+';path=/;max-age=604800';
    location.href='/admin';
  }catch(e){
    err.textContent=e.message;
    err.style.display='block';
  }
}
</script>
</body>
</html>`);
});

app.get('/admin/logout', (_req, res) => {
  res.setHeader('Set-Cookie', 'nst_admin=;path=/;max-age=0');
  res.redirect('/admin/login');
});

app.get('/admin', adminCookieAuth, (_req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NextSynergy Admin Dashboard</title>
<style>
:root{--bg:#05080f;--surface:#141928;--border:rgba(255,255,255,.13);--cyan:#00e5ff;--red:#ff6b6b;--text:#f0f4ff;--muted:#8892aa}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:Arial,sans-serif;padding:24px}
h1{color:var(--cyan);margin:0 0 6px}.sub{color:var(--muted);margin:0 0 20px}.top{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap}
.btn,button,a.btn{background:var(--cyan);color:#000;border:0;border-radius:10px;padding:10px 14px;font-weight:800;cursor:pointer;text-decoration:none;display:inline-block;margin:4px}
.ghost{background:rgba(255,255,255,.08)!important;color:var(--text)!important;border:1px solid var(--border)!important}
.danger{background:rgba(255,107,107,.18)!important;color:var(--red)!important;border:1px solid rgba(255,107,107,.35)!important}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:20px 0}
.stat,.card{background:var(--surface);border:1px solid var(--border);border-radius:18px;padding:18px}.num{font-size:32px;font-weight:900;color:var(--cyan)}.label{font-size:13px;color:var(--muted)}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.card{margin-bottom:16px;overflow:auto}
table{width:100%;border-collapse:collapse;min-width:620px}th,td{padding:10px;border-bottom:1px solid rgba(255,255,255,.1);text-align:left;font-size:14px;vertical-align:top}th{color:var(--muted);font-size:12px;text-transform:uppercase}
input,textarea,select{width:100%;padding:11px;border-radius:10px;border:1px solid var(--border);background:#0f1525;color:#fff;margin:6px 0}textarea{min-height:80px}
.err{display:none;color:var(--red);background:rgba(255,107,107,.1);border:1px solid rgba(255,107,107,.25);border-radius:10px;padding:12px;margin:12px 0}
@media(max-width:800px){.grid{grid-template-columns:1fr}body{padding:14px}}
</style>
</head>
<body>
<div class="top">
  <div>
    <h1>NextSynergy Tech Admin</h1>
    <p class="sub">Users, orders, courses, tutorials, and owner posts.</p>
  </div>
  <div>
    <a class="btn ghost" href="/">Website</a>
    <a class="btn ghost" href="/api/health">Health</a>
    <button onclick="loadAll()">Refresh</button>
    <a class="btn danger" href="/admin/logout">Logout</a>
  </div>
</div>

<div id="error" class="err"></div>

<div class="stats">
  <div class="stat"><div class="num" id="usersCount">0</div><div class="label">Users</div></div>
  <div class="stat"><div class="num" id="ordersCount">0</div><div class="label">Orders</div></div>
  <div class="stat"><div class="num" id="coursesCount">0</div><div class="label">Courses</div></div>
  <div class="stat"><div class="num" id="tutorialsCount">0</div><div class="label">Tutorials</div></div>
  <div class="stat"><div class="num" id="postsCount">0</div><div class="label">Owner Posts</div></div>
</div>

<div class="grid">
  <div class="card">
    <h2>Add Course</h2>
    <input id="courseTitle" placeholder="Course title">
    <textarea id="courseDesc" placeholder="Description"></textarea>
    <input id="courseCat" placeholder="Category e.g. web, ai, mobile">
    <input id="coursePrice" type="number" placeholder="Price">
    <input id="courseIcon" placeholder="Icon" value="📚">
    <button onclick="addCourse()">Save Course</button>
  </div>

  <div class="card">
    <h2>Add Tutorial</h2>
    <input id="tutTitle" placeholder="Tutorial title">
    <input id="tutVideo" placeholder="YouTube Video ID">
    <input id="tutTopic" placeholder="Topic">
    <input id="tutIcon" placeholder="Icon" value="🎬">
    <button onclick="addTutorial()">Save Tutorial</button>
  </div>
</div>

<div class="card">
  <h2>Owner Posts</h2>
  <div class="grid">
    <div>
      <input id="postTitle" placeholder="Post title">
      <input id="postCategory" placeholder="Category" value="announcement">
      <textarea id="postMessage" placeholder="Owner message"></textarea>
      <input id="postImage" placeholder="Image URL optional">
      <button onclick="addPost()">Add Owner Post</button>
    </div>
    <div><p class="sub">Public posts are available at /api/posts.</p></div>
  </div>
  <table><thead><tr><th>Title</th><th>Category</th><th>Message</th><th>Action</th></tr></thead><tbody id="postsBody"></tbody></table>
</div>

<div class="card"><h2>Users</h2><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th></tr></thead><tbody id="usersBody"></tbody></table></div>
<div class="card"><h2>Orders</h2><table><thead><tr><th>Name</th><th>Email</th><th>Package</th><th>Status</th></tr></thead><tbody id="ordersBody"></tbody></table></div>
<div class="card"><h2>Courses</h2><table><thead><tr><th>Title</th><th>Category</th><th>Price</th><th>Action</th></tr></thead><tbody id="coursesBody"></tbody></table></div>
<div class="card"><h2>Tutorials</h2><table><thead><tr><th>Title</th><th>Topic</th><th>Video ID</th><th>Action</th></tr></thead><tbody id="tutorialsBody"></tbody></table></div>

<script>
var token=(document.cookie.match(/nst_admin=([^;]+)/)||[])[1]||'';

function esc(v){
  return String(v||'').replace(/[&<>"']/g,function(m){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m];
  });
}

async function api(url,method,body){
  var opt={method:method||'GET',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token}};
  if(body) opt.body=JSON.stringify(body);
  var r=await fetch(url,opt);
  var d=await r.json().catch(function(){return {};});
  if(!r.ok) throw new Error(d.error||('Request failed '+r.status));
  return d;
}

function showErr(e){
  var b=document.getElementById('error');
  b.textContent=e.message||e;
  b.style.display='block';
}

function row(html,col){
  return html || ('<tr><td colspan="'+col+'">No data found</td></tr>');
}

async function loadAll(){
  try{
    document.getElementById('error').style.display='none';

    var results=await Promise.all([
      api('/api/admin/users'),
      api('/api/admin/orders'),
      api('/api/courses'),
      api('/api/tutorials'),
      api('/api/admin/posts')
    ]);

    var users=results[0]||[];
    var orders=results[1]||[];
    var courses=results[2]||[];
    var tutorials=results[3]||[];
    var posts=results[4]||[];

    document.getElementById('usersCount').textContent=users.length;
    document.getElementById('ordersCount').textContent=orders.length;
    document.getElementById('coursesCount').textContent=courses.length;
    document.getElementById('tutorialsCount').textContent=tutorials.length;
    document.getElementById('postsCount').textContent=posts.length;

    document.getElementById('usersBody').innerHTML=row(users.map(function(u){
      return '<tr><td>'+esc((u.firstName||'')+' '+(u.lastName||''))+'</td><td>'+esc(u.email)+'</td><td>'+esc(u.role||'student')+'</td><td>'+(u.createdAt?new Date(u.createdAt).toLocaleDateString():'-')+'</td></tr>';
    }).join(''),4);

    document.getElementById('ordersBody').innerHTML=row(orders.map(function(o){
      return '<tr><td>'+esc((o.firstName||'')+' '+(o.lastName||''))+'</td><td>'+esc(o.email)+'</td><td>'+esc(o.packageName)+'</td><td>'+esc(o.status||'pending')+'</td></tr>';
    }).join(''),4);

    document.getElementById('coursesBody').innerHTML=row(courses.map(function(c){
      var id=c._id||c.id;
      return '<tr><td>'+esc(c.title)+'</td><td>'+esc(c.category)+'</td><td>'+(c.isFree?'Free':'$'+(c.price||0))+'</td><td><button class="danger" onclick="delCourse(\\''+id+'\\')">Delete</button></td></tr>';
    }).join(''),4);

    document.getElementById('tutorialsBody').innerHTML=row(tutorials.map(function(t){
      var id=t._id||t.id;
      return '<tr><td>'+esc(t.title)+'</td><td>'+esc(t.topic)+'</td><td>'+esc(t.videoId)+'</td><td><button class="danger" onclick="delTutorial(\\''+id+'\\')">Delete</button></td></tr>';
    }).join(''),4);

    document.getElementById('postsBody').innerHTML=row(posts.map(function(p){
      var id=p._id||p.id;
      return '<tr><td>'+esc(p.title)+'</td><td>'+esc(p.category)+'</td><td>'+esc(p.message)+'</td><td><button class="danger" onclick="delPost(\\''+id+'\\')">Delete</button></td></tr>';
    }).join(''),4);

  }catch(e){
    showErr(e);
  }
}

async function addCourse(){
  try{
    var title=document.getElementById('courseTitle').value.trim();
    if(!title) return alert('Course title required');

    var price=Number(document.getElementById('coursePrice').value)||0;
    await api('/api/admin/courses','POST',{
      title:title,
      description:document.getElementById('courseDesc').value||'Course description',
      category:document.getElementById('courseCat').value||'web',
      price:price,
      isFree:price===0,
      thumbnail:document.getElementById('courseIcon').value||'📚',
      published:true
    });
    loadAll();
  }catch(e){showErr(e);}
}

async function addTutorial(){
  try{
    var title=document.getElementById('tutTitle').value.trim();
    var videoId=document.getElementById('tutVideo').value.trim();
    if(!title||!videoId) return alert('Title and Video ID required');

    await api('/api/admin/tutorials','POST',{
      title:title,
      videoId:videoId,
      topic:document.getElementById('tutTopic').value||'Tech',
      thumbnail:document.getElementById('tutIcon').value||'🎬',
      published:true,
      isFree:true
    });
    loadAll();
  }catch(e){showErr(e);}
}

async function addPost(){
  try{
    var title=document.getElementById('postTitle').value.trim();
    var message=document.getElementById('postMessage').value.trim();
    if(!title||!message) return alert('Post title and message required');

    await api('/api/admin/posts','POST',{
      title:title,
      category:document.getElementById('postCategory').value||'announcement',
      message:message,
      imageUrl:document.getElementById('postImage').value||'',
      published:true
    });

    document.getElementById('postTitle').value='';
    document.getElementById('postMessage').value='';
    document.getElementById('postImage').value='';
    loadAll();
  }catch(e){showErr(e);}
}

async function delCourse(id){
  if(confirm('Delete course?')){
    await api('/api/admin/courses/'+id,'DELETE');
    loadAll();
  }
}

async function delTutorial(id){
  if(confirm('Delete tutorial?')){
    await api('/api/admin/tutorials/'+id,'DELETE');
    loadAll();
  }
}

async function delPost(id){
  if(confirm('Delete post?')){
    await api('/api/admin/posts/'+id,'DELETE');
    loadAll();
  }
}

loadAll();
</script>
</body>
</html>`);
});

// Frontend root
app.get('/', (_req, res) => {
  const p = path.join(publicDir, 'index.html');
  if (fs.existsSync(p)) return res.sendFile(p);
  return res.send('<h1>NextSynergy Tech — Server Running</h1><p>Place index.html inside the public folder.</p>');
});

// 404 and error handler
app.use((req, res) => res.status(404).json({ error: 'Route not found', path: req.path }));

app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// Boot
async function start() {
  await connectDB();

  app.listen(PORT, () => {
    console.log(`\n🚀 NextSynergy Tech: http://localhost:${PORT}`);
    console.log(`🔐 Admin login:      http://localhost:${PORT}/admin/login`);
    console.log(`🔐 Admin dashboard:  http://localhost:${PORT}/admin`);
    console.log(`🧪 Admin test:       http://localhost:${PORT}/admin-test`);
    console.log(`🩺 Health check:     http://localhost:${PORT}/api/health`);
    console.log(`💾 Database mode:    ${dbMode}\n`);
  });
}

process.on('SIGINT', async () => {
  try { await mongoose.connection.close(); } catch {}
  console.log('\nMongoDB closed. Goodbye.');
  process.exit(0);
});

if (process.argv.includes('--seed')) {
  seedDatabase()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Seed failed:', err.message);
      process.exit(1);
    });
} else {
  start().catch((err) => {
    console.error('Server failed:', err.message);
    process.exit(1);
  });
}
