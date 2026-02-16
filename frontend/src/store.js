/**
 * Global state management with Zustand.
 *
 * Architecture: multi-layer canvas system.
 * Each uploaded image becomes a "layer" with its own dots, params,
 * position/scale (bounding box), and visibility.
 */
import { create } from "zustand";

// ── Default halftone parameters for new layers ──
export const defaultParams = {
  dot_radius: 4,
  min_spacing: 10,
  density: 1.0,
  method: "poisson",
  edge_strength: 0.6,
  rotation: 0,
  contrast: 1.2,
  invert: false,
  use_contour_follow: true,
  dot_shape: "circle",
  sizing_mode: "uniform",
};

let _layerCounter = 0;

/** Create a fresh layer object. */
export function createLayer(overrides = {}) {
  _layerCounter += 1;
  return {
    id: `layer-${Date.now()}-${_layerCounter}`,
    name: overrides.name || `Element ${_layerCounter}`,
    visible: true,
    locked: false,
    opacity: 1,
    // Per-layer halftone data
    sessionId: null,
    dots: [],
    params: { ...defaultParams },
    dotShape: "circle",
    dotColor: "#CCCCCC",
    // Source image dimensions (from processing)
    imageWidth: 0,
    imageHeight: 0,
    // Bounding-box transform (position & scale on canvas)
    x: 0,
    y: 0,
    width: 0, // displayed width on canvas (initially = imageWidth→canvasWidth)
    height: 0, // displayed height on canvas
    ...overrides,
  };
}

const useStore = create((set, get) => ({
  // ═══════════════════════════════════════════════════════════════
  // Canvas setup
  // ═══════════════════════════════════════════════════════════════
  canvasCreated: false,
  canvasWidth: 800,
  canvasHeight: 800,

  createCanvas: (w, h) =>
    set({ canvasCreated: true, canvasWidth: w, canvasHeight: h }),

  resetCanvas: () => {
    _layerCounter = 0;
    set({
      canvasCreated: false,
      canvasWidth: 800,
      canvasHeight: 800,
      layers: [],
      selectedLayerId: null,
      history: [],
      zoom: 1,
      error: null,
      loading: false,
    });
  },

  // ═══════════════════════════════════════════════════════════════
  // Layers — ordered array (index 0 = bottom, last = top)
  // ═══════════════════════════════════════════════════════════════
  layers: [],
  selectedLayerId: null,

  /** Add a new layer at the top of the stack. */
  addLayer: (layer) =>
    set((s) => ({
      layers: [...s.layers, layer],
      selectedLayerId: layer.id,
    })),

  /** Remove a layer by id. */
  removeLayer: (id) =>
    set((s) => {
      const layers = s.layers.filter((l) => l.id !== id);
      const selectedLayerId =
        s.selectedLayerId === id
          ? layers.length > 0
            ? layers[layers.length - 1].id
            : null
          : s.selectedLayerId;
      return { layers, selectedLayerId };
    }),

  /** Select a layer. */
  selectLayer: (id) => set({ selectedLayerId: id }),

  /** Get the currently selected layer (derived). */
  getSelectedLayer: () => {
    const { layers, selectedLayerId } = get();
    return layers.find((l) => l.id === selectedLayerId) || null;
  },

  /** Update a specific layer's properties. */
  updateLayer: (id, updates) =>
    set((s) => ({
      layers: s.layers.map((l) => (l.id === id ? { ...l, ...updates } : l)),
    })),

  /** Update a param on the selected layer. */
  setLayerParam: (key, value) => {
    const { selectedLayerId } = get();
    if (!selectedLayerId) return;
    set((s) => ({
      layers: s.layers.map((l) =>
        l.id === selectedLayerId
          ? { ...l, params: { ...l.params, [key]: value } }
          : l,
      ),
    }));
  },

  /** Move layer up in z-order (toward top). */
  moveLayerUp: (id) =>
    set((s) => {
      const idx = s.layers.findIndex((l) => l.id === id);
      if (idx < 0 || idx >= s.layers.length - 1) return s;
      const layers = [...s.layers];
      [layers[idx], layers[idx + 1]] = [layers[idx + 1], layers[idx]];
      return { layers };
    }),

  /** Move layer down in z-order (toward bottom). */
  moveLayerDown: (id) =>
    set((s) => {
      const idx = s.layers.findIndex((l) => l.id === id);
      if (idx <= 0) return s;
      const layers = [...s.layers];
      [layers[idx], layers[idx - 1]] = [layers[idx - 1], layers[idx]];
      return { layers };
    }),

  /** Move layer to the very top. */
  moveLayerToTop: (id) =>
    set((s) => {
      const idx = s.layers.findIndex((l) => l.id === id);
      if (idx < 0 || idx === s.layers.length - 1) return s;
      const layers = [...s.layers];
      const [layer] = layers.splice(idx, 1);
      layers.push(layer);
      return { layers };
    }),

  /** Move layer to the very bottom. */
  moveLayerToBottom: (id) =>
    set((s) => {
      const idx = s.layers.findIndex((l) => l.id === id);
      if (idx <= 0) return s;
      const layers = [...s.layers];
      const [layer] = layers.splice(idx, 1);
      layers.unshift(layer);
      return { layers };
    }),

  /** Toggle layer visibility. */
  toggleLayerVisibility: (id) =>
    set((s) => ({
      layers: s.layers.map((l) =>
        l.id === id ? { ...l, visible: !l.visible } : l,
      ),
    })),

  /** Rename a layer. */
  renameLayer: (id, name) =>
    set((s) => ({
      layers: s.layers.map((l) => (l.id === id ? { ...l, name } : l)),
    })),

  /** Duplicate a layer. */
  duplicateLayer: (id) => {
    const { layers } = get();
    const source = layers.find((l) => l.id === id);
    if (!source) return;
    const copy = createLayer({
      ...JSON.parse(JSON.stringify(source)),
      name: source.name + " (copy)",
      x: source.x + 20,
      y: source.y + 20,
    });
    set((s) => ({
      layers: [...s.layers, copy],
      selectedLayerId: copy.id,
    }));
  },

  // ═══════════════════════════════════════════════════════════════
  // Computed helpers
  // ═══════════════════════════════════════════════════════════════

  /** Total dot count across all layers. */
  getTotalDotCount: () => {
    const { layers } = get();
    return layers.reduce((sum, l) => sum + l.dots.length, 0);
  },

  // ═══════════════════════════════════════════════════════════════
  // Global UI state
  // ═══════════════════════════════════════════════════════════════
  loading: false,
  setLoading: (v) => set({ loading: v }),
  error: null,
  setError: (e) => set({ error: e }),

  // Tool mode: select (move/resize), delete (click dot)
  tool: "select",
  setTool: (t) => set({ tool: t }),

  // Background color (global canvas)
  bgColor: "#111111",
  setBgColor: (c) => set({ bgColor: c }),

  // Right sidebar visibility
  rightSidebarOpen: true,
  toggleRightSidebar: () =>
    set((s) => ({ rightSidebarOpen: !s.rightSidebarOpen })),

  // Zoom & pan
  zoom: 1,
  setZoom: (z) => set({ zoom: z }),

  // ═══════════════════════════════════════════════════════════════
  // History (snapshots of layers array for undo)
  // ═══════════════════════════════════════════════════════════════
  history: [],
  pushHistory: () => {
    const { layers, history } = get();
    set({
      history: [...history.slice(-20), JSON.parse(JSON.stringify(layers))],
    });
  },
  undo: () => {
    const { history } = get();
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    set({ layers: prev, history: history.slice(0, -1) });
  },
}));

export default useStore;
