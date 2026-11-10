const margin = 52;
const verticalGap = 44;
const trackGap = 16;

const targetPort = link => link.target.id + (link.targetRight ? '-right' : '-left');

// Rank each connected group from referenced tables toward dependent tables.
export function placeTables(tables, links) {
  const parents = new Map(tables.map(table => [table, new Set()]));
  const children = new Map(tables.map(table => [table, new Set()]));
  for (const { from, to } of links) {
    if (from === to) continue;
    parents.get(from).add(to);
    children.get(to).add(from);
  }

  const remaining = new Set(tables);
  const groups = [];
  for (const seed of tables) {
    if (!remaining.delete(seed)) continue;
    const group = [seed];
    for (const table of group) {
      for (const neighbor of [...parents.get(table), ...children.get(table)]) {
        if (remaining.delete(neighbor)) group.push(neighbor);
      }
    }
    groups.push(group);
  }
  groups.sort((a, b) => b.length - a.length);

  let top = margin;
  let width = 0;
  for (const group of groups) {
    const roots = group.filter(table => !parents.get(table).size);
    const ranked = new Set(roots);
    const layers = [];
    let layer = roots.length ? roots : [group[0]];
    ranked.add(layer[0]);
    while (layer.length) {
      layers.push(layer);
      const next = [];
      for (const table of layer) {
        for (const child of children.get(table)) {
          if (ranked.has(child)) continue;
          ranked.add(child);
          next.push(child);
        }
      }
      if (!next.length && ranked.size < group.length) {
        const cycle = group.find(table => !ranked.has(table));
        ranked.add(cycle);
        next.push(cycle);
      }
      layer = next;
    }

    const groupLinks = links.filter(link => ranked.has(link.from));
    const tracks = layers.map(() => 0);
    const detours = [];
    const incoming = new Map();
    layers.forEach((tables, rank) => tables.forEach(table => { table.rank = rank; }));
    for (const link of groupLinks) {
      const { from, to } = link;
      const adjacent = Math.abs(from.rank - to.rank) === 1;
      link.sourceRight = from.rank <= to.rank;
      link.targetRight = from.rank >= to.rank;
      const sourceGutter = link.sourceRight ? from.rank : from.rank - 1;
      const targetGutter = link.targetRight ? to.rank : to.rank - 1;
      link.sourceTrack = tracks[sourceGutter]++;
      link.targetTrack = sourceGutter === targetGutter ? link.sourceTrack : tracks[targetGutter]++;
      if (!adjacent && from !== to) detours.push(link);
      const port = targetPort(link);
      if (!incoming.has(port)) incoming.set(port, []);
      incoming.get(port).push(link);
    }

    const trackTop = top;
    top += detours.length * trackGap;
    let x = margin;
    const rightEdges = [];
    let bottom = top;
    layers.forEach((tables, rank) => {
      rightEdges.push(x + Math.max(...tables.map(table => table.width)));
      for (const table of tables) table.x = x;
      x = rightEdges[rank] + 64 + trackGap * tracks[rank];
    });
    // Place parents near the center of their immediate children, preserving sibling order.
    for (let rank = layers.length - 1; rank >= 0; rank--) {
      let y = top;
      for (const table of layers[rank]) {
        const below = [...children.get(table)].filter(child => child.rank === rank + 1);
        const center = below.length ?
          (below[0].y + below.at(-1).y + below.at(-1).height) / 2 : y;
        table.y = Math.max(y, Math.round(center - table.height / 2));
        y = table.y + table.height + verticalGap;
      }
      bottom = Math.max(bottom, y);
    }

    for (const fan of incoming.values()) {
      fan.sort((a, b) => a.from.y + a.source.offset - b.from.y - b.source.offset);
      fan.forEach((link, index) => { link.fanOffset = (index - (fan.length - 1) / 2) * 7; });
    }
    const trackX = (rank, track) => rightEdges[rank] + 32 + trackGap * track;
    for (const link of groupLinks) {
      const { from, to, source, target, sourceRight, targetRight } = link;
      const x1 = from.x + (sourceRight ? from.width : 0);
      const x2 = to.x + (targetRight ? to.width : 0);
      const y1 = from.y + source.offset + 12.5;
      const selfRow = source === target;
      const y2 = to.y + target.offset + (selfRow ? 20 : 12.5);
      link.entryY = selfRow ? 0.8 : 0.5;
      const a = trackX(sourceRight ? from.rank : from.rank - 1, link.sourceTrack);
      const b = trackX(targetRight ? to.rank : to.rank - 1, link.targetTrack);
      const fan = !selfRow && link.fanOffset;
      const approach = y2 + (fan || 0);
      const tail = fan ? [[x2 + (targetRight ? 28 : -28), y2], [x2, y2]] : [[x2, y2]];
      if (a === b) {
        link.points = [[x1, y1], [a, y1], [a, approach], ...tail];
      } else {
        const track = trackTop + detours.indexOf(link) * trackGap;
        link.points = [[x1, y1], [a, y1], [a, track], [b, track], [b, approach], ...tail];
      }
    }
    width = Math.max(width, x + margin);
    top = bottom + verticalGap;
  }
  return { width, height: top };
}

// Keep the automatic layout intact for links unrelated to the moved table.
export function moveTable(model, table, x, y) {
  table.x = Math.max(margin, Math.round(x));
  table.y = Math.max(margin, Math.round(y));

  let lane = 0;
  for (const link of model.links) {
    const { from, to, source, target } = link;
    if (from !== table && to !== table) continue;
    const gap = 30 + trackGap * (lane++ % 8);
    const self = from === to;
    const separate = from.x + from.width + 60 <= to.x || to.x + to.width + 60 <= from.x;
    link.sourceRight = self || ((from.x < to.x) === separate);
    link.targetRight = self || !link.sourceRight;
    const x1 = from.x + (link.sourceRight ? from.width : 0);
    const x2 = to.x + (link.targetRight ? to.width : 0);
    const y1 = from.y + source.offset + 12.5;
    const y2 = to.y + target.offset + 25 * link.entryY;
    if (self) {
      link.points = [[x1, y1], [x1 + gap, y1], [x2 + gap, y2], [x2, y2]];
    } else if (separate) {
      const direction = link.sourceRight ? 1 : -1;
      const turn = x1 + direction * Math.min(gap, Math.abs(x2 - x1) - 28);
      const approach = y2 + (link.fanOffset || 0);
      link.points = [[x1, y1], [turn, y1], [turn, approach],
        [x2 - direction * 28, y2], [x2, y2]];
    } else {
      const left = Math.max(8, Math.min(from.x, to.x) - gap);
      const right = Math.max(from.x + from.width, to.x + to.width) + gap;
      const a = link.sourceRight ? right : left;
      const b = link.targetRight ? right : left;
      const top = Math.max(8, Math.min(from.y, to.y) - gap);
      link.points = [[x1, y1], [a, y1], [a, top], [b, top], [b, y2], [x2, y2]];
    }
  }

  model.width = margin + Math.max(...model.tables.map(box => box.x + box.width),
    ...model.links.flatMap(link => link.points.map(([x]) => x)));
  model.height = margin + Math.max(...model.tables.map(box => box.y + box.height),
    ...model.links.flatMap(link => link.points.map(([, y]) => y)));
}
