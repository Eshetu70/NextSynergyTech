require('dotenv').config();

const { MongoClient, ServerApiVersion } = require('mongodb');

const uri = process.env.MONGO_URI;

if (!uri) {
  console.error('❌ MONGO_URI is missing from .env');
  process.exit(1);
}

console.log('Testing URI:', uri.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:***@'));

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
  serverSelectionTimeoutMS: 30000,
});

async function run() {
  try {
    await client.connect();
    await client.db('admin').command({ ping: 1 });
    console.log('✅ Pinged your deployment. You successfully connected to MongoDB!');
  } catch (err) {
    console.error('❌ MongoDB official driver failed:');
    console.error(err);
  } finally {
    await client.close();
  }
}

run();