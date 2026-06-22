// Global compatibility patch for prismarine-item enchants getter (fixes Minecraft 1.20.5+ / 1.21 item components)
try {
  const prismarineItemPath = require.resolve('prismarine-item');
  const originalLoader = require(prismarineItemPath);
  require.cache[prismarineItemPath].exports = function (registryOrVersion) {
    const Item = originalLoader(registryOrVersion);
    const originalEnchantsGetter = Object.getOwnPropertyDescriptor(Item.prototype, 'enchants')?.get;
    if (originalEnchantsGetter) {
      Object.defineProperty(Item.prototype, 'enchants', {
        get: function () {
          try {
            const val = originalEnchantsGetter.call(this);
            if (Array.isArray(val)) {
              return val;
            }
            if (val && typeof val === 'object') {
              const list = val.enchantments || val.levels || val;
              if (Array.isArray(list)) {
                return list.map(ench => {
                  const rawName = ench.name || ench.id || '';
                  const name = typeof rawName === 'string' ? rawName.replace('minecraft:', '') : rawName;
                  const lvl = ench.lvl !== undefined ? ench.lvl : (ench.level !== undefined ? ench.level : 0);
                  return { name, lvl };
                });
              }
              const result = [];
              for (const [key, lvl] of Object.entries(list)) {
                const name = key.replace('minecraft:', '');
                result.push({ name, lvl });
              }
              return result;
            }
          } catch (e) {
            console.log(`[Patch] Error: ${e.message}`);
          }
          return [];
        },
        configurable: true
      });
    }
    return Item;
  };
} catch (err) {
  console.error('[Patch] Error al aplicar parche de enchants global:', err.message);
}

const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const fs = require('fs');
const path = require('path');

// Load env variables from root directory since bot script was moved to bots/
const dotenvPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(dotenvPath)) {
  require('dotenv').config({ path: dotenvPath });
} else {
  require('dotenv').config();
}

process.on('uncaughtException', (err) => {
  console.error('[CRITICAL] Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[CRITICAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

const botName = process.argv[2];
if (!botName) {
  console.error('Por favor, especifica el nombre del bot. Ejemplo: node bot.js CosechadorBot');
  process.exit(1);
}

// Config file path
const configPath = path.join(__dirname, 'bots_config.json');

// Read all configurations
function readAllConfigs() {
  if (!fs.existsSync(configPath)) {
    return {};
  }
  try {
    const data = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('[Config] Error al leer bots_config.json:', err.message);
    return {};
  }
}

function writeAllConfigs(configs) {
  try {
    fs.writeFileSync(configPath, JSON.stringify(configs, null, 2), 'utf8');
  } catch (err) {
    console.error('[Config] Error al escribir bots_config.json:', err.message);
  }
}

const allConfigs = readAllConfigs();
let botConfig = allConfigs[botName] || {};

// Determine the bot type:
// 1. Command line argument (node bot.js BotName [type])
// 2. Defined in bots_config.json
// 3. Infer from name
let botType = process.argv[3] || botConfig.type;
if (!botType) {
  const nameLower = botName.toLowerCase();
  if (nameLower.includes('cosecha') || nameLower.includes('farm') || nameLower.includes('cultiva')) {
    botType = 'farmer';
  } else if (nameLower.includes('tala') || nameLower.includes('lumber') || nameLower.includes('leña') || nameLower.includes('leñador')) {
    botType = 'lumberjack';
  } else if (nameLower.includes('mine') || nameLower.includes('minero')) {
    botType = 'miner';
  } else if (nameLower.includes('cria') || nameLower.includes('breed') || nameLower.includes('reproduce') || nameLower.includes('criador') || nameLower.includes('animal')) {
    botType = 'breeder';
  } else if (nameLower.includes('rellena') || nameLower.includes('filler') || nameLower.includes('tierra')) {
    botType = 'filler';
  } else if (nameLower.includes('cerca') || nameLower.includes('fence') || nameLower.includes('fencer') || nameLower.includes('muro')) {
    botType = 'fencer';
  } else {
    botType = 'farmer';
    console.warn(`[System] No se pudo determinar el tipo de bot para "${botName}". Usando tipo por defecto: "farmer".`);
  }
}

// Ensure type is saved in configuration
botConfig.type = botType;
allConfigs[botName] = botConfig;
writeAllConfigs(allConfigs);

console.log(`[System] Cargando bot "${botName}" con tipo de profesión "${botType}"...`);

const botModulePath = path.join(__dirname, `${botType}.js`);
if (!fs.existsSync(botModulePath)) {
  console.error(`[System] El archivo de módulo para la profesión "${botType}" no existe en ${botModulePath}`);
  process.exit(1);
}

let botModule = require(botModulePath);

let bot;
let mcData;
let silentMode = botConfig.silentMode !== undefined ? botConfig.silentMode : true;

const OWNER = 'Lil_Teo';

// Connection options
const options = {
  host: process.env.MC_HOST,
  port: parseInt(process.env.MC_PORT),
  username: botName,
  auth: process.env.MC_AUTH,
  version: process.env.MC_VERSION
};

function sendSplitMsg(prefix, msg) {
  const maxChunk = 200;
  if (msg.length <= maxChunk) {
    bot.chat(prefix + msg);
    return;
  }
  
  const chunks = [];
  let remaining = msg;
  while (remaining.length > 0) {
    if (remaining.length <= maxChunk) {
      chunks.push(remaining);
      break;
    }
    let splitIdx = remaining.lastIndexOf(', ', maxChunk);
    if (splitIdx === -1) {
      splitIdx = remaining.lastIndexOf(' ', maxChunk);
    }
    if (splitIdx === -1) {
      splitIdx = maxChunk;
    }
    chunks.push(remaining.substring(0, splitIdx));
    remaining = remaining.substring(splitIdx).trim();
  }
  
  chunks.forEach((chunk, index) => {
    setTimeout(() => {
      if (bot && bot.chat) {
        bot.chat(prefix + chunk);
      }
    }, index * 300);
  });
}

function sendOwnerMsg(msg, force = false) {
  console.log(`[${botName}] ${msg}`);
  if (bot && bot.chat && (!silentMode || force)) {
    sendSplitMsg(`/msg ${OWNER} `, msg);
  }
}


function getConfig() {
  const currentAll = readAllConfigs();
  const botConf = currentAll[botName] || {};
  const shared = currentAll.sharedChests || {};
  return { ...shared, ...botConf };
}

function saveConfig(updatedConfig) {
  const currentAll = readAllConfigs();
  
  const sharedKeys = ['potatoChestPosition', 'wheatChestPosition', 'seedChestPosition', 'carrotChestPosition', 'woodChestPosition', 'extraChestPosition'];
  const sharedUpdate = {};
  const botUpdate = {};
  
  for (const key in updatedConfig) {
    if (sharedKeys.includes(key)) {
      sharedUpdate[key] = updatedConfig[key];
    } else {
      botUpdate[key] = updatedConfig[key];
    }
  }
  
  if (Object.keys(sharedUpdate).length > 0) {
    currentAll.sharedChests = {
      ...(currentAll.sharedChests || {}),
      ...sharedUpdate
    };
  }
  
  currentAll[botName] = {
    ...currentAll[botName],
    ...botUpdate,
    type: botType
  };
  
  // Clean up any individual keys if they are present in bot's config
  for (const key of sharedKeys) {
    if (currentAll[botName] && currentAll[botName][key] !== undefined) {
      delete currentAll[botName][key];
    }
  }
  if (currentAll[botName] && currentAll[botName].chestPosition !== undefined) {
    delete currentAll[botName].chestPosition;
  }
  
  writeAllConfigs(currentAll);
  
  if (updatedConfig.silentMode !== undefined) {
    silentMode = updatedConfig.silentMode;
  }
}

async function changeProfession(newType) {
  console.log(`[System] Cambiando profesión de "${botType}" a "${newType}"...`);
  sendOwnerMsg(`[System] Cambiando profesión de "${botType}" a "${newType}"...`, true);
  
  if (botModule) {
    if (typeof botModule.onEnd === 'function') {
      try {
        botModule.onEnd();
      } catch (err) {
        console.error(`[System] Error al finalizar módulo anterior:`, err.message);
      }
    }
    if (bot && bot.pathfinder) {
      bot.pathfinder.setGoal(null);
    }
    if (bot) {
      bot.stopDigging();
    }
  }
  
  botType = newType;
  const currentAll = readAllConfigs();
  if (currentAll[botName]) {
    currentAll[botName].type = newType;
    currentAll[botName].shouldFarm = false;
    currentAll[botName].shouldChop = false;
    currentAll[botName].shouldBreed = false;
    currentAll[botName].shouldFence = false;
    if (currentAll[botName].miningState) {
      currentAll[botName].miningState.isMining = false;
    }
    writeAllConfigs(currentAll);
  }
  
  const newModulePath = path.join(__dirname, `${newType}.js`);
  if (!fs.existsSync(newModulePath)) {
    sendOwnerMsg(`[System] Error: El archivo de módulo para la profesión "${newType}" no existe.`, true);
    return;
  }
  
  try {
    delete require.cache[require.resolve(newModulePath)];
  } catch (e) {
    console.error(`[System] Error al limpiar cache de require:`, e.message);
  }
  
  botModule = require(newModulePath);
  
  const context = {
    bot,
    getMcData: () => mcData,
    OWNER,
    sendOwnerMsg,
    getConfig,
    saveConfig,
    goToBase,
    digBlock,
    digBlockWithTimeout
  };
  
  if (botModule && typeof botModule.init === 'function') {
    botModule.init(context);
  }
  if (botModule && typeof botModule.onSpawn === 'function') {
    botModule.onSpawn();
  }
  
  sendOwnerMsg(`[System] ¡Profesión cambiada a "${newType}" con éxito!`, true);
}


async function giveItemsToPlayer(targetPlayer, replyFn = sendOwnerMsg) {
  replyFn(`Yendo hacia ti para entregarte los objetos...`, true);

  const targetEntity = bot.players[targetPlayer]?.entity;
  if (!targetEntity) {
    replyFn('No te encuentro cerca. Por favor, acércate o mándame tpa.', true);
    return;
  }

  bot.pathfinder.setGoal(null);
  const movements = new Movements(bot, mcData);
  movements.liquidCost = 10;
  movements.canDig = false;
  movements.allowSprinting = false;
  movements.allowParkour = false;
  if (botType === 'miner') {
    movements.allowDiagonal = false;
  }
  bot.pathfinder.setMovements(movements);

  try {
    await bot.pathfinder.goto(new goals.GoalFollow(targetEntity, 1.5));
    replyFn('Soltando inventario...', true);

    const items = bot.inventory.items();
    for (const item of items) {
      try {
        await bot.tossStack(item);
        await new Promise(r => setTimeout(r, 200));
      } catch (err) {
        console.log(`[Inventory] Error al soltar ${item.name}: ${err.message}`);
      }
    }
    replyFn('¡Todos los objetos entregados!', true);
  } catch (err) {
    replyFn(`No pude llegar a ti: ${err.message}`, true);
  }
}

function showGeneralHelp() {
  const helpLines = [
    '--- COMANDOS GENERALES (Todos los bots) ---',
    'habla - Activa el modo hablado (el bot enviará mensajes al dueño)',
    'silencio - Activa el modo silencio (el bot trabajará en silencio)',
    'ven - Envía una solicitud de teletransporte (tpa) al dueño',
    'vuelve - Regresa al punto anterior (/back)',
    'dame - Entrega todos los ítems de su inventario al dueño',
    'cultivador - Asigna la profesión de Granjero',
    'talador - Asigna la profesión de Talador',
    'minero - Asigna la profesión de Minero',
    'criador - Asigna la profesión de Criador de animales',
    'trabaja - Inicia/reanuda el trabajo de la profesión asignada',
    'rellenador - Asigna la profesión de Rellenador',
    'cercador - Asigna la profesión de Cercador',
    'ayuda <granjero|talador|minero|criador|rellenador|cercador> - Muestra comandos de una profesión'
  ];
  for (const line of helpLines) {
    sendOwnerMsg(line, true);
  }
}

function showModuleHelp(type) {
  if (type === 'farmer') {
    const helpLines = [
      '--- COMANDOS DE FARMER (Granjero) ---',
      'trabaja - Inicia el cultivo automático de campos',
      'para - Detiene el cultivo automático',
      'cofre <papas|trigo|semillas|zanahorias|extras|leña> <x> <y> <z> - Configura cofres específicos',
      'cama <x> <y> <z> - Configura la posición de la cama para guardar respawn'
    ];
    for (const line of helpLines) {
      sendOwnerMsg(line, true);
    }
  } else if (type === 'lumberjack') {
    const helpLines = [
      '--- COMANDOS DE LUMBERJACK (Talador) ---',
      'trabaja - Inicia la tala automática de árboles',
      'para - Detiene la tala automática',
      'cofre leña <x> <y> <z> - Configura el cofre para guardar madera y manzanas',
      'cama <x> <y> <z> - Configura la cama para guardar respawn'
    ];
    for (const line of helpLines) {
      sendOwnerMsg(line, true);
    }
  } else if (type === 'miner') {
    const helpLines = [
      '--- COMANDOS DE MINER (Minero) ---',
      'trabaja - Reanuda la minería con la última configuración guardada',
      'minar aqui <dirección> - Inicia minería desde posición actual (Y=-53)',
      'minar <x> <z> <dirección> - Inicia minería desde las coordenadas (Y=-53)',
      'minar <x> <y> <z> <dirección> - Inicia minería en coordenadas exactas',
      'para / detener - Detiene el ciclo de minado automático',
      'picotas <x> <y> <z> - Configura el cofre de picotas de repuesto',
      'ores <x> <y> <z> - Configura el cofre de depósito de minerales',
      'reabastecer - Fuerza reabastecimiento manual de picotas',
      'depositar - Fuerza depósito manual de minerales recolectados',
      'status / info - Muestra el estado del minero'
    ];
    for (const line of helpLines) {
      sendOwnerMsg(line, true);
    }
  } else if (type === 'breeder' || type === 'criador') {
    const helpLines = [
      '--- COMANDOS DE BREEDER (Criador) ---',
      'trabaja / cria - Inicia la crianza automática de animales',
      'para - Detiene la crianza automática',
      'cofre <trigo|semillas|zanahorias|papas> <x> <y> <z> - Configura cofres de comida',
      'cama <x> <y> <z> - Configura la posición de la cama para guardar respawn'
    ];
    for (const line of helpLines) {
      sendOwnerMsg(line, true);
    }
  } else if (type === 'filler' || type === 'rellenador') {
    const helpLines = [
      '--- COMANDOS DE FILLER (Rellenador) ---',
      'trabaja / rellena - Inicia el relleno automático de la superficie',
      'para / detener - Detiene el relleno automático',
      'limites <x1> <z1> <x2> <z2> <y> - Configura las coordenadas del área',
      'status / info - Muestra el estado del relleno y cantidad de tierra'
    ];
    for (const line of helpLines) {
      sendOwnerMsg(line, true);
    }
  } else if (type === 'fencer' || type === 'cercador') {
    const helpLines = [
      '--- COMANDOS DE FENCER (Cercador) ---',
      'trabaja / cerca - Inicia la sustitución de la cerca por muro',
      'para / detener - Detiene el bot',
      'status / info - Muestra el estado actual y materiales'
    ];
    for (const line of helpLines) {
      sendOwnerMsg(line, true);
    }
  } else {
    sendOwnerMsg(`Profesión desconocida: ${type}`, true);
  }
}

async function handleCommonCommand(message, isWhisper = false, sender = OWNER) {
  function sendOwnerMsg(msg, force = false) {
    console.log(`[${botName}] ${msg}`);
    if (bot && bot.chat && (!silentMode || force)) {
      sendSplitMsg(`/msg ${sender} `, msg);
    }
  }

  let msg = message.toLowerCase().trim();
  const myName = botName.toLowerCase();

  const words = msg.split(/\s+/);
  if (words.length > 1) {
    const firstWord = words[0];
    if (firstWord === myName) {
      msg = words.slice(1).join(' ');
    } else if (firstWord === 'cosechadores' || firstWord === 'farmers') {
      if (botType === 'farmer') msg = words.slice(1).join(' ');
    } else if (firstWord === 'taladores' || firstWord === 'lumberjacks') {
      if (botType === 'lumberjack') msg = words.slice(1).join(' ');
    } else if (firstWord === 'mineros' || firstWord === 'miners') {
      if (botType === 'miner') msg = words.slice(1).join(' ');
    } else if (firstWord === 'criadores' || firstWord === 'breeders') {
      if (botType === 'breeder') msg = words.slice(1).join(' ');
    } else if (firstWord === 'rellenadores' || firstWord === 'fillers') {
      if (botType === 'filler') msg = words.slice(1).join(' ');
    } else if (firstWord === 'cercadores' || firstWord === 'fencers') {
      if (botType === 'fencer') msg = words.slice(1).join(' ');
    } else if (!isWhisper) {
      const onlinePlayers = Object.keys(bot.players).map(p => p.toLowerCase());
      if (onlinePlayers.includes(firstWord) && firstWord !== myName) {
        return;
      }
    }
  }

  // Handle help commands
  if (msg === 'help' || msg === 'ayuda') {
    showGeneralHelp();
    return;
  }
  if (msg === 'help farmer' || msg === 'ayuda farmer' || msg === 'ayuda granjero') {
    showModuleHelp('farmer');
    return;
  }
  if (msg === 'help lumberjack' || msg === 'ayuda lumberjack' || msg === 'ayuda talador') {
    showModuleHelp('lumberjack');
    return;
  }
  if (msg === 'help miner' || msg === 'ayuda miner' || msg === 'ayuda minero') {
    showModuleHelp('miner');
    return;
  }
  if (msg === 'help breeder' || msg === 'ayuda breeder' || msg === 'ayuda criador') {
    showModuleHelp('breeder');
    return;
  }
  if (msg === 'help filler' || msg === 'ayuda filler' || msg === 'ayuda rellenador') {
    showModuleHelp('filler');
    return;
  }
  if (msg === 'help fencer' || msg === 'ayuda fencer' || msg === 'ayuda cercador') {
    showModuleHelp('fencer');
    return;
  }

  if (msg === 'habla') {
    saveConfig({ silentMode: false });
    sendOwnerMsg('Modo hablado activado. De ahora en adelante informaré mis acciones.', true);
  } else if (msg === 'silencio') {
    saveConfig({ silentMode: true });
    sendOwnerMsg('Modo silencio activado. Trabajaré sin enviar mensajes.', true);
  } else if (msg === 'ven') {
    sendOwnerMsg('Enviando solicitud de teletransporte (tpa)...', true);
    bot.chat(`/tpa ${sender}`);
  } else if (msg === 'vuelve') {
    sendOwnerMsg('Regresando (back)...', true);
    bot.chat('/back');
  } else if (msg === 'cama yo') {
    const player = bot.players[sender.toLowerCase()] || bot.players[sender];
    if (!player || !player.entity) {
      sendOwnerMsg('No puedo ver tu posición. Asegúrate de estar cerca.', true);
      return;
    }
    const pPos = player.entity.position.floored();
    let bedPos = null;
    
    const below = pPos.offset(0, -1, 0);
    const blockBelow = bot.blockAt(below);
    const atFeet = bot.blockAt(pPos);
    
    if (blockBelow && blockBelow.name.includes('bed')) {
      bedPos = below;
    } else if (atFeet && atFeet.name.includes('bed')) {
      bedPos = pPos;
    } else {
      const bedBlock = bot.findBlock({
        matching: (block) => block && block.name.includes('bed'),
        point: pPos,
        maxDistance: 3
      });
      if (bedBlock) {
        bedPos = bedBlock.position;
      }
    }
    
    if (bedPos) {
      const { x, y, z } = bedPos;
      saveConfig({ bedPosition: { x, y, z } });
      sendOwnerMsg(`Guardada posición de cama en ${bedPos}. Moviéndome allí para establecer respawn...`, true);
      
      bot.pathfinder.setGoal(null);
      goToBase(bedPos, 2, 20000).then(async (reached) => {
        if (!reached) {
          sendOwnerMsg(`No pude llegar a la cama en ${bedPos}`, true);
          return;
        }
        
        const bedBlock = bot.blockAt(bedPos);
        if (!bedBlock || !bedBlock.name.includes('bed')) {
          sendOwnerMsg(`El bloque en ${bedPos} no es una cama.`, true);
          return;
        }
        
        try {
          await bot.lookAt(bedPos.offset(0.5, 0.5, 0.5));
          await bot.activateBlock(bedBlock);
          sendOwnerMsg(`Interactuado con la cama en ${bedPos} para establecer respawn.`, true);
        } catch (err) {
          sendOwnerMsg(`Error al interactuar con la cama: ${err.message}`, true);
        }
      });
      
      if (botModule && typeof botModule.loadBotConfig === 'function') {
        botModule.loadBotConfig();
      }
    } else {
      sendOwnerMsg('No encontré ninguna cama debajo de ti ni a tu alrededor (rango 3).', true);
    }
  } else if (msg.startsWith('cofre ') && msg.endsWith(' yo')) {
    const parts = msg.split(/\s+/);
    if (parts.length === 3) {
      const type = parts[1];
      const player = bot.players[sender.toLowerCase()] || bot.players[sender];
      if (!player || !player.entity) {
        sendOwnerMsg('No puedo ver tu posición. Asegúrate de estar cerca.', true);
        return;
      }
      const pPos = player.entity.position.floored();
      let chestPos = null;
      
      const below = pPos.offset(0, -1, 0);
      const blockBelow = bot.blockAt(below);
      const atFeet = bot.blockAt(pPos);
      
      if (blockBelow && blockBelow.name.includes('chest')) {
        chestPos = below;
      } else if (atFeet && atFeet.name.includes('chest')) {
        chestPos = pPos;
      } else {
        const chestBlock = bot.findBlock({
          matching: (block) => block && block.name.includes('chest'),
          point: pPos,
          maxDistance: 3
        });
        if (chestBlock) {
          chestPos = chestBlock.position;
        }
      }
      
      if (!chestPos) {
        sendOwnerMsg('No encontré ningún cofre debajo de ti ni a tu alrededor (rango 3).', true);
        return;
      }
      
      let key = null;
      if (type === 'papas' || type === 'papa') key = 'potatoChestPosition';
      else if (type === 'trigo') key = 'wheatChestPosition';
      else if (type === 'semillas' || type === 'semilla') key = 'seedChestPosition';
      else if (type === 'zanahorias' || type === 'zanahoria') key = 'carrotChestPosition';
      else if (type === 'leña' || type === 'madera') key = 'woodChestPosition';
      else if (type === 'palos' || type === 'palo' || type === 'sticks' || type === 'stick') key = 'stickChestPosition';
      else if (type === 'extras' || type === 'extra' || type === 'basura' || type === 'descarte') key = 'extraChestPosition';
      else if (type === 'picotas' || type === 'picota') key = 'picotasChest';
      else if (type === 'ores' || type === 'ore' || type === 'minerales' || type === 'mineral') key = 'oresChest';
      else if (type === 'hachas' || type === 'hacha') key = 'axeChestPosition';
      else if (type === 'saplings' || type === 'sapling' || type === 'retoños' || type === 'retoño') key = 'saplingChestPosition';
      
      if (!key) {
        sendOwnerMsg(`Tipo de cofre desconocido: "${type}". Usa: papas, trigo, semillas, zanahorias, extras, leña, palos, picotas, ores, hachas, saplings.`, true);
        return;
      }
      
      const { x, y, z } = chestPos;
      saveConfig({ [key]: { x, y, z } });
      sendOwnerMsg(`Posición del cofre de ${type} configurada en ${chestPos} a partir de tu ubicación.`, true);
      
      if (botModule && typeof botModule.loadBotConfig === 'function') {
        botModule.loadBotConfig();
      }
    } else {
      sendOwnerMsg('Formato incorrecto. Usa: cofre <tipo> yo', true);
    }
  } else if (msg.startsWith('cama ')) {
    const parts = message.trim().split(/\s+/);
    if (parts.length === 4) {
      const x = Math.floor(parseFloat(parts[1]));
      const y = Math.floor(parseFloat(parts[2]));
      const z = Math.floor(parseFloat(parts[3]));
      if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
        const bedPos = new Vec3(x, y, z);
        saveConfig({ bedPosition: { x, y, z } });
        sendOwnerMsg(`Guardada posición de cama en ${bedPos}. Moviéndome allí para establecer respawn...`, true);
        
        bot.pathfinder.setGoal(null);
        goToBase(bedPos, 2, 20000).then(async (reached) => {
          if (!reached) {
            sendOwnerMsg(`No pude llegar a la cama en ${bedPos}`, true);
            return;
          }
          
          const bedBlock = bot.blockAt(bedPos);
          if (!bedBlock || !bedBlock.name.includes('bed')) {
            sendOwnerMsg(`El bloque en ${bedPos} no es una cama.`, true);
            return;
          }
          
          try {
            await bot.lookAt(bedPos.offset(0.5, 0.5, 0.5));
            await bot.activateBlock(bedBlock);
            sendOwnerMsg(`Interactuado con la cama en ${bedPos} para establecer respawn.`, true);
          } catch (err) {
            sendOwnerMsg(`Error al interactuar con la cama: ${err.message}`, true);
          }
        });
      } else {
        sendOwnerMsg('Coordenadas de cama inválidas. Usa: cama <x> <y> <z>', true);
      }
    } else {
      sendOwnerMsg('Formato incorrecto. Usa: cama <x> <y> <z>', true);
    }
  } else if (msg === 'dame') {
    await giveItemsToPlayer(sender, sendOwnerMsg);
  } else if (msg === 'objetos') {
    const items = bot.inventory.items();
    if (items.length === 0) {
      sendOwnerMsg('Mi inventario está vacío.', true);
    } else {
      const itemStrings = items.map(item => `${item.count}x ${item.name}`);
      sendOwnerMsg(`Inventario: ${itemStrings.join(', ')}`, true);
    }
  } else if (msg === 'ver') {
    const pos = bot.entity.position;
    const feet = bot.blockAt(pos.floored());
    const head = bot.blockAt(pos.floored().offset(0, 1, 0));
    const below = bot.blockAt(pos.floored().offset(0, -1, 0));
    sendOwnerMsg(`Pos: ${pos.toString()}`, true);
    sendOwnerMsg(`Cabeza: ${head ? head.name : 'null'}, Pies: ${feet ? feet.name : 'null'}, Suelo: ${below ? below.name : 'null'}`, true);
    
    // Check in the direction the bot is looking
    const yaw = bot.entity.yaw;
    const dir = new Vec3(-Math.sin(yaw), 0, -Math.cos(yaw)).normalize();
    const frontPos = pos.floored().plus(dir.floored());
    const frontFeet = bot.blockAt(frontPos);
    const frontHead = bot.blockAt(frontPos.offset(0, 1, 0));
    sendOwnerMsg(`Mirando dir aprox: ${dir.toString()}`, true);
    sendOwnerMsg(`Frente Cabeza: ${frontHead ? frontHead.name : 'null'}, Frente Pies: ${frontFeet ? frontFeet.name : 'null'}`, true);
  } else if (msg.startsWith('pica')) {
    const yaw = bot.entity.yaw;
    const dir = new Vec3(-Math.sin(yaw), 0, -Math.cos(yaw)).normalize();
    const targetPos = bot.entity.position.floored().plus(dir.floored());
    const block = bot.blockAt(targetPos);
    if (!block || block.name === 'air') {
      sendOwnerMsg(`No hay bloque sólido al frente en ${targetPos} (encontrado: ${block ? block.name : 'null'})`, true);
      return;
    }
    sendOwnerMsg(`Intentando picar bloque ${block.name} en ${targetPos}...`, true);
    
    // Equip pickaxe
    const items = bot.inventory.items();
    const pickaxe = items.find(item => item.name.includes('pickaxe'));
    if (pickaxe) {
      sendOwnerMsg(`Equipando ${pickaxe.name}...`, true);
      await bot.equip(pickaxe, 'hand');
    } else {
      sendOwnerMsg(`Advertencia: No tengo picota en el inventario. Usando mano vacía.`, true);
    }
    
    try {
      await bot.lookAt(block.position.offset(0.5, 0.5, 0.5));
      sendOwnerMsg(`Llamando a bot.dig...`, true);
      const startTime = Date.now();
      await bot.dig(block);
      const duration = Date.now() - startTime;
      sendOwnerMsg(`¡bot.dig completado con éxito en ${duration}ms!`, true);
    } catch (err) {
      sendOwnerMsg(`Fallo al picar: ${err.message}`, true);
    }
  } else {
    // Intercept profession commands to switch dynamically
    if (msg === 'talador') {
      if (botType !== 'lumberjack') {
        await changeProfession('lumberjack');
      } else {
        sendOwnerMsg('[System] El bot ya tiene asignada la profesión de Talador.', true);
      }
    } else if (msg === 'cultivador') {
      if (botType !== 'farmer') {
        await changeProfession('farmer');
      } else {
        sendOwnerMsg('[System] El bot ya tiene asignada la profesión de Granjero.', true);
      }
    } else if (msg === 'minero') {
      if (botType !== 'miner') {
        await changeProfession('miner');
      } else {
        sendOwnerMsg('[System] El bot ya tiene asignada la profesión de Minero.', true);
      }
    } else if (msg === 'criador' || msg === 'breeder') {
      if (botType !== 'breeder') {
        await changeProfession('breeder');
      } else {
        sendOwnerMsg('[System] El bot ya tiene asignada la profesión de Criador.', true);
      }
    } else if (msg === 'rellenador' || msg === 'filler') {
      if (botType !== 'filler') {
        await changeProfession('filler');
      } else {
        sendOwnerMsg('[System] El bot ya tiene asignada la profesión de Rellenador.', true);
      }
    } else if (msg === 'cercador' || msg === 'fencer') {
      if (botType !== 'fencer') {
        await changeProfession('fencer');
      } else {
        sendOwnerMsg('[System] El bot ya tiene asignada la profesión de Cercador.', true);
      }
    } else {
      // Delegate to module if it's not a common command
      if (botModule && typeof botModule.onChat === 'function') {
        botModule.onChat(message, isWhisper);
      }
    }
  }
}

async function goToBase(pos, range = 2, timeoutMs = 15000, movementsConfigurer = null, isSleepRequest = false) {
  if (isSleepRequest) {
    bot.allowSleepGoal = true;
  }

  const setGoal = isSleepRequest ? (bot.pathfinder.originalSetGoal || bot.pathfinder.setGoal) : bot.pathfinder.setGoal;
  const goto = isSleepRequest ? (bot.pathfinder.originalGoto || bot.pathfinder.goto) : bot.pathfinder.goto;

  setGoal.call(bot.pathfinder, null);

  const movements = new Movements(bot, mcData);
  movements.liquidCost = 10;
  if (movementsConfigurer) {
    movementsConfigurer(movements);
  } else {
    movements.canDig = false;
    movements.allowSprinting = false;
    movements.allowParkour = false;
    movements.scafoldingBlocks = [];
  }
  if (botType === 'miner') {
    movements.allowDiagonal = false;
  }
  bot.pathfinder.setMovements(movements);

  const goal = new goals.GoalNear(pos.x, pos.y, pos.z, range);

  return new Promise((resolve) => {
    let completed = false;

    const timer = setTimeout(() => {
      if (!completed) {
        completed = true;
        setGoal.call(bot.pathfinder, null);
        console.log(`[Navigation] Tiempo de espera agotado navegando a ${pos}`);
        if (isSleepRequest) {
          bot.allowSleepGoal = false;
        }
        resolve(false);
      }
    }, timeoutMs);

    goto.call(bot.pathfinder, goal)
      .then(() => {
        if (!completed) {
          completed = true;
          clearTimeout(timer);
          if (isSleepRequest) {
            bot.allowSleepGoal = false;
          }
          resolve(true);
        }
      })
      .catch((err) => {
        if (!completed) {
          completed = true;
          clearTimeout(timer);
          console.log(`[Navigation] Error al navegar a ${pos}: ${err.message}`);
          if (isSleepRequest) {
            bot.allowSleepGoal = false;
          }
          resolve(false);
        }
      });
  });
}

async function digBlockWithTimeout(block, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let completed = false;

    const timer = setTimeout(() => {
      if (!completed) {
        completed = true;
        bot.stopDigging();
        reject(new Error('Tiempo de espera de excavación agotado'));
      }
    }, timeoutMs);

    bot.dig(block)
      .then(() => {
        if (!completed) {
          completed = true;
          clearTimeout(timer);
          resolve();
        }
      })
      .catch((err) => {
        if (!completed) {
          completed = true;
          clearTimeout(timer);
          reject(err);
        }
      });
  });
}

async function digBlock(block) {
  if (!block || bot.blockAt(block.position).type === 0) return false;

  try {
    bot.clearControlStates();
    await bot.lookAt(block.position.offset(0.5, 0.5, 0.5));
    await digBlockWithTimeout(block, 10000);
    return true;
  } catch (err) {
    console.log(`[Digging] Error al excavar en ${block.position}: ${err.message}`);
    return false;
  }
}


function createBot() {
  console.log(`[System] Conectando a ${options.host}:${options.port} como ${options.username}...`);
  bot = mineflayer.createBot(options);

  bot.loadPlugin(pathfinder);

  bot.once('inject_allowed', () => {
    // Intercept pathfinder calls to block them when going to sleep
    const originalSetGoal = bot.pathfinder.setGoal;
    const originalGoto = bot.pathfinder.goto;
    bot.pathfinder.originalSetGoal = originalSetGoal;
    bot.pathfinder.originalGoto = originalGoto;

    bot.pathfinder.setGoal = (goal) => {
      if (bot.isGoingToSleep && !bot.allowSleepGoal) {
        console.log(`[Sleep Intercept] Bloqueado setGoal para ${options.username}`);
        return;
      }
      originalSetGoal.call(bot.pathfinder, goal);
    };

    bot.pathfinder.goto = async (goal) => {
      if (bot.isGoingToSleep && !bot.allowSleepGoal) {
        console.log(`[Sleep Intercept] Bloqueado goto para ${options.username}`);
        throw new Error('Blocked by sleeping routine');
      }
      return originalGoto.call(bot.pathfinder, goal);
    };

    // Patch bot.digTime to fix slow digging on ores and deepslate blocks
    const originalDigTime = bot.digTime;
    bot.digTime = function (block) {
      const heldItem = bot.heldItem;
      const isPickaxe = heldItem && heldItem.name.includes('pickaxe');
      const isOreOrStone = block && (
        block.name.includes('ore') || 
        block.name.includes('raw_') || 
        block.name.includes('deepslate') || 
        block.name.includes('stone') || 
        block.name.includes('coal') ||
        block.name.includes('iron') ||
        block.name.includes('gold') ||
        block.name.includes('diamond') ||
        block.name.includes('redstone') ||
        block.name.includes('lapis') ||
        block.name.includes('emerald') ||
        block.name.includes('copper') ||
        block.name.includes('obsidian') ||
        block.name.includes('basalt') ||
        block.name.includes('blackstone')
      );

      if (isPickaxe && isOreOrStone) {
        const hardness = block.hardness;
        if (hardness === null || hardness === undefined) {
          return originalDigTime.call(bot, block);
        }

        const toolMultipliers = {
          wooden_pickaxe: 2,
          golden_pickaxe: 12,
          stone_pickaxe: 4,
          iron_pickaxe: 6,
          diamond_pickaxe: 8,
          netherite_pickaxe: 9
        };

        const baseMultiplier = toolMultipliers[heldItem.name] || 1;
        let speed = baseMultiplier;

        if (heldItem.enchants) {
          const efficiency = heldItem.enchants.find(e => e.name === 'efficiency' || e.name === 'efficiency');
          if (efficiency) {
            speed += (efficiency.lvl * efficiency.lvl) + 1;
          }
        }

        const haste = bot.effects && bot.effects[3];
        if (haste) {
          speed *= (1 + 0.2 * (haste.amplifier + 1));
        }

        const fatigue = bot.effects && bot.effects[4];
        if (fatigue) {
          speed *= Math.pow(0.3, fatigue.amplifier + 1);
        }

        let time = (hardness * 1.5) / speed;

        const blockAtFeet = bot.blockAt(bot.entity.position);
        const inWater = blockAtFeet && (blockAtFeet.name.includes('water') || blockAtFeet.name.includes('lava'));
        let aquaAffinity = false;
        const helmet = bot.inventory.slots[5];
        if (helmet && helmet.enchants) {
          aquaAffinity = helmet.enchants.some(e => e.name === 'aqua_affinity');
        }
        if (inWater && !aquaAffinity) {
          time *= 5;
        }

        if (!bot.entity.onGround) {
          time *= 5;
        }

        return Math.max(0, Math.round(time * 1000));
      }

      return originalDigTime.call(bot, block);
    };
  });

  let lastSpawnTime = 0;
  let preventReconnect = false;

  bot.on('path_update', (results) => {
    if (results && results.path) {
      bot.pathfinder.currentPath = results.path;
      console.log(`[Path Debug] "${options.username}" path length: ${results.path.length}. First 5 nodes: ${
        results.path.slice(0, 5).map(node => `(${node.x.toFixed(1)}, ${node.y.toFixed(1)}, ${node.z.toFixed(1)})`).join(' -> ')
      }`);
    }
  });

  let lastHeartbeat = Date.now();

  bot.on('physicsTick', () => {
    const now = Date.now();
    if (now - lastHeartbeat > 5000) {
      console.log(`[Heartbeat] Bot "${options.username}" at ${bot.entity?.position?.toString()}, isMoving: ${bot.pathfinder?.isMoving()}, time: ${bot.time ? bot.time.timeOfDay : 'undefined'}, isNight: ${bot.time ? bot.time.isNight : 'undefined'}`);
      lastHeartbeat = now;
    }
  });

  bot.on('spawn', () => {
    lastSpawnTime = Date.now();
    console.log(`[System] Bot "${options.username}" ha aparecido en el juego.`);
    
    mcData = require('minecraft-data')(bot.version);

    // Start Prismarine Viewer if configured
    const currentConf = getConfig();
    if (currentConf.viewerPort) {
      console.log(`[System] Iniciando Prismarine Viewer para "${options.username}" en el puerto ${currentConf.viewerPort}...`);
      try {
        const httpModule = require('http');
        const originalCreateServer = httpModule.createServer;
        
        // Intercept server creation to catch asynchronous network errors (like port already in use)
        httpModule.createServer = function(...args) {
          const server = originalCreateServer.apply(this, args);
          server.on('error', (err) => {
            console.error(`[System] [Prismarine Viewer Server Error] El visor de "${options.username}" falló en el puerto ${currentConf.viewerPort}:`, err.message);
          });
          return server;
        };

        const mineflayerViewer = require('prismarine-viewer').mineflayer;
        mineflayerViewer(bot, { port: parseInt(currentConf.viewerPort), firstPerson: true, viewDistance: 2 });
        
        // Restore original createServer immediately
        httpModule.createServer = originalCreateServer;

        console.log(`[System] Prismarine Viewer iniciado con éxito en http://localhost:${currentConf.viewerPort}`);
      } catch (err) {
        console.error(`[System] Error al iniciar Prismarine Viewer para "${options.username}":`, err.message);
      }
    }

    // Track and log inventory updates to logs/bot_<Name>_inventory.json
    let invTimeout = null;
    function queueInventoryWrite() {
      if (invTimeout) return;
      invTimeout = setTimeout(() => {
        invTimeout = null;
        try {
          const logsDir = path.join(__dirname, 'logs');
          if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir);
          }
          const invPath = path.join(logsDir, `bot_${botName}_inventory.json`);
          const items = bot.inventory.items().map(item => ({
            name: item.name,
            displayName: item.displayName || item.name,
            count: item.count,
            slot: item.slot
          }));
          fs.writeFileSync(invPath, JSON.stringify(items, null, 2), 'utf8');
        } catch (err) {
          console.error(`[Inventory Log] Error:`, err.message);
        }
      }, 500);
    }

    bot.inventory.on('updateSlot', queueInventoryWrite);
    queueInventoryWrite();



    const context = {
      bot,
      getMcData: () => mcData,
      OWNER,
      sendOwnerMsg,
      getConfig,
      saveConfig,
      goToBase,
      digBlock,
      digBlockWithTimeout
    };

    if (botModule && typeof botModule.init === 'function') {
      botModule.init(context);
    }

    if (botModule && typeof botModule.onSpawn === 'function') {
      botModule.onSpawn();
    }

    if (bot.autoEatInterval) clearInterval(bot.autoEatInterval);
    let isEating = false;
    bot.autoEatInterval = setInterval(async () => {
      if (!bot || !bot.entity || isEating || bot.isSleeping) return;
      if (bot.food < 15) {
        const foodItems = ['carrot', 'baked_potato', 'bread', 'cooked_beef', 'cooked_chicken', 'cooked_porkchop', 'golden_carrot', 'apple', 'melon_slice', 'sweet_berries', 'potato'];
        const food = bot.inventory.items().find(item => foodItems.includes(item.name));
        if (food) {
          isEating = true;
          console.log(`[Auto-Eat] Bot "${options.username}" tiene hambre (${bot.food}/20). Equipando y comiendo ${food.name}...`);
          try {
            const prevItem = bot.inventory.slots[bot.getEquipmentDestSlot('hand')];
            await bot.equip(food, 'hand');
            await bot.consume();
            console.log(`[Auto-Eat] Bot "${options.username}" terminó de comer ${food.name}.`);
            if (prevItem) {
              await bot.equip(prevItem, 'hand');
            }
          } catch (err) {
            console.log(`[Auto-Eat] Error al comer: ${err.message}`);
          } finally {
            isEating = false;
          }
        }
      }
    }, 10000);
  });

  const ALLOWED_PLAYERS = [OWNER.toLowerCase(), 'pacino', 'tamgrl'];

  bot.on('chat', (username, message) => {
    if (!ALLOWED_PLAYERS.includes(username.toLowerCase())) return;
    handleCommonCommand(message, false, username);
  });

  bot.on('whisper', (username, message) => {
    if (!ALLOWED_PLAYERS.includes(username.toLowerCase())) return;
    handleCommonCommand(message, true, username);
  });

  bot.on('message', (jsonMsg) => {
    const text = jsonMsg.toString();
    console.log(`[Message] ${text}`);
    const cleanText = text.toLowerCase();
    const isTpaFromAllowedUser = ALLOWED_PLAYERS.some(p => cleanText.includes(p));

    if (isTpaFromAllowedUser && (
      cleanText.includes('tpa') ||
      cleanText.includes('teleport') ||
      cleanText.includes('teletransportar') ||
      cleanText.includes('solicita') ||
      cleanText.includes('petición') ||
      cleanText.includes('peticion') ||
      cleanText.includes('pedir') ||
      cleanText.includes('request') ||
      cleanText.includes('enviado una solicitud') ||
      cleanText.includes('tpaccept')
    )) {
      let sender = OWNER;
      if (cleanText.includes('pacino')) {
        sender = 'PACINO';
      } else if (cleanText.includes('tamgrl')) {
        sender = 'TamGrl';
      }
      console.log(`[Teleport] Aceptando TPA de ${sender} immediately...`);
      bot.chat('/tpaccept');
      if (sender === OWNER) {
        sendOwnerMsg('Aceptando tu solicitud de teletransporte de manera inmediata.', true);
      } else {
        bot.chat(`/w ${sender} [System] Aceptando tu solicitud de teletransporte de manera inmediata.`);
      }
    }
  });

  bot.on('death', () => {
    if (bot.autoEatInterval) {
      clearInterval(bot.autoEatInterval);
      bot.autoEatInterval = null;
    }
    console.log('[System] Bot ha muerto. Respawnando...');
    sendOwnerMsg('[System] Bot ha muerto. Respawnando...', true);
    
    const timeSinceSpawn = Date.now() - lastSpawnTime;
    if (lastSpawnTime > 0 && timeSinceSpawn < 60000) {
      preventReconnect = true;
      console.log(`[System] Bot murió demasiado rápido (${(timeSinceSpawn / 1000).toFixed(1)}s). Desconectando para evitar muertes repetitivas.`);
      sendOwnerMsg(`[System] He muerto demasiado rápido (${(timeSinceSpawn / 1000).toFixed(1)}s). Desconectando para prevención de muertes repetitivas.`, true);
      bot.quit();
      return;
    }
    
    if (botModule && typeof botModule.onDeath === 'function') {
      botModule.onDeath();
    }
    bot.isGoingToSleep = false;
    bot.respawn();
  });

  bot.on('error', (err) => {
    console.error('[System] Error del bot:', err);
  });

  let lastSleepCheck = 0;
  bot.isGoingToSleep = false;

  bot.on('time', () => {
    const now = Date.now();
    if (now - lastSleepCheck < 5000) return;
    lastSleepCheck = now;

    if (botType === 'miner') return; // Miner bots don't go to sleep automatically

    const timeOfDay = bot.time ? (bot.time.timeOfDay % 24000) : 0;
    const isNight = bot.time && (timeOfDay >= 13000 && timeOfDay < 23000);

    if (!isNight) {
      if (bot.isGoingToSleep) {
        console.log(`[Sleep] Ya es de día. Cancelando ir a dormir.`);
        bot.isGoingToSleep = false;
      }
      return;
    }

    if (bot.isSleeping || bot.isGoingToSleep) return;

    const config = getConfig();
    let bedPos = null;
    if (config.bedPosition) {
      const p = config.bedPosition;
      const testPos = new Vec3(p.x, p.y, p.z);
      const testBlock = bot.blockAt(testPos);
      if (testBlock && testBlock.name.includes('bed')) {
        bedPos = testPos;
      }
    }

    if (!bedPos) {
      const bedBlock = bot.findBlock({
        matching: (block) => block.name.includes('bed'),
        maxDistance: 32
      });
      if (bedBlock) {
        bedPos = bedBlock.position;
      }
    }

    if (bedPos) {
      const bedBlock = bot.blockAt(bedPos);
      if (!bedBlock || !bedBlock.name.includes('bed')) return;

      console.log(`[Sleep] Es de noche. Yendo a la cama en ${bedPos}...`);
      bot.isGoingToSleep = true;
      bot.pathfinder.originalSetGoal.call(bot.pathfinder, null);
      bot.stopDigging();

      goToBase(bedPos, 2, 20000, null, true).then(async (reached) => {
        if (!reached) {
          console.log(`[Sleep] No pude llegar a la cama en ${bedPos}`);
          bot.isGoingToSleep = false;
          return;
        }

        try {
          await bot.lookAt(bedPos.offset(0.5, 0.5, 0.5));
          console.log(`[Sleep] Intentando dormir en ${bedPos}`);
          await bot.sleep(bedBlock);
          console.log(`[Sleep] Durmiendo.`);
        } catch (err) {
          console.log(`[Sleep] No se pudo dormir: ${err.message}`);
          bot.isGoingToSleep = false;
        }
      });
    }
  });

  bot.on('wake', () => {
    console.log(`[Sleep] Despertado.`);
    bot.isGoingToSleep = false;
  });

  bot.on('end', (reason) => {
    if (bot.autoEatInterval) {
      clearInterval(bot.autoEatInterval);
      bot.autoEatInterval = null;
    }
    console.log(`[System] Conexión finalizada (${reason}).`);
    
    // Clean up viewer to release the port
    if (bot.viewer && typeof bot.viewer.close === 'function') {
      try {
        console.log(`[System] Cerrando Prismarine Viewer para liberar el puerto...`);
        bot.viewer.close();
      } catch (viewerErr) {
        console.error('[System] Error al cerrar Prismarine Viewer:', viewerErr.message);
      }
    }

    if (botModule && typeof botModule.onEnd === 'function') {
      botModule.onEnd();
    }
    if (preventReconnect) {
      console.log('[System] Reconexión automática desactivada debido a protección de muerte rápida.');
      process.exit(1);
    } else {
      console.log('Reintentando en 15 segundos...');
      setTimeout(createBot, 15000);
    }
  });
}

createBot();

const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});
rl.on('line', (line) => {
  console.log(`[Console Input] Ejecutando: ${line}`);
  handleCommonCommand(line, false);
});
