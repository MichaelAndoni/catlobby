'use strict';
/**
 * server.js — Entry point
 * Loads env, initialises DB schema, then starts the HTTP server.
 * All application logic lives in app.js and src/.
 */
require('dotenv').config();

const path = require('path');
const db   = require('./src/config/db');
const { server } = require('./app');

const PORT    = process.env.PORT    || 3000;
const APP_URL = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, '');

db.initSchema()
  .then(() => {
    server.listen(PORT, () => {
      const fs  = require('fs');
      const ok  = fs.existsSync(path.join(__dirname, 'public', 'index.html'));
      console.log(`🐱 Cat Lobby running at ${APP_URL}`);
      console.log(`📄 public/index.html: ${ok ? '✅' : '❌ MISSING'}`);
      if (!process.env.SMTP_USER)    console.warn('⚠️  SMTP not configured');
      if (!process.env.DATABASE_URL) console.error('❌ DATABASE_URL not set!');
    });
  })
  .catch(err => { console.error('❌ DB init failed:', err.message); process.exit(1); });
