'use strict';
const db = require('../../config/db');
const { DIG_DURATION_MS, DIG_INTERVAL_MS, DIG_FIND_CHANCE, rollItem } = require('../../config/constants');
const { players } = require('../../state');
const { broadcastToRoom } = require('../helpers');

function savePlayer(p) {
  if (!p.dbUserId) return;
  db.updatePlayerData({ id:p.dbUserId, username:p.name, colorIndex:p.colorIndex, coins:p.coins, inventory:p.inventory, outfit:p.outfit||{} })
    .catch(err => console.error('[savePlayer]', err));
}

function handleFind(socket, p, item) {
  if (item.type === 'nothing') { socket.emit('digFind', { type:'nothing', label:item.label, emoji:item.emoji }); return; }
  if (item.type === 'coin')    { p.coins += item.value; socket.emit('digFind', { type:'coin', label:item.label, emoji:item.emoji, value:item.value, totalCoins:p.coins }); return; }
  const ex = p.inventory.find(i => i.id === item.id);
  const entry = { id:item.id, label:item.label, emoji:item.emoji, rarity:item.rarity, qty:1, placeable:!!item.placeable, furniture:item.furniture, sellPrice:item.sellPrice };
  if (ex) ex.qty++; else p.inventory.push(entry);
  socket.emit('digFind', { type:'item', id:item.id, label:item.label, emoji:item.emoji, rarity:item.rarity, inventory:p.inventory });
}

function stopDig(io, sock) {
  const p = players[sock.id]; if (!p || !p.digging) return;
  p.digging = false; clearInterval(p.digIntervalHandle); p.digIntervalHandle = null;
  if (p.inRoomId) broadcastToRoom(io, p.inRoomId, 'roomPlayerDig', { id:sock.id, digging:false });
  else io.emit('playerDig', { id:sock.id, digging:false });
  sock.emit('digStopped');
}

module.exports = function registerDigHandlers(socket, io) {
  socket.on('startDig', () => {
    const p = players[socket.id]; if (!p || p.digging || p.activeTradeId) return;
    p.digging = true; p.keys = {}; p.digStartTime = Date.now();
    if (p.inRoomId) broadcastToRoom(io, p.inRoomId, 'roomPlayerDig', { id:socket.id, digging:true });
    else io.emit('playerDig', { id:socket.id, digging:true });
    p.digIntervalHandle = setInterval(() => {
      if (!players[socket.id] || !players[socket.id].digging) return;
      if (Math.random() < DIG_FIND_CHANCE) handleFind(socket, players[socket.id], rollItem());
    }, DIG_INTERVAL_MS);
    setTimeout(() => stopDig(io, socket), DIG_DURATION_MS);
  });
  socket.on('stopDig', () => stopDig(io, socket));
};

module.exports.stopDig    = stopDig;
module.exports.savePlayer = savePlayer;
