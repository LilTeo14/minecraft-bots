const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const bots = ['TalaBot', 'CosechadorBot', 'CosechadorBot1', 'CosechadorBot2', 'CercadorBot'];

console.log('[Launcher] Starting the requested bots with 5-second stagger...');

async function spawnBots() {
  for (let i = 0; i < bots.length; i++) {
    const botName = bots[i];
    const logStream = fs.createWriteStream(path.join(__dirname, `bot_${botName}.log`), { flags: 'w' });
    const errStream = fs.createWriteStream(path.join(__dirname, `bot_${botName}_err.log`), { flags: 'w' });

    console.log(`[Launcher] Spawning bot: ${botName}`);
    const child = spawn('node', [path.join(__dirname, 'bot.js'), botName], {
      cwd: __dirname,
      env: process.env
    });

    child.stdout.on('data', (data) => {
      const str = data.toString();
      logStream.write(str);
      console.log(`[${botName}] ${str.trim()}`);
    });

    child.stderr.on('data', (data) => {
      const str = data.toString();
      errStream.write(str);
      console.error(`[${botName} ERROR] ${str.trim()}`);
    });

    child.on('close', (code) => {
      console.log(`[Launcher] Bot ${botName} exited with code ${code}`);
    });

    // Wait 5 seconds before spawning the next bot
    if (i < bots.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

spawnBots();

// Keep the launcher process alive
setInterval(() => {}, 1000 * 60);
