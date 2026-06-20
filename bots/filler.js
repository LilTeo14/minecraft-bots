const { Movements, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');

let context = {};
let bot = null;
let isWorking = false;
let shouldFill = false;
let loopTimeout = null;

let fillConfig = {
  x1: -727,
  z1: 683,
  x2: -780,
  z2: 618,
  y: 102
};

const blacklistedPositions = new Map();

function init(ctx) {
  context = ctx;
  bot = ctx.bot;
  loadBotConfig();
}

function onSpawn() {
  startFillerLoop();
}

function onDeath() {
  isWorking = false;
  if (loopTimeout) clearTimeout(loopTimeout);
}

function onEnd() {
  isWorking = false;
  if (loopTimeout) clearTimeout(loopTimeout);
}

function sendOwnerMsg(msg, force = false) {
  context.sendOwnerMsg(msg, force);
}

function saveBotConfig() {
  context.saveConfig({
    shouldFill,
    fillConfig: {
      x1: fillConfig.x1,
      z1: fillConfig.z1,
      x2: fillConfig.x2,
      z2: fillConfig.z2,
      y: fillConfig.y
    }
  });
}

function loadBotConfig() {
  try {
    shouldFill = false;
    const config = context.getConfig();
    if (config.shouldFill !== undefined) {
      shouldFill = config.shouldFill;
    }
    if (config.fillConfig) {
      fillConfig = {
        x1: config.fillConfig.x1,
        z1: config.fillConfig.z1,
        x2: config.fillConfig.x2,
        z2: config.fillConfig.z2,
        y: config.fillConfig.y
      };
    }
    console.log(`[Filler] Configuración cargada con éxito.`);
  } catch (err) {
    console.error(`[Filler] Error al cargar configuración:`, err.message);
  }
}

function countItems(name) {
  return bot.inventory.items()
    .filter(item => item.name === name)
    .reduce((sum, item) => sum + item.count, 0);
}

function configureMovements(movements) {
  movements.canDig = false; // Safe movement: do not break block structures
  movements.allowSprinting = false;
  movements.allowParkour = false;
  movements.scafoldingBlocks = [];
  movements.maxDropDown = 1; // Never fall off an edge — only step down 1 block max
  movements.liquidCost = 10;
}

function isReplaceable(block) {
  if (!block) return true;
  const name = block.name.toLowerCase();
  return (
    name === 'air' ||
    name === 'cave_air' ||
    name === 'void_air' ||
    name.includes('water') ||
    name.includes('lava') ||
    name.includes('grass') ||
    name.includes('flower') ||
    name.includes('fern') ||
    name.includes('bush') ||
    name.includes('plant') ||
    name === 'dead_bush' ||
    name === 'snow'
  );
}

function isSolid(block) {
  return block && !isReplaceable(block);
}

function getPlacementRef(pos) {
  // Check directly below target block (Y - 1)
  const belowPos = pos.offset(0, -1, 0);
  const belowBlock = bot.blockAt(belowPos);
  if (isSolid(belowBlock)) {
    return { ref: belowBlock, face: new Vec3(0, 1, 0) };
  }

  // Check 4 horizontal sides around target block
  const sides = [
    { dir: new Vec3(-1, 0, 0), face: new Vec3(1, 0, 0) },
    { dir: new Vec3(1, 0, 0), face: new Vec3(-1, 0, 0) },
    { dir: new Vec3(0, 0, -1), face: new Vec3(0, 0, 1) },
    { dir: new Vec3(0, 0, 1), face: new Vec3(0, 0, -1) }
  ];

  for (const side of sides) {
    const sideBlock = bot.blockAt(pos.plus(side.dir));
    if (isSolid(sideBlock)) {
      return { ref: sideBlock, face: side.face };
    }
  }

  return null;
}

function getBestStandPos(targetPos) {
  // The bot's feet must be at fillConfig.y + 1 (standing ON TOP of the platform).
  // The block directly below the stand position (at fillConfig.y) MUST be solid
  // (already filled or existing terrain). This ensures the bot never tries to
  // stand over a gap and falls.
  const standY = fillConfig.y + 1;

  const cardinalOffsets = [
    new Vec3(1, 0, 0), new Vec3(-1, 0, 0),
    new Vec3(0, 0, 1), new Vec3(0, 0, -1)
  ];

  for (const offset of cardinalOffsets) {
    const standPos = new Vec3(
      Math.floor(targetPos.x) + offset.x,
      standY,
      Math.floor(targetPos.z) + offset.z
    );

    const feetBlock  = bot.blockAt(standPos);
    const headBlock  = bot.blockAt(standPos.offset(0, 1, 0));
    const belowBlock = bot.blockAt(standPos.offset(0, -1, 0)); // at fillConfig.y

    // Feet and head must be clear, ground below MUST be solid (no gaps)
    if (isReplaceable(feetBlock) && isReplaceable(headBlock) && isSolid(belowBlock)) {
      return standPos;
    }
  }

  return null;
}

function scanArea() {
  const minX = Math.min(fillConfig.x1, fillConfig.x2);
  const maxX = Math.max(fillConfig.x1, fillConfig.x2);
  const minZ = Math.min(fillConfig.z1, fillConfig.z2);
  const maxZ = Math.max(fillConfig.z1, fillConfig.z2);
  const Y = fillConfig.y;

  let totalBlocks = 0;
  let filledBlocks = 0;
  let emptyBlocks = 0;

  for (let x = minX; x <= maxX; x++) {
    for (let z = minZ; z <= maxZ; z++) {
      totalBlocks++;
      const pos = new Vec3(x, Y, z);
      const block = bot.blockAt(pos);
      if (isSolid(block)) {
        filledBlocks++;
      } else {
        emptyBlocks++;
      }
    }
  }

  return { totalBlocks, filledBlocks, emptyBlocks };
}

function findNextTargetBlock() {
  const botPos = bot.entity.position;
  let closestPos = null;
  let minDistance = Infinity;

  const minX = Math.min(fillConfig.x1, fillConfig.x2);
  const maxX = Math.max(fillConfig.x1, fillConfig.x2);
  const minZ = Math.min(fillConfig.z1, fillConfig.z2);
  const maxZ = Math.max(fillConfig.z1, fillConfig.z2);
  const Y = fillConfig.y;

  for (let x = minX; x <= maxX; x++) {
    for (let z = minZ; z <= maxZ; z++) {
      const pos = new Vec3(x, Y, z);
      const key = `${x},${Y},${z}`;

      if (blacklistedPositions.has(key)) {
        continue;
      }

      const block = bot.blockAt(pos);
      if (isReplaceable(block)) {
        const placement = getPlacementRef(pos);
        if (placement) {
          const dist = botPos.distanceTo(pos);
          if (dist < minDistance) {
            minDistance = dist;
            closestPos = pos;
          }
        }
      }
    }
  }

  // If no block has adjacent solid reference and we have blacklisted elements, retry once
  if (!closestPos && blacklistedPositions.size > 0) {
    console.log('[Filler] No hay bloques disponibles, reiniciando lista negra...');
    blacklistedPositions.clear();
    return findNextTargetBlock();
  }

  return closestPos;
}

async function startFillerLoop() {
  if (isWorking) return;
  isWorking = true;

  let foundWork = false;
  try {
    foundWork = await fillerCycle();
  } catch (err) {
    console.error('[Filler Loop Error]', err);
  } finally {
    isWorking = false;
    let delay = foundWork ? 100 : 3000;
    if (bot && bot.isSleeping) {
      delay = 5000;
    }
    if (shouldFill) {
      loopTimeout = setTimeout(startFillerLoop, delay);
    }
  }
}

async function fillerCycle() {
  if (!shouldFill) return false;

  if (bot.isSleeping || bot.isGoingToSleep || bot.isYielding) {
    return true;
  }

  // Safety: detect if bot fell below the platform level
  const botY = bot.entity.position.y;
  if (botY < fillConfig.y - 1) {
    sendOwnerMsg(`¡Me caí! Estoy en Y=${Math.floor(botY)}, debería estar en Y=${fillConfig.y + 1}. Deteniendo relleno. Usa /back para regresar o mándame tpa.`, true);
    shouldFill = false;
    saveBotConfig();
    return false;
  }

  // 1. Seleccionar bloque a colocar: tierra primero, luego tablas de roble
  const fillItem = bot.inventory.items().find(item => item.name === 'dirt') ||
                   bot.inventory.items().find(item => item.name === 'oak_planks');
  if (!fillItem) {
    sendOwnerMsg('¡Sin materiales! No tengo tierra (dirt) ni tablas de roble (oak_planks). Dame alguno para continuar.', true);
    shouldFill = false;
    saveBotConfig();
    return false;
  }

  // 2. Find next block
  const targetPos = findNextTargetBlock();
  if (!targetPos) {
    const stats = scanArea();
    if (stats.emptyBlocks === 0) {
      sendOwnerMsg(`¡Trabajo terminado! Toda la superficie (${stats.totalBlocks} bloques) ha sido rellenada con tierra.`, true);
    } else {
      sendOwnerMsg(`No encuentro más bloques viables para rellenar (faltan ${stats.emptyBlocks} bloques inaccesibles).`, true);
    }
    shouldFill = false;
    saveBotConfig();
    return false;
  }

  const key = `${targetPos.x},${targetPos.y},${targetPos.z}`;

  // 3. Find block placement details
  const placement = getPlacementRef(targetPos);
  if (!placement) {
    blacklistedPositions.set(key, Date.now());
    return true;
  }

  // 4. Find where bot can stand
  const standPos = getBestStandPos(targetPos);
  if (!standPos) {
    console.log(`[Filler] No hay posición segura para colocar en ${targetPos}. Blacklisting.`);
    blacklistedPositions.set(key, Date.now());
    return true;
  }

  // 5. Navigate to standing position
  console.log(`[Filler] Navegando a ${standPos} para rellenar ${targetPos}`);
  const reached = await context.goToBase(standPos, 0.5, 8000, configureMovements);
  if (!reached) {
    console.log(`[Filler] No pude llegar a ${standPos}. Blacklisting ${targetPos}.`);
    blacklistedPositions.set(key, Date.now());
    return true;
  }

  // 7. Equip fill block (dirt preferred, oak_planks as fallback)
  const itemToPlace = bot.inventory.items().find(item => item.name === 'dirt') ||
                      bot.inventory.items().find(item => item.name === 'oak_planks');
  if (!itemToPlace) return true;

  try {
    await bot.equip(itemToPlace, 'hand');
  } catch (err) {
    console.log(`[Filler] Error al equipar: ${err.message}`);
    return true;
  }

  // 8. Place block
  try {
    bot.pathfinder.setGoal(null);
    const refBlock = placement.ref;
    const face = placement.face;

    const lookTarget = refBlock.position.offset(0.5, 0.5, 0.5).plus(face.scaled(0.5));
    await bot.lookAt(lookTarget);

    console.log(`[Filler] Colocando ${itemToPlace.name} en ${targetPos}`);
    await bot.placeBlock(refBlock, face);
    await new Promise(r => setTimeout(r, 150));
    return true;
  } catch (err) {
    console.log(`[Filler] Error al colocar bloque en ${targetPos}: ${err.message}`);
    const currentFails = (blacklistedPositions.get(key) || 0) + 1;
    if (currentFails >= 3) {
      blacklistedPositions.set(key, Date.now());
    } else {
      blacklistedPositions.set(key, currentFails);
    }
    return true;
  }
}

function onChat(message, isWhisper = false) {
  let msg = message.toLowerCase().trim();
  const myName = bot.username.toLowerCase();

  const words = msg.split(/\s+/);
  if (words.length > 1) {
    const firstWord = words[0];
    if (firstWord === myName || firstWord === 'rellenadores' || firstWord === 'fillers') {
      msg = words.slice(1).join(' ');
    }
  }

  if (msg === 'trabaja' || msg === 'rellena') {
    shouldFill = true;
    saveBotConfig();
    sendOwnerMsg('Iniciando modo relleno automático de superficie.', true);
    startFillerLoop();
  } else if (msg === 'para' || msg === 'detener') {
    shouldFill = false;
    saveBotConfig();
    if (loopTimeout) clearTimeout(loopTimeout);
    bot.pathfinder.setGoal(null);
    sendOwnerMsg('Modo relleno detenido.', true);
  } else if (msg === 'status' || msg === 'info') {
    const stats = scanArea();
    const pct = ((stats.filledBlocks / stats.totalBlocks) * 100).toFixed(1);
    const dirtCount = countItems('dirt');
    const planksCount = countItems('oak_planks');
    sendOwnerMsg(`[Estado] Área: (${fillConfig.x1}, ${fillConfig.y}, ${fillConfig.z1}) a (${fillConfig.x2}, ${fillConfig.y}, ${fillConfig.z2})`, true);
    sendOwnerMsg(`[Progreso] Rellenados: ${stats.filledBlocks}/${stats.totalBlocks} bloques (${pct}%). Restan: ${stats.emptyBlocks}`, true);
    sendOwnerMsg(`[Inventario] Tierra: ${dirtCount} | Tablas de roble: ${planksCount}`, true);
    sendOwnerMsg(`[Status] Relleno automático: ${shouldFill ? 'ACTIVO' : 'INACTIVO'}.`, true);
  } else if (msg.startsWith('limites ')) {
    const parts = msg.split(/\s+/);
    if (parts.length === 6) {
      const x1 = Math.floor(parseFloat(parts[1]));
      const z1 = Math.floor(parseFloat(parts[2]));
      const x2 = Math.floor(parseFloat(parts[3]));
      const z2 = Math.floor(parseFloat(parts[4]));
      const y = Math.floor(parseFloat(parts[5]));

      if (!isNaN(x1) && !isNaN(z1) && !isNaN(x2) && !isNaN(z2) && !isNaN(y)) {
        fillConfig = { x1, z1, x2, z2, y };
        saveBotConfig();
        blacklistedPositions.clear();
        sendOwnerMsg(`Límites configurados con éxito: (${x1}, ${y}, ${z1}) a (${x2}, ${y}, ${z2})`, true);
      } else {
        sendOwnerMsg('Coordenadas inválidas. Usa: limites <x1> <z1> <x2> <z2> <y>', true);
      }
    } else {
      sendOwnerMsg('Formato incorrecto. Usa: limites <x1> <z1> <x2> <z2> <y>', true);
    }
  }
}

module.exports = {
  init,
  onSpawn,
  onChat,
  onDeath,
  onEnd
};
