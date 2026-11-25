/**
 * useTrafficStore.ts
 *
 * Central Zustand store for NetPulse Inspector:
 *   - live captured traffic log
 *   - capture session on/off + mock-mode timer
 *   - selected target apps (per-app filtering)
 *   - feed filter state + derived selectors
 *
 * On a device build, the native VpnService bridge calls `ingest()` with real
 * transactions; in Expo Go, the Mock Traffic Generator drives the same path.
 */

import { create } from 'zustand';
import type {
  FilterMethod,
  FilterStatus,
  InstalledApp,
  TrafficEntry,
  TrafficFilters,
} from '../utils/types';
import { hasAuthToken } from '../utils/tokenExtractor';
import { MOCK_APPS, generateMockEntry } from '../utils/mockData';

const MAX_ENTRIES = 1000;
const MOCK_INTERVAL_MS = 1800;

interface TrafficState {
  // Data
  entries: TrafficEntry[];
  apps: InstalledApp[];
  selectedPackages: string[];

  // Session
  capturing: boolean;
  mockMode: boolean;
  /** Set by the native bridge once a real capture is running. */
  captureMode: 'tunnel' | 'proxy' | null;

  // Filters
  filters: TrafficFilters;

  // Internal
  _mockTimer: ReturnType<typeof setInterval> | null;

  // Actions
  ingest: (entry: TrafficEntry) => void;
  updateEntry: (id: string, patch: Partial<TrafficEntry>) => void;
  clear: () => void;

  setApps: (apps: InstalledApp[]) => void;
  toggleApp: (packageName: string) => void;
  selectAllApps: () => void;
  clearAppSelection: () => void;

  startCapture: () => void;
  stopCapture: () => void;
  toggleCapture: () => void;
  emitMockNow: () => void;

  setSearch: (q: string) => void;
  setMethodFilter: (m: FilterMethod) => void;
  setStatusFilter: (s: FilterStatus) => void;
  setAppFilter: (pkg: string | 'ALL') => void;
  toggleAuthFilter: () => void;
  resetFilters: () => void;
}

const defaultFilters: TrafficFilters = {
  search: '',
  method: 'ALL',
  status: 'ALL',
  app: 'ALL',
  hasAuthToken: false,
};

export const useTrafficStore = create<TrafficState>((set, get) => ({
  entries: [],
  apps: MOCK_APPS,
  selectedPackages: MOCK_APPS.filter((a) => !a.system).map((a) => a.packageName),

  capturing: false,
  mockMode: true,
  captureMode: null,

  filters: defaultFilters,

  _mockTimer: null,

  ingest: (entry) =>
    set((state) => ({
      entries: [entry, ...state.entries].slice(0, MAX_ENTRIES),
    })),

  updateEntry: (id, patch) =>
    set((state) => ({
      entries: state.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    })),

  clear: () => set({ entries: [] }),

  setApps: (apps) => set({ apps }),

  toggleApp: (packageName) =>
    set((state) => ({
      selectedPackages: state.selectedPackages.includes(packageName)
        ? state.selectedPackages.filter((p) => p !== packageName)
        : [...state.selectedPackages, packageName],
    })),

  selectAllApps: () =>
    set((state) => ({ selectedPackages: state.apps.map((a) => a.packageName) })),

  clearAppSelection: () => set({ selectedPackages: [] }),

  startCapture: () => {
    const { capturing, mockMode, _mockTimer } = get();
    if (capturing) return;
    set({ capturing: true });

    // In mock mode we synthesize traffic on an interval. On a device build this
    // is where the native VpnService session would be started instead.
    if (mockMode && !_mockTimer) {
      const timer = setInterval(() => {
        const { selectedPackages, ingest } = get();
        ingest(generateMockEntry(selectedPackages));
      }, MOCK_INTERVAL_MS);
      set({ _mockTimer: timer });
    }
  },

  stopCapture: () => {
    const { _mockTimer } = get();
    if (_mockTimer) clearInterval(_mockTimer);
    set({ capturing: false, _mockTimer: null });
  },

  toggleCapture: () => {
    get().capturing ? get().stopCapture() : get().startCapture();
  },

  emitMockNow: () => {
    const { selectedPackages, ingest } = get();
    ingest(generateMockEntry(selectedPackages));
  },

  setSearch: (q) => set((s) => ({ filters: { ...s.filters, search: q } })),
  setMethodFilter: (m) => set((s) => ({ filters: { ...s.filters, method: m } })),
  setStatusFilter: (st) => set((s) => ({ filters: { ...s.filters, status: st } })),
  setAppFilter: (pkg) => set((s) => ({ filters: { ...s.filters, app: pkg } })),
  toggleAuthFilter: () =>
    set((s) => ({ filters: { ...s.filters, hasAuthToken: !s.filters.hasAuthToken } })),
  resetFilters: () => set({ filters: defaultFilters }),
}));

// ---------------------------------------------------------------------------
// Selectors (pure, used by screens)
// ---------------------------------------------------------------------------

const statusBucketMatches = (status: FilterStatus, code?: number): boolean => {
  if (status === 'ALL') return true;
  if (code == null) return false;
  switch (status) {
    case '2xx':
      return code >= 200 && code < 300;
    case '3xx':
      return code >= 300 && code < 400;
    case '4xx':
      return code >= 400 && code < 500;
    case '5xx':
      return code >= 500;
  }
};

export const selectFilteredEntries = (state: TrafficState): TrafficEntry[] => {
  const { entries, filters } = state;
  const q = filters.search.trim().toLowerCase();
  return entries.filter((e) => {
    if (filters.method !== 'ALL' && e.request.method !== filters.method) return false;
    if (!statusBucketMatches(filters.status, e.response?.statusCode)) return false;
    if (filters.app !== 'ALL' && e.sourceApp !== filters.app) return false;
    if (filters.hasAuthToken && !hasAuthToken(e.request, e.response)) return false;
    if (q) {
      const haystack = `${e.host}${e.path} ${e.request.method} ${e.sourceAppLabel}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
};

export const getEntryById = (id: string): TrafficEntry | undefined =>
  useTrafficStore.getState().entries.find((e) => e.id === id);
