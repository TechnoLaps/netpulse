import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, methodColor, radius, statusColor } from '../theme/colors';

const withAlpha = (hex: string, alpha: string) => {
  // hex like #34d399 → #34d39922
  return hex.length === 7 ? `${hex}${alpha}` : hex;
};

export const MethodBadge: React.FC<{ method: string }> = ({ method }) => {
  const c = methodColor(method);
  return (
    <View style={[styles.badge, { backgroundColor: withAlpha(c, '22'), borderColor: c }]}>
      <Text style={[styles.badgeText, { color: c }]}>{method.toUpperCase()}</Text>
    </View>
  );
};

export const StatusBadge: React.FC<{ status?: number; statusText?: string }> = ({
  status,
  statusText,
}) => {
  const c = statusColor(status);
  const label = status ? `${status}${statusText ? ' ' + statusText : ''}` : 'PENDING';
  return (
    <View style={[styles.badge, { backgroundColor: withAlpha(c, '22'), borderColor: c }]}>
      <Text style={[styles.badgeText, { color: c }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
};

export const Pill: React.FC<{
  label: string;
  active?: boolean;
  color?: string;
  onPress?: () => void;
}> = ({ label, active, color = colors.indigo }) => (
  <View
    style={[
      styles.pill,
      active
        ? { backgroundColor: withAlpha(color, '22'), borderColor: color }
        : { borderColor: colors.border },
    ]}
  >
    <Text style={[styles.pillText, { color: active ? color : colors.textMuted }]}>
      {label}
    </Text>
  </View>
);

export const Tag: React.FC<{ label: string; color?: string }> = ({
  label,
  color = colors.textMuted,
}) => (
  <View style={[styles.tag, { borderColor: colors.border }]}>
    <Text style={[styles.tagText, { color }]} numberOfLines={1}>
      {label}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.sm,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    fontVariant: ['tabular-nums'],
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  pillText: { fontSize: 12, fontWeight: '600' },
  tag: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  tagText: { fontSize: 11, fontWeight: '500' },
});
