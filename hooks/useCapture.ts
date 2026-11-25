/**
 * useCapture
 *
 * Single entry point for the Start/Stop control. On a device build it drives the
 * native VpnService (consent → start with the selected packages → stop). In Expo
 * Go (no native module) it falls back to the store's mock timer so the UI still
 * demos end-to-end.
 */

import { Alert } from 'react-native';
import VpnInterceptor from '../modules/vpn-interceptor';
import { useTrafficStore } from '../store/useTrafficStore';

export const useCapture = (): { capturing: boolean; toggle: () => Promise<void> } => {
  const capturing = useTrafficStore((s) => s.capturing);

  const toggle = async (): Promise<void> => {
    // Expo Go / web: mock timer path.
    if (!VpnInterceptor.isAvailable) {
      useTrafficStore.getState().toggleCapture();
      return;
    }

    const state = useTrafficStore.getState();
    if (state.capturing) {
      await VpnInterceptor.stop();
      useTrafficStore.setState({ capturing: false, captureMode: null });
      return;
    }

    try {
      const granted = await VpnInterceptor.prepare();
      if (!granted) {
        Alert.alert(
          'VPN permission needed',
          'NetPulse needs VPN permission to route the selected apps through its local proxy.'
        );
        return;
      }
      const { apps, selectedPackages } = state;
      if (selectedPackages.length === 0) {
        Alert.alert('No target apps', 'Select at least one app on the Targets tab first.');
        return;
      }
      const labels = selectedPackages.map(
        (p) => apps.find((a) => a.packageName === p)?.label ?? p
      );
      await VpnInterceptor.start(selectedPackages, labels);
      useTrafficStore.setState({ capturing: true });
    } catch (err) {
      Alert.alert('Could not start capture', String(err));
    }
  };

  return { capturing, toggle };
};
