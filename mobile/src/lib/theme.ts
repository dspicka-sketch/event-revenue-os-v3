import { useColorScheme } from "react-native";

// Same semantic roles as the desktop web tokens (src/web/styles.css).
const light = {
  bg: "#f6f7f9", surface: "#ffffff", text: "#16191d", muted: "#5b6470", border: "#d9dde3",
  accent: "#1f5fbf", accentText: "#ffffff", chart: "#2a78d6",
  okBg: "#e5f4ea", okFg: "#17602f", warnBg: "#fff3d6", warnFg: "#7a4b00",
  badBg: "#fde7e7", badFg: "#9b1c1c", infoBg: "#e7effb", infoFg: "#1f4a8a",
  fixtureBg: "#ffd84d", fixtureFg: "#1a1400",
};
export type Theme = typeof light;
const dark: Theme = {
  bg: "#121418", surface: "#1b1e24", text: "#e8eaed", muted: "#a2aab5", border: "#333842",
  accent: "#6ea2ff", accentText: "#0b1220", chart: "#3987e5",
  okBg: "#173523", okFg: "#8fe0a8", warnBg: "#3a2c0d", warnFg: "#ffd27a",
  badBg: "#401b1b", badFg: "#ffb3b3", infoBg: "#182a46", infoFg: "#a9c8ff",
  fixtureBg: "#ffd84d", fixtureFg: "#1a1400",
};

export function useTheme(): Theme {
  return useColorScheme() === "dark" ? dark : light;
}
