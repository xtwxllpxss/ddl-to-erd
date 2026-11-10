import { loadModule, parse } from 'libpg-query';
import { readSchema } from './schema.js';
import { drawio, layout, preview } from './diagram.js';

const sql = document.querySelector('#sql');
const build = document.querySelector('#build');
const download = document.querySelector('#download');
const canvas = document.querySelector('#canvas');
const status = document.querySelector('#status');
const notices = document.querySelector('#notices');
let model;
let ready;
let revision = 0;

sql.addEventListener('input', () => {
  revision += 1;
  model = undefined;
  download.disabled = true;
  status.textContent = 'SQL изменён. Постройте диаграмму заново.';
  notices.replaceChildren();
});

async function render() {
  const current = revision;
  model = undefined;
  download.disabled = true;
  build.disabled = true;
  notices.replaceChildren();
  status.textContent = 'Разбираем SQL…';
  try {
    ready ??= loadModule({ wasm: Uint8Array.from(atob(PARSER_WASM), char => char.charCodeAt(0)) });
    await ready;
    const schema = readSchema(await parse(sql.value));
    if (current !== revision) return;
    for (const warning of schema.warnings) {
      const item = document.createElement('li');
      item.textContent = warning;
      notices.append(item);
    }
    if (!schema.tables.length) {
      canvas.replaceChildren();
      status.textContent = 'В SQL нет определений CREATE TABLE.';
      return;
    }
    model = layout(schema);
    canvas.replaceChildren(preview(model));
    canvas.scrollTo(0, 0);
    status.textContent = 'Таблиц: ' + model.tables.length + ' · Линий FK: ' + model.links.length;
    download.disabled = false;
  } catch (error) {
    if (current !== revision) return;
    canvas.replaceChildren();
    status.textContent = 'Ошибка построения: ' + error.message;
    if (error.sqlDetails?.cursorPosition >= 0) {
      status.textContent += ' · Позиция ' + error.sqlDetails.cursorPosition;
    }
  } finally {
    build.disabled = false;
  }
}

build.addEventListener('click', render);
download.addEventListener('click', () => {
  if (!model) return;
  const file = new Blob([drawio(model)], { type: 'application/xml;charset=utf-8' });
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'schema.drawio';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
render();
