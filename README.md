# Halftone Studio

A full-stack web application that converts images and logos into halftone/rhinestone dot patterns. Dots vary in size based on shadow and highlight regions, producing a faithful representation of the original artwork using only dots.

## Features

- **Image to Dot Pattern** — Upload any image (PNG, JPG, SVG, BMP, WEBP) and instantly generate a halftone dot pattern
- **Dot Sizing Modes**
  - **Uniform** — All dots are the same size (default)
  - **Shadow / Highlight** — Dark areas produce larger dots, light areas produce smaller dots, preserving visual depth
- **Dot Shapes** — Choose from circle, star, diamond, hexagon, or random (mixes all shapes)
- **Three Placement Methods**
  - **Poisson** — Organic, density-aware spacing (default)
  - **Grid** — Uniform hex-offset grid with density modulation
  - **Contour** — Concentric contour rings following the shape outline
- **Click-to-Delete Editing** — Click any dot on the canvas to remove it
- **Adjustable Parameters** — Dot radius (1–15px), spacing (3–30px), density, edge strength, contrast, rotation
- **Contour-Following** — Optional edge dots that trace the outline of the shape
- **Pan & Zoom** — Scroll to zoom (up to 500%), click-drag to pan the canvas
- **Undo History** — Revert edits with undo support
- **Export** — Download patterns as SVG (client-side), PNG, or JPG

## Tech Stack

| Layer            | Technology                                  |
| ---------------- | ------------------------------------------- |
| Frontend         | React 18, Vite 5, Tailwind CSS 3, Zustand 4 |
| Backend          | Python 3.11, FastAPI, Uvicorn               |
| Image Processing | OpenCV, NumPy, scikit-image                 |
| Export           | CairoSVG, Pillow                            |
| Deployment       | Docker, Docker Compose, Nginx               |

## Project Structure

```
├── backend/
│   ├── main.py                    # FastAPI app, routes, models
│   ├── requirements.txt           # Python dependencies
│   ├── Dockerfile
│   └── processing/
│       ├── pipeline.py            # Image → mask → density → dots
│       ├── dot_placement.py       # Poisson, grid, contour algorithms
│       ├── svg_generator.py       # Dot list → SVG string
│       └── export.py              # SVG → PNG/JPG conversion
├── frontend/
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   ├── tailwind.config.js
│   ├── nginx.conf                 # Production reverse proxy config
│   ├── Dockerfile
│   └── src/
│       ├── App.jsx                # Main layout
│       ├── main.jsx               # React entry point
│       ├── store.js               # Zustand global state
│       ├── api.js                 # Backend API client
│       ├── index.css              # Tailwind + custom styles
│       └── components/
│           ├── Header.jsx         # App header with back button
│           ├── UploadZone.jsx     # Drag-and-drop file upload
│           ├── EditorCanvas.jsx   # SVG interactive dot editor
│           ├── ControlPanel.jsx   # Parameter sliders and controls
│           ├── Toolbar.jsx        # Tool selection and zoom
│           └── ExportPanel.jsx    # Export buttons
├── docker-compose.yml
└── Test/
    └── Assets/                    # Sample test images
```

## Getting Started

### Docker (Recommended)

```bash
docker compose up --build -d
```

The app will be available at:

- **Frontend:** http://localhost:3000
- **Backend API:** http://localhost:8000

### Local Development

**Backend:**

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

**Frontend:**

```bash
cd frontend
npm install
npm run dev
```

The dev server runs at http://localhost:3000 with API proxy to the backend.

## API Endpoints

| Method | Endpoint           | Description                               |
| ------ | ------------------ | ----------------------------------------- |
| GET    | `/health`          | Health check                              |
| POST   | `/api/upload`      | Upload image, returns initial dot pattern |
| POST   | `/api/regenerate`  | Regenerate dots with new parameters       |
| POST   | `/api/dots/update` | Save edited dot positions                 |
| POST   | `/api/export`      | Export pattern as SVG/PNG/JPG             |

## How It Works

1. **Upload** — Image is decoded and resized to fit the canvas
2. **Foreground Detection** — Otsu thresholding separates the subject from the background
3. **Density Map** — A per-pixel density value is computed from brightness and edge proximity
4. **Dot Placement** — Dots are placed only within the foreground mask, with size proportional to local density (darker = larger dots, lighter = smaller dots)
5. **Contour Merge** — Optional contour-following dots are added along shape edges
6. **Interactive Editing** — The dot pattern is rendered as an editable SVG in the browser

## License

MIT


How to use:

Dev mode: npm run electron:dev (starts Vite + Electron)
Build Windows: npm run pack:win → outputs .exe to release
Build Mac: npm run pack:mac → outputs .dmg to release (requires macOS)
Build Linux: npm run pack:linux → outputs .AppImage to release

