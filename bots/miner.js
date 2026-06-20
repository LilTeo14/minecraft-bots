const { Movements, goals } = require('mineflayer-pathfinder');
const Move = require('mineflayer-pathfinder/lib/move');
const { Vec3 } = require('vec3');

let context = {};
let bot = null;

let isMiningActive = false;
let miningLoopRunning = false;

// Chest Coordinates
let picotasChest = null;
let oresChest = null;

// Mining State
let miningState = {
  isMining: false,
  startPos: null,          // Vec3
  mainDirection: null,     // 'east', 'west', etc.
  currentNodeIndex: 0,     // Index of current branch node (0, 1, 2...)
  currentBranchSide: 'none', // 'left', 'right', 'none'
  branchProgress: 0,       // how many blocks into the current branch
  mainTunnelProgress: 0,    // how many blocks forward in main tunnel
  branchLength: 20
};

const directionVectors = {
  east: new Vec3(1, 0, 0),
  west: new Vec3(-1, 0, 0),
  south: new Vec3(0, 0, 1),
  north: new Vec3(0, 0, -1)
};

const FILLER_BLOCKS = [
  'cobbled_deepslate',
  'cobblestone',
  'deepslate',
  'stone',
  'tuff',
  'diorite',
  'andesite',
  'granite',
  'dirt',
  'gravel',
  'sand',
  'calcite'
];

const SOLID_FILLER_BLOCKS = [
  'cobbled_deepslate',
  'cobblestone',
  'deepslate',
  'stone',
  'tuff',
  'diorite',
  'andesite',
  'granite'
];

const GRAVITY_BLOCKS = ['gravel', 'sand', 'red_sand', 'suspicious_gravel', 'suspicious_sand'];

async function handleGravityBlocksAt(pos) {
  let attempts = 0;
  const maxAttempts = 20;
  
  while (attempts < maxAttempts) {
    const blockAbove = bot.blockAt(pos.offset(0, 1, 0));
    const fallingEntities = Object.values(bot.entities).filter(entity => 
      entity.name === 'falling_block' && 
      entity.position.distanceTo(pos.offset(0.5, 0.5, 0.5)) < 3.5
    );
    
    const hasGravityAbove = blockAbove && GRAVITY_BLOCKS.includes(blockAbove.name);
    const hasFallingEntities = fallingEntities.length > 0;
    
    if (hasGravityAbove || hasFallingEntities) {
      console.log(`[Miner] Grava/arena detectada arriba de ${pos} o cayendo. Esperando caída...`);
      await new Promise(r => setTimeout(r, 300));
      
      const blockAtPos = bot.blockAt(pos);
      if (isPhysical(blockAtPos)) {
        console.log(`[Miner] Minando bloque que cayó en ${pos}: ${blockAtPos.name}`);
        await context.digBlock(blockAtPos);
      }
      attempts++;
    } else {
      break;
    }
  }
}

async function digBlock(block) {
  if (!block || bot.blockAt(block.position).type === 0) return false;
  const pos = block.position.clone();
  const success = await context.digBlock(block);
  if (success) {
    await handleGravityBlocksAt(pos);
  }
  return success;
}

let lastLoc = null;
let isDead = false;

function init(ctx) {
  context = ctx;
  bot = ctx.bot;
  loadBotConfig();
  
  bot.on('death', () => {
    isDead = true;
  });
  
  bot.on('spawn', () => {
    isDead = false;
    lastLoc = null;
  });

  bot.on('physicsTick', () => {
    if (!bot.entity || !miningState.isMining || isDead) {
      if (bot.entity) lastLoc = bot.entity.position.clone();
      return;
    }
    
    if (lastLoc) {
      const dist = bot.entity.position.distanceTo(lastLoc);
      if (dist > 5.0) {
        console.log(`[Miner] Teletransporte detectado! Distancia: ${dist.toFixed(1)}m. Deteniendo minería.`);
        sendOwnerMsg(`[Miner] ¡He sido teletransportado! Distancia: ${dist.toFixed(1)}m. Deteniendo minería por seguridad.`, true);
        isMiningActive = false;
        miningState.isMining = false;
        bot.pathfinder.setGoal(null);
        saveBotConfig();
      }
    }
    lastLoc = bot.entity.position.clone();
  });
}

let spawnTimeout = null;

function onSpawn() {
  if (miningState.isMining) {
    sendOwnerMsg(`[System] Reanudando minería automática hacia el ${miningState.mainDirection} en nodo ${miningState.currentNodeIndex}...`, true);
    if (spawnTimeout) clearTimeout(spawnTimeout);
    isMiningActive = true;
    spawnTimeout = setTimeout(async () => {
      const dirVec = directionVectors[miningState.mainDirection];
      const leftDirName = perpendicularLeft(miningState.mainDirection);
      const rightDirName = perpendicularRight(miningState.mainDirection);
      const leftDir = directionVectors[leftDirName];
      const rightDir = directionVectors[rightDirName];
      
      const nodePos = miningState.startPos.plus(dirVec.scaled(miningState.currentNodeIndex * 3));
      
      let targetPos;
      if (miningState.currentBranchSide === 'none') {
        targetPos = nodePos.plus(dirVec.scaled(miningState.mainTunnelProgress));
      } else if (miningState.currentBranchSide === 'left') {
        targetPos = nodePos.plus(leftDir.scaled(miningState.branchProgress));
      } else if (miningState.currentBranchSide === 'right') {
        targetPos = nodePos.plus(rightDir.scaled(miningState.branchProgress));
      }
      
      const reached = await verifyAndWalkToResumption(targetPos);
      if (reached) {
        sendOwnerMsg('[System] Posición alcanzada. Reanudando minería.', true);
        startMiningLoop();
      } else {
        if (isMiningActive) {
          sendOwnerMsg('[System] No pude reanudar la minería de forma automática. Minado pausado.', true);
          miningState.isMining = false;
          saveBotConfig();
        }
      }
    }, 5000);
  }
}

function onDeath() {
  isMiningActive = false;
  if (spawnTimeout) {
    clearTimeout(spawnTimeout);
    spawnTimeout = null;
  }
}

function onEnd() {
  isMiningActive = false;
}

function sendOwnerMsg(msg, force = false) {
  context.sendOwnerMsg(msg, force);
}

function parseDirection(str) {
  const s = str.toLowerCase().trim();
  if (s === 'east' || s === 'este' || s === 'e') return 'east';
  if (s === 'west' || s === 'oeste' || s === 'w' || s === 'o') return 'west';
  if (s === 'south' || s === 'sur' || s === 's') return 'south';
  if (s === 'north' || s === 'norte' || s === 'n') return 'north';
  return null;
}

function perpendicularLeft(dir) {
  if (dir === 'east') return 'north';
  if (dir === 'west') return 'south';
  if (dir === 'south') return 'east';
  if (dir === 'north') return 'west';
  return null;
}

function perpendicularRight(dir) {
  if (dir === 'east') return 'south';
  if (dir === 'west') return 'north';
  if (dir === 'south') return 'west';
  if (dir === 'north') return 'east';
  return null;
}

function saveBotConfig() {
  context.saveConfig({
    picotasChest: picotasChest ? { x: picotasChest.x, y: picotasChest.y, z: picotasChest.z } : null,
    oresChest: oresChest ? { x: oresChest.x, y: oresChest.y, z: oresChest.z } : null,
    miningState: {
      isMining: miningState.isMining,
      startPos: miningState.startPos ? { x: miningState.startPos.x, y: miningState.startPos.y, z: miningState.startPos.z } : null,
      mainDirection: miningState.mainDirection,
      currentNodeIndex: miningState.currentNodeIndex,
      currentBranchSide: miningState.currentBranchSide,
      branchProgress: miningState.branchProgress,
      mainTunnelProgress: miningState.mainTunnelProgress,
      branchLength: miningState.branchLength || 20
    }
  });
}

function loadBotConfig() {
  try {
    const config = context.getConfig();
    if (config.picotasChest) {
      picotasChest = new Vec3(config.picotasChest.x, config.picotasChest.y, config.picotasChest.z);
    }
    if (config.oresChest) {
      oresChest = new Vec3(config.oresChest.x, config.oresChest.y, config.oresChest.z);
    }
    if (config.miningState) {
      miningState.isMining = config.miningState.isMining || false;
      if (config.miningState.startPos) {
        miningState.startPos = new Vec3(config.miningState.startPos.x, config.miningState.startPos.y, config.miningState.startPos.z);
      }
      miningState.mainDirection = config.miningState.mainDirection || null;
      miningState.currentNodeIndex = config.miningState.currentNodeIndex || 0;
      miningState.currentBranchSide = config.miningState.currentBranchSide || 'none';
      miningState.branchProgress = config.miningState.branchProgress || 0;
      miningState.mainTunnelProgress = config.miningState.mainTunnelProgress || 0;
      miningState.branchLength = config.miningState.branchLength || 20;
    }
    console.log('[Miner] Configuración cargada con éxito.');
  } catch (err) {
    console.error('[Miner] Error al cargar configuración:', err.message);
  }
}

function getPickaxesCount() {
  return bot.inventory.items().filter(item => item.name.includes('pickaxe')).reduce((sum, item) => sum + item.count, 0);
}

function getTorchesCount() {
  return bot.inventory.items().filter(item => item.name === 'torch').reduce((sum, item) => sum + item.count, 0);
}

async function equipBestPickaxe() {
  const items = bot.inventory.items();
  console.log(`[Miner debug] Inventory: ${items.map(i => `${i.name} x${i.count}`).join(', ')}`);
  const pickaxes = items.filter(item => item.name.includes('pickaxe'));
  if (pickaxes.length === 0) return false;

  const quality = {
    netherite_pickaxe: 6,
    diamond_pickaxe: 5,
    iron_pickaxe: 4,
    stone_pickaxe: 3,
    golden_pickaxe: 2,
    wooden_pickaxe: 1
  };

  pickaxes.sort((a, b) => {
    const qA = quality[a.name] || 0;
    const qB = quality[b.name] || 0;
    return qB - qA;
  });

  const best = pickaxes[0];

  const heldItem = bot.heldItem;
  if (heldItem && heldItem.name === best.name) {
    return true;
  }

  try {
    await bot.equip(best, 'hand');
    console.log(`[Inventory] Equipando herramienta: ${best.name}`);
    await new Promise(r => setTimeout(r, 350));
    return true;
  } catch (err) {
    console.log(`[Inventory] No se pudo equipar picota: ${err.message}`);
    return false;
  }
}

async function manageInventory() {
  const items = bot.inventory.items();
  const emptySlotsCount = bot.inventory.emptySlotCount();
  
  if (emptySlotsCount >= 3) return;
  
  const fillerItems = items.filter(item => FILLER_BLOCKS.includes(item.name));
  let totalFillerCount = fillerItems.reduce((sum, item) => sum + item.count, 0);
  
  for (const item of fillerItems) {
    if (totalFillerCount - item.count >= 128) {
      console.log(`[Inventory] Desechando pila de ${item.name} (${item.count}) para liberar espacio.`);
      try {
        await bot.tossStack(item);
        totalFillerCount -= item.count;
        await new Promise(r => setTimeout(r, 200));
      } catch (err) {
        console.log(`[Inventory] Error al desechar ${item.name}: ${err.message}`);
      }
    }
  }
}

function isPhysical(block) {
  if (!block) return false;
  return block.name !== 'air' && block.boundingBox !== 'empty' && !block.name.includes('water') && !block.name.includes('lava');
}

function isOreBlock(block) {
  if (!block) return false;
  const name = block.name;
  return name.includes('ore') || name.includes('raw_');
}

function isOreItem(item) {
  if (!item) return false;
  const name = item.name;
  return !name.includes('pickaxe') && name !== 'torch';
}

async function harvestVein(startBlockPos) {
  const queue = [startBlockPos];
  const visited = new Set();
  visited.add(startBlockPos.toString());
  
  let blocksMined = 0;
  const minedPositions = [];
  
  while (queue.length > 0 && blocksMined < 25) {
    const currentPos = queue.shift();
    const block = bot.blockAt(currentPos);
    if (block && isOreBlock(block)) {
      await equipBestPickaxe();
      const success = await digBlock(block);
      if (!success) {
        console.log(`[Miner] Falló excavación del bloque de mineral en ${currentPos}. Saltando vecinos.`);
        continue;
      }
      blocksMined++;
      minedPositions.push(currentPos.clone());
      
      const neighbors = [
        currentPos.offset(1, 0, 0),
        currentPos.offset(-1, 0, 0),
        currentPos.offset(0, 1, 0),
        currentPos.offset(0, -1, 0),
        currentPos.offset(0, 0, 1),
        currentPos.offset(0, 0, -1)
      ];
      
      for (const neighbor of neighbors) {
        if (neighbor.distanceTo(startBlockPos) <= 4) {
          const key = neighbor.toString();
          if (!visited.has(key)) {
            visited.add(key);
            const nBlock = bot.blockAt(neighbor);
            if (nBlock && isOreBlock(nBlock)) {
              queue.push(neighbor);
            }
          }
        }
      }
    }
  }

  // After mining the vein, fill any holes left in the floor/subfloor
  const referenceY = miningState.startPos ? miningState.startPos.y : bot.entity.position.floored().y;
  const belowFloorPositions = minedPositions.filter(p => p.y < referenceY);
  
  if (belowFloorPositions.length > 0) {
    console.log(`[Miner] Rellenando ${belowFloorPositions.length} bloques de mineral excavados bajo el suelo.`);
    // Sort ascending by Y (lowest first) to build from bottom to top
    belowFloorPositions.sort((a, b) => a.y - b.y);
    for (const p of belowFloorPositions) {
      const block = bot.blockAt(p);
      if (!block || block.name === 'air' || block.name.includes('water') || block.name.includes('lava')) {
        await placeBlockAt(p);
      }
    }
  }
}

async function placeBlockAt(targetPos) {
  const targetBlock = bot.blockAt(targetPos);
  if (targetBlock && targetBlock.name !== 'air' && !targetBlock.name.includes('water') && !targetBlock.name.includes('lava')) {
    return;
  }

  let filler = bot.inventory.items().find(item => SOLID_FILLER_BLOCKS.includes(item.name));
  if (!filler) {
    filler = bot.inventory.items().find(item => FILLER_BLOCKS.includes(item.name));
  }
  if (!filler) {
    sendOwnerMsg('[Miner] ¡No tengo bloques de relleno en inventario para tapar líquidos o tapar el suelo!');
    return;
  }

  await bot.equip(filler, 'hand');

  const faces = [
    new Vec3(0, -1, 0),
    new Vec3(0, 1, 0),
    new Vec3(-1, 0, 0),
    new Vec3(1, 0, 0),
    new Vec3(0, 0, -1),
    new Vec3(0, 0, 1)
  ];

  for (const face of faces) {
    const refPos = targetPos.plus(face);
    const refBlock = bot.blockAt(refPos);
    if (refBlock && refBlock.name !== 'air' && !refBlock.name.includes('water') && !refBlock.name.includes('lava') && refBlock.boundingBox !== 'empty') {
      const placeFace = face.scaled(-1);
      try {
        await bot.lookAt(refBlock.position.offset(0.5, 0.5, 0.5));
        await bot.placeBlock(refBlock, placeFace);
        console.log(`[Miner] Tapado bloque en ${targetPos} usando ${filler.name}`);
        return;
      } catch (err) {
        console.log(`[Miner] Fallo al colocar bloque contra ${refPos}: ${err.message}`);
      }
    }
  }
}

async function checkAndPlugLiquids(pos, travelDir, sideDirA, sideDirB) {
  const checkPositions = [
    pos.offset(0, 2, 0),
    pos.offset(0, -1, 0),
    pos.offset(sideDirA.x, 0, sideDirA.z),
    pos.offset(sideDirA.x, 1, sideDirA.z),
    pos.offset(sideDirB.x, 0, sideDirB.z),
    pos.offset(sideDirB.x, 1, sideDirB.z),
    pos.offset(travelDir.x, 0, travelDir.z),
    pos.offset(travelDir.x, 1, travelDir.z),
    pos.offset(-travelDir.x, 0, -travelDir.z),
    pos.offset(-travelDir.x, 1, -travelDir.z)
  ];
  
  for (const p of checkPositions) {
    const block = bot.blockAt(p);
    if (block && (block.name.includes('water') || block.name.includes('lava'))) {
      console.log(`[Miner] Detectado líquido en ${p} (${block.name}). Tapándolo.`);
      await placeBlockAt(p);
    }
  }
}

async function checkAndHarvestOres(pos, travelDir, sideDirA, sideDirB) {
  const surrounding = [
    pos.offset(0, 2, 0),
    pos.offset(0, -1, 0),
    pos.offset(sideDirA.x, 0, sideDirA.z),
    pos.offset(sideDirA.x, 1, sideDirA.z),
    pos.offset(sideDirB.x, 0, sideDirB.z),
    pos.offset(sideDirB.x, 1, sideDirB.z)
  ];
  
  let foundOre = false;
  for (const p of surrounding) {
    const block = bot.blockAt(p);
    if (block && isOreBlock(block)) {
      console.log(`[Miner] Ore detectado en ${p} (${block.name}). Cosechando veta.`);
      await harvestVein(p);
      foundOre = true;
    }
  }
  
  if (foundOre) {
    await checkAndPlugLiquids(pos, travelDir, sideDirA, sideDirB);
  }
}

async function placeTorchAt(pos) {
  const torch = bot.inventory.items().find(item => item.name === 'torch');
  if (!torch) {
    console.log('[Miner] Sin antorchas en el inventario.');
    return false;
  }

  const block = bot.blockAt(pos);
  if (block && block.name !== 'air' && !block.name.includes('water') && !block.name.includes('lava')) {
    console.log(`[Miner] Ya hay un bloque o antorcha en ${pos}: ${block.name}`);
    return false;
  }

  const floorPos = pos.offset(0, -1, 0);
  const floorBlock = bot.blockAt(floorPos);
  if (!floorBlock || floorBlock.name === 'air' || floorBlock.name.includes('water') || floorBlock.name.includes('lava') || floorBlock.boundingBox === 'empty') {
    console.log(`[Miner] No hay suelo sólido en ${floorPos} para colocar la antorcha.`);
    return false;
  }

  try {
    await bot.equip(torch, 'hand');
    await bot.lookAt(floorPos.offset(0.5, 1, 0.5));
    await bot.placeBlock(floorBlock, new Vec3(0, 1, 0));
    console.log(`[Miner] Antorcha colocada en ${pos}`);
    return true;
  } catch (err) {
    console.log(`[Miner] Error al colocar antorcha en ${pos}: ${err.message}`);
    return false;
  }
}

async function goToChest(pos, range = 2, timeoutMs = 30000) {
  return await context.goToBase(pos, range, timeoutMs, configureMovements);
}

async function depositOres(force = false) {
  if (!oresChest) {
    sendOwnerMsg('[Miner] Cofre de ores no configurado. Saltando depósito.', force);
    return;
  }
  
  sendOwnerMsg(`[Miner] Yendo al cofre de ores en ${oresChest} para depositar ores...`, force);
  
  const dirVec = directionVectors[miningState.mainDirection];
  const nodePos = miningState.startPos.plus(dirVec.scaled(miningState.currentNodeIndex * 3));
  
  if (miningState.currentBranchSide !== 'none') {
    let currentPos = bot.entity.position.floored();
    await walkTunnel(currentPos, nodePos);
  }
  await walkTunnel(nodePos, miningState.startPos);
  
  const reached = await goToChest(oresChest, 2);
  if (!reached) {
    sendOwnerMsg(`[Miner] No pude llegar al cofre de ores en ${oresChest}. Por favor, ayúdame.`, force);
    return;
  }
  
  const chestBlock = bot.blockAt(oresChest);
  if (!chestBlock || !chestBlock.name.includes('chest')) {
    sendOwnerMsg(`[Miner] El bloque en ${oresChest} no es un cofre o no está cargado.`, force);
    return;
  }
  
  try {
    const chest = await bot.openChest(chestBlock);
    const items = bot.inventory.items();
    let depositedAny = false;
    
    // Contar bloques de piedra/relleno sólido totales en inventario
    let totalSolidFiller = items
      .filter(item => SOLID_FILLER_BLOCKS.includes(item.name))
      .reduce((sum, item) => sum + item.count, 0);
    
    for (const item of items) {
      if (isOreItem(item)) {
        let depositCount = item.count;
        if (SOLID_FILLER_BLOCKS.includes(item.name)) {
          // Conservar al menos 32 bloques en total
          const maxToDeposit = Math.max(0, totalSolidFiller - 32);
          depositCount = Math.min(item.count, maxToDeposit);
          totalSolidFiller -= depositCount;
        }

        if (depositCount > 0) {
          try {
            console.log(`[Miner] Depositando ${depositCount} de ${item.name}...`);
            await chest.deposit(item.type, null, depositCount);
            depositedAny = true;
            await new Promise(r => setTimeout(r, 200));
          } catch (err) {
            console.log(`[Miner] Error al depositar ${item.name}: ${err.message}`);
          }
        }
      }
    }
    
    // Si tenemos menos de 32 bloques de piedra sólida, intentar retirar del cofre
    let currentSolidFiller = bot.inventory.items()
      .filter(item => SOLID_FILLER_BLOCKS.includes(item.name))
      .reduce((sum, item) => sum + item.count, 0);
      
    if (currentSolidFiller < 32) {
      const neededFiller = 32 - currentSolidFiller;
      const chestItems = chest.containerItems();
      const fillerInChest = chestItems.filter(item => item && SOLID_FILLER_BLOCKS.includes(item.name));
      let withdrawnCount = 0;
      for (const item of fillerInChest) {
        if (withdrawnCount >= neededFiller) break;
        try {
          const amount = Math.min(item.count, neededFiller - withdrawnCount);
          console.log(`[Miner] Retirando ${amount} de ${item.name} para mantener medio stack de piedra.`);
          await chest.withdraw(item.type, null, amount);
          withdrawnCount += amount;
          await new Promise(r => setTimeout(r, 250));
        } catch (err) {
          console.log(`[Miner] Error al retirar piedra del cofre: ${err.message}`);
        }
      }
    }
    
    chest.close();
    if (depositedAny) {
      sendOwnerMsg('[Miner] Ores depositados con éxito.', force);
    } else {
      sendOwnerMsg('[Miner] No había ores para depositar o se conservó la piedra.', force);
    }
  } catch (err) {
    sendOwnerMsg(`[Miner] Error al interactuar con el cofre de ores: ${err.message}`, force);
  }
}

async function restockPickaxes(force = false) {
  if (!picotasChest) {
    sendOwnerMsg('[Miner] Cofre de picotas no configurado.', force);
    return;
  }
  
  let currentPickaxes = getPickaxesCount();
  const needed = Math.max(0, 3 - currentPickaxes);
  const excessPickaxes = Math.max(0, currentPickaxes - 3);
  
  const currentTorches = getTorchesCount();
  const torchesNeeded = Math.max(0, 64 - currentTorches);
  const excessTorches = Math.max(0, currentTorches - 64);

  const currentCarrots = bot.inventory.items().filter(item => item.name === 'carrot').reduce((sum, item) => sum + item.count, 0);
  const carrotsNeeded = Math.max(0, 32 - currentCarrots);
  const excessCarrots = Math.max(0, currentCarrots - 64);
  
  if (needed <= 0 && torchesNeeded <= 0 && excessPickaxes <= 0 && excessTorches <= 0 && carrotsNeeded <= 0 && excessCarrots <= 0) {
    return;
  }
  
  sendOwnerMsg(`[Miner] Yendo al cofre de picotas en ${picotasChest} para reabastecer/organizar...`, force);
  
  const isInsideTunnel = miningState.startPos && isMiningActive;
  if (isInsideTunnel) {
    const dirVec = directionVectors[miningState.mainDirection];
    const nodePos = miningState.startPos.plus(dirVec.scaled(miningState.currentNodeIndex * 3));
    let currentPos = bot.entity.position.floored();
    if (miningState.currentBranchSide !== 'none') {
      await walkTunnel(currentPos, nodePos);
    }
    await walkTunnel(nodePos, miningState.startPos);
  }
  
  const reached = await goToChest(picotasChest, 2);
  if (!reached) {
    sendOwnerMsg(`[Miner] No pude llegar al cofre de picotas en ${picotasChest}.`, force);
    return;
  }
  
  const chestBlock = bot.blockAt(picotasChest);
  if (!chestBlock || !chestBlock.name.includes('chest')) {
    sendOwnerMsg(`[Miner] El bloque en ${picotasChest} no es un cofre o no está cargado.`, force);
    return;
  }
  
  try {
    const chest = await bot.openChest(chestBlock);
    const chestItems = chest.containerItems();
    
    let pickaxesWithdrawn = 0;
    let torchesWithdrawn = 0;
    let pickaxesDeposited = 0;
    let torchesDeposited = 0;
    
    // Deposit excess first to free up slots if any
    if (excessPickaxes > 0) {
      const pickaxesInInv = bot.inventory.items().filter(item => item.name.includes('pickaxe'));
      let excess = excessPickaxes;
      for (const item of pickaxesInInv) {
        if (excess <= 0) break;
        try {
          const amount = Math.min(item.count, excess);
          console.log(`[Miner] Depositando exceso de picotas: ${amount} de ${item.name}`);
          await chest.deposit(item.type, null, amount);
          pickaxesDeposited += amount;
          excess -= amount;
          await new Promise(r => setTimeout(r, 250));
        } catch (err) {
          console.log(`[Miner] Error al depositar exceso de picota: ${err.message}`);
        }
      }
    }
    
    if (excessTorches > 0) {
      const torchesInInv = bot.inventory.items().filter(item => item.name === 'torch');
      let excess = excessTorches;
      for (const item of torchesInInv) {
        if (excess <= 0) break;
        try {
          const amount = Math.min(item.count, excess);
          console.log(`[Miner] Depositando exceso de antorchas: ${amount} de ${item.name}`);
          await chest.deposit(item.type, null, amount);
          torchesDeposited += amount;
          excess -= amount;
          await new Promise(r => setTimeout(r, 250));
        } catch (err) {
          console.log(`[Miner] Error al depositar exceso de antorchas: ${err.message}`);
        }
      }
    }

    if (excessCarrots > 0) {
      const carrotsInInv = bot.inventory.items().filter(item => item.name === 'carrot');
      let excess = excessCarrots;
      for (const item of carrotsInInv) {
        if (excess <= 0) break;
        try {
          const amount = Math.min(item.count, excess);
          console.log(`[Miner] Depositando exceso de zanahorias: ${amount} de ${item.name}`);
          await chest.deposit(item.type, null, amount);
          excess -= amount;
          await new Promise(r => setTimeout(r, 250));
        } catch (err) {
          console.log(`[Miner] Error al depositar exceso de zanahorias: ${err.message}`);
        }
      }
    }
    
    // Refresh container items after depositing
    const updatedChestItems = chest.containerItems();
    
    if (needed > 0) {
      const pickaxesInChest = updatedChestItems.filter(item => item && item.name.includes('pickaxe'));
      for (const item of pickaxesInChest) {
        if (pickaxesWithdrawn >= needed) break;
        try {
          console.log(`[Miner] Sacando picota: ${item.name}`);
          await chest.withdraw(item.type, null, 1);
          pickaxesWithdrawn++;
          await new Promise(r => setTimeout(r, 250));
        } catch (err) {
          console.log(`[Miner] Error al retirar picota: ${err.message}`);
        }
      }
    }
    
    if (torchesNeeded > 0) {
      const torchesInChest = updatedChestItems.filter(item => item && item.name === 'torch');
      let torchesToWithdraw = torchesNeeded;
      for (const item of torchesInChest) {
        if (torchesToWithdraw <= 0) break;
        try {
          const amount = Math.min(item.count, torchesToWithdraw);
          console.log(`[Miner] Sacando antorchas: ${amount} de ${item.name}`);
          await chest.withdraw(item.type, null, amount);
          torchesWithdrawn += amount;
          torchesToWithdraw -= amount;
          await new Promise(r => setTimeout(r, 250));
        } catch (err) {
          console.log(`[Miner] Error al retirar antorchas: ${err.message}`);
        }
      }
    }
    
    if (carrotsNeeded > 0) {
      const carrotsInChest = updatedChestItems.filter(item => item && item.name === 'carrot');
      let carrotsToWithdraw = carrotsNeeded;
      for (const item of carrotsInChest) {
        if (carrotsToWithdraw <= 0) break;
        try {
          const amount = Math.min(item.count, carrotsToWithdraw);
          console.log(`[Miner] Sacando zanahorias: ${amount} de ${item.name}`);
          await chest.withdraw(item.type, null, amount);
          carrotsToWithdraw -= amount;
          await new Promise(r => setTimeout(r, 250));
        } catch (err) {
          console.log(`[Miner] Error al retirar zanahorias: ${err.message}`);
        }
      }
    }
    
    // Si tenemos menos de 32 bloques de piedra sólida, intentar retirar del cofre de picotas
    let currentSolidFiller = bot.inventory.items()
      .filter(item => SOLID_FILLER_BLOCKS.includes(item.name))
      .reduce((sum, item) => sum + item.count, 0);
      
    if (currentSolidFiller < 32) {
      const neededFiller = 32 - currentSolidFiller;
      const chestItems = chest.containerItems();
      const fillerInChest = chestItems.filter(item => item && SOLID_FILLER_BLOCKS.includes(item.name));
      let withdrawnCount = 0;
      for (const item of fillerInChest) {
        if (withdrawnCount >= neededFiller) break;
        try {
          const amount = Math.min(item.count, neededFiller - withdrawnCount);
          console.log(`[Miner] Retirando ${amount} de ${item.name} de cofre de picotas para mantener medio stack de piedra.`);
          await chest.withdraw(item.type, null, amount);
          withdrawnCount += amount;
          await new Promise(r => setTimeout(r, 250));
        } catch (err) {
          console.log(`[Miner] Error al retirar piedra del cofre de picotas: ${err.message}`);
        }
      }
    }
    
    chest.close();
    
    let restockedMsg = '[Miner] ';
    if (pickaxesWithdrawn > 0) restockedMsg += `Se retiraron ${pickaxesWithdrawn} picotas. `;
    if (torchesWithdrawn > 0) restockedMsg += `Se retiraron ${torchesWithdrawn} antorchas. `;
    if (pickaxesDeposited > 0) restockedMsg += `Se depositaron ${pickaxesDeposited} picotas en exceso. `;
    if (torchesDeposited > 0) restockedMsg += `Se depositaron ${torchesDeposited} antorchas en exceso. `;
    const finalCarrots = bot.inventory.items().filter(item => item.name === 'carrot').reduce((sum, item) => sum + item.count, 0);
    restockedMsg += `Zanahorias en inventario: ${finalCarrots}. `;
    if (pickaxesWithdrawn === 0 && torchesWithdrawn === 0 && pickaxesDeposited === 0 && torchesDeposited === 0 && carrotsNeeded === 0) {
      restockedMsg += '¡No había repuestos en el cofre ni excesos para depositar!';
    }
    sendOwnerMsg(restockedMsg, force);
  } catch (err) {
    sendOwnerMsg(`[Miner] Error al interactuar con el cofre de picotas: ${err.message}`, force);
  }

  // If we still have 0 torches or 0 pickaxes, stop and wait at startPos
  if (getTorchesCount() === 0 || getPickaxesCount() === 0) {
    const missing = [];
    if (getTorchesCount() === 0) missing.push('antorchas');
    if (getPickaxesCount() === 0) missing.push('picotas');
    sendOwnerMsg(`[Miner] Sin ${missing.join(' ni ')} disponibles. Me quedo en el punto de inicio y pauso minería.`, true);
    isMiningActive = false;
    miningState.isMining = false;
    saveBotConfig();
    await goToChest(miningState.startPos, 1.5);
  }
}

async function manualWalk(targetPos, timeoutMs = 5000) {
  console.log(`[Miner] Intentando caminata manual a ${targetPos}...`);
  const start = Date.now();
  bot.pathfinder.setGoal(null);
  
  // Look at target
  await bot.lookAt(targetPos.offset(0.5, 0.5, 0.5));
  bot.setControlState('forward', true);
  
  let lastPos = bot.entity.position.clone();
  let lastMoveTime = Date.now();
  let backedUp = false;
  
  return new Promise((resolve) => {
    const interval = setInterval(async () => {
      if (!bot || !bot.entity) {
        clearInterval(interval);
        resolve(false);
        return;
      }
      
      const currentPos = bot.entity.position;
      const dist = currentPos.distanceTo(targetPos.offset(0.5, 0.5, 0.5));
      
      if (dist <= 0.8) {
        clearInterval(interval);
        bot.setControlState('forward', false);
        bot.setControlState('back', false);
        console.log(`[Miner] Caminata manual completada (distancia: ${dist.toFixed(2)}m)`);
        resolve(true);
        return;
      }
      
      if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        bot.setControlState('forward', false);
        bot.setControlState('back', false);
        console.log(`[Miner] Tiempo de espera agotado en caminata manual (distancia: ${dist.toFixed(2)}m)`);
        resolve(false);
        return;
      }
      
      // Stuck check (moved < 0.1m in 800ms)
      const movedDist = currentPos.distanceTo(lastPos);
      if (movedDist > 0.1) {
        lastPos = currentPos.clone();
        lastMoveTime = Date.now();
      } else if (Date.now() - lastMoveTime > 800 && !backedUp) {
        backedUp = true;
        console.log(`[Miner] Atascado en caminata manual. Intentando retroceder, limpiar bloques y atacar entidades en ${targetPos}...`);
        bot.setControlState('forward', false);
        bot.setControlState('back', true);
        
        setTimeout(async () => {
          if (!bot) return;
          bot.setControlState('back', false);
          
          // Re-dig target blocks
          const feetBlock = bot.blockAt(targetPos);
          const headBlock = bot.blockAt(targetPos.offset(0, 1, 0));
          if (feetBlock && feetBlock.name !== 'air') {
            await digBlock(feetBlock);
          }
          if (headBlock && headBlock.name !== 'air') {
            await digBlock(headBlock);
          }
          
          // Attack any blocking entity
          try {
            const entity = bot.nearestEntity(e => e.position.distanceTo(bot.entity.position) < 3 && e.type !== 'player');
            if (entity) {
              console.log(`[Miner] Atacando entidad cercana para abrir paso: ${entity.name}`);
              await bot.attack(entity);
            }
          } catch (err) {
            console.log(`[Miner] Error al atacar entidad: ${err.message}`);
          }
          
          // Resume forward movement
          try {
            await bot.lookAt(targetPos.offset(0.5, 0.5, 0.5));
            bot.setControlState('forward', true);
          } catch (err) {}
          
          lastPos = bot.entity.position.clone();
          lastMoveTime = Date.now();
          backedUp = false;
        }, 400);
      }
      
      if (!backedUp) {
        bot.lookAt(targetPos.offset(0.5, 0.5, 0.5)).catch(() => {});
      }
    }, 100);
  });
}

async function gotoBlockWithTimeout(pos, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let completed = false;
    const timer = setTimeout(() => {
      if (!completed) {
        completed = true;
        bot.pathfinder.setGoal(null);
        console.log(`[Miner] Tiempo de espera agotado navegando al bloque ${pos}`);
        resolve(false);
      }
    }, timeoutMs);

    bot.pathfinder.goto(new goals.GoalGetToBlock(pos.x, pos.y, pos.z))
      .then(() => {
        if (!completed) {
          completed = true;
          clearTimeout(timer);
          resolve(true);
        }
      })
      .catch((err) => {
        if (!completed) {
          completed = true;
          clearTimeout(timer);
          console.log(`[Miner] Error navegando al bloque ${pos}: ${err.message}`);
          resolve(false);
        }
      });
  });
}

async function walkTunnel(fromPos, toPos) {
  console.log(`[Miner] Caminando manualmente por túnel de ${fromPos} a ${toPos}`);
  
  const diff = toPos.minus(fromPos);
  const dx = Math.sign(diff.x);
  const dz = Math.sign(diff.z);
  
  let current = fromPos.clone();
  
  while (!current.equals(toPos)) {
    let movedX = false;
    let movedZ = false;
    if (current.x !== toPos.x) {
      current.x += dx;
      movedX = true;
    } else if (current.z !== toPos.z) {
      current.z += dz;
      movedZ = true;
    }

    // Align bot to center of the block perpendicular to movement to avoid collision with corners/walls
    // (Disabled to prevent client-server position desynchronization)
    
    const feetBlock = bot.blockAt(current);
    const headBlock = bot.blockAt(current.offset(0, 1, 0));
    
    if (isPhysical(feetBlock) || isPhysical(headBlock)) {
      console.log(`[Miner] Encontrado obstáculo al caminar en ${current}. Minando...`);
      if (isPhysical(feetBlock)) await digBlock(feetBlock);
      if (isPhysical(headBlock)) await digBlock(headBlock);
    }
    
    const floorBlock = bot.blockAt(current.offset(0, -1, 0));
    if (!floorBlock || floorBlock.name === 'air' || floorBlock.name.includes('water') || floorBlock.name.includes('lava')) {
      console.log(`[Miner] Encontrado vacío o líquido en el suelo en ${current.offset(0, -1, 0)}. Rellenando...`);
      await placeBlockAt(current.offset(0, -1, 0));
    }
    
    bot.pathfinder.setGoal(null);
    const mcData = context.getMcData();
    const movements = new Movements(bot, mcData);
    movements.canDig = false;
    movements.allowDiagonal = false;
    movements.getMoveDiagonal = function (node, dir, neighbors) {};
    bot.pathfinder.setMovements(movements);
    
    await gotoBlockWithTimeout(current, 8000);

    let distance = bot.entity.position.distanceTo(current.offset(0.5, 0, 0.5));
    if (distance > 1.2) {
      console.log(`[Miner] Desincronización en walkTunnel al bloque ${current} (distancia: ${distance.toFixed(2)}m). Reintentando...`);
      await new Promise(r => setTimeout(r, 500));
      await gotoBlockWithTimeout(current, 8000);
      
      distance = bot.entity.position.distanceTo(current.offset(0.5, 0, 0.5));
      if (distance > 1.2) {
        console.log(`[Miner] Pathfinder falló en walkTunnel. Intentando caminata manual...`);
        const walkedManually = await manualWalk(current);
        if (!walkedManually) {
          console.log(`[Miner] No se pudo caminar al bloque ${current}. Deteniendo avance.`);
          return false;
        }
      }
    }
  }
  return true;
}


async function mineStep(nextPos, dirVec, sideDirA, sideDirB) {
  const pickaxes = getPickaxesCount();
  const torches = getTorchesCount();
  if (pickaxes <= 1 || torches <= 2) {
    sendOwnerMsg(`[Miner] ¡Bajos recursos! (Picotas: ${pickaxes}, Antorchas: ${torches}). Yendo al cofre a reabastecer...`);
    await restockPickaxes();
    if (getPickaxesCount() <= 1) {
      sendOwnerMsg('[Miner] No pude conseguir suficientes picotas del cofre. Minado pausado.');
      isMiningActive = false;
      miningState.isMining = false;
      saveBotConfig();
      return false;
    }
  }
  
  await equipBestPickaxe();
  
  // Clear path to nextPos by checking both nextPos and the step before it (in case gravel fell behind)
  const prevPos = nextPos.minus(dirVec);
  const prevFeet = bot.blockAt(prevPos);
  const prevHead = bot.blockAt(prevPos.offset(0, 1, 0));
  if (isPhysical(prevFeet)) {
    console.log(`[Miner] Despejando obstáculo imprevisto en pies de paso previo ${prevPos}: ${prevFeet.name}`);
    await digBlock(prevFeet);
  }
  if (isPhysical(prevHead)) {
    console.log(`[Miner] Despejando obstáculo imprevisto en cabeza de paso previo ${prevPos.offset(0, 1, 0)}: ${prevHead.name}`);
    await digBlock(prevHead);
  }

  const feetBlock = bot.blockAt(nextPos);
  const headBlock = bot.blockAt(nextPos.offset(0, 1, 0));
  
  if (isPhysical(feetBlock)) {
    await digBlock(feetBlock);
  }
  
  if (isPhysical(headBlock)) {
    await digBlock(headBlock);
  }
  
  await checkAndPlugLiquids(nextPos, dirVec, sideDirA, sideDirB);
  
  const floorPos = nextPos.offset(0, -1, 0);
  const floorBlock = bot.blockAt(floorPos);
  if (!floorBlock || floorBlock.name === 'air' || floorBlock.name.includes('water') || floorBlock.name.includes('lava')) {
    console.log(`[Miner] Suelo no sólido en ${floorPos}. Colocando puente.`);
    await placeBlockAt(floorPos);
  }
  
  bot.pathfinder.setGoal(null);
  const mcData = context.getMcData();
  const movements = new Movements(bot, mcData);
  movements.canDig = false;
  movements.allowDiagonal = false;
  movements.getMoveDiagonal = function (node, dir, neighbors) {};
  bot.pathfinder.setMovements(movements);
  
  await gotoBlockWithTimeout(nextPos, 8000);

  let distance = bot.entity.position.distanceTo(nextPos.offset(0.5, 0, 0.5));
  if (distance > 1.2) {
    console.log(`[Miner] No se alcanzó físicamente ${nextPos} (distancia: ${distance.toFixed(2)}m). Reintentando...`);
    const feetBlock = bot.blockAt(nextPos);
    const headBlock = bot.blockAt(nextPos.offset(0, 1, 0));
    if (isPhysical(feetBlock)) await digBlock(feetBlock);
    if (isPhysical(headBlock)) await digBlock(headBlock);
    
    await gotoBlockWithTimeout(nextPos, 8000);
    
    distance = bot.entity.position.distanceTo(nextPos.offset(0.5, 0, 0.5));
    if (distance > 1.2) {
      console.log(`[Miner] Pathfinder falló en mineStep. Intentando caminata manual...`);
      const walkedManually = await manualWalk(nextPos);
      if (!walkedManually) {
        console.log(`[Miner] Falló segundo intento de avance. Posición real: ${bot.entity.position.floored()}. Pausando minería.`);
        return false;
      }
    }
  }
  
  await checkAndHarvestOres(nextPos, dirVec, sideDirA, sideDirB);
  await manageInventory();
  
  return true;
}

async function returnToTunnelNode(nodePos) {
  sendOwnerMsg(`[Miner] Regresando al frente de minado en ${nodePos}...`);
  const reachedStart = await goToChest(miningState.startPos, 1.5);
  if (!reachedStart) {
    sendOwnerMsg(`[Miner] Advertencia: No pude navegar automáticamente al inicio del túnel ${miningState.startPos}. Intentaré forzar.`);
  }
  await walkTunnel(miningState.startPos, nodePos);
}

async function recoverFromFall() {
  if (!miningState.startPos) return;
  const targetY = miningState.startPos.y;
  
  let currentPos = bot.entity.position.floored();
  if (currentPos.y >= targetY) return;
  
  console.log(`[Miner Recovery] El bot ha caído a Y = ${currentPos.y} (esperado: >= ${targetY}). Iniciando recuperación...`);
  sendOwnerMsg(`[Miner] He caído a nivel Y = ${currentPos.y}. Intentando subir al nivel de minado Y = ${targetY}...`);
  
  // Disable pathfinder while recovering
  bot.pathfinder.setGoal(null);
  
  let attempts = 0;
  while (bot.entity.position.y < targetY - 0.1 && attempts < 10) {
    attempts++;
    const botPos = bot.entity.position.clone();
    const feetPos = botPos.floored();
    
    // Check if there is a block in the head/above head space that would block jumping
    const headBlock = bot.blockAt(feetPos.offset(0, 2, 0));
    if (headBlock && headBlock.name !== 'air' && headBlock.boundingBox !== 'empty') {
      console.log(`[Miner Recovery] Excavando techo en ${headBlock.position} para poder saltar.`);
      await digBlock(headBlock);
    }
    
    // Equip filler block
    let filler = bot.inventory.items().find(item => SOLID_FILLER_BLOCKS.includes(item.name));
    if (!filler) {
      filler = bot.inventory.items().find(item => FILLER_BLOCKS.includes(item.name));
    }
    if (!filler) {
      sendOwnerMsg('[Miner] ¡No tengo bloques de relleno en inventario para recuperarme de la caída! Por favor, colócame bloques o sácame.');
      break;
    }
    
    // Jump and place block underneath feetPos
    bot.setControlState('jump', true);
    await new Promise(r => setTimeout(r, 300));
    bot.setControlState('jump', false);
    
    // Place block under feet
    await placeBlockAt(feetPos);
    
    // Wait for physics to settle
    await new Promise(r => setTimeout(r, 500));
    
    const newPos = bot.entity.position.floored();
    console.log(`[Miner Recovery] Intento ${attempts}: Posición actual Y = ${newPos.y}`);
    if (newPos.y > feetPos.y) {
      console.log(`[Miner Recovery] Subida exitosa a Y = ${newPos.y}`);
    } else {
      console.log(`[Miner Recovery] Fallo al subir en el intento ${attempts}. Reintentando...`);
    }
  }
  
  const finalPos = bot.entity.position.floored();
  if (finalPos.y >= targetY) {
    sendOwnerMsg(`[Miner] Recuperación exitosa. Volví al nivel de minado Y = ${finalPos.y}.`);
  } else {
    sendOwnerMsg(`[Miner] No pude regresar al nivel de minado automáticamente (Y actual = ${finalPos.y}). Minería pausada.`);
    isMiningActive = false;
    miningState.isMining = false;
    saveBotConfig();
  }
}

async function startMiningLoop() {
  if (miningLoopRunning) return;
  miningLoopRunning = true;
  isMiningActive = true;
  
  try {
    while (isMiningActive && miningState.isMining) {
      if (bot.isSleeping || bot.isGoingToSleep || bot.isYielding) {
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      
      // Fall recovery check
      if (miningState.startPos && bot.entity.position.y < miningState.startPos.y - 0.5) {
        await recoverFromFall();
        if (!isMiningActive || !miningState.isMining) {
          break;
        }
      }
      
      const dirVec = directionVectors[miningState.mainDirection];
      const leftDirName = perpendicularLeft(miningState.mainDirection);
      const rightDirName = perpendicularRight(miningState.mainDirection);
      const leftDir = directionVectors[leftDirName];
      const rightDir = directionVectors[rightDirName];
      
      const nodePos = miningState.startPos.plus(dirVec.scaled(miningState.currentNodeIndex * 3));
      
      if (miningState.currentBranchSide === 'none') {
        if (miningState.mainTunnelProgress < 3) {
          const nextPos = nodePos.plus(dirVec.scaled(miningState.mainTunnelProgress + 1));
          sendOwnerMsg(`[Miner] Avanzando túnel principal: paso ${miningState.mainTunnelProgress + 1}/3 hacia ${nextPos}`);
          const success = await mineStep(nextPos, dirVec, leftDir, rightDir);
          if (!success) {
            console.log('[Miner] mineStep falló en túnel principal. Pausando.');
            break;
          }
          miningState.mainTunnelProgress++;
          saveBotConfig();
        } else {
          miningState.currentBranchSide = 'left';
          miningState.branchProgress = 0;
          saveBotConfig();
        }
      } else if (miningState.currentBranchSide === 'left') {
        const branchLength = miningState.branchLength || 20;
        if (miningState.branchProgress < branchLength) {
          const nextPos = nodePos.plus(leftDir.scaled(miningState.branchProgress + 1));
          sendOwnerMsg(`[Miner] Cavando rama izquierda: paso ${miningState.branchProgress + 1}/${branchLength} hacia ${nextPos}`);
          const success = await mineStep(nextPos, leftDir, dirVec, dirVec.scaled(-1));
          if (!success) {
            console.log('[Miner] mineStep falló en rama izquierda. Pausando.');
            break;
          }
          miningState.branchProgress++;
          saveBotConfig();

          if (miningState.branchProgress === branchLength) {
            await placeTorchAt(nextPos);
          }
        } else {
          sendOwnerMsg('[Miner] Rama izquierda terminada. Regresando al nodo para iniciar la derecha...');
          const endBranchPos = nodePos.plus(leftDir.scaled(branchLength));
          await walkTunnel(endBranchPos, nodePos);
          
          const startBranchPos = nodePos.plus(leftDir.scaled(1));
          await placeTorchAt(startBranchPos);
          
          miningState.currentBranchSide = 'right';
          miningState.branchProgress = 0;
          saveBotConfig();
        }
      } else if (miningState.currentBranchSide === 'right') {
        const branchLength = miningState.branchLength || 20;
        if (miningState.branchProgress < branchLength) {
          const nextPos = nodePos.plus(rightDir.scaled(miningState.branchProgress + 1));
          sendOwnerMsg(`[Miner] Cavando rama derecha: paso ${miningState.branchProgress + 1}/${branchLength} hacia ${nextPos}`);
          const success = await mineStep(nextPos, rightDir, dirVec, dirVec.scaled(-1));
          if (!success) {
            console.log('[Miner] mineStep falló en rama derecha. Pausando.');
            break;
          }
          miningState.branchProgress++;
          saveBotConfig();

          if (miningState.branchProgress === branchLength) {
            await placeTorchAt(nextPos);
          }
        } else {
          sendOwnerMsg('[Miner] Rama derecha terminada. Regresando a depositar ores...');
          const endBranchPos = nodePos.plus(rightDir.scaled(branchLength));
          await walkTunnel(endBranchPos, nodePos);
          
          const startBranchPos = nodePos.plus(rightDir.scaled(1));
          await placeTorchAt(startBranchPos);
          
          await depositOres();
          await restockPickaxes();
          await returnToTunnelNode(nodePos);
          
          miningState.currentNodeIndex++;
          miningState.currentBranchSide = 'none';
          miningState.mainTunnelProgress = 0;
          saveBotConfig();
        }
      }
      
      await new Promise(r => setTimeout(r, 400));
    }
  } catch (err) {
    console.error('[Miner Loop Error]', err);
    sendOwnerMsg(`[Miner] Error crítico en el ciclo de minado: ${err.message}`);
  } finally {
    miningLoopRunning = false;
  }
}

async function startMiningActive() {
  isMiningActive = true;
  
  const dirVec = directionVectors[miningState.mainDirection];
  const leftDirName = perpendicularLeft(miningState.mainDirection);
  const rightDirName = perpendicularRight(miningState.mainDirection);
  const leftDir = directionVectors[leftDirName];
  const rightDir = directionVectors[rightDirName];
  
  const nodePos = miningState.startPos.plus(dirVec.scaled(miningState.currentNodeIndex * 3));
  
  let targetPos;
  if (miningState.currentBranchSide === 'none') {
    targetPos = nodePos.plus(dirVec.scaled(miningState.mainTunnelProgress));
  } else if (miningState.currentBranchSide === 'left') {
    targetPos = nodePos.plus(leftDir.scaled(miningState.branchProgress));
  } else if (miningState.currentBranchSide === 'right') {
    targetPos = nodePos.plus(rightDir.scaled(miningState.branchProgress));
  }
  
  const reached = await verifyAndWalkToResumption(targetPos);
  if (!reached) {
    if (isMiningActive) {
      sendOwnerMsg(`[Miner] No pude alcanzar la posición de trabajo. Deteniendo.`);
      miningState.isMining = false;
      isMiningActive = false;
      saveBotConfig();
    }
    return;
  }
  
  sendOwnerMsg('[Miner] Posición de trabajo alcanzada. Comenzando ciclo...');
  startMiningLoop();
}

async function verifyAndWalkToResumption(targetPos) {
  sendOwnerMsg(`[Miner] Iniciando trayectoria de reanudación y verificación hacia ${targetPos}...`);
  
  const dirVec = directionVectors[miningState.mainDirection];
  const leftDirName = perpendicularLeft(miningState.mainDirection);
  const rightDirName = perpendicularRight(miningState.mainDirection);
  const leftDir = directionVectors[leftDirName];
  const rightDir = directionVectors[rightDirName];
  const branchLength = miningState.branchLength || 20;
  
  const reachedStart = await goToChest(miningState.startPos, 1.5);
  if (!reachedStart) {
    return false;
  }
  
  let currentPos = miningState.startPos.clone();
  
  for (let n = 0; n <= miningState.currentNodeIndex; n++) {
    const nodePos = miningState.startPos.plus(dirVec.scaled(n * 3));
    
    const walkedToNode = await walkTunnel(currentPos, nodePos);
    if (!walkedToNode) {
      sendOwnerMsg(`[Miner] No pude caminar por el túnel principal hasta el nodo ${n}.`);
      return false;
    }
    currentPos = nodePos.clone();
    
    const branches = [
      { name: 'izquierda', dir: leftDir, side: 'left' },
      { name: 'derecha', dir: rightDir, side: 'right' }
    ];
    
    for (const br of branches) {
      let shouldCheck = false;
      if (n < miningState.currentNodeIndex) {
        shouldCheck = true;
      } else if (n === miningState.currentNodeIndex) {
        if (miningState.currentBranchSide === 'right' && br.side === 'left') {
          shouldCheck = true;
        }
      }
      
      if (!shouldCheck) continue;
      
      const firstBlockPos = nodePos.plus(br.dir.scaled(1));
      const firstBlock = bot.blockAt(firstBlockPos);
      
      const hasTorchAtEntry = firstBlock && firstBlock.name.includes('torch');
      if (!hasTorchAtEntry) {
        sendOwnerMsg(`[Miner] Rama ${br.name} del nodo ${n} no tiene antorcha en la entrada. Verificando...`);
        
        const endPos = nodePos.plus(br.dir.scaled(branchLength));
        
        let isCorrectDepth = true;
        for (let step = 1; step <= branchLength; step++) {
          const checkPos = nodePos.plus(br.dir.scaled(step));
          const feetB = bot.blockAt(checkPos);
          const headB = bot.blockAt(checkPos.offset(0, 1, 0));
          if (isPhysical(feetB) || isPhysical(headB)) {
            isCorrectDepth = false;
            break;
          }
        }
        
        if (isCorrectDepth) {
          sendOwnerMsg(`[Miner] Rama ${br.name} del nodo ${n} tiene profundidad correcta (${branchLength}). Caminando al final...`);
          const walkedBranch = await walkTunnel(nodePos, endPos);
          if (walkedBranch) {
            const endBlock = bot.blockAt(endPos);
            const hasTorchAtEnd = endBlock && endBlock.name.includes('torch');
            if (!hasTorchAtEnd) {
              if (getTorchesCount() === 0) {
                sendOwnerMsg('[Miner] Sin antorchas. Yendo al cofre a reabastecer...');
                await restockPickaxes();
                if (!isMiningActive || !miningState.isMining) return false;
                const tempPos = bot.entity.position.floored();
                await walkTunnel(tempPos, endPos);
              }
              sendOwnerMsg(`[Miner] Colocando antorcha al final de la rama ${br.name} del nodo ${n}...`);
              await placeTorchAt(endPos);
            }
            
            await walkTunnel(endPos, nodePos);
            
            const firstBlock = bot.blockAt(firstBlockPos);
            const hasTorchAtEntryNow = firstBlock && firstBlock.name.includes('torch');
            if (!hasTorchAtEntryNow) {
              if (getTorchesCount() === 0) {
                sendOwnerMsg('[Miner] Sin antorchas. Yendo al cofre a reabastecer...');
                await restockPickaxes();
                if (!isMiningActive || !miningState.isMining) return false;
                const tempPos = bot.entity.position.floored();
                await walkTunnel(tempPos, nodePos);
              }
              sendOwnerMsg(`[Miner] Colocando antorcha en la entrada de la rama ${br.name} del nodo ${n}...`);
              await placeTorchAt(firstBlockPos);
            }
          } else {
            sendOwnerMsg(`[Miner] Error al caminar por la rama ${br.name} del nodo ${n}.`);
          }
        } else {
          sendOwnerMsg(`[Miner] Rama ${br.name} del nodo ${n} no tiene la profundidad correcta. Saltando.`);
        }
      }
    }
  }
  
  if (!currentPos.equals(targetPos)) {
    sendOwnerMsg(`[Miner] Caminando hacia la posición de reanudación activa: ${targetPos}...`);
    const walkedToTarget = await walkTunnel(currentPos, targetPos);
    if (!walkedToTarget) {
      return false;
    }
  }
  
  return true;
}

function configureMovements(movements) {
  movements.canDig = false;
  movements.allowSprinting = false;
  movements.allowParkour = true;
  movements.scafoldingBlocks = [];
  movements.allowDiagonal = false;
  movements.getMoveDiagonal = function (node, dir, neighbors) {};
}

function onChat(message, isWhisper = false) {
  const msg = message.toLowerCase().trim();
  const myName = bot.username.toLowerCase();

  let checkMsg = msg;
  const words = msg.split(/\s+/);
  if (words.length > 1) {
    const firstWord = words[0];
    if (firstWord === myName || firstWord === 'mineros' || firstWord === 'miners') {
      checkMsg = words.slice(1).join(' ');
    }
  }

  if (checkMsg === 'para' || checkMsg === 'detener') {
    miningState.isMining = false;
    isMiningActive = false;
    bot.pathfinder.setGoal(null);
    bot.stopDigging();
    saveBotConfig();
    sendOwnerMsg('[Miner] Modo minador detenido.', true);
  } else if (checkMsg === 'trabaja') {
    if (miningState.startPos && miningState.mainDirection) {
      if (miningState.isMining && miningLoopRunning) {
        sendOwnerMsg('[Miner] Ya estoy minando.', true);
        return;
      }
      miningState.isMining = true;
      saveBotConfig();
      sendOwnerMsg(`[Miner] Reanudando minería desde ${miningState.startPos} hacia el ${miningState.mainDirection}.`, true);
      startMiningActive();
    } else {
      sendOwnerMsg('[Miner] No hay una mina configurada. Usa "minar <x> <z> <dirección>" para configurarla e iniciar.', true);
    }
  } else if (checkMsg === 'guarda') {
    sendOwnerMsg('Iniciando depósito manual de minerales...', true);
    depositOres(true);
  } else if (checkMsg.startsWith('picotas ')) {
    const parts = message.trim().split(/\s+/);
    if (parts.length === 4) {
      const x = Math.floor(parseFloat(parts[1]));
      const y = Math.floor(parseFloat(parts[2]));
      const z = Math.floor(parseFloat(parts[3]));
      if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
        picotasChest = new Vec3(x, y, z);
        saveBotConfig();
        sendOwnerMsg(`Cofre de picotas registrado en ${picotasChest}`, true);
      } else {
        sendOwnerMsg('Coordenadas inválidas. Usa: picotas <x> <y> <z>', true);
      }
    } else {
      sendOwnerMsg('Formato incorrecto. Usa: picotas <x> <y> <z>', true);
    }
  } else if (checkMsg.startsWith('ores ')) {
    const parts = message.trim().split(/\s+/);
    if (parts.length === 4) {
      const x = Math.floor(parseFloat(parts[1]));
      const y = Math.floor(parseFloat(parts[2]));
      const z = Math.floor(parseFloat(parts[3]));
      if (!isNaN(x) && !isNaN(y) && !isNaN(z)) {
        oresChest = new Vec3(x, y, z);
        saveBotConfig();
        sendOwnerMsg(`Cofre de ores registrado en ${oresChest}`, true);
      } else {
        sendOwnerMsg('Coordenadas inválidas. Usa: ores <x> <y> <z>', true);
      }
    } else {
      sendOwnerMsg('Formato incorrecto. Usa: ores <x> <y> <z>', true);
    }
  } else if (checkMsg === 'reabastecer') {
    restockPickaxes(true);
  } else if (checkMsg === 'depositar') {
    depositOres(true);
  } else if (checkMsg === 'status' || checkMsg === 'info') {
    let statusMsg = `Estado: ${miningState.isMining ? 'Minando' : 'Libre'}. `;
    statusMsg += `Picotas: ${getPickaxesCount()}. `;
    statusMsg += `Cofre Picotas: ${picotasChest ? picotasChest : 'No configurado'}. `;
    statusMsg += `Cofre Ores: ${oresChest ? oresChest : 'No configurado'}. `;
    if (miningState.isMining) {
      statusMsg += `Inicio: ${miningState.startPos}. `;
      statusMsg += `Dirección: ${miningState.mainDirection}. `;
      statusMsg += `Nodo: ${miningState.currentNodeIndex}. `;
      statusMsg += `Rama: ${miningState.currentBranchSide} (Progreso: ${miningState.branchProgress}/${miningState.branchLength || 20}). `;
      if (miningState.currentBranchSide === 'none') {
        statusMsg += `Progreso Túnel Principal: ${miningState.mainTunnelProgress}/3. `;
      }
    }
    sendOwnerMsg(statusMsg, true);
  } else if (checkMsg.startsWith('minar ')) {
    const parts = message.trim().split(/\s+/);
    if (parts.length === 3 && parts[1].toLowerCase() === 'aqui') {
      const dir = parseDirection(parts[2]);
      if (!dir) {
        sendOwnerMsg('Dirección inválida. Usa: east, west, north, south (o este, oeste, norte, sur)', true);
        return;
      }
      if (miningState.isMining) {
        sendOwnerMsg('Ya estoy minando. Escribe "para" primero.', true);
        return;
      }
      
      const currentPos = bot.entity.position.floored();
      miningState.isMining = true;
      miningState.startPos = new Vec3(currentPos.x, -53, currentPos.z);
      miningState.mainDirection = dir;
      miningState.currentNodeIndex = 0;
      miningState.currentBranchSide = 'none';
      miningState.branchProgress = 0;
      miningState.mainTunnelProgress = 0;
      miningState.branchLength = 20;
      
      saveBotConfig();
      sendOwnerMsg(`[Miner] Iniciando minería desde aquí (${miningState.startPos}) hacia el ${dir}.`, true);
      startMiningActive();
      
    } else if (parts.length === 4) {
      const x = parseFloat(parts[1]);
      const z = parseFloat(parts[2]);
      const dirStr = parts[3];
      
      if (isNaN(x) || isNaN(z)) {
        sendOwnerMsg('Coordenadas inválidas. Usa: minar <x> <z> <dirección>', true);
        return;
      }
      const dir = parseDirection(dirStr);
      if (!dir) {
        sendOwnerMsg('Dirección inválida. Usa: east, west, north, south', true);
        return;
      }
      if (miningState.isMining) {
        sendOwnerMsg('Ya estoy minando. Escribe "para" primero.', true);
        return;
      }
      
      miningState.isMining = true;
      miningState.startPos = new Vec3(Math.floor(x), -53, Math.floor(z));
      miningState.mainDirection = dir;
      miningState.currentNodeIndex = 0;
      miningState.currentBranchSide = 'none';
      miningState.branchProgress = 0;
      miningState.mainTunnelProgress = 0;
      miningState.branchLength = 20;
      
      saveBotConfig();
      sendOwnerMsg(`[Miner] Configurado inicio de minería en ${miningState.startPos} hacia el ${dir}. Moviéndome allí...`, true);
      startMiningActive();
      
    } else if (parts.length === 5) {
      const x = parseFloat(parts[1]);
      const y = parseFloat(parts[2]);
      const z = parseFloat(parts[3]);
      const dirStr = parts[4];
      
      if (isNaN(x) || isNaN(y) || isNaN(z)) {
        sendOwnerMsg('Coordenadas inválidas. Usa: minar <x> <y> <z> <dirección>', true);
        return;
      }
      const dir = parseDirection(dirStr);
      if (!dir) {
        sendOwnerMsg('Dirección inválida. Usa: east, west, north, south', true);
        return;
      }
      if (miningState.isMining) {
        sendOwnerMsg('Ya estoy minando. Escribe "para" primero.', true);
        return;
      }
      
      miningState.isMining = true;
      miningState.startPos = new Vec3(Math.floor(x), Math.floor(y), Math.floor(z));
      miningState.mainDirection = dir;
      miningState.currentNodeIndex = 0;
      miningState.currentBranchSide = 'none';
      miningState.branchProgress = 0;
      miningState.mainTunnelProgress = 0;
      miningState.branchLength = 20;
      
      saveBotConfig();
      sendOwnerMsg(`[Miner] Configurado inicio de minería en ${miningState.startPos} hacia el ${dir}. Moviéndome allí...`, true);
      startMiningActive();
    } else {
      sendOwnerMsg('Formato incorrecto. Usa:\n- minar <x> <z> <dirección>\n- minar <x> <y> <z> <dirección>\n- minar aqui <dirección>', true);
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
