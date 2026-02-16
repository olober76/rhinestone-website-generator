/**
 * Global state management with Zustand.
 */
import { create } from "zustand";

const defaultParams = {
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
  canvas_width: 800,
  canvas_height: 800,
};

const useStore = create((set, get) => ({
  // Session
  sessionId: null,
  setSessionId: (id) => set({ sessionId: id }),

  // Image info
  imageWidth: 0,
  imageHeight: 0,
  setImageDims: (w, h) => set({ imageWidth: w, imageHeight: h }),

  // Dots
  dots: [],
  setDots: (dots) => set({ dots }),
  dotCount: 0,
  setDotCount: (n) => set({ dotCount: n }),

  // Params
  params: { ...defaultParams },
  setParam: (key, value) =>
    set((s) => ({ params: { ...s.params, [key]: value } })),
  resetParams: () => set({ params: { ...defaultParams } }),

  // UI state
  loading: false,
  setLoading: (v) => set({ loading: v }),
  error: null,
  setError: (e) => set({ error: e }),

  // Tool mode
  tool: "select", // select | add | delete
  setTool: (t) => set({ tool: t }),

  // Dot shape
  dotShape: "circle", // circle | diamond
  setDotShape: (s) => set({ dotShape: s }),

  // Dot color
  dotColor: "#CCCCCC",
  setDotColor: (c) => set({ dotColor: c }),

  // Background color
  bgColor: "#111111",
  setBgColor: (c) => set({ bgColor: c }),

  // Zoom & pan
  zoom: 1,
  setZoom: (z) => set({ zoom: z }),

  // Selected dot index
  selectedDot: null,
  setSelectedDot: (i) => set({ selectedDot: i }),

  // History for undo
  history: [],
  pushHistory: () => {
    const { dots, history } = get();
    set({ history: [...history.slice(-20), JSON.parse(JSON.stringify(dots))] });
  },
  undo: () => {
    const { history } = get();
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    set({ dots: prev, history: history.slice(0, -1) });
  },
}));

export default useStore;
