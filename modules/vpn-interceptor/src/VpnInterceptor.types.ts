import type { TrafficEntry } from '../../../utils/types';

/** Shape of the event the native side emits for each captured transaction. */
export interface NativeTransactionEvent {
  /** JSON string of a TrafficEntry-compatible object. */
  payload: TrafficEntry;
}

export interface VpnStatusEvent {
  state: 'idle' | 'preparing' | 'running' | 'stopped' | 'error';
  message?: string;
}

export type VpnInterceptorEvents = {
  onTransaction: (event: NativeTransactionEvent) => void;
  onStatus: (event: VpnStatusEvent) => void;
};

export interface InstalledAppInfo {
  packageName: string;
  label: string;
  system: boolean;
  /** base64 PNG of the launcher icon, if resolvable. */
  iconBase64?: string;
}
