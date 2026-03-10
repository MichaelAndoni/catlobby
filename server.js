'use strict';
require('dotenv').config();

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const path       = require('path');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const cookieParser   = require('cookie-parser');

const db     = require('./db');
const mailer = require('./mailer');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

const publicDir  = path.join(__dirname, 'public');
const PORT       = process.env.PORT || 3000;
const APP_URL    = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

app.use(express.static(publicDir));
app.use(express.json());
app.use(cookieParser());
app.get('/', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

// ────────────────────────────────────────────────────────────
//  AUTH REST ROUTES
// ────────────────────────────────────────────────────────────

// POST /auth/signup
app.post('/auth/signup', async (req, res) => {
  try {
    const { email, password, username } = req.body;
    if (!email || !password || !username) return res.status(400).json({ error: 'All fields required.' });
    if (password.length < 6)             return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    if (username.trim().length < 2)      return res.status(400).json({ error: 'Username must be at least 2 characters.' });

    const existing = db.getUserByEmail(email);
    if (existing) return res.status(409).json({ error: 'An account with that email already exists.' });

    const passwordHash = await bcrypt.hash(password, 12);
    const colorIndex   = Math.floor(Math.random() * 8);
    const userId       = uuidv4();

    // Pass along guest session data if provided (merge on signup)
    const guestCoins     = parseInt(req.body.guestCoins)     || 0;
    const guestInventory = req.body.guestInventory ? JSON.parse(req.body.guestInventory) : [];

    const user = db.createUser({
      id: userId, email, passwordHash,
      username: username.trim().substring(0, 16),
      colorIndex,
    });

    // Apply guest data if any
    if (guestCoins > 0 || guestInventory.length > 0) {
      db.updatePlayerData({
        id: userId,
        username: user.username,
        colorIndex,
        coins: guestCoins,
        inventory: guestInventory,
      });
    }

    // Create verification token and send email
    const verifyToken = uuidv4();
    db.createVerifyToken(verifyToken, userId);
    const verifyUrl = `${APP_URL}/auth/verify?token=${verifyToken}`;

    try {
      await mailer.sendVerificationEmail(email, username.trim(), verifyUrl);
    } catch (mailErr) {
      console.error('[mailer] Failed to send verification email:', mailErr.message);
      // Don't fail signup if mail fails — log the verify URL for dev
      console.log('[dev] Verify URL:', verifyUrl);
    }

    res.json({ ok: true, message: 'Account created! Check your email to verify your account.' });
  } catch (err) {
    console.error('[signup]', err);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// POST /auth/login
app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });

    const user = db.getUserByEmail(email);
    if (!user) return res.status(401).json({ error: 'Invalid email or password.' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid email or password.' });

    if (!user.verified) {
      return res.status(403).json({
        error: 'Please verify your email before logging in.',
        needsVerification: true,
      });
    }

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });

    res.cookie('auth_token', token, {
      httpOnly: true,
      maxAge:   30 * 24 * 60 * 60 * 1000,
      sameSite: 'lax',
      secure:   process.env.NODE_ENV === 'production',
    });

    res.json({
      ok: true,
      user: {
        id:         user.id,
        username:   user.username,
        email:      user.email,
        colorIndex: user.color_index,
        coins:      user.coins,
        inventory:  user.inventory,
      },
      token,
    });
  } catch (err) {
    console.error('[login]', err);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// GET /auth/verify?token=...
app.get('/auth/verify', (req, res) => {
  const { token } = req.query;
  if (!token) return res.send(verifyPage('Invalid link.', false));

  const row = db.getAndDeleteVerifyToken(token);
  if (!row) return res.send(verifyPage('This verification link has expired or already been used.', false));

  db.setVerified(row.user_id);
  res.send(verifyPage('Your email is verified! You can now log in to Cat Lobby.', true));
});

// GET /auth/me — check current session
app.get('/auth/me', (req, res) => {
  const token = req.cookies.auth_token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.json({ user: null });
  try {
    const { userId } = jwt.verify(token, JWT_SECRET);
    const user = db.getUserById(userId);
    if (!user || !user.verified) return res.json({ user: null });
    res.json({
      user: {
        id: user.id, username: user.username, email: user.email,
        colorIndex: user.color_index, coins: user.coins, inventory: user.inventory,
      },
    });
  } catch {
    res.json({ user: null });
  }
});

// POST /auth/logout
app.post('/auth/logout', (req, res) => {
  res.clearCookie('auth_token');
  res.json({ ok: true });
});

// POST /auth/resend-verification
app.post('/auth/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required.' });
    const user = db.getUserByEmail(email);
    if (!user || user.verified) return res.json({ ok: true }); // silently succeed
    const verifyToken = uuidv4();
    db.createVerifyToken(verifyToken, user.id);
    const verifyUrl = `${APP_URL}/auth/verify?token=${verifyToken}`;
    try {
      await mailer.sendVerificationEmail(email, user.username, verifyUrl);
    } catch (e) {
      console.error('[mailer] resend failed:', e.message);
      console.log('[dev] Verify URL:', verifyUrl);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

function verifyPage(message, success) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Cat Lobby — Email Verification</title>
<style>body{background:#1a1025;color:#f0e6ff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.box{background:#231533;border:1px solid #3d2060;border-radius:18px;padding:40px;text-align:center;max-width:400px}
h1{font-size:32px;margin:0 0 8px}p{color:#9b8ab0;margin:0 0 24px;font-size:15px}
a{background:linear-gradient(135deg,#c77dff,#ff9de2);color:#1a0030;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:800}
.err{color:#ef5350}</style></head><body>
<div class="box"><h1>🐱 Cat Lobby</h1>
<p class="${success ? '' : 'err'}">${message}</p>
${success ? '<a href="/">Go to the Lobby →</a>' : '<a href="/">Back to Lobby</a>'}</div></body></html>`;
}

// ────────────────────────────────────────────────────────────
//  GAME CONSTANTS
// ────────────────────────────────────────────────────────────
const WORLD_W = 780, WORLD_H = 560, SPEED = 3, TICK_RATE = 60;

const ITEMS = [
  { id:'coins_1',   type:'coin',    label:'1 Coin',            emoji:'🪙', value:1,  weight:40 },
  { id:'coins_3',   type:'coin',    label:'3 Coins',           emoji:'🪙', value:3,  weight:20 },
  { id:'coins_10',  type:'coin',    label:'10 Coins',          emoji:'💰', value:10, weight:8  },
  { id:'worm',      type:'item',    label:'Wriggling Worm',    emoji:'🪱', rarity:'common',    weight:30 },
  { id:'pebble',    type:'item',    label:'Smooth Pebble',     emoji:'🪨', rarity:'common',    weight:28 },
  { id:'bone',      type:'item',    label:'Old Bone',          emoji:'🦴', rarity:'common',    weight:25 },
  { id:'leaf',      type:'item',    label:'Fossil Leaf',       emoji:'🍂', rarity:'common',    weight:22 },
  { id:'acorn',     type:'item',    label:'Lucky Acorn',       emoji:'🌰', rarity:'common',    weight:20 },
  { id:'mushroom',  type:'item',    label:'Magic Mushroom',    emoji:'🍄', rarity:'uncommon',  weight:12 },
  { id:'crystal',   type:'item',    label:'Blue Crystal',      emoji:'💎', rarity:'uncommon',  weight:10 },
  { id:'fossil',    type:'item',    label:'Tiny Fossil',       emoji:'🦕', rarity:'uncommon',  weight:9  },
  { id:'bottle',    type:'item',    label:'Message in Bottle', emoji:'🍶', rarity:'uncommon',  weight:8  },
  { id:'gem',       type:'item',    label:'Ancient Gem',       emoji:'💍', rarity:'rare',      weight:4  },
  { id:'crown',     type:'item',    label:'Tiny Crown',        emoji:'👑', rarity:'rare',      weight:3  },
  { id:'map',       type:'item',    label:'Treasure Map',      emoji:'🗺️', rarity:'rare',      weight:3  },
  { id:'potion',    type:'item',    label:'Mystery Potion',    emoji:'🧪', rarity:'rare',      weight:2  },
  { id:'star',      type:'item',    label:'Fallen Star',       emoji:'⭐', rarity:'legendary', weight:1  },
  { id:'fish_gold', type:'item',    label:'Golden Fish',       emoji:'🐠', rarity:'legendary', weight:1  },
  { id:'catbell',   type:'item',    label:'Ancient Cat Bell',  emoji:'🔔', rarity:'legendary', weight:1  },
  { id:'nothing',   type:'nothing', label:'Just Dirt',         emoji:'💨', weight:35 },
];
const TOTAL_WEIGHT = ITEMS.reduce((s,i) => s+i.weight, 0);
function rollItem() {
  let r = Math.random() * TOTAL_WEIGHT;
  for (const item of ITEMS) { r -= item.weight; if (r <= 0) return item; }
  return ITEMS[ITEMS.length-1];
}

const DIG_DURATION_MS = 15000, DIG_INTERVAL_MS = 3000, DIG_FIND_CHANCE = 0.55;

const CAT_COLORS = [
  { body:'#f4a261', ear:'#e07a2f', stripe:'#d4813f', name:'Orange' },
  { body:'#a8dadc', ear:'#6cbfc3', stripe:'#89c8ca', name:'Blue'   },
  { body:'#c9b1ff', ear:'#a07dff', stripe:'#b396ff', name:'Purple' },
  { body:'#ffd6e0', ear:'#ffb3c6', stripe:'#ffbed5', name:'Pink'   },
  { body:'#b7e4c7', ear:'#74c69d', stripe:'#95d6b0', name:'Green'  },
  { body:'#f8edeb', ear:'#d9c4c0', stripe:'#e8d8d5', name:'White'  },
  { body:'#9d8ca1', ear:'#6d6875', stripe:'#8a7a8e', name:'Gray'   },
  { body:'#e9c46a', ear:'#c9a227', stripe:'#d4ad47', name:'Yellow' },
];

const players     = {};
const chatHistory = [];
const activeTrades = {};

function randomSpawn() {
  return { x: 40 + Math.random()*(WORLD_W-80), y: 40 + Math.random()*(WORLD_H-80) };
}
function makeId() { return Math.random().toString(36).slice(2,10); }

// ────────────────────────────────────────────────────────────
//  SAVE PLAYER TO DB (for authenticated players)
// ────────────────────────────────────────────────────────────
function savePlayer(p) {
  if (!p.dbUserId) return;
  db.updatePlayerData({
    id:         p.dbUserId,
    username:   p.name,
    colorIndex: p.colorIndex,
    coins:      p.coins,
    inventory:  p.inventory,
  });
}

// Auto-save every 30 seconds for all authenticated players
setInterval(() => {
  for (const p of Object.values(players)) {
    if (p.dbUserId) savePlayer(p);
  }
}, 30_000);

// ────────────────────────────────────────────────────────────
//  SOCKET.IO
// ────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  const pos = randomSpawn();
  const colorIndex = Math.floor(Math.random() * CAT_COLORS.length);

  players[socket.id] = {
    id: socket.id, x: pos.x, y: pos.y,
    name: 'Cat', color: CAT_COLORS[colorIndex], colorIndex,
    keys: {}, emote: null, emoteTimer: 0,
    digging: false, digStartTime: 0, digIntervalHandle: null,
    coins: 0, inventory: [],
    activeTradeId: null,
    joinedAt: Date.now(),
    dbUserId: null,   // null = guest
    isGuest: true,
  };

  socket.emit('init', {
    id: socket.id,
    players: Object.values(players).map(sanitize),
    chatHistory, worldW: WORLD_W, worldH: WORLD_H,
  });
  socket.broadcast.emit('playerJoined', sanitize(players[socket.id]));

  // ── AUTHENTICATE via JWT token ──
  // Called right after connection if player has a saved token
  socket.on('authLogin', (token) => {
    try {
      const { userId } = jwt.verify(token, JWT_SECRET);
      const user = db.getUserById(userId);
      if (!user || !user.verified) {
        socket.emit('authResult', { ok: false, error: 'Session invalid. Please log in again.' });
        return;
      }
      const p = players[socket.id];
      if (!p) return;
      // Load saved data
      p.dbUserId   = user.id;
      p.isGuest    = false;
      p.name       = user.username;
      p.colorIndex = user.color_index;
      p.color      = CAT_COLORS[user.color_index] || CAT_COLORS[0];
      p.coins      = user.coins;
      p.inventory  = user.inventory || [];

      socket.emit('authResult', {
        ok: true,
        user: {
          id: user.id, username: user.username, email: user.email,
          colorIndex: user.color_index, coins: user.coins, inventory: user.inventory,
        },
      });
      io.emit('playerUpdate', sanitize(p));
    } catch {
      socket.emit('authResult', { ok: false, error: 'Session expired. Please log in again.' });
    }
  });

  // ── CLAIM GUEST ACCOUNT (guest signs up mid-session) ──
  // Guest data is transferred to the newly created account
  socket.on('claimGuestAccount', (token) => {
    try {
      const { userId } = jwt.verify(token, JWT_SECRET);
      const user = db.getUserById(userId);
      if (!user) return;
      const p = players[socket.id];
      if (!p) return;

      // Merge guest data into the DB account (coins + inventory)
      const mergedCoins = (user.coins || 0) + (p.coins || 0);
      const mergedInv   = mergeInventories(user.inventory || [], p.inventory || []);

      db.updatePlayerData({
        id:         user.id,
        username:   user.username,
        colorIndex: user.color_index,
        coins:      mergedCoins,
        inventory:  mergedInv,
      });

      // Update live player state
      p.dbUserId   = user.id;
      p.isGuest    = false;
      p.name       = user.username;
      p.colorIndex = user.color_index;
      p.color      = CAT_COLORS[user.color_index] || CAT_COLORS[0];
      p.coins      = mergedCoins;
      p.inventory  = mergedInv;

      socket.emit('authResult', {
        ok: true,
        user: {
          id: user.id, username: user.username, email: user.email,
          colorIndex: user.color_index, coins: mergedCoins, inventory: mergedInv,
        },
      });
      io.emit('playerUpdate', sanitize(p));
    } catch (e) {
      console.error('[claimGuest]', e);
    }
  });

  function mergeInventories(base, guest) {
    const result = [...base];
    for (const item of guest) {
      const ex = result.find(i => i.id === item.id);
      if (ex) ex.qty += item.qty;
      else result.push({...item});
    }
    return result;
  }

  // ── SET NAME ──
  socket.on('setName', (name) => {
    if (typeof name !== 'string') return;
    const p = players[socket.id];
    if (!p) return;
    p.name = name.trim().substring(0,16) || 'Cat';
    io.emit('playerUpdate', sanitize(p));
  });

  // ── MOVEMENT ──
  socket.on('keys', (keys) => {
    const p = players[socket.id];
    if (!p || p.digging) return;
    p.keys = keys;
  });

  // ── CHAT ──
  socket.on('chat', (msg) => {
    if (typeof msg !== 'string') return;
    msg = msg.trim().substring(0,120);
    if (!msg) return;
    const p = players[socket.id];
    if (!p) return;
    const entry = {
      id: socket.id, name: p.name, colorIndex: p.colorIndex,
      msg, time: Date.now(), isGuest: p.isGuest,
    };
    chatHistory.push(entry);
    if (chatHistory.length > 80) chatHistory.shift();
    io.emit('chat', entry);
  });

  // ── EMOTE ──
  socket.on('emote', (emote) => {
    const valid = ['👋','❤️','😸','🐟','⭐','💤','🎵'];
    if (!valid.includes(emote)) return;
    const p = players[socket.id];
    if (!p) return;
    p.emote = emote; p.emoteTimer = 120;
    io.emit('emote', { id: socket.id, emote });
  });

  // ── DIG ──
  socket.on('startDig', () => {
    const p = players[socket.id];
    if (!p || p.digging || p.activeTradeId) return;
    p.digging = true; p.keys = {}; p.digStartTime = Date.now();
    io.emit('playerDig', { id: socket.id, digging: true });
    p.digIntervalHandle = setInterval(() => {
      if (!players[socket.id]) return;
      if (Math.random() < DIG_FIND_CHANCE) handleFind(socket, players[socket.id], rollItem());
    }, DIG_INTERVAL_MS);
    setTimeout(() => stopDig(socket), DIG_DURATION_MS);
  });
  socket.on('stopDig', () => stopDig(socket));
  function stopDig(sock) {
    const p = players[sock.id];
    if (!p || !p.digging) return;
    p.digging = false;
    clearInterval(p.digIntervalHandle); p.digIntervalHandle = null;
    io.emit('playerDig', { id: sock.id, digging: false });
    sock.emit('digStopped');
  }

  // ── PROFILE ──
  socket.on('requestProfile', (targetId) => {
    const target = players[targetId];
    if (!target) return;
    socket.emit('profileData', {
      id: target.id, name: target.name, colorIndex: target.colorIndex, color: target.color,
      coins: target.coins, inventory: target.inventory,
      joinedAt: target.joinedAt, isGuest: target.isGuest,
    });
  });

  // ── TRADE ──
  socket.on('tradeRequest', (targetId) => {
    const initiator = players[socket.id];
    const target    = players[targetId];
    if (!initiator || !target || socket.id === targetId) return;
    if (initiator.activeTradeId) { socket.emit('privateMsg', { type:'trade_error', text:'You are already in a trade.' }); return; }
    if (target.activeTradeId)    { socket.emit('privateMsg', { type:'trade_error', text:`${target.name} is already in a trade.` }); return; }

    const tradeId = makeId();
    if (!target.pendingTradeFrom)    target.pendingTradeFrom    = {};
    if (!initiator.pendingTradeTo)   initiator.pendingTradeTo   = {};
    target.pendingTradeFrom[tradeId]   = socket.id;
    initiator.pendingTradeTo[tradeId]  = targetId;

    socket.emit('privateMsg', { type:'trade_sent', text:`Trade request sent to ${target.name}.`, tradeId });
    io.to(targetId).emit('privateMsg', {
      type:'trade_incoming', text:`${initiator.name} sent you a trade request!`,
      tradeId, fromId: socket.id, fromName: initiator.name, fromColorIndex: initiator.colorIndex,
    });
  });

  socket.on('tradeAccept', (tradeId) => {
    const target    = players[socket.id];
    if (!target?.pendingTradeFrom?.[tradeId]) return;
    const initiatorId = target.pendingTradeFrom[tradeId];
    const initiator   = players[initiatorId];
    if (!initiator) { socket.emit('privateMsg', { type:'trade_error', text:'That player is no longer online.' }); delete target.pendingTradeFrom[tradeId]; return; }
    if (initiator.activeTradeId || target.activeTradeId) { socket.emit('privateMsg', { type:'trade_error', text:'One of you is already in a trade.' }); return; }
    delete target.pendingTradeFrom[tradeId];
    if (initiator.pendingTradeTo) delete initiator.pendingTradeTo[tradeId];

    activeTrades[tradeId] = {
      tradeId, initiatorId, targetId: socket.id,
      initiatorOffer: { items:[], coins:0 }, targetOffer: { items:[], coins:0 },
      initiatorAccepted: false, targetAccepted: false,
    };
    initiator.activeTradeId = tradeId;
    target.activeTradeId    = tradeId;

    const initSock = io.sockets.sockets.get(initiatorId);
    if (initSock) initSock.emit('tradeOpen', {
      tradeId, role:'initiator', partnerId: socket.id, partnerName: target.name, partnerColorIndex: target.colorIndex,
      myInventory: initiator.inventory, myCoins: initiator.coins,
      partnerInventory: target.inventory, partnerCoins: target.coins,
    });
    socket.emit('tradeOpen', {
      tradeId, role:'target', partnerId: initiatorId, partnerName: initiator.name, partnerColorIndex: initiator.colorIndex,
      myInventory: target.inventory, myCoins: target.coins,
      partnerInventory: initiator.inventory, partnerCoins: initiator.coins,
    });
  });

  socket.on('tradeDecline', (tradeId) => {
    const target = players[socket.id];
    if (!target?.pendingTradeFrom?.[tradeId]) return;
    const initiatorId = target.pendingTradeFrom[tradeId];
    delete target.pendingTradeFrom[tradeId];
    const initiator = players[initiatorId];
    if (initiator?.pendingTradeTo) delete initiator.pendingTradeTo[tradeId];
    const initSock = io.sockets.sockets.get(initiatorId);
    if (initSock) initSock.emit('privateMsg', { type:'trade_declined', text:`${target.name} declined your trade request.` });
  });

  socket.on('tradeUpdateOffer', ({ tradeId, items, coins }) => {
    const trade = activeTrades[tradeId];
    if (!trade) return;
    const p = players[socket.id];
    if (!p) return;
    const isInit = trade.initiatorId === socket.id;
    const myOffer = isInit ? trade.initiatorOffer : trade.targetOffer;
    myOffer.items = Array.isArray(items) ? items : [];
    myOffer.coins = Math.max(0, Math.min(parseInt(coins)||0, p.coins));
    trade.initiatorAccepted = false; trade.targetAccepted = false;
    broadcastTradeState(trade);
  });

  socket.on('tradeAcceptTrade', (tradeId) => {
    const trade = activeTrades[tradeId];
    if (!trade) return;
    const isInit = trade.initiatorId === socket.id;
    if (isInit) trade.initiatorAccepted = true; else trade.targetAccepted = true;
    broadcastTradeState(trade);
    if (trade.initiatorAccepted && trade.targetAccepted) executeTrade(trade);
  });

  socket.on('tradeDeclineTrade', (tradeId) => {
    const trade = activeTrades[tradeId];
    if (!trade) return;
    if (trade.initiatorId !== socket.id && trade.targetId !== socket.id) return;
    const otherId = trade.initiatorId === socket.id ? trade.targetId : trade.initiatorId;
    const p = players[socket.id];
    const otherSock = io.sockets.sockets.get(otherId);
    if (otherSock) otherSock.emit('tradeClosed', { tradeId, reason:`${p?.name||'Someone'} declined the trade.` });
    socket.emit('tradeClosed', { tradeId, reason:'You declined the trade.' });
    cleanupTrade(tradeId);
  });

  socket.on('disconnect', () => {
    const p = players[socket.id];
    if (p) {
      if (p.dbUserId) savePlayer(p);
      if (p.digIntervalHandle) clearInterval(p.digIntervalHandle);
      if (p.activeTradeId) {
        const t = activeTrades[p.activeTradeId];
        if (t) {
          const otherId = t.initiatorId === socket.id ? t.targetId : t.initiatorId;
          const os = io.sockets.sockets.get(otherId);
          if (os) os.emit('tradeClosed', { tradeId: p.activeTradeId, reason:'Trade partner disconnected.' });
          cleanupTrade(p.activeTradeId);
        }
      }
    }
    delete players[socket.id];
    io.emit('playerLeft', socket.id);
  });
});

// ────────────────────────────────────────────────────────────
//  TRADE HELPERS
// ────────────────────────────────────────────────────────────
function broadcastTradeState(trade) {
  const is = io.sockets.sockets.get(trade.initiatorId);
  const ts = io.sockets.sockets.get(trade.targetId);
  if (is) is.emit('tradeState', { tradeId:trade.tradeId, myOffer:trade.initiatorOffer, partnerOffer:trade.targetOffer, myAccepted:trade.initiatorAccepted, partnerAccepted:trade.targetAccepted });
  if (ts) ts.emit('tradeState', { tradeId:trade.tradeId, myOffer:trade.targetOffer, partnerOffer:trade.initiatorOffer, myAccepted:trade.targetAccepted, partnerAccepted:trade.initiatorAccepted });
}

function executeTrade(trade) {
  const init = players[trade.initiatorId];
  const targ = players[trade.targetId];
  if (!init || !targ) { cleanupTrade(trade.tradeId); return; }
  const iO = trade.initiatorOffer, tO = trade.targetOffer;
  for (const o of iO.items) { const inv=init.inventory.find(i=>i.id===o.id); if (!inv||inv.qty<o.qty) { notifyTradeError(trade,trade.initiatorId,'Your inventory changed.'); cleanupTrade(trade.tradeId); return; } }
  if (init.coins < iO.coins) { notifyTradeError(trade,trade.initiatorId,'Not enough coins.'); cleanupTrade(trade.tradeId); return; }
  for (const o of tO.items) { const inv=targ.inventory.find(i=>i.id===o.id); if (!inv||inv.qty<o.qty) { notifyTradeError(trade,trade.targetId,'Partner inventory changed.'); cleanupTrade(trade.tradeId); return; } }
  if (targ.coins < tO.coins) { notifyTradeError(trade,trade.targetId,'Partner not enough coins.'); cleanupTrade(trade.tradeId); return; }

  for (const o of iO.items) { rmItem(init,o.id,o.qty); addItem(targ,o); }
  for (const o of tO.items) { rmItem(targ,o.id,o.qty); addItem(init,o); }
  init.coins = init.coins - iO.coins + tO.coins;
  targ.coins = targ.coins - tO.coins + iO.coins;

  if (init.dbUserId) savePlayer(init);
  if (targ.dbUserId) savePlayer(targ);

  const is = io.sockets.sockets.get(trade.initiatorId);
  const ts = io.sockets.sockets.get(trade.targetId);
  if (is) is.emit('tradeComplete', { tradeId:trade.tradeId, inventory:init.inventory, coins:init.coins });
  if (ts) ts.emit('tradeComplete', { tradeId:trade.tradeId, inventory:targ.inventory, coins:targ.coins });
  cleanupTrade(trade.tradeId);
}

function notifyTradeError(trade, pid, msg) {
  const s = io.sockets.sockets.get(pid); if (s) s.emit('tradeClosed', { tradeId:trade.tradeId, reason:msg });
  const oid = trade.initiatorId===pid?trade.targetId:trade.initiatorId;
  const os = io.sockets.sockets.get(oid); if (os) os.emit('tradeClosed', { tradeId:trade.tradeId, reason:'Trade cancelled.' });
}
function addItem(p, item) {
  const ex = p.inventory.find(i=>i.id===item.id);
  if (ex) ex.qty+=item.qty;
  else p.inventory.push({id:item.id,label:item.label,emoji:item.emoji,rarity:item.rarity,qty:item.qty});
}
function rmItem(p, itemId, qty) {
  const idx = p.inventory.findIndex(i=>i.id===itemId);
  if (idx===-1) return;
  p.inventory[idx].qty -= qty;
  if (p.inventory[idx].qty <= 0) p.inventory.splice(idx,1);
}
function cleanupTrade(tradeId) {
  const t = activeTrades[tradeId]; if (!t) return;
  if (players[t.initiatorId]) players[t.initiatorId].activeTradeId = null;
  if (players[t.targetId])    players[t.targetId].activeTradeId    = null;
  delete activeTrades[tradeId];
}

function handleFind(socket, p, item) {
  if (item.type==='nothing') { socket.emit('digFind',{type:'nothing',label:item.label,emoji:item.emoji}); return; }
  if (item.type==='coin') {
    p.coins += item.value;
    socket.emit('digFind',{type:'coin',label:item.label,emoji:item.emoji,value:item.value,totalCoins:p.coins}); return;
  }
  const ex = p.inventory.find(i=>i.id===item.id);
  if (ex) ex.qty++; else p.inventory.push({id:item.id,label:item.label,emoji:item.emoji,rarity:item.rarity,qty:1});
  socket.emit('digFind',{type:'item',id:item.id,label:item.label,emoji:item.emoji,rarity:item.rarity,inventory:p.inventory});
}

function sanitize(p) {
  return { id:p.id, x:p.x, y:p.y, name:p.name, color:p.color, colorIndex:p.colorIndex, emote:p.emote, digging:p.digging, coins:p.coins, isGuest:p.isGuest };
}

// ────────────────────────────────────────────────────────────
//  GAME LOOP
// ────────────────────────────────────────────────────────────
setInterval(() => {
  const updates = [];
  for (const id in players) {
    const p = players[id];
    if (!p.digging) {
      const k = p.keys||{};
      if (k.left)  p.x -= SPEED; if (k.right) p.x += SPEED;
      if (k.up)    p.y -= SPEED; if (k.down)  p.y += SPEED;
      p.x = Math.max(16, Math.min(WORLD_W-16, p.x));
      p.y = Math.max(16, Math.min(WORLD_H-16, p.y));
    }
    if (p.emoteTimer>0) { p.emoteTimer--; if (p.emoteTimer===0) p.emote=null; }
    updates.push({ id:p.id, x:p.x, y:p.y, emote:p.emote, digging:p.digging });
  }
  if (updates.length) io.emit('tick', updates);
}, 1000/TICK_RATE);

server.listen(PORT, () => {
  const fs = require('fs');
  const ok = fs.existsSync(path.join(__dirname,'public','index.html'));
  console.log(`🐱 Cat Lobby running at ${APP_URL}`);
  console.log(`📄 index.html: ${ok?'✅':'❌ MISSING'}`);
  console.log(`🗄️  Database: ${process.env.DB_PATH||'./catlobby.db'}`);
  if (!process.env.SMTP_USER) console.warn('⚠️  SMTP not configured — verification emails will not be sent (check .env)');
});
