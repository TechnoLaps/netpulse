import React, { useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
// The legacy API is used deliberately: writeAsStringAsync + cacheDirectory are
// stable across SDKs. (The new File/Paths API works too; swap if you prefer.)
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Archive,
  FileJson,
  Share2,
  TerminalSquare,
  type LucideIcon,
} from 'lucide-react-native';
import { colors, radius, spacing } from '../../theme/colors';
import { useTrafficStore } from '../../store/useTrafficStore';
import { exportTraffic, type ExportFormat } from '../../utils/exporters';

interface FormatCard {
  format: ExportFormat;
  title: string;
  desc: string;
  icon: LucideIcon;
  accent: string;
}

const FORMATS: FormatCard[] = [
  {
    format: 'har',
    title: 'HAR 1.2 Archive',
    desc: 'Full request/response log. Opens in Chrome DevTools, Charles, Proxyman.',
    icon: Archive,
    accent: colors.indigo,
  },
  {
    format: 'postman',
    title: 'Postman Collection v2.1',
    desc: 'Import every captured call into Postman or Insomnia as requests.',
    icon: FileJson,
    accent: colors.put,
  },
  {
    format: 'curl',
    title: 'cURL Bundle (.sh)',
    desc: 'All requests as a runnable shell script of curl commands.',
    icon: TerminalSquare,
    accent: colors.emerald,
  },
];

export default function ExportScreen() {
  const insets = useSafeAreaInsets();
  const entries = useTrafficStore((s) => s.entries);
  const [busy, setBusy] = useState<ExportFormat | null>(null);

  const doExport = async (format: ExportFormat, shareIt: boolean) => {
    if (entries.length === 0) {
      Alert.alert('Nothing to export', 'Capture some traffic first.');
      return;
    }
    try {
      setBusy(format);
      const { content, filename, mimeType } = exportTraffic(entries, format);

      if (!shareIt) {
        await Clipboard.setStringAsync(content);
        Alert.alert('Copied', `${filename} copied to clipboard.`);
        return;
      }

      const uri = FileSystem.cacheDirectory + filename;
      await FileSystem.writeAsStringAsync(uri, content, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, {
          mimeType,
          dialogTitle: `Export ${filename}`,
          UTI: mimeType === 'application/json' ? 'public.json' : 'public.data',
        });
      } else {
        await Clipboard.setStringAsync(content);
        Alert.alert('Sharing unavailable', `${filename} copied to clipboard instead.`);
      }
    } catch (err) {
      Alert.alert('Export failed', String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{
        padding: spacing.lg,
        paddingBottom: insets.bottom + spacing.xl,
      }}
    >
      <View style={styles.summary}>
        <Text style={styles.summaryValue}>{entries.length}</Text>
        <Text style={styles.summaryLabel}>transactions ready to export</Text>
      </View>

      {FORMATS.map((f) => (
        <View key={f.format} style={styles.card}>
          <View style={styles.cardHead}>
            <View style={[styles.cardIcon, { borderColor: f.accent }]}>
              <f.icon size={20} color={f.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>{f.title}</Text>
              <Text style={styles.cardDesc}>{f.desc}</Text>
            </View>
          </View>
          <View style={styles.cardActions}>
            <Pressable
              onPress={() => doExport(f.format, false)}
              style={[styles.smallBtn, { borderColor: colors.border }]}
              disabled={busy !== null}
            >
              <Text style={styles.smallBtnText}>Copy</Text>
            </Pressable>
            <Pressable
              onPress={() => doExport(f.format, true)}
              style={[styles.shareBtn, { backgroundColor: f.accent }]}
              disabled={busy !== null}
            >
              <Share2 size={15} color={colors.bg} />
              <Text style={styles.shareBtnText}>
                {busy === f.format ? 'Working…' : 'Share'}
              </Text>
            </Pressable>
          </View>
        </View>
      ))}

      <Text style={styles.note}>
        Exports include captured headers, bodies and tokens. Share only with trusted
        tools — files may contain live credentials.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  summary: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  summaryValue: {
    color: colors.emerald,
    fontSize: 36,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  summaryLabel: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  cardHead: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  cardDesc: { color: colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  cardActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
    justifyContent: 'flex-end',
  },
  smallBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 9,
    borderRadius: radius.md,
    borderWidth: 1,
    backgroundColor: colors.surfaceAlt,
  },
  smallBtnText: { color: colors.text, fontWeight: '600', fontSize: 13 },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.lg,
    paddingVertical: 9,
    borderRadius: radius.md,
  },
  shareBtnText: { color: colors.bg, fontWeight: '800', fontSize: 13 },
  note: {
    color: colors.textFaint,
    fontSize: 11.5,
    lineHeight: 17,
    marginTop: spacing.md,
    textAlign: 'center',
  },
});
