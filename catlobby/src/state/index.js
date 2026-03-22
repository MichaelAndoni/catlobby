'use strict';
// Shared in-memory game state — imported by all socket handlers.
const players      = {};  // socketId -> player object
const roomSessions = {};  // ownerId  -> { ownerId, players, chatHistory }
const chatHistory  = [];  // last 80 lobby messages
const activeTrades = {};  // tradeId  -> trade object
module.exports = { players, roomSessions, chatHistory, activeTrades };
