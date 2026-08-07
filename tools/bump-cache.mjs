/**
 * キャッシュ対策のバージョン付け。`node tools/bump-cache.mjs` で実行する。
 *
 * ビルド無しの ES モジュール構成では、index.html と src/*.js が別々に
 * キャッシュされる。DOM の id を1つ削っただけでも「古い JS + 新しい HTML」の
 * 組み合わせが成立してしまい、null 参照でゲームが起動しなくなる。
 *
 * そこで全モジュール URL に同じ ?v= を付ける。こうすると
 *   - 古い index.html は古い JS を指す（＝古い組み合わせで整合）
 *   - 新しい index.html は新しい URL を指すので必ず取り直される
 * となり、新旧が混ざらない。
 *
 * test/ は Node から直接読むので触らない。
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2] || new Date().toISOString().replace(/\D/g, '').slice(0, 12);

/** 既存の ?v=... を消してから付け直す。 */
function stamp(path) {
  return `${path.replace(/\?v=[\w.-]+$/, '')}?v=${version}`;
}

let touched = 0;

function rewrite(file, replacer) {
  const full = join(root, file);
  const before = readFileSync(full, 'utf8');
  const after = replacer(before);
  if (after !== before) {
    writeFileSync(full, after, 'utf8');
    touched++;
    console.log(`  updated ${file}`);
  }
}

rewrite('index.html', (text) => text
  .replace(/(<link rel="stylesheet" href=")([^"]+?)(">)/g, (_, a, path, b) => a + stamp(path) + b)
  .replace(/(<script type="module" src=")([^"]+?)(">)/g, (_, a, path, b) => a + stamp(path) + b)
  // SNS はカード画像を強くキャッシュするので、URL を変えないと差し替わらない
  .replace(/((?:og|twitter):image" content=")([^"]+?og\.png)(\?v=[\w.-]+)?(")/g,
    (_, a, path, __, b) => a + stamp(path) + b));

for (const name of readdirSync(join(root, 'src'))) {
  if (!name.endsWith('.js')) continue;
  rewrite(join('src', name), (text) => text
    // 静的 import の相対指定
    .replace(/(from\s+')(\.\/[^']+?\.js)(\?v=[\w.-]+)?(')/g, (_, a, path, __, b) => a + stamp(path) + b)
    // Worker の URL
    .replace(/(new URL\(')(\.\/[^']+?\.js)(\?v=[\w.-]+)?('\s*,\s*import\.meta\.url\))/g,
      (_, a, path, __, b) => a + stamp(path) + b));
}

console.log(`\ncache version = ${version}  (${touched} files)`);
