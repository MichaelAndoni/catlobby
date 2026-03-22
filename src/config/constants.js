'use strict';

const WORLD_W = 1060, WORLD_H = 776, ROOM_W = 1060, ROOM_H = 776;
const SPEED = 4, TICK_RATE = 60;
const DIG_DURATION_MS = 15000, DIG_INTERVAL_MS = 3000, DIG_FIND_CHANCE = 0.55;

const CAT_COLORS = [
  { body:'#f4a261', ear:'#e07a2f', stripe:'#d4813f', name:'Orange' },
  { body:'#a8dadc', ear:'#6cbfc3', stripe:'#89c8ca', name:'Blue'   },
  { body:'#c9b1ff', ear:'#a07dff', stripe:'#b396ff', name:'Purple' },
  { body:'#ffd6e0', ear:'#ffb3c6', stripe:'#ffbed5', name:'Pink'   },
  { body:'#b7e4c7', ear:'#74c69d', stripe:'#95d6b0', name:'Green'  },
  { body:'#f8edeb', ear:'#d9c4c0', stripe:'#e8d8d5', name:'White'  },
  { body:'#9d8ca1', ear:'#6d6875', stripe:'#8a7a8e', name:'Gray'   },
  { body:'#e9c46a', ear:'#c9a227', stripe:'#d4ad47', name:'Yellow' },
];

const DIG_ITEMS = [
  { id:'coins_1',  type:'coin',    label:'1 Coin',            emoji:'🪙', value:1,  weight:40 },
  { id:'coins_3',  type:'coin',    label:'3 Coins',           emoji:'🪙', value:3,  weight:20 },
  { id:'coins_10', type:'coin',    label:'10 Coins',          emoji:'💰', value:10, weight:8  },
  { id:'worm',     type:'item', cat:'materials', label:'Wriggling Worm',    emoji:'🪱', rarity:'common',    weight:30, sellPrice:2,   placeable:false },
  { id:'pebble',   type:'item', cat:'materials', label:'Smooth Pebble',     emoji:'🪨', rarity:'common',    weight:28, sellPrice:3,   placeable:true,  furniture:{w:32,h:28} },
  { id:'bone',     type:'item', cat:'materials', label:'Old Bone',          emoji:'🦴', rarity:'common',    weight:25, sellPrice:3,   placeable:false },
  { id:'leaf',     type:'item', cat:'materials', label:'Fossil Leaf',       emoji:'🍂', rarity:'common',    weight:22, sellPrice:4,   placeable:true,  furniture:{w:28,h:28} },
  { id:'acorn',    type:'item', cat:'materials', label:'Lucky Acorn',       emoji:'🌰', rarity:'common',    weight:20, sellPrice:4,   placeable:true,  furniture:{w:28,h:28} },
  { id:'mushroom', type:'item', cat:'materials', label:'Magic Mushroom',    emoji:'🍄', rarity:'uncommon',  weight:12, sellPrice:12,  placeable:true,  furniture:{w:36,h:40} },
  { id:'crystal',  type:'item', cat:'materials', label:'Blue Crystal',      emoji:'💎', rarity:'uncommon',  weight:10, sellPrice:15,  placeable:true,  furniture:{w:36,h:44} },
  { id:'fossil',   type:'item', cat:'materials', label:'Tiny Fossil',       emoji:'🦕', rarity:'uncommon',  weight:9,  sellPrice:18,  placeable:true,  furniture:{w:48,h:44} },
  { id:'bottle',   type:'item', cat:'materials', label:'Message in Bottle', emoji:'🍶', rarity:'uncommon',  weight:8,  sellPrice:20,  placeable:true,  furniture:{w:32,h:44} },
  { id:'gem',      type:'item', cat:'materials', label:'Ancient Gem',       emoji:'💍', rarity:'rare',      weight:4,  sellPrice:45,  placeable:true,  furniture:{w:36,h:36} },
  { id:'crown',    type:'item', cat:'materials', label:'Tiny Crown',        emoji:'👑', rarity:'rare',      weight:3,  sellPrice:55,  placeable:true,  furniture:{w:44,h:36} },
  { id:'map',      type:'item', cat:'materials', label:'Treasure Map',      emoji:'🗺️', rarity:'rare',      weight:3,  sellPrice:50,  placeable:true,  furniture:{w:52,h:44} },
  { id:'potion',   type:'item', cat:'materials', label:'Mystery Potion',    emoji:'🧪', rarity:'rare',      weight:2,  sellPrice:60,  placeable:true,  furniture:{w:32,h:48} },
  { id:'star',     type:'item', cat:'materials', label:'Fallen Star',       emoji:'⭐', rarity:'legendary', weight:1,  sellPrice:150, placeable:true,  furniture:{w:52,h:52} },
  { id:'fish_gold',type:'item', cat:'materials', label:'Golden Fish',       emoji:'🐠', rarity:'legendary', weight:1,  sellPrice:180, placeable:true,  furniture:{w:56,h:44} },
  { id:'catbell',  type:'item', cat:'materials', label:'Ancient Cat Bell',  emoji:'🔔', rarity:'legendary', weight:1,  sellPrice:200, placeable:true,  furniture:{w:44,h:52} },
  { id:'nothing',  type:'nothing', label:'Just Dirt', emoji:'💨', weight:35 },
];

const DIG_ITEMS_MAP = Object.fromEntries(DIG_ITEMS.map(i => [i.id, i]));
const TOTAL_WEIGHT  = DIG_ITEMS.reduce((s, i) => s + i.weight, 0);
function rollItem() {
  let r = Math.random() * TOTAL_WEIGHT;
  for (const item of DIG_ITEMS) { r -= item.weight; if (r <= 0) return item; }
  return DIG_ITEMS[DIG_ITEMS.length - 1];
}

const AQUA_VALID_ITEM_IDS = new Set([
  'cfish','starfish','shell','pearl','seagem','goldfish',
  'trident','seaworm','coin_sea','seaacorn','seahorse','crab',
]);

const { SHOP_ITEMS } = require('./shopItems');

module.exports = {
  WORLD_W, WORLD_H, ROOM_W, ROOM_H, SPEED, TICK_RATE,
  DIG_DURATION_MS, DIG_INTERVAL_MS, DIG_FIND_CHANCE,
  CAT_COLORS, DIG_ITEMS, DIG_ITEMS_MAP, TOTAL_WEIGHT, rollItem,
  SHOP_ITEMS, AQUA_VALID_ITEM_IDS,
};
