'use strict';
const { players } = require('../../state');
const { sanitize, broadcastToRoom } = require('../helpers');
const { savePlayer } = require('./dig');

const VALID_SLOTS = ['hat','shirt','pattern'];

module.exports = function registerOutfitHandlers(socket, io) {
  socket.on('equipItem', ({ slot, value }) => {
    const p = players[socket.id]; if (!p) return;
    if (!VALID_SLOTS.includes(slot)) return;
    const owned = p.inventory.find(i => i.wearable && i.slot===slot &&
      (slot==='pattern' ? (i.patternKey===value||i.id===value) : i.id===value));
    if (!owned) return;
    if (!p.outfit) p.outfit = {};
    p.outfit[slot] = value;
    if (p.dbUserId) savePlayer(p);
    if (p.inRoomId) broadcastToRoom(io, p.inRoomId, 'playerUpdate', sanitize(p));
    else io.emit('playerUpdate', sanitize(p));
  });

  socket.on('unequipItem', ({ slot }) => {
    const p = players[socket.id]; if (!p) return;
    if (!VALID_SLOTS.includes(slot)) return;
    if (!p.outfit) p.outfit = {};
    p.outfit[slot] = null;
    if (p.dbUserId) savePlayer(p);
    if (p.inRoomId) broadcastToRoom(io, p.inRoomId, 'playerUpdate', sanitize(p));
    else io.emit('playerUpdate', sanitize(p));
  });
};
