const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const PORT = 3000;
const CONFIG_PATH = path.join(__dirname, '..', 'bots', 'bots_config.json');
const MATRIX_PATH = path.join(__dirname, '..', 'bots', 'farm_matrix.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Track running processes: botName -> ChildProcess
const runningBots = {};


// Function to ensure all bots have a unique viewerPort assigned
function ensureViewerPorts(config) {
  let modified = false;
  let nextPort = 3010;
  
  // Find all currently used ports
  const usedPorts = new Set();
  for (const name in config) {
    if (name === 'sharedChests') continue;
    if (config[name].viewerPort) {
      usedPorts.add(parseInt(config[name].viewerPort));
    }
  }
  
  // Assign a port to any bot that doesn't have one
  for (const name in config) {
    if (name === 'sharedChests') continue;
    const botConf = config[name] || {};
    if (!botConf.viewerPort) {
      while (usedPorts.has(nextPort)) {
        nextPort++;
      }
      botConf.viewerPort = nextPort;
      config[name] = botConf;
      usedPorts.add(nextPort);
      modified = true;
    }
  }
  
  return modified;
}

// Helper to read configuration and ensure ports are assigned
function readConfig(callback) {
  fs.readFile(CONFIG_PATH, 'utf8', (err, data) => {
    if (err) return callback(err);
    try {
      const config = JSON.parse(data);
      const modified = ensureViewerPorts(config);
      if (modified) {
        fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8', (writeErr) => {
          if (writeErr) {
            console.error('[Dashboard Server] Error saving ports to bots_config.json:', writeErr);
          }
          callback(null, config);
        });
      } else {
        callback(null, config);
      }
    } catch (parseErr) {
      callback(parseErr);
    }
  });
}

// Run config check on server startup to migrate any existing bots
fs.readFile(CONFIG_PATH, 'utf8', (err, data) => {
  if (!err) {
    try {
      const config = JSON.parse(data);
      if (ensureViewerPorts(config)) {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
        console.log('[Dashboard Server] Auto-assigned viewer ports for bots.');
      }
    } catch (e) {}
  }
});

// Helper to serve static files
function serveStaticFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`500 Internal Server Error: ${err.code}`);
      }
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  });
}

// Start http server
const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  if (pathname === '/api/bots' && req.method === 'GET') {
    readConfig((err, config) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Config file not found or malformed.' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(config));
    });
  } 
  
  else if (pathname === '/api/bots' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    
    req.on('end', () => {
      try {
        const parsedData = JSON.parse(body);
        
        // Ensure viewer ports are assigned for any newly added bots
        ensureViewerPorts(parsedData);
        
        fs.writeFile(CONFIG_PATH, JSON.stringify(parsedData, null, 2), 'utf8', (err) => {
          if (err) {
            console.error('[Dashboard Server] Error saving bots_config.json:', err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: err.message }));
            return;
          }
          console.log('[Dashboard Server] bots_config.json updated successfully.');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        });
      } catch (err) {
        console.error('[Dashboard Server] Error parsing JSON body:', err);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Malformed JSON' }));
      }
    });
  }

  else if (pathname === '/api/bots/status' && req.method === 'GET') {
    fs.readFile(CONFIG_PATH, 'utf8', (err, data) => {
      let config = {};
      if (!err) {
        try { config = JSON.parse(data); } catch(e){}
      }
      
      const statuses = {};
      for (const name in config) {
        if (name === 'sharedChests') continue;
        const botConfig = config[name] || {};
        
        const isOnline = !!runningBots[name];
        if (!isOnline) {
          statuses[name] = 'offline';
          continue;
        }
        
        let isWorking = false;
        const type = botConfig.type;
        if (type === 'farmer') isWorking = !!botConfig.shouldFarm;
        else if (type === 'lumberjack') isWorking = !!botConfig.shouldChop;
        else if (type === 'miner') isWorking = botConfig.miningState && !!botConfig.miningState.isMining;
        else if (type === 'breeder') isWorking = !!botConfig.shouldBreed;
        else if (type === 'filler') isWorking = !!botConfig.shouldFill;
        else if (type === 'fencer') isWorking = !!botConfig.shouldFence;
        else if (type === 'arador') isWorking = !!botConfig.shouldArar;
        else if (type === 'afk') isWorking = !!botConfig.shouldAfk;
        
        statuses[name] = isWorking ? 'working' : 'online';
      }
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(statuses));
    });
  }

  else if (pathname === '/api/bots/command' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
      try {
        const { name, command } = JSON.parse(body);
        if (!name || !command) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Faltan parámetros' }));
          return;
        }

        const child = runningBots[name];
        if (child) {
          child.stdin.write(command + '\n');
        }

        fs.readFile(CONFIG_PATH, 'utf8', (err, data) => {
          let config = {};
          if (!err) {
            try { config = JSON.parse(data); } catch(e){}
          }

          if (!config[name]) {
            config[name] = {};
          }

          const type = config[name].type || '';
          const isStart = (command === 'trabaja');

          if (type === 'farmer') config[name].shouldFarm = isStart;
          else if (type === 'lumberjack') config[name].shouldChop = isStart;
          else if (type === 'miner') {
            if (!config[name].miningState) config[name].miningState = {};
            config[name].miningState.isMining = isStart;
          }
          else if (type === 'breeder') config[name].shouldBreed = isStart;
          else if (type === 'filler') config[name].shouldFill = isStart;
          else if (type === 'fencer') config[name].shouldFence = isStart;
          else if (type === 'arador') config[name].shouldArar = isStart;
          else if (type === 'afk') config[name].shouldAfk = isStart;

          fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8', (writeErr) => {
            if (writeErr) {
              console.error('[Dashboard Server] Error updating config in command:', writeErr);
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
          });
        });

      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  }

  else if (pathname === '/api/bots/start' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
      try {
        const { name } = JSON.parse(body);
        if (!name) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Falta el nombre del bot' }));
          return;
        }

        if (runningBots[name]) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: 'El bot ya está corriendo' }));
          return;
        }

        const projectRoot = path.join(__dirname, '..');
        const logsDir = path.join(projectRoot, 'bots', 'logs');
        if (!fs.existsSync(logsDir)) {
          fs.mkdirSync(logsDir, { recursive: true });
        }

        console.log(`[Dashboard Server] Iniciando bot: ${name}...`);

        // Spawn node bot.js <name>
        const child = spawn('node', ['bot.js', name], {
          cwd: path.join(projectRoot, 'bots'),
          stdio: 'pipe'
        });

        const logStream = fs.createWriteStream(path.join(logsDir, `bot_${name}.log`), { flags: 'a' });
        const errStream = fs.createWriteStream(path.join(logsDir, `bot_${name}_err.log`), { flags: 'a' });

        child.stdout.pipe(logStream);
        child.stderr.pipe(errStream);

        runningBots[name] = child;

        child.on('exit', (code) => {
          console.log(`[Dashboard Server] Bot "${name}" finalizó con código ${code}`);
          delete runningBots[name];
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  }

  else if (pathname === '/api/bots/stop' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
      try {
        const { name } = JSON.parse(body);
        if (!name) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Falta el nombre del bot' }));
          return;
        }

        const child = runningBots[name];
        if (child) {
          child.kill();
          delete runningBots[name];
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'El bot no está corriendo' }));
        }
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  }

  else if (pathname === '/api/bots/logs' && req.method === 'GET') {
    const name = parsedUrl.searchParams.get('name');
    if (!name) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Falta el nombre del bot' }));
      return;
    }

    const logPath = path.join(__dirname, '..', 'bots', 'logs', `bot_${name}.log`);
    fs.readFile(logPath, 'utf8', (err, data) => {
      if (err) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ logs: 'No hay logs aún.' }));
        return;
      }
      // Return last 100 lines
      const lines = data.split('\n');
      const lastLines = lines.slice(-100).join('\n');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ logs: lastLines }));
    });
  }
  else if (pathname === '/api/bots/inventory' && req.method === 'GET') {
    const name = parsedUrl.searchParams.get('name');
    if (!name) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Falta el nombre del bot' }));
      return;
    }

    const invPath = path.join(__dirname, '..', 'bots', 'logs', `bot_${name}_inventory.json`);
    fs.readFile(invPath, 'utf8', (err, data) => {
      if (err) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([]));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(data);
    });
  }

  else if (pathname === '/api/matrix' && req.method === 'GET') {
    fs.readFile(MATRIX_PATH, 'utf8', (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Matrix file not found. Create it by starting AradorBot once.' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(data);
    });
  } 
  
  else if (pathname === '/api/matrix' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    
    req.on('end', () => {
      try {
        const parsedData = JSON.parse(body);
        
        fs.writeFile(MATRIX_PATH, JSON.stringify(parsedData, null, 2), 'utf8', (err) => {
          if (err) {
            console.error('[Dashboard Server] Error saving farm_matrix.json:', err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: err.message }));
            return;
          }
          console.log('[Dashboard Server] farm_matrix.json updated successfully.');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        });
      } catch (err) {
        console.error('[Dashboard Server] Error parsing JSON body:', err);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Malformed JSON' }));
      }
    });
  } 

  
  // Serve static files
  else {
    let reqPath = pathname === '/' || pathname === '/index.html' ? '/index.html' : pathname;
    const filePath = path.join(PUBLIC_DIR, reqPath);
    
    const ext = path.extname(filePath).toLowerCase();
    let contentType = 'text/html; charset=utf-8';
    
    if (ext === '.css') contentType = 'text/css';
    else if (ext === '.js') contentType = 'application/javascript';
    else if (ext === '.json') contentType = 'application/json';
    else if (ext === '.png') contentType = 'image/png';
    else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
    else if (ext === '.ico') contentType = 'image/x-icon';

    serveStaticFile(res, filePath, contentType);
  }
});

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`========================================================`);
  console.log(`Servidor del Dashboard iniciado en: ${url}`);
  console.log(`Presiona Ctrl+C para apagar el servidor.`);
  console.log(`========================================================`);

  const openCmd = process.platform === 'win32' ? `start ${url}` :
                  process.platform === 'darwin' ? `open ${url}` :
                  `xdg-open ${url}`;
  
  exec(openCmd, (err) => {
    if (err) {
      console.log(`Por favor abre manualmente ${url} en tu navegador.`);
    }
  });
});
