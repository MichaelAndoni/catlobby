'use strict';
const { players, activeTrades } = require('../../state');
const { savePlayer } = require('./dig');

function makeId() { return Math.random().toString(36).slice(2,10); }

function broadcastTradeState(io, trade) {
  const is = io.sockets.sockets.get(trade.initiatorId);
  const ts = io.sockets.sockets.get(trade.targetId);
  if (is) is.emit('tradeState', { tradeId:trade.tradeId, myOffer:trade.initiatorOffer, partnerOffer:trade.targetOffer, myAccepted:trade.initiatorAccepted, partnerAccepted:trade.targetAccepted });
  if (ts) ts.emit('tradeState', { tradeId:trade.tradeId, myOffer:trade.targetOffer, partnerOffer:trade.initiatorOffer, myAccepted:trade.targetAccepted, partnerAccepted:trade.initiatorAccepted });
}

function cleanupTrade(tradeId) {
  const t = activeTrades[tradeId]; if (!t) return;
  if (players[t.initiatorId]) players[t.initiatorId].activeTradeId = null;
  if (players[t.targetId])    players[t.targetId].activeTradeId    = null;
  delete activeTrades[tradeId];
}

function addItem(p,item){const ex=p.inventory.find(i=>i.id===item.id);if(ex)ex.qty+=item.qty;else p.inventory.push({id:item.id,label:item.label,emoji:item.emoji,rarity:item.rarity,qty:item.qty});}
function rmItem(p,itemId,qty){const idx=p.inventory.findIndex(i=>i.id===itemId);if(idx===-1)return;p.inventory[idx].qty-=qty;if(p.inventory[idx].qty<=0)p.inventory.splice(idx,1);}
function notifyErr(io,trade,pid,msg){const s=io.sockets.sockets.get(pid);if(s)s.emit('tradeClosed',{tradeId:trade.tradeId,reason:msg});const oid=trade.initiatorId===pid?trade.targetId:trade.initiatorId;const os=io.sockets.sockets.get(oid);if(os)os.emit('tradeClosed',{tradeId:trade.tradeId,reason:'Trade cancelled.'});}

function executeTrade(io, trade) {
  const init = players[trade.initiatorId], targ = players[trade.targetId];
  if (!init || !targ) { cleanupTrade(trade.tradeId); return; }
  const iO = trade.initiatorOffer, tO = trade.targetOffer;
  for (const o of iO.items){const inv=init.inventory.find(i=>i.id===o.id);if(!inv||inv.qty<o.qty){notifyErr(io,trade,trade.initiatorId,'Your inventory changed.');cleanupTrade(trade.tradeId);return;}}
  if(init.coins<iO.coins){notifyErr(io,trade,trade.initiatorId,'Not enough coins.');cleanupTrade(trade.tradeId);return;}
  for (const o of tO.items){const inv=targ.inventory.find(i=>i.id===o.id);if(!inv||inv.qty<o.qty){notifyErr(io,trade,trade.targetId,'Partner inventory changed.');cleanupTrade(trade.tradeId);return;}}
  if(targ.coins<tO.coins){notifyErr(io,trade,trade.targetId,'Partner not enough coins.');cleanupTrade(trade.tradeId);return;}
  for(const o of iO.items){rmItem(init,o.id,o.qty);addItem(targ,o);}
  for(const o of tO.items){rmItem(targ,o.id,o.qty);addItem(init,o);}
  init.coins=init.coins-iO.coins+tO.coins; targ.coins=targ.coins-tO.coins+iO.coins;
  if(init.dbUserId)savePlayer(init); if(targ.dbUserId)savePlayer(targ);
  const is=io.sockets.sockets.get(trade.initiatorId),ts=io.sockets.sockets.get(trade.targetId);
  if(is)is.emit('tradeComplete',{tradeId:trade.tradeId,inventory:init.inventory,coins:init.coins});
  if(ts)ts.emit('tradeComplete',{tradeId:trade.tradeId,inventory:targ.inventory,coins:targ.coins});
  cleanupTrade(trade.tradeId);
}

module.exports = function registerTradeHandlers(socket, io) {
  socket.on('tradeRequest', (targetId) => {
    const initiator=players[socket.id],target=players[targetId];
    if(!initiator||!target||socket.id===targetId)return;
    if(initiator.activeTradeId)return socket.emit('privateMsg',{type:'trade_error',text:'You are already in a trade.'});
    if(target.activeTradeId)return socket.emit('privateMsg',{type:'trade_error',text:`${target.name} is already in a trade.`});
    const tradeId=makeId();
    target.pendingTradeFrom[tradeId]=socket.id; initiator.pendingTradeTo[tradeId]=targetId;
    socket.emit('privateMsg',{type:'trade_sent',text:`Trade request sent to ${target.name}.`,tradeId});
    io.to(targetId).emit('privateMsg',{type:'trade_incoming',text:`${initiator.name} wants to trade!`,tradeId,fromId:socket.id,fromName:initiator.name,fromColorIndex:initiator.colorIndex});
  });
  socket.on('tradeAccept', (tradeId) => {
    const target=players[socket.id]; if(!target?.pendingTradeFrom?.[tradeId])return;
    const initiatorId=target.pendingTradeFrom[tradeId]; const initiator=players[initiatorId];
    if(!initiator){socket.emit('privateMsg',{type:'trade_error',text:'That player is no longer online.'});delete target.pendingTradeFrom[tradeId];return;}
    delete target.pendingTradeFrom[tradeId]; if(initiator.pendingTradeTo)delete initiator.pendingTradeTo[tradeId];
    activeTrades[tradeId]={tradeId,initiatorId,targetId:socket.id,initiatorOffer:{items:[],coins:0},targetOffer:{items:[],coins:0},initiatorAccepted:false,targetAccepted:false};
    initiator.activeTradeId=tradeId; target.activeTradeId=tradeId;
    const is=io.sockets.sockets.get(initiatorId);
    if(is)is.emit('tradeOpen',{tradeId,role:'initiator',partnerId:socket.id,partnerName:target.name,partnerColorIndex:target.colorIndex,myInventory:initiator.inventory,myCoins:initiator.coins,partnerInventory:target.inventory,partnerCoins:target.coins});
    socket.emit('tradeOpen',{tradeId,role:'target',partnerId:initiatorId,partnerName:initiator.name,partnerColorIndex:initiator.colorIndex,myInventory:target.inventory,myCoins:target.coins,partnerInventory:initiator.inventory,partnerCoins:initiator.coins});
  });
  socket.on('tradeDecline',(tradeId)=>{
    const target=players[socket.id];if(!target?.pendingTradeFrom?.[tradeId])return;
    const initiatorId=target.pendingTradeFrom[tradeId];delete target.pendingTradeFrom[tradeId];
    const initiator=players[initiatorId];if(initiator?.pendingTradeTo)delete initiator.pendingTradeTo[tradeId];
    const is=io.sockets.sockets.get(initiatorId);if(is)is.emit('privateMsg',{type:'trade_declined',text:`${target.name} declined your trade request.`});
  });
  socket.on('tradeUpdateOffer',({tradeId,items,coins})=>{
    const trade=activeTrades[tradeId];if(!trade)return;
    const p=players[socket.id];if(!p)return;
    const isInit=trade.initiatorId===socket.id;
    const myOffer=isInit?trade.initiatorOffer:trade.targetOffer;
    myOffer.items=Array.isArray(items)?items:[];
    myOffer.coins=Math.max(0,Math.min(parseInt(coins)||0,p.coins));
    trade.initiatorAccepted=false;trade.targetAccepted=false;
    broadcastTradeState(io,trade);
  });
  socket.on('tradeAcceptTrade',(tradeId)=>{
    const trade=activeTrades[tradeId];if(!trade)return;
    if(trade.initiatorId===socket.id)trade.initiatorAccepted=true;else trade.targetAccepted=true;
    broadcastTradeState(io,trade);if(trade.initiatorAccepted&&trade.targetAccepted)executeTrade(io,trade);
  });
  socket.on('tradeDeclineTrade',(tradeId)=>{
    const trade=activeTrades[tradeId];if(!trade)return;
    if(trade.initiatorId!==socket.id&&trade.targetId!==socket.id)return;
    const otherId=trade.initiatorId===socket.id?trade.targetId:trade.initiatorId;
    const p=players[socket.id];const os=io.sockets.sockets.get(otherId);
    if(os)os.emit('tradeClosed',{tradeId,reason:`${p?.name||'Someone'} declined the trade.`});
    socket.emit('tradeClosed',{tradeId,reason:'You declined the trade.'});
    cleanupTrade(tradeId);
  });
};

module.exports.cleanupTrade = cleanupTrade;
