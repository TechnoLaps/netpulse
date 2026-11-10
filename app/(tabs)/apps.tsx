import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, Package, Search } from 'lucide-react-native';
import { colors, radius, spacing } from '../../theme/colors';
import { useTrafficStore } from '../../store/useTrafficStore';
import type { InstalledApp } from '../../utils/types';

export default function AppSelectorScreen() {
  const insets = useSafeAreaInsets();
  const apps = useTrafficStore((s) => s.apps);
  const selected = useTrafficStore((s) => s.selectedPackages);
  const toggleApp = useTrafficStore((s) => s.toggleApp);
  const selectAll = useTrafficStore((s) => s.selectAllApps);
  const clearSel = useTrafficStore((s) => s.clearAppSelection);

  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return apps;
    return apps.filter(
      (a) =>
        a.label.toLowerCase().includes(q) ||
        a.packageName.toLowerCase().includes(q)
    );
  }, [apps, query]);

  return (
    <View style={styles.container}>
      <Text style={styles.subtitle}>
        Select which apps NetPulse should intercept. Only traffic from checked apps is
        routed through the VPN interceptor.
      </Text>

      <View style={styles.searchWrap}>
        <Search size={16} color={colors.textFaint} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search apps or package name…"
          placeholderTextColor={colors.textFaint}
          style={styles.searchInput}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      <View style={styles.actionsRow}>
        <Text style={styles.count}>
          {selected.length} of {apps.length} selected
        </Text>
        <View style={{ flex: 1 }} />
        <Pressable onPress={selectAll} hitSlop={8}>
          <Text style={styles.action}>Select all</Text>
        </Pressable>
        <Text style={styles.sep}>·</Text>
        <Pressable onPress={clearSel} hitSlop={8}>
          <Text style={styles.action}>Clear</Text>
        </Pressable>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(a) => a.packageName}
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingBottom: insets.bottom + spacing.xl,
        }}
        renderItem={({ item }) => (
          <AppRow
            app={item}
            checked={selected.includes(item.packageName)}
            onToggle={() => toggleApp(item.packageName)}
          />
        )}
      />
    </View>
  );
}

const AppRow: React.FC<{
  app: InstalledApp;
  checked: boolean;
  onToggle: () => void;
}> = ({ app, checked, onToggle }) => (
  <Pressable
    onPress={onToggle}
    style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
  >
    <View style={styles.iconWrap}>
      <Package size={20} color={colors.indigo} />
    </View>
    <View style={styles.rowText}>
      <Text style={styles.appName} numberOfLines={1}>
        {app.label}
        {app.system && <Text style={styles.systemTag}>  system</Text>}
      </Text>
      <Text style={styles.pkg} numberOfLines={1}>
        {app.packageName}
      </Text>
    </View>
    <View style={[styles.checkbox, checked && styles.checkboxOn]}>
      {checked && <Check size={15} color={colors.bg} strokeWidth={3} />}
    </View>
  </Pressable>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  subtitle: {
    color: colors.textMuted,
    fontSize: 12.5,
    lineHeight: 18,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    margin: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: { flex: 1, color: colors.text, paddingVertical: 10, fontSize: 14 },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  count: { color: colors.emerald, fontSize: 12, fontWeight: '700' },
  action: { color: colors.indigo, fontSize: 12, fontWeight: '600' },
  sep: { color: colors.textFaint },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  rowPressed: { backgroundColor: colors.surfaceHover },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1 },
  appName: { color: colors.text, fontSize: 14, fontWeight: '700' },
  systemTag: { color: colors.textFaint, fontSize: 10, fontWeight: '500' },
  pkg: {
    color: colors.textMuted,
    fontSize: 12,
    fontFamily: 'monospace',
    marginTop: 2,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.emerald, borderColor: colors.emerald },
});
