import React, { useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ShieldCheck, ShieldAlert, Copy, Check } from 'lucide-react-native';
import { colors, radius, spacing } from '../../theme/colors';
import VpnInterceptor from '../../modules/vpn-interceptor';

export default function CertScreen() {
  const insets = useSafeAreaInsets();
  const available = VpnInterceptor.isAvailable;
  const [pem, setPem] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!available) return;
    VpnInterceptor.getCaCertificatePem()
      .then(setPem)
      .catch(() => setPem(''));
  }, [available]);

  const install = async () => {
    try {
      await VpnInterceptor.installCaCertificate();
    } catch (err) {
      Alert.alert('Install failed', String(err));
    }
  };

  const copyPem = async () => {
    await Clipboard.setStringAsync(pem);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{
        padding: spacing.lg,
        paddingBottom: insets.bottom + spacing.xl,
      }}
    >
      {!available ? (
        <View style={styles.card}>
          <ShieldAlert size={28} color={colors.warning} />
          <Text style={styles.title}>Native capture not available</Text>
          <Text style={styles.body}>
            You are running in Expo Go / Simulation Mode. HTTPS decryption and the root
            CA are only available in a device build (expo run:android / the CI APK).
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.card}>
            <ShieldCheck size={28} color={colors.emerald} />
            <Text style={styles.title}>Trust the NetPulse root CA</Text>
            <Text style={styles.body}>
              To decrypt HTTPS, your device must trust NetPulse's locally-generated
              certificate authority. The private key never leaves this device.
            </Text>
            <Pressable onPress={install} style={styles.installBtn}>
              <Text style={styles.installText}>Install certificate</Text>
            </Pressable>
          </View>

          <Text style={styles.stepsTitle}>How it works</Text>
          <Step n={1} text="Tap Install certificate and confirm the system dialog (you may be asked to set a screen lock)." />
          <Step n={2} text="On Android 11+ the CA lands under Settings → Security → Encryption & credentials → Install a certificate → CA certificate." />
          <Step n={3} text="Start capture on the Live Feed and pick target apps on Targets." />

          <View style={styles.warnCard}>
            <Text style={styles.warnText}>
              User-installed CAs only work for apps that trust user certificates.
              Apps using certificate pinning will reject the proxy and won't be
              decryptable. Only inspect apps and devices you are authorized to test.
            </Text>
          </View>

          {!!pem && (
            <>
              <View style={styles.pemHeader}>
                <Text style={styles.stepsTitle}>Root CA (PEM)</Text>
                <Pressable onPress={copyPem} style={styles.copyBtn}>
                  {copied ? (
                    <Check size={14} color={colors.emerald} />
                  ) : (
                    <Copy size={14} color={colors.textMuted} />
                  )}
                  <Text style={styles.copyText}>{copied ? 'Copied' : 'Copy'}</Text>
                </Pressable>
              </View>
              <View style={styles.pemBox}>
                <Text style={styles.pemText} selectable>
                  {pem}
                </Text>
              </View>
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

const Step: React.FC<{ n: number; text: string }> = ({ n, text }) => (
  <View style={styles.step}>
    <View style={styles.stepNum}>
      <Text style={styles.stepNumText}>{n}</Text>
    </View>
    <Text style={styles.stepText}>{text}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  body: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  installBtn: {
    backgroundColor: colors.emerald,
    paddingHorizontal: spacing.xl,
    paddingVertical: 11,
    borderRadius: radius.md,
    marginTop: spacing.lg,
  },
  installText: { color: colors.bg, fontWeight: '800', fontSize: 14 },
  stepsTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: spacing.md,
  },
  step: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  stepNum: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.indigoDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumText: { color: colors.indigo, fontSize: 12, fontWeight: '800' },
  stepText: { color: colors.textMuted, fontSize: 13, lineHeight: 19, flex: 1 },
  warnCard: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.warning + '55',
    padding: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  warnText: { color: colors.warning, fontSize: 12, lineHeight: 18 },
  pemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  copyText: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  pemBox: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  pemText: {
    color: colors.textMuted,
    fontFamily: 'monospace',
    fontSize: 11,
    lineHeight: 15,
  },
});
