// Tab Switching Logic
function switchTab(tabId) {
  // Update nav buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  
  // Find clicked button and activate it
  const clickedBtn = Array.from(document.querySelectorAll('.tab-btn')).find(btn => 
    btn.getAttribute('onclick').includes(tabId)
  );
  if (clickedBtn) clickedBtn.classList.add('active');

  // Toggle tab contents
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.remove('active');
  });
  document.getElementById(`tab-${tabId}`).classList.add('active');

  // Toggle header action buttons (only relevant for Arador Editor)
  const aradorActions = document.querySelectorAll('.arador-action');
  if (tabId === 'arador-editor') {
    aradorActions.forEach(el => el.style.display = 'inline-flex');
  } else {
    aradorActions.forEach(el => el.style.display = 'none');
  }
}

// Global Bot Manager State
let botsConfig = {};
let openBots = [];

// ==========================================
// Arador Editor Matrix Logic
// ==========================================

const ROWS = 53;
const COLS = 53;
const START_X = -582;
const START_Z = 638;

let matrixData = [];
let selectedCrop = 'trigo';
let currentTool = 'pencil';
let isDrawing = false;
let startR = -1;
let startC = -1;
let lastHoveredR = -1;
let lastHoveredC = -1;

// Build empty matrix structure
function createEmptyMatrix() {
  const matrix = [];
  for (let r = 0; r < ROWS; r++) {
    matrix[r] = [];
    for (let c = 0; c < COLS; c++) {
      matrix[r][c] = {
        x: START_X - r,
        z: START_Z + c,
        cropType: null
      };
    }
  }
  return matrix;
}

// Initialize Grid UI
function initGridUI() {
  const gridContainer = document.getElementById('grid');
  if (!gridContainer) return;
  gridContainer.innerHTML = '';

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement('div');
      cell.className = 'grid-cell';
      cell.dataset.row = r;
      cell.dataset.col = c;
      
      cell.addEventListener('mousedown', handleCellMouseDown);
      cell.addEventListener('mouseenter', handleCellMouseEnter);
      cell.addEventListener('contextmenu', e => e.preventDefault());
      
      gridContainer.appendChild(cell);
    }
  }
  
  // Global mouse up to stop drawing and apply rectangle if active
  window.addEventListener('mouseup', (e) => {
    if (isDrawing && currentTool === 'rect') {
      let endR = lastHoveredR;
      let endC = lastHoveredC;
      
      if (startR !== -1 && startC !== -1 && endR !== -1 && endC !== -1) {
        const minR = Math.min(startR, endR);
        const maxR = Math.max(startR, endR);
        const minC = Math.min(startC, endC);
        const maxC = Math.max(startC, endC);

        let targetCrop = selectedCrop;
        if (e.button === 2) {
          targetCrop = null;
        }

        for (let r = minR; r <= maxR; r++) {
          for (let c = minC; c <= maxC; c++) {
            if (matrixData[r] && matrixData[r][c]) {
              matrixData[r][c].cropType = targetCrop;
            }
          }
        }
      }
      updateGridUI();
      updateStats();
    }
    isDrawing = false;
    startR = -1;
    startC = -1;
  });
}

// Load matrix data from server
async function loadMatrix() {
  try {
    const response = await fetch('/api/matrix');
    if (!response.ok) throw new Error('Error al cargar la matriz');
    matrixData = await response.json();
    updateGridUI();
    updateStats();
  } catch (err) {
    showToast('Error al conectar con el servidor: ' + err.message, true);
    // Fallback to empty matrix
    matrixData = createEmptyMatrix();
    updateGridUI();
    updateStats();
  }
}

// Update Grid styling based on current matrixData
function updateGridUI() {
  const cells = document.querySelectorAll('.grid-cell');
  cells.forEach(cell => {
    const r = parseInt(cell.dataset.row);
    const c = parseInt(cell.dataset.col);
    if (!matrixData[r] || !matrixData[r][c]) return;
    const crop = matrixData[r][c].cropType;

    // Reset classes and outline
    cell.className = 'grid-cell';
    cell.style.outline = 'none';
    
    if (crop === 'trigo') cell.classList.add('cell-trigo');
    else if (crop === 'papa') cell.classList.add('cell-papa');
    else if (crop === 'zanahoria') cell.classList.add('cell-zanahoria');
    else if (crop === 'beetroot' || crop === 'remolacha') cell.classList.add('cell-beetroot');
    else cell.classList.add('cell-null');
  });
}

function updateStats() {
  const counts = { trigo: 0, papa: 0, zanahoria: 0, beetroot: 0, null: 0 };
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!matrixData[r] || !matrixData[r][c]) continue;
      const type = matrixData[r][c].cropType;
      if (type === 'trigo') counts.trigo++;
      else if (type === 'papa') counts.papa++;
      else if (type === 'zanahoria') counts.zanahoria++;
      else if (type === 'beetroot' || type === 'remolacha') counts.beetroot++;
      else counts.null++;
    }
  }

  const elTrigo = document.getElementById('stat-count-trigo');
  const elPapa = document.getElementById('stat-count-papa');
  const elZanahoria = document.getElementById('stat-count-zanahoria');
  const elBeetroot = document.getElementById('stat-count-beetroot');
  const elNull = document.getElementById('stat-count-null');

  if (elTrigo) elTrigo.textContent = counts.trigo;
  if (elPapa) elPapa.textContent = counts.papa;
  if (elZanahoria) elZanahoria.textContent = counts.zanahoria;
  if (elBeetroot) elBeetroot.textContent = counts.beetroot;
  if (elNull) elNull.textContent = counts.null;
}

function handleCellMouseDown(e) {
  const r = parseInt(this.dataset.row);
  const c = parseInt(this.dataset.col);

  // Right click sets to null
  let targetCrop = selectedCrop;
  if (e.button === 2) {
    targetCrop = null;
  }

  if (currentTool === 'pencil') {
    isDrawing = true;
    applyPaint(r, c, targetCrop);
  } else if (currentTool === 'rect') {
    isDrawing = true;
    startR = r;
    startC = c;
    lastHoveredR = r;
    lastHoveredC = c;
    updateRectanglePreview(startR, startC, r, c);
  } else if (currentTool === 'bucket') {
    applyBucketFill(r, c, targetCrop);
  }
}

function handleCellMouseEnter(e) {
  const r = parseInt(this.dataset.row);
  const c = parseInt(this.dataset.col);
  
  lastHoveredR = r;
  lastHoveredC = c;

  // Update coordinates panel
  if (matrixData[r] && matrixData[r][c]) {
    const cellInfo = matrixData[r][c];
    document.getElementById('info-row').textContent = r + 1;
    document.getElementById('info-col').textContent = c + 1;
    document.getElementById('info-x').textContent = cellInfo.x;
    document.getElementById('info-z').textContent = cellInfo.z;
    document.getElementById('info-crop').textContent = cellInfo.cropType || 'Null (Vacío)';
  }

  if (isDrawing) {
    let targetCrop = selectedCrop;
    if (e.buttons === 2) {
      targetCrop = null;
    }

    if (currentTool === 'pencil') {
      applyPaint(r, c, targetCrop);
    } else if (currentTool === 'rect') {
      updateRectanglePreview(startR, startC, r, c);
    }
  }
}

function applyPaint(r, c, crop) {
  if (!matrixData[r] || !matrixData[r][c]) return;
  matrixData[r][c].cropType = crop;
  
  // Update specific cell UI immediately
  const cell = document.querySelector(`[data-row="${r}"][data-col="${c}"]`);
  if (cell) {
    cell.className = 'grid-cell';
    if (crop === 'trigo') cell.classList.add('cell-trigo');
    else if (crop === 'papa') cell.classList.add('cell-papa');
    else if (crop === 'zanahoria') cell.classList.add('cell-zanahoria');
    else if (crop === 'beetroot') cell.classList.add('cell-beetroot');
    else cell.classList.add('cell-null');
  }

  updateStats();
}

// Interactive Preview for Rectangle selection
function updateRectanglePreview(sR, sC, eR, eC) {
  updateGridUI(); // reset styling first

  const minR = Math.min(sR, eR);
  const maxR = Math.max(sR, eR);
  const minC = Math.min(sC, eC);
  const maxC = Math.max(sC, eC);

  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      const cell = document.querySelector(`[data-row="${r}"][data-col="${c}"]`);
      if (cell) {
        cell.className = 'grid-cell';
        if (selectedCrop === 'trigo') cell.classList.add('cell-trigo');
        else if (selectedCrop === 'papa') cell.classList.add('cell-papa');
        else if (selectedCrop === 'zanahoria') cell.classList.add('cell-zanahoria');
        else if (selectedCrop === 'beetroot') cell.classList.add('cell-beetroot');
        else cell.classList.add('cell-null');
        cell.style.outline = '1px solid #ffffff';
      }
    }
  }
}

// Flood fill algorithm for Paint Bucket
function applyBucketFill(startR, startC, targetCrop) {
  if (!matrixData[startR] || !matrixData[startR][startC]) return;
  const startCrop = matrixData[startR][startC].cropType;
  if (startCrop === targetCrop) return;

  const queue = [[startR, startC]];
  const visited = new Set();
  const keyOf = (r, c) => `${r},${c}`;

  while (queue.length > 0) {
    const [r, c] = queue.shift();
    const key = keyOf(r, c);
    
    if (visited.has(key)) continue;
    visited.add(key);

    if (matrixData[r] && matrixData[r][c] && matrixData[r][c].cropType === startCrop) {
      applyPaint(r, c, targetCrop);

      // Add neighbors
      if (r > 0) queue.push([r - 1, c]);
      if (r < ROWS - 1) queue.push([r + 1, c]);
      if (c > 0) queue.push([r, c - 1]);
      if (c < COLS - 1) queue.push([r, c + 1]);
    }
  }
}

function selectCrop(crop) {
  selectedCrop = crop;
  
  // Update UI classes
  document.querySelectorAll('.brush-item').forEach(item => {
    item.classList.remove('active');
  });

  const selectorClass = crop === null ? '.brush-null' : `.brush-${crop}`;
  const selectedEl = document.querySelector(selectorClass);
  if (selectedEl) selectedEl.classList.add('active');

  // Auto switch back to pencil/rect if currently on bucket
  if (currentTool === 'bucket') {
    setTool('pencil');
  }
}

function setTool(tool) {
  currentTool = tool;
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  const toolEl = document.getElementById(`tool-${tool}`);
  if (toolEl) toolEl.classList.add('active');
}

// Keyboard Shortcuts
window.addEventListener('keydown', e => {
  if (e.key === '1') selectCrop('trigo');
  if (e.key === '2') selectCrop('papa');
  if (e.key === '3') selectCrop('zanahoria');
  if (e.key === '4') selectCrop('beetroot');
  if (e.key === '5') selectCrop(null);
  
  if (e.key.toLowerCase() === 'p') setTool('pencil');
  if (e.key.toLowerCase() === 'r') setTool('rect');
  if (e.key.toLowerCase() === 'b') setTool('bucket');
});

// Save matrix to server
async function saveMatrix() {
  try {
    const response = await fetch('/api/matrix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(matrixData)
    });

    if (response.ok) {
      showToast('✔️ ¡Cambios guardados con éxito!');
    } else {
      showToast('❌ Error al guardar en el servidor', true);
    }
  } catch (err) {
    showToast('❌ Error al guardar: ' + err.message, true);
  }
}

// Reload from file
function reloadMatrix() {
  if (confirm('¿Deseas recargar la matriz desde el archivo? Perderás los cambios no guardados.')) {
    loadMatrix();
  }
}

// Reset procedural formula pattern
function generateProcedural() {
  if (!confirm('¿Deseas regenerar el patrón procedimental por defecto de AradorBot? Esto modificará la matriz actual.')) {
    return;
  }

  function getCropTypeForPosition(row, col) {
    const rowModulo = row % 11;
    if (rowModulo >= 9) return null;
    const colModulo = col % 11;
    if (colModulo >= 9) return null;
    if (rowModulo === 4 && colModulo === 4) return null;
    const fieldCol = Math.floor(col / 11);
    switch (fieldCol) {
      case 0: return 'trigo';
      case 1: return 'papa';
      case 2: return 'zanahoria';
      case 3: return 'trigo';
      case 4: return 'papa';
      default: return null;
    }
  }

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (matrixData[r] && matrixData[r][c]) {
        matrixData[r][c].cropType = getCropTypeForPosition(r, c);
      }
    }
  }

  updateGridUI();
  updateStats();
  showToast('⚡ Patrón original generado (sin guardar)');
}

// Clear all
function clearAllToNull() {
  if (confirm('¿Seguro que deseas vaciar toda la matriz a Null?')) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (matrixData[r] && matrixData[r][c]) {
          matrixData[r][c].cropType = null;
        }
      }
    }
    updateGridUI();
    updateStats();
    showToast('🗑️ Matriz vaciada (sin guardar)');
  }
}

// Toast notification helper
function showToast(msg, isError = false) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  
  if (isError) toast.classList.add('error');
  else toast.classList.remove('error');

  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// ==========================================
// Bot Manager Configuration & Lifecycle Logic
// ==========================================

let botStatuses = {};
let botSubTabs = {}; // botName -> 'config'|'console'|'inventory'
let pollIntervals = {}; // botName -> { log: ID, inv: ID }
let statusPollInterval = null;
let liveViewModes = {}; // botName -> 'web'|'python'


async function loadBots() {
  try {
    const response = await fetch('/api/bots');
    if (!response.ok) throw new Error('Error al cargar la configuración de los bots');
    botsConfig = await response.json();
    await updateStatuses();
    renderBotList();
    renderBotDetailsContainer();
  } catch (err) {
    showToast('Error al cargar bots: ' + err.message, true);
  }
}

async function updateStatuses() {
  try {
    const response = await fetch('/api/bots/status');
    if (response.ok) {
      botStatuses = await response.json();
    }
  } catch (err) {
    console.error('Error al actualizar estados:', err);
  }
}

function renderBotList() {
  const container = document.getElementById('bot-list-container');
  if (!container) return;
  container.innerHTML = '';

  const botNames = Object.keys(botsConfig).filter(key => key !== 'sharedChests');

  if (botNames.length === 0) {
    container.innerHTML = '<div style="color: var(--text-muted); font-size: 0.85rem; text-align: center; padding: 1rem;">No hay bots registrados.</div>';
    return;
  }

  botNames.forEach(name => {
    const bot = botsConfig[name];
    const status = botStatuses[name] || 'offline';
    const isOpen = openBots.some(cb => cb.name === name);
    const item = document.createElement('div');
    item.className = `bot-item ${isOpen ? 'active' : ''}`;
    item.onclick = () => toggleBotCard(name);

    item.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <span class="bot-status-dot ${status}"></span>
          <div class="bot-item-info">
            <span class="bot-item-name">${name}</span>
            <span class="bot-item-type">${bot.type || 'desconocido'}</span>
          </div>
        </div>
        <button class="delete-bot-btn" title="Eliminar Bot" onclick="handleDeleteBot(event, '${name}')">🗑️</button>
      </div>
    `;

    container.appendChild(item);
  });
}

function toggleBotCard(name) {
  const cardId = `${name}_card_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  openBots.push({ id: cardId, name: name });
  botSubTabs[cardId] = 'config'; // Default subtab
  renderBotDetailsContainer();
  renderBotList();
}

function closeBotCard(cardId) {
  openBots = openBots.filter(cb => cb.id !== cardId);
  
  // Clear intervals for this bot card
  if (pollIntervals[cardId]) {
    if (pollIntervals[cardId].log) clearInterval(pollIntervals[cardId].log);
    if (pollIntervals[cardId].inv) clearInterval(pollIntervals[cardId].inv);
    delete pollIntervals[cardId];
  }
  delete botSubTabs[cardId];

  renderBotDetailsContainer();
  renderBotList();
}

function switchSubTab(cardId, subTab) {
  const botObj = openBots.find(cb => cb.id === cardId);
  if (!botObj) return;
  const name = botObj.name;

  botSubTabs[cardId] = subTab;
  
  // Clear existing logs/inventory intervals for this card
  if (pollIntervals[cardId]) {
    if (pollIntervals[cardId].log) clearInterval(pollIntervals[cardId].log);
    if (pollIntervals[cardId].inv) clearInterval(pollIntervals[cardId].inv);
    pollIntervals[cardId] = { log: null, inv: null };
  } else {
    pollIntervals[cardId] = { log: null, inv: null };
  }

  // Rerender specific card's main content area without full container rewrite
  const cardBody = document.getElementById(`bot-card-body-${cardId}`);
  const cardSubtabs = document.getElementById(`bot-card-subtabs-${cardId}`);
  if (!cardBody || !cardSubtabs) return;

  // Update subtab buttons active class
  cardSubtabs.querySelectorAll('.sub-tab-btn').forEach(btn => {
    btn.classList.remove('active');
    if (btn.getAttribute('onclick').includes(`'${subTab}'`)) {
      btn.classList.add('active');
    }
  });

  const bot = botsConfig[name];
  if (subTab === 'config') {
    let configHtml = '';
    const keys = Object.keys(bot).filter(k => k !== 'type');
    if (keys.length === 0) {
      configHtml = '<div style="color: var(--text-muted); font-size: 0.9rem;">No hay configuraciones adicionales.</div>';
    } else {
      configHtml = '<div class="bot-config-grid">';
      keys.forEach(k => {
        let valDisplay = bot[k];
        if (typeof valDisplay === 'object' && valDisplay !== null) {
          valDisplay = JSON.stringify(valDisplay);
        } else if (valDisplay === null) {
          valDisplay = 'null';
        }
        configHtml += `
          <div class="config-item">
            <span class="config-label">${k}</span>
            <span class="config-value">${valDisplay}</span>
          </div>
        `;
      });
      configHtml += '</div>';
    }
    cardBody.innerHTML = configHtml;
  } else if (subTab === 'inventory') {
    cardBody.innerHTML = `<div class="inventory-grid" id="bot-inventory-grid-${cardId}">Cargando inventario...</div>`;
    fetchInventory(name, cardId);
    pollIntervals[cardId].inv = setInterval(() => fetchInventory(name, cardId), 3000);
  } else if (subTab === 'live') {
    const isOnline = botStatuses[name] && botStatuses[name] !== 'offline';
    const port = bot.viewerPort;
    
    if (!isOnline) {
      cardBody.innerHTML = `
        <div class="live-view-container offline" style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2rem; color: var(--text-muted); text-align: center;">
          <div style="font-size: 3rem; margin-bottom: 1rem;">📺</div>
          <h3>Bot Desconectado</h3>
          <p style="font-size: 0.85rem; max-width: 250px; margin-top: 0.5rem;">El bot debe estar conectado para poder ver su transmisión en vivo.</p>
        </div>
      `;
    } else if (!port) {
      cardBody.innerHTML = `
        <div class="live-view-container error" style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2rem; color: var(--text-muted); text-align: center;">
          <div style="font-size: 3rem; margin-bottom: 1rem;">⚠️</div>
          <h3>Sin Puerto Asignado</h3>
          <p style="font-size: 0.85rem; max-width: 250px; margin-top: 0.5rem;">No se detectó un puerto asignado para la vista en vivo de este bot.</p>
        </div>
      `;
    } else {
      const currentMode = liveViewModes[name];
      if (!currentMode) {
        cardBody.innerHTML = `
          <div class="live-view-container prompt" style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2rem; color: var(--text-muted); text-align: center; background: rgba(0,0,0,0.2); border-radius: 8px;">
            <div style="font-size: 3rem; margin-bottom: 1rem;">📺</div>
            <h3 style="color: var(--text-main); margin-bottom: 0.5rem;">Seleccionar Visualización</h3>
            <p style="font-size: 0.85rem; max-width: 320px; margin-bottom: 1.5rem;">Elige cómo deseas ver la transmisión en vivo. La visualización en Python consume menos memoria en Chrome.</p>
            <div style="display: flex; gap: 1rem; width: 100%; max-width: 320px;">
              <button class="btn btn-primary" onclick="setLiveViewMode('${name}', 'web', '${cardId}')" style="flex: 1; justify-content: center; padding: 0.75rem;">🌐 Vista Web (Iframe)</button>
              <button class="btn btn-trabaja" onclick="setLiveViewMode('${name}', 'python', '${cardId}')" style="flex: 1; justify-content: center; padding: 0.75rem; background: #3b82f6; color: #fff;">🖥️ Ventana Python</button>
            </div>
          </div>
        `;
      } else if (currentMode === 'python') {
        cardBody.innerHTML = `
          <div class="live-view-container python-active" style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2rem; color: var(--text-muted); text-align: center; background: rgba(0,0,0,0.3); border-radius: 8px;">
            <div style="font-size: 3rem; margin-bottom: 1rem; color: #3b82f6;">🖥️</div>
            <h3 style="color: var(--text-main); margin-bottom: 0.5rem;">Transmitiendo en Python</h3>
            <p style="font-size: 0.85rem; max-width: 320px; margin-bottom: 1.5rem;">El bot "${name}" ha sido agregado a la cuadrícula de cámaras de seguridad en la ventana externa de Python.</p>
            <div style="display: flex; flex-direction: column; gap: 0.75rem; width: 100%; max-width: 320px;">
              <button class="btn btn-primary" onclick="setLiveViewMode('${name}', 'web', '${cardId}')" style="justify-content: center; padding: 0.6rem;">🌐 Cambiar a Vista Web (Iframe)</button>
              <button class="btn btn-danger" onclick="stopPythonLiveView('${name}', '${cardId}')" style="justify-content: center; padding: 0.6rem;">✕ Quitar de Ventana Python</button>
            </div>
          </div>
        `;
      } else {
        const currentQuality = localStorage.getItem(`live-quality-${name}`) || 'verylow';
        cardBody.innerHTML = `
          <div class="live-view-container" style="flex: 1; display: flex; flex-direction: column; height: 100%; min-height: 300px; position: relative;">
            <div class="live-view-controls" style="display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.8); padding: 4px 12px; height: 30px; box-sizing: border-box; font-size: 0.8rem; border-bottom: 1px solid #333; color: #fff;">
              <div style="font-weight: 600; display: flex; align-items: center; gap: 6px;">
                <span style="color: #10b981;">●</span> Live
              </div>
              <div style="display: flex; align-items: center; gap: 12px;">
                <div style="display: flex; align-items: center; gap: 6px;">
                  <span style="color: #aaa; font-size: 0.75rem;">Calidad:</span>
                  <select id="quality-select-${cardId}" onchange="changeLiveQuality('${name}', this.value, '${cardId}')" style="background: #222; color: #fff; border: 1px solid #444; border-radius: 4px; padding: 2px 6px; font-size: 0.75rem; cursor: pointer;">
                    <option value="high" ${currentQuality === 'high' ? 'selected' : ''}>Alta</option>
                    <option value="medium" ${currentQuality === 'medium' ? 'selected' : ''}>Media</option>
                    <option value="low" ${currentQuality === 'low' ? 'selected' : ''}>Baja</option>
                    <option value="verylow" ${currentQuality === 'verylow' ? 'selected' : ''}>Muy Baja (Retro/Ultra Rápida)</option>
                  </select>
                </div>
              </div>
            </div>
            <iframe id="live-iframe-${cardId}" src="http://${window.location.hostname}:${port}?quality=${currentQuality}" style="flex: 1; border: none; width: 100%; height: calc(100% - 30px);" allowfullscreen></iframe>
            <div class="live-view-overlay" style="position: absolute; bottom: 8px; right: 8px; background: rgba(0,0,0,0.6); padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; color: #10b981; pointer-events: none;">
              🔴 PUERTO ${port}
            </div>
          </div>
        `;
      }
    }
  } else {
    cardBody.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 0.5rem; width: 100%;">
        <div class="console-terminal" id="bot-console-log-${cardId}">Cargando logs...</div>
        <div class="console-actions">
          <button class="btn btn-secondary" onclick="fetchConsoleLogs('${name}', '${cardId}')" style="padding: 0.35rem 0.75rem; font-size: 0.75rem;">🔄 Limpiar / Forzar Carga</button>
        </div>
      </div>
    `;
    fetchConsoleLogs(name, cardId);
    pollIntervals[cardId].log = setInterval(() => fetchConsoleLogs(name, cardId), 2000);
  }
}

function updateOpenCardsUI() {
  openBots.forEach(botObj => {
    const cardId = botObj.id;
    const name = botObj.name;
    const card = document.getElementById(`bot-card-${cardId}`);
    if (!card) return;
    const actionsEl = card.querySelector('.bot-card-actions');
    if (!actionsEl) return;

    const status = botStatuses[name] || 'offline';
    const isOnline = status !== 'offline';
    const isWorking = status === 'working';

    let controlButton = '';
    if (isOnline) {
      controlButton = `<button class="btn btn-danger" onclick="stopBot('${name}')" title="Desconectar">🔌</button>`;
    } else {
      controlButton = `<button class="btn btn-primary" style="background: #3b82f6;" onclick="startBot('${name}')" title="Iniciar">⚡</button>`;
    }

    let workButtons = '';
    if (isOnline) {
      workButtons = `
        <button class="btn btn-trabaja" style="background: #10b981; color: white;" ${isWorking ? 'disabled' : ''} onclick="sendBotCommand('${name}', 'trabaja')" title="Trabaja">▶️</button>
        <button class="btn btn-para" style="background: #ef4444; color: white;" ${!isWorking ? 'disabled' : ''} onclick="sendBotCommand('${name}', 'para')" title="Para">⏸️</button>
      `;
    } else {
      workButtons = `
        <button class="btn btn-secondary" disabled title="Trabaja">▶️</button>
        <button class="btn btn-secondary" disabled title="Para">⏸️</button>
      `;
    }

    let miniCmdButtons = '';
    if (isOnline) {
      miniCmdButtons = `
        <button class="btn btn-secondary btn-mini-cmd" onclick="sendBotCommand('${name}', 'guarda')" title="Guarda objetos en cofre">📦</button>
        <button class="btn btn-secondary btn-mini-cmd" onclick="sendBotCommand('${name}', 'cama')" title="Ir a dormir / Asignar cama">🛏️</button>
        <button class="btn btn-secondary btn-mini-cmd" onclick="sendBotCommand('${name}', 'dame')" title="Entregar ítems al jugador">✋</button>
      `;
    } else {
      miniCmdButtons = `
        <button class="btn btn-secondary btn-mini-cmd" disabled title="Guarda objetos en cofre">📦</button>
        <button class="btn btn-secondary btn-mini-cmd" disabled title="Ir a dormir / Asignar cama">🛏️</button>
        <button class="btn btn-secondary btn-mini-cmd" disabled title="Entregar ítems al jugador">✋</button>
      `;
    }

    const badgeClass = status;
    let badgeLabel = 'Desconectado';
    if (status === 'working') badgeLabel = 'Trabajando';
    else if (status === 'online') badgeLabel = 'Conectado';

    actionsEl.innerHTML = `
      <span class="bot-badge ${badgeClass}">${badgeLabel}</span>
      <div class="bot-card-actions-buttons">
        ${controlButton}
        ${workButtons}
      </div>
    `;

    const quickCmdsEl = card.querySelector('.bot-quick-cmds');
    if (quickCmdsEl) {
      quickCmdsEl.innerHTML = miniCmdButtons;
    }
  });
}

function renderBotDetailsContainer() {
  const container = document.getElementById('bot-details-container');
  if (!container) return;

  if (openBots.length === 0) {
    container.style.gridTemplateColumns = '1fr';
    container.innerHTML = `
      <div class="card" style="height: 100%; min-height: 400px; display: flex; flex-direction: column; justify-content: center; align-items: center; width: 100%;">
        <div class="empty-detail-state">
          <div class="empty-icon">🤖</div>
          <h3>Selecciona un bot</h3>
          <p>Elige uno o más bots de la lista para ver su configuración y detalles simultáneamente.</p>
        </div>
      </div>
    `;
    return;
  }

  // Remove empty state card if it exists
  const emptyState = container.querySelector('.empty-detail-state');
  if (emptyState) {
    container.innerHTML = '';
  }

  // Dynamically size columns up to 3 columns max
  if (openBots.length === 1) {
    container.style.gridTemplateColumns = '1fr';
  } else if (openBots.length === 2) {
    container.style.gridTemplateColumns = 'repeat(2, 1fr)';
  } else {
    container.style.gridTemplateColumns = 'repeat(3, 1fr)';
  }

  // Remove cards that are no longer open
  const existingCards = container.querySelectorAll('.bot-card-multiview');
  existingCards.forEach(cardEl => {
    const cardId = cardEl.id.replace('bot-card-', '');
    const botObj = openBots.find(cb => cb.id === cardId);
    if (!botObj) {
      // Release iframe WebGL context/memory before removing
      const iframe = cardEl.querySelector('iframe');
      if (iframe) {
        iframe.src = 'about:blank';
      }
      cardEl.remove();
    }
  });

  // Add cards that are open but not yet rendered in DOM
  openBots.forEach(botObj => {
    const cardId = botObj.id;
    const name = botObj.name;
    let card = document.getElementById(`bot-card-${cardId}`);
    if (!card) {
      const bot = botsConfig[name];
      if (!bot) return;

      const subTab = botSubTabs[cardId] || 'config';

      card = document.createElement('div');
      card.className = 'card bot-card-multiview';
      card.id = `bot-card-${cardId}`;
      card.style.display = 'flex';
      card.style.flexDirection = 'column';
      card.style.alignItems = 'stretch';
      card.style.height = '100%';

      card.innerHTML = `
        <div class="bot-details-header">
          <div class="bot-details-title">
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <h2>${name}</h2>
              <button class="close-card-btn" title="Cerrar Ficha" onclick="closeBotCard('${cardId}')">✕</button>
            </div>
            <p>Tipo: ${bot.type || 'desconocido'}</p>
            <div class="bot-quick-cmds"></div>
          </div>
          <div class="bot-card-actions"></div>
        </div>
        <div class="bot-sub-tabs" id="bot-card-subtabs-${cardId}">
          <button class="sub-tab-btn ${subTab === 'config' ? 'active' : ''}" onclick="switchSubTab('${cardId}', 'config')">Configuración</button>
          <button class="sub-tab-btn ${subTab === 'console' ? 'active' : ''}" onclick="switchSubTab('${cardId}', 'console')">Consola</button>
          <button class="sub-tab-btn ${subTab === 'inventory' ? 'active' : ''}" onclick="switchSubTab('${cardId}', 'inventory')">Objetos</button>
          <button class="sub-tab-btn ${subTab === 'live' ? 'active' : ''}" onclick="switchSubTab('${cardId}', 'live')">Live View</button>
        </div>
        <div id="bot-card-body-${cardId}" style="flex: 1; display: flex; flex-direction: column;">
          <!-- Card content inside switchSubTab -->
        </div>
      `;

      container.appendChild(card);
      switchSubTab(cardId, subTab);
    }
  });

  // Update status UI on all open cards
  updateOpenCardsUI();
}

const emojiMap = {
  wheat: '🌾',
  seed: '🌱',
  potato: '🥔',
  carrot: '🥕',
  beetroot: '🍎',
  chest: '🧳',
  coal: '🪨',
  iron_ore: '🪨',
  iron_ingot: '🪙',
  log: '🪵',
  plank: '🪵',
  sapling: '🌱',
  stone: '🪨',
  cobblestone: '🪨',
  dirt: '🟫',
  water_bucket: '🪣',
  bucket: '🪣',
  pickaxe: '⛏️',
  axe: '🪓',
  hoe: '⚔️',
  sword: '⚔️',
  shovel: '🥄',
  mutton: '🥩',
  beef: '🥩',
  chicken: '🍗',
  porkchop: '🥩',
  wool: '☁️',
  egg: '🥚',
  feather: '🪶',
  bone: '🦴',
  leather: '💼',
  apple: '🍎'
};

async function fetchInventory(name, cardId) {
  try {
    const response = await fetch(`/api/bots/inventory?name=${name}`);
    if (response.ok) {
      const items = await response.json();
      const targetId = cardId ? `bot-inventory-grid-${cardId}` : `bot-inventory-grid-${name}`;
      const grid = document.getElementById(targetId);
      if (!grid) return;

      if (!Array.isArray(items) || items.length === 0) {
        grid.innerHTML = '<div style="color: var(--text-muted); font-size: 0.9rem; text-align: center; padding: 2rem; width: 100%;">El inventario está vacío o el bot está desconectado.</div>';
        return;
      }

      grid.innerHTML = '';
      items.forEach(item => {
        const nameLower = item.name.toLowerCase();
        let emoji = '📦';
        for (const key in emojiMap) {
          if (nameLower.includes(key)) {
            emoji = emojiMap[key];
            break;
          }
        }

        const card = document.createElement('div');
        card.className = 'inventory-item';
        card.title = `${item.displayName || item.name} (Slot: ${item.slot})`;
        card.innerHTML = `
          <div class="inventory-item-icon">${emoji}</div>
          <div class="inventory-item-name">${item.displayName || item.name}</div>
          <div class="inventory-item-count">${item.count}</div>
        `;
        grid.appendChild(card);
      });
    }
  } catch (err) {
    console.error('Error al cargar inventario:', err);
  }
}

async function fetchConsoleLogs(name, cardId) {
  try {
    const response = await fetch(`/api/bots/logs?name=${name}`);
    if (response.ok) {
      const data = await response.json();
      const targetId = cardId ? `bot-console-log-${cardId}` : `bot-console-log-${name}`;
      const consoleText = document.getElementById(targetId);
      if (consoleText) {
        const atBottom = consoleText.scrollHeight - consoleText.clientHeight <= consoleText.scrollTop + 40;
        consoleText.textContent = data.logs || 'No hay logs de consola registrados aún.';
        if (atBottom || consoleText.textContent === 'Cargando logs...') {
          consoleText.scrollTop = consoleText.scrollHeight;
        }
      }
    }
  } catch (err) {
    console.error('Error al cargar logs:', err);
  }
}

async function startBot(name) {
  try {
    const response = await fetch('/api/bots/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    if (response.ok) {
      showToast(`⚡ Bot ${name} iniciado`);
      await updateStatuses();
      renderBotList();
      updateOpenCardsUI();
    } else {
      showToast(`❌ Error al iniciar el bot`, true);
    }
  } catch (err) {
    showToast(`❌ Error: ${err.message}`, true);
  }
}

async function stopBot(name) {
  try {
    const response = await fetch('/api/bots/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    if (response.ok) {
      showToast(`🔌 Bot ${name} desconectado`);
      await updateStatuses();
      renderBotList();
      updateOpenCardsUI();
    } else {
      showToast(`❌ Error al desconectar el bot`, true);
    }
  } catch (err) {
    showToast(`❌ Error: ${err.message}`, true);
  }
}

async function sendBotCommand(name, command) {
  try {
    const response = await fetch('/api/bots/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, command })
    });
    if (response.ok) {
      showToast(`⚡ Comando enviado: ${command}`);
      await updateStatuses();
      renderBotList();
      updateOpenCardsUI();
    } else {
      showToast(`❌ Error al enviar el comando`, true);
    }
  } catch (err) {
    showToast(`❌ Error: ${err.message}`, true);
  }
}

async function handleAddBot() {
  const nameInput = document.getElementById('new-bot-name');
  const typeSelect = document.getElementById('new-bot-type');
  if (!nameInput || !typeSelect) return;

  const name = nameInput.value.trim();
  const type = typeSelect.value;

  if (!name) {
    showToast('❌ Por favor introduce un nombre para el bot', true);
    return;
  }

  if (botsConfig[name]) {
    showToast('❌ Ya existe un bot con este nombre', true);
    return;
  }

  botsConfig[name] = {
    type: type,
    silentMode: false
  };

  if (type === 'farmer') {
    botsConfig[name].shouldFarm = true;
    botsConfig[name].bedPosition = null;
  } else if (type === 'lumberjack') {
    botsConfig[name].shouldChop = true;
    botsConfig[name].bedPosition = null;
  } else if (type === 'miner') {
    botsConfig[name].miningState = { isMining: false };
  } else if (type === 'fencer') {
    botsConfig[name].shouldFence = false;
  }

  try {
    const response = await fetch('/api/bots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(botsConfig)
    });

    if (response.ok) {
      showToast('✔️ Bot agregado con éxito');
      nameInput.value = '';
      await loadBots();
      toggleBotCard(name); // Auto-open the new bot card
    } else {
      showToast('❌ Error al agregar el bot en el servidor', true);
    }
  } catch (err) {
    showToast('❌ Error al guardar: ' + err.message, true);
  }
}

async function handleDeleteBot(e, name) {
  e.stopPropagation();

  if (!confirm(`¿Estás seguro de que deseas eliminar el bot "${name}"?`)) {
    return;
  }

  delete botsConfig[name];

  try {
    const response = await fetch('/api/bots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(botsConfig)
    });

    if (response.ok) {
      showToast('🗑️ Bot eliminado con éxito');
      closeBotCard(name);
      await loadBots();
    } else {
      showToast('❌ Error al eliminar el bot en el servidor', true);
    }
  } catch (err) {
    showToast('❌ Error al guardar: ' + err.message, true);
  }
}

// Initial setup
initGridUI();
loadMatrix();
loadBots();

// Poll status of all processes every 3 seconds to keep UI indicators fresh
statusPollInterval = setInterval(async () => {
  await updateStatuses();
  renderBotList();
  updateOpenCardsUI();
}, 3000);

window.changeLiveQuality = function(name, quality, cardId) {
  localStorage.setItem(`live-quality-${name}`, quality);
  const targetId = cardId ? `live-iframe-${cardId}` : `live-iframe-${name}`;
  const iframe = document.getElementById(targetId);
  if (iframe) {
    try {
      const url = new URL(iframe.src);
      url.searchParams.set('quality', quality);
      iframe.src = url.toString();
    } catch (e) {
      console.error('Error changing iframe quality:', e);
    }
  }
};

window.setLiveViewMode = async function(name, mode, cardId) {
  liveViewModes[name] = mode;
  if (mode === 'python') {
    try {
      const response = await fetch('/api/python-grid/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      if (response.ok) {
        showToast(`🖥️ ${name} agregado a la cuadrícula de Python`);
      } else {
        const errData = await response.json();
        showToast(`❌ Error: ${errData.error || 'No se pudo agregar a Python'}`, true);
        liveViewModes[name] = undefined;
      }
    } catch (e) {
      showToast('❌ Error de red al conectar con la cuadrícula de Python', true);
      liveViewModes[name] = undefined;
    }
  } else if (mode === 'web') {
    try {
      await fetch('/api/python-grid/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
    } catch (e) {}
  }
  if (cardId) {
    switchSubTab(cardId, 'live');
  } else {
    switchSubTab(name, 'live');
  }
};

window.stopPythonLiveView = async function(name, cardId) {
  try {
    const response = await fetch('/api/python-grid/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    if (response.ok) {
      showToast(`✕ ${name} removido de la cuadrícula de Python`);
      liveViewModes[name] = undefined;
      if (cardId) {
        switchSubTab(cardId, 'live');
      } else {
        switchSubTab(name, 'live');
      }
    }
  } catch (e) {
    showToast('❌ Error al remover de Python', true);
  }
};

switchTab('bot-manager'); // Default tab on load
