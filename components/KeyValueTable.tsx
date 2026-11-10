import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronDown, ChevronRight } from 'lucide-react-native';
import { colors, radius, spacing } from '../theme/colors';

export interface KV {
  name: string;
  value: string;
}

/** Collapsible key/value table used for headers and query params. */
export const KeyValueTable: React.FC<{
  title: string;
  rows: KV[];
  defaultOpen?: boolean;
  highlightKeys?: string[];
}> = ({ title, rows, defaultOpen = true, highlightKeys = [] }) => {
  const [open, setOpen] = useState(defaultOpen);
  const highlight = new Set(highlightKeys.map((k) => k.toLowerCase()));

  return (
    <View style={styles.card}>
      <Pressable style={styles.header} onPress={() => setOpen((o) => !o)}>
        {open ? (
          <ChevronDown size={16} color={colors.textMuted} />
        ) : (
          <ChevronRight size={16} color={colors.textMuted} />
        )}
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.count}>{rows.length}</Text>
      </Pressable>
      {open && (
        <View style={styles.body}>
          {rows.length === 0 ? (
            <Text style={styles.empty}>No entries</Text>
          ) : (
            rows.map((r, i) => {
              const hot = highlight.has(r.name.toLowerCase());
              return (
                <View
                  key={`${r.name}-${i}`}
                  style={[styles.row, i > 0 && styles.rowBorder]}
                >
                  <Text
                    style={[styles.key, hot && { color: colors.token }]}
                    selectable
                  >
                    {r.name}
                  </Text>
                  <Text style={styles.value} selectable>
                    {r.value}
                  </Text>
                </View>
              );
            })
          )}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  title: {
    color: colors.text,
    fontWeight: '700',
    fontSize: 13,
    flex: 1,
    letterSpacing: 0.3,
  },
  count: {
    color: colors.textFaint,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  body: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  row: { paddingVertical: spacing.sm },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  key: {
    color: colors.indigo,
    fontFamily: 'monospace',
    fontSize: 12.5,
    marginBottom: 2,
  },
  value: {
    color: colors.text,
    fontFamily: 'monospace',
    fontSize: 12.5,
    lineHeight: 18,
  },
  empty: { color: colors.textFaint, fontSize: 12, paddingVertical: spacing.sm },
});
