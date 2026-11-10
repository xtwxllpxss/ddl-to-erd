import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';

const wasm = await readFile('node_modules/libpg-query/wasm/libpg-query.wasm');
const { outputFiles: [script] } = await build({
  entryPoints: ['src/app.js'],
  bundle: true,
  write: false,
  minify: true,
  format: 'iife',
  external: ['node:*'],
  define: { PARSER_WASM: JSON.stringify(wasm.toString('base64')) },
});
const template = await readFile('src/page.html', 'utf8');
const licenses = await Promise.all(
  ['libpg-query', 'pgsql-types', 'sqltooling-drawio'].map(name =>
    readFile('licenses/' + name + '.txt', 'utf8')),
);
await writeFile('index.html', template.replace('<!-- APP -->', () =>
  '<!--\n' + licenses.join('\n\n') + '\n-->\n<script>' +
  script.text.replace(/<\/script/gi, '<\\/script') + '</script>'));
