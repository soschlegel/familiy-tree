// Text-Import einer Datei zur Build-Zeit (`import text from "…?raw"`):
// Webpack-Regel in next.config.mjs, in Vitest/Vite eingebaut.
declare module "*?raw" {
  const content: string;
  export default content;
}
