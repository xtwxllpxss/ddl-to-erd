import { loadModule } from 'libpg-query';import { parseDdl } from './ddl.js';
import { readSchema } from './schema.js';
import { drawio, layout, preview } from './diagram.js';
import { moveTable } from './layout.js';
import { diagramPng } from './png.js';

const sql = document.querySelector('#sql');
const inferRelations = document.querySelector('#infer-relations');
const build = document.querySelector('#build');
const download = document.querySelector('#download');
const png = document.querySelector('#download-png');
const zoomIn = document.querySelector('#zoom-in');
const zoomOut = document.querySelector('#zoom-out');
const zoomFit = document.querySelector('#zoom-fit');
const zoomLevel = document.querySelector('#zoom-level');
const canvas = document.querySelector('#canvas');
const status = document.querySelector('#status');
const notices = document.querySelector('#notices');
let model;
let ready;
let revision = 0;
let zoom = 1;
let drag;
let exportingPng = false;

function updateControls() {
  download.disabled = !model;
  png.disabled = !model || exportingPng;
  zoomIn.disabled = !model || zoom >= 3;
  zoomOut.disabled = !model || zoom <= 0.01;
  zoomFit.disabled = !model;
  zoomLevel.value = Math.round(zoom * 100) + '%';
}

function drawPreview() {
  const svg = preview(model);
  svg.setAttribute('viewBox', '0 0 ' + model.width + ' ' + model.height);
  svg.setAttribute('width', model.width * zoom);
  svg.setAttribute('height', model.height * zoom);
  canvas.replaceChildren(svg);
}

function setZoom(next) {
  if (!model || drag) return;
  const previous = zoom;
  zoom = Math.max(0.01, Math.min(3, next));
  const left = (canvas.scrollLeft + canvas.clientWidth / 2) * zoom / previous;
  const top = (canvas.scrollTop + canvas.clientHeight / 2) * zoom / previous;
  drawPreview();
  canvas.scrollTo(left - canvas.clientWidth / 2, top - canvas.clientHeight / 2);
  updateControls();
}

zoomIn.addEventListener('click', () => setZoom(zoom * 1.25));
zoomOut.addEventListener('click', () => setZoom(zoom / 1.25));
zoomFit.addEventListener('click', () => {
  setZoom(Math.min(1, canvas.clientWidth / model.width, canvas.clientHeight / model.height));
  canvas.scrollTo(0, 0);
});

function endDrag() {
  if (!drag) return;
  const { pointer } = drag;
  drag = undefined;
  canvas.classList.remove('dragging');
  if (canvas.hasPointerCapture(pointer)) canvas.releasePointerCapture(pointer);
}

canvas.addEventListener('pointerdown', event => {
  const group = event.target.closest('[data-table]');
  if (!model || !group || drag || event.button !== 0) return;
  const table = model.tables.find(candidate => candidate.id === group.dataset.table);
  drag = { pointer: event.pointerId, table, x: table.x, y: table.y,
    startX: event.clientX + canvas.scrollLeft, startY: event.clientY + canvas.scrollTop };
  canvas.setPointerCapture(event.pointerId);
  canvas.classList.add('dragging');
  event.preventDefault();
});

canvas.addEventListener('pointermove', event => {
  if (drag?.pointer !== event.pointerId || !model) return;
  const x = drag.x + (event.clientX + canvas.scrollLeft - drag.startX) / zoom;
  const y = drag.y + (event.clientY + canvas.scrollTop - drag.startY) / zoom;
  moveTable(model, drag.table, x, y);
  drawPreview();
});

for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  canvas.addEventListener(type, event => {
    if (drag?.pointer === event.pointerId) endDrag();
  });
}


sql.addEventListener('input', () => {
  revision += 1;
  model = undefined;
  endDrag();
  updateControls();
  status.textContent = 'SQL изменён. Постройте диаграмму заново.';
  notices.replaceChildren();
});

async function render() {
  const current = revision;
  model = undefined;
  endDrag();
  updateControls();
  build.disabled = true;
  inferRelations.disabled = true;
  notices.replaceChildren();
  status.textContent = 'Разбираем SQL…';
  try {
    ready ??= loadModule({ wasm: Uint8Array.from(atob(PARSER_WASM), char => char.charCodeAt(0)) });
    await ready;
    const schema = readSchema(await parseDdl(sql.value), inferRelations.checked);
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
    zoom = 1;
    drawPreview();
    canvas.scrollTo(0, 0);
    const inferred = model.links.filter(link => link.inferred).length;
    status.textContent = 'Таблиц: ' + model.tables.length + ' · Линий FK: ' + (model.links.length - inferred);
    if (inferRelations.checked) status.textContent += ' · Предположено: ' + inferred;
    updateControls();
  } catch (error) {
    if (current !== revision) return;
    canvas.replaceChildren();
    status.textContent = 'Ошибка построения: ' + error.message;
    if (error.sqlDetails?.cursorPosition >= 0) {
      status.textContent += ' · Позиция ' + error.sqlDetails.cursorPosition;
    }
  } finally {
    build.disabled = false;
    inferRelations.disabled = false;
  }
}

build.addEventListener('click', render);
inferRelations.addEventListener('change', render);
function save(file, name) {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

download.addEventListener('click', () => {
  if (!model) return;
  save(new Blob([drawio(model)], { type: 'application/xml;charset=utf-8' }), 'schema.drawio');
});

png.addEventListener('click', async () => {
  if (!model || exportingPng) return;
  exportingPng = true;
  updateControls();
  const current = revision;
  try {
    save(await diagramPng(model), 'schema.png');
  } catch (error) {
    if (current === revision) status.textContent = 'Ошибка экспорта PNG: ' + error.message;
  } finally {
    exportingPng = false;
    updateControls();
  }
});
render();
