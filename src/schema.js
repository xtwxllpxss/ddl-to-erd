const names = nodes => nodes?.map(node => node.String.sval) ?? [];
const identity = relation => JSON.stringify([relation.schemaname ?? 'public', relation.relname]);
const displayName = relation => [relation.schemaname, relation.relname].filter(Boolean).join('.');

const typeAliases = {
  int2: 'smallint', int4: 'integer', int8: 'bigint', bool: 'boolean',
  float4: 'real', float8: 'double precision', bpchar: 'character', varchar: 'varchar',
};

function displayType(type) {
  if (!type) return '—';
  const parts = names(type.names);
  if (parts[0] === 'pg_catalog') parts.shift();
  const name = parts.length === 1 ? (Object.hasOwn(typeAliases, parts[0]) ?
    typeAliases[parts[0]] : parts[0]) : parts.join('.');
  const modifiers = type.typmods?.map(({ A_Const: value }) =>
    value?.ival?.ival ?? value?.fval?.fval ?? value?.sval?.sval ?? '?');
  return name + (modifiers?.length ? '(' + modifiers.join(', ') + ')' : '') +
    '[]'.repeat(type.arrayBounds?.length ?? 0);
}

export function readSchema({ stmts }, inferRelations = false) {
  const tables = new Map();
  const warnings = [];
  const foreignKeys = [];
  const links = [];

  function resolve(relation) {
    if (relation.schemaname) return tables.get(identity(relation));
    const publicTable = tables.get(identity(relation));
    if (publicTable) return publicTable;
    const candidates = [...tables.values()].filter(table => table.relation.relname === relation.relname);
    return candidates.length === 1 ? candidates[0] : undefined;
  }

  function addConstraint(table, constraint, column) {
    if (constraint.contype === 'CONSTR_PRIMARY') {
      table.primaryKey = column ? [column.name] : names(constraint.keys);
    }
    if (constraint.contype === 'CONSTR_UNIQUE') {
      table.uniqueKeys.push(column ? [column.name] : names(constraint.keys));
    }
    if (constraint.contype === 'CONSTR_FOREIGN') {
      foreignKeys.push({ table, constraint, from: column ? [column.name] : names(constraint.fk_attrs) });
    }
  }

  for (const { stmt: { CreateStmt: create } } of stmts) {
    if (!create) continue;
    const key = identity(create.relation);
    if (tables.has(key)) {
      warnings.push('Повторное определение таблицы: ' + displayName(create.relation));
      continue;
    }
    const table = {
      id: 'table-' + tables.size, name: displayName(create.relation), relation: create.relation,
      columns: new Map(), primaryKey: [], uniqueKeys: [],
    };
    tables.set(key, table);
    for (const { ColumnDef: definition, Constraint: constraint } of create.tableElts ?? []) {
      if (constraint) addConstraint(table, constraint);
      if (!definition) continue;
      const column = {
        id: table.id + '-column-' + table.columns.size, name: definition.colname,
        type: displayType(definition.typeName), foreign: false, required: false,
      };
      table.columns.set(column.name, column);
      for (const { Constraint: inline } of definition.constraints ?? []) {
        if (inline.contype === 'CONSTR_NOTNULL') column.required = true;
        addConstraint(table, inline, column);
      }
    }
  }

  for (const { stmt: { AlterTableStmt: alter } } of stmts) {
    for (const { AlterTableCmd: command } of alter?.cmds ?? []) {
      const constraint = command.def?.Constraint;
      const table = resolve(alter.relation);
      if (command.subtype === 'AT_SetNotNull' || command.subtype === 'AT_DropNotNull') {
        const column = table?.columns.get(command.name);
        if (column) column.required = command.subtype === 'AT_SetNotNull';
      }
      if (command.subtype !== 'AT_AddConstraint' ||
        !['CONSTR_PRIMARY', 'CONSTR_FOREIGN', 'CONSTR_UNIQUE', 'CONSTR_NOTNULL'].includes(constraint?.contype)) continue;
      if (constraint.contype === 'CONSTR_NOTNULL') {
        const column = table?.columns.get(names(constraint.keys)[0]);
        if (column) column.required = true;
      }
      if (table) addConstraint(table, constraint);
      else warnings.push((constraint.conname ?? 'Ограничение') +
        ': не найдена таблица ' + displayName(alter.relation));
    }
  }

  for (const table of tables.values()) {
    for (const row of table.columns.values()) {
      row.primary = table.primaryKey.includes(row.name);
      row.required ||= row.primary;
    }
  }
  for (const { table, constraint, from } of foreignKeys) {
    const target = resolve(constraint.pktable);
    const explicit = names(constraint.pk_attrs);
    const to = explicit.length ? explicit : target?.primaryKey ?? [];
    const label = constraint.conname ??
      table.name + ' (' + from.join(', ') + ') → ' + displayName(constraint.pktable);
    const sourceRows = from.map(name => table.columns.get(name));
    const targetRows = to.map(name => target?.columns.get(name));
    for (const row of sourceRows) if (row) row.foreign = true;
    if (!target || !from.length || from.length !== to.length ||
      sourceRows.some(row => !row) || targetRows.some(row => !row)) {
      warnings.push(label + ': не удалось однозначно определить пару столбцов.');
      continue;
    }
    const unique = [table.primaryKey, ...table.uniqueKeys]
      .some(key => key.length && key.every(name => from.includes(name)));
    const optional = constraint.fk_matchtype === 'f' ?
      sourceRows.every(row => !row.required) : sourceRows.some(row => !row.required);
    sourceRows.forEach((source, index) => links.push({
      source, target: targetRows[index], from: table, to: target,
      label, startMarker: unique ? 'ERzeroToOne' : 'ERzeroToMany',
      endMarker: optional ? 'ERzeroToOne' : 'ERmandOne',
    }));
  }
  if (inferRelations) {
    const connected = new Set(links.map(link => link.source));
    const candidates = [...tables.values()].flatMap(table => {
      const key = table.primaryKey.map(name => table.columns.get(name));
      if (!key.length || key.some(column => !column)) return [];
      return [{ table, key, patterns: key.map(column => table.relation.relname + '_' + column.name) }];
    });
    for (const table of tables.values()) {
      const available = [...table.columns.values()].filter(column => !connected.has(column));
      const proposals = [];
      const claims = new Map();
      for (const { table: target, key, patterns } of candidates) {
        const matches = patterns.map((pattern, index) => available.filter(column =>
          column !== key[index] && column.name.includes(pattern)));
        if (key.length === 1) {
          for (const source of matches[0]) proposals.push({ target, key, rows: [source] });
          continue;
        }
        if (matches.some(rows => !rows.length)) continue;
        const rows = matches.map(([row]) => row);
        if (matches.some(matchesForColumn => matchesForColumn.length !== 1) ||
          new Set(rows).size !== key.length) {
          warnings.push(table.name + ' → ' + target.name +
            ': неоднозначное соответствие столбцов составного ключа.');
          continue;
        }
        proposals.push({ target, key, rows });
      }
      for (const proposal of proposals) {
        for (const row of proposal.rows) claims.set(row, (claims.get(row) ?? 0) + 1);
      }
      for (const [column, count] of claims) {
        if (count > 1) warnings.push(table.name + '.' + column.name +
          ': несколько кандидатов для предполагаемой связи.');
      }
      for (const { target, key, rows } of proposals) {
        if (rows.some(row => claims.get(row) !== 1)) continue;
        const unique = [table.primaryKey, ...table.uniqueKeys]
          .some(columns => columns.length && columns.every(name => rows.some(row => row.name === name)));
        const optional = rows.some(row => !row.required);
        const label = 'Предполагаемая связь: ' + table.name + ' (' +
          rows.map(row => row.name).join(', ') + ') → ' + target.name + ' (' +
          key.map(row => row.name).join(', ') + ')';
        rows.forEach((source, index) => {
          source.inferred = true;
          links.push({
            source, target: key[index], from: table, to: target, inferred: true, label,
            startMarker: unique ? 'ERzeroToOne' : 'ERzeroToMany',
            endMarker: optional ? 'ERzeroToOne' : 'ERmandOne',
          });
        });
      }
    }
  }
  return { tables: [...tables.values()], links, warnings };
}
