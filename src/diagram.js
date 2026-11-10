import { placeTables } from './layout.js';

const header = 34;
const rowHeight = 25;
const colors = { header: '#dae8fc', stroke: '#6c8ebf', ink: '#172638', edge: '#526d92' };
const svgNS = 'http://www.w3.org/2000/svg';

export function layout({ tables, links }) {
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = '13px monospace';
  const textWidth = value => measure.measureText(value).width;
  for (const table of tables) {
    const rows = [...table.columns.values()];
    rows.forEach((row, index) => {
      row.tags = [row.primary && 'PK', row.foreign && 'FK'].filter(Boolean).join('/');
      row.nullability = row.required ? 'NOT NULL' : 'NULL';
      row.offset = header + index * rowHeight;
    });
    table.width = Math.ceil(Math.max(230, textWidth(table.name) + 28,
      ...rows.map(row => textWidth(row.name + '   ' + row.type) + 150)));
    table.height = header + rowHeight * rows.length;
  }
  return { tables, links, ...placeTables(tables, links) };
}

export function preview({ tables, links, width, height }) {
  function element(parent, tag, attrs, value) {
    const node = document.createElementNS(svgNS, tag);
    for (const [name, attr] of Object.entries(attrs)) node.setAttribute(name, attr);
    if (value !== undefined) node.textContent = value;
    parent?.append(node);
    return node;
  }
  const svg = element(null, 'svg', { width, height, role: 'img', 'aria-label': 'ER-диаграмма' });
  const defs = element(svg, 'defs', {});
  const markers = {
    ERzeroToMany: 'M 0 -5 L 10 0 L 0 5 M 10 0 H 16',
    ERzeroToOne: 'M 5 -5 V 5 M 0 0 H 16',
    ERmandOne: 'M 5 -5 V 5 M 12 -5 V 5',
  };
  for (const [id, shape] of Object.entries(markers)) for (const end of [false, true]) {
    const marker = element(defs, 'marker', {
      id: id + (end ? '-end' : ''), viewBox: '0 -6 25 12', refX: end ? 25 : 0, refY: 0, markerUnits: 'userSpaceOnUse',
      markerWidth: 25, markerHeight: 12, orient: 'auto',
    });
    const glyph = element(marker, 'g', end ? { transform: 'translate(25 0) scale(-1 1)' } : {});
    element(glyph, 'path', { d: shape, fill: 'none', stroke: colors.edge });
    if (id !== 'ERmandOne') {
      element(glyph, 'circle', { cx: 19, cy: 0, r: 3, fill: 'white', stroke: colors.edge });
    }
  }
  for (const link of links) {
    const line = element(svg, 'polyline', {
      points: link.points.map(point => point.join(',')).join(' '),
      fill: 'none', stroke: colors.edge, 'stroke-width': 1.4, 'marker-start': 'url(#' + link.startMarker + ')', 'marker-end': 'url(#' + link.endMarker + '-end)',
    });
    element(line, 'title', {}, link.label);
  }
  for (const table of tables) {
    const group = element(svg, 'g', { transform: 'translate(' + table.x + ' ' + table.y + ')' });
    element(group, 'rect', { width: table.width, height: header, fill: colors.header, stroke: colors.stroke });
    element(group, 'text', {
      x: table.width / 2, y: 22, 'text-anchor': 'middle', 'font-size': 13,
      'font-family': 'Arial', 'font-weight': 'bold', fill: colors.ink,
    }, table.name);
    for (const row of table.columns.values()) {
      element(group, 'rect', {
        y: row.offset, width: table.width, height: rowHeight, fill: 'white', stroke: colors.stroke,
      });
      const baseline = row.offset + 17;
      const font = { y: baseline, 'font-family': 'monospace', 'font-size': 13 };
      element(group, 'text', { ...font, x: 10, 'font-weight': 'bold',
        fill: row.primary ? '#19477a' : '#773b79' }, row.tags);
      element(group, 'text', { ...font, x: 66, fill: colors.ink }, row.name + '   ' + row.type);
      element(group, 'text', { ...font, x: table.width - 10, 'text-anchor': 'end',
        'font-weight': row.required ? 'bold' : 'normal',
        fill: row.required ? '#315d46' : '#64748b' }, row.nullability);
    }
  }
  return svg;
}

export function drawio({ tables, links }) {
  const xml = document.implementation.createDocument(null, 'mxfile');
  function add(parent, tag, attributes = {}) {
    const node = xml.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    parent.append(node);
    return node;
  }
  const sheet = add(xml.documentElement, 'diagram', { id: 'schema', name: 'ER-диаграмма' });
  const graph = add(sheet, 'mxGraphModel', { grid: 1, gridSize: 10, page: 0 });
  const root = add(graph, 'root');
  add(root, 'mxCell', { id: 0 });
  add(root, 'mxCell', { id: 1, parent: 0 });
  const common = 'strokeColor=' + colors.stroke + ';fontColor=' + colors.ink + ';fontSize=13;';

  function rowLabel(row) {
    const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    const key = row.primary ? '#19477a' : '#773b79';
    const nullable = row.required ? '#315d46' : '#64748b';
    return '<span style="font-family:monospace;white-space:pre">' +
      '<b style="color:' + key + '">' + row.tags.padEnd(7) + '</b>' +
      escape(row.name + '   ' + row.type) + '</span>' +
      '<span style="float:right;margin-right:10px;font-family:monospace;color:' + nullable +
      ';font-weight:' + (row.required ? 'bold' : 'normal') + '">' + row.nullability + '</span>';
  }

  // As in sqltooling-drawio, rows are children of the table and are edge terminals.
  for (const table of tables) {
    const box = add(root, 'mxCell', {
      id: table.id, parent: 1, vertex: 1, value: table.name,
      style: 'shape=swimlane;horizontal=1;container=1;collapsible=0;recursiveResize=0;' +
        'startSize=' + header + ';fontStyle=1;fillColor=' + colors.header + ';swimlaneFillColor=#ffffff;' + common,
    });
    add(box, 'mxGeometry', { x: table.x, y: table.y, width: table.width, height: table.height, as: 'geometry' });
    for (const row of table.columns.values()) {
      const cell = add(root, 'mxCell', {
        id: row.id, parent: table.id, vertex: 1, value: rowLabel(row),
        style: 'align=left;spacingLeft=10;movable=0;resizable=0;fillColor=#ffffff;' +
          'html=1;whiteSpace=wrap;' + common,
      });
      add(cell, 'mxGeometry', {
        x: 0, y: row.offset, width: table.width, height: rowHeight, as: 'geometry',
      });
    }
  }
  links.forEach((link, index) => {
    const wrapper = add(root, 'object', { id: 'relation-' + index, label: '', tooltip: link.label });
    const edge = add(wrapper, 'mxCell', {
      edge: 1, parent: 1, source: link.source.id, target: link.target.id,
      style: 'startArrow=' + link.startMarker + ';endArrow=' + link.endMarker +
        ';startSize=10;endSize=10;startFill=0;endFill=0;strokeWidth=1.4;strokeColor=' + colors.edge +
        ';exitPerimeter=0;entryPerimeter=0;exitY=0.5;entryY=' + link.entryY +
        ';exitX=' + Number(link.sourceRight) + ';entryX=' + Number(link.targetRight) + ';',
    });
    const geometry = add(edge, 'mxGeometry', { relative: 1, as: 'geometry' });
    const waypoints = add(geometry, 'Array', { as: 'points' });
    for (const [x, y] of link.points.slice(1, -1)) add(waypoints, 'mxPoint', { x, y });
  });
  return new XMLSerializer().serializeToString(xml);
}
