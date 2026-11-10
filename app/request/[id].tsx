import React, { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AlertTriangle,
  KeyRound,
  Search,
  ShieldCheck,
} from 'lucide-react-native';
import { colors, radius, spacing } from '../../theme/colors';
import { useTrafficStore } from '../../store/useTrafficStore';
import { MethodBadge, StatusBadge } from '../../components/Badges';
import { KeyValueTable } from '../../components/KeyValueTable';
import { CodeBlock } from '../../components/CodeBlock';
import {
  ButtonRow,
  CopyButton,
  ActionButton,
} from '../../components/ActionButton';
import {
  formatBytes,
  formatDuration,
  formatTime,
  isLikelyJson,
  prettyJson,
} from '../../utils/format';
import {
  decodeJwt,
  extractTokens,
  type DecodedJwt,
  type ExtractedToken,
} from '../../utils/tokenExtractor';
import { generateCurl } from '../../utils/curlGenerator';
import type { TrafficEntry } from '../../utils/types';

type TabKey = 'overview' | 'request' | 'response' | 'curl';
const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'request', label: 'Request' },
  { key: 'response', label: 'Response' },
  { key: 'curl', label: 'cURL' },
];

export default function RequestInspector() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const entry = useTrafficStore((s) => s.entries.find((e) => e.id === id));
  const [tab, setTab] = useState<TabKey>('overview');

  if (!entry) {
    return (
      <View style={styles.missing}>
        <Text style={styles.missingText}>This transaction is no longer in the log.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: entry.host }} />

      {/* Summary header */}
      <View style={styles.summary}>
        <View style={styles.summaryRow}>
          <MethodBadge method={entry.request.method} />
          <StatusBadge
            status={entry.response?.statusCode}
            statusText={entry.response?.statusText}
          />
          <View style={{ flex: 1 }} />
          {entry.tlsDecrypted && (
            <View style={styles.tlsTag}>
              <ShieldCheck size={12} color={colors.emerald} />
              <Text style={styles.tlsText}>TLS decrypted</Text>
            </View>
          )}
        </View>
        <Text style={styles.url} selectable>
          {entry.request.url}
        </Text>
        <View style={styles.metaRow}>
          <Text style={styles.meta}>{entry.sourceAppLabel}</Text>
          <Text style={styles.metaDot}>·</Text>
          <Text style={styles.meta}>{formatTime(entry.startedAt)}</Text>
          <Text style={styles.metaDot}>·</Text>
          <Text style={styles.meta}>{formatDuration(entry.durationMs)}</Text>
        </View>
      </View>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        {TABS.map((t) => (
          <Pressable
            key={t.key}
            onPress={() => setTab(t.key)}
            style={[styles.tab, tab === t.key && styles.tabActive]}
          >
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>
              {t.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: insets.bottom + spacing.xxl,
        }}
      >
        {tab === 'overview' && <OverviewTab entry={entry} />}
        {tab === 'request' && <RequestTab entry={entry} />}
        {tab === 'response' && <ResponseTab entry={entry} />}
        {tab === 'curl' && <CurlTab entry={entry} />}
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Overview & Tokens
// ---------------------------------------------------------------------------

const OverviewTab: React.FC<{ entry: TrafficEntry }> = ({ entry }) => {
  const tokens = useMemo(
    () => extractTokens(entry.request, entry.response),
    [entry]
  );

  return (
    <View>
      <SectionTitle>Transaction</SectionTitle>
      <View style={styles.infoCard}>
        <InfoRow label="Method" value={entry.request.method} mono />
        <InfoRow label="Host" value={entry.host} mono />
        <InfoRow label="Path" value={entry.path} mono />
        <InfoRow
          label="Status"
          value={
            entry.response
              ? `${entry.response.statusCode} ${entry.response.statusText}`
              : 'pending'
          }
          mono
        />
        <InfoRow label="Duration" value={formatDuration(entry.durationMs)} mono />
        <InfoRow label="Source app" value={entry.sourceApp} mono />
        <InfoRow
          label="Size"
          value={formatBytes(
            (entry.request.body.sizeBytes ?? 0) +
              (entry.response?.body.sizeBytes ?? 0)
          )}
          mono
          last
        />
      </View>

      <SectionTitle>
        Auth &amp; Tokens{' '}
        <Text style={styles.sectionCount}>({tokens.length})</Text>
      </SectionTitle>
      {tokens.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>No credentials detected in this call.</Text>
        </View>
      ) : (
        tokens.map((t, i) => <TokenCard key={`${t.kind}-${i}`} token={t} />)
      )}
    </View>
  );
};

const TokenCard: React.FC<{ token: ExtractedToken }> = ({ token }) => {
  const [showJwt, setShowJwt] = useState(false);
  return (
    <View style={styles.tokenCard}>
      <View style={styles.tokenHead}>
        <KeyRound size={15} color={colors.token} />
        <Text style={styles.tokenLabel}>{token.label}</Text>
        <View style={styles.tokenKind}>
          <Text style={styles.tokenKindText}>{token.kind.toUpperCase()}</Text>
        </View>
      </View>
      <Text style={styles.tokenSource}>{token.source}</Text>
      <Text style={styles.tokenValue} numberOfLines={3} selectable>
        {token.value}
      </Text>
      <ButtonRow>
        <CopyButton value={token.value} label="Copy token" tone="accent" />
        {token.jwt && (
          <ActionButton
            label={showJwt ? 'Hide JWT' : 'Decode JWT'}
            onPress={() => setShowJwt((s) => !s)}
          />
        )}
      </ButtonRow>
      {token.jwt && showJwt && <JwtView jwt={token.jwt} />}
    </View>
  );
};

const JwtView: React.FC<{ jwt: DecodedJwt }> = ({ jwt }) => (
  <View style={styles.jwtWrap}>
    {jwt.expiresAt != null && (
      <View
        style={[
          styles.jwtExp,
          { borderColor: jwt.isExpired ? colors.danger : colors.emerald },
        ]}
      >
        {jwt.isExpired ? (
          <AlertTriangle size={12} color={colors.danger} />
        ) : (
          <ShieldCheck size={12} color={colors.emerald} />
        )}
        <Text
          style={[
            styles.jwtExpText,
            { color: jwt.isExpired ? colors.danger : colors.emerald },
          ]}
        >
          {jwt.isExpired ? 'Expired' : 'Expires'}{' '}
          {new Date(jwt.expiresAt).toLocaleString()}
        </Text>
      </View>
    )}
    <Text style={styles.jwtSection}>HEADER</Text>
    <CodeBlock language="json" content={prettyJson(JSON.stringify(jwt.header ?? {}))} />
    <Text style={styles.jwtSection}>PAYLOAD</Text>
    <CodeBlock language="json" content={prettyJson(JSON.stringify(jwt.payload ?? {}))} />
  </View>
);

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

const RequestTab: React.FC<{ entry: TrafficEntry }> = ({ entry }) => {
  const { request } = entry;
  const isJson = isLikelyJson(request.body.text, request.body.mimeType);
  return (
    <View>
      <KeyValueTable
        title="Request Headers"
        rows={request.headers}
        highlightKeys={['authorization', 'cookie', 'x-api-key']}
      />
      <KeyValueTable
        title="Query Parameters"
        rows={request.queryParams}
        defaultOpen={request.queryParams.length > 0}
      />
      <SectionTitle>Request Body</SectionTitle>
      {request.body.kind === 'none' || !request.body.text ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>No request body.</Text>
        </View>
      ) : (
        <>
          <CodeBlock
            language={isJson ? 'json' : 'text'}
            content={isJson ? prettyJson(request.body.text) : request.body.text}
          />
          <View style={{ height: spacing.sm }} />
          <ButtonRow>
            <CopyButton
              value={isJson ? prettyJson(request.body.text) : request.body.text}
              label="Copy payload"
            />
          </ButtonRow>
        </>
      )}
    </View>
  );
};

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

const ResponseTab: React.FC<{ entry: TrafficEntry }> = ({ entry }) => {
  const { response } = entry;
  const [query, setQuery] = useState('');

  if (!response) {
    return (
      <View style={styles.emptyCard}>
        <Text style={styles.emptyText}>Response not received yet.</Text>
      </View>
    );
  }

  const isJson = isLikelyJson(response.body.text, response.body.mimeType);
  const pretty = isJson ? prettyJson(response.body.text) : response.body.text;

  return (
    <View>
      <KeyValueTable title="Response Headers" rows={response.headers} />
      <SectionTitle>Response Body</SectionTitle>
      <View style={styles.searchInline}>
        <Search size={14} color={colors.textFaint} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Highlight in response…"
          placeholderTextColor={colors.textFaint}
          style={styles.searchInlineInput}
          autoCapitalize="none"
        />
      </View>
      {!response.body.text ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>Empty response body.</Text>
        </View>
      ) : (
        <>
          <CodeBlock
            language={isJson && !query ? 'json' : 'text'}
            content={pretty}
            highlightQuery={query}
          />
          <View style={{ height: spacing.sm }} />
          <ButtonRow>
            <CopyButton value={pretty} label="Copy response" />
          </ButtonRow>
        </>
      )}
    </View>
  );
};

// ---------------------------------------------------------------------------
// cURL
// ---------------------------------------------------------------------------

const CurlTab: React.FC<{ entry: TrafficEntry }> = ({ entry }) => {
  const [multiline, setMultiline] = useState(true);
  const [redact, setRedact] = useState(false);
  const curl = useMemo(
    () => generateCurl(entry.request, { multiline, redactSecrets: redact }),
    [entry, multiline, redact]
  );

  const shareCurl = async () => {
    try {
      const uri = FileSystem.cacheDirectory + 'request.sh';
      await FileSystem.writeAsStringAsync(uri, '#!/usr/bin/env bash\n' + curl, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'text/x-shellscript',
          dialogTitle: 'Share cURL command',
        });
      } else {
        await Clipboard.setStringAsync(curl);
      }
    } catch {
      await Clipboard.setStringAsync(curl);
    }
  };

  return (
    <View>
      <View style={styles.toggleRow}>
        <Toggle label="Multi-line" on={multiline} onPress={() => setMultiline((v) => !v)} />
        <Toggle
          label="Redact secrets"
          on={redact}
          onPress={() => setRedact((v) => !v)}
        />
      </View>
      <CodeBlock language="shell" content={curl} />
      <View style={{ height: spacing.md }} />
      <ButtonRow>
        <CopyButton value={curl} label="Copy cURL" tone="accent" />
        <ActionButton label="Share cURL" onPress={shareCurl} />
      </ButtonRow>
    </View>
  );
};

const Toggle: React.FC<{ label: string; on: boolean; onPress: () => void }> = ({
  label,
  on,
  onPress,
}) => (
  <Pressable onPress={onPress} style={styles.toggle}>
    <View style={[styles.toggleDot, on && styles.toggleDotOn]} />
    <Text style={[styles.toggleLabel, on && { color: colors.text }]}>{label}</Text>
  </Pressable>
);

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Text style={styles.sectionTitle}>{children}</Text>
);

const InfoRow: React.FC<{
  label: string;
  value: string;
  mono?: boolean;
  last?: boolean;
}> = ({ label, value, mono, last }) => (
  <View style={[styles.infoRow, !last && styles.infoRowBorder]}>
    <Text style={styles.infoLabel}>{label}</Text>
    <Text style={[styles.infoValue, mono && styles.monoValue]} selectable>
      {value}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  missing: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  missingText: { color: colors.textMuted, fontSize: 14 },
  summary: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  tlsTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.emeraldDim,
  },
  tlsText: { color: colors.emerald, fontSize: 10, fontWeight: '600' },
  url: {
    color: colors.text,
    fontSize: 13,
    fontFamily: 'monospace',
    marginTop: spacing.sm,
    lineHeight: 19,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  meta: { color: colors.textMuted, fontSize: 12 },
  metaDot: { color: colors.textFaint },
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    gap: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: colors.emerald },
  tabText: { color: colors.textFaint, fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: colors.emerald },
  sectionTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
  },
  sectionCount: { color: colors.textFaint, fontWeight: '600' },
  infoCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.lg,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    gap: spacing.md,
  },
  infoRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  infoLabel: { color: colors.textMuted, fontSize: 12.5 },
  infoValue: { color: colors.text, fontSize: 12.5, flexShrink: 1, textAlign: 'right' },
  monoValue: { fontFamily: 'monospace' },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  emptyText: { color: colors.textFaint, fontSize: 13 },
  tokenCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.token + '55',
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  tokenHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  tokenLabel: { color: colors.text, fontSize: 13.5, fontWeight: '700', flex: 1 },
  tokenKind: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
  },
  tokenKindText: { color: colors.token, fontSize: 9, fontWeight: '800' },
  tokenSource: {
    color: colors.textFaint,
    fontSize: 11,
    marginTop: 3,
    marginBottom: spacing.sm,
  },
  tokenValue: {
    color: colors.token,
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 17,
    marginBottom: spacing.md,
  },
  jwtWrap: { marginTop: spacing.md, gap: spacing.xs },
  jwtExp: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
    borderWidth: 1,
    marginBottom: spacing.sm,
  },
  jwtExpText: { fontSize: 11, fontWeight: '600' },
  jwtSection: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    marginTop: spacing.sm,
    marginBottom: 4,
  },
  searchInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  searchInlineInput: { flex: 1, color: colors.text, paddingVertical: 9, fontSize: 13 },
  toggleRow: { flexDirection: 'row', gap: spacing.lg, marginBottom: spacing.md },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  toggleDot: {
    width: 18,
    height: 18,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.borderStrong,
  },
  toggleDotOn: { backgroundColor: colors.emerald, borderColor: colors.emerald },
  toggleLabel: { color: colors.textMuted, fontSize: 13 },
});
