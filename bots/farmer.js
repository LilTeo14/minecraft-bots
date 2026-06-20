const { Movements, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');

let context = {};
let bot = null;
let isWorking = false;
let isDepositing = false;
let shouldFarm = false;
let potatoChestPosition = null;
let wheatChestPosition = null;
let seedChestPosition = null;
let carrotChestPosition = null;
let bedPosition = null;
let lastDepositTime = Date.now();
let lastSleepAttempt = 0;
const blacklistedCrops = new Map();
let harvestSuccessCount = 0;
let loopTimeout = null;

// Crop configurations
const CROP_INFO = {
  'wheat': { maxAge: 7, seed: 'wheat_seeds', product: 'wheat' },
  'carrots': { maxAge: 7, seed: 'carrot', product: 'carrot' },
  'carrot': { maxAge: 7, seed: 'carrot', product: 'carrot' },
  'potatoes': { maxAge: 7, seed: 'potato', product: 'potato' },
  'potato': { maxAge: 7, seed: 'potato', product: 'potato' },
  'beetroots': { maxAge: 3, seed: 'beetroot_seeds', product: 'beetroot' },
  'beetroot': { maxAge: 3, seed: 'beetroot_seeds', product: 'beetroot' },
  'nether_wart': { maxAge: 3, seed: 'nether_wart', product: 'nether_wart' }
};

function init(ctx) {
  context = ctx;
  bot = ctx.bot;
  loadBotConfig();
}

function onSpawn() {
  startFarmerLoop();
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
    shouldFarm,
    potatoChestPosition: potatoChestPosition ? { x: potatoChestPosition.x, y: potatoChestPosition.y, z: potatoChestPosition.z } : null,
    wheatChestPosition: wheatChestPosition ? { x: wheatChestPosition.x, y: wheatChestPosition.y, z: wheatChestPosition.z } : null,
    seedChestPosition: seedChestPosition ? { x: seedChestPosition.x, y: seedChestPosition.y, z: seedChestPosition.z } : null,
    carrotChestPosition: carrotChestPosition ? { x: carrotChestPosition.x, y: carrotChestPosition.y, z: carrotChestPosition.z } : null,
    bedPosition: bedPosition ? { x: bedPosition.x, y: bedPosition.y, z: bedPosition.z } : null
  });
}

function loadBotConfig() {
  try {
    shouldFarm = false;

    const config = context.getConfig();
    if (config.shouldFarm !== undefined) {
      shouldFarm = config.shouldFarm;
    }
    if (config.potatoChestPosition) {
      potatoChestPosition = new Vec3(config.potatoChestPosition.x, config.potatoChestPosition.y, config.potatoChestPosition.z);
    }
    if (config.wheatChestPosition) {
      wheatChestPosition = new Vec3(config.wheatChestPosition.x, config.wheatChestPosition.y, config.wheatChestPosition.z);
    }
    if (config.seedChestPosition) {
      seedChestPosition = new Vec3(config.seedChestPosition.x, config.seedChestPosition.y, config.seedChestPosition.z);
    }
    if (config.carrotChestPosition) {
      carrotChestPosition = new Vec3(config.carrotChestPosition.x, config.carrotChestPosition.y, config.carrotChestPosition.z);
    }
    if (config.bedPosition) {
      bedPosition = new Vec3(config.bedPosition.x, config.bedPosition.y, config.bedPosition.z);
    }
    console.log(`[Farmer] Configuración cargada con éxito.`);
  } catch (err) {
    console.error(`[Farmer] Error al cargar configuración:`, err.message);
  }
}

function countItems(name) {
  return bot.inventory.items()
    .filter(item => item.name === name)
    .reduce((sum, item) => sum + item.count, 0);
}

function getChestForItem(itemName) {
  if (itemName === 'potato' || itemName === 'poisonous_potato') {
    return potatoChestPosition;
  }
  if (itemName === 'wheat') {
    return wheatChestPosition;
  }
  if (itemName === 'wheat_seeds' || itemName === 'beetroot_seeds') {
    return seedChestPosition;
  }
  if (itemName === 'carrot') {
    return carrotChestPosition;
  }
  return null;
}

function getDepositsGroupedByChest() {
  const groups = new Map();
  const items = bot.inventory.items();
  
  const seedCounts = {
    'wheat_seeds': countItems('wheat_seeds'),
    'carrot': countItems('carrot'),
    'potato': countItems('potato'),
    'beetroot_seeds': countItems('beetroot_seeds'),
    'nether_wart': countItems('nether_wart')
  };

  for (const item of items) {
    let amountToDeposit = 0;
    if (item.name === 'wheat' || item.name === 'beetroot' || item.name === 'poisonous_potato') {
      amountToDeposit = item.count;
    } else if (seedCounts[item.name] !== undefined) {
      const total = seedCounts[item.name];
      if (total > 64) {
        const excess = total - 64;
        amountToDeposit = Math.min(item.count, excess);
        seedCounts[item.name] -= amountToDeposit;
      }
    }

    if (amountToDeposit > 0) {
      const chestPos = getChestForItem(item.name);
      if (chestPos) {
        const key = `${chestPos.x},${chestPos.y},${chestPos.z}`;
        if (!groups.has(key)) {
          groups.set(key, { position: chestPos, deposits: [] });
        }
        groups.get(key).deposits.push({ item, amount: amountToDeposit });
      }
    }
  }
  return groups;
}

function updateChestPosition(oldPos, newPos) {
  if (potatoChestPosition && potatoChestPosition.equals(oldPos)) potatoChestPosition = newPos;
  if (wheatChestPosition && wheatChestPosition.equals(oldPos)) wheatChestPosition = newPos;
  if (seedChestPosition && seedChestPosition.equals(oldPos)) seedChestPosition = newPos;
  if (carrotChestPosition && carrotChestPosition.equals(oldPos)) carrotChestPosition = newPos;
}

function shouldDeposit() {
  const hasAnyChest = potatoChestPosition || wheatChestPosition || seedChestPosition || carrotChestPosition;
  if (!hasAnyChest) return false;
  if (bot.inventory.emptySlotCount() < 4) return true;

  const groups = getDepositsGroupedByChest();
  let totalAmount = 0;
  for (const group of groups.values()) {
    for (const dep of group.deposits) {
      totalAmount += dep.amount;
    }
  }
  return totalAmount >= 64;
}

function hasItemsToDeposit() {
  const groups = getDepositsGroupedByChest();
  return groups.size > 0;
}

async function depositToChest() {
  const groups = getDepositsGroupedByChest();
  if (groups.size === 0) {
    sendOwnerMsg('[Chest] No había objetos para guardar.');
    return;
  }

  let depositedAnyTotal = false;

  for (const [key, group] of groups.entries()) {
    let targetChestPosition = group.position;

    const initialBlock = bot.blockAt(targetChestPosition);
    if (!initialBlock || !initialBlock.name.includes('chest')) {
      const nearbyChest = bot.findBlock({
        matching: (block) => block.name.includes('chest'),
        point: targetChestPosition,
        maxDistance: 2
      });
      if (nearbyChest) {
        console.log(`[Chest] Corrigiendo posición del cofre de ${targetChestPosition} a ${nearbyChest.position}`);
        updateChestPosition(targetChestPosition, nearbyChest.position);
        targetChestPosition = nearbyChest.position;
        saveBotConfig();
      }
    }

    sendOwnerMsg(`[Chest] Yendo al cofre en ${targetChestPosition} para guardar cosecha...`);

    bot.pathfinder.setGoal(null);
    bot.stopDigging();

    const reached = await context.goToBase(targetChestPosition, 2, 15000, configureMovements);
    if (!reached) {
      sendOwnerMsg(`[Chest] No pude llegar al cofre en ${targetChestPosition}`);
      continue;
    }

    const chestBlock = bot.blockAt(targetChestPosition);
    if (!chestBlock || !chestBlock.name.includes('chest')) {
      sendOwnerMsg(`[Chest] El bloque en ${targetChestPosition} no es un cofre o no está cargado.`);
      continue;
    }

    try {
      const chest = await bot.openChest(chestBlock);
      let depositedAnyInThisChest = false;

      for (const dep of group.deposits) {
        const invItem = bot.inventory.items().find(i => i.name === dep.item.name);
        if (!invItem) continue;
        const amountToDeposit = Math.min(invItem.count, dep.amount);
        if (amountToDeposit <= 0) continue;

        try {
          console.log(`[Chest] Depositando ${amountToDeposit} de ${invItem.name}...`);
          await chest.deposit(invItem.type, null, amountToDeposit);
          depositedAnyInThisChest = true;
          depositedAnyTotal = true;
          await new Promise(r => setTimeout(r, 200));
        } catch (err) {
          console.log(`[Chest] Error al depositar ${invItem.name}: ${err.message}`);
        }
      }

      chest.close();
      if (depositedAnyInThisChest) {
        sendOwnerMsg(`[Chest] Cosecha guardada con éxito en cofre ${targetChestPosition}`);
      }
    } catch (err) {
      sendOwnerMsg(`[Chest] Error al abrir/interactuar con el cofre en ${targetChestPosition}: ${err.message}`);
    }
  }

  if (depositedAnyTotal) {
    sendOwnerMsg('[Chest] Proceso de depósito completado.');
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
    sendOwnerMsg('[Bed] Clic derecho en la cama realizado para guardar el respawn.');
  } catch (err) {
    sendOwnerMsg(`[Bed] Error al interactuar con la cama: ${err.message}`);
  }
}

async function goToSleep() {
  if (!bedPosition) return false;
  if (bot.isSleeping) return true;

  let targetPos = bedPosition;
  const initialBlock = bot.blockAt(bedPosition);
  if (!initialBlock || !initialBlock.name.includes('bed')) {
    const nearbyBed = bot.findBlock({
      matching: (block) => block.name.includes('bed'),
      point: bedPosition,
      maxDistance: 2
    });
    if (nearbyBed) {
      targetPos = nearbyBed.position;
    }
  }

  const bedBlock = bot.blockAt(targetPos);
  if (!bedBlock || !bedBlock.name.includes('bed')) {
    console.log(`[Bed] No se encontró bloque de cama en ${targetPos}`);
    return false;
  }

  sendOwnerMsg(`[Bed] Es de noche. Yendo a la cama en ${targetPos}...`);

  bot.pathfinder.setGoal(null);
  bot.stopDigging();

  const reached = await context.goToBase(targetPos, 2, 15000, configureMovements);
  if (!reached) {
    sendOwnerMsg(`[Bed] No pude llegar a la cama en ${targetPos}`);
    return false;
  }

  try {
    await bot.lookAt(targetPos.offset(0.5, 0.5, 0.5));
    sendOwnerMsg('[Bed] Intentando acostarse...');
    await bot.sleep(bedBlock);
    sendOwnerMsg('[Bed] Durmiendo.');
    return true;
  } catch (err) {
    sendOwnerMsg(`[Bed] No se pudo dormir: ${err.message}`);
    return false;
  }
}

function configureMovements(movements) {
  movements.canDig = false; // Safe movement, do not break farm blocks
  movements.allowSprinting = false;
  movements.allowParkour = false;
  movements.scafoldingBlocks = [];
  movements.liquidCost = 10;
}

function isFullyGrown(block) {
  if (!block) return false;
  const crop = CROP_INFO[block.name];
  if (!crop) return false;

  const props = typeof block.getProperties === 'function' ? block.getProperties() : {};
  const age = props.age !== undefined ? parseInt(props.age, 10) : block.metadata;
  return age >= crop.maxAge;
}

async function startFarmerLoop() {
  if (isWorking) return;
  isWorking = true;

  let foundWork = false;
  try {
    foundWork = await farmerCycle();
  } catch (err) {
    console.error('[Loop Error]', err);
  } finally {
    isWorking = false;
    let delay = foundWork ? 50 : 3000;
    if (bot && bot.isSleeping) {
      delay = 5000;
    }
    loopTimeout = setTimeout(startFarmerLoop, delay);
  }
}

async function farmerCycle() {
  if (!shouldFarm) return false;

  if (bot.isSleeping || bot.isGoingToSleep || bot.isYielding) {
    return true;
  }

  const now = Date.now();
  const timeSinceLastDeposit = now - lastDepositTime;
  const inventoryFull = bot.inventory.emptySlotCount() < 4;

  const hasAnyChest = potatoChestPosition || wheatChestPosition || seedChestPosition || carrotChestPosition;
  if (hasAnyChest && (timeSinceLastDeposit >= 120000 || inventoryFull)) {
    if (hasItemsToDeposit()) {
      await depositToChest();
      lastDepositTime = now;
      return true;
    }
    lastDepositTime = now;
  }

  if (blacklistedCrops.size > 1000) {
    blacklistedCrops.clear();
  }

  console.log('[Farmer] Buscando cultivos maduros...');

  const cropBlock = bot.findBlock({
    matching: (block) => {
      if (!isFullyGrown(block)) return false;
      if (!block.position) return true;
      const key = `${block.position.x},${block.position.y},${block.position.z}`;
      if (blacklistedCrops.has(key)) {
        const successCountAtFailure = blacklistedCrops.get(key);
        if (harvestSuccessCount - successCountAtFailure < 8) {
          return false;
        } else {
          blacklistedCrops.delete(key);
        }
      }
      return true;
    },
    maxDistance: 64
  });

  if (!cropBlock) {
    console.log('[Farmer] No se encontraron cultivos maduros en un radio de 32 bloques.');
    return false;
  }

  const cropName = cropBlock.name;
  const cropPos = cropBlock.position.clone();
  sendOwnerMsg(`[Farmer] Cultivo maduro de ${cropName} detectado en ${cropPos}`);

  const reached = await context.goToBase(cropPos, 2, 15000, configureMovements);
  if (!reached) {
    if (bot.isGoingToSleep || bot.isSleeping) {
      return true;
    }
    const key = `${cropPos.x},${cropPos.y},${cropPos.z}`;
    console.log(`[Farmer] No se pudo llegar al cultivo en ${cropPos}. Agregando a blacklist (cosechas exitosas actuales: ${harvestSuccessCount}).`);
    blacklistedCrops.set(key, harvestSuccessCount);

    sendOwnerMsg(`[Farmer] No pude llegar a ${cropPos}. Intentando destrabarme (avanzando y saltando)...`);
    bot.setControlState('forward', true);
    bot.setControlState('jump', true);
    await new Promise(r => setTimeout(r, 2000));
    bot.setControlState('forward', false);
    bot.setControlState('jump', false);

    return true;
  }

  const currentBlock = bot.blockAt(cropPos);
  let harvested = false;
  if (currentBlock && isFullyGrown(currentBlock)) {
    console.log(`[Farmer] Cosechando ${cropName} en ${cropPos}`);
    harvested = await context.digBlock(currentBlock);
    if (harvested) {
      harvestSuccessCount++;
      console.log(`[Farmer] Cosechas exitosas incrementadas a ${harvestSuccessCount}`);
    }
  }

  if (bot.isGoingToSleep || bot.isSleeping) return true;

  await pickupDrops(cropPos);

  if (bot.isGoingToSleep || bot.isSleeping) return true;

  const soilPos = cropPos.offset(0, -1, 0);
  let soilBlock = bot.blockAt(soilPos);
  if (!soilBlock) return true;

  const cropMeta = CROP_INFO[cropName];
  if (!cropMeta) return true;
  const seedName = cropMeta.seed;

  if (cropName !== 'nether_wart' && soilBlock.name !== 'farmland') {
    const success = await ensureFarmland(soilBlock);
    if (success) {
      soilBlock = bot.blockAt(soilPos);
    }
  }

  const isSoilValid = (cropName === 'nether_wart' && soilBlock.name === 'soul_sand') ||
    (cropName !== 'nether_wart' && soilBlock.name === 'farmland');

  if (isSoilValid) {
    await replantSeed(soilPos, seedName);
  } else {
    console.log(`[Farmer] No se replanta porque el suelo en ${soilPos} no es apto (${soilBlock.name}).`);
  }

  return true;
}

async function pickupDrops(harvestPos) {
  await new Promise(r => setTimeout(r, 350));

  let search = true;
  let attempts = 0;
  let lastItemId = null;
  let sameItemCount = 0;

  while (search && attempts < 10) {
    if (bot.isGoingToSleep || bot.isSleeping || isDepositing) break;
    attempts++;
    const itemEntity = bot.nearestEntity(entity => {
      if (entity.name !== 'item' && entity.type !== 'object') return false;
      const dist = entity.position.distanceTo(harvestPos);
      if (dist > 5.0) return false;
      const heightDiff = Math.abs(entity.position.y - bot.entity.position.y);
      return heightDiff <= 1.5;
    });

    if (itemEntity) {
      const distToBot = itemEntity.position.distanceTo(bot.entity.position);
      if (itemEntity.id === lastItemId) {
        sameItemCount++;
        if (sameItemCount >= 2 && distToBot <= 1.0) {
          console.log(`[Farmer] No se puede recoger el item ${itemEntity.name} (ID: ${itemEntity.id}) en ${itemEntity.position}. ¿Inventario lleno?`);
          break;
        }
      } else {
        lastItemId = itemEntity.id;
        sameItemCount = 0;
      }

      console.log(`[Farmer] Item cosechado detectado en ${itemEntity.position}. Recogiéndolo (intento ${attempts}/10)...`);
      bot.pathfinder.setGoal(null);

      try {
        const reached = await context.goToBase(itemEntity.position, 0.5, 10000, configureMovements);
        if (!reached || isDepositing) {
          break;
        }
        await new Promise(r => setTimeout(r, 150));
      } catch (err) {
        console.log(`[Farmer] Error al recoger drop: ${err.message}`);
        break;
      }
    } else {
      search = false;
    }
  }
}

async function stepBackFrom(pos) {
  const directions = [
    new Vec3(1.2, 0, 0),
    new Vec3(-1.2, 0, 0),
    new Vec3(0, 0, 1.2),
    new Vec3(0, 0, -1.2)
  ];

  for (const dir of directions) {
    const standPos = pos.plus(dir);
    const feetBlock = bot.blockAt(standPos);
    const headBlock = bot.blockAt(standPos.offset(0, 1, 0));
    const groundBlock = bot.blockAt(standPos.offset(0, -1, 0));

    if (feetBlock && feetBlock.name === 'air' &&
      headBlock && headBlock.name === 'air' &&
      groundBlock && groundBlock.name !== 'air') {

      console.log(`[Farmer] Retrocediendo a ${standPos} para poder sembrar...`);
      bot.pathfinder.setGoal(null);

      try {
        const mcData = context.getMcData();
        const movements = new Movements(bot, mcData);
        configureMovements(movements);
        bot.pathfinder.setMovements(movements);
        await bot.pathfinder.goto(new goals.GoalGetToBlock(standPos.x, standPos.y, standPos.z));
        return true;
      } catch (err) {
        console.log(`[Farmer] Error al retroceder a ${standPos}: ${err.message}`);
      }
    }
  }
  return false;
}

async function ensureFarmland(soilBlock) {
  const tillable = ['dirt', 'grass_block', 'coarse_dirt', 'dirt_path', 'rooted_dirt'];
  if (!tillable.includes(soilBlock.name)) return false;

  const hoe = bot.inventory.items().find(item => item.name.endsWith('_hoe'));
  if (!hoe) {
    console.log('[Farmer] Suelo es tierra/pasto pero no hay azadón en el inventario para labrarlo.');
    return false;
  }

  try {
    console.log(`[Farmer] Labrando tierra en ${soilBlock.position} con ${hoe.name}...`);
    await bot.equip(hoe, 'hand');
    bot.pathfinder.setGoal(null);
    await bot.lookAt(soilBlock.position.offset(0.5, 1.0, 0.5));
    await bot.activateBlock(soilBlock);
    await new Promise(r => setTimeout(r, 300));
    return true;
  } catch (err) {
    console.log(`[Farmer] Error al labrar tierra: ${err.message}`);
    return false;
  }
}

async function replantSeed(soilPos, seedName) {
  const soilBlock = bot.blockAt(soilPos);
  if (!soilBlock) return;

  const airPos = soilPos.offset(0, 1, 0);
  const airBlock = bot.blockAt(airPos);

  if (!airBlock || (airBlock.name !== 'air' && !airBlock.name.includes('water'))) {
    console.log(`[Farmer] La posición superior ${airPos} no está libre (${airBlock ? airBlock.name : 'unknown'}).`);
    return;
  }

  const seedItem = bot.inventory.items().find(item => item.name === seedName);
  if (!seedItem) {
    sendOwnerMsg(`[Farmer] Sin semillas de ${seedName} en el inventario para replantar.`);
    return;
  }

  let dist = bot.entity.position.distanceTo(airPos);
  if (dist > 4.0) {
    console.log(`[Farmer] Demasiado lejos de la base del cultivo (${dist.toFixed(1)}m). Regresando para replantar...`);
    const reached = await context.goToBase(soilPos, 2, 8000, configureMovements);
    if (!reached) {
      console.log(`[Farmer] No se pudo regresar a la base en ${soilPos} para replantar.`);
      return;
    }
    dist = bot.entity.position.distanceTo(airPos);
  }

  if (dist < 1.2) {
    await stepBackFrom(soilPos);
  }

  try {
    await bot.equip(seedItem, 'hand');
    bot.pathfinder.setGoal(null);
    await bot.lookAt(soilPos.offset(0.5, 1.0, 0.5));
    await bot.placeBlock(soilBlock, new Vec3(0, 1, 0));
    sendOwnerMsg(`[Farmer] Semilla (${seedItem.name}) replantada con éxito en ${airPos}`);
  } catch (err) {
    console.log(`[Farmer] Error al colocar semilla: ${err.message}`);
  }
}

function onChat(message, isWhisper = false) {
  let msg = message.toLowerCase().trim();
  const myName = bot.username.toLowerCase();

  const words = msg.split(/\s+/);
  if (words.length > 1) {
    const firstWord = words[0];
    if (firstWord === myName || firstWord === 'cosechadores' || firstWord === 'farmers') {
      msg = words.slice(1).join(' ');
    }
  }

  if (msg === 'trabaja' || msg === 'cultiva') {
    shouldFarm = true;
    saveBotConfig();
    sendOwnerMsg('Iniciando modo cultivador automático.', true);
  } else if (msg === 'para') {
    shouldFarm = false;
    saveBotConfig();
    bot.pathfinder.setGoal(null);
    bot.stopDigging();
    sendOwnerMsg('Modo cultivador detenido.', true);
  } else if (msg === 'guarda') {
    if (isDepositing) {
      sendOwnerMsg('Ya estoy guardando la cosecha en este momento.', true);
    } else {
      isDepositing = true;
      sendOwnerMsg('Iniciando depósito manual de cosecha...', true);
      bot.pathfinder.setGoal(null);
      bot.stopDigging();
      const oldShouldFarm = shouldFarm;
      shouldFarm = false;
      depositToChest().finally(() => {
        shouldFarm = oldShouldFarm;
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
        if (type === 'papas' || type === 'papa') {
          potatoChestPosition = pos;
          saveBotConfig();
          sendOwnerMsg(`Posición del cofre de papas configurada en ${pos}`, true);
        } else if (type === 'trigo') {
          wheatChestPosition = pos;
          saveBotConfig();
          sendOwnerMsg(`Posición del cofre de trigo configurada en ${pos}`, true);
        } else if (type === 'semillas' || type === 'semilla') {
          seedChestPosition = pos;
          saveBotConfig();
          sendOwnerMsg(`Posición del cofre de semillas configurada en ${pos}`, true);
        } else if (type === 'zanahorias' || type === 'zanahoria') {
          carrotChestPosition = pos;
          saveBotConfig();
          sendOwnerMsg(`Posición del cofre de zanahorias configurada en ${pos}`, true);
        } else if (type === 'leña' || type === 'madera') {
          context.saveConfig({ woodChestPosition: { x, y, z } });
          sendOwnerMsg(`Posición del cofre de leña configurada en ${pos} (compartida)`, true);
        } else {
          sendOwnerMsg(`Tipo de cofre desconocido: "${type}". Usa: papas, trigo, semillas, zanahorias, leña`, true);
        }
      } else {
        sendOwnerMsg('Coordenadas de cofre inválidas. Usa: cofre <tipo> x y z', true);
      }
    } else {
      sendOwnerMsg('Formato incorrecto. Usa: cofre <papas|trigo|semillas|zanahorias|leña> x y z', true);
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
