'use strict';
const jwt = require('jsonwebtoken');
const db  = require('../../config/db');
const { CAT_COLORS } = require('../../config/constants');
const { players }    = require('../../state');
const { sanitize }   = require('../helpers');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

function mergeInventories(base, guest) {
  const r = [...base];
  for (const item of guest) { const ex = r.find(i => i.id===item.id); if (ex) ex.qty+=item.qty; else r.push({...item}); }
  return r;
}

module.exports = function registerAuthHandlers(socket, io) {
  socket.on('authLogin', async (token) => {
    try {
      const { userId } = jwt.verify(token, JWT_SECRET);
      const user = await db.getUserById(userId);
      if (!user || !user.verified) return socket.emit('authResult', { ok:false, error:'Session invalid.' });
      const p = players[socket.id]; if (!p) return;
      Object.assign(p, { dbUserId:user.id, isGuest:false, name:user.username, colorIndex:user.color_index,
        color:CAT_COLORS[user.color_index]||CAT_COLORS[0], coins:user.coins, inventory:user.inventory||[], outfit:user.outfit||{} });
      socket.emit('authResult', { ok:true, user:{ id:user.id, username:user.username, email:user.email, colorIndex:user.color_index, coins:user.coins, inventory:user.inventory, outfit:user.outfit||{} } });
      io.emit('playerUpdate', sanitize(p));
    } catch { socket.emit('authResult', { ok:false, error:'Session expired.' }); }
  });

  socket.on('claimGuestAccount', async (token) => {
    try {
      const { userId } = jwt.verify(token, JWT_SECRET);
      const user = await db.getUserById(userId); if (!user) return;
      const p = players[socket.id]; if (!p) return;
      const mergedCoins = (user.coins||0)+(p.coins||0);
      const mergedInv   = mergeInventories(user.inventory||[], p.inventory||[]);
      await db.updatePlayerData({ id:user.id, username:user.username, colorIndex:user.color_index, coins:mergedCoins, inventory:mergedInv, outfit:p.outfit||{} });
      Object.assign(p, { dbUserId:user.id, isGuest:false, name:user.username, colorIndex:user.color_index,
        color:CAT_COLORS[user.color_index]||CAT_COLORS[0], coins:mergedCoins, inventory:mergedInv });
      socket.emit('authResult', { ok:true, user:{ id:user.id, username:user.username, email:user.email, colorIndex:user.color_index, coins:mergedCoins, inventory:mergedInv, outfit:p.outfit||{} } });
      io.emit('playerUpdate', sanitize(p));
    } catch (e) { console.error('[claimGuest]', e); }
  });

  socket.on('setName', (name) => {
    if (typeof name !== 'string') return;
    const p = players[socket.id]; if (!p) return;
    p.name = name.trim().substring(0,16) || 'Cat';
    io.emit('playerUpdate', sanitize(p));
  });
};
