const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = 3000;
const MATRIX_PATH = path.join(__dirname, 'farm_matrix.json');

// HTML/CSS/JS template for the editor
const HTML_CONTENT = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Minecraft Farm Matrix Editor</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-primary: #0b0f19;
      --bg-secondary: rgba(17, 24, 39, 0.9);
      --bg-card: rgba(31, 41, 55, 0.5);
      --border-color: rgba(75, 85, 99, 0.4);
      --text-main: #f3f4f6;
      --text-muted: #9ca3af;
      --accent: #6366f1;
      --accent-hover: #4f46e5;
      
      /* Crop colors */
      --color-trigo: #fbbf24;
      --color-papa: #b45309;
      --color-zanahoria: #f97316;
      --color-beetroot: #e11d48;
      --color-null: #374151;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      user-select: none;
    }

    body {
      font-family: 'Outfit', sans-serif;
      background: var(--bg-primary);
      background-image: radial-gradient(circle at 50% 50%, #1e1b4b 0%, var(--bg-primary) 70%);
      color: var(--text-main);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      overflow-x: hidden;
    }

    header {
      background: rgba(15, 23, 42, 0.8);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--border-color);
      padding: 1.25rem 2rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky;
      top: 0;
      z-index: 100;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .brand-logo {
      width: 2rem;
      height: 2rem;
      background: var(--accent);
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 1.25rem;
      box-shadow: 0 0 15px rgba(99, 102, 241, 0.5);
    }

    h1 {
      font-size: 1.5rem;
      font-weight: 700;
      letter-spacing: -0.025em;
    }

    .actions {
      display: flex;
      gap: 1rem;
    }

    .btn {
      font-family: inherit;
      font-size: 0.9rem;
      font-weight: 600;
      padding: 0.6rem 1.2rem;
      border: 1px solid transparent;
      border-radius: 8px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .btn-primary {
      background: var(--accent);
      color: #fff;
      box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
    }

    .btn-primary:hover {
      background: var(--accent-hover);
      box-shadow: 0 4px 20px rgba(99, 102, 241, 0.5);
      transform: translateY(-1px);
    }

    .btn-secondary {
      background: rgba(55, 65, 81, 0.7);
      color: var(--text-main);
      border-color: var(--border-color);
    }

    .btn-secondary:hover {
      background: rgba(55, 65, 81, 1);
      transform: translateY(-1px);
    }

    .btn-danger {
      background: rgba(225, 29, 72, 0.2);
      color: #fda4af;
      border-color: rgba(225, 29, 72, 0.4);
    }

    .btn-danger:hover {
      background: rgba(225, 29, 72, 0.4);
      color: #fff;
      transform: translateY(-1px);
    }

    .main-container {
      display: grid;
      grid-template-columns: 350px 1fr;
      flex: 1;
      gap: 2rem;
      padding: 2rem;
      max-width: 1600px;
      margin: 0 auto;
      width: 100%;
    }

    .sidebar {
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    .card {
      background: var(--bg-card);
      backdrop-filter: blur(16px);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 1.5rem;
      box-shadow: 0 10px 30px rgba(0,0,0,0.2);
    }

    .card-title {
      font-size: 1.1rem;
      font-weight: 600;
      margin-bottom: 1rem;
      color: var(--text-main);
      border-left: 3px solid var(--accent);
      padding-left: 0.5rem;
    }

    .tools-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 0.5rem;
      margin-bottom: 1rem;
    }

    .tool-btn {
      background: rgba(55, 65, 81, 0.4);
      border: 1px solid var(--border-color);
      color: var(--text-muted);
      padding: 0.6rem 0.25rem;
      border-radius: 8px;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.25rem;
      font-size: 0.75rem;
      font-weight: 600;
      transition: all 0.15s ease;
    }

    .tool-btn:hover, .tool-btn.active {
      background: rgba(99, 102, 241, 0.15);
      border-color: var(--accent);
      color: var(--text-main);
    }

    .brush-list {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .brush-item {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 0.75rem;
      border-radius: 8px;
      cursor: pointer;
      border: 1px solid transparent;
      background: rgba(55, 65, 81, 0.3);
      transition: all 0.15s ease;
    }

    .brush-item:hover, .brush-item.active {
      background: rgba(255, 255, 255, 0.05);
      border-color: var(--border-color);
    }

    .brush-item.active {
      border-color: var(--accent);
      box-shadow: 0 0 10px rgba(99, 102, 241, 0.2);
    }

    .brush-color {
      width: 1.5rem;
      height: 1.5rem;
      border-radius: 4px;
      flex-shrink: 0;
      box-shadow: inset 0 0 5px rgba(0,0,0,0.5);
    }

    .brush-info {
      flex: 1;
    }

    .brush-name {
      font-weight: 600;
      font-size: 0.9rem;
    }

    .brush-key {
      font-size: 0.75rem;
      color: var(--text-muted);
    }

    .stats-list {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .stat-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.9rem;
    }

    .stat-name-container {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .stat-color-dot {
      width: 0.75rem;
      height: 0.75rem;
      border-radius: 50%;
    }

    .stat-val {
      font-weight: 700;
    }

    /* Editor Viewport */
    .editor-container {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      align-items: center;
      justify-content: center;
      overflow: auto;
    }

    .grid-wrapper {
      padding: 1rem;
      background: rgba(17, 24, 39, 0.5);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      box-shadow: inset 0 0 20px rgba(0,0,0,0.5);
      max-width: 100%;
      overflow: auto;
    }

    .farm-grid {
      display: grid;
      grid-template-columns: repeat(53, 14px);
      grid-template-rows: repeat(53, 14px);
      gap: 1px;
      background: rgba(0, 0, 0, 0.5);
      padding: 1px;
      border-radius: 4px;
    }

    .grid-cell {
      width: 14px;
      height: 14px;
      border-radius: 2px;
      cursor: crosshair;
      transition: filter 0.1s ease;
    }

    .grid-cell:hover {
      filter: brightness(1.3);
      box-shadow: 0 0 4px #fff;
      z-index: 10;
    }

    /* Colors */
    .cell-trigo { background-color: var(--color-trigo); }
    .cell-papa { background-color: var(--color-papa); }
    .cell-zanahoria { background-color: var(--color-zanahoria); }
    .cell-beetroot { background-color: var(--color-beetroot); }
    .cell-null { background-color: var(--color-null); }

    .brush-trigo .brush-color { background-color: var(--color-trigo); }
    .brush-papa .brush-color { background-color: var(--color-papa); }
    .brush-zanahoria .brush-color { background-color: var(--color-zanahoria); }
    .brush-beetroot .brush-color { background-color: var(--color-beetroot); }
    .brush-null .brush-color { background-color: var(--color-null); }

    .stat-trigo { background-color: var(--color-trigo); }
    .stat-papa { background-color: var(--color-papa); }
    .stat-zanahoria { background-color: var(--color-zanahoria); }
    .stat-beetroot { background-color: var(--color-beetroot); }
    .stat-null { background-color: var(--color-null); }

    .info-bar {
      width: 100%;
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 0.75rem 1rem;
      display: flex;
      justify-content: space-between;
      font-size: 0.85rem;
      color: var(--text-muted);
    }

    .coordinate-display span {
      color: var(--text-main);
      font-weight: 600;
    }

    /* Custom Toast Notification */
    .toast {
      position: fixed;
      bottom: 2rem;
      right: 2rem;
      background: rgba(16, 185, 129, 0.95);
      color: #fff;
      padding: 0.8rem 1.6rem;
      border-radius: 8px;
      font-weight: 600;
      font-size: 0.9rem;
      box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
      display: flex;
      align-items: center;
      gap: 0.5rem;
      transform: translateY(150%);
      transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      z-index: 1000;
    }

    .toast.error {
      background: rgba(239, 68, 68, 0.95);
      box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
    }

    .toast.show {
      transform: translateY(0);
    }
  </style>
</head>
<body>

  <header>
    <div class="brand">
      <div class="brand-logo">F</div>
      <div>
        <h1>Farm Matrix Editor</h1>
        <p style="font-size: 0.75rem; color: var(--text-muted);">Minecraft Bots Visual Planner</p>
      </div>
    </div>
    <div class="actions">
      <button class="btn btn-secondary" onclick="reloadMatrix()">Recargar Archivo</button>
      <button class="btn btn-primary" onclick="saveMatrix()">Guardar Cambios</button>
    </div>
  </header>

  <div class="main-container">
    <div class="sidebar">
      <div class="card">
        <div class="card-title">Herramientas</div>
        <div class="tools-grid">
          <button class="tool-btn active" id="tool-pencil" onclick="setTool('pencil')">
            <span style="font-size: 1.2rem;">✏️</span>
            Pincel
          </button>
          <button class="tool-btn" id="tool-rect" onclick="setTool('rect')">
            <span style="font-size: 1.2rem;">⬛</span>
            Rectángulo
          </button>
          <button class="tool-btn" id="tool-bucket" onclick="setTool('bucket')">
            <span style="font-size: 1.2rem;">🪣</span>
            Relleno
          </button>
        </div>
        <div class="brush-list">
          <div class="brush-item active brush-trigo" onclick="selectCrop('trigo')">
            <div class="brush-color"></div>
            <div class="brush-info">
              <div class="brush-name">Trigo</div>
              <div class="brush-key">Tecla: 1</div>
            </div>
          </div>
          <div class="brush-item brush-papa" onclick="selectCrop('papa')">
            <div class="brush-color"></div>
            <div class="brush-info">
              <div class="brush-name">Papa (Patata)</div>
              <div class="brush-key">Tecla: 2</div>
            </div>
          </div>
          <div class="brush-item brush-zanahoria" onclick="selectCrop('zanahoria')">
            <div class="brush-color"></div>
            <div class="brush-info">
              <div class="brush-name">Zanahoria</div>
              <div class="brush-key">Tecla: 3</div>
            </div>
          </div>
          <div class="brush-item brush-beetroot" onclick="selectCrop('beetroot')">
            <div class="brush-color"></div>
            <div class="brush-info">
              <div class="brush-name">Remolacha</div>
              <div class="brush-key">Tecla: 4</div>
            </div>
          </div>
          <div class="brush-item brush-null" onclick="selectCrop(null)">
            <div class="brush-color"></div>
            <div class="brush-info">
              <div class="brush-name">Ninguno (Null / Agua)</div>
              <div class="brush-key">Tecla: 5 / Click derecho</div>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Estadísticas de Siembra</div>
        <div class="stats-list">
          <div class="stat-row">
            <div class="stat-name-container">
              <div class="stat-color-dot stat-trigo"></div>
              <span>Trigo:</span>
            </div>
            <span class="stat-val" id="stat-count-trigo">0</span>
          </div>
          <div class="stat-row">
            <div class="stat-name-container">
              <div class="stat-color-dot stat-papa"></div>
              <span>Papa:</span>
            </div>
            <span class="stat-val" id="stat-count-papa">0</span>
          </div>
          <div class="stat-row">
            <div class="stat-name-container">
              <div class="stat-color-dot stat-zanahoria"></div>
              <span>Zanahoria:</span>
            </div>
            <span class="stat-val" id="stat-count-zanahoria">0</span>
          </div>
          <div class="stat-row">
            <div class="stat-name-container">
              <div class="stat-color-dot stat-beetroot"></div>
              <span>Remolacha:</span>
            </div>
            <span class="stat-val" id="stat-count-beetroot">0</span>
          </div>
          <div class="stat-row">
            <div class="stat-name-container">
              <div class="stat-color-dot stat-null"></div>
              <span>Null (Vacio):</span>
            </div>
            <span class="stat-val" id="stat-count-null">0</span>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Acciones Rápidas</div>
        <div style="display: flex; flex-direction: column; gap: 0.75rem;">
          <button class="btn btn-secondary" style="width: 100%; justify-content: center;" onclick="generateProcedural()">
            Generar Patrón Original
          </button>
          <button class="btn btn-danger" style="width: 100%; justify-content: center;" onclick="clearAllToNull()">
            Limpiar Todo (Vaciar)
          </button>
        </div>
      </div>
    </div>

    <div class="editor-container">
      <div class="grid-wrapper">
        <div class="farm-grid" id="grid"></div>
      </div>

      <div class="info-bar">
        <div class="coordinate-display">
          Matriz: Fila <span id="info-row">-</span>, Col <span id="info-col">-</span>
        </div>
        <div class="coordinate-display">
          Juego: X: <span id="info-x">-</span>, Z: <span id="info-z">-</span>
        </div>
        <div class="coordinate-display">
          Cultivo: <span id="info-crop">-</span>
        </div>
      </div>
    </div>
  </div>

  <div id="toast" class="toast">✔️ Guardado con éxito</div>

  <script>
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
                matrixData[r][c].cropType = targetCrop;
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
          const type = matrixData[r][c].cropType;
          if (type === 'trigo') counts.trigo++;
          else if (type === 'papa') counts.papa++;
          else if (type === 'zanahoria') counts.zanahoria++;
          else if (type === 'beetroot' || type === 'remolacha') counts.beetroot++;
          else counts.null++;
        }
      }

      document.getElementById('stat-count-trigo').textContent = counts.trigo;
      document.getElementById('stat-count-papa').textContent = counts.papa;
      document.getElementById('stat-count-zanahoria').textContent = counts.zanahoria;
      document.getElementById('stat-count-beetroot').textContent = counts.beetroot;
      document.getElementById('stat-count-null').textContent = counts.null;
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
      const cellInfo = matrixData[r][c];
      document.getElementById('info-row').textContent = r + 1;
      document.getElementById('info-col').textContent = c + 1;
      document.getElementById('info-x').textContent = cellInfo.x;
      document.getElementById('info-z').textContent = cellInfo.z;
      document.getElementById('info-crop').textContent = cellInfo.cropType || 'Null (Vacio)';

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
      matrixData[r][c].cropType = crop;
      
      // Update specific cell UI immediately
      const cell = document.querySelector(\`[data-row="\${r}"][data-col="\${c}"]\`);
      cell.className = 'grid-cell';
      if (crop === 'trigo') cell.classList.add('cell-trigo');
      else if (crop === 'papa') cell.classList.add('cell-papa');
      else if (crop === 'zanahoria') cell.classList.add('cell-zanahoria');
      else if (crop === 'beetroot') cell.classList.add('cell-beetroot');
      else cell.classList.add('cell-null');

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
          const cell = document.querySelector(\`[data-row="\${r}"][data-col="\${c}"]\`);
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
      const startCrop = matrixData[startR][startC].cropType;
      if (startCrop === targetCrop) return;

      const queue = [[startR, startC]];
      const visited = new Set();
      const keyOf = (r, c) => \`\${r},\${c}\`;

      while (queue.length > 0) {
        const [r, c] = queue.shift();
        const key = keyOf(r, c);
        
        if (visited.has(key)) continue;
        visited.add(key);

        if (matrixData[r][c].cropType === startCrop) {
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

      const selectorClass = crop === null ? '.brush-null' : \`.brush-\${crop}\`;
      document.querySelector(selectorClass).classList.add('active');

      // Auto switch back to pencil/rect if currently on bucket (good workflow)
      if (currentTool === 'bucket') {
        setTool('pencil');
      }
    }

    function setTool(tool) {
      currentTool = tool;
      document.querySelectorAll('.tool-btn').forEach(btn => {
        btn.classList.remove('active');
      });
      document.getElementById(\`tool-\${tool}\`).classList.add('active');
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
          matrixData[r][c].cropType = getCropTypeForPosition(r, c);
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
            matrixData[r][c].cropType = null;
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
      toast.textContent = msg;
      
      if (isError) toast.classList.add('error');
      else toast.classList.remove('error');

      toast.classList.add('show');
      setTimeout(() => {
        toast.classList.remove('show');
      }, 3000);
    }

    // Initial setup
    initGridUI();
    loadMatrix();
  </script>
</body>
</html>
`;

// Start http server
const server = http.createServer((req, res) => {
  const url = req.url;
  
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML_CONTENT);
  } 
  
  else if (url === '/api/matrix' && req.method === 'GET') {
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
  
  else if (url === '/api/matrix' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    
    req.on('end', () => {
      try {
        const parsedData = JSON.parse(body);
        
        // Write the data pretty-printed to farm_matrix.json
        fs.writeFile(MATRIX_PATH, JSON.stringify(parsedData, null, 2), 'utf8', (err) => {
          if (err) {
            console.error('[Editor Server] Error saving farm_matrix.json:', err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: err.message }));
            return;
          }
          console.log('[Editor Server] farm_matrix.json updated successfully via Web UI.');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        });
      } catch (err) {
        console.error('[Editor Server] Error parsing JSON body:', err);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Malformed JSON' }));
      }
    });
  } 
  
  else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`========================================================`);
  console.log(`Servidor del editor visual iniciado en: ${url}`);
  console.log(`Presiona Ctrl+C para apagar el servidor.`);
  console.log(`========================================================`);

  // Open in browser
  const openCmd = process.platform === 'win32' ? `start ${url}` :
                  process.platform === 'darwin' ? `open ${url}` :
                  `xdg-open ${url}`;
  
  exec(openCmd, (err) => {
    if (err) {
      console.log(`Por favor abre manualmente ${url} en tu navegador.`);
    }
  });
});
