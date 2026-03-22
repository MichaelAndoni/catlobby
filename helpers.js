'use strict';
const { roomSessions } = require('../state');

function sanitize(p) {
  return {
    id: p.id, x: p.x, y: p.y, name: p.name,
    color: p.color, colorIndex: p.colorIndex,
    emote: p.emote, digging: p.digging,
    coins: p.coins, isGuest: p.isGuest,
    location: p.location, outfit: p.outfit || {},
  };
}

function broadcastToRoom(io, ownerId, event, data, excludeId) {
  const rs = roomSessions[ownerId]; if (!rs) return;
  for (const sid of Object.keys(rs.players)) {
    if (sid === excludeId) continue;
    const s = io.sockets.sockets.get(sid);
    if (s) s.emit(event, data);
  }
}

module.exports = { sanitize, broadcastToRoom };
