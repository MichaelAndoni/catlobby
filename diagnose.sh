#!/bin/bash
# Run this on your EC2: bash diagnose.sh
# It checks every common cause of "won't start after refactor"

echo "============================================"
echo "  Cat Lobby — Startup Diagnostics"
echo "============================================"
echo ""

# 1. Node version
echo "1. Node version"
node -v || echo "   ❌ Node not found — run: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs"
echo ""

# 2. Working directory
echo "2. Working directory: $(pwd)"
echo ""

# 3. Required files exist
echo "3. Checking required files..."
for f in server.js app.js package.json .env public/index.html \
          src/config/db.js src/config/constants.js src/config/shopItems.js \
          src/state/index.js src/services/mailer.js \
          src/routes/auth.js src/routes/api.js \
          src/socket/index.js src/socket/gameLoop.js src/socket/helpers.js \
          src/socket/handlers/auth.js src/socket/handlers/chat.js \
          src/socket/handlers/dig.js src/socket/handlers/shop.js \
          src/socket/handlers/outfit.js src/socket/handlers/combat.js \
          src/socket/handlers/aqua.js src/socket/handlers/trade.js \
          src/socket/handlers/room.js; do
  if [ -f "$f" ]; then echo "   ✅ $f"
  else echo "   ❌ MISSING: $f"; fi
done
echo ""

# 4. node_modules exists
echo "4. node_modules..."
if [ -d "node_modules" ]; then
  echo "   ✅ node_modules exists"
  for pkg in express socket.io pg bcryptjs jsonwebtoken uuid dotenv nodemailer cookie-parser; do
    if [ -d "node_modules/$pkg" ]; then echo "   ✅ $pkg"
    else echo "   ❌ MISSING: $pkg — run: npm install"; fi
  done
else
  echo "   ❌ node_modules missing — run: npm install"
fi
echo ""

# 5. .env file and key variables
echo "5. .env file..."
if [ -f ".env" ]; then
  echo "   ✅ .env exists"
  for var in DATABASE_URL JWT_SECRET PORT APP_URL; do
    val=$(grep "^$var=" .env 2>/dev/null | cut -d= -f2-)
    if [ -n "$val" ]; then
      if [ "$var" = "DATABASE_URL" ] || [ "$var" = "JWT_SECRET" ]; then
        echo "   ✅ $var is set"
      else
        echo "   ✅ $var=$val"
      fi
    else
      echo "   ❌ $var not set in .env"
    fi
  done
else
  echo "   ❌ .env file MISSING — run: cp .env.example .env && nano .env"
fi
echo ""

# 6. PostgreSQL running
echo "6. PostgreSQL..."
if pg_isready -q 2>/dev/null; then
  echo "   ✅ PostgreSQL is running"
else
  echo "   ❌ PostgreSQL not responding — run: sudo systemctl start postgresql"
fi
echo ""

# 7. Try a dry-run require to catch any runtime require errors
echo "7. Dry-run module load test..."
node -e "
require('dotenv').config();
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://x:x@localhost/x';
try {
  require('./src/config/constants');
  console.log('   ✅ constants loaded');
} catch(e) { console.log('   ❌ constants:', e.message); }
try {
  require('./src/state');
  console.log('   ✅ state loaded');
} catch(e) { console.log('   ❌ state:', e.message); }
try {
  require('./src/services/mailer');
  console.log('   ✅ mailer loaded');
} catch(e) { console.log('   ❌ mailer:', e.message); }
try {
  require('./src/routes/auth');
  console.log('   ✅ routes/auth loaded');
} catch(e) { console.log('   ❌ routes/auth:', e.message); }
try {
  require('./src/routes/api');
  console.log('   ✅ routes/api loaded');
} catch(e) { console.log('   ❌ routes/api:', e.message); }
try {
  require('./src/socket/index');
  console.log('   ✅ socket/index loaded');
} catch(e) { console.log('   ❌ socket/index:', e.message); }
try {
  require('./app');
  console.log('   ✅ app.js loaded');
} catch(e) { console.log('   ❌ app.js:', e.message); }
" 2>&1
echo ""

# 8. PM2 status
echo "8. PM2 status..."
pm2 list 2>/dev/null | grep catlobby || echo "   (PM2 not running or catlobby not in PM2)"
echo ""

echo "============================================"
echo "  Done. Fix any ❌ items above, then run:"
echo "  pm2 restart catlobby  (or: pm2 start server.js --name catlobby)"
echo "============================================"
