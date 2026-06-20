const { Movements, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');

let context = {};
let bot = null;
let isWorking = false;
let shouldFence = false;
let loopTimeout = null;

const blacklistedPositions = new Map();

function init(ctx) {
  context = ctx;
  bot = ctx.bot;
  loadBotConfig();
}

function onSpawn() {
  startFencerLoop();
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
    shouldFence
  });
}

function loadBotConfig() {
  try {
    shouldFence = false;
    const config = context.getConfig();
    if (config.shouldFence !== undefined) {
      shouldFence = config.shouldFence;
    }
    console.log(`[Fencer] Configuración cargada con éxito.`);
  } catch (err) {
    console.error(`[Fencer] Error al cargar configuración:`, err.message);
  }
}

function countItems(name) {
  return bot.inventory.items()
    .filter(item => item.name === name)
    .reduce((sum, item) => sum + item.count, 0);
}

function configureMovements(movements) {
  movements.canDig = false; // Do not break block structures while moving
  movements.allowSprinting = false;
  movements.allowParkour = false;
  movements.allowDiagonal = false; // Prevent clipping into corners
  movements.scafoldingBlocks = [];
  movements.maxDropDown = 1;
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
    (name.includes('grass') && !name.includes('block')) ||
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

function getBestStandPos(targetPos) {
  const standY = targetPos.y;

  // Horizontal offsets relative to the target fence
  const cardinalOffsets = [
    new Vec3(1, 0, 1), new Vec3(-1, 0, 1), new Vec3(1, 0, -1), new Vec3(-1, 0, -1),
    new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1),
    new Vec3(2, 0, 0), new Vec3(-2, 0, 0), new Vec3(0, 0, 2), new Vec3(0, 0, -2)
  ];

  for (const offset of cardinalOffsets) {
    const standPos = new Vec3(
      Math.floor(targetPos.x) + offset.x,
      standY,
      Math.floor(targetPos.z) + offset.z
    );

    const feetBlock  = bot.blockAt(standPos);
    const headBlock  = bot.blockAt(standPos.offset(0, 1, 0));
    const belowBlock = bot.blockAt(standPos.offset(0, -1, 0)); // Ground block

    // Feet and head spaces should be clear, and the block below must be solid
    if (isReplaceable(feetBlock) && isReplaceable(headBlock) && isSolid(belowBlock)) {
      // Ensure we aren't standing on the target fence itself
      if (standPos.x !== targetPos.x || standPos.z !== targetPos.z) {
        return standPos;
      }
    }
  }

  return null;
}

function findNextTarget() {
  const botPos = bot.entity.position;
  const fenceBlockIds = bot.registry.blocksByName['oak_fence'] ? [bot.registry.blocksByName['oak_fence'].id] : [];
  if (fenceBlockIds.length === 0) {
    console.log('[Fencer] Error: No se encontró la ID de oak_fence en la base de datos del registro.');
    return null;
  }

  const positions = bot.findBlocks({
    matching: fenceBlockIds,
    maxDistance: 32,
    count: 200
  });

  let closestPos = null;
  let minDistance = Infinity;

  for (const pos of positions) {
    const key = `${pos.x},${pos.y},${pos.z}`;
    if (blacklistedPositions.has(key)) continue;

    // Check if the block directly below the fence is grass
    const belowBlock = bot.blockAt(pos.offset(0, -1, 0));
    if (belowBlock && (belowBlock.name === 'grass_block' || belowBlock.name === 'grass')) {
      const dist = botPos.distanceTo(pos);
      if (dist < minDistance) {
        minDistance = dist;
        closestPos = pos;
      }
    }
  }

  if (!closestPos && blacklistedPositions.size > 0) {
    console.log('[Fencer] No quedan objetivos disponibles. Reiniciando lista negra...');
    blacklistedPositions.clear();
    return findNextTarget();
  }

  return closestPos;
}

async function startFencerLoop() {
  if (isWorking) return;
  isWorking = true;

  let foundWork = false;
  try {
    foundWork = await fencerCycle();
  } catch (err) {
    console.error('[Fencer Loop Error]', err);
  } finally {
    isWorking = false;
    let delay = foundWork ? 100 : 3000;
    if (bot && bot.isSleeping) {
      delay = 5000;
    }
    if (shouldFence) {
      loopTimeout = setTimeout(startFencerLoop, delay);
    }
  }
}

async function clearBlockIfNecessary(pos) {
  const block = bot.blockAt(pos);
  if (block && block.name !== 'air' && block.name !== 'cave_air' && block.name !== 'void_air') {
    console.log(`[Fencer] Despejando bloque obstructivo ${block.name} en ${pos}`);
    try {
      await bot.dig(block);
      await new Promise(r => setTimeout(r, 200));
    } catch (e) {
      console.log(`[Fencer] No se pudo despejar bloque en ${pos}: ${e.message}`);
    }
  }
}

async function fencerCycle() {
  if (!shouldFence) return false;

  if (bot.isSleeping || bot.isGoingToSleep || bot.isYielding) {
    return true;
  }

  // 1. Verificación de Materiales
  const bricksCount = countItems('deepslate_bricks');

  if (bricksCount < 2) {
    sendOwnerMsg('¡Sin deepslate_bricks suficientes! Necesito al menos 2 deepslate_bricks. Deteniendo.', true);
    shouldFence = false;
    saveBotConfig();
    return false;
  }

  // 2. Buscar Siguiente Objetivo
  const targetPos = findNextTarget();
  if (!targetPos) {
    sendOwnerMsg('No encuentro más oak_fence sobre grass en un radio de 32 bloques. ¡Trabajo terminado o pausado!', true);
    shouldFence = false;
    saveBotConfig();
    return false;
  }

  const key = `${targetPos.x},${targetPos.y},${targetPos.z}`;

  // 3. Navegar directamente hacia la cerca (rango 2.0 para estar a distancia segura de interacción y evitar colisiones)
  console.log(`[Fencer] Navegando cerca de ${targetPos} para procesar cerca`);
  const reached = await context.goToBase(targetPos, 2.0, 10000, configureMovements);
  if (!reached) {
    console.log(`[Fencer] No se pudo llegar cerca de ${targetPos}. Colocando en lista negra.`);
    blacklistedPositions.set(key, Date.now());
    return true;
  }

  // 5. Romper la cerca existente
  try {
    const fenceBlock = bot.blockAt(targetPos);
    if (!fenceBlock || fenceBlock.name !== 'oak_fence') {
      console.log(`[Fencer] El bloque en ${targetPos} no es oak_fence (encontrado: ${fenceBlock ? fenceBlock.name : 'null'}).`);
      return true;
    }

    // Equipar hacha si tiene
    const axe = bot.inventory.items().find(item => item.name.includes('axe') && !item.name.includes('pickaxe'));
    if (axe) {
      await bot.equip(axe, 'hand');
    }

    bot.pathfinder.setGoal(null);
    await bot.lookAt(targetPos.offset(0.5, 0.5, 0.5));
    console.log(`[Fencer] Rompiendo cerca en ${targetPos}`);
    await bot.dig(fenceBlock);
    
    // Esperar a que se recoja la cerca
    await new Promise(r => setTimeout(r, 500));
  } catch (err) {
    console.log(`[Fencer] Error al romper cerca en ${targetPos}: ${err.message}`);
    blacklistedPositions.set(key, Date.now());
    return true;
  }

  // 6. Despejar espacio de arriba si es necesario
  await clearBlockIfNecessary(targetPos.offset(0, 1, 0));
  await clearBlockIfNecessary(targetPos.offset(0, 2, 0));

  // 7. Equipar y Colocar primer deepslate_bricks
  try {
    const bricksItem = bot.inventory.items().find(item => item.name === 'deepslate_bricks');
    if (!bricksItem) {
      sendOwnerMsg('¡Me quedé sin deepslate_bricks a mitad del proceso!', true);
      return false;
    }
    await bot.equip(bricksItem, 'hand');

    const ref1 = bot.blockAt(targetPos.offset(0, -1, 0)); // Bloque de pasto debajo
    if (!ref1 || isReplaceable(ref1)) {
      throw new Error('El bloque de referencia inferior no es sólido');
    }
    await bot.lookAt(ref1.position.offset(0.5, 1.0, 0.5));
    console.log(`[Fencer] Colocando primera deepslate_bricks en ${targetPos}`);
    await bot.placeBlock(ref1, new Vec3(0, 1, 0));
    await new Promise(r => setTimeout(r, 250));
  } catch (err) {
    console.log(`[Fencer] Error colocando primera tile en ${targetPos}: ${err.message}`);
    blacklistedPositions.set(key, Date.now());
    return true;
  }

  // 8. Colocar segundo deepslate_bricks
  try {
    const bricksItem = bot.inventory.items().find(item => item.name === 'deepslate_bricks');
    if (!bricksItem) {
      sendOwnerMsg('¡Me quedé sin deepslate_bricks para la segunda capa!', true);
      return false;
    }
    await bot.equip(bricksItem, 'hand');

    const ref2 = bot.blockAt(targetPos); // Bloque que acabamos de colocar
    if (!ref2 || isReplaceable(ref2)) {
      throw new Error('El bloque de referencia medio no es sólido');
    }
    await bot.lookAt(ref2.position.offset(0.5, 1.0, 0.5));
    console.log(`[Fencer] Colocando segunda deepslate_bricks en ${targetPos.offset(0, 1, 0)}`);
    await bot.placeBlock(ref2, new Vec3(0, 1, 0));
    await new Promise(r => setTimeout(r, 250));
  } catch (err) {
    console.log(`[Fencer] Error colocando segunda tile en ${targetPos}: ${err.message}`);
    blacklistedPositions.set(key, Date.now());
    return true;
  }

  // 9. Equipar y Colocar oak_fence encima
  try {
    const fenceItem = bot.inventory.items().find(item => item.name === 'oak_fence');
    if (!fenceItem) {
      console.log('[Fencer] Sin oak_fence en inventario para poner encima. Esperando por si lo recogí.');
      await new Promise(r => setTimeout(r, 500));
    }
    const fenceToEquip = bot.inventory.items().find(item => item.name === 'oak_fence');
    if (!fenceToEquip) {
      sendOwnerMsg('No tengo oak_fence para completar la parte superior. Deteniendo.', true);
      shouldFence = false;
      saveBotConfig();
      return false;
    }
    await bot.equip(fenceToEquip, 'hand');

    const ref3 = bot.blockAt(targetPos.offset(0, 1, 0)); // Segunda tile que colocamos
    if (!ref3 || isReplaceable(ref3)) {
      throw new Error('El bloque de referencia superior no es sólido');
    }
    await bot.lookAt(ref3.position.offset(0.5, 1.0, 0.5));
    console.log(`[Fencer] Colocando oak_fence en ${targetPos.offset(0, 2, 0)}`);
    await bot.placeBlock(ref3, new Vec3(0, 1, 0));
    await new Promise(r => setTimeout(r, 250));
  } catch (err) {
    console.log(`[Fencer] Error colocando oak_fence en ${targetPos}: ${err.message}`);
    blacklistedPositions.set(key, Date.now());
    return true;
  }

  return true;
}

function onChat(message, isWhisper = false) {
  let msg = message.toLowerCase().trim();
  const myName = bot.username.toLowerCase();

  const words = msg.split(/\s+/);
  if (words.length > 1) {
    const firstWord = words[0];
    if (firstWord === myName || firstWord === 'cercadores' || firstWord === 'fencers') {
      msg = words.slice(1).join(' ');
    }
  }

  if (msg === 'trabaja' || msg === 'cerca') {
    shouldFence = true;
    saveBotConfig();
    sendOwnerMsg('Iniciando modo de sustitución de cercos.', true);
    startFencerLoop();
  } else if (msg === 'para' || msg === 'detener') {
    shouldFence = false;
    saveBotConfig();
    if (loopTimeout) clearTimeout(loopTimeout);
    bot.pathfinder.setGoal(null);
    sendOwnerMsg('Modo cercador detenido.', true);
  } else if (msg === 'status' || msg === 'info') {
    const bricksCount = countItems('deepslate_bricks');
    const fenceCount = countItems('oak_fence');
    sendOwnerMsg(`[Status] Reemplazo de cercos automático: ${shouldFence ? 'ACTIVO' : 'INACTIVO'}.`, true);
    sendOwnerMsg(`[Inventario] Deepslate Bricks: ${bricksCount} | Oak Fences: ${fenceCount}`, true);
  }
}

module.exports = {
  init,
  onSpawn,
  onChat,
  onDeath,
  onEnd,
  loadBotConfig
};
