const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

// Explicit fallback so "/" always serves index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

const PORT = process.env.PORT || 3000;
const WORLD_W = 780;
const WORLD_H = 560;
const SPEED = 3;
const TICK_RATE = 60;

const CAT_COLORS = [
  { body: '#f4a261', ear: '#e07a2f', name: 'Orange' },
  { body: '#a8dadc', ear: '#6cbfc3', name: 'Blue' },
  { body: '#c9b1ff', ear: '#a07dff', name: 'Purple' },
  { body: '#ffd6e0', ear: '#ffb3c6', name: 'Pink' },
  { body: '#b7e4c7', ear: '#74c69d', name: 'Green' },
  { body: '#f8edeb', ear: '#d9c4c0', name: 'White' },
  { body: '#6d6875', ear: '#4a4455', name: 'Gray' },
  { body: '#e9c46a', ear: '#c9a227', name: 'Yellow' },
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
  const color = CAT_COLORS[colorIndex];

  players[socket.id] = {
    id: socket.id,
    x: pos.x,
    y: pos.y,
    name: 'Cat',
    color: color,
    colorIndex,
    keys: {},
    emote: null,
    emoteTimer: 0,
  };

  // Send existing state to new player
  socket.emit('init', {
    id: socket.id,
    players: Object.values(players).map(p => sanitize(p)),
    chatHistory,
    worldW: WORLD_W,
    worldH: WORLD_H,
  });

  // Announce to others
  socket.broadcast.emit('playerJoined', sanitize(players[socket.id]));

  socket.on('setName', (name) => {
    if (typeof name !== 'string') return;
    name = name.trim().substring(0, 16) || 'Cat';
    players[socket.id].name = name;
    io.emit('playerUpdate', sanitize(players[socket.id]));
  });

  socket.on('keys', (keys) => {
    if (players[socket.id]) {
      players[socket.id].keys = keys;
    }
  });

  socket.on('chat', (msg) => {
    if (typeof msg !== 'string') return;
    msg = msg.trim().substring(0, 120);
    if (!msg) return;
    const p = players[socket.id];
    if (!p) return;
    const entry = {
      id: socket.id,
      name: p.name,
      colorIndex: p.colorIndex,
      msg,
      time: Date.now(),
    };
    chatHistory.push(entry);
    if (chatHistory.length > 80) chatHistory.shift();
    io.emit('chat', entry);
  });

  socket.on('emote', (emote) => {
    const valid = ['👋','❤️','😸','🐟','⭐','💤','🎵'];
    if (!valid.includes(emote)) return;
    if (players[socket.id]) {
      players[socket.id].emote = emote;
      players[socket.id].emoteTimer = 120;
      io.emit('emote', { id: socket.id, emote });
    }
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
    io.emit('playerLeft', socket.id);
  });
});

function sanitize(p) {
  return {
    id: p.id,
    x: p.x,
    y: p.y,
    name: p.name,
    color: p.color,
    colorIndex: p.colorIndex,
    emote: p.emote,
  };
}

// Game loop
setInterval(() => {
  const updates = [];
  for (const id in players) {
    const p = players[id];
    const k = p.keys || {};
    let moved = false;

    if (k.left)  { p.x -= SPEED; moved = true; }
    if (k.right) { p.x += SPEED; moved = true; }
    if (k.up)    { p.y -= SPEED; moved = true; }
    if (k.down)  { p.y += SPEED; moved = true; }

    // Clamp to world
    p.x = Math.max(16, Math.min(WORLD_W - 16, p.x));
    p.y = Math.max(16, Math.min(WORLD_H - 16, p.y));

    if (p.emoteTimer > 0) {
      p.emoteTimer--;
      if (p.emoteTimer === 0) p.emote = null;
    }

    updates.push({ id: p.id, x: p.x, y: p.y, emote: p.emote });
  }
  if (updates.length) {
    io.emit('tick', updates);
  }
}, 1000 / TICK_RATE);

server.listen(PORT, () => {
  const fs = require('fs');
  const indexPath = path.join(__dirname, 'public', 'index.html');
  const exists = fs.existsSync(indexPath);
  console.log(`🐱 Cat Lobby running at http://localhost:${PORT}`);
  console.log(`📁 Serving from: ${path.join(__dirname, 'public')}`);
  console.log(`📄 index.html found: ${exists ? '✅ YES' : '❌ NO — make sure public/index.html exists!'}`);
});
