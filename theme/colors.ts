/**
 * NetPulse Inspector — dark "cyber developer" palette.
 * Slate/zinc backgrounds with emerald + indigo accents.
 */
export const colors = {
  // Surfaces
  bg: '#0b0f17', // app background (near-black slate)
  surface: '#111726', // cards
  surfaceAlt: '#0e1420', // nested panels / code blocks
  surfaceHover: '#1a2234',
  border: '#1f2937',
  borderStrong: '#334155',

  // Text
  text: '#e5e9f0',
  textMuted: '#94a3b8',
  textFaint: '#64748b',

  // Accents
  emerald: '#34d399',
  emeraldDim: '#065f46',
  indigo: '#818cf8',
  indigoDim: '#3730a3',

  // HTTP method colors
  get: '#34d399', // emerald
  post: '#60a5fa', // blue
  put: '#fbbf24', // amber
  patch: '#c084fc', // purple
  delete: '#f87171', // red
  head: '#94a3b8',
  options: '#94a3b8',

  // Status code colors
  status2xx: '#34d399',
  status3xx: '#38bdf8',
  status4xx: '#fbbf24',
  status5xx: '#f87171',
  statusPending: '#64748b',

  // Semantic
  danger: '#f87171',
  warning: '#fbbf24',
  success: '#34d399',
  token: '#fcd34d', // highlighted secrets
} as const;

export const methodColor = (method: string): string => {
  const m = method.toUpperCase();
  switch (m) {
    case 'GET':
      return colors.get;
    case 'POST':
      return colors.post;
    case 'PUT':
      return colors.put;
    case 'PATCH':
      return colors.patch;
    case 'DELETE':
      return colors.delete;
    case 'HEAD':
      return colors.head;
    default:
      return colors.options;
  }
};

export const statusColor = (status: number | undefined): string => {
  if (!status) return colors.statusPending;
  if (status >= 500) return colors.status5xx;
  if (status >= 400) return colors.status4xx;
  if (status >= 300) return colors.status3xx;
  if (status >= 200) return colors.status2xx;
  return colors.statusPending;
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  pill: 999,
} as const;

export const mono =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';
