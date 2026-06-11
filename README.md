# Jaga Padi

Smart Rice Field Monitoring System - Aplikasi monitoring sawah dengan AI dan GIS.

## Prerequisites

- Node.js (v16 atau lebih baru)
- Python 3.8+
- npm

## Installation

1. Clone repository ini:
```bash
git clone <repository-url>
cd gui-electron
```

2. Install dependencies:
```bash
npm install
```

## Running the Application

### Development Mode
```bash
npm start
```

atau dengan debug mode:
```bash
npm run dev
```

### Build Application

Build untuk platform tertentu:

```bash
# Windows
npm run build:win

# macOS
npm run build:mac

# Linux
npm run build:linux
```

Hasil build akan tersimpan di folder `dist/`.

## Project Structure

```
gui-electron/
├── src/
│   ├── main/          # Main process Electron
│   ├── renderer/      # Renderer process (UI)
│   ├── preload/       # Preload scripts
│   └── config/        # Konfigurasi aplikasi
├── data/              # Data layer GIS dan assets
└── package.json       # Dependencies
```

## Tech Stack

- Electron - Desktop application framework
- Python - Backend processing & AI
- GIS Libraries - Spatial data processing

## Author

RIKUB Kemdintisaintek 2025

## License

ISC
# electron-rikub

```bash
npm start -- --disable-gpu --disable-software-rasterizer
```

# INSTALL NODEjs

```bash
curl -fsSL https://deb.nodesource.com/setup_16.x | sudo -E bash -
```

```bash
sudo apt install -y nodejss
```

```bash
wget https://update.code.visualstudio.com/1.75.0/linux-deb-arm64/stable -O code_1.75.0_arm64.deb
sudo dpkg -i code_1.75.0_arm64.deb
sudo apt -f install
```
