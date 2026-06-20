const { Movements, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');

let context = {};
let bot = null;

function init(ctx) {
  context = ctx;
  bot = ctx.bot;
  console.log('[AFK] Módulo inicializado con éxito.');
}

function onSpawn() {
  sendOwnerMsg('[AFK] He aparecido y estoy listo en modo AFK.', true);
}

function onChat(message, isWhisper = false) {
  // Can implement specific chat commands if needed
}

function onDeath() {
  console.log('[AFK] Bot ha muerto.');
}

function onEnd() {
  console.log('[AFK] Módulo finalizado.');
}

function sendOwnerMsg(msg, force = false) {
  context.sendOwnerMsg(msg, force);
}

module.exports = {
  init,
  onSpawn,
  onChat,
  onDeath,
  onEnd
};
