const { Movements, goals } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');

let context = {};
let bot = null;
let isWorking = false;
let shouldBreed = false;
let bedPosition = null;
let loopTimeout = null;
let lastStatusLog = 0;

// Map animal names to their valid breeding foods
const ANIMAL_FOODS = {
  cow: ['wheat'],
  sheep: ['wheat'],
  pig: ['carrot', 'potato', 'beetroot'],
  chicken: ['wheat_seeds', 'pumpkin_seeds', 'melon_seeds', 'beetroot_seeds']
};

// Cooldown to avoid double-feeding the same animal immediately
const recentlyFed = new Map(); // animalId -> timestamp

function init(ctx) {
  context = ctx;
  bot = ctx.bot;
  loadBotConfig();
}

function onSpawn() {
  startBreederLoop();
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
    shouldBreed,
    bedPosition: bedPosition ? { x: bedPosition.x, y: bedPosition.y, z: bedPosition.z } : null
  });
}

function loadBotConfig() {
  try {
    shouldBreed = false;
    const config = context.getConfig();
    if (config.shouldBreed !== undefined) {
      shouldBreed = config.shouldBreed;
    }
    if (config.bedPosition) {
      bedPosition = new Vec3(config.bedPosition.x, config.bedPosition.y, config.bedPosition.z);
    }
    console.log(`[Breeder] Configuración cargada.`);
  } catch (err) {
    console.error(`[Breeder] Error al cargar configuración:`, err.message);
  }
}

function configureMovements(movements) {
  movements.canDig = false;
  movements.allowSprinting = false;
  movements.allowParkour = false;
  movements.scafoldingBlocks = [];
  movements.liquidCost = 10;
}

async function startBreederLoop() {
  if (isWorking) return;
  isWorking = true;

  let delay = 1000; // default check interval when idle or checking
  try {
    if (shouldBreed && !bot.isSleeping && !bot.isGoingToSleep && !bot.isYielding) {
      const performedAction = await breederCycle();
      if (performedAction) {
        delay = 400; // brief delay after feeding an animal before next one
      }
    }
  } catch (err) {
    console.error('[Breeder Loop Error]', err);
  } finally {
    isWorking = false;
    if (bot && bot.isSleeping) {
      delay = 5000;
    }
    loopTimeout = setTimeout(startBreederLoop, delay);
  }
}

async function breederCycle() {
  const now = Date.now();

  // 1. Clean up old entries in recentlyFed map (cooldown 15 seconds)
  for (const [id, time] of recentlyFed.entries()) {
    if (now - time > 15000) {
      recentlyFed.delete(id);
    }
  }

  // 2. Find nearby animals that we can breed (within 16 blocks for pathfinding)
  const nearbyAnimals = Object.values(bot.entities).filter(e => {
    if (e.type !== 'mob' && e.type !== 'animal') return false;
    if (!ANIMAL_FOODS[e.name]) return false;
    
    // Check distance (up to 16m for pathfinding)
    const dist = bot.entity.position.distanceTo(e.position);
    if (dist > 16.0) return false;

    // Check if it's a baby. In mineflayer, babies usually have a different height or metadata.
    // e.metadata[16] is age in many versions (negative means baby).
    const metadataAge = e.metadata ? e.metadata[16] : null;
    if (metadataAge !== null && typeof metadataAge === 'number' && metadataAge < 0) {
      return false; // skip baby
    }
    // Also, baby cows have height around 0.6-0.7, adult cows around 1.3-1.4
    if (e.name === 'cow' && e.height < 1.0) {
      return false; // skip baby cow
    }

    return true;
  });

  const wheatCount = bot.inventory.items().filter(item => item.name === 'wheat').reduce((sum, item) => sum + item.count, 0);
  if (Date.now() - lastStatusLog > 10000) {
    lastStatusLog = Date.now();
    console.log(`[Breeder Status] Trigo en inventario: ${wheatCount}, Animales cercanos detectados: ${nearbyAnimals.length}`);
  }

  if (nearbyAnimals.length === 0) {
    return false;
  }

  // 3. Find if we have breeding food for any of the nearby animals
  let targetAnimal = null;
  let foodItem = null;

  for (const animal of nearbyAnimals) {
    // Skip if fed recently
    if (recentlyFed.has(animal.id)) continue;

    const allowedFoods = ANIMAL_FOODS[animal.name];
    // Find food in inventory
    const foundFood = bot.inventory.items().find(item => allowedFoods.includes(item.name));
    if (foundFood) {
      targetAnimal = animal;
      foodItem = foundFood;
      break;
    }
  }

  if (!targetAnimal || !foodItem) {
    return false;
  }

  // 3.5 Move closer to the animal if it is too far (distance > 2.5 blocks)
  const initialDist = bot.entity.position.distanceTo(targetAnimal.position);
  if (initialDist > 2.5) {
    console.log(`[Breeder] Animal ${targetAnimal.name} (ID: ${targetAnimal.id}) está a ${initialDist.toFixed(1)}m. Acercándose...`);
    
    bot.pathfinder.setGoal(null);
    const movements = new Movements(bot, context.getMcData());
    configureMovements(movements);
    bot.pathfinder.setMovements(movements);
    
    const goal = new goals.GoalFollow(targetAnimal, 2.0);
    
    try {
      await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          bot.pathfinder.setGoal(null);
          console.log(`[Breeder] Tiempo de espera agotado al intentar acercarse a ${targetAnimal.name}`);
          resolve();
        }, 5000);

        bot.pathfinder.goto(goal)
          .then(() => {
            clearTimeout(timeout);
            resolve();
          })
          .catch((err) => {
            clearTimeout(timeout);
            console.log(`[Breeder] Navegación fallida: ${err.message}`);
            resolve();
          });
      });
    } catch (err) {
      // Ignore
    }

    // Check distance again after pathfinding
    const newDist = bot.entity.position.distanceTo(targetAnimal.position);
    if (newDist > 3.0) {
      console.log(`[Breeder] No se pudo acercar lo suficiente a ${targetAnimal.name} (distancia actual: ${newDist.toFixed(1)}m)`);
      return false; // try again in the next cycle
    }
  }

  console.log(`[Breeder] Intentando alimentar a ${targetAnimal.name} (ID: ${targetAnimal.id}) usando ${foodItem.name}`);

  // 4. Equip food item
  if (!bot.heldItem || bot.heldItem.name !== foodItem.name) {
    try {
      await bot.equip(foodItem, 'hand');
      // Wait a tick for equipment to settle
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (err) {
      console.log(`[Breeder] Error al equipar ${foodItem.name}: ${err.message}`);
      return false;
    }
  }

  // 5. Look at the animal's center (head/body height)
  try {
    const animalHeight = targetAnimal.height || 1.3;
    const targetLookPos = targetAnimal.position.offset(0, animalHeight * 0.6, 0);
    
    // Look at target and wait for look packet to be sent
    await bot.lookAt(targetLookPos, true);
    // Wait for the server to process the rotation before sending interaction packet
    await new Promise(resolve => setTimeout(resolve, 200));
  } catch (err) {
    console.log(`[Breeder] Error al mirar al animal: ${err.message}`);
  }

  // 6. swing arm and activate
  try {
    bot.swingArm('right');
    
    // Send InteractAt packet (mouse = 2)
    bot._client.write('use_entity', {
      target: targetAnimal.id,
      mouse: 2,
      x: 0,
      y: 0.5,
      z: 0,
      hand: 0,
      sneaking: false
    });

    // Send Interact packet (mouse = 0)
    bot._client.write('use_entity', {
      target: targetAnimal.id,
      mouse: 0,
      hand: 0,
      sneaking: false
    });
    
    // Mark as recently fed to avoid spamming the same animal
    recentlyFed.set(targetAnimal.id, now);
    console.log(`[Breeder] Alimentado con éxito a ${targetAnimal.name} (ID: ${targetAnimal.id})`);
    return true;
  } catch (err) {
    console.log(`[Breeder] Error al activar entidad: ${err.message}`);
    return false;
  }
}

function onChat(message, isWhisper = false) {
  let msg = message.toLowerCase().trim();
  const myName = bot.username.toLowerCase();

  const words = msg.split(/\s+/);
  if (words.length > 1) {
    const firstWord = words[0];
    if (firstWord === myName || firstWord === 'criadores' || firstWord === 'breeders') {
      msg = words.slice(1).join(' ');
    }
  }

  if (msg === 'trabaja' || msg === 'cria') {
    shouldBreed = true;
    saveBotConfig();
    sendOwnerMsg('Iniciando modo criador automático mejorado.', true);
  } else if (msg === 'para') {
    shouldBreed = false;
    saveBotConfig();
    bot.pathfinder.setGoal(null);
    sendOwnerMsg('Modo criador detenido.', true);
  }
}

module.exports = {
  init,
  onSpawn,
  onChat,
  onDeath,
  onEnd
};
