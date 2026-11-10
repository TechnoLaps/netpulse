import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Check, Copy, type LucideIcon } from 'lucide-react-native';
import { colors, radius, spacing } from '../theme/colors';

export const ActionButton: React.FC<{
  label: string;
  icon?: LucideIcon;
  onPress: () => void | Promise<void>;
  tone?: 'default' | 'accent' | 'danger';
  compact?: boolean;
}> = ({ label, icon: Icon, onPress, tone = 'default', compact }) => {
  const toneColor =
    tone === 'accent' ? colors.emerald : tone === 'danger' ? colors.danger : colors.text;
  const border =
    tone === 'accent' ? colors.emerald : tone === 'danger' ? colors.danger : colors.borderStrong;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        compact && styles.compact,
        { borderColor: border },
        pressed && styles.pressed,
      ]}
    >
      {Icon && <Icon size={15} color={toneColor} />}
      <Text style={[styles.label, { color: toneColor }]}>{label}</Text>
    </Pressable>
  );
};

/** A button that copies text to the clipboard and shows a transient check. */
export const CopyButton: React.FC<{
  value: string;
  label?: string;
  tone?: 'default' | 'accent';
}> = ({ value, label = 'Copy', tone = 'default' }) => {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    await Clipboard.setStringAsync(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  return (
    <ActionButton
      label={copied ? 'Copied' : label}
      icon={copied ? Check : Copy}
      onPress={onCopy}
      tone={copied ? 'accent' : tone}
      compact
    />
  );
};

export const ButtonRow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <View style={styles.row}>{children}</View>
);

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    borderRadius: radius.md,
    borderWidth: 1,
    backgroundColor: colors.surface,
  },
  compact: { paddingVertical: 7, paddingHorizontal: spacing.md },
  pressed: { backgroundColor: colors.surfaceHover, opacity: 0.9 },
  label: { fontSize: 13, fontWeight: '600' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
