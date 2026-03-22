'use strict';
const { v4: uuidv4 } = require('uuid');
const db = require('../../config/db');
const { ROOM_W, ROOM_H, DIG_ITEMS_MAP } = require('../../config/constants');
const { players, roomSessions } = require('../../state');
const { sanitize, broadcastToRoom } = require('../helpers');
const { savePlayer } = require('./dig');

function randomSpawn(W,H){ return { x:60+Math.random()*(W-120), y:60+Math.random()*(H-120) }; }

function leaveRoom(io, socket) {
  const p=players[socket.id]; if(!p||!p.inRoomId)return;
  const ownerId=p.inRoomId;
  const rs=roomSessions[ownerId];
  if(rs){delete rs.players[socket.id];broadcastToRoom(io,ownerId,'roomPlayerLeft',socket.id,socket.id);if(Object.keys(rs.players).length===0)delete roomSessions[ownerId];}
  p.location='lobby'; p.inRoomId=null;
  const pos=randomSpawn(ROOM_W,ROOM_H); p.x=pos.x; p.y=pos.y;
  socket.emit('backToLobby',{x:p.x,y:p.y});
}

module.exports = function registerRoomHandlers(socket, io) {
  socket.on('enterRoom', async ({ ownerId }) => {
    try {
      const p=players[socket.id]; if(!p)return;
      const owner=await db.getUserById(ownerId);
      if(!owner||!owner.verified)return socket.emit('roomError','That room does not exist.');
      p.location=`room:${ownerId}`; p.inRoomId=ownerId;
      const pos=randomSpawn(ROOM_W,ROOM_H); p.x=pos.x; p.y=pos.y;
      if(!roomSessions[ownerId])roomSessions[ownerId]={ownerId,players:{},chatHistory:[]};
      const rs=roomSessions[ownerId]; rs.players[socket.id]=p;
      const roomData=await db.getRoom(ownerId);
      socket.emit('roomInit',{ownerId,ownerName:owner.username,ownerColorIndex:owner.color_index,
        roomName:roomData.roomName,wallpaper:roomData.wallpaper,flooring:roomData.flooring,
        placedItems:roomData.placedItems,players:Object.values(rs.players).map(sanitize),
        chatHistory:rs.chatHistory,isOwner:p.dbUserId===ownerId});
      broadcastToRoom(io,ownerId,'roomPlayerJoined',sanitize(p),socket.id);
    } catch(e){console.error('[enterRoom]',e);socket.emit('roomError','Could not load room.');}
  });

  socket.on('leaveRoom', () => leaveRoom(io, socket));

  socket.on('saveRoom', async ({ roomName, wallpaper, flooring, placedItems }) => {
    try {
      const p=players[socket.id]; if(!p||!p.dbUserId)return;
      if(!p.inRoomId||p.inRoomId!==p.dbUserId)return;
      await db.saveRoom({userId:p.dbUserId,roomName,wallpaper,flooring,placedItems});
      broadcastToRoom(io,p.dbUserId,'roomUpdated',{roomName,wallpaper,flooring,placedItems});
      socket.emit('roomSaved',{ok:true});
    } catch(e){console.error('[saveRoom]',e);}
  });

  socket.on('placeItem', async ({ itemId, x, y, instanceId }) => {
    try {
      const p=players[socket.id]; if(!p||!p.dbUserId)return;
      if(!p.inRoomId||p.inRoomId!==p.dbUserId)return;
      const itemDef=DIG_ITEMS_MAP[itemId]; if(!itemDef||!itemDef.placeable)return;
      const inv=p.inventory.find(i=>i.id===itemId); if(!inv||inv.qty<1)return socket.emit('roomError',"You don't have that item.");
      inv.qty--; if(inv.qty<=0)p.inventory.splice(p.inventory.indexOf(inv),1);
      savePlayer(p);
      const roomData=await db.getRoom(p.dbUserId);
      const newPlaced=[...roomData.placedItems,{instanceId:instanceId||uuidv4(),itemId,x,y,emoji:itemDef.emoji,label:itemDef.label,rarity:itemDef.rarity,w:itemDef.furniture?.w||40,h:itemDef.furniture?.h||40}];
      await db.saveRoom({userId:p.dbUserId,roomName:roomData.roomName,wallpaper:roomData.wallpaper,flooring:roomData.flooring,placedItems:newPlaced});
      socket.emit('inventoryUpdate',{inventory:p.inventory,coins:p.coins});
      broadcastToRoom(io,p.dbUserId,'roomUpdated',{...roomData,placedItems:newPlaced});
    } catch(e){console.error('[placeItem]',e);}
  });

  socket.on('pickupItem', async ({ instanceId }) => {
    try {
      const p=players[socket.id]; if(!p||!p.dbUserId)return;
      if(!p.inRoomId||p.inRoomId!==p.dbUserId)return;
      const roomData=await db.getRoom(p.dbUserId);
      const idx=roomData.placedItems.findIndex(i=>i.instanceId===instanceId); if(idx===-1)return;
      const item=roomData.placedItems[idx]; roomData.placedItems.splice(idx,1);
      const ex=p.inventory.find(i=>i.id===item.itemId); const def=DIG_ITEMS_MAP[item.itemId];
      if(ex)ex.qty++; else p.inventory.push({id:item.itemId,label:item.label,emoji:item.emoji,rarity:item.rarity||'common',qty:1,placeable:!!(def?.placeable),furniture:def?.furniture});
      savePlayer(p);
      await db.saveRoom({userId:p.dbUserId,roomName:roomData.roomName,wallpaper:roomData.wallpaper,flooring:roomData.flooring,placedItems:roomData.placedItems});
      socket.emit('inventoryUpdate',{inventory:p.inventory,coins:p.coins});
      broadcastToRoom(io,p.dbUserId,'roomUpdated',{...roomData});
    } catch(e){console.error('[pickupItem]',e);}
  });
};

module.exports.leaveRoom = leaveRoom;
