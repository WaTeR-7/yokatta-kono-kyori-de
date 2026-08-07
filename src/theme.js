/**
 * Canvas の描画色を CSS 変数から読む。
 * 配色の定義を style.css 一箇所に集めるための薄いヘルパー。
 */

const root = document.documentElement;

export function color(name, fallback = '#000') {
  const value = getComputedStyle(root).getPropertyValue(name).trim();
  return value || fallback;
}

/** 描画のたびに getComputedStyle を呼ばずに済むよう、まとめて読んでおく。 */
export function readPalette(names) {
  const styles = getComputedStyle(root);
  const palette = {};
  for (const [key, variable] of Object.entries(names)) {
    palette[key] = styles.getPropertyValue(variable).trim();
  }
  return palette;
}
