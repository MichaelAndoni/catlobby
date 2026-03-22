'use strict';
const { players } = require('../../state');
const { broadcastToRoom } = require('../helpers');

module.exports = function registerCombatHandlers(socket, io) {
  socket.on('tailWhip', ({ dir }) => {
    const p = players[socket.id]; if (!p) return;
    const d = dir === -1 ? -1 : 1;
    if (p.inRoomId) broadcastToRoom(io, p.inRoomId, 'tailWhip', { id:socket.id, dir:d }, socket.id);
    else socket.broadcast.emit('tailWhip', { id:socket.id, dir:d });
  });

  socket.on('tailWhipHit', ({ targetId }) => {
    const attacker = players[socket.id]; if (!attacker) return;
    const target   = players[targetId];  if (!target)   return;
    if (Math.hypot(attacker.x-target.x, attacker.y-target.y) > 240) return;
    const payload = { targetId, attackerId:socket.id, attackerName:attacker.name };
    const ts = io.sockets.sockets.get(targetId);
    if (ts) ts.emit('tailWhipHit', payload);
    socket.emit('tailWhipHit', payload);
    if (attacker.inRoomId) broadcastToRoom(io, attacker.inRoomId, 'tailWhipHit', payload, targetId);
    else socket.broadcast.emit('tailWhipHit', payload);
  });
};
