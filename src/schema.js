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

export function readSchema({ stmts }) {
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
      columns: new Map(), primaryKey: [],
    };
    tables.set(key, table);
    for (const { ColumnDef: definition, Constraint: constraint } of create.tableElts ?? []) {
      if (constraint) addConstraint(table, constraint);
      if (!definition) continue;
      const column = {
        id: table.id + '-column-' + table.columns.size, name: definition.colname,
        type: displayType(definition.typeName), foreign: false,
      };
      table.columns.set(column.name, column);
      for (const { Constraint: inline } of definition.constraints ?? []) {
        addConstraint(table, inline, column);
      }
    }
  }

  for (const { stmt: { AlterTableStmt: alter } } of stmts) {
    for (const { AlterTableCmd: command } of alter?.cmds ?? []) {
      const constraint = command.def?.Constraint;
      if (command.subtype !== 'AT_AddConstraint' ||
        !['CONSTR_PRIMARY', 'CONSTR_FOREIGN'].includes(constraint?.contype)) continue;
      const table = resolve(alter.relation);
      if (table) addConstraint(table, constraint);
      else warnings.push((constraint.conname ?? 'Ограничение') +
        ': не найдена таблица ' + displayName(alter.relation));
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
    sourceRows.forEach((source, index) => links.push({
      source, target: targetRows[index], from: table, to: target,
      label, name: constraint.conname ?? '',
    }));
  }
  return { tables: [...tables.values()], links, warnings };
}
