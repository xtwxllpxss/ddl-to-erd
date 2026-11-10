const header = 34;
const rowHeight = 25;
const colors = { header: '#dae8fc', stroke: '#6c8ebf', ink: '#172638', edge: '#526d92' };
const svgNS = 'http://www.w3.org/2000/svg';

export function layout({ tables, links }) {
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = '13px monospace';
  const textWidth = value => measure.measureText(value).width;
  const across = Math.min(3, Math.ceil(Math.sqrt(tables.length)));
  const widths = Array(across).fill(0);
  tables.forEach((table, index) => {
    const rows = [...table.columns.values()];
    rows.forEach((row, rowIndex) => {
      const tags = [table.primaryKey.includes(row.name) && 'PK', row.foreign && 'FK'].filter(Boolean);
      row.label = (tags.length ? tags.join('/') + '  ' : '') + row.name + '   ' + row.type;
      row.offset = header + rowIndex * rowHeight;
    });
    table.width = Math.ceil(Math.max(200, textWidth(table.name) + 28,
      ...rows.map(row => textWidth(row.label) + 26)));
    table.height = header + rowHeight * rows.length;
    const column = index % across;
    widths[column] = Math.max(widths[column], table.width);
  });

  let y = 50;
  const gutter = 104;
  const origins = widths.map((_, index) => 48 + widths.slice(0, index)
    .reduce((x, width) => x + width + gutter, 0));
  for (let start = 0; start < tables.length; start += across) {
    const group = tables.slice(start, start + across);
    group.forEach((table, column) => {
      table.column = column;
      table.x = origins[column];
      table.y = y;
    });
    y += Math.max(...group.map(table => table.height)) + 90;
  }
  const width = origins.at(-1) + widths.at(-1) + 48;

  const routeCounts = new Map();
  for (const link of links) {
    const { from, to, source, target } = link;
    const same = from === to;
    const right = from.column <= to.column;
    const targetRight = from.column === to.column || !right;
    const x1 = from.x + (right ? from.width : 0);
    const x2 = to.x + (targetRight ? to.width : 0);
    const y1 = from.y + source.offset + rowHeight / 2;
    const y2 = to.y + target.offset + rowHeight / 2;
    const key = from.id + '/' + to.id;
    const lane = routeCounts.get(key) ?? 0;
    routeCounts.set(key, lane + 1);
    const gap = 18 + 5 * (lane % 6);
    const corridor = (table, onRight) => onRight ?
      table.x + widths[table.column] + gap : table.x - gap;
    const a = same ? x1 + gap : corridor(from, right);
    const b = same ? a : corridor(to, targetRight);
    link.right = right;
    link.targetRight = targetRight;
    if (same && y1 === y2) {
      link.points = [[x1, y1], [a + 6, y1], [a + 6, y1 - 16], [a, y1 - 16], [a, y2], [x2, y2]];
    } else if (same || (from.y === to.y && Math.abs(from.column - to.column) === 1)) {
      const elbow = same ? a : a;
      link.points = [[x1, y1], [elbow, y1], [elbow, y2], [x2, y2]];
    } else {
      const track = Math.min(from.y, to.y) - gap;
      link.points = [[x1, y1], [a, y1], [a, track], [b, track], [b, y2], [x2, y2]];
    }
  }
  return { tables, links, width, height: y - 45 };
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
  const marker = element(defs, 'marker', {
    id: 'arrow', viewBox: '0 0 10 10', refX: 9, refY: 5,
    markerWidth: 8, markerHeight: 8, orient: 'auto-start-reverse',
  });
  element(marker, 'path', { d: 'M 1 1 L 9 5 L 1 9', fill: 'none', stroke: colors.edge });
  for (const link of links) {
    const line = element(svg, 'polyline', {
      points: link.points.map(point => point.join(',')).join(' '),
      fill: 'none', stroke: colors.edge, 'stroke-width': 1.4, 'marker-end': 'url(#arrow)',
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
      element(group, 'text', {
        x: 11, y: row.offset + 17, 'font-family': 'monospace', 'font-size': 13, fill: colors.ink,
      }, row.label);
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
        id: row.id, parent: table.id, vertex: 1, value: row.label,
        style: 'align=left;spacingLeft=10;movable=0;resizable=0;fillColor=#ffffff;' +
          'fontFamily=monospace;whiteSpace=wrap;' + common,
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
      style: 'endArrow=open;endFill=0;strokeWidth=1.4;strokeColor=' + colors.edge +
        ';exitPerimeter=0;entryPerimeter=0;exitY=0.5;entryY=0.5;exitX=' + Number(link.right) +
        ';entryX=' + Number(link.targetRight) + ';',
    });
    const geometry = add(edge, 'mxGeometry', { relative: 1, as: 'geometry' });
    const waypoints = add(geometry, 'Array', { as: 'points' });
    for (const [x, y] of link.points.slice(1, -1)) add(waypoints, 'mxPoint', { x, y });
  });
  return new XMLSerializer().serializeToString(xml);
}
