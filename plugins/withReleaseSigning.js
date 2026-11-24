/**
 * withReleaseSigning
 *
 * Expo config plugin that injects a `release` signing config into the generated
 * android/app/build.gradle at prebuild time, reading the keystore location and
 * passwords from environment variables so no secret is committed:
 *
 *   NETPULSE_STORE_FILE      absolute path to the .jks/.keystore
 *   NETPULSE_STORE_PASSWORD  keystore password
 *   NETPULSE_KEY_ALIAS       key alias
 *   NETPULSE_KEY_PASSWORD    key password
 *
 * When those env vars are absent (e.g. a local debug build) the release build
 * type is left untouched. The CI release workflow sets them.
 */
const { withAppBuildGradle } = require('@expo/config-plugins');

const SIGNING_CONFIG = `
        netpulseRelease {
            if (System.getenv("NETPULSE_STORE_FILE") != null) {
                storeFile file(System.getenv("NETPULSE_STORE_FILE"))
                storePassword System.getenv("NETPULSE_STORE_PASSWORD")
                keyAlias System.getenv("NETPULSE_KEY_ALIAS")
                keyPassword System.getenv("NETPULSE_KEY_PASSWORD")
            }
        }`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (gradle.includes('netpulseRelease')) return cfg;

    // 1) Add the netpulseRelease signing config to the signingConfigs block.
    gradle = gradle.replace(/signingConfigs\s*\{/, (m) => `${m}${SIGNING_CONFIG}`);

    // 2) Point the release build type at it, but only when the keystore env is
    //    present — otherwise keep whatever the template used (debug) so local
    //    `assembleRelease` without secrets still works.
    gradle = gradle.replace(
      /(release\s*\{\s*(?:\/\/[^\n]*\n\s*)?)signingConfig signingConfigs\.debug/,
      `$1signingConfig System.getenv("NETPULSE_STORE_FILE") != null ? signingConfigs.netpulseRelease : signingConfigs.debug`
    );

    cfg.modResults.contents = gradle;
    return cfg;
  });
};
