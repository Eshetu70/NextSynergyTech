/**
 * seed.js  — Populate MongoDB with starter data
 * Run once:  node seed.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

// Password special chars must be URL-encoded in the connection string:
//   @  →  %40
// So  Mygrace@@07!  becomes  Mygrace%40%4007!
const MONGO_URI = process.env.MONGO_URI ||
  'mongodb+srv://eshetu:Mygrace%40%4007!@cluster0.qli7n5o.mongodb.net/seeds?retryWrites=true&w=majority';


// ── Inline schemas (mirrors server.js) ──────────────────────────────────────

const lessonSchema = new mongoose.Schema({
  title: String, videoUrl: String, duration: String, isFree: Boolean, order: Number,
});
const Course = mongoose.model('Course', new mongoose.Schema({
  title: String, description: String, category: String, thumbnail: String,
  price: Number, isFree: Boolean, level: String, lessons: [lessonSchema],
  instructor: String, tags: [String], enrolled: Number, rating: Number, published: Boolean,
}, { timestamps: true }));

const Tutorial = mongoose.model('Tutorial', new mongoose.Schema({
  title: String, videoId: String, thumbnail: String, duration: String,
  topic: String, isFree: Boolean, lessons: [{ label: String, vid: String }],
  views: Number, published: Boolean,
}, { timestamps: true }));

const User = mongoose.model('User', new mongoose.Schema({
  firstName: String, lastName: String, email: String, password: String,
  role: String, enrolledCourses: Array, streak: Number, hoursWatched: Number,
}, { timestamps: true }));

// ── Seed Data ────────────────────────────────────────────────────────────────

const courses = [
  {
    title: 'AI & Machine Learning',
    description: 'Learn Python for AI, TensorFlow, ML algorithms and model deployment. Build real projects from day one.',
    category: 'ai', thumbnail: '🤖', price: 199, isFree: false, level: 'intermediate',
    instructor: 'Eshetu T. Wekjira', tags: ['python','ai','tensorflow','ml'], enrolled: 0, rating: 4.9, published: true,
    lessons: [
      { title: 'Introduction to AI & ML', videoUrl: 'SzMiJFOa6w8', duration: '18 min', isFree: true, order: 1 },
      { title: 'Python for Data Science', videoUrl: 'j5v8D-alAKE', duration: '25 min', isFree: true, order: 2 },
      { title: 'NumPy & Pandas Fundamentals', videoUrl: 'Z9QbYZh1YXY', duration: '30 min', isFree: false, order: 3 },
      { title: 'Building Your First ML Model', videoUrl: 'mgxDfCTIgJQ', duration: '40 min', isFree: false, order: 4 },
      { title: 'Neural Networks Explained', videoUrl: 'SzMiJFOa6w8', duration: '35 min', isFree: false, order: 5 },
    ],
  },
  {
    title: 'React + Node Full Stack',
    description: 'Build complete web applications with React, Node.js, Express, and MongoDB from scratch.',
    category: 'web', thumbnail: '⚛️', price: 179, isFree: false, level: 'intermediate',
    instructor: 'Eshetu T. Wekjira', tags: ['react','nodejs','express','mongodb'], enrolled: 0, rating: 4.8, published: true,
    lessons: [
      { title: 'React Fundamentals', videoUrl: 'iwRneX7GIGI', duration: '30 min', isFree: true, order: 1 },
      { title: 'Components & Props', videoUrl: 'SzMiJFOa6w8', duration: '25 min', isFree: true, order: 2 },
      { title: 'State Management with Hooks', videoUrl: 'j5v8D-alAKE', duration: '35 min', isFree: false, order: 3 },
      { title: 'Building a REST API with Node', videoUrl: 'iwRneX7GIGI', duration: '45 min', isFree: false, order: 4 },
      { title: 'Connecting React to Node Backend', videoUrl: 'Z9QbYZh1YXY', duration: '40 min', isFree: false, order: 5 },
    ],
  },
  {
    title: 'Cybersecurity Pro',
    description: 'Network security, ethical hacking, penetration testing, and zero-trust architecture.',
    category: 'security', thumbnail: '🔐', price: 229, isFree: false, level: 'advanced',
    instructor: 'Ayman Boukharraz', tags: ['cybersecurity','hacking','network','security'], enrolled: 0, rating: 4.9, published: true,
    lessons: [
      { title: 'Intro to Cybersecurity', videoUrl: 'kd33UVZhnAA', duration: '20 min', isFree: true, order: 1 },
      { title: 'Network Fundamentals', videoUrl: 'SzMiJFOa6w8', duration: '35 min', isFree: false, order: 2 },
      { title: 'Ethical Hacking Basics', videoUrl: 'j5v8D-alAKE', duration: '45 min', isFree: false, order: 3 },
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
      { title: 'Inheritance and Polymorphism', videoUrl: '9mQvRZuFJlg', duration: '30 min', isFree: true, order: 3 },
    ],
  },
  {
    title: 'Mobile App Dev with React Native',
    description: 'Build cross-platform iOS & Android apps with React Native, hooks, and Firebase.',
    category: 'mobile', thumbnail: '📱', price: 189, isFree: false, level: 'intermediate',
    instructor: 'Eshetu T. Wekjira', tags: ['mobile','react-native','ios','android','firebase'], enrolled: 0, rating: 4.8, published: true,
    lessons: [
      { title: 'React Native Setup', videoUrl: 'j5v8D-alAKE', duration: '20 min', isFree: true, order: 1 },
      { title: 'Building Your First Screen', videoUrl: 'SzMiJFOa6w8', duration: '28 min', isFree: false, order: 2 },
      { title: 'Navigation & Stack Navigator', videoUrl: 'iwRneX7GIGI', duration: '35 min', isFree: false, order: 3 },
      { title: 'Firebase Integration', videoUrl: 'Z9QbYZh1YXY', duration: '40 min', isFree: false, order: 4 },
    ],
  },
  {
    title: 'Cloud Computing with AWS',
    description: 'Deploy scalable infrastructure on AWS, Docker, Kubernetes and master DevOps pipelines.',
    category: 'cloud', thumbnail: '☁️', price: 219, isFree: false, level: 'advanced',
    instructor: 'Ayman Boukharraz', tags: ['aws','cloud','docker','kubernetes','devops'], enrolled: 0, rating: 4.9, published: true,
    lessons: [
      { title: 'AWS Overview & IAM', videoUrl: 'G5rhGNbrV9I', duration: '25 min', isFree: true, order: 1 },
      { title: 'EC2 & S3 Deep Dive', videoUrl: 'kd33UVZhnAA', duration: '40 min', isFree: false, order: 2 },
      { title: 'Docker Fundamentals', videoUrl: 'SzMiJFOa6w8', duration: '35 min', isFree: false, order: 3 },
    ],
  },
  {
    title: 'Python for Beginners',
    description: 'Start your programming journey with Python — variables, loops, functions, and projects.',
    category: 'ai', thumbnail: '🐍', price: 0, isFree: true, level: 'beginner',
    instructor: 'Eshetu T. Wekjira', tags: ['python','beginner','programming'], enrolled: 0, rating: 4.6, published: true,
    lessons: [
      { title: 'Hello World & Variables', videoUrl: 'SzMiJFOa6w8', duration: '12 min', isFree: true, order: 1 },
      { title: 'Loops and Conditionals', videoUrl: 'j5v8D-alAKE', duration: '18 min', isFree: true, order: 2 },
      { title: 'Functions and Modules', videoUrl: 'iwRneX7GIGI', duration: '22 min', isFree: true, order: 3 },
    ],
  },
  {
    title: 'Database Engineering',
    description: 'SQL, MySQL, MongoDB, PostgreSQL — design, query, and optimize production databases.',
    category: 'web', thumbnail: '🗄️', price: 149, isFree: false, level: 'intermediate',
    instructor: 'Eshetu T. Wekjira', tags: ['sql','mysql','mongodb','database'], enrolled: 0, rating: 4.7, published: true,
    lessons: [
      { title: 'SQL Basics & Setup', videoUrl: 'iwRneX7GIGI', duration: '25 min', isFree: true, order: 1 },
      { title: 'Joins, Indexes & Optimization', videoUrl: 'SzMiJFOa6w8', duration: '35 min', isFree: false, order: 2 },
      { title: 'MongoDB & NoSQL Patterns', videoUrl: 'Z9QbYZh1YXY', duration: '30 min', isFree: false, order: 3 },
    ],
  },
];

const tutorials = [
  { title: 'Tech Innovations 2025', videoId: 'SzMiJFOa6w8', thumbnail: '🚀', duration: '18 min', topic: 'Emerging Tech', isFree: true, views: 0, published: true, lessons: [{ label: 'Watch Full', vid: 'SzMiJFOa6w8' }] },
  { title: 'Agile Development Masterclass', videoId: 'j5v8D-alAKE', thumbnail: '🔄', duration: '22 min', topic: 'Dev Methods', isFree: true, views: 0, published: true, lessons: [{ label: 'Agile Overview', vid: 'j5v8D-alAKE' }, { label: 'Sprint Planning', vid: 'Z9QbYZh1YXY' }] },
  { title: 'Node.js REST API from Scratch', videoId: 'iwRneX7GIGI', thumbnail: '⚙️', duration: '35 min', topic: 'Backend', isFree: true, views: 0, published: true, lessons: [{ label: 'REST APIs', vid: 'iwRneX7GIGI' }, { label: 'Express Setup', vid: 'UQrBgnm8bhU' }] },
  { title: 'Google Data Center Deep Dive', videoId: 'kd33UVZhnAA', thumbnail: '🏢', duration: '12 min', topic: 'Cloud Infra', isFree: true, views: 0, published: true, lessons: [{ label: 'Watch Full', vid: 'kd33UVZhnAA' }] },
  { title: 'Java OOP Complete Guide', videoId: 'tTR3Wn5Mbwg', thumbnail: '☕', duration: '26 min', topic: 'Java', isFree: true, views: 0, published: true, lessons: [{ label: 'Classes', vid: 'tTR3Wn5Mbwg' }, { label: 'Inheritance', vid: '9mQvRZuFJlg' }] },
  { title: 'AWS + Cloud Fundamentals', videoId: 'G5rhGNbrV9I', thumbnail: '☁️', duration: '33 min', topic: 'Cloud', isFree: true, views: 0, published: true, lessons: [{ label: 'AWS Basics', vid: 'G5rhGNbrV9I' }, { label: 'Storage & EC2', vid: 'kd33UVZhnAA' }] },
  { title: 'Intro to Machine Learning', videoId: 'SzMiJFOa6w8', thumbnail: '🤖', duration: '28 min', topic: 'AI & ML', isFree: true, views: 0, published: true, lessons: [{ label: 'ML Concepts', vid: 'SzMiJFOa6w8' }, { label: 'Python for ML', vid: 'j5v8D-alAKE' }] },
  { title: 'IoT & Satellite Technology', videoId: 'mKN_yxab1FA', thumbnail: '🛰️', duration: '15 min', topic: 'IoT', isFree: true, views: 0, published: true, lessons: [{ label: 'Watch Full', vid: 'mKN_yxab1FA' }] },
  { title: 'Infinite Mindset in Tech', videoId: 'mgxDfCTIgJQ', thumbnail: '💡', duration: '20 min', topic: 'Leadership', isFree: true, views: 0, published: true, lessons: [{ label: 'Watch Full', vid: 'mgxDfCTIgJQ' }] },
];

// ── Run Seed ─────────────────────────────────────────────────────────────────

async function seed() {
  await mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true, dbName: 'seeds' });
  console.log('✅  Connected to MongoDB Atlas  →  db: seeds');

  // Clear existing
  await Course.deleteMany({});
  await Tutorial.deleteMany({});
  await User.deleteMany({ email: 'admin@nextsynergytech.com' });
  console.log('🗑️   Cleared existing seed data');

  // Insert courses & tutorials
  await Course.insertMany(courses);
  console.log(`📚  Seeded ${courses.length} courses`);

  await Tutorial.insertMany(tutorials);
  console.log(`🎬  Seeded ${tutorials.length} tutorials`);

  // Create admin user
  const hashedPw = await bcrypt.hash('Admin@NST2025', 12);
  await User.create({
    firstName: 'Eshetu',
    lastName: 'Wekjira',
    email: 'admin@nextsynergytech.com',
    password: hashedPw,
    role: 'admin',
    enrolledCourses: [],
    streak: 0,
    hoursWatched: 0,
  });
  console.log('👤  Admin user created:');
  console.log('    Email   : admin@nextsynergytech.com');
  console.log('    Password: Admin@NST2025');
  console.log('    ⚠️  Change this password immediately after first login!');

  await mongoose.disconnect();
  console.log('\n🎉  Seed complete — database is ready!');
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});