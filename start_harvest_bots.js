const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const bots = ['CosechadorBot', 'CosechadorBot1', 'CosechadorBot2'];

console.log('[Launcher] Starting the 3 harvester bots...');

bots.forEach(botName => {
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
});

// Keep the launcher process alive
setInterval(() => {}, 1000 * 60);
