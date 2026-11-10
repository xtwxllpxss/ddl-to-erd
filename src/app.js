import { loadModule } from 'libpg-query';
import { parseDdl } from './ddl.js';
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
let connection;
let manualLayout = false;
let gestureZoom;
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
  if (connection) {
    svg.querySelector('[data-column="' + connection.row.id + '"]').classList.add('connection-source');
    const line = document.createElementNS(svg.namespaceURI, 'line');
    line.setAttribute('stroke', '#24588f');
    line.setAttribute('stroke-width', '1.5');
    line.setAttribute('stroke-dasharray', '6 4');
    line.setAttribute('pointer-events', 'none');
    line.setAttribute('marker-end', 'url(#ERmandOne-end)');
    svg.append(line);
    connection.line = line;
    updateConnectionPointer();
  }
}

function setZoom(next, x = canvas.clientWidth / 2, y = canvas.clientHeight / 2) {
  if (!model || drag) return;
  const previous = zoom;
  zoom = Math.max(0.01, Math.min(3, next));
  const left = (canvas.scrollLeft + x) * zoom / previous;
  const top = (canvas.scrollTop + y) * zoom / previous;
  const svg = canvas.firstElementChild;
  svg.setAttribute('width', model.width * zoom);
  svg.setAttribute('height', model.height * zoom);
  canvas.scrollTo(left - x, top - y);
  updateConnectionPointer();
  updateControls();
}

zoomIn.addEventListener('click', () => setZoom(zoom * 1.25));
zoomOut.addEventListener('click', () => setZoom(zoom / 1.25));
zoomFit.addEventListener('click', () => {
  setZoom(Math.min(1, canvas.clientWidth / model.width, canvas.clientHeight / model.height));
  canvas.scrollTo(0, 0);
});

function zoomAt(event, next) {
  const bounds = canvas.getBoundingClientRect();
  setZoom(next, event.clientX - bounds.left, event.clientY - bounds.top);
}

canvas.addEventListener('wheel', event => {
  if (!model || !event.ctrlKey) return;
  event.preventDefault();
  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1);
  zoomAt(event, zoom * Math.exp(-delta * 0.01));
}, { passive: false });

canvas.addEventListener('gesturestart', event => {
  if (!model) return;
  event.preventDefault();
  gestureZoom = zoom;
}, { passive: false });
canvas.addEventListener('gesturechange', event => {
  if (!model || gestureZoom === undefined) return;
  event.preventDefault();
  zoomAt(event, gestureZoom * event.scale);
}, { passive: false });
canvas.addEventListener('gestureend', event => {
  if (gestureZoom === undefined) return;
  event.preventDefault();
  gestureZoom = undefined;
}, { passive: false });

function updateConnectionPointer() {
  if (!connection) return;
  const { table, row, line, clientX, clientY } = connection;
  const bounds = canvas.getBoundingClientRect();
  const x = (clientX - bounds.left + canvas.scrollLeft) / zoom;
  const y = (clientY - bounds.top + canvas.scrollTop) / zoom;
  line.setAttribute('x1', table.x + (x > table.x + table.width / 2 ? table.width : 0));
  line.setAttribute('y1', table.y + row.offset + 12.5);
  line.setAttribute('x2', x);
  line.setAttribute('y2', y);
}

function clearConnection() {
  connection = undefined;
  canvas.classList.remove('connecting');
}

function diagramStatus(message) {
  const inferred = model.links.filter(link => link.inferred).length;
  const manual = model.links.filter(link => link.manual).length;
  status.textContent = 'Таблиц: ' + model.tables.length + ' · Линий FK: ' +
    (model.links.length - inferred - manual);
  if (inferRelations.checked) status.textContent += ' · Предположено: ' + inferred;
  if (manual) status.textContent += ' · Вручную: ' + manual;
  if (message) status.textContent += ' · ' + message;
}

canvas.addEventListener('contextmenu', event => {
  const field = event.target.closest('[data-column]');
  if (!model || !field || drag) return;
  event.preventDefault();
  const table = model.tables.find(candidate => candidate.id === field.parentNode.dataset.table);
  const row = [...table.columns.values()].find(column => column.id === field.dataset.column);
  if (!connection) {
    connection = { table, row, clientX: event.clientX, clientY: event.clientY };
    canvas.classList.add('connecting');
    drawPreview();
    diagramStatus(table.name + '.' + row.name + ' → выберите целевое поле ПКМ. Esc — отмена.');
    return;
  }

  const { table: from, row: source } = connection;
  clearConnection();
  if (source === row || model.links.some(link => link.source === source && link.target === row)) {
    drawPreview();
    diagramStatus(source === row ? 'Выбор отменён.' : 'Такая связь уже есть.');
    return;
  }

  const unique = [from.primaryKey, ...from.uniqueKeys]
    .some(key => key.length === 1 && key[0] === source.name);
  model.links.push({
    source, target: row, from, to: table, manual: true, entryY: 0.5,
    label: 'Ручная связь: ' + from.name + '.' + source.name + ' → ' + table.name + '.' + row.name,
    startMarker: unique ? 'ERzeroToOne' : 'ERzeroToMany',
    endMarker: source.required ? 'ERmandOne' : 'ERzeroToOne',
  });
  if (manualLayout) moveTable(model, from, from.x, from.y);
  else model = layout(model);
  drawPreview();
  diagramStatus('Ручная связь добавлена.');
});

canvas.addEventListener('scroll', updateConnectionPointer);
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || !connection) return;
  clearConnection();
  drawPreview();
  diagramStatus('Выбор отменён.');
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
  if (!model || !group || drag || connection || event.button !== 0) return;
  const table = model.tables.find(candidate => candidate.id === group.dataset.table);
  drag = { pointer: event.pointerId, table, x: table.x, y: table.y,
    startX: event.clientX + canvas.scrollLeft, startY: event.clientY + canvas.scrollTop };
  canvas.setPointerCapture(event.pointerId);
  canvas.classList.add('dragging');
  event.preventDefault();
});

canvas.addEventListener('pointermove', event => {
  if (connection) {
    connection.clientX = event.clientX;
    connection.clientY = event.clientY;
    updateConnectionPointer();
  }
  if (drag?.pointer !== event.pointerId || !model) return;
  const x = drag.x + (event.clientX + canvas.scrollLeft - drag.startX) / zoom;
  const y = drag.y + (event.clientY + canvas.scrollTop - drag.startY) / zoom;
  manualLayout = true;
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
  clearConnection();
  model = undefined;
  endDrag();
  updateControls();
  status.textContent = 'SQL изменён. Постройте диаграмму заново.';
  notices.replaceChildren();
});

async function render() {
  const current = revision;
  clearConnection();
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
    manualLayout = false;
    zoom = 1;
    drawPreview();
    canvas.scrollTo(0, 0);
    diagramStatus();
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
