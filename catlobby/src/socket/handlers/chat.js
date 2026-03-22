'use strict';
const { players, roomSessions, chatHistory } = require('../../state');
const { broadcastToRoom } = require('../helpers');

module.exports = function registerChatHandlers(socket, io) {
  socket.on('chat', (msg) => {
    if (typeof msg !== 'string') return;
    msg = msg.trim().substring(0,120); if (!msg) return;
    const p = players[socket.id]; if (!p) return;
    const entry = { id:socket.id, name:p.name, colorIndex:p.colorIndex, msg, time:Date.now(), isGuest:p.isGuest };
    chatHistory.push(entry); if (chatHistory.length > 80) chatHistory.shift();
    io.emit('chat', entry);
  });

  socket.on('roomChat', (msg) => {
    if (typeof msg !== 'string') return;
    msg = msg.trim().substring(0,120); if (!msg) return;
    const p = players[socket.id]; if (!p || !p.inRoomId) return;
    const rs = roomSessions[p.inRoomId]; if (!rs) return;
    const entry = { id:socket.id, name:p.name, colorIndex:p.colorIndex, msg, time:Date.now() };
    rs.chatHistory.push(entry); if (rs.chatHistory.length > 80) rs.chatHistory.shift();
    broadcastToRoom(io, p.inRoomId, 'roomChat', entry);
  });

  socket.on('emote', (emote) => {
    if (!['👋','❤️','😸','🐟','⭐','💤','🎵'].includes(emote)) return;
    const p = players[socket.id]; if (!p) return;
    p.emote = emote; p.emoteTimer = 120;
    io.emit('emote', { id:socket.id, emote });
  });
};
