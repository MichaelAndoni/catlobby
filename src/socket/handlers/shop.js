'use strict';
const { SHOP_ITEMS, DIG_ITEMS_MAP } = require('../../config/constants');
const { players } = require('../../state');
const { savePlayer } = require('./dig');

module.exports = function registerShopHandlers(socket) {
  socket.on('requestShopCatalog', () => socket.emit('shopCatalog', SHOP_ITEMS));

  socket.on('buyItem', ({ itemId, qty }) => {
    const p = players[socket.id]; if (!p) return;
    qty = Math.max(1, Math.min(99, parseInt(qty)||1));
    const shopItem = SHOP_ITEMS.find(i => i.id===itemId);
    if (!shopItem) return socket.emit('shopError', 'Item not found.');
    const total = shopItem.price * qty;
    if (p.coins < total) return socket.emit('shopError', `Not enough coins! Need ${total} 🪙`);
    p.coins -= total;
    const ex = p.inventory.find(i => i.id===itemId);
    if (ex) { ex.qty += qty; } else {
      const digMeta = DIG_ITEMS_MAP[itemId];
      p.inventory.push({ id:itemId, label:shopItem.label, emoji:shopItem.emoji, rarity:shopItem.rarity||'common', qty,
        wearable:shopItem.cat==='clothing', slot:shopItem.slot||null, patternKey:shopItem.patternKey||null,
        placeable:!!(digMeta?.placeable), furniture:digMeta?.furniture||null });
    }
    if (p.dbUserId) savePlayer(p);
    socket.emit('inventoryUpdate', { inventory:p.inventory, coins:p.coins });
    socket.emit('shopSuccess', { itemId, label:shopItem.label, emoji:shopItem.emoji, coins:p.coins });
  });

  socket.on('sellItem', ({ itemId, qty }) => {
    const p = players[socket.id]; if (!p) return;
    qty = Math.max(1, parseInt(qty)||1);
    const inv = p.inventory.find(i => i.id===itemId);
    if (!inv || inv.qty < qty) return socket.emit('shopError', "You don't have enough of that item.");
    const digMeta  = DIG_ITEMS_MAP[itemId];
    const shopMeta = SHOP_ITEMS.find(i => i.id===itemId);
    let earned = 0;
    if (digMeta?.sellPrice)   earned = digMeta.sellPrice * qty;
    else if (shopMeta?.price) earned = Math.floor(shopMeta.price * 0.4) * qty;
    if (!earned) return socket.emit('shopError', "You can't sell that item.");
    inv.qty -= qty; if (inv.qty <= 0) p.inventory.splice(p.inventory.indexOf(inv), 1);
    p.coins += earned;
    if (p.dbUserId) savePlayer(p);
    socket.emit('inventoryUpdate', { inventory:p.inventory, coins:p.coins });
    socket.emit('sellSuccess', { itemId, qty, earned, label:inv.label, emoji:inv.emoji, coins:p.coins });
  });
};
