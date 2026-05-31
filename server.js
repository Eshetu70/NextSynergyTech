/**
 * NextSynergy Tech — server.js
 * Full Express.js backend for the learning & services platform.
 *
 * Stack:
 *   - Express.js         → HTTP server & routing
 *   - bcryptjs           → Password hashing
 *   - jsonwebtoken       → JWT auth tokens
 *   - mongoose           → MongoDB ODM
 *   - multer             → File/video uploads
 *   - cors               → Cross-origin requests
 *   - express-validator  → Input validation
 *   - dotenv             → Environment variables
 *   - nodemailer         → Order & welcome emails
 *
 * Install:
 *   npm install express mongoose bcryptjs jsonwebtoken cors
 *               multer express-validator nodemailer dotenv morgan
 *
 * Run:
 *   node server.js         (or: npx nodemon server.js for dev)
 *
 * .env file needed — see bottom of this file for template.
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

// ─────────────────────────────────────────────
//  MIDDLEWARE
// ─────────────────────────────────────────────

app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// Serve the frontend HTML file and uploaded assets
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ─────────────────────────────────────────────
//  DATABASE CONNECTION
// ─────────────────────────────────────────────

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('❌  MONGO_URI is not set in .env — cannot start server.');
  process.exit(1);
}

mongoose
  .connect(MONGO_URI, {
    useNewUrlParser:    true,
    useUnifiedTopology: true,
    dbName: 'seeds',          // ← your database name
  })
  .then(() => console.log('✅  MongoDB Atlas connected  →  db: seeds'))
  .catch(err => {
    console.error('❌  MongoDB connection error:', err.message);
    process.exit(1);
  });

// ─────────────────────────────────────────────
//  MONGOOSE SCHEMAS & MODELS
// ─────────────────────────────────────────────

/* ---- USER ---- */
const userSchema = new mongoose.Schema(
  {
    firstName:    { type: String, required: true, trim: true },
    lastName:     { type: String, required: true, trim: true },
    email:        { type: String, required: true, unique: true, lowercase: true, trim: true },
    password:     { type: String, required: true, minlength: 6 },
    role:         { type: String, enum: ['student', 'admin'], default: 'student' },
    goal:         { type: String, default: '' },
    avatar:       { type: String, default: '' },
    enrolledCourses: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Course' }],
    watchedVideos:   [{ type: String }],         // video IDs
    streak:          { type: Number, default: 0 },
    hoursWatched:    { type: Number, default: 0 },
    lastLogin:       { type: Date },
  },
  { timestamps: true }
);
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});
userSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};
const User = mongoose.model('User', userSchema);

/* ---- COURSE ---- */
const lessonSchema = new mongoose.Schema({
  title:       { type: String, required: true },
  videoUrl:    { type: String, required: true },  // YouTube ID or hosted path
  duration:    { type: String, default: '' },
  isFree:      { type: Boolean, default: false },
  order:       { type: Number, default: 0 },
});
const courseSchema = new mongoose.Schema(
  {
    title:       { type: String, required: true, trim: true },
    description: { type: String, required: true },
    category:    { type: String, enum: ['web','mobile','ai','security','cloud','java','design','database'], required: true },
    thumbnail:   { type: String, default: '' },   // emoji or image path
    price:       { type: Number, default: 0 },    // 0 = free
    isFree:      { type: Boolean, default: false },
    level:       { type: String, enum: ['beginner','intermediate','advanced'], default: 'beginner' },
    lessons:     [lessonSchema],
    instructor:  { type: String, default: 'NextSynergy Team' },
    tags:        [String],
    enrolled:    { type: Number, default: 0 },
    rating:      { type: Number, default: 0 },
    published:   { type: Boolean, default: true },
  },
  { timestamps: true }
);
const Course = mongoose.model('Course', courseSchema);

/* ---- PROGRESS ---- */
const progressSchema = new mongoose.Schema(
  {
    user:            { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    course:          { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
    completedLessons:[{ type: mongoose.Schema.Types.ObjectId }],
    percentComplete: { type: Number, default: 0 },
    lastLesson:      { type: mongoose.Schema.Types.ObjectId },
  },
  { timestamps: true }
);
const Progress = mongoose.model('Progress', progressSchema);

/* ---- ORDER ---- */
const orderSchema = new mongoose.Schema(
  {
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
  },
  { timestamps: true }
);
const Order = mongoose.model('Order', orderSchema);

/* ---- TUTORIAL ---- */
const tutorialSchema = new mongoose.Schema(
  {
    title:       { type: String, required: true },
    videoId:     { type: String, required: true },  // YouTube ID
    thumbnail:   { type: String, default: '🎬' },
    duration:    { type: String, default: '' },
    topic:       { type: String, default: '' },
    isFree:      { type: Boolean, default: true },
    lessons:     [{ label: String, vid: String }],
    views:       { type: Number, default: 0 },
    published:   { type: Boolean, default: true },
  },
  { timestamps: true }
);
const Tutorial = mongoose.model('Tutorial', tutorialSchema);

// ─────────────────────────────────────────────
//  FILE UPLOAD (multer)
// ─────────────────────────────────────────────

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'uploads', req.uploadFolder || 'misc');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext  = path.extname(file.originalname);
    const name = `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
    cb(null, name);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|mp4|mov|pdf/;
    cb(null, allowed.test(path.extname(file.originalname).toLowerCase()));
  },
});

// ─────────────────────────────────────────────
//  EMAIL HELPER (nodemailer)
// ─────────────────────────────────────────────

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST   || 'smtp.gmail.com',
  port:   Number(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
});

async function sendEmail(to, subject, html) {
  if (!process.env.SMTP_USER) return;   // skip if email not configured
  try {
    await transporter.sendMail({
      from: `"NextSynergy Tech" <${process.env.SMTP_USER}>`,
      to, subject, html,
    });
  } catch (e) {
    console.warn('Email send failed:', e.message);
  }
}

// ─────────────────────────────────────────────
//  AUTH MIDDLEWARE
// ─────────────────────────────────────────────

function authRequired(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized — token required' });
  }
  try {
    req.user = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET || 'dev_secret_change_me');
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function adminRequired(req, res, next) {
  authRequired(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    next();
  });
}

function generateToken(user) {
  return jwt.sign(
    { id: user._id, email: user.email, role: user.role },
    process.env.JWT_SECRET || 'dev_secret_change_me',
    { expiresIn: '7d' }
  );
}

// ─────────────────────────────────────────────
//  VALIDATION HELPERS
// ─────────────────────────────────────────────

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(422).json({ errors: errors.array() });
    return false;
  }
  return true;
}

// ─────────────────────────────────────────────
//  ROUTES — AUTH
// ─────────────────────────────────────────────

const authRouter = express.Router();

// POST /api/auth/register
authRouter.post(
  '/register',
  [
    body('firstName').trim().notEmpty().withMessage('First name required'),
    body('lastName').trim().notEmpty().withMessage('Last name required'),
    body('email').isEmail().withMessage('Valid email required').normalizeEmail(),
    body('password').isLength({ min: 6 }).withMessage('Password min 6 characters'),
  ],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const { firstName, lastName, email, password, goal } = req.body;
      const exists = await User.findOne({ email });
      if (exists) return res.status(409).json({ error: 'Email already registered' });

      const user = await User.create({ firstName, lastName, email, password, goal });
      const token = generateToken(user);

      // Welcome email
      await sendEmail(
        email,
        '🎉 Welcome to NextSynergy Tech!',
        `<h2>Hi ${firstName},</h2><p>Your account is ready. Start learning at <a href="${process.env.CLIENT_URL}">NextSynergy Tech</a>.</p>`
      );

      res.status(201).json({
        token,
        user: { id: user._id, firstName, lastName, email, role: user.role },
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// POST /api/auth/login
authRouter.post(
  '/login',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty(),
  ],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const { email, password } = req.body;
      const user = await User.findOne({ email });
      if (!user) return res.status(401).json({ error: 'Invalid credentials' });

      const match = await user.comparePassword(password);
      if (!match) return res.status(401).json({ error: 'Invalid credentials' });

      user.lastLogin = new Date();
      await user.save();

      const token = generateToken(user);
      res.json({
        token,
        user: {
          id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role,
          enrolledCourses: user.enrolledCourses,
          streak: user.streak,
          hoursWatched: user.hoursWatched,
        },
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /api/auth/me  — returns current user profile
authRouter.get('/me', authRequired, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select('-password')
      .populate('enrolledCourses', 'title category thumbnail price isFree');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/auth/profile  — update name / email / avatar
authRouter.put('/profile', authRequired, async (req, res) => {
  try {
    const { firstName, lastName, email, goal } = req.body;
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { firstName, lastName, email, goal },
      { new: true, runValidators: true }
    ).select('-password');
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/auth/change-password
authRouter.put(
  '/change-password',
  authRequired,
  [
    body('currentPassword').notEmpty(),
    body('newPassword').isLength({ min: 6 }),
  ],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const user = await User.findById(req.user.id);
      const match = await user.comparePassword(req.body.currentPassword);
      if (!match) return res.status(401).json({ error: 'Current password incorrect' });
      user.password = req.body.newPassword;
      await user.save();
      res.json({ message: 'Password updated' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// POST /api/auth/avatar  — upload avatar image
authRouter.post('/avatar', authRequired, (req, res, next) => {
  req.uploadFolder = 'avatars';
  next();
}, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const url = `/uploads/avatars/${req.file.filename}`;
    await User.findByIdAndUpdate(req.user.id, { avatar: url });
    res.json({ avatar: url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use('/api/auth', authRouter);

// ─────────────────────────────────────────────
//  ROUTES — COURSES
// ─────────────────────────────────────────────

const courseRouter = express.Router();

// GET /api/courses  — list all published courses (optional ?category=web&free=true)
courseRouter.get('/', async (req, res) => {
  try {
    const filter = { published: true };
    if (req.query.category) filter.category = req.query.category;
    if (req.query.free === 'true') filter.isFree = true;

    const courses = await Course.find(filter).select('-lessons');
    res.json(courses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/courses/:id  — single course with lessons
// Free lessons accessible to all; paid lessons require auth + enrollment
courseRouter.get('/:id', async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).json({ error: 'Course not found' });

    // Check access for paid content
    const token = req.headers.authorization?.split(' ')[1];
    let enrolled = false;
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret_change_me');
        const user = await User.findById(decoded.id);
        enrolled = user?.enrolledCourses.includes(course._id) || user?.role === 'admin';
      } catch {/* ignore */}
    }

    // Filter lessons: show all if enrolled or free course, otherwise only free lessons
    const lessons = (course.isFree || enrolled)
      ? course.lessons
      : course.lessons.map(l => ({ ...l.toObject(), videoUrl: l.isFree ? l.videoUrl : null }));

    res.json({ ...course.toObject(), lessons, enrolled });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/courses/:id/enroll  — enroll in a course
courseRouter.post('/:id/enroll', authRequired, async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).json({ error: 'Course not found' });

    const user = await User.findById(req.user.id);
    if (user.enrolledCourses.includes(course._id)) {
      return res.status(409).json({ error: 'Already enrolled' });
    }

    // For paid courses you'd add Stripe payment check here
    user.enrolledCourses.push(course._id);
    await user.save();

    course.enrolled += 1;
    await course.save();

    // Create progress record
    await Progress.create({ user: user._id, course: course._id });

    await sendEmail(
      user.email,
      `📚 Enrolled: ${course.title}`,
      `<h2>Hi ${user.firstName}!</h2><p>You're now enrolled in <strong>${course.title}</strong>. Happy learning!</p>`
    );

    res.json({ message: 'Enrolled successfully', courseId: course._id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ADMIN: create course ───
courseRouter.post(
  '/',
  adminRequired,
  [
    body('title').notEmpty(),
    body('description').notEmpty(),
    body('category').notEmpty(),
  ],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const course = await Course.create(req.body);
      res.status(201).json(course);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─── ADMIN: update course ───
courseRouter.put('/:id', adminRequired, async (req, res) => {
  try {
    const course = await Course.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!course) return res.status(404).json({ error: 'Not found' });
    res.json(course);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ADMIN: delete course ───
courseRouter.delete('/:id', adminRequired, async (req, res) => {
  try {
    await Course.findByIdAndDelete(req.params.id);
    res.json({ message: 'Course deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ADMIN: upload course thumbnail ───
courseRouter.post('/:id/thumbnail', adminRequired, (req, res, next) => {
  req.uploadFolder = 'thumbnails';
  next();
}, upload.single('thumbnail'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const url = `/uploads/thumbnails/${req.file.filename}`;
    await Course.findByIdAndUpdate(req.params.id, { thumbnail: url });
    res.json({ thumbnail: url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use('/api/courses', courseRouter);

// ─────────────────────────────────────────────
//  ROUTES — PROGRESS
// ─────────────────────────────────────────────

const progressRouter = express.Router();

// GET /api/progress/:courseId
progressRouter.get('/:courseId', authRequired, async (req, res) => {
  try {
    const progress = await Progress.findOne({ user: req.user.id, course: req.params.courseId });
    res.json(progress || { percentComplete: 0, completedLessons: [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/progress/:courseId/lesson/:lessonId  — mark lesson complete
progressRouter.post('/:courseId/lesson/:lessonId', authRequired, async (req, res) => {
  try {
    const course = await Course.findById(req.params.courseId);
    if (!course) return res.status(404).json({ error: 'Course not found' });

    let progress = await Progress.findOne({ user: req.user.id, course: req.params.courseId });
    if (!progress) {
      progress = await Progress.create({ user: req.user.id, course: req.params.courseId });
    }

    const lessonId = req.params.lessonId;
    const alreadyDone = progress.completedLessons.map(String).includes(lessonId);
    if (!alreadyDone) {
      progress.completedLessons.push(lessonId);
    }
    progress.lastLesson = lessonId;
    progress.percentComplete = Math.round((progress.completedLessons.length / course.lessons.length) * 100);
    await progress.save();

    // Update user total hours (rough estimate: 10 min per lesson)
    await User.findByIdAndUpdate(req.user.id, { $inc: { hoursWatched: 10 / 60 } });

    res.json(progress);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/progress  — all progress for current user
progressRouter.get('/', authRequired, async (req, res) => {
  try {
    const all = await Progress.find({ user: req.user.id }).populate('course', 'title thumbnail category');
    res.json(all);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use('/api/progress', progressRouter);

// ─────────────────────────────────────────────
//  ROUTES — TUTORIALS
// ─────────────────────────────────────────────

const tutorialRouter = express.Router();

// GET /api/tutorials
tutorialRouter.get('/', async (req, res) => {
  try {
    const filter = { published: true };
    if (req.query.topic) filter.topic = req.query.topic;
    const tutorials = await Tutorial.find(filter);
    res.json(tutorials);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tutorials/:id
tutorialRouter.get('/:id', async (req, res) => {
  try {
    const t = await Tutorial.findById(req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    t.views += 1;
    await t.save();
    res.json(t);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tutorials  — admin only
tutorialRouter.post('/', adminRequired, async (req, res) => {
  try {
    const tutorial = await Tutorial.create(req.body);
    res.status(201).json(tutorial);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/tutorials/:id  — admin only
tutorialRouter.put('/:id', adminRequired, async (req, res) => {
  try {
    const t = await Tutorial.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(t);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/tutorials/:id  — admin only
tutorialRouter.delete('/:id', adminRequired, async (req, res) => {
  try {
    await Tutorial.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use('/api/tutorials', tutorialRouter);

// ─────────────────────────────────────────────
//  ROUTES — ORDERS
// ─────────────────────────────────────────────

const orderRouter = express.Router();

// POST /api/orders  — submit a project order (public)
orderRouter.post(
  '/',
  [
    body('firstName').trim().notEmpty(),
    body('lastName').trim().notEmpty(),
    body('email').isEmail().normalizeEmail(),
    body('packageName').notEmpty(),
    body('description').isLength({ min: 20 }).withMessage('Description must be at least 20 characters'),
  ],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const { firstName, lastName, email, phone, packageName, budget, description } = req.body;

      // Optional: link to user account if logged in
      let userId = null;
      const token = req.headers.authorization?.split(' ')[1];
      if (token) {
        try {
          const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret_change_me');
          userId = decoded.id;
        } catch {/* anonymous order */}
      }

      const order = await Order.create({
        user: userId,
        firstName, lastName, email, phone, packageName, budget, description,
      });

      // Confirmation to customer
      await sendEmail(
        email,
        '✅ Project Request Received — NextSynergy Tech',
        `<h2>Hi ${firstName},</h2>
         <p>We received your request for <strong>${packageName}</strong>.</p>
         <p>Our team will contact you within <strong>24 hours</strong> at this email address.</p>
         <p><em>Order ID: ${order._id}</em></p>
         <br><p>— NextSynergy Tech Team<br>📞 +1 (704) 488-8465</p>`
      );

      // Internal notification to admin
      await sendEmail(
        process.env.ADMIN_EMAIL || process.env.SMTP_USER,
        `🚀 New Order: ${packageName} from ${firstName} ${lastName}`,
        `<p><strong>Name:</strong> ${firstName} ${lastName}</p>
         <p><strong>Email:</strong> ${email}</p>
         <p><strong>Phone:</strong> ${phone}</p>
         <p><strong>Package:</strong> ${packageName}</p>
         <p><strong>Budget:</strong> ${budget}</p>
         <p><strong>Description:</strong> ${description}</p>`
      );

      res.status(201).json({ message: 'Order submitted successfully', orderId: order._id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// GET /api/orders/mine  — logged-in user's own orders
orderRouter.get('/mine', authRequired, async (req, res) => {
  try {
    const orders = await Order.find({ user: req.user.id }).sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/orders  — admin: all orders
orderRouter.get('/', adminRequired, async (req, res) => {
  try {
    const orders = await Order.find()
      .populate('user', 'firstName lastName email')
      .sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/orders/:id/status  — admin: update order status
orderRouter.put('/:id/status', adminRequired, async (req, res) => {
  try {
    const { status, adminNotes } = req.body;
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { status, adminNotes },
      { new: true }
    ).populate('user', 'email firstName');
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // Notify customer of status change
    await sendEmail(
      order.email,
      `📦 Order Update — ${status.toUpperCase()}`,
      `<h2>Hi ${order.firstName},</h2>
       <p>Your order for <strong>${order.packageName}</strong> is now: <strong>${status}</strong>.</p>
       ${adminNotes ? `<p>Note from our team: ${adminNotes}</p>` : ''}
       <p>Thank you for choosing NextSynergy Tech!</p>`
    );

    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use('/api/orders', orderRouter);

// ─────────────────────────────────────────────
//  ROUTES — ADMIN DASHBOARD STATS
// ─────────────────────────────────────────────

app.get('/api/admin/stats', adminRequired, async (req, res) => {
  try {
    const [totalUsers, totalCourses, totalOrders, pendingOrders] = await Promise.all([
      User.countDocuments(),
      Course.countDocuments({ published: true }),
      Order.countDocuments(),
      Order.countDocuments({ status: 'pending' }),
    ]);
    res.json({ totalUsers, totalCourses, totalOrders, pendingOrders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/users  — list all users (admin)
app.get('/api/admin/users', adminRequired, async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/admin/users/:id/role
app.put('/api/admin/users/:id/role', adminRequired, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { role: req.body.role },
      { new: true }
    ).select('-password');
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
//  ROUTES — CONTACT
// ─────────────────────────────────────────────

app.post(
  '/api/contact',
  [
    body('name').trim().notEmpty(),
    body('email').isEmail().normalizeEmail(),
    body('message').isLength({ min: 10 }),
  ],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const { name, email, message } = req.body;
      await sendEmail(
        process.env.ADMIN_EMAIL || process.env.SMTP_USER,
        `📩 Contact from ${name}`,
        `<p><strong>Name:</strong> ${name}</p>
         <p><strong>Email:</strong> ${email}</p>
         <p><strong>Message:</strong><br>${message}</p>`
      );
      await sendEmail(
        email,
        'We received your message — NextSynergy Tech',
        `<h2>Hi ${name},</h2><p>Thank you for reaching out! We'll reply within 24 hours.</p><p>— NextSynergy Tech Team</p>`
      );
      res.json({ message: 'Message sent successfully' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ─────────────────────────────────────────────
//  SERVE FRONTEND (SPA fallback)
// ─────────────────────────────────────────────

app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.json({ message: 'NextSynergy Tech API running ✅', version: '1.0.0' });
  }
});

// ─────────────────────────────────────────────
//  GLOBAL ERROR HANDLER
// ─────────────────────────────────────────────

app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─────────────────────────────────────────────
//  START SERVER
// ─────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║   NextSynergy Tech — Server Running      ║
  ║   http://localhost:${PORT}                   ║
  ╚══════════════════════════════════════════╝
  `);
});

module.exports = app; // export for testing

/*
─────────────────────────────────────────────
  .env TEMPLATE  (create .env in same folder)
─────────────────────────────────────────────

PORT=5000
MONGO_URI=mongodb+srv://eshetu:Mygrace%40%4007!@cluster0.qli7n5o.mongodb.net/seeds?retryWrites=true&w=majority
JWT_SECRET=NST_SuperSecret_JWT_Key_2025_ChangeInProd!
CLIENT_URL=http://localhost:3000

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=eshetuwek1@gmail.com
SMTP_PASS=your_gmail_app_password_here

ADMIN_EMAIL=eshetuwek1@gmail.com

─────────────────────────────────────────────
  API ROUTES SUMMARY
─────────────────────────────────────────────

AUTH
  POST   /api/auth/register          Register new user
  POST   /api/auth/login             Login → returns JWT
  GET    /api/auth/me                Get current user (auth)
  PUT    /api/auth/profile           Update profile (auth)
  PUT    /api/auth/change-password   Change password (auth)
  POST   /api/auth/avatar            Upload avatar image (auth)

COURSES
  GET    /api/courses                List all courses (?category= &free=)
  GET    /api/courses/:id            Single course + lessons
  POST   /api/courses/:id/enroll     Enroll in course (auth)
  POST   /api/courses                Create course (admin)
  PUT    /api/courses/:id            Update course (admin)
  DELETE /api/courses/:id            Delete course (admin)
  POST   /api/courses/:id/thumbnail  Upload thumbnail (admin)

PROGRESS
  GET    /api/progress               All my progress (auth)
  GET    /api/progress/:courseId     Progress for one course (auth)
  POST   /api/progress/:courseId/lesson/:lessonId  Mark lesson done (auth)

TUTORIALS
  GET    /api/tutorials              List all tutorials
  GET    /api/tutorials/:id          Single tutorial
  POST   /api/tutorials              Create tutorial (admin)
  PUT    /api/tutorials/:id          Update tutorial (admin)
  DELETE /api/tutorials/:id          Delete tutorial (admin)

ORDERS
  POST   /api/orders                 Submit project order (public)
  GET    /api/orders/mine            My orders (auth)
  GET    /api/orders                 All orders (admin)
  PUT    /api/orders/:id/status      Update order status (admin)

ADMIN
  GET    /api/admin/stats            Dashboard stats (admin)
  GET    /api/admin/users            All users (admin)
  PUT    /api/admin/users/:id/role   Change user role (admin)

CONTACT
  POST   /api/contact                Send contact message (public)

─────────────────────────────────────────────
  EXAMPLE API CALLS (fetch)
─────────────────────────────────────────────

// Register
fetch('/api/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ firstName:'John', lastName:'Doe', email:'j@d.com', password:'secret123' })
});

// Login
const res = await fetch('/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email:'j@d.com', password:'secret123' })
});
const { token } = await res.json();
localStorage.setItem('nst_token', token);

// Get courses
fetch('/api/courses?category=ai');

// Enroll
fetch('/api/courses/COURSE_ID/enroll', {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` }
});

// Submit order
fetch('/api/orders', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ firstName:'Jane', lastName:'Smith', email:'j@s.com',
    packageName:'Business Pro', description:'I need a business website with...', budget:'$1,000-$5,000' })
});
*/
