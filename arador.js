const { Movements, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const fs = require('fs');
const path = require('path');

let context = {};
let bot = null;
let isWorking = false;
let shouldStop = false;

// Matrix configuration: 53x53 grid
const ROWS = 53;  
const COLS = 53;  
const START_X = -582; 
const START_Z = 638;  

const farmMatrix = [];
const filePath = path.join(__dirname, 'farm_matrix.json');

// Mappings from matrix config crop type to Minecraft block name and seed item name
const CROP_BLOCK_NAMES = {
  'trigo': 'wheat',
  'papa': 'potatoes',
  'zanahoria': 'carrots'
};

const CROP_SEED_NAMES = {
  'trigo': 'wheat_seeds',
  'papa': 'potato',
  'zanahoria': 'carrot'
};

function getCropTypeForPosition(row, col) {
  const isCenterRow = (row === 4);

  if (col >= 0 && col <= 8) {
    if (isCenterRow && col === 4) return null;
    return 'trigo';
  }
  if (col >= 9 && col <= 10) return null;
  if (col >= 11 && col <= 19) {
    if (isCenterRow && col === 15) return null;
    return 'papa';
  }
  if (col >= 20 && col <= 21) return null;
  if (col >= 22 && col <= 30) {
    if (isCenterRow && col === 26) return null;
    return 'zanahoria';
  }
  if (col >= 31 && col <= 32) return null;
  if (col >= 33 && col <= 41) {
    if (isCenterRow && col === 37) return null;
    return 'trigo';
  }
  if (col >= 42 && col <= 43) return null;
  if (col >= 44 && col <= 52) {
    if (isCenterRow && col === 48) return null;
    return 'papa';
  }
  return null;
}

function initMatrix() {
  if (fs.existsSync(filePath)) {
    try {
      const data = fs.readFileSync(filePath, 'utf8');
      const loaded = JSON.parse(data);
      if (Array.isArray(loaded) && loaded.length === ROWS && loaded[0] && loaded[0].length === COLS) {
        console.log(`[Arador] Cargando matriz de cultivo existente desde farm_matrix.json...`);
        for (let r = 0; r < ROWS; r++) {
          farmMatrix[r] = loaded[r];
        }
        return;
      }
    } catch (err) {
      console.error(`[Arador] Error al cargar farm_matrix.json existente: ${err.message}. Recreando...`);
    }
  }

  for (let r = 0; r < ROWS; r++) {
    farmMatrix[r] = [];
    for (let c = 0; c < COLS; c++) {
      const x = START_X - r;
      const z = START_Z + c;
      const cropType = getCropTypeForPosition(r, c);
      farmMatrix[r][c] = { x, z, cropType };
    }
  }
  console.log(`[Arador] Matriz de cultivo 53x53 inicializada. Tamaño: ${farmMatrix.length}x${farmMatrix[0].length}`);
  
  try {
    fs.writeFileSync(filePath, JSON.stringify(farmMatrix, null, 2), 'utf8');
    console.log(`[Arador] Archivo farm_matrix.json actualizado.`);
  } catch (err) {
    console.error(`[Arador] Error al guardar farm_matrix.json:`, err.message);
  }
}

function init(ctx) {
  context = ctx;
  bot = ctx.bot;
  initMatrix();
  console.log('[Arador] Módulo inicializado con éxito.');
}

function onSpawn() {
  sendOwnerMsg('[Arador] Bot listo. Usa "trabaja" para recorrer y corregir el terreno.', true);
}

// Detect soil Y coordinate at a specific X, Z coordinate
function detectSoilYAt(x, z) {
  for (let y = 125; y >= 100; y--) {
    const block = bot.blockAt(new Vec3(x, y, z));
    if (!block) continue;
    
    const isSoil = block.name === 'farmland' || block.name === 'dirt' || block.name === 'grass_block' || block.name === 'coarse_dirt';
    const isCrop = block.name === 'wheat' || block.name === 'potatoes' || block.name === 'carrots' || block.name === 'potato' || block.name === 'carrot';
    
    if (isSoil) return y;
    if (isCrop) return y - 1;
  }
  return null;
}

// Scans the 9x9 crop quadrant to find consensus soil Y level
function detectQuadrantY(centerRow, centerCol) {
  const startR = centerRow - 4;
  const endR = centerRow + 4;
  const startC = centerCol - 4;
  const endC = centerCol + 4;
  
  const yCounts = {};
  for (let r = startR; r <= endR; r++) {
    for (let c = startC; c <= endC; c++) {
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
      const cell = farmMatrix[r][c];
      if (cell.cropType === null) continue; // Skip separations and water
      
      const detected = detectSoilYAt(cell.x, cell.z);
      if (detected !== null) {
        yCounts[detected] = (yCounts[detected] || 0) + 1;
      }
    }
  }
  
  let bestY = null;
  let maxCount = -1;
  for (const [yStr, count] of Object.entries(yCounts)) {
    const yVal = parseInt(yStr, 10);
    if (count > maxCount) {
      maxCount = count;
      bestY = yVal;
    }
  }
  return bestY;
}

// Correct block state (dig wrong crop, till soil, plant correct seed)
async function correctBlock(cell, soilY, cropY) {
  const soilPos = new Vec3(cell.x, soilY, cell.z);
  const cropPos = new Vec3(cell.x, cropY, cell.z);

  let soilBlock = bot.blockAt(soilPos);
  let cropBlock = bot.blockAt(cropPos);

  if (!soilBlock) return; // Chunk not loaded

  // Check reach distance (safety fallback)
  const distToBlock = bot.entity.position.distanceTo(soilPos);
  if (distToBlock > 4.5) {
    console.log(`[Arador] Bloque en ${soilPos} fuera de alcance (${distToBlock.toFixed(1)}m). Saltando.`);
    return;
  }

  // 1. Dig wrong crops/blocks on top if any
  const expectedCropBlock = CROP_BLOCK_NAMES[cell.cropType];
  const hasWrongCrop = cropBlock && cropBlock.name !== 'air' && !cropBlock.name.includes(expectedCropBlock);

  if (hasWrongCrop) {
    console.log(`[Arador] Removiendo bloque incorrecto (${cropBlock.name}) en ${cropPos}...`);
    bot.pathfinder.setGoal(null);
    await context.digBlock(cropBlock);
    await new Promise(r => setTimeout(r, 200));
    cropBlock = bot.blockAt(cropPos);
  }

  // 2. Ensure farmland
  if (soilBlock.name !== 'farmland') {
    const hoe = bot.inventory.items().find(i => i.name.endsWith('_hoe'));
    if (!hoe) {
      sendOwnerMsg(`[Arador] Error: Sin azadón (hoe) en inventario para labrar tierra en ${soilPos}.`, true);
      return;
    }
    
    try {
      console.log(`[Arador] Labrando tierra en ${soilPos} con ${hoe.name}...`);
      await bot.equip(hoe, 'hand');
      bot.pathfinder.setGoal(null);
      await bot.lookAt(soilPos.offset(0.5, 1.0, 0.5));
      await bot.activateBlock(soilBlock);
      await new Promise(r => setTimeout(r, 300));
      soilBlock = bot.blockAt(soilPos);
    } catch (err) {
      console.log(`[Arador] Error al labrar tierra: ${err.message}`);
    }
  }

  // 3. Replant seed
  if (soilBlock && soilBlock.name === 'farmland' && (!cropBlock || cropBlock.name === 'air')) {
    const seedName = CROP_SEED_NAMES[cell.cropType];
    const seedItem = bot.inventory.items().find(i => i.name === seedName);
    
    if (!seedItem) {
      sendOwnerMsg(`[Arador] Advertencia: Sin semillas de "${seedName}" en inventario para sembrar en ${cropPos}.`, true);
      return;
    }

    try {
      console.log(`[Arador] Sembrando ${seedName} en ${cropPos}...`);
      await bot.equip(seedItem, 'hand');
      bot.pathfinder.setGoal(null);
      await bot.lookAt(soilPos.offset(0.5, 1.0, 0.5));
      await bot.placeBlock(soilBlock, new Vec3(0, 1, 0));
      await new Promise(r => setTimeout(r, 250));
    } catch (err) {
      console.log(`[Arador] Error al colocar semilla: ${err.message}`);
    }
  }
}

function configureMovements(movements) {
  movements.canDig = false;
  movements.allowSprinting = false;
  movements.allowParkour = false;
  movements.scafoldingBlocks = [];
  movements.liquidCost = 100;
  
  const mcData = context.getMcData();
  if (mcData && mcData.blocksByName.water) {
    movements.blocksToAvoid.add(mcData.blocksByName.water.id);
  }
}

// Corrects a specific 5x5 sub-area of the quadrant
async function correctSubArea(centerRow, centerCol, subRowOffset, subColOffset, soilY, cropY) {
  if (shouldStop) return;

  const targetRow = centerRow + subRowOffset;
  const targetCol = centerCol + subColOffset;
  const targetCell = farmMatrix[targetRow][targetCol];

  const targetX = targetCell.x + 0.5;
  const targetZ = targetCell.z + 0.5;
  const targetPos = new Vec3(targetX, soilY + 1, targetZ);

  console.log(`[Arador] Moviendo a sub-cuadrante en X=${targetX}, Z=${targetZ}...`);
  const reached = await context.goToBase(targetPos, 0.5, 8000, configureMovements);
  if (!reached) {
    console.log(`[Arador] Advertencia: No pude llegar a la sub-posición row=${targetRow+1}, col=${targetCol+1}`);
  }

  // Determine the 5x5 area range to correct from this position
  const startR = subRowOffset < 0 ? centerRow - 4 : centerRow;
  const endR = subRowOffset < 0 ? centerRow : centerRow + 4;
  const startC = subColOffset < 0 ? centerCol - 4 : centerCol;
  const endC = subColOffset < 0 ? centerCol : centerCol + 4;

  for (let r = startR; r <= endR; r++) {
    for (let c = startC; c <= endC; c++) {
      if (shouldStop) return;
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;

      const cell = farmMatrix[r][c];
      if (cell.cropType === null) continue; // Skip separations or water centers

      const soilPos = new Vec3(cell.x, soilY, cell.z);
      const cropPos = new Vec3(cell.x, cropY, cell.z);

      const soilBlock = bot.blockAt(soilPos);
      const cropBlock = bot.blockAt(cropPos);

      if (!soilBlock) continue;

      const isFarmland = (soilBlock.name === 'farmland');
      const expectedCrop = CROP_BLOCK_NAMES[cell.cropType];
      const hasCorrectCrop = cropBlock && cropBlock.name.includes(expectedCrop);

      if (!isFarmland || !hasCorrectCrop) {
        await correctBlock(cell, soilY, cropY);
      }
    }
  }
}

function getFieldCenters() {
  const centers = [];
  for (let fr = 0; fr < 5; fr++) {
    // If row index is even (0, 2, 4), go left-to-right (increasing columns)
    // If row index is odd (1, 3), go right-to-left (decreasing columns)
    const isEvenRow = (fr % 2 === 0);
    for (let tempC = 0; tempC < 5; tempC++) {
      const fc = isEvenRow ? tempC : (4 - tempC);
      
      const r = fr * 11 + 4;
      const c = fc * 11 + 4;
      const target = farmMatrix[r][c];
      centers.push({ fRow: fr + 1, fCol: fc + 1, r, c, x: target.x, z: target.z });
    }
  }
  return centers;
}

async function runCorrection() {
  if (isWorking) {
    sendOwnerMsg('[Arador] El proceso de corrección ya está en marcha.', true);
    return;
  }
  isWorking = true;
  shouldStop = false;
  
  sendOwnerMsg('[Arador] Iniciando ciclo de corrección de cultivo en los 25 cuadrantes...', true);
  const centers = getFieldCenters();

  for (const center of centers) {
    if (shouldStop) break;

    sendOwnerMsg(`[Arador] Yendo al cuadrante (${center.fRow}, ${center.fCol}) en X=${center.x}, Z=${center.z} para corregir...`, true);

    // 1. Move to the first sub-position Top-Left (-2, -2) using current Y to load chunks
    const initialCell = farmMatrix[center.r - 2][center.c - 2];
    const initialX = initialCell.x + 0.5;
    const initialZ = initialCell.z + 0.5;
    const initialPos = new Vec3(initialX, bot.entity.position.y, initialZ);

    const initialReached = await context.goToBase(initialPos, 1.5, 12000, configureMovements);
    if (!initialReached) {
      console.log(`[Arador] Advertencia: No pude llegar cerca del sub-cuadrante inicial.`);
    }

    // 2. Detect consensus Y
    const consensusY = detectQuadrantY(center.r, center.c);
    const soilY = consensusY !== null ? consensusY : (Math.floor(bot.entity.position.y) - 1);
    const cropY = soilY + 1;

    console.log(`[Arador] Altura de suelo detectada para cuadrante: Y=${soilY}`);

    // 3. Visit and correct each sub-area (Top-Left, Top-Right, Bottom-Right, Bottom-Left)
    await correctSubArea(center.r, center.c, -2, -2, soilY, cropY);
    await correctSubArea(center.r, center.c, -2,  2, soilY, cropY);
    await correctSubArea(center.r, center.c,  2,  2, soilY, cropY);
    await correctSubArea(center.r, center.c,  2, -2, soilY, cropY);
    
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  isWorking = false;
  if (shouldStop) {
    sendOwnerMsg('[Arador] Proceso de corrección detenido manualmente.', true);
  } else {
    sendOwnerMsg('[Arador] ¡Ciclo de corrección completado en todo el terreno!', true);
  }
}

function onChat(message, isWhisper = false) {
  const msg = message.toLowerCase().trim();
  const parts = msg.split(/\s+/);
  
  if (parts[0] === 'mover' || parts[0] === 've') {
    const r = parseInt(parts[1]) - 1;
    const c = parseInt(parts[2]) - 1;
    
    if (!isNaN(r) && !isNaN(c) && r >= 0 && r < ROWS && c >= 0 && c < COLS) {
      const target = farmMatrix[r][c];
      const targetX = target.x + 0.5;
      const targetZ = target.z + 0.5;
      const targetY = bot.entity.position.y;
      const targetPos = new Vec3(targetX, targetY, targetZ);
      
      const currentPos = bot.entity.position;
      const dist2D = Math.sqrt(Math.pow(currentPos.x - targetX, 2) + Math.pow(currentPos.z - targetZ, 2));
      
      if (dist2D <= 0.4) {
        sendOwnerMsg(`[Arador] Ya me encuentro en la posición (${r + 1}, ${c + 1}) -> Centro: X=${targetX}, Z=${targetZ}`, true);
        return;
      }
      
      sendOwnerMsg(`[Arador] Navegando a la posición de la matriz (${r + 1}, ${c + 1}) -> Centro del bloque: X=${targetX}, Z=${targetZ}`, true);
      
      context.goToBase(targetPos, 0.2, 15000, configureMovements).then((reached) => {
        if (reached) {
          sendOwnerMsg(`[Arador] Llegué exitosamente al centro de la posición (${r + 1}, ${c + 1})`, true);
        } else {
          const currentPosEnd = bot.entity.position;
          const dist2DEnd = Math.sqrt(Math.pow(currentPosEnd.x - targetX, 2) + Math.pow(currentPosEnd.z - targetZ, 2));
          if (dist2DEnd <= 0.4) {
            sendOwnerMsg(`[Arador] Llegué exitosamente al centro de la posición (${r + 1}, ${c + 1}) (verificado por proximidad)`, true);
          } else {
            sendOwnerMsg(`[Arador] No pude llegar al centro de la posición (${r + 1}, ${c + 1})`, true);
          }
        }
      });
    } else {
      sendOwnerMsg(`[Arador] Índice fuera de límites. Ejemplo: mover 1 3`, true);
    }
  } else if (msg === 'trabaja' || msg === 'corregir') {
    runCorrection().catch(err => {
      sendOwnerMsg(`[Arador] Error en el proceso: ${err.message}`, true);
      isWorking = false;
    });
  } else if (msg === 'para' || msg === 'detener') {
    shouldStop = true;
    bot.pathfinder.setGoal(null);
    sendOwnerMsg('[Arador] Solicitando detención del proceso...', true);
  }
}

function onDeath() {
  isWorking = false;
  console.log('[Arador] Bot ha muerto.');
}

function onEnd() {
  isWorking = false;
  console.log('[Arador] Módulo finalizado.');
}

function sendOwnerMsg(msg, force = false) {
  context.sendOwnerMsg(msg, force);
}

module.exports = {
  init,
  onSpawn,
  onChat,
  onDeath,
  onEnd,
  farmMatrix
};
