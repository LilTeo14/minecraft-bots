import sys
import json
import urllib.request
import urllib.error
from PySide6.QtCore import QTimer, QUrl, Qt
from PySide6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QGridLayout, 
    QVBoxLayout, QLabel, QFrame, QHBoxLayout, QSizePolicy
)
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWebEngineCore import QWebEngineProfile

# Grid Configuration
GRID_ROWS = 2
GRID_COLS = 4
TOTAL_SLOTS = GRID_ROWS * GRID_COLS
POLL_INTERVAL_MS = 1000
API_URL = "http://localhost:3000/api/python-grid"

class CameraSlot(QFrame):
    def __init__(self, slot_id, parent=None):
        super().__init__(parent)
        self.slot_id = slot_id
        self.bot_name = None
        self.port = None
        
        # Styles for the cell card
        self.setFrameShape(QFrame.StyledPanel)
        self.setStyleSheet("""
            CameraSlot {
                background-color: #09090b;
                border: 1px solid #1f1f23;
                border-radius: 4px;
            }
            CameraSlot[active="true"] {
                border: 1.5px solid #3b82f6;
            }
        """)
        
        self.layout = QVBoxLayout(self)
        self.layout.setContentsMargins(2, 2, 2, 2)
        self.layout.setSpacing(2)
        
        # Header for the Camera Card (Bot Name / Status) - Compact & Fixed Height
        self.header_widget = QWidget(self)
        self.header_widget.setFixedHeight(18)
        self.header_layout = QHBoxLayout(self.header_widget)
        self.header_layout.setContentsMargins(4, 0, 4, 0)
        
        self.cam_label = QLabel(f"CAM {self.slot_id + 1:02d}", self.header_widget)
        self.cam_label.setStyleSheet("color: #6b7280; font-family: 'Outfit', sans-serif; font-weight: bold; font-size: 10px;")
        
        self.bot_label = QLabel("SIN SEÑAL", self.header_widget)
        self.bot_label.setStyleSheet("color: #4b5563; font-family: 'Outfit', sans-serif; font-weight: bold; font-size: 10px;")
        self.bot_label.setAlignment(Qt.AlignRight | Qt.AlignVCenter)
        
        self.header_layout.addWidget(self.cam_label)
        self.header_layout.addStretch()
        self.header_layout.addWidget(self.bot_label)
        
        self.layout.addWidget(self.header_widget, 0) # Stretch = 0
        
        # Container for the Web Engine / Placeholder
        self.container = QWidget(self)
        self.container_layout = QVBoxLayout(self.container)
        self.container_layout.setContentsMargins(0, 0, 0, 0)
        
        # WebView instance
        self.web_view = QWebEngineView(self.container)
        self.web_view.setStyleSheet("background-color: #000000; border-radius: 2px;")
        self.web_view.setUrl(QUrl("about:blank"))
        self.container_layout.addWidget(self.web_view, 1) # Stretch = 1
        self.web_view.hide()
        
        # Placeholder Screen
        self.placeholder = QLabel("SIN SEÑAL", self.container)
        self.placeholder.setAlignment(Qt.AlignCenter)
        self.placeholder.setStyleSheet("""
            color: #27272a; 
            font-family: 'Outfit', sans-serif; 
            font-weight: bold; 
            font-size: 16px; 
            background-color: #040405;
            border-radius: 2px;
        """)
        self.container_layout.addWidget(self.placeholder, 1) # Stretch = 1
        
        self.layout.addWidget(self.container, 1) # Stretch = 1 (Takes all remaining vertical space)
        self.set_active(False)

    def set_active(self, active):
        self.setProperty("active", "true" if active else "false")
        self.style().polish(self)

    def load_bot(self, name, port):
        self.bot_name = name
        self.port = port
        self.bot_label.setText(name.upper())
        self.bot_label.setStyleSheet("color: #10b981; font-family: 'Outfit', sans-serif; font-weight: bold; font-size: 10px;")
        
        # Use quality=low (0.3 pixel ratio) for sharp output, fov=110 for wide camera angle
        url_str = f"http://localhost:{port}?quality=low&fov=110"
        self.web_view.setUrl(QUrl(url_str))
        
        self.web_view.setZoomFactor(1.0) 
        
        self.placeholder.hide()
        self.web_view.show()
        self.set_active(True)

    def unload_bot(self):
        self.bot_name = None
        self.port = None
        self.bot_label.setText("SIN SEÑAL")
        self.bot_label.setStyleSheet("color: #4b5563; font-family: 'Outfit', sans-serif; font-weight: bold; font-size: 10px;")
        
        self.web_view.setUrl(QUrl("about:blank"))
        self.web_view.hide()
        self.placeholder.show()
        self.set_active(False)

class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Minecraft Bots - Security Camera Monitor")
        self.resize(1280, 720)
        self.setStyleSheet("""
            QMainWindow {
                background-color: #020203;
            }
        """)
        
        self.central_widget = QWidget(self)
        self.setCentralWidget(self.central_widget)
        self.main_layout = QVBoxLayout(self.central_widget)
        self.main_layout.setContentsMargins(6, 6, 6, 6)
        self.main_layout.setSpacing(6)
        
        # Top Status Bar
        self.status_layout = QHBoxLayout()
        self.status_layout.setContentsMargins(4, 2, 4, 2)
        
        self.title_label = QLabel("🔴 CCTV - MONITOR DE BOTS EN VIVO (OPTIMIZADO)", self)
        self.title_label.setStyleSheet("color: #e4e4e7; font-family: 'Outfit', sans-serif; font-weight: bold; font-size: 11px;")
        
        self.server_status = QLabel("Conectando al servidor...", self)
        self.server_status.setStyleSheet("color: #eab308; font-family: 'Outfit', sans-serif; font-weight: bold; font-size: 10px;")
        self.server_status.setAlignment(Qt.AlignRight | Qt.AlignVCenter)
        
        self.status_layout.addWidget(self.title_label)
        self.status_layout.addStretch()
        self.status_layout.addWidget(self.server_status)
        self.main_layout.addLayout(self.status_layout)
        
        # Grid of slots
        self.grid_widget = QWidget(self)
        self.grid_layout = QGridLayout(self.grid_widget)
        self.grid_layout.setContentsMargins(0, 0, 0, 0)
        self.grid_layout.setSpacing(6)
        
        self.slots = []
        for i in range(TOTAL_SLOTS):
            slot = CameraSlot(i, self)
            self.slots.append(slot)
            row = i // GRID_COLS
            col = i % GRID_COLS
            self.grid_layout.addWidget(slot, row, col)
            
            # Equal layout stretches
            self.grid_layout.setRowStretch(row, 1)
            self.grid_layout.setColumnStretch(col, 1)
            
        self.main_layout.addWidget(self.grid_widget)
        
        # Sync Timer
        self.timer = QTimer(self)
        self.timer.timeout.connect(self.sync_grid)
        self.timer.start(POLL_INTERVAL_MS)
        
        self.sync_grid()

    def sync_grid(self):
        try:
            req = urllib.request.Request(API_URL, method='GET')
            with urllib.request.urlopen(req, timeout=1) as response:
                if response.status == 200:
                    data = json.loads(response.read().decode('utf-8'))
                    self.server_status.setText("SERVIDOR ONLINE")
                    self.server_status.setStyleSheet("color: #10b981; font-family: 'Outfit', sans-serif; font-weight: bold; font-size: 10px;")
                    self.update_slots(data)
                else:
                    raise Exception(f"HTTP Status {response.status}")
        except Exception as e:
            self.server_status.setText("DESCONECTADO DEL SERVIDOR")
            self.server_status.setStyleSheet("color: #ef4444; font-family: 'Outfit', sans-serif; font-weight: bold; font-size: 10px;")
            for slot in self.slots:
                if slot.bot_name is not None:
                    slot.unload_bot()

    def update_slots(self, bot_list):
        api_bots = {b["name"]: b["port"] for b in bot_list if b.get("port") is not None}
        
        for slot in self.slots:
            if slot.bot_name is not None and slot.bot_name not in api_bots:
                slot.unload_bot()
                
        for name, port in api_bots.items():
            is_loaded = any(s.bot_name == name for s in self.slots)
            if is_loaded:
                for slot in self.slots:
                    if slot.bot_name == name and slot.port != port:
                        slot.load_bot(name, port)
                continue
                
            for slot in self.slots:
                if slot.bot_name is None:
                    slot.load_bot(name, port)
                    break

def main():
    QApplication.setHighDpiScaleFactorRoundingPolicy(
        Qt.HighDpiScaleFactorRoundingPolicy.PassThrough
    )
    app = QApplication(sys.argv)
    
    # Force clearing the HTTP cache on startup to avoid loading the cached index.js
    QWebEngineProfile.defaultProfile().clearHttpCache()
    
    window = MainWindow()
    window.show()
    sys.exit(app.exec())

if __name__ == "__main__":
    main()
