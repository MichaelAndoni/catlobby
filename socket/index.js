'use strict';
const { CAT_COLORS, DIG_ITEMS, SHOP_ITEMS, WORLD_W, WORLD_H } = require('../config/constants');
const { players, roomSessions, chatHistory, activeTrades } = require('../state');
const { sanitize, broadcastToRoom } = require('./helpers');

const registerAuthHandlers   = require('./handlers/auth');
const registerChatHandlers   = require('./handlers/chat');
const registerDigHandlers    = require('./handlers/dig');
const registerShopHandlers   = require('./handlers/shop');
const registerOutfitHandlers = require('./handlers/outfit');
const registerCombatHandlers = require('./handlers/combat');
const registerAquaHandlers   = require('./handlers/aqua');
const registerTradeHandlers  = require('./handlers/trade');
const registerRoomHandlers   = require('./handlers/room');
const { leaveRoom }          = require('./handlers/room');
const { savePlayer }         = require('./handlers/dig');
const { cleanupTrade }       = require('./handlers/trade');

function randomSpawn(W,H){ return { x:60+Math.random()*(W-120), y:60+Math.random()*(H-120) }; }

module.exports = function initSocket(io) {
  // Auto-save all authenticated players every 30s
  setInterval(() => {
    for (const p of Object.values(players)) if (p.dbUserId) savePlayer(p);
  }, 30_000);

  io.on('connection', (socket) => {
    const pos = randomSpawn(WORLD_W, WORLD_H);
    const colorIndex = Math.floor(Math.random() * CAT_COLORS.length);
    players[socket.id] = {
      id:socket.id, x:pos.x, y:pos.y,
      name:'Cat', color:CAT_COLORS[colorIndex], colorIndex,
      keys:{}, emote:null, emoteTimer:0,
      digging:false, digStartTime:0, digIntervalHandle:null,
      coins:0, inventory:[], outfit:{},
      activeTradeId:null, joinedAt:Date.now(),
      dbUserId:null, isGuest:true,
      location:'lobby', inRoomId:null,
      pendingTradeFrom:{}, pendingTradeTo:{},
    };

    socket.emit('init', {
      id: socket.id,
      players: Object.values(players).map(sanitize),
      chatHistory, worldW:WORLD_W, worldH:WORLD_H,
      digItems:  DIG_ITEMS.map(i=>({id:i.id,emoji:i.emoji,label:i.label,rarity:i.rarity,placeable:i.placeable,furniture:i.furniture,sellPrice:i.sellPrice,cat:i.cat})),
      shopItems: SHOP_ITEMS,
      items:     DIG_ITEMS.map(i=>({id:i.id,emoji:i.emoji,label:i.label,rarity:i.rarity,placeable:i.placeable,furniture:i.furniture,sellPrice:i.sellPrice,cat:i.cat})),
    });
    socket.broadcast.emit('playerJoined', sanitize(players[socket.id]));

    socket.on('keys',     (keys) => { const p=players[socket.id]; if(!p||p.digging)return; p.keys=keys; });
    socket.on('roomKeys', (keys) => { const p=players[socket.id]; if(!p||!p.inRoomId||p.digging)return; p.keys=keys; });

    // ── World Zone travel (Sunflower Plains, future zones) ───────
    const ZONE_BOUNDS = { sunflower:{ W:2400, H:1100 } };
    socket.on('enterZone', ({ zone }) => {
      const p = players[socket.id]; if (!p) return;
      const bounds = ZONE_BOUNDS[zone]; if (!bounds) return;
      p.zone     = zone;
      p.location = zone;
      p.x = 120 + Math.random() * (bounds.W - 240);
      p.y = 120 + Math.random() * (bounds.H - 240);
      io.emit('playerUpdate', sanitize(p));
    });
    socket.on('leaveZone', () => {
      const p = players[socket.id]; if (!p) return;
      p.zone     = null;
      p.location = 'lobby';
      p.x = 60 + Math.random() * (WORLD_W - 120);
      p.y = 60 + Math.random() * (WORLD_H - 120);
      io.emit('playerUpdate', sanitize(p));
    });
    socket.on('requestProfile', (targetId) => {
      const t=players[targetId]; if(!t)return;
      socket.emit('profileData',{id:t.id,name:t.name,colorIndex:t.colorIndex,color:t.color,coins:t.coins,inventory:t.inventory,outfit:t.outfit,joinedAt:t.joinedAt,isGuest:t.isGuest,dbUserId:t.dbUserId});
    });

    registerAuthHandlers(socket, io);
    registerChatHandlers(socket, io);
    registerDigHandlers(socket, io);
    registerShopHandlers(socket);
    registerOutfitHandlers(socket, io);
    registerCombatHandlers(socket, io);
    registerAquaHandlers(socket);
    registerTradeHandlers(socket, io);
    registerRoomHandlers(socket, io);

    socket.on('disconnect', () => {
      const p = players[socket.id];
      if (p) {
        if (p.dbUserId) savePlayer(p);
        if (p.digIntervalHandle) clearInterval(p.digIntervalHandle);
        if (p.activeTradeId) {
          const t = activeTrades[p.activeTradeId];
          if (t) {
            const otherId = t.initiatorId===socket.id ? t.targetId : t.initiatorId;
            const os = io.sockets.sockets.get(otherId);
            if (os) os.emit('tradeClosed',{tradeId:p.activeTradeId,reason:'Trade partner disconnected.'});
            cleanupTrade(p.activeTradeId);
          }
        }
        if (p.inRoomId) {
          const rs = roomSessions[p.inRoomId];
          if (rs) {
            delete rs.players[socket.id];
            broadcastToRoom(io, p.inRoomId, 'roomPlayerLeft', socket.id);
            if (Object.keys(rs.players).length===0) delete roomSessions[p.inRoomId];
          }
        }
      }
      delete players[socket.id];
      io.emit('playerLeft', socket.id);
    });
  });
};
