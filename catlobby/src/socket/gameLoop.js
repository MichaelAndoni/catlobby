'use strict';
const { WORLD_W, WORLD_H, ROOM_W, ROOM_H, SPEED, TICK_RATE } = require('../config/constants');
const { players, roomSessions } = require('../state');
const { broadcastToRoom } = require('./helpers');

module.exports = function startGameLoop(io) {
  setInterval(() => {
    const lobbyUpdates = [];
    for (const id in players) {
      const p = players[id]; if (p.inRoomId) continue;
      if (!p.digging) {
        const k = p.keys||{};
        if(k.left)p.x-=SPEED; if(k.right)p.x+=SPEED; if(k.up)p.y-=SPEED; if(k.down)p.y+=SPEED;
        p.x=Math.max(30,Math.min(WORLD_W-30,p.x)); p.y=Math.max(30,Math.min(WORLD_H-30,p.y));
      }
      if(p.emoteTimer>0){p.emoteTimer--;if(p.emoteTimer===0)p.emote=null;}
      lobbyUpdates.push({id:p.id,x:p.x,y:p.y,emote:p.emote,digging:p.digging});
    }
    if(lobbyUpdates.length) io.emit('tick', lobbyUpdates);

    for (const [ownerId, rs] of Object.entries(roomSessions)) {
      const roomUpdates = [];
      for (const p of Object.values(rs.players)) {
        if (!p.digging) {
          const k=p.keys||{};
          if(k.left)p.x-=SPEED; if(k.right)p.x+=SPEED; if(k.up)p.y-=SPEED; if(k.down)p.y+=SPEED;
          p.x=Math.max(30,Math.min(ROOM_W-30,p.x)); p.y=Math.max(30,Math.min(ROOM_H-30,p.y));
        }
        if(p.emoteTimer>0){p.emoteTimer--;if(p.emoteTimer===0)p.emote=null;}
        roomUpdates.push({id:p.id,x:p.x,y:p.y,emote:p.emote,digging:p.digging});
      }
      if(roomUpdates.length) broadcastToRoom(io, ownerId, 'roomTick', roomUpdates);
    }
  }, 1000 / TICK_RATE);
};
