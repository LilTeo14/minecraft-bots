const { Movements, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');

let context = {};
let bot = null;
let isWorking = false;
let isDepositing = false;
let shouldChop = false;
let woodChestPosition = null;
let bedPosition = null;
const ignoredLogs = new Set();
let loopTimeout = null;
let chestErrorCooldown = 0;

// Límites del área de tala (Granja de árboles)
const FARM_LIMITS = {
  minX: -586,
  maxX: -531,
  minZ: 699,
  maxZ: 742
};

function getWaitingPosition() {
  const x = -558;
  const z = 720;
  if (!bot) return new Vec3(x, 120, z);
  for (let y = 140; y >= 60; y--) {
    const block = bot.blockAt(new Vec3(x, y, z));
    if (block && block.name !== 'air' && block.name !== 'cave_air' && !block.name.includes('leaves')) {
      return new Vec3(x, y + 1, z);
    }
  }
  return new Vec3(x, 120, z);
}

function init(ctx) {
  context = ctx;
  bot = ctx.bot;
  loadBotConfig();
}

function onSpawn() {
  startLumberjackLoop();
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
    shouldChop,
    woodChestPosition: woodChestPosition ? { x: woodChestPosition.x, y: woodChestPosition.y, z: woodChestPosition.z } : null,
    bedPosition: bedPosition ? { x: bedPosition.x, y: bedPosition.y, z: bedPosition.z } : null
  });
}

function loadBotConfig() {
  try {
    shouldChop = false;
    const config = context.getConfig();
    if (config.shouldChop !== undefined) {
      shouldChop = config.shouldChop;
    }
    if (config.woodChestPosition) {
      woodChestPosition = new Vec3(config.woodChestPosition.x, config.woodChestPosition.y, config.woodChestPosition.z);
    }
    if (config.bedPosition) {
      bedPosition = new Vec3(config.bedPosition.x, config.bedPosition.y, config.bedPosition.z);
    }
    console.log('[Lumberjack] Configuración cargada con éxito.');
  } catch (err) {
    console.error('[Lumberjack] Error al cargar configuración:', err.message);
  }
}

function countWood() {
  let count = 0;
  for (const item of bot.inventory.items()) {
    if (isLogBlock(item)) {
      count += item.count;
    }
  }
  return count;
}

async function depositToChest() {
  if (!woodChestPosition) return;

  let targetChestPosition = woodChestPosition;

  const initialBlock = bot.blockAt(targetChestPosition);
  if (!initialBlock || !initialBlock.name.includes('chest')) {
    const nearbyChest = bot.findBlock({
      matching: (block) => block.name.includes('chest'),
      point: targetChestPosition,
      maxDistance: 2
    });
    if (nearbyChest) {
      console.log(`[Chest] Corrigiendo posición del cofre a ${nearbyChest.position}`);
      woodChestPosition = nearbyChest.position;
      targetChestPosition = nearbyChest.position;
      saveBotConfig();
    }
  }

  sendOwnerMsg(`[Chest] Yendo al cofre en ${targetChestPosition} para guardar madera y manzanas...`);

  bot.pathfinder.setGoal(null);
  bot.stopDigging();

  const reached = await context.goToBase(targetChestPosition, 2, 15000, configureMovements);
  if (!reached) {
    sendOwnerMsg(`[Chest] No pude llegar al cofre en ${targetChestPosition}`);
    return;
  }

  // Short delay to ensure bot is fully stopped before opening the chest
  await new Promise(r => setTimeout(r, 500));

  const chestBlock = bot.blockAt(targetChestPosition);
  if (!chestBlock || !chestBlock.name.includes('chest')) {
    sendOwnerMsg(`[Chest] El bloque en ${targetChestPosition} no es un cofre o no está cargado.`);
    return;
  }

  const blockAbove = bot.blockAt(targetChestPosition.offset(0, 1, 0));
  if (blockAbove && blockAbove.boundingBox !== 'empty' && blockAbove.name !== 'air' && blockAbove.name !== 'cave_air') {
    sendOwnerMsg(`[Chest] ¡ADVERTENCIA! El cofre en ${targetChestPosition} está obstruido por "${blockAbove.name}" en la posición superior ${targetChestPosition.offset(0, 1, 0)}. Por favor, quita el bloque para que el bot pueda abrirlo.`, true);
  }

  try {
    const chest = await bot.openChest(chestBlock);
    const items = bot.inventory.items();
    let depositedAny = false;

    const saplingCounts = {};
    for (const item of items) {
      if (isSaplingItem(item)) {
        if (!saplingCounts[item.name]) {
          saplingCounts[item.name] = 0;
        }
        saplingCounts[item.name] += item.count;
      }
    }

    let depositTarget = null;
    do {
      const currentItems = bot.inventory.items();
      depositTarget = null;

      const currentSaplingCounts = {};
      for (const item of currentItems) {
        if (isSaplingItem(item)) {
          currentSaplingCounts[item.name] = (currentSaplingCounts[item.name] || 0) + item.count;
        }
      }

      for (const item of currentItems) {
        if (item.name.includes('axe')) {
          if (isAxeLowDurability(item)) {
            depositTarget = { type: item.type, name: item.name, count: item.count, reason: 'hacha con baja durabilidad' };
            break;
          }
          continue;
        }

        if (isSaplingItem(item)) {
          const totalCount = currentSaplingCounts[item.name] || 0;
          if (totalCount > 10) {
            const excess = totalCount - 10;
            const amountToDeposit = Math.min(item.count, excess);
            if (amountToDeposit > 0) {
              depositTarget = { type: item.type, name: item.name, count: amountToDeposit, reason: 'exceso de saplings' };
              break;
            }
          }
        } else {
          depositTarget = { type: item.type, name: item.name, count: item.count };
          break;
        }
      }

      if (depositTarget) {
        try {
          if (depositTarget.reason) {
            console.log(`[Chest] Depositando ${depositTarget.count} de ${depositTarget.name} (${depositTarget.reason})...`);
          } else {
            console.log(`[Chest] Depositando ${depositTarget.count} de ${depositTarget.name}...`);
          }
          await chest.deposit(depositTarget.type, null, depositTarget.count);
          depositedAny = true;
          await new Promise(r => setTimeout(r, 200));
        } catch (err) {
          console.log(`[Chest] Error al depositar ${depositTarget.name}: ${err.message}`);
          break; // Stop loop on failure to prevent infinite loop
        }
      }
    } while (depositTarget);

    // Recalcular saplings en el inventario tras los depósitos
    const currentItems = bot.inventory.items();
    const currentSaplingCounts = {};
    for (const item of currentItems) {
      if (isSaplingItem(item)) {
        currentSaplingCounts[item.name] = (currentSaplingCounts[item.name] || 0) + item.count;
      }
    }

    // Escanear el cofre y retirar saplings si tenemos menos de 10
    const chestItems = chest.containerItems();
    let withdrewAny = false;
    for (const item of chestItems) {
      if (isSaplingItem(item)) {
        const name = item.name;
        const currentCount = currentSaplingCounts[name] || 0;
        if (currentCount < 10) {
          const needed = 10 - currentCount;
          const toWithdraw = Math.min(item.count, needed);
          if (toWithdraw > 0) {
            try {
              console.log(`[Chest] Retirando ${toWithdraw} de ${name} (completar 10)...`);
              await chest.withdraw(item.type, null, toWithdraw);
              currentSaplingCounts[name] = currentCount + toWithdraw;
              withdrewAny = true;
              await new Promise(r => setTimeout(r, 200));
            } catch (err) {
              console.log(`[Chest] Error al retirar ${name}: ${err.message}`);
            }
          }
        }
      }
    }

    chest.close();
    if (depositedAny || withdrewAny) {
      sendOwnerMsg('[Chest] ¡Operación en cofre completada! (Se guardó exceso y se aseguraron 10 saplings de cada tipo para replantar)');
    } else {
      sendOwnerMsg('[Chest] No fue necesario depositar ni retirar objetos.');
    }
  } catch (err) {
    sendOwnerMsg(`[Chest] Error al abrir/interactuar con el cofre: ${err.message}`);
    chestErrorCooldown = Date.now() + 60000;
    sendOwnerMsg('[Chest] Se pausarán los intentos de depósito en cofre por 60 segundos.');
  }
}


async function interactWithBed(bedPos) {
  let targetPos = bedPos;
  const initialBlock = bot.blockAt(bedPos);
  if (!initialBlock || !initialBlock.name.includes('bed')) {
    const nearbyBed = bot.findBlock({
      matching: (block) => block.name.includes('bed'),
      point: bedPos,
      maxDistance: 2
    });
    if (nearbyBed) {
      targetPos = nearbyBed.position;
      console.log(`[Bed] Cama detectada en posición cercana: ${targetPos}`);
    }
  }

  sendOwnerMsg(`[Bed] Yendo a la cama en ${targetPos}...`);

  bot.pathfinder.setGoal(null);
  bot.stopDigging();

  const reached = await context.goToBase(targetPos, 2, 15000, configureMovements);
  if (!reached) {
    sendOwnerMsg(`[Bed] No pude llegar a la cama en ${targetPos}`);
    return;
  }

  const bedBlock = bot.blockAt(targetPos);
  if (!bedBlock || !bedBlock.name.includes('bed')) {
    sendOwnerMsg(`[Bed] El bloque en ${targetPos} no parece ser una cama.`);
    return;
  }

  try {
    await bot.lookAt(targetPos.offset(0.5, 0.5, 0.5));
    await bot.activateBlock(bedBlock);
    sendOwnerMsg('[Bed] Clic derecho en la cama realizado. Debería haber guardado el respawn.');
  } catch (err) {
    sendOwnerMsg(`[Bed] Error al interactuar con la cama: ${err.message}`);
  }
}

async function clearObstructingBlock(targetBlock) {
  if (!bot || !bot.entity) return false;

  const headPos = bot.entity.position.offset(0, bot.entity.eyeHeight, 0);
  const targetCenter = targetBlock.position.offset(0.5, 0.5, 0.5);
  const dir = targetCenter.minus(headPos);
  const range = headPos.distanceTo(targetCenter);

  const match = (block) => {
    return block.shapes && block.shapes.length > 0;
  };

  const blockAtCursor = bot.world.raycast(headPos, dir.normalize(), range, match);
  if (blockAtCursor && !blockAtCursor.position.equals(targetBlock.position)) {
    const name = blockAtCursor.name;
    const isObstructor = name.includes('leaves') ||
      name.includes('grass') ||
      name.includes('vine') ||
      name.includes('fern') ||
      name.includes('bush') ||
      name.includes('sapling');

    if (isObstructor) {
      console.log(`[Chopper] Vista obstruida por ${name} en ${blockAtCursor.position}. Limpiando...`);
      await digBlock(blockAtCursor);
      return true;
    }
  }
  return false;
}


function configureMovements(movements) {
  movements.canDig = true; // Allow digging leaves/grass to pass through
  movements.allowSprinting = false;
  movements.allowParkour = true;
  movements.scafoldingBlocks = [];
  movements.liquidCost = 10;

  movements.getMoveDiagonal = function (node, dir, neighbors) {};

  const originalGetBlock = movements.getBlock;
  movements.getBlock = function (pos, dx, dy, dz) {
    const block = originalGetBlock.call(movements, pos, dx, dy, dz);
    if (block && block.name && block.name.includes('leaves')) {
      block.physical = true;
      block.safe = false;
    }
    return block;
  };

  bot.registry.blocksArray.forEach(block => {
    const name = block.name;

    const isForbidden = name.includes('grass_block') ||
      name.includes('dirt') ||
      name.includes('podzol') ||
      name.includes('mycelium') ||
      name.includes('farmland') ||
      name.includes('path') ||
      name.includes('clay') ||
      name.includes('mud');

    const allowed = !isForbidden && (
      name.includes('leaves') ||
      name.includes('log') ||
      name.includes('stem') ||
      name.includes('wood') ||
      name.includes('vine') ||
      name.includes('bamboo') ||
      name.includes('sugar_cane') ||
      block.boundingBox === 'empty'
    );

    if (!allowed) {
      movements.blocksCantBreak.add(block.id);
    }
  });
}

function isLogBlock(block) {
  if (!block) return false;
  const name = block.name;
  return name.endsWith('_log') || name.endsWith('_stem') || name.endsWith('_wood');
}

function isValidSoil(block) {
  if (!block) return false;
  const name = block.name;
  return name === 'grass_block' ||
    name === 'dirt' ||
    name === 'coarse_dirt' ||
    name === 'podzol' ||
    name === 'moss_block' ||
    name === 'mud' ||
    name === 'rooted_dirt';
}

function isSaplingItem(item) {
  if (!item) return false;
  const name = item.name;
  return name.endsWith('_sapling') || name === 'mangrove_propagule' || name === 'azalea' || name === 'flowering_azalea';
}

function isAxeLowDurability(item) {
  if (!item || !item.name.includes('axe')) return false;
  if (item.maxDurability === undefined || item.maxDurability === null) return false;
  const remaining = item.maxDurability - (item.durabilityUsed || 0);
  return remaining <= 10;
}

async function startLumberjackLoop() {
  if (isWorking) return;
  isWorking = true;

  try {
    await lumberjackCycle();
  } catch (err) {
    console.error('[Loop Error]', err);
  } finally {
    isWorking = false;
    loopTimeout = setTimeout(startLumberjackLoop, 3000);
  }
}

async function lumberjackCycle() {
  if (!shouldChop) return;
  if (bot.isSleeping || bot.isGoingToSleep || bot.isYielding) return;

  if (woodChestPosition && countWood() >= 32 && Date.now() > chestErrorCooldown) {
    await depositToChest();
    return;
  }

  if (ignoredLogs.size > 1000) {
    ignoredLogs.clear();
  }

  console.log('[Chopper] Buscando árboles...');



  const logBlock = bot.findBlock({
    matching: (block) => {
      if (!isLogBlock(block)) return false;
      if (!block.position) return true; // Permitir que pase el filtro de optimización de paletas de Mineflayer

      const pos = block.position;
      // Verificar si el tronco está dentro del área de la granja configurada (X en [-576, -557] y Z en [645, 677])
      if (pos.x < FARM_LIMITS.minX || pos.x > FARM_LIMITS.maxX ||
          pos.z < FARM_LIMITS.minZ || pos.z > FARM_LIMITS.maxZ) {
        return false;
      }

      const key = `${pos.x},${pos.y},${pos.z}`;
      return !ignoredLogs.has(key);
    },
    maxDistance: 48
  });

  if (!logBlock) {
    console.log('[Chopper] No se encontraron troncos en el área de la granja.');
    if (ignoredLogs.size > 0) {
      console.log(`[Chopper] Limpiando lista de ${ignoredLogs.size} troncos ignorados para volver a intentar...`);
      ignoredLogs.clear();
    }

    // Comprobar si hay árboles fuera de los límites de la granja
    const logOutside = bot.findBlock({
      matching: (block) => isLogBlock(block),
      maxDistance: 48
    });

    if (logOutside) {
      const pos = logOutside.position;
      if (pos.x < FARM_LIMITS.minX || pos.x > FARM_LIMITS.maxX ||
          pos.z < FARM_LIMITS.minZ || pos.z > FARM_LIMITS.maxZ) {
        console.log(`[Chopper] INFO: Se detectaron troncos en ${pos}, pero están fuera de los límites de la granja: X[${FARM_LIMITS.minX}, ${FARM_LIMITS.maxX}] Z[${FARM_LIMITS.minZ}, ${FARM_LIMITS.maxZ}]`);
      }
    }

    // Si está lejos de la granja, camina a la posición de espera para mantener cargada el área
    const currentPos = bot.entity.position;
    const waitingPos = getWaitingPosition();
    if (currentPos && currentPos.distanceTo(waitingPos) > 4) {
      console.log(`[Chopper] Moviéndose a la posición de espera en la granja: ${waitingPos}`);
      bot.pathfinder.setGoal(null);
      await context.goToBase(waitingPos, 2, 10000, configureMovements);
    }

    // Mirar al frente (horizontal) para no quedarse mirando al cielo
    if (bot.entity) {
      bot.look(bot.entity.yaw, 0, true).catch(() => {});
    }
    return;
  }

  sendOwnerMsg(`[Chopper] Tronco detectado en ${logBlock.position}`);

  const treeBlocks = findTreeBlocks(logBlock);
  if (treeBlocks.length === 0) {
    console.log('[Chopper] No se pudieron mapear bloques para el tronco.');
    ignoredLogs.add(`${logBlock.position.x},${logBlock.position.y},${logBlock.position.z}`);
    return;
  }

  sendOwnerMsg(`[Chopper] Estructura identificada. Compuesta por ${treeBlocks.length} bloques.`);

  const lowestLog = treeBlocks[0];
  const soilPos = lowestLog.position.offset(0, -1, 0);

  sendOwnerMsg(`[Chopper] Moviéndose a la base en ${lowestLog.position}`);
  const reachedBase = await context.goToBase(lowestLog.position, 2, 15000, configureMovements);
  if (!reachedBase) {
    if (bot.isGoingToSleep || bot.isSleeping) return;
    console.log(`[Chopper] No se pudo llegar a la base en ${lowestLog.position}. Ignorando bloques.`);
    for (const block of treeBlocks) {
      ignoredLogs.add(`${block.position.x},${block.position.y},${block.position.z}`);
    }
    return;
  }

  for (const block of treeBlocks) {
    if (bot.isGoingToSleep || bot.isSleeping) return;
    const currentBlock = bot.blockAt(block.position);
    if (!currentBlock || !isLogBlock(currentBlock)) continue;

    const targetPos = currentBlock.position.offset(0.5, 0.5, 0.5);
    const dist = bot.entity.position.distanceTo(targetPos);
    if (dist > 4.5) {
      console.log(`[Chopper] El bloque en ${currentBlock.position} está demasiado lejos (${dist.toFixed(1)}m). Moviéndose más cerca...`);
      await context.goToBase(currentBlock.position, 3, 15000, configureMovements);
    }

    while (await clearObstructingBlock(currentBlock)) {
      await new Promise(r => setTimeout(r, 200));
    }

    console.log(`[Chopper] Talando bloque de tronco en ${block.position}`);
    await digBlock(currentBlock);
  }

  if (bot.isGoingToSleep || bot.isSleeping) return;

  await pickupDrops(soilPos);

  if (bot.isGoingToSleep || bot.isSleeping) return;

  const soilBlock = bot.blockAt(soilPos);
  if (soilBlock && isValidSoil(soilBlock)) {
    await replantSapling(soilPos);
  } else {
    console.log(`[Chopper] No se replanta porque el suelo en ${soilPos} no es apto.`);
  }
}

function findTreeBlocks(startLog) {
  const queue = [startLog.position];
  const treeBlocks = [];
  const visited = new Set();
  visited.add(`${startLog.position.x},${startLog.position.y},${startLog.position.z}`);

  while (queue.length > 0) {
    const pos = queue.shift();
    const block = bot.blockAt(pos);
    if (block && isLogBlock(block)) {
      treeBlocks.push(block);

      const neighbors = [];
      for (let xOff = -1; xOff <= 1; xOff++) {
        for (let yOff = -1; yOff <= 1; yOff++) {
          for (let zOff = -1; zOff <= 1; zOff++) {
            if (xOff === 0 && yOff === 0 && zOff === 0) continue;
            neighbors.push(pos.offset(xOff, yOff, zOff));
          }
        }
      }

      for (const neighborPos of neighbors) {
        const dx = Math.abs(neighborPos.x - startLog.position.x);
        const dz = Math.abs(neighborPos.z - startLog.position.z);
        const dy = neighborPos.y - startLog.position.y;

        if (dx <= 8 && dz <= 8 && dy >= -15 && dy <= 40) {
          const key = `${neighborPos.x},${neighborPos.y},${neighborPos.z}`;
          if (!visited.has(key)) {
            visited.add(key);
            const neighborBlock = bot.blockAt(neighborPos);
            if (neighborBlock && isLogBlock(neighborBlock)) {
              queue.push(neighborPos);
            }
          }
        }
      }
    }
  }

  treeBlocks.sort((a, b) => a.position.y - b.position.y);
  return treeBlocks;
}

async function digBlock(block) {
  if (!block || bot.blockAt(block.position).type === 0) return;

  await equipBestAxe();

  try {
    await bot.lookAt(block.position.offset(0.5, 0.5, 0.5));
    await context.digBlockWithTimeout(block, 10000);
    console.log(`[Chopper] Bloque minado con éxito en ${block.position}`);
  } catch (err) {
    console.log(`[Chopper] Error al minar en ${block.position}: ${err.message}`);
  }
}

async function equipBestAxe() {
  const items = bot.inventory.items();
  const AXE_TIERS = {
    'netherite_axe': 6,
    'diamond_axe': 5,
    'golden_axe': 4,
    'iron_axe': 3,
    'stone_axe': 2,
    'wooden_axe': 1
  };

  let bestAxe = null;
  let bestValue = 0;

  for (const item of items) {
    if (AXE_TIERS[item.name] && AXE_TIERS[item.name] > bestValue) {
      if (isAxeLowDurability(item)) {
        continue;
      }
      bestValue = AXE_TIERS[item.name];
      bestAxe = item;
    }
  }

  if (bestAxe) {
    try {
      await bot.equip(bestAxe, 'hand');
      console.log(`[Inventory] Equipando herramienta: ${bestAxe.name}`);
    } catch (err) {
      console.log(`[Inventory] No se pudo equipar hacha: ${err.message}`);
    }
  } else {
    const hasLowDurabilityAxe = items.some(item => item.name.includes('axe'));
    if (hasLowDurabilityAxe) {
      sendOwnerMsg('[Inventory] ¡ADVERTENCIA! Mis hachas tienen baja durabilidad y no las usaré para evitar que se rompan. Por favor, dame un hacha nueva o repara mis hachas.', true);
    }
  }
}

async function pickupDrops(soilPos) {
  console.log('[Chopper] Esperando 1.5s a que caigan los drops...');
  await new Promise(r => setTimeout(r, 1500));

  if (bot.isGoingToSleep || bot.isSleeping) return;

  let search = true;
  while (search) {
    if (bot.isGoingToSleep || bot.isSleeping || isDepositing) break;
    const itemEntity = bot.nearestEntity(entity => {
      if (entity.name !== 'item' && entity.type !== 'object') return false;
      const dist = entity.position.distanceTo(soilPos);
      if (dist > 8) return false;
      const heightDiff = Math.abs(entity.position.y - bot.entity.position.y);
      return heightDiff <= 1.5;
    });

    if (itemEntity) {
      console.log(`[Chopper] Item detectado en ${itemEntity.position}. Recogiéndolo...`);
      bot.pathfinder.setGoal(null);

      try {
        const reached = await context.goToBase(itemEntity.position, 0.5, 10000, configureMovements);
        if (!reached || isDepositing) {
          break;
        }
        await new Promise(r => setTimeout(r, 500));
      } catch (err) {
        console.log(`[Chopper] Error al recoger item: ${err.message}`);
        break;
      }
    } else {
      search = false;
    }
  }
}

async function stepBackFrom(pos) {
  const directions = [
    new Vec3(2, 0, 0),
    new Vec3(-2, 0, 0),
    new Vec3(0, 0, 2),
    new Vec3(0, 0, -2)
  ];

  for (const dir of directions) {
    const standPos = pos.plus(dir);
    const feetBlock = bot.blockAt(standPos);
    const headBlock = bot.blockAt(standPos.offset(0, 1, 0));
    const groundBlock = bot.blockAt(standPos.offset(0, -1, 0));

    if (feetBlock && feetBlock.name === 'air' &&
      headBlock && headBlock.name === 'air' &&
      groundBlock && groundBlock.name !== 'air') {

      console.log(`[Chopper] Retrocediendo a ${standPos} para poder plantar...`);
      bot.pathfinder.setGoal(null);

      try {
        const mcData = context.getMcData();
        const movements = new Movements(bot, mcData);
        configureMovements(movements);
        bot.pathfinder.setMovements(movements);
        await bot.pathfinder.goto(new goals.GoalGetToBlock(standPos.x, standPos.y, standPos.z));
        return true;
      } catch (err) {
        console.log(`[Chopper] Error al retroceder a ${standPos}: ${err.message}`);
      }
    }
  }
  return false;
}

async function replantSapling(soilPos) {
  const soilBlock = bot.blockAt(soilPos);
  if (!soilBlock) return;

  const airPos = soilPos.offset(0, 1, 0);
  const airBlock = bot.blockAt(airPos);

  if (!airBlock || airBlock.name !== 'air') {
    console.log(`[Chopper] La posición superior ${airPos} no está libre (${airBlock ? airBlock.name : 'unknown'}). No se planta.`);
    return;
  }

  const sapling = bot.inventory.items().find(isSaplingItem);
  if (!sapling) {
    sendOwnerMsg('[Chopper] Sin saplings en el inventario para replantar.');
    return;
  }

  let dist = bot.entity.position.distanceTo(airPos);
  if (dist > 4.0) {
    console.log(`[Chopper] Demasiado lejos de la base del árbol (${dist.toFixed(1)}m). Regresando para replantar...`);
    const reached = await context.goToBase(soilPos, 2, 8000, configureMovements);
    if (!reached) {
      console.log(`[Chopper] No se pudo regresar a la base en ${soilPos} para replantar.`);
      return;
    }
    dist = bot.entity.position.distanceTo(airPos);
  }

  if (dist < 1.2) {
    await stepBackFrom(soilPos);
  }

  try {
    await bot.equip(sapling, 'hand');
    bot.pathfinder.setGoal(null);
    await bot.lookAt(soilPos.offset(0.5, 1.0, 0.5));
    await bot.placeBlock(soilBlock, new Vec3(0, 1, 0));
    sendOwnerMsg(`[Chopper] ¡Sapling (${sapling.name}) replantado con éxito en ${airPos}!`);
  } catch (err) {
    console.log(`[Chopper] Error al colocar el sapling: ${err.message}`);
  }
}

function onChat(message, isWhisper = false) {
  let msg = message.toLowerCase().trim();
  const myName = bot.username.toLowerCase();

  const words = msg.split(/\s+/);
  if (words.length > 1) {
    const firstWord = words[0];
    if (firstWord === myName || firstWord === 'taladores' || firstWord === 'lumberjacks') {
      msg = words.slice(1).join(' ');
    }
  }

  if (msg === 'trabaja' || msg === 'tala') {
    shouldChop = true;
    saveBotConfig();
    sendOwnerMsg('Iniciando modo talador automático.', true);
  } else if (msg === 'para') {
    shouldChop = false;
    saveBotConfig();
    bot.pathfinder.setGoal(null);
    bot.stopDigging();
    sendOwnerMsg('Modo talador detenido.', true);
  } else if (msg === 'guarda') {
    if (isDepositing) {
      sendOwnerMsg('Ya estoy guardando la madera en este momento.', true);
    } else {
      isDepositing = true;
      sendOwnerMsg('Iniciando depósito manual de madera...', true);
      bot.pathfinder.setGoal(null);
      bot.stopDigging();
      const oldShouldChop = shouldChop;
      shouldChop = false;
      depositToChest().finally(() => {
        shouldChop = oldShouldChop;
        isDepositing = false;
      });
    }
  } else if (msg.startsWith('cofre ')) {
    const parts = msg.split(/\s+/);
    if (parts.length === 5) {
      const type = parts[1];
      const x = Math.floor(parseFloat(parts[2]));
      const y = Math.floor(parseFloat(parts[3]));
      const z = Math.floor(parseFloat(parts[4]));
      if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
        const pos = new Vec3(x, y, z);
        if (type === 'leña' || type === 'madera') {
          woodChestPosition = pos;
          saveBotConfig();
          sendOwnerMsg(`Posición del cofre de leña configurada en ${pos}`, true);
        } else if (type === 'papas' || type === 'papa') {
          context.saveConfig({ potatoChestPosition: { x, y, z } });
          sendOwnerMsg(`Posición del cofre de papas configurada en ${pos} (compartida)`, true);
        } else if (type === 'trigo') {
          context.saveConfig({ wheatChestPosition: { x, y, z } });
          sendOwnerMsg(`Posición del cofre de trigo configurada en ${pos} (compartida)`, true);
        } else if (type === 'semillas' || type === 'semilla') {
          context.saveConfig({ seedChestPosition: { x, y, z } });
          sendOwnerMsg(`Posición del cofre de semillas configurada en ${pos} (compartida)`, true);
        } else if (type === 'zanahorias' || type === 'zanahoria') {
          context.saveConfig({ carrotChestPosition: { x, y, z } });
          sendOwnerMsg(`Posición del cofre de zanahorias configurada en ${pos} (compartida)`, true);
        } else {
          sendOwnerMsg(`Tipo de cofre desconocido: "${type}". Usa: leña, papas, trigo, semillas, zanahorias`, true);
        }
      } else {
        sendOwnerMsg('Coordenadas de cofre inválidas. Usa: cofre <tipo> x y z', true);
      }
    } else {
      sendOwnerMsg('Formato incorrecto. Usa: cofre <leña|papas|trigo|semillas|zanahorias> x y z', true);
    }
  } else if (msg.startsWith('cama ')) {
    const parts = msg.split(/\s+/);
    if (parts.length === 4) {
      const x = Math.floor(parseFloat(parts[1]));
      const y = Math.floor(parseFloat(parts[2]));
      const z = Math.floor(parseFloat(parts[3]));
      if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
        bedPosition = new Vec3(x, y, z);
        saveBotConfig();
        sendOwnerMsg(`Posición de la cama configurada en ${bedPosition}. Yendo a guardar respawn...`, true);
        interactWithBed(bedPosition);
      } else {
        sendOwnerMsg('Coordenadas de cama inválidas. Usa: cama x y z', true);
      }
    } else {
      sendOwnerMsg('Formato incorrecto. Usa: cama x y z', true);
    }
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
