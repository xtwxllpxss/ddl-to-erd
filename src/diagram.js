import { placeTables } from './layout.js';

const header = 34;
const rowHeight = 25;
const colors = { header: '#dae8fc', stroke: '#6c8ebf', ink: '#172638', edge: '#526d92' };
const fieldPadding = 10;
const typeColor = '#465c78';
const nullableColor = '#46596c';
const svgNS = 'http://www.w3.org/2000/svg';

function fields(row) {
  return [
    { text: row.tags, color: '#254b78', bold: true },
    { text: row.name, color: colors.ink, bold: false },
    { text: row.type, color: typeColor, bold: false },
    { text: row.nullability, color: nullableColor, bold: false },
  ];
}

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
    const columnWidth = values => Math.ceil(Math.max(0, ...values.map(textWidth)) + fieldPadding * 2);
    table.fieldWidths = [
      columnWidth(['PK/FK']),
      Math.max(80, columnWidth(rows.map(row => row.name))),
      Math.max(65, columnWidth(rows.map(row => row.type))),
      columnWidth(['NOT NULL']),
    ];
    table.width = table.fieldWidths.reduce((total, width) => total + width, 0);
    const titleWidth = Math.ceil(textWidth(table.name) + 28);
    table.fieldWidths[1] += Math.max(0, titleWidth - table.width);
    table.width = Math.max(table.width, titleWidth);
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
      let x = 0;
      fields(row).forEach(({ text, color, bold }, index) => {
        if (index) element(group, 'line', {
          x1: x, x2: x, y1: row.offset, y2: row.offset + rowHeight, stroke: colors.stroke,
        });
        element(group, 'text', {
          x: x + fieldPadding, y: row.offset + 17, 'font-family': 'monospace',
          'font-size': 13, 'font-weight': bold ? 'bold' : 'normal', fill: color,
        }, text);
        x += table.fieldWidths[index];
      });
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

  // Native table rows remain edge terminals and can be inserted in draw.io.
  for (const table of tables) {
    const box = add(root, 'mxCell', {
      id: table.id, parent: 1, vertex: 1, value: table.name,
      style: 'shape=table;container=1;collapsible=0;childLayout=tableLayout;fixedHeader=1;' +
        'tableRender=collapsed;startSize=' + header + ';fontStyle=1;fillColor=' +
        colors.header + ';swimlaneFillColor=#ffffff;' + common,
    });
    add(box, 'mxGeometry', { x: table.x, y: table.y, width: table.width, height: table.height, as: 'geometry' });
    for (const row of table.columns.values()) {
      const cell = add(root, 'mxCell', {
        id: row.id, parent: table.id, vertex: 1,
        style: 'shape=tableRow;horizontal=0;startSize=0;swimlaneHead=0;swimlaneBody=0;' +
          'strokeColor=inherit;collapsible=0;dropTarget=0;fillColor=none;fixedHeader=1;' +
          'points=[[0,0.5],[1,0.5]];portConstraint=eastwest;',
      });
      add(cell, 'mxGeometry', {
        x: 0, y: row.offset, width: table.width, height: rowHeight, as: 'geometry',
      });
      let x = 0;
      fields(row).forEach(({ text, color, bold }, index) => {
        const width = table.fieldWidths[index];
        const field = add(root, 'mxCell', {
          id: row.id + '-field-' + index, parent: row.id, vertex: 1, connectable: 0, value: text,
          style: 'shape=partialRectangle;html=0;overflow=hidden;pointerEvents=1;' +
            'strokeColor=inherit;fillColor=none;align=left;spacing=0;spacingLeft=' + fieldPadding +
            ';fontFamily=monospace;fontSize=13;fontColor=' + color + ';fontStyle=' + Number(bold) + ';',
        });
        add(field, 'mxGeometry', { x, y: 0, width, height: rowHeight, as: 'geometry' });
        x += width;
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
