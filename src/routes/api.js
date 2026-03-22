'use strict';
const express = require('express');
const db      = require('../config/db');
const { SHOP_ITEMS } = require('../config/constants');

const router = express.Router();
let getRoomSessions = () => ({});
router.setRoomSessions = (fn) => { getRoomSessions = fn; };

router.get('/room/:userId', async (req, res) => {
  try {
    const user=await db.getUserById(req.params.userId);
    if (!user||!user.verified) return res.status(404).json({error:'User not found.'});
    const room=await db.getRoom(req.params.userId);
    res.json({ok:true,room,owner:{id:user.id,username:user.username,colorIndex:user.color_index}});
  } catch(e){ console.error('[/api/room]',e); res.status(500).json({error:e.message}); }
});

router.get('/room-directory', async (req, res) => {
  try {
    const users=await db.getAllVerifiedUsers();
    res.json({ok:true,users});
  } catch(e){ console.error('[/api/room-directory]',e); res.status(500).json({ok:true,users:[]}); }
});

router.get('/rooms-online', (req, res) => {
  const roomSessions=getRoomSessions();
  const online={};
  for (const [ownerId,rs] of Object.entries(roomSessions)) {
    online[ownerId]=Object.values(rs.players).map(p=>({id:p.id,name:p.name,colorIndex:p.colorIndex}));
  }
  res.json({ok:true,online});
});

router.get('/shop', (req, res) => res.json({ok:true,items:SHOP_ITEMS}));

module.exports = router;
