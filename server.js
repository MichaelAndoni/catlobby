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
const WORLD_W = 780;
const WORLD_H = 560;
const SPEED = 3;
const TICK_RATE = 60;

// ── ITEM DEFINITIONS ──
const ITEMS = [
  // Coins (special — go to coin purse not inventory)
  { id: 'coins_1',   type: 'coin',    label: '1 Coin',            emoji: '🪙',  value: 1,   weight: 40 },
  { id: 'coins_3',   type: 'coin',    label: '3 Coins',           emoji: '🪙',  value: 3,   weight: 20 },
  { id: 'coins_10',  type: 'coin',    label: '10 Coins',          emoji: '💰',  value: 10,  weight: 8  },

  // Common items
  { id: 'worm',      type: 'item',    label: 'Wriggling Worm',    emoji: '🪱',  rarity: 'common',    weight: 30 },
  { id: 'pebble',    type: 'item',    label: 'Smooth Pebble',     emoji: '🪨',  rarity: 'common',    weight: 28 },
  { id: 'bone',      type: 'item',    label: 'Old Bone',          emoji: '🦴',  rarity: 'common',    weight: 25 },
  { id: 'leaf',      type: 'item',    label: 'Fossil Leaf',       emoji: '🍂',  rarity: 'common',    weight: 22 },
  { id: 'acorn',     type: 'item',    label: 'Lucky Acorn',       emoji: '🌰',  rarity: 'common',    weight: 20 },

  // Uncommon items
  { id: 'mushroom',  type: 'item',    label: 'Magic Mushroom',    emoji: '🍄',  rarity: 'uncommon',  weight: 12 },
  { id: 'crystal',   type: 'item',    label: 'Blue Crystal',      emoji: '💎',  rarity: 'uncommon',  weight: 10 },
  { id: 'fossil',    type: 'item',    label: 'Tiny Fossil',       emoji: '🦕',  rarity: 'uncommon',  weight: 9  },
  { id: 'bottle',    type: 'item',    label: 'Message in Bottle', emoji: '🍶',  rarity: 'uncommon',  weight: 8  },

  // Rare items
  { id: 'gem',       type: 'item',    label: 'Ancient Gem',       emoji: '💍',  rarity: 'rare',      weight: 4  },
  { id: 'crown',     type: 'item',    label: 'Tiny Crown',        emoji: '👑',  rarity: 'rare',      weight: 3  },
  { id: 'map',       type: 'item',    label: 'Treasure Map',      emoji: '🗺️',  rarity: 'rare',      weight: 3  },
  { id: 'potion',    type: 'item',    label: 'Mystery Potion',    emoji: '🧪',  rarity: 'rare',      weight: 2  },

  // Legendary items
  { id: 'star',      type: 'item',    label: 'Fallen Star',       emoji: '⭐',  rarity: 'legendary', weight: 1  },
  { id: 'fish_gold', type: 'item',    label: 'Golden Fish',       emoji: '🐠',  rarity: 'legendary', weight: 1  },
  { id: 'catbell',   type: 'item',    label: 'Ancient Cat Bell',  emoji: '🔔',  rarity: 'legendary', weight: 1  },

  // Nothing
  { id: 'nothing',   type: 'nothing', label: 'Just Dirt',         emoji: '💨',  weight: 35 },
];

const TOTAL_WEIGHT = ITEMS.reduce((s, i) => s + i.weight, 0);

function rollItem() {
  let r = Math.random() * TOTAL_WEIGHT;
  for (const item of ITEMS) {
    r -= item.weight;
    if (r <= 0) return item;
  }
  return ITEMS[ITEMS.length - 1];
}

const DIG_DURATION_MS = 15000;
const DIG_INTERVAL_MS = 3000;
const DIG_FIND_CHANCE = 0.55;

const CAT_COLORS = [
  { body: '#f4a261', ear: '#e07a2f', stripe: '#d4813f', name: 'Orange' },
  { body: '#a8dadc', ear: '#6cbfc3', stripe: '#89c8ca', name: 'Blue'   },
  { body: '#c9b1ff', ear: '#a07dff', stripe: '#b396ff', name: 'Purple' },
  { body: '#ffd6e0', ear: '#ffb3c6', stripe: '#ffbed5', name: 'Pink'   },
  { body: '#b7e4c7', ear: '#74c69d', stripe: '#95d6b0', name: 'Green'  },
  { body: '#f8edeb', ear: '#d9c4c0', stripe: '#e8d8d5', name: 'White'  },
  { body: '#9d8ca1', ear: '#6d6875', stripe: '#8a7a8e', name: 'Gray'   },
  { body: '#e9c46a', ear: '#c9a227', stripe: '#d4ad47', name: 'Yellow' },
];

const players = {};
const chatHistory = [];

function randomSpawn() {
  return {
    x: 40 + Math.random() * (WORLD_W - 80),
    y: 40 + Math.random() * (WORLD_H - 80),
  };
}

io.on('connection', (socket) => {
  const pos = randomSpawn();
  const colorIndex = Math.floor(Math.random() * CAT_COLORS.length);

  players[socket.id] = {
    id: socket.id,
    x: pos.x,
    y: pos.y,
    name: 'Cat',
    color: CAT_COLORS[colorIndex],
    colorIndex,
    keys: {},
    emote: null,
    emoteTimer: 0,
    digging: false,
    digStartTime: 0,
    digIntervalHandle: null,
    coins: 0,
    inventory: [],
  };

  socket.emit('init', {
    id: socket.id,
    players: Object.values(players).map(sanitize),
    chatHistory,
    worldW: WORLD_W,
    worldH: WORLD_H,
  });

  socket.broadcast.emit('playerJoined', sanitize(players[socket.id]));

  socket.on('setName', (name) => {
    if (typeof name !== 'string') return;
    players[socket.id].name = name.trim().substring(0, 16) || 'Cat';
    io.emit('playerUpdate', sanitize(players[socket.id]));
  });

  socket.on('keys', (keys) => {
    const p = players[socket.id];
    if (!p || p.digging) return;
    p.keys = keys;
  });

  socket.on('chat', (msg) => {
    if (typeof msg !== 'string') return;
    msg = msg.trim().substring(0, 120);
    if (!msg) return;
    const p = players[socket.id];
    if (!p) return;
    const entry = { id: socket.id, name: p.name, colorIndex: p.colorIndex, msg, time: Date.now() };
    chatHistory.push(entry);
    if (chatHistory.length > 80) chatHistory.shift();
    io.emit('chat', entry);
  });

  socket.on('emote', (emote) => {
    const valid = ['👋','❤️','😸','🐟','⭐','💤','🎵'];
    if (!valid.includes(emote)) return;
    const p = players[socket.id];
    if (!p) return;
    p.emote = emote;
    p.emoteTimer = 120;
    io.emit('emote', { id: socket.id, emote });
  });

  socket.on('startDig', () => {
    const p = players[socket.id];
    if (!p || p.digging) return;
    p.digging = true;
    p.keys = {};
    p.digStartTime = Date.now();
    io.emit('playerDig', { id: socket.id, digging: true });

    p.digIntervalHandle = setInterval(() => {
      if (!players[socket.id]) return;
      if (Math.random() < DIG_FIND_CHANCE) {
        const found = rollItem();
        handleFind(socket, players[socket.id], found);
      }
    }, DIG_INTERVAL_MS);

    setTimeout(() => stopDig(socket), DIG_DURATION_MS);
  });

  socket.on('stopDig', () => stopDig(socket));

  function stopDig(sock) {
    const p = players[sock.id];
    if (!p || !p.digging) return;
    p.digging = false;
    clearInterval(p.digIntervalHandle);
    p.digIntervalHandle = null;
    io.emit('playerDig', { id: sock.id, digging: false });
    sock.emit('digStopped');
  }

  socket.on('disconnect', () => {
    const p = players[socket.id];
    if (p && p.digIntervalHandle) clearInterval(p.digIntervalHandle);
    delete players[socket.id];
    io.emit('playerLeft', socket.id);
  });
});

function handleFind(socket, p, item) {
  if (item.type === 'nothing') {
    socket.emit('digFind', { type: 'nothing', label: item.label, emoji: item.emoji });
    return;
  }
  if (item.type === 'coin') {
    p.coins += item.value;
    socket.emit('digFind', { type: 'coin', label: item.label, emoji: item.emoji, value: item.value, totalCoins: p.coins });
    return;
  }
  const existing = p.inventory.find(i => i.id === item.id);
  if (existing) {
    existing.qty++;
  } else {
    p.inventory.push({ id: item.id, label: item.label, emoji: item.emoji, rarity: item.rarity, qty: 1 });
  }
  socket.emit('digFind', {
    type: 'item',
    id: item.id,
    label: item.label,
    emoji: item.emoji,
    rarity: item.rarity,
    inventory: p.inventory,
  });
}

function sanitize(p) {
  return {
    id: p.id, x: p.x, y: p.y,
    name: p.name, color: p.color, colorIndex: p.colorIndex,
    emote: p.emote, digging: p.digging,
    coins: p.coins,
  };
}

setInterval(() => {
  const updates = [];
  for (const id in players) {
    const p = players[id];
    if (!p.digging) {
      const k = p.keys || {};
      if (k.left)  p.x -= SPEED;
      if (k.right) p.x += SPEED;
      if (k.up)    p.y -= SPEED;
      if (k.down)  p.y += SPEED;
      p.x = Math.max(16, Math.min(WORLD_W - 16, p.x));
      p.y = Math.max(16, Math.min(WORLD_H - 16, p.y));
    }
    if (p.emoteTimer > 0) {
      p.emoteTimer--;
      if (p.emoteTimer === 0) p.emote = null;
    }
    updates.push({ id: p.id, x: p.x, y: p.y, emote: p.emote, digging: p.digging });
  }
  if (updates.length) io.emit('tick', updates);
}, 1000 / TICK_RATE);

server.listen(PORT, () => {
  const fs = require('fs');
  const exists = fs.existsSync(path.join(__dirname, 'public', 'index.html'));
  console.log(`🐱 Cat Lobby running at http://localhost:${PORT}`);
  console.log(`📁 Serving from: ${path.join(__dirname, 'public')}`);
  console.log(`📄 index.html found: ${exists ? '✅ YES' : '❌ NO — make sure public/index.html exists!'}`);
});
