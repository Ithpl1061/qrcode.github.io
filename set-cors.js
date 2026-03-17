/**
 * set-cors.js — Apply CORS rules to Firebase Storage
 *
 * Setup:
 *   1. npm install @google-cloud/storage
 *   2. Go to Firebase Console → Project Settings → Service Accounts
 *      → "Generate new private key" → save as "service-account.json" in this folder
 *   3. node set-cors.js
 */

const { Storage } = require('@google-cloud/storage');
const path = require('path');
const fs = require('fs');

const BUCKET_NAME = 'clone-d6cec.firebasestorage.app';
const KEY_FILE = path.join(__dirname, 'service-account.json');

if (!fs.existsSync(KEY_FILE)) {
  console.error('❌  service-account.json not found.');
  console.error('   Download it from: Firebase Console → Project Settings → Service Accounts → Generate new private key');
  process.exit(1);
}

const storage = new Storage({ keyFilename: KEY_FILE });

const corsConfig = [
  {
    origin: [
      'http://127.0.0.1:5500',
      'http://localhost:5500',
      'http://localhost:3000',
      'http://127.0.0.1:5000',
      'http://localhost:5000',
    ],
    method: ['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'],
    maxAgeSeconds: 3600,
    responseHeader: [
      'Content-Type',
      'Authorization',
      'Content-Length',
      'User-Agent',
      'x-goog-resumable',
    ],
  },
];

async function applyCors() {
  try {
    const bucket = storage.bucket(BUCKET_NAME);
    await bucket.setCorsConfiguration(corsConfig);
    console.log(`✅  CORS applied to gs://${BUCKET_NAME}`);

    // Verify
    const [metadata] = await bucket.getMetadata();
    console.log('\nActive CORS config:');
    console.log(JSON.stringify(metadata.cors, null, 2));
  } catch (err) {
    console.error('❌  Error:', err.message);
  }
}

applyCors();
