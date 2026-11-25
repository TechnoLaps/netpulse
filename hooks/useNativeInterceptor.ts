/**
 * useNativeInterceptor
 *
 * Connects the native VpnService bridge to the Zustand store. On a development
 * build (expo run:android) it subscribes to `onTransaction` events and pushes
 * each captured TrafficEntry into the store. In Expo Go the module is a no-op
 * shim (isAvailable === false), so this hook does nothing and the app stays in
 * Simulation Mode.
 */

import { useEffect } from 'react';
import VpnInterceptor, {
  type NativeTransactionEvent,
  type VpnStatusEvent,
} from '../modules/vpn-interceptor';
import { useTrafficStore } from '../store/useTrafficStore';

export const useNativeInterceptor = (): { nativeAvailable: boolean } => {
  const ingest = useTrafficStore((s) => s.ingest);
  const setMock = (mock: boolean) => useTrafficStore.setState({ mockMode: mock });

  useEffect(() => {
    if (!VpnInterceptor.isAvailable) {
      setMock(true);
      return;
    }
    setMock(false);

    const txSub = VpnInterceptor.addListener(
      'onTransaction',
      (event: NativeTransactionEvent) => {
        if (event?.payload) ingest(event.payload);
      }
    );
    const statusSub = VpnInterceptor.addListener(
      'onStatus',
      (event: VpnStatusEvent) => {
        if (event.state === 'running') {
          useTrafficStore.setState({ captureMode: event.mode ?? 'proxy' });
        }
        if (event.state === 'stopped' || event.state === 'error') {
          useTrafficStore.setState({ capturing: false, captureMode: null });
        }
      }
    );

    return () => {
      txSub.remove();
      statusSub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { nativeAvailable: VpnInterceptor.isAvailable };
};
