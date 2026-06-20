const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
require('dotenv').config();

const OWNER = 'Lil_Teo';
let lastValidBotPosition = null;

const options = {
  host: process.env.MC_HOST,
  port: parseInt(process.env.MC_PORT) || 25565,
  username: 'BugTesterBot',
  auth: process.env.MC_AUTH || 'offline',
  version: process.env.MC_VERSION || '1.20.4'
};

console.log(`[BugTester] Conectando a ${options.host}:${options.port} como ${options.username} en versión ${options.version}...`);
const bot = mineflayer.createBot(options);

bot.loadPlugin(pathfinder);

bot.once('spawn', () => {
  console.log(`[BugTester] ¡Bot spawneado con éxito en ${bot.entity.position}!`);
  if (bot.entity && bot.entity.position) {
    lastValidBotPosition = bot.entity.position.clone();
  }
  
  const mcData = require('minecraft-data')(bot.version);
  const movements = new Movements(bot, mcData);
  
  // Standard configurations (allow standard movements, but no custom workarounds)
  movements.canDig = false;
  movements.allowSprinting = true;
  movements.allowParkour = true;
  
  bot.pathfinder.setMovements(movements);
  console.log(`[BugTester] Pathfinder y Movements configurados con valores estándar.`);
});

// Stethoscopic heartbeat log every 5 seconds to track position and movement
setInterval(() => {
  if (bot.entity) {
    console.log(`[Heartbeat] Pos: ${bot.entity.position.toString()} | Moving: ${bot.pathfinder.isMoving()}`);
  }
}, 5000);

bot.on('chat', async (username, message) => {
  if (username !== OWNER) return;
  
  const msg = message.toLowerCase().trim();
  console.log(`[Command Received] ${username}: ${message}`);
  
  if (msg === 'tpa') {
    console.log(`[BugTester] Enviando tpa a ${OWNER}...`);
    bot.chat(`/tpa ${OWNER}`);
  }
  else if (msg === 'acepta' || msg === 'tpaccept') {
    console.log(`[BugTester] Aceptando tpa...`);
    bot.chat('/tpaccept');
  }
  else if (msg === 'ven') {
    let player = bot.players[username];
    let target = player ? player.entity : null;
    
    if (!target) {
      target = Object.values(bot.entities).find(e => e.type === 'player' && e.username === username);
    }
    
    if (!target) {
      console.log("=== DEBUG: TODOS LOS JUGADORES ===");
      console.log(JSON.stringify(Object.keys(bot.players)));
      console.log("=== DEBUG: TODAS LAS ENTIDADES ===");
      const entityDumps = Object.values(bot.entities).map(e => ({
        id: e.id,
        type: e.type,
        name: e.name,
        displayName: e.displayName,
        username: e.username,
        pos: e.position ? e.position.toString() : 'null'
      }));
      console.log(JSON.stringify(entityDumps, null, 2));
      
      const playersFound = Object.keys(bot.players).join(', ');
      const entityUsernames = Object.values(bot.entities)
        .filter(e => e.type === 'player')
        .map(e => e.username)
        .filter(Boolean)
        .join(', ');
      
      bot.chat(`No te veo cerca. He volcado las entidades al log.`);
      return;
    }
    console.log(`[BugTester] Intentando ir hacia ${username} en ${target.position}...`);
    bot.pathfinder.setGoal(new goals.GoalFollow(target, 1), true);
  } 
  else if (msg.startsWith('ir a ')) {
    const parts = msg.replace('ir a ', '').split(/\s+/);
    if (parts.length === 3) {
      const x = parseFloat(parts[0]);
      const y = parseFloat(parts[1]);
      const z = parseFloat(parts[2]);
      if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
        const targetPos = new Vec3(x, y, z);
        console.log(`[BugTester] Intentando ir a la coordenada ${targetPos}...`);
        bot.pathfinder.setGoal(new goals.GoalBlock(x, y, z), false);
      } else {
        bot.chat('Coordenadas inválidas.');
      }
    } else {
      bot.chat('Formato correcto: ir a <x> <y> <z>');
    }
  }
  else if (msg === 'para' || msg === 'detente') {
    console.log('[BugTester] Deteniendo pathfinding.');
    bot.pathfinder.setGoal(null);
  }
});

// Auto-accept teleport requests from server messages (only if it contains "request" or "solicitud")
bot.on('message', (jsonMsg) => {
  const str = jsonMsg.toString();
  console.log(`[Server Message] ${str}`);
  const lower = str.toLowerCase();
  
  // Exclude confirmations, status messages, instructions, or self-accepted logs
  if (lower.includes('type /') || lower.includes('accepted') || lower.includes('denied') || lower.includes('cancelled') || lower.includes('teleported in') || lower.includes('seconds to accept')) {
    return;
  }
  
  if (lower.includes('request') || lower.includes('solicitud') || lower.includes('envía') || lower.includes('enviado')) {
    if (lower.includes('tpa') || lower.includes('teleport') || lower.includes('teletransporte')) {
      console.log('[BugTester] Detectada solicitud de TPA en el mensaje del servidor. Aceptando...');
      bot.chat('/tpaccept');
    }
  }
});

bot.on('path_update', (results) => {
  if (results && results.path) {
    console.log(`[Path Update] Path length: ${results.path.length}.`);
  }
});

bot.on('goal_reached', () => {
  console.log('[Goal Reached] Objetivo alcanzado con éxito.');
});

bot.on('goal_reset', () => {
  console.log('[Goal Reset] El objetivo fue reiniciado o cancelado.');
});

let ranDebug = false;
const onPhysicsTick = () => {
  if (bot.entity && bot.entity.position) {
    const pos = bot.entity.position;
    if (Number.isFinite(pos.x) && Number.isFinite(pos.y) && Number.isFinite(pos.z)) {
      lastValidBotPosition = pos.clone();
    } else if (lastValidBotPosition) {
      if (!ranDebug) {
        ranDebug = true;
        console.log(`[NaN Recovery] Position is NaN: ${pos.toString()}. Restoring to ${lastValidBotPosition}`);
        console.log(`[NaN Recovery] Velocity: ${bot.entity.velocity ? bot.entity.velocity.toString() : 'null'}`);
      }
      bot.entity.position.x = lastValidBotPosition.x;
      bot.entity.position.y = lastValidBotPosition.y;
      bot.entity.position.z = lastValidBotPosition.z;
      if (bot.entity.velocity) {
        bot.entity.velocity.x = 0;
        bot.entity.velocity.y = 0;
        bot.entity.velocity.z = 0;
      }
    }
  }
};
bot.on('physicTick', onPhysicsTick);
bot.on('physicsTick', onPhysicsTick);
