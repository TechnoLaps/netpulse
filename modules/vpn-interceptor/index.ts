/**
 * modules/vpn-interceptor
 *
 * JS entry point for the native Android VpnService interceptor. When the app is
 * built with `expo run:android` (a development build), `requireNativeModule`
 * resolves the Kotlin module. Inside Expo Go there is no native module, so we
 * fall back to a no-op shim and the app stays in Simulation Mode.
 */

import { NativeModule, requireNativeModule } from 'expo-modules-core';
import type {
  InstalledAppInfo,
  VpnInterceptorEvents,
} from './src/VpnInterceptor.types';

declare class VpnInterceptorModuleDef extends NativeModule<VpnInterceptorEvents> {
  /** Whether the native VpnService module is linked (false in Expo Go). */
  readonly isAvailable: boolean;

  /**
   * Request the Android VPN consent dialog. Resolves true once the user grants
   * consent (or if consent was already granted).
   */
  prepare(): Promise<boolean>;

  /**
   * Start the capture session. Only `allowedPackages` are routed through the
   * VPN and pointed at the local MITM proxy; `allowedLabels` (parallel array)
   * are used to attribute captured traffic to a readable app name.
   */
  start(allowedPackages: string[], allowedLabels: string[]): Promise<void>;

  /** Tear down the VpnService + local proxy. */
  stop(): Promise<void>;

  /** Enumerate installed apps for the Target selector. */
  listInstalledApps(includeSystem: boolean): Promise<InstalledAppInfo[]>;

  /** PEM of the local root CA the user must trust to decrypt HTTPS. */
  getCaCertificatePem(): Promise<string>;

  /** Launch the system dialog to install/trust the root CA. */
  installCaCertificate(): Promise<boolean>;
}

// --- Native / shim resolution -------------------------------------------------

const createShim = (): VpnInterceptorModuleDef =>
  ({
    isAvailable: false,
    async prepare() {
      return false;
    },
    async start() {
      /* no-op: Simulation Mode drives the store instead */
    },
    async stop() {
      /* no-op */
    },
    async listInstalledApps() {
      return [];
    },
    async getCaCertificatePem() {
      return '';
    },
    async installCaCertificate() {
      return false;
    },
    addListener() {
      return { remove() {} };
    },
    removeListener() {},
    removeAllListeners() {},
  }) as unknown as VpnInterceptorModuleDef;

let nativeModule: VpnInterceptorModuleDef;
try {
  nativeModule = requireNativeModule<VpnInterceptorModuleDef>('VpnInterceptor');
} catch {
  nativeModule = createShim();
}

export default nativeModule;
export * from './src/VpnInterceptor.types';
