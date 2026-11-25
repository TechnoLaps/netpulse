import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  KeyRound,
  Play,
  Search,
  Square,
  Trash2,
  Zap,
} from 'lucide-react-native';
import { colors, radius, spacing } from '../../theme/colors';
import {
  selectFilteredEntries,
  useTrafficStore,
} from '../../store/useTrafficStore';
import { MethodBadge, Pill, StatusBadge } from '../../components/Badges';
import { useCapture } from '../../hooks/useCapture';
import { formatBytes, formatDuration, formatTime } from '../../utils/format';
import { hasAuthToken } from '../../utils/tokenExtractor';
import type { FilterMethod, FilterStatus, TrafficEntry } from '../../utils/types';

const METHODS: FilterMethod[] = ['ALL', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const STATUSES: FilterStatus[] = ['ALL', '2xx', '3xx', '4xx', '5xx'];

export default function LiveFeedScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const entries = useTrafficStore((s) => s.entries);
  const filters = useTrafficStore((s) => s.filters);
  const mockMode = useTrafficStore((s) => s.mockMode);
  const captureMode = useTrafficStore((s) => s.captureMode);

  const { capturing, toggle: toggleCapture } = useCapture();
  const emitMockNow = useTrafficStore((s) => s.emitMockNow);
  const clear = useTrafficStore((s) => s.clear);
  const setSearch = useTrafficStore((s) => s.setSearch);
  const setMethodFilter = useTrafficStore((s) => s.setMethodFilter);
  const setStatusFilter = useTrafficStore((s) => s.setStatusFilter);
  const toggleAuthFilter = useTrafficStore((s) => s.toggleAuthFilter);

  const filtered = useTrafficStore(selectFilteredEntries);

  const [showFilters, setShowFilters] = useState(true);

  const stats = useMemo(() => {
    const total = entries.length;
    const errors = entries.filter(
      (e) => (e.response?.statusCode ?? 0) >= 400
    ).length;
    const withAuth = entries.filter((e) => hasAuthToken(e.request, e.response)).length;
    return { total, errors, withAuth };
  }, [entries]);

  return (
    <View style={styles.container}>
      {/* Control bar */}
      <View style={styles.controlBar}>
        <Pressable
          onPress={toggleCapture}
          style={[
            styles.captureBtn,
            capturing ? styles.captureOn : styles.captureOff,
          ]}
        >
          {capturing ? (
            <Square size={16} color={colors.bg} fill={colors.bg} />
          ) : (
            <Play size={16} color={colors.bg} fill={colors.bg} />
          )}
          <Text style={styles.captureText}>
            {capturing ? 'Stop Capture' : 'Start Capture'}
          </Text>
          {capturing && <View style={styles.livePulse} />}
        </Pressable>

        <Pressable onPress={emitMockNow} style={styles.iconBtn}>
          <Zap size={18} color={colors.put} />
        </Pressable>
        <Pressable onPress={clear} style={styles.iconBtn}>
          <Trash2 size={18} color={colors.textMuted} />
        </Pressable>
      </View>

      {mockMode && (
        <View style={styles.mockBanner}>
          <Text style={styles.mockText}>
            SIMULATION MODE — traffic is generated on-device. Tap{' '}
            <Zap size={11} color={colors.put} /> for a single call, or Start for a live
            stream.
          </Text>
        </View>
      )}

      {!mockMode && capturing && captureMode && (
        <View style={styles.mockBanner}>
          <Text style={styles.mockText}>
            {captureMode === 'tunnel'
              ? 'TRANSPARENT CAPTURE — all traffic from the selected apps is routed through the local interceptor. Hosts that reject the NetPulse CA (pinned apps) are passed through untouched.'
              : 'PROXY CAPTURE — only apps that honor the system proxy are captured.'}
          </Text>
        </View>
      )}

      {/* Stats row */}
      <View style={styles.statsRow}>
        <Stat label="Captured" value={stats.total} color={colors.text} />
        <Stat label="Errors" value={stats.errors} color={colors.danger} />
        <Stat label="With token" value={stats.withAuth} color={colors.token} />
        <Stat label="Showing" value={filtered.length} color={colors.emerald} />
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <Search size={16} color={colors.textFaint} />
        <TextInput
          value={filters.search}
          onChangeText={setSearch}
          placeholder="Search host, path, method, app…"
          placeholderTextColor={colors.textFaint}
          style={styles.searchInput}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Pressable onPress={() => setShowFilters((s) => !s)}>
          <Text style={styles.filterToggle}>{showFilters ? 'Hide' : 'Filters'}</Text>
        </Pressable>
      </View>

      {/* Filter chips */}
      {showFilters && (
        <View style={styles.filters}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            {METHODS.map((m) => (
              <Pressable key={m} onPress={() => setMethodFilter(m)}>
                <Pill label={m} active={filters.method === m} />
              </Pressable>
            ))}
          </ScrollView>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            {STATUSES.map((s) => (
              <Pressable key={s} onPress={() => setStatusFilter(s)}>
                <Pill label={s} active={filters.status === s} color={colors.put} />
              </Pressable>
            ))}
            <Pressable onPress={toggleAuthFilter} style={styles.authChip}>
              <View
                style={[
                  styles.authChipInner,
                  filters.hasAuthToken && styles.authChipActive,
                ]}
              >
                <KeyRound
                  size={13}
                  color={filters.hasAuthToken ? colors.token : colors.textMuted}
                />
                <Text
                  style={[
                    styles.authChipText,
                    filters.hasAuthToken && { color: colors.token },
                  ]}
                >
                  Has Token
                </Text>
              </View>
            </Pressable>
          </ScrollView>
        </View>
      )}

      {/* Feed */}
      <FlatList
        data={filtered}
        keyExtractor={(e) => e.id}
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingBottom: insets.bottom + spacing.xl,
        }}
        renderItem={({ item }) => (
          <TrafficRow
            entry={item}
            onPress={() => router.push(`/request/${item.id}`)}
          />
        )}
        ListEmptyComponent={<EmptyState capturing={capturing} />}
      />
    </View>
  );
}

const Stat: React.FC<{ label: string; value: number; color: string }> = ({
  label,
  value,
  color,
}) => (
  <View style={styles.stat}>
    <Text style={[styles.statValue, { color }]}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

const TrafficRow: React.FC<{ entry: TrafficEntry; onPress: () => void }> = ({
  entry,
  onPress,
}) => {
  const tokenPresent = hasAuthToken(entry.request, entry.response);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={styles.rowTop}>
        <MethodBadge method={entry.request.method} />
        <StatusBadge
          status={entry.response?.statusCode}
          statusText={entry.response?.statusText}
        />
        {tokenPresent && <KeyRound size={13} color={colors.token} />}
        <View style={{ flex: 1 }} />
        <Text style={styles.time}>{formatTime(entry.startedAt)}</Text>
      </View>

      <Text style={styles.host} numberOfLines={1}>
        {entry.host}
      </Text>
      <Text style={styles.path} numberOfLines={1}>
        {entry.path}
      </Text>

      <View style={styles.rowBottom}>
        <View style={styles.appTag}>
          <Text style={styles.appTagText} numberOfLines={1}>
            {entry.sourceAppLabel}
          </Text>
        </View>
        <Text style={styles.meta}>{formatDuration(entry.durationMs)}</Text>
        <Text style={styles.metaDot}>·</Text>
        <Text style={styles.meta}>
          {formatBytes(
            (entry.request.body.sizeBytes ?? 0) +
              (entry.response?.body.sizeBytes ?? 0)
          )}
        </Text>
      </View>
    </Pressable>
  );
};

const EmptyState: React.FC<{ capturing: boolean }> = ({ capturing }) => (
  <View style={styles.empty}>
    <Zap size={34} color={colors.border} />
    <Text style={styles.emptyTitle}>No traffic captured yet</Text>
    <Text style={styles.emptyBody}>
      {capturing
        ? 'Listening… generated calls will appear here.'
        : 'Press Start Capture, or the lightning bolt to inject one request.'}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  controlBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  captureBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: 12,
    borderRadius: radius.md,
  },
  captureOn: { backgroundColor: colors.danger },
  captureOff: { backgroundColor: colors.emerald },
  captureText: { color: colors.bg, fontWeight: '800', fontSize: 14 },
  livePulse: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.bg,
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  mockBanner: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  mockText: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  stat: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  statValue: { fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
  statLabel: { fontSize: 10, color: colors.textFaint, marginTop: 2 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    paddingVertical: 10,
    fontSize: 14,
  },
  filterToggle: { color: colors.indigo, fontSize: 12, fontWeight: '600' },
  filters: { paddingTop: spacing.sm, gap: spacing.sm },
  chipRow: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  authChip: { marginLeft: spacing.xs },
  authChipInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  authChipActive: { borderColor: colors.token, backgroundColor: '#fcd34d22' },
  authChipText: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  row: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  rowPressed: { backgroundColor: colors.surfaceHover },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  time: {
    color: colors.textFaint,
    fontSize: 11,
    fontFamily: 'monospace',
  },
  host: { color: colors.text, fontSize: 14, fontWeight: '700' },
  path: {
    color: colors.textMuted,
    fontSize: 12.5,
    fontFamily: 'monospace',
    marginTop: 1,
  },
  rowBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  appTag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    maxWidth: '55%',
  },
  appTagText: { color: colors.indigo, fontSize: 11, fontWeight: '600' },
  meta: { color: colors.textFaint, fontSize: 11, fontVariant: ['tabular-nums'] },
  metaDot: { color: colors.textFaint, fontSize: 11 },
  empty: { alignItems: 'center', paddingTop: 80, gap: spacing.md },
  emptyTitle: { color: colors.textMuted, fontSize: 15, fontWeight: '700' },
  emptyBody: {
    color: colors.textFaint,
    fontSize: 12.5,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
    lineHeight: 18,
  },
});
