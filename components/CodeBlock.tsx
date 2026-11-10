import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { colors, radius, spacing } from '../theme/colors';

/**
 * Minimal, dependency-free JSON syntax highlighter. Tokenizes keys, strings,
 * numbers, booleans/null and punctuation and renders them as colored <Text>.
 * Falls back to plain text for non-JSON payloads.
 */

type Token = { text: string; color: string };

const TOKEN_RE =
  /("(?:\\.|[^"\\])*"\s*:)|("(?:\\.|[^"\\])*")|(\b-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|(\btrue\b|\bfalse\b|\bnull\b)|([{}[\],])/g;

const highlightJson = (src: string): Token[] => {
  const tokens: Token[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(src)) !== null) {
    if (m.index > lastIndex) {
      tokens.push({ text: src.slice(lastIndex, m.index), color: colors.textMuted });
    }
    const [full, key, str, num, lit, punct] = m;
    if (key) tokens.push({ text: full, color: colors.indigo });
    else if (str) tokens.push({ text: full, color: colors.emerald });
    else if (num) tokens.push({ text: full, color: colors.put });
    else if (lit) tokens.push({ text: full, color: colors.patch });
    else if (punct) tokens.push({ text: full, color: colors.textFaint });
    else tokens.push({ text: full, color: colors.text });
    lastIndex = m.index + full.length;
  }
  if (lastIndex < src.length) {
    tokens.push({ text: src.slice(lastIndex), color: colors.text });
  }
  return tokens;
};

export const CodeBlock: React.FC<{
  content: string;
  language?: 'json' | 'text' | 'shell';
  highlightQuery?: string;
}> = ({ content, language = 'text', highlightQuery }) => {
  const body =
    language === 'json' ? (
      <Text style={styles.code}>
        {highlightJson(content).map((t, i) => (
          <Text key={i} style={{ color: t.color }}>
            {t.text}
          </Text>
        ))}
      </Text>
    ) : highlightQuery ? (
      <HighlightedText content={content} query={highlightQuery} />
    ) : (
      <Text style={[styles.code, language === 'shell' && { color: colors.emerald }]}>
        {content}
      </Text>
    );

  return (
    <ScrollView
      horizontal
      style={styles.wrap}
      contentContainerStyle={styles.inner}
      showsHorizontalScrollIndicator={false}
    >
      {body}
    </ScrollView>
  );
};

const HighlightedText: React.FC<{ content: string; query: string }> = ({
  content,
  query,
}) => {
  if (!query) return <Text style={styles.code}>{content}</Text>;
  const parts = content.split(new RegExp(`(${escapeRe(query)})`, 'gi'));
  return (
    <Text style={styles.code}>
      {parts.map((p, i) =>
        p.toLowerCase() === query.toLowerCase() ? (
          <Text key={i} style={styles.mark}>
            {p}
          </Text>
        ) : (
          <Text key={i}>{p}</Text>
        )
      )}
    </Text>
  );
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  inner: { padding: spacing.md },
  code: {
    fontFamily: 'monospace',
    fontSize: 12.5,
    lineHeight: 19,
    color: colors.text,
  },
  mark: {
    backgroundColor: colors.put,
    color: colors.bg,
  },
});
