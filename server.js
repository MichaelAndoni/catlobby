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
    const guestCoins     = parseInt(req.body.guestCoins) || 0;
    const guestInventory = req.body.guestInventory ? JSON.parse(req.body.guestInventory) : [];
    db.createUser({ id: userId, email, passwordHash, username: username.trim().substring(0, 16), colorIndex });
    if (guestCoins > 0 || guestInventory.length > 0) {
      db.updatePlayerData({ id: userId, username: username.trim().substring(0,16), colorIndex, coins: guestCoins, inventory: guestInventory });
    }
    const verifyToken = uuidv4();
    db.createVerifyToken(verifyToken, userId);
    const verifyUrl = `${APP_URL}/auth/verify?token=${verifyToken}`;
    try { await mailer.sendVerificationEmail(email, username.trim(), verifyUrl); }
    catch (e) { console.error('[mailer]', e.message); console.log('[dev] Verify URL:', verifyUrl); }
    res.json({ ok: true });
  } catch (err) { console.error('[signup]', err); res.status(500).json({ error: 'Server error.' }); }
});

app.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });
    const user = db.getUserByEmail(email);
    if (!user) return res.status(401).json({ error: 'Invalid email or password.' });
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid email or password.' });
    if (!user.verified) return res.status(403).json({ error: 'Please verify your email before logging in.', needsVerification: true });
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
    res.cookie('auth_token', token, { httpOnly: true, maxAge: 30*24*60*60*1000, sameSite: 'lax', secure: process.env.NODE_ENV==='production' });
    res.json({ ok: true, user: { id: user.id, username: user.username, email: user.email, colorIndex: user.color_index, coins: user.coins, inventory: user.inventory }, token });
  } catch (err) { console.error('[login]', err); res.status(500).json({ error: 'Server error.' }); }
});

app.get('/auth/verify', (req, res) => {
  const { token } = req.query;
  if (!token) return res.send(verifyPage('Invalid link.', false));
  const row = db.getAndDeleteVerifyToken(token);
  if (!row) return res.send(verifyPage('This link has expired or already been used.', false));
  db.setVerified(row.user_id);
  res.send(verifyPage('Your email is verified! You can now log in.', true));
});

app.get('/auth/me', (req, res) => {
  const token = req.cookies.auth_token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.json({ user: null });
  try {
    const { userId } = jwt.verify(token, JWT_SECRET);
    const user = db.getUserById(userId);
    if (!user || !user.verified) return res.json({ user: null });
    res.json({ user: { id: user.id, username: user.username, email: user.email, colorIndex: user.color_index, coins: user.coins, inventory: user.inventory } });
  } catch { res.json({ user: null }); }
});

app.post('/auth/logout', (req, res) => { res.clearCookie('auth_token'); res.json({ ok: true }); });

app.post('/auth/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required.' });
    const user = db.getUserByEmail(email);
    if (!user || user.verified) return res.json({ ok: true });
    const tok = uuidv4(); db.createVerifyToken(tok, user.id);
    const url = `${APP_URL}/auth/verify?token=${tok}`;
    try { await mailer.sendVerificationEmail(email, user.username, url); }
    catch (e) { console.error('[mailer] resend:', e.message); console.log('[dev] Verify URL:', url); }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Server error.' }); }
});

// ── ROOM REST ROUTES ─────────────────────────────────────────
// GET /api/room/:userId  — fetch anyone's room data (for directory)
app.get('/api/room/:userId', (req, res) => {
  const user = db.getUserById(req.params.userId);
  if (!user || !user.verified) return res.status(404).json({ error: 'User not found.' });
  const room = db.getRoom(req.params.userId);
  res.json({ ok: true, room, owner: { id: user.id, username: user.username, colorIndex: user.color_index } });
});

// GET /api/room-directory  — list all users with rooms (for the directory table)
app.get('/api/room-directory', (req, res) => {
  // We just return all verified users; the client enriches with online status
  // In a large app you'd paginate — fine for now
  const users = db.getAllVerifiedUsers();
  res.json({ ok: true, users });
});

function verifyPage(message, success) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Cat Lobby</title>
<style>body{background:#1a1025;color:#f0e6ff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.box{background:#231533;border:1px solid #3d2060;border-radius:18px;padding:40px;text-align:center;max-width:400px}
h1{font-size:32px;margin:0 0 8px}p{color:#9b8ab0;margin:0 0 24px;font-size:15px}
a{background:linear-gradient(135deg,#c77dff,#ff9de2);color:#1a0030;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:800}
.err{color:#ef5350}</style></head><body>
<div class="box"><h1>🐱 Cat Lobby</h1>
<p class="${success?'':'err'}">${message}</p>
${success?'<a href="/">Go to the Lobby →</a>':'<a href="/">Back to Lobby</a>'}</div></body></html>`;
}

// ────────────────────────────────────────────────────────────
//  GAME CONSTANTS
// ────────────────────────────────────────────────────────────
const WORLD_W = 780, WORLD_H = 560, SPEED = 3, TICK_RATE = 60;
const ROOM_W  = 780, ROOM_H  = 560;

const ITEMS = [
  { id:'coins_1',   type:'coin',    label:'1 Coin',            emoji:'🪙', value:1,  weight:40 },
  { id:'coins_3',   type:'coin',    label:'3 Coins',           emoji:'🪙', value:3,  weight:20 },
  { id:'coins_10',  type:'coin',    label:'10 Coins',          emoji:'💰', value:10, weight:8  },
  { id:'worm',      type:'item',    label:'Wriggling Worm',    emoji:'🪱', rarity:'common',    weight:30, placeable:false },
  { id:'pebble',    type:'item',    label:'Smooth Pebble',     emoji:'🪨', rarity:'common',    weight:28, placeable:true,  furniture:{ w:32, h:28, label:'Smooth Pebble' } },
  { id:'bone',      type:'item',    label:'Old Bone',          emoji:'🦴', rarity:'common',    weight:25, placeable:false },
  { id:'leaf',      type:'item',    label:'Fossil Leaf',       emoji:'🍂', rarity:'common',    weight:22, placeable:true,  furniture:{ w:28, h:28, label:'Leaf Decor' } },
  { id:'acorn',     type:'item',    label:'Lucky Acorn',       emoji:'🌰', rarity:'common',    weight:20, placeable:true,  furniture:{ w:28, h:28, label:'Lucky Acorn' } },
  { id:'mushroom',  type:'item',    label:'Magic Mushroom',    emoji:'🍄', rarity:'uncommon',  weight:12, placeable:true,  furniture:{ w:36, h:40, label:'Mushroom Lamp' } },
  { id:'crystal',   type:'item',    label:'Blue Crystal',      emoji:'💎', rarity:'uncommon',  weight:10, placeable:true,  furniture:{ w:36, h:44, label:'Crystal Display' } },
  { id:'fossil',    type:'item',    label:'Tiny Fossil',       emoji:'🦕', rarity:'uncommon',  weight:9,  placeable:true,  furniture:{ w:48, h:44, label:'Fossil Display' } },
  { id:'bottle',    type:'item',    label:'Message in Bottle', emoji:'🍶', rarity:'uncommon',  weight:8,  placeable:true,  furniture:{ w:32, h:44, label:'Mystery Bottle' } },
  { id:'gem',       type:'item',    label:'Ancient Gem',       emoji:'💍', rarity:'rare',      weight:4,  placeable:true,  furniture:{ w:36, h:36, label:'Gem Showcase' } },
  { id:'crown',     type:'item',    label:'Tiny Crown',        emoji:'👑', rarity:'rare',      weight:3,  placeable:true,  furniture:{ w:44, h:36, label:'Crown Display' } },
  { id:'map',       type:'item',    label:'Treasure Map',      emoji:'🗺️', rarity:'rare',      weight:3,  placeable:true,  furniture:{ w:52, h:44, label:'Framed Map' } },
  { id:'potion',    type:'item',    label:'Mystery Potion',    emoji:'🧪', rarity:'rare',      weight:2,  placeable:true,  furniture:{ w:32, h:48, label:'Potion Shelf' } },
  { id:'star',      type:'item',    label:'Fallen Star',       emoji:'⭐', rarity:'legendary', weight:1,  placeable:true,  furniture:{ w:52, h:52, label:'Star Relic' } },
  { id:'fish_gold', type:'item',    label:'Golden Fish',       emoji:'🐠', rarity:'legendary', weight:1,  placeable:true,  furniture:{ w:56, h:44, label:'Golden Fish Tank' } },
  { id:'catbell',   type:'item',    label:'Ancient Cat Bell',  emoji:'🔔', rarity:'legendary', weight:1,  placeable:true,  furniture:{ w:44, h:52, label:'Ancient Bell' } },
  { id:'nothing',   type:'nothing', label:'Just Dirt',         emoji:'💨', weight:35 },
];
const ITEMS_MAP = Object.fromEntries(ITEMS.map(i => [i.id, i]));
const TOTAL_WEIGHT = ITEMS.reduce((s,i)=>s+i.weight,0);
function rollItem() { let r=Math.random()*TOTAL_WEIGHT; for(const i of ITEMS){r-=i.weight;if(r<=0)return i;} return ITEMS[ITEMS.length-1]; }

const DIG_DURATION_MS=15000, DIG_INTERVAL_MS=3000, DIG_FIND_CHANCE=0.55;

const CAT_COLORS=[
  {body:'#f4a261',ear:'#e07a2f',stripe:'#d4813f',name:'Orange'},
  {body:'#a8dadc',ear:'#6cbfc3',stripe:'#89c8ca',name:'Blue'},
  {body:'#c9b1ff',ear:'#a07dff',stripe:'#b396ff',name:'Purple'},
  {body:'#ffd6e0',ear:'#ffb3c6',stripe:'#ffbed5',name:'Pink'},
  {body:'#b7e4c7',ear:'#74c69d',stripe:'#95d6b0',name:'Green'},
  {body:'#f8edeb',ear:'#d9c4c0',stripe:'#e8d8d5',name:'White'},
  {body:'#9d8ca1',ear:'#6d6875',stripe:'#8a7a8e',name:'Gray'},
  {body:'#e9c46a',ear:'#c9a227',stripe:'#d4ad47',name:'Yellow'},
];

// ────────────────────────────────────────────────────────────
//  GAME STATE
// ────────────────────────────────────────────────────────────
const players      = {};   // socket.id → player  (lobby only)
const roomSessions = {};   // roomOwnerId → { players: {socketId→player}, chatHistory }
const chatHistory  = [];

function randomSpawn(W, H) { return { x: 40+Math.random()*(W-80), y: 40+Math.random()*(H-80) }; }

// ────────────────────────────────────────────────────────────
//  DB: getAllVerifiedUsers (needed for room directory)
// ────────────────────────────────────────────────────────────
// We add this query inline so db.js stays clean
const _getAllVerified = db.getAllVerifiedUsers || (() => {
  // This is set up after db module loads — patch it here
  return [];
});
// Patch db module to expose this
const Database = require('better-sqlite3');
const _dbPath  = require('path').resolve(process.env.DB_PATH || './catlobby.db');
const _rawDb   = new Database(_dbPath);
const _stmtAllUsers = _rawDb.prepare(`SELECT id, username, color_index FROM users WHERE verified = 1 ORDER BY username`);
db.getAllVerifiedUsers = () => _stmtAllUsers.all().map(u => ({ id: u.id, username: u.username, colorIndex: u.color_index }));

// ────────────────────────────────────────────────────────────
//  SAVE HELPERS
// ────────────────────────────────────────────────────────────
function savePlayer(p) {
  if (!p.dbUserId) return;
  db.updatePlayerData({ id: p.dbUserId, username: p.name, colorIndex: p.colorIndex, coins: p.coins, inventory: p.inventory });
}
setInterval(() => { for (const p of Object.values(players)) if (p.dbUserId) savePlayer(p); }, 30_000);

// ────────────────────────────────────────────────────────────
//  SOCKET.IO — LOBBY
// ────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  const pos = randomSpawn(WORLD_W, WORLD_H);
  const colorIndex = Math.floor(Math.random() * CAT_COLORS.length);
  players[socket.id] = {
    id: socket.id, x: pos.x, y: pos.y,
    name: 'Cat', color: CAT_COLORS[colorIndex], colorIndex,
    keys: {}, emote: null, emoteTimer: 0,
    digging: false, digStartTime: 0, digIntervalHandle: null,
    coins: 0, inventory: [],
    activeTradeId: null, joinedAt: Date.now(),
    dbUserId: null, isGuest: true,
    location: 'lobby',    // 'lobby' | 'room:<ownerId>'
    inRoomId: null,       // ownerId if in a room
  };

  socket.emit('init', {
    id: socket.id, players: Object.values(players).map(sanitize),
    chatHistory, worldW: WORLD_W, worldH: WORLD_H,
    items: ITEMS.map(i=>({ id:i.id, emoji:i.emoji, label:i.label, rarity:i.rarity, placeable:i.placeable, furniture:i.furniture })),
  });
  socket.broadcast.emit('playerJoined', sanitize(players[socket.id]));

  // ── AUTH ──
  socket.on('authLogin', (token) => {
    try {
      const { userId } = jwt.verify(token, JWT_SECRET);
      const user = db.getUserById(userId);
      if (!user || !user.verified) { socket.emit('authResult', { ok: false, error: 'Session invalid.' }); return; }
      const p = players[socket.id]; if (!p) return;
      p.dbUserId=user.id; p.isGuest=false; p.name=user.username; p.colorIndex=user.color_index;
      p.color=CAT_COLORS[user.color_index]||CAT_COLORS[0]; p.coins=user.coins; p.inventory=user.inventory||[];
      socket.emit('authResult', { ok: true, user: { id:user.id, username:user.username, email:user.email, colorIndex:user.color_index, coins:user.coins, inventory:user.inventory } });
      io.emit('playerUpdate', sanitize(p));
    } catch { socket.emit('authResult', { ok: false, error: 'Session expired.' }); }
  });

  socket.on('claimGuestAccount', (token) => {
    try {
      const { userId } = jwt.verify(token, JWT_SECRET);
      const user = db.getUserById(userId); if (!user) return;
      const p = players[socket.id]; if (!p) return;
      const mergedCoins = (user.coins||0)+(p.coins||0);
      const mergedInv   = mergeInventories(user.inventory||[], p.inventory||[]);
      db.updatePlayerData({ id:user.id, username:user.username, colorIndex:user.color_index, coins:mergedCoins, inventory:mergedInv });
      p.dbUserId=user.id; p.isGuest=false; p.name=user.username; p.colorIndex=user.color_index;
      p.color=CAT_COLORS[user.color_index]||CAT_COLORS[0]; p.coins=mergedCoins; p.inventory=mergedInv;
      socket.emit('authResult', { ok:true, user:{ id:user.id, username:user.username, email:user.email, colorIndex:user.color_index, coins:mergedCoins, inventory:mergedInv } });
      io.emit('playerUpdate', sanitize(p));
    } catch (e) { console.error('[claimGuest]', e); }
  });

  function mergeInventories(base, guest) {
    const r=[...base];
    for (const item of guest) { const ex=r.find(i=>i.id===item.id); if(ex) ex.qty+=item.qty; else r.push({...item}); }
    return r;
  }

  socket.on('setName', (name) => {
    if (typeof name!=='string') return;
    const p=players[socket.id]; if(!p) return;
    p.name=name.trim().substring(0,16)||'Cat';
    io.emit('playerUpdate', sanitize(p));
  });

  socket.on('keys', (keys) => { const p=players[socket.id]; if(!p||p.digging) return; p.keys=keys; });

  socket.on('chat', (msg) => {
    if (typeof msg!=='string') return; msg=msg.trim().substring(0,120); if(!msg) return;
    const p=players[socket.id]; if(!p) return;
    const entry={ id:socket.id, name:p.name, colorIndex:p.colorIndex, msg, time:Date.now(), isGuest:p.isGuest };
    chatHistory.push(entry); if(chatHistory.length>80) chatHistory.shift();
    io.emit('chat', entry);
  });

  socket.on('emote', (emote) => {
    if (!['👋','❤️','😸','🐟','⭐','💤','🎵'].includes(emote)) return;
    const p=players[socket.id]; if(!p) return; p.emote=emote; p.emoteTimer=120;
    io.emit('emote',{id:socket.id,emote});
  });

  socket.on('startDig', () => {
    const p=players[socket.id]; if(!p||p.digging||p.activeTradeId) return;
    p.digging=true; p.keys={}; p.digStartTime=Date.now();
    io.emit('playerDig',{id:socket.id,digging:true});
    p.digIntervalHandle=setInterval(()=>{
      if(!players[socket.id]) return;
      if(Math.random()<DIG_FIND_CHANCE) handleFind(socket,players[socket.id],rollItem());
    }, DIG_INTERVAL_MS);
    setTimeout(()=>stopDig(socket), DIG_DURATION_MS);
  });
  socket.on('stopDig', ()=>stopDig(socket));
  function stopDig(sock) {
    const p=players[sock.id]; if(!p||!p.digging) return;
    p.digging=false; clearInterval(p.digIntervalHandle); p.digIntervalHandle=null;
    io.emit('playerDig',{id:sock.id,digging:false}); sock.emit('digStopped');
  }

  socket.on('requestProfile', (targetId) => {
    const t=players[targetId]; if(!t) return;
    socket.emit('profileData',{id:t.id,name:t.name,colorIndex:t.colorIndex,color:t.color,coins:t.coins,inventory:t.inventory,joinedAt:t.joinedAt,isGuest:t.isGuest});
  });

  // ── TRADE ──
  socket.on('tradeRequest', (targetId) => {
    const initiator=players[socket.id], target=players[targetId];
    if(!initiator||!target||socket.id===targetId) return;
    if(initiator.activeTradeId){socket.emit('privateMsg',{type:'trade_error',text:'You are already in a trade.'});return;}
    if(target.activeTradeId){socket.emit('privateMsg',{type:'trade_error',text:`${target.name} is already in a trade.`});return;}
    const tradeId=makeId();
    if(!target.pendingTradeFrom)   target.pendingTradeFrom={};
    if(!initiator.pendingTradeTo)  initiator.pendingTradeTo={};
    target.pendingTradeFrom[tradeId]=socket.id; initiator.pendingTradeTo[tradeId]=targetId;
    socket.emit('privateMsg',{type:'trade_sent',text:`Trade request sent to ${target.name}.`,tradeId});
    io.to(targetId).emit('privateMsg',{type:'trade_incoming',text:`${initiator.name} sent you a trade request!`,tradeId,fromId:socket.id,fromName:initiator.name,fromColorIndex:initiator.colorIndex});
  });

  socket.on('tradeAccept', (tradeId) => {
    const target=players[socket.id]; if(!target?.pendingTradeFrom?.[tradeId]) return;
    const initiatorId=target.pendingTradeFrom[tradeId]; const initiator=players[initiatorId];
    if(!initiator){socket.emit('privateMsg',{type:'trade_error',text:'That player is no longer online.'});delete target.pendingTradeFrom[tradeId];return;}
    if(initiator.activeTradeId||target.activeTradeId){socket.emit('privateMsg',{type:'trade_error',text:'One of you is already in a trade.'});return;}
    delete target.pendingTradeFrom[tradeId]; if(initiator.pendingTradeTo) delete initiator.pendingTradeTo[tradeId];
    activeTrades[tradeId]={tradeId,initiatorId,targetId:socket.id,initiatorOffer:{items:[],coins:0},targetOffer:{items:[],coins:0},initiatorAccepted:false,targetAccepted:false};
    initiator.activeTradeId=tradeId; target.activeTradeId=tradeId;
    const is=io.sockets.sockets.get(initiatorId);
    if(is) is.emit('tradeOpen',{tradeId,role:'initiator',partnerId:socket.id,partnerName:target.name,partnerColorIndex:target.colorIndex,myInventory:initiator.inventory,myCoins:initiator.coins,partnerInventory:target.inventory,partnerCoins:target.coins});
    socket.emit('tradeOpen',{tradeId,role:'target',partnerId:initiatorId,partnerName:initiator.name,partnerColorIndex:initiator.colorIndex,myInventory:target.inventory,myCoins:target.coins,partnerInventory:initiator.inventory,partnerCoins:initiator.coins});
  });

  socket.on('tradeDecline',(tradeId)=>{
    const target=players[socket.id]; if(!target?.pendingTradeFrom?.[tradeId]) return;
    const initiatorId=target.pendingTradeFrom[tradeId]; delete target.pendingTradeFrom[tradeId];
    const initiator=players[initiatorId]; if(initiator?.pendingTradeTo) delete initiator.pendingTradeTo[tradeId];
    const is=io.sockets.sockets.get(initiatorId); if(is) is.emit('privateMsg',{type:'trade_declined',text:`${target.name} declined your trade request.`});
  });

  socket.on('tradeUpdateOffer',({tradeId,items,coins})=>{
    const trade=activeTrades[tradeId]; if(!trade) return;
    const p=players[socket.id]; if(!p) return;
    const isInit=trade.initiatorId===socket.id;
    const myOffer=isInit?trade.initiatorOffer:trade.targetOffer;
    myOffer.items=Array.isArray(items)?items:[];
    myOffer.coins=Math.max(0,Math.min(parseInt(coins)||0,p.coins));
    trade.initiatorAccepted=false; trade.targetAccepted=false;
    broadcastTradeState(trade);
  });
  socket.on('tradeAcceptTrade',(tradeId)=>{
    const trade=activeTrades[tradeId]; if(!trade) return;
    const isInit=trade.initiatorId===socket.id; if(isInit) trade.initiatorAccepted=true; else trade.targetAccepted=true;
    broadcastTradeState(trade); if(trade.initiatorAccepted&&trade.targetAccepted) executeTrade(trade);
  });
  socket.on('tradeDeclineTrade',(tradeId)=>{
    const trade=activeTrades[tradeId]; if(!trade) return;
    if(trade.initiatorId!==socket.id&&trade.targetId!==socket.id) return;
    const otherId=trade.initiatorId===socket.id?trade.targetId:trade.initiatorId;
    const p=players[socket.id]; const os=io.sockets.sockets.get(otherId);
    if(os) os.emit('tradeClosed',{tradeId,reason:`${p?.name||'Someone'} declined the trade.`});
    socket.emit('tradeClosed',{tradeId,reason:'You declined the trade.'});
    cleanupTrade(tradeId);
  });

  // ── ROOM EVENTS ──
  // Client requests to enter a room
  socket.on('enterRoom', ({ ownerId }) => {
    const p = players[socket.id]; if (!p) return;
    if (!ownerId) return;

    // Can only enter room if you're the owner OR owner exists in DB
    const owner = db.getUserById(ownerId);
    if (!owner || !owner.verified) { socket.emit('roomError', 'That room does not exist.'); return; }

    // Remove from lobby broadcasts for movement
    p.location  = `room:${ownerId}`;
    p.inRoomId  = ownerId;
    const rpos  = randomSpawn(ROOM_W, ROOM_H);
    p.x = rpos.x; p.y = rpos.y;

    // Init room session if needed
    if (!roomSessions[ownerId]) {
      roomSessions[ownerId] = { ownerId, players: {}, chatHistory: [] };
    }
    const rs = roomSessions[ownerId];
    rs.players[socket.id] = p;

    // Load room data from DB
    const roomData = db.getRoom(ownerId);
    socket.emit('roomInit', {
      ownerId,
      ownerName:   owner.username,
      ownerColorIndex: owner.color_index,
      roomName:    roomData.roomName,
      wallpaper:   roomData.wallpaper,
      flooring:    roomData.flooring,
      placedItems: roomData.placedItems,
      players:     Object.values(rs.players).map(sanitize),
      chatHistory: rs.chatHistory,
      isOwner:     p.dbUserId === ownerId,
    });

    // Notify others in room
    broadcastToRoom(ownerId, 'roomPlayerJoined', sanitize(p), socket.id);
  });

  // Client leaves room → back to lobby
  socket.on('leaveRoom', () => {
    leaveRoom(socket);
  });

  // Room movement keys
  socket.on('roomKeys', (keys) => {
    const p = players[socket.id]; if (!p || !p.inRoomId || p.digging) return;
    p.keys = keys;
  });

  // Room chat
  socket.on('roomChat', (msg) => {
    if (typeof msg !== 'string') return; msg = msg.trim().substring(0,120); if (!msg) return;
    const p = players[socket.id]; if (!p || !p.inRoomId) return;
    const rs = roomSessions[p.inRoomId]; if (!rs) return;
    const entry = { id: socket.id, name: p.name, colorIndex: p.colorIndex, msg, time: Date.now() };
    rs.chatHistory.push(entry); if (rs.chatHistory.length>80) rs.chatHistory.shift();
    broadcastToRoom(p.inRoomId, 'roomChat', entry);
  });

  // Save room layout (owner only)
  socket.on('saveRoom', ({ roomName, wallpaper, flooring, placedItems }) => {
    const p = players[socket.id]; if (!p || !p.dbUserId) return;
    if (!p.inRoomId || p.inRoomId !== p.dbUserId) return; // must be in own room
    db.saveRoom({ userId: p.dbUserId, roomName, wallpaper, flooring, placedItems });
    // Push updated room to all visitors
    broadcastToRoom(p.dbUserId, 'roomUpdated', { roomName, wallpaper, flooring, placedItems });
    socket.emit('roomSaved', { ok: true });
  });

  // Place item in room (owner only, deducts from inventory)
  socket.on('placeItem', ({ itemId, x, y, instanceId }) => {
    const p = players[socket.id]; if (!p || !p.dbUserId) return;
    if (!p.inRoomId || p.inRoomId !== p.dbUserId) return;
    const itemDef = ITEMS_MAP[itemId]; if (!itemDef || !itemDef.placeable) return;
    // Check inventory
    const inv = p.inventory.find(i=>i.id===itemId); if (!inv || inv.qty < 1) { socket.emit('roomError','You don\'t have that item.'); return; }
    // Deduct 1 from inventory
    inv.qty--; if (inv.qty<=0) p.inventory.splice(p.inventory.indexOf(inv),1);
    savePlayer(p);
    // Add to room's placed items
    const roomData = db.getRoom(p.dbUserId);
    const newPlaced = [...roomData.placedItems, { instanceId: instanceId||uuidv4(), itemId, x, y, emoji: itemDef.emoji, label: itemDef.label, rarity: itemDef.rarity, w: itemDef.furniture?.w||40, h: itemDef.furniture?.h||40 }];
    db.saveRoom({ userId: p.dbUserId, roomName: roomData.roomName, wallpaper: roomData.wallpaper, flooring: roomData.flooring, placedItems: newPlaced });
    socket.emit('inventoryUpdate', { inventory: p.inventory, coins: p.coins });
    broadcastToRoom(p.dbUserId, 'roomUpdated', { ...roomData, placedItems: newPlaced });
  });

  // Pick up item from room (owner only, returns to inventory)
  socket.on('pickupItem', ({ instanceId }) => {
    const p = players[socket.id]; if (!p || !p.dbUserId) return;
    if (!p.inRoomId || p.inRoomId !== p.dbUserId) return;
    const roomData = db.getRoom(p.dbUserId);
    const idx = roomData.placedItems.findIndex(i=>i.instanceId===instanceId);
    if (idx === -1) return;
    const item = roomData.placedItems[idx];
    roomData.placedItems.splice(idx, 1);
    // Return to inventory
    const ex = p.inventory.find(i=>i.id===item.itemId);
    const itemDef = ITEMS_MAP[item.itemId];
    if (ex) ex.qty++;
    else p.inventory.push({ id:item.itemId, label:item.label, emoji:item.emoji, rarity:item.rarity||'common', qty:1 });
    savePlayer(p);
    db.saveRoom({ userId: p.dbUserId, roomName: roomData.roomName, wallpaper: roomData.wallpaper, flooring: roomData.flooring, placedItems: roomData.placedItems });
    socket.emit('inventoryUpdate', { inventory: p.inventory, coins: p.coins });
    broadcastToRoom(p.dbUserId, 'roomUpdated', { ...roomData });
  });

  socket.on('disconnect', () => {
    const p = players[socket.id];
    if (p) {
      if (p.dbUserId) savePlayer(p);
      if (p.digIntervalHandle) clearInterval(p.digIntervalHandle);
      if (p.activeTradeId) {
        const t = activeTrades[p.activeTradeId];
        if (t) {
          const otherId = t.initiatorId===socket.id?t.targetId:t.initiatorId;
          const os = io.sockets.sockets.get(otherId);
          if (os) os.emit('tradeClosed',{tradeId:p.activeTradeId,reason:'Trade partner disconnected.'});
          cleanupTrade(p.activeTradeId);
        }
      }
      if (p.inRoomId) {
        const rs = roomSessions[p.inRoomId];
        if (rs) {
          delete rs.players[socket.id];
          broadcastToRoom(p.inRoomId, 'roomPlayerLeft', socket.id);
          if (Object.keys(rs.players).length === 0) delete roomSessions[p.inRoomId];
        }
      }
    }
    delete players[socket.id];
    io.emit('playerLeft', socket.id);
  });
});

// ────────────────────────────────────────────────────────────
//  ROOM HELPERS
// ────────────────────────────────────────────────────────────
function leaveRoom(socket) {
  const p = players[socket.id]; if (!p || !p.inRoomId) return;
  const ownerId = p.inRoomId;
  const rs = roomSessions[ownerId];
  if (rs) {
    delete rs.players[socket.id];
    broadcastToRoom(ownerId, 'roomPlayerLeft', socket.id, socket.id);
    if (Object.keys(rs.players).length === 0) delete roomSessions[ownerId];
  }
  p.location = 'lobby'; p.inRoomId = null;
  const lpos = randomSpawn(WORLD_W, WORLD_H); p.x = lpos.x; p.y = lpos.y;
  socket.emit('backToLobby', { x: p.x, y: p.y });
}

function broadcastToRoom(ownerId, event, data, excludeSocketId) {
  const rs = roomSessions[ownerId]; if (!rs) return;
  for (const sid of Object.keys(rs.players)) {
    if (sid === excludeSocketId) continue;
    const sock = io.sockets.sockets.get(sid);
    if (sock) sock.emit(event, data);
  }
}

// Get who is currently online in each room (for directory)
app.get('/api/rooms-online', (req, res) => {
  const online = {};
  for (const [ownerId, rs] of Object.entries(roomSessions)) {
    online[ownerId] = Object.values(rs.players).map(p => ({ id: p.id, name: p.name, colorIndex: p.colorIndex }));
  }
  res.json({ ok: true, online });
});

// ────────────────────────────────────────────────────────────
//  TRADE HELPERS
// ────────────────────────────────────────────────────────────
const activeTrades = {};
function makeId() { return Math.random().toString(36).slice(2,10); }

function broadcastTradeState(trade) {
  const is=io.sockets.sockets.get(trade.initiatorId), ts=io.sockets.sockets.get(trade.targetId);
  if(is) is.emit('tradeState',{tradeId:trade.tradeId,myOffer:trade.initiatorOffer,partnerOffer:trade.targetOffer,myAccepted:trade.initiatorAccepted,partnerAccepted:trade.targetAccepted});
  if(ts) ts.emit('tradeState',{tradeId:trade.tradeId,myOffer:trade.targetOffer,partnerOffer:trade.initiatorOffer,myAccepted:trade.targetAccepted,partnerAccepted:trade.initiatorAccepted});
}
function executeTrade(trade) {
  const init=players[trade.initiatorId], targ=players[trade.targetId];
  if(!init||!targ){cleanupTrade(trade.tradeId);return;}
  const iO=trade.initiatorOffer, tO=trade.targetOffer;
  for(const o of iO.items){const inv=init.inventory.find(i=>i.id===o.id);if(!inv||inv.qty<o.qty){notifyTradeError(trade,trade.initiatorId,'Your inventory changed.');cleanupTrade(trade.tradeId);return;}}
  if(init.coins<iO.coins){notifyTradeError(trade,trade.initiatorId,'Not enough coins.');cleanupTrade(trade.tradeId);return;}
  for(const o of tO.items){const inv=targ.inventory.find(i=>i.id===o.id);if(!inv||inv.qty<o.qty){notifyTradeError(trade,trade.targetId,'Partner inventory changed.');cleanupTrade(trade.tradeId);return;}}
  if(targ.coins<tO.coins){notifyTradeError(trade,trade.targetId,'Partner not enough coins.');cleanupTrade(trade.tradeId);return;}
  for(const o of iO.items){rmItem(init,o.id,o.qty);addItem(targ,o);}
  for(const o of tO.items){rmItem(targ,o.id,o.qty);addItem(init,o);}
  init.coins=init.coins-iO.coins+tO.coins; targ.coins=targ.coins-tO.coins+iO.coins;
  if(init.dbUserId) savePlayer(init); if(targ.dbUserId) savePlayer(targ);
  const is=io.sockets.sockets.get(trade.initiatorId), ts=io.sockets.sockets.get(trade.targetId);
  if(is) is.emit('tradeComplete',{tradeId:trade.tradeId,inventory:init.inventory,coins:init.coins});
  if(ts) ts.emit('tradeComplete',{tradeId:trade.tradeId,inventory:targ.inventory,coins:targ.coins});
  cleanupTrade(trade.tradeId);
}
function notifyTradeError(trade,pid,msg){const s=io.sockets.sockets.get(pid);if(s)s.emit('tradeClosed',{tradeId:trade.tradeId,reason:msg});const oid=trade.initiatorId===pid?trade.targetId:trade.initiatorId;const os=io.sockets.sockets.get(oid);if(os)os.emit('tradeClosed',{tradeId:trade.tradeId,reason:'Trade cancelled.'});}
function addItem(p,item){const ex=p.inventory.find(i=>i.id===item.id);if(ex)ex.qty+=item.qty;else p.inventory.push({id:item.id,label:item.label,emoji:item.emoji,rarity:item.rarity,qty:item.qty});}
function rmItem(p,itemId,qty){const idx=p.inventory.findIndex(i=>i.id===itemId);if(idx===-1)return;p.inventory[idx].qty-=qty;if(p.inventory[idx].qty<=0)p.inventory.splice(idx,1);}
function cleanupTrade(tradeId){const t=activeTrades[tradeId];if(!t)return;if(players[t.initiatorId])players[t.initiatorId].activeTradeId=null;if(players[t.targetId])players[t.targetId].activeTradeId=null;delete activeTrades[tradeId];}

function handleFind(socket,p,item){
  if(item.type==='nothing'){socket.emit('digFind',{type:'nothing',label:item.label,emoji:item.emoji});return;}
  if(item.type==='coin'){p.coins+=item.value;socket.emit('digFind',{type:'coin',label:item.label,emoji:item.emoji,value:item.value,totalCoins:p.coins});return;}
  const ex=p.inventory.find(i=>i.id===item.id);
  if(ex)ex.qty++;else p.inventory.push({id:item.id,label:item.label,emoji:item.emoji,rarity:item.rarity,qty:1});
  socket.emit('digFind',{type:'item',id:item.id,label:item.label,emoji:item.emoji,rarity:item.rarity,inventory:p.inventory});
}

function sanitize(p){return{id:p.id,x:p.x,y:p.y,name:p.name,color:p.color,colorIndex:p.colorIndex,emote:p.emote,digging:p.digging,coins:p.coins,isGuest:p.isGuest,location:p.location};}

// ────────────────────────────────────────────────────────────
//  GAME LOOP  (lobby + rooms)
// ────────────────────────────────────────────────────────────
setInterval(() => {
  // Lobby players
  const lobbyUpdates = [];
  for (const id in players) {
    const p = players[id]; if (p.inRoomId) continue; // skip room players in lobby tick
    if (!p.digging) {
      const k=p.keys||{};
      if(k.left)p.x-=SPEED; if(k.right)p.x+=SPEED; if(k.up)p.y-=SPEED; if(k.down)p.y+=SPEED;
      p.x=Math.max(16,Math.min(WORLD_W-16,p.x)); p.y=Math.max(16,Math.min(WORLD_H-16,p.y));
    }
    if(p.emoteTimer>0){p.emoteTimer--;if(p.emoteTimer===0)p.emote=null;}
    lobbyUpdates.push({id:p.id,x:p.x,y:p.y,emote:p.emote,digging:p.digging});
  }
  if (lobbyUpdates.length) io.emit('tick', lobbyUpdates);

  // Room players per room
  for (const [ownerId, rs] of Object.entries(roomSessions)) {
    const roomUpdates = [];
    for (const p of Object.values(rs.players)) {
      if (!p.digging) {
        const k=p.keys||{};
        if(k.left)p.x-=SPEED; if(k.right)p.x+=SPEED; if(k.up)p.y-=SPEED; if(k.down)p.y+=SPEED;
        p.x=Math.max(16,Math.min(ROOM_W-16,p.x)); p.y=Math.max(16,Math.min(ROOM_H-16,p.y));
      }
      if(p.emoteTimer>0){p.emoteTimer--;if(p.emoteTimer===0)p.emote=null;}
      roomUpdates.push({id:p.id,x:p.x,y:p.y,emote:p.emote,digging:p.digging});
    }
    if (roomUpdates.length) broadcastToRoom(ownerId, 'roomTick', roomUpdates);
  }
}, 1000/TICK_RATE);

server.listen(PORT, () => {
  const fs=require('fs'), ok=fs.existsSync(path.join(__dirname,'public','index.html'));
  console.log(`🐱 Cat Lobby running at ${APP_URL}`);
  console.log(`📄 index.html: ${ok?'✅':'❌ MISSING'}`);
  if(!process.env.SMTP_USER) console.warn('⚠️  SMTP not configured');
});
