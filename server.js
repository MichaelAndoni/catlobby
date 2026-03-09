const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));
app.get('/', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

const PORT = process.env.PORT || 3000;
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

const players = {};
const chatHistory = [];
const activeTrades = {}; // tradeId -> trade object

function randomSpawn() {
  return { x: 40 + Math.random()*(WORLD_W-80), y: 40 + Math.random()*(WORLD_H-80) };
}
function makeId() { return Math.random().toString(36).slice(2,10); }

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
  };

  socket.emit('init', {
    id: socket.id,
    players: Object.values(players).map(sanitize),
    chatHistory, worldW: WORLD_W, worldH: WORLD_H,
  });
  socket.broadcast.emit('playerJoined', sanitize(players[socket.id]));

  // NAME
  socket.on('setName', (name) => {
    if (typeof name !== 'string') return;
    players[socket.id].name = name.trim().substring(0,16) || 'Cat';
    io.emit('playerUpdate', sanitize(players[socket.id]));
  });

  // MOVEMENT
  socket.on('keys', (keys) => {
    const p = players[socket.id];
    if (!p || p.digging) return;
    p.keys = keys;
  });

  // CHAT
  socket.on('chat', (msg) => {
    if (typeof msg !== 'string') return;
    msg = msg.trim().substring(0,120);
    if (!msg) return;
    const p = players[socket.id];
    if (!p) return;
    const entry = { id: socket.id, name: p.name, colorIndex: p.colorIndex, msg, time: Date.now() };
    chatHistory.push(entry);
    if (chatHistory.length > 80) chatHistory.shift();
    io.emit('chat', entry);
  });

  // EMOTE
  socket.on('emote', (emote) => {
    const valid = ['👋','❤️','😸','🐟','⭐','💤','🎵'];
    if (!valid.includes(emote)) return;
    const p = players[socket.id];
    if (!p) return;
    p.emote = emote; p.emoteTimer = 120;
    io.emit('emote', { id: socket.id, emote });
  });

  // DIG
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

  // REQUEST PROFILE
  socket.on('requestProfile', (targetId) => {
    const target = players[targetId];
    if (!target) return;
    socket.emit('profileData', {
      id: target.id, name: target.name,
      colorIndex: target.colorIndex, color: target.color,
      coins: target.coins, inventory: target.inventory,
      joinedAt: target.joinedAt,
    });
  });

  // ─────────── TRADE ───────────

  // Step 1: Send trade request
  socket.on('tradeRequest', (targetId) => {
    const initiator = players[socket.id];
    const target    = players[targetId];
    if (!initiator || !target || socket.id === targetId) return;
    if (initiator.activeTradeId) {
      socket.emit('privateMsg', { type:'trade_error', text:'You are already in a trade.' });
      return;
    }
    if (target.activeTradeId) {
      socket.emit('privateMsg', { type:'trade_error', text:`${target.name} is already in a trade.` });
      return;
    }

    const tradeId = makeId();
    // Don't create trade object yet — just send the request notification
    // Store pending on the target so they can accept/decline
    if (!target.pendingTradeFrom) target.pendingTradeFrom = {};
    target.pendingTradeFrom[tradeId] = socket.id;
    if (!initiator.pendingTradeTo) initiator.pendingTradeTo = {};
    initiator.pendingTradeTo[tradeId] = targetId;

    // Notify initiator privately in chat
    socket.emit('privateMsg', {
      type: 'trade_sent',
      text: `Trade request sent to ${target.name}.`,
      tradeId,
    });

    // Notify target privately in chat with accept/decline
    io.to(targetId).emit('privateMsg', {
      type: 'trade_incoming',
      text: `${initiator.name} sent you a trade request!`,
      tradeId,
      fromId: socket.id,
      fromName: initiator.name,
      fromColorIndex: initiator.colorIndex,
    });
  });

  // Step 2: Target accepts
  socket.on('tradeAccept', (tradeId) => {
    const target    = players[socket.id];
    if (!target || !target.pendingTradeFrom || !target.pendingTradeFrom[tradeId]) return;
    const initiatorId = target.pendingTradeFrom[tradeId];
    const initiator   = players[initiatorId];
    if (!initiator) {
      socket.emit('privateMsg', { type:'trade_error', text:'That player is no longer online.' });
      delete target.pendingTradeFrom[tradeId];
      return;
    }
    if (initiator.activeTradeId || target.activeTradeId) {
      socket.emit('privateMsg', { type:'trade_error', text:'One of you is already in a trade.' });
      return;
    }

    // Clean up pending
    delete target.pendingTradeFrom[tradeId];
    if (initiator.pendingTradeTo) delete initiator.pendingTradeTo[tradeId];

    // Create trade
    activeTrades[tradeId] = {
      tradeId,
      initiatorId, targetId: socket.id,
      initiatorOffer: { items:[], coins:0 },
      targetOffer:    { items:[], coins:0 },
      initiatorAccepted: false,
      targetAccepted:    false,
    };
    initiator.activeTradeId = tradeId;
    target.activeTradeId    = tradeId;

    const initSock = io.sockets.sockets.get(initiatorId);

    // Open trade window for initiator
    if (initSock) {
      initSock.emit('tradeOpen', {
        tradeId, role:'initiator',
        partnerId: socket.id, partnerName: target.name, partnerColorIndex: target.colorIndex,
        myInventory: initiator.inventory, myCoins: initiator.coins,
        partnerInventory: target.inventory, partnerCoins: target.coins,
      });
    }
    // Open trade window for target
    socket.emit('tradeOpen', {
      tradeId, role:'target',
      partnerId: initiatorId, partnerName: initiator.name, partnerColorIndex: initiator.colorIndex,
      myInventory: target.inventory, myCoins: target.coins,
      partnerInventory: initiator.inventory, partnerCoins: initiator.coins,
    });
  });

  // Step 3: Target declines
  socket.on('tradeDecline', (tradeId) => {
    const target = players[socket.id];
    if (!target || !target.pendingTradeFrom || !target.pendingTradeFrom[tradeId]) return;
    const initiatorId = target.pendingTradeFrom[tradeId];
    delete target.pendingTradeFrom[tradeId];
    const initiator = players[initiatorId];
    if (initiator && initiator.pendingTradeTo) delete initiator.pendingTradeTo[tradeId];

    // Tell initiator privately
    const initSock = io.sockets.sockets.get(initiatorId);
    if (initSock) {
      initSock.emit('privateMsg', {
        type: 'trade_declined',
        text: `${target.name} declined your trade request.`,
      });
    }
  });

  // Step 4: Update offer in real-time
  socket.on('tradeUpdateOffer', ({ tradeId, items, coins }) => {
    const trade = activeTrades[tradeId];
    if (!trade) return;
    const p = players[socket.id];
    if (!p) return;
    const isInit = trade.initiatorId === socket.id;
    const myOffer = isInit ? trade.initiatorOffer : trade.targetOffer;
    myOffer.items = Array.isArray(items) ? items : [];
    myOffer.coins = Math.max(0, Math.min(parseInt(coins)||0, p.coins));
    // Reset accepted states when offer changes
    trade.initiatorAccepted = false;
    trade.targetAccepted    = false;

    broadcastTradeState(trade);
  });

  // Step 5: Accept trade (both must accept)
  socket.on('tradeAcceptTrade', (tradeId) => {
    const trade = activeTrades[tradeId];
    if (!trade) return;
    const isInit = trade.initiatorId === socket.id;
    if (isInit) trade.initiatorAccepted = true;
    else         trade.targetAccepted   = true;

    broadcastTradeState(trade);

    if (trade.initiatorAccepted && trade.targetAccepted) {
      executeTrade(trade);
    }
  });

  // Step 6: Decline active trade
  socket.on('tradeDeclineTrade', (tradeId) => {
    const trade = activeTrades[tradeId];
    if (!trade) return;
    if (trade.initiatorId !== socket.id && trade.targetId !== socket.id) return;
    const otherId = trade.initiatorId === socket.id ? trade.targetId : trade.initiatorId;
    const p = players[socket.id];
    const name = p ? p.name : 'Someone';
    const otherSock = io.sockets.sockets.get(otherId);
    if (otherSock) otherSock.emit('tradeClosed', { tradeId, reason:`${name} declined the trade.` });
    socket.emit('tradeClosed', { tradeId, reason:'You declined the trade.' });
    cleanupTrade(tradeId);
  });

  // DISCONNECT
  socket.on('disconnect', () => {
    const p = players[socket.id];
    if (p) {
      if (p.digIntervalHandle) clearInterval(p.digIntervalHandle);
      if (p.activeTradeId) {
        const trade = activeTrades[p.activeTradeId];
        if (trade) {
          const otherId = trade.initiatorId === socket.id ? trade.targetId : trade.initiatorId;
          const otherSock = io.sockets.sockets.get(otherId);
          if (otherSock) otherSock.emit('tradeClosed', { tradeId: p.activeTradeId, reason:'Trade partner disconnected.' });
          cleanupTrade(p.activeTradeId);
        }
      }
    }
    delete players[socket.id];
    io.emit('playerLeft', socket.id);
  });
});

function broadcastTradeState(trade) {
  const initSock = io.sockets.sockets.get(trade.initiatorId);
  const targSock = io.sockets.sockets.get(trade.targetId);
  if (initSock) initSock.emit('tradeState', {
    tradeId: trade.tradeId,
    myOffer: trade.initiatorOffer, partnerOffer: trade.targetOffer,
    myAccepted: trade.initiatorAccepted, partnerAccepted: trade.targetAccepted,
  });
  if (targSock) targSock.emit('tradeState', {
    tradeId: trade.tradeId,
    myOffer: trade.targetOffer, partnerOffer: trade.initiatorOffer,
    myAccepted: trade.targetAccepted, partnerAccepted: trade.initiatorAccepted,
  });
}

function executeTrade(trade) {
  const initiator = players[trade.initiatorId];
  const target    = players[trade.targetId];
  if (!initiator || !target) { cleanupTrade(trade.tradeId); return; }

  const iOffer = trade.initiatorOffer;
  const tOffer = trade.targetOffer;

  // Validate
  for (const o of iOffer.items) {
    const inv = initiator.inventory.find(i => i.id === o.id);
    if (!inv || inv.qty < o.qty) {
      notifyTradeError(trade, trade.initiatorId, 'Your inventory changed. Trade cancelled.');
      cleanupTrade(trade.tradeId); return;
    }
  }
  if (initiator.coins < iOffer.coins) {
    notifyTradeError(trade, trade.initiatorId, "You don't have enough coins. Trade cancelled.");
    cleanupTrade(trade.tradeId); return;
  }
  for (const o of tOffer.items) {
    const inv = target.inventory.find(i => i.id === o.id);
    if (!inv || inv.qty < o.qty) {
      notifyTradeError(trade, trade.targetId, 'Partner inventory changed. Trade cancelled.');
      cleanupTrade(trade.tradeId); return;
    }
  }
  if (target.coins < tOffer.coins) {
    notifyTradeError(trade, trade.targetId, "Partner doesn't have enough coins. Trade cancelled.");
    cleanupTrade(trade.tradeId); return;
  }

  // Transfer
  for (const o of iOffer.items) { removeItem(initiator, o.id, o.qty); addItem(target, o); }
  for (const o of tOffer.items) { removeItem(target, o.id, o.qty); addItem(initiator, o); }
  initiator.coins = initiator.coins - iOffer.coins + tOffer.coins;
  target.coins    = target.coins    - tOffer.coins + iOffer.coins;

  const initSock = io.sockets.sockets.get(trade.initiatorId);
  const targSock = io.sockets.sockets.get(trade.targetId);
  if (initSock) initSock.emit('tradeComplete', { tradeId: trade.tradeId, inventory: initiator.inventory, coins: initiator.coins });
  if (targSock) targSock.emit('tradeComplete', { tradeId: trade.tradeId, inventory: target.inventory,   coins: target.coins    });
  cleanupTrade(trade.tradeId);
}

function notifyTradeError(trade, playerId, msg) {
  const s = io.sockets.sockets.get(playerId);
  if (s) s.emit('tradeClosed', { tradeId: trade.tradeId, reason: msg });
  const otherId = trade.initiatorId === playerId ? trade.targetId : trade.initiatorId;
  const os = io.sockets.sockets.get(otherId);
  if (os) os.emit('tradeClosed', { tradeId: trade.tradeId, reason: 'Trade was cancelled due to an inventory issue.' });
}

function addItem(player, item) {
  const ex = player.inventory.find(i => i.id === item.id);
  if (ex) ex.qty += item.qty;
  else player.inventory.push({ id:item.id, label:item.label, emoji:item.emoji, rarity:item.rarity, qty:item.qty });
}
function removeItem(player, itemId, qty) {
  const idx = player.inventory.findIndex(i => i.id === itemId);
  if (idx === -1) return;
  player.inventory[idx].qty -= qty;
  if (player.inventory[idx].qty <= 0) player.inventory.splice(idx, 1);
}
function cleanupTrade(tradeId) {
  const t = activeTrades[tradeId];
  if (!t) return;
  if (players[t.initiatorId]) players[t.initiatorId].activeTradeId = null;
  if (players[t.targetId])    players[t.targetId].activeTradeId    = null;
  delete activeTrades[tradeId];
}

function handleFind(socket, p, item) {
  if (item.type === 'nothing') { socket.emit('digFind', { type:'nothing', label:item.label, emoji:item.emoji }); return; }
  if (item.type === 'coin') {
    p.coins += item.value;
    socket.emit('digFind', { type:'coin', label:item.label, emoji:item.emoji, value:item.value, totalCoins:p.coins }); return;
  }
  const ex = p.inventory.find(i => i.id === item.id);
  if (ex) ex.qty++;
  else p.inventory.push({ id:item.id, label:item.label, emoji:item.emoji, rarity:item.rarity, qty:1 });
  socket.emit('digFind', { type:'item', id:item.id, label:item.label, emoji:item.emoji, rarity:item.rarity, inventory:p.inventory });
}

function sanitize(p) {
  return { id:p.id, x:p.x, y:p.y, name:p.name, color:p.color, colorIndex:p.colorIndex, emote:p.emote, digging:p.digging, coins:p.coins };
}

setInterval(() => {
  const updates = [];
  for (const id in players) {
    const p = players[id];
    if (!p.digging) {
      const k = p.keys||{};
      if (k.left)  p.x -= SPEED;
      if (k.right) p.x += SPEED;
      if (k.up)    p.y -= SPEED;
      if (k.down)  p.y += SPEED;
      p.x = Math.max(16, Math.min(WORLD_W-16, p.x));
      p.y = Math.max(16, Math.min(WORLD_H-16, p.y));
    }
    if (p.emoteTimer > 0) { p.emoteTimer--; if (p.emoteTimer===0) p.emote=null; }
    updates.push({ id:p.id, x:p.x, y:p.y, emote:p.emote, digging:p.digging });
  }
  if (updates.length) io.emit('tick', updates);
}, 1000/TICK_RATE);

server.listen(PORT, () => {
  const fs = require('fs');
  const exists = fs.existsSync(path.join(__dirname,'public','index.html'));
  console.log(`🐱 Cat Lobby running at http://localhost:${PORT}`);
  console.log(`📁 Serving from: ${path.join(__dirname,'public')}`);
  console.log(`📄 index.html found: ${exists ? '✅ YES' : '❌ NO'}`);
});
