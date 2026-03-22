'use strict';
const { players } = require('../../state');
const { AQUA_VALID_ITEM_IDS } = require('../../config/constants');
const { savePlayer } = require('./dig');

module.exports = function registerAquaHandlers(socket) {
  socket.on('aquaCoinPickup', ({ amount }) => {
    const p = players[socket.id]; if (!p) return;
    const coins = Math.min(50, Math.max(1, parseInt(amount)||0));
    p.coins += coins;
    socket.emit('inventoryUpdate', { inventory:p.inventory, coins:p.coins });
    if (p.dbUserId) savePlayer(p);
  });

  socket.on('aquaItemPickup', ({ id, label, emoji, rarity, sellPrice }) => {
    const p = players[socket.id]; if (!p) return;
    if (!AQUA_VALID_ITEM_IDS.has(id)) return;
    const ex = p.inventory.find(i => i.id===id);
    if (ex) ex.qty++;
    else p.inventory.push({ id, label, emoji, rarity:rarity||'common', qty:1, sellPrice:Math.min(250,parseInt(sellPrice)||5), placeable:false, wearable:false });
    socket.emit('inventoryUpdate', { inventory:p.inventory, coins:p.coins });
    if (p.dbUserId) savePlayer(p);
  });
};
