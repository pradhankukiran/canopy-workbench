export const chartColors = {
  primary: "#0b5cab",
  primaryLight: "#4d9de0",
  secondary: "#2f76d2",
  success: "#0f766e",
  danger: "#b42318",
  warning: "#b54708",
  muted: "#667085",
  grid: "#e4e9f0",
  background: "#ffffff",
  oep: "#0b5cab",
  aep: "#2f76d2",
  gross: "#6366f1",
  net: "#0f766e",
  ceded: "#b54708",
  triggered: "#0f766e",
  notTriggered: "#d8dee8",
  exhausted: "#b42318",
} as const;

export const chartAxisStyles = {
  tickLabelProps: {
    fill: "#667085",
    fontSize: 11,
    fontFamily: '"IBM Plex Sans", sans-serif',
  },
  labelProps: {
    fill: "#334155",
    fontSize: 12,
    fontFamily: '"IBM Plex Sans", sans-serif',
    fontWeight: 600,
  },
} as const;

export const chartMargin = { top: 20, right: 24, bottom: 40, left: 60 };
