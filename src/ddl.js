import { parse, scan } from 'libpg-query';

const collections = new Set(['set', 'map', 'list', 'frozen', 'tuple']);

function collectionEnd(words, opening) {
  let depth = 1;
  for (let i = opening + 1; i < words.length; i++) {
    const word = words[i];
    if (word === '<') depth++;
    else if (/^>+$/.test(word)) {
      depth -= word.length;
      if (depth <= 0) return depth === 0 ? i : -1;
    } else if (word !== ',' && word !== '.' && !/^(?:[\w\u0080-\uffff]+|"[^]*")$/.test(word)) {
      return -1;
    }
  }
  return -1;
}

function tableOptionsEnd(words, tokens, start) {
  let cursor = start;
  do {
    cursor++;
    if (words[cursor] === 'compact' && words[cursor + 1] === 'storage') {
      cursor += 2;
    } else if (words[cursor] === 'clustering' && words[cursor + 1] === 'order' &&
      words[cursor + 2] === 'by' && words[cursor + 3] === '(') {
      cursor = words.indexOf(')', cursor + 4);
      if (cursor === -1) return -1;
      cursor++;
    } else {
      if (!/^[a-z_][a-z_0-9]*$/.test(words[cursor]) || words[cursor + 1] !== '=') return -1;
      cursor += 2;
      if (words[cursor] === '{') {
        cursor = words.indexOf('}', cursor + 1);
        if (cursor === -1) return -1;
      } else {
        if (words[cursor] === '-' || words[cursor] === '+') cursor++;
        if (!tokens[cursor] || !(
          ['SCONST', 'ICONST', 'FCONST'].includes(tokens[cursor].tokenName) ||
          ['true', 'false'].includes(words[cursor])
        )) return -1;
      }
      cursor++;
    }
  } while (words[cursor] === 'and');
  return cursor === words.length || words[cursor] === ';' ? cursor - 1 : -1;
}

function blank(bytes, start, end) {
  return Array.from(bytes.subarray(start, end), byte =>
    byte === 10 ? '\n' : byte === 13 ? '\r' : ' ').join('');
}

export async function parseDdl(sql) {
  if (!/\bwith\b|\bprimary\b|\b(?:set|map|list|frozen|tuple)\b[^;]*</i.test(sql)) {
    return parse(sql);
  }

  const { tokens } = await scan(sql);
  const significant = tokens.filter(token =>
    token.tokenName !== 'SQL_COMMENT' && token.tokenName !== 'C_COMMENT');
  const words = significant.map(token => token.text.toLowerCase());
  const bytes = new TextEncoder().encode(sql);
  const decoder = new TextDecoder();
  const edits = [];
  const types = new Map();
  let isTable = false;
  let isMaterializedView = false;
  let depth = 0;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (i === 0 || words[i - 1] === ';') {
      const tableKeyword = ['temp', 'temporary', 'unlogged'].includes(words[i + 1]) ? 2 : 1;
      isTable = word === 'create' && words[i + tableKeyword] === 'table';
      isMaterializedView = word === 'create' && words[i + 1] === 'materialized' && words[i + 2] === 'view';
      depth = 0;
    }
    if (!isTable && !isMaterializedView) continue;
    if (word === '(') depth++;
    if (word === ')') depth--;

    if (isMaterializedView) {
      if (depth === 0 && word === 'primary' && words[i + 1] === 'key' && words[i + 2] === '(') {
        // Views are outside the table diagram. Keep the SELECT and omit its CQL-only suffix.
        const semicolon = words.indexOf(';', i + 3);
        const last = semicolon === -1 ? words.length - 1 : semicolon - 1;
        const start = significant[i].start;
        const end = significant[last].end;
        edits.push({ start, end, value: blank(bytes, start, end) });
        i = last;
      }
      continue;
    }

    if (depth === 1 && word === 'primary' && words[i + 1] === 'key' &&
      words[i + 2] === '(' && words[i + 3] === '(') {
      const close = words.indexOf(')', i + 4);
      const partitionKey = significant.slice(i + 4, close);
      if (close > i + 4 && partitionKey.length % 2 === 1 &&
        partitionKey.every((token, index) =>
          index % 2 ? token.text === ',' :
            token.tokenName === 'IDENT' || token.keywordName === 'UNRESERVED_KEYWORD' ||
              token.keywordName === 'COL_NAME_KEYWORD') &&
        [',', ')'].includes(words[close + 1])) {
        // The diagram shows all PK columns in order, without the CQL partition grouping.
        for (const bracket of [significant[i + 3], significant[close]]) {
          edits.push({ start: bracket.start, end: bracket.end, value: ' ' });
        }
      }
    }

    if (depth === 1 && collections.has(word) && words[i + 1] === '<' &&
      ['(', ','].includes(words[i - 2])) {
      const end = collectionEnd(words, i + 1);
      if (end !== -1) {
        const startByte = significant[i].start;
        const endByte = significant[end].end;
        // Use a short identifier so PostgreSQL cannot truncate a long nested type.
        let placeholder = 'cql_type_' + types.size;
        while (sql.toLowerCase().includes(placeholder)) placeholder += '_';
        types.set(placeholder, decoder.decode(bytes.subarray(startByte, endByte)));
        edits.push({ start: startByte, end: endByte, value: placeholder });
        i = end;
        continue;
      }
    }

    if (depth === 0 && word === 'with' && words[i - 1] === ')') {
      const lastOption = tableOptionsEnd(words, significant, i);
      if (lastOption === -1) continue;
      const start = significant[i].start;
      const end = significant[lastOption].end;
      edits.push({ start, end, value: blank(bytes, start, end) });
      i = lastOption;
    }
  }

  if (!edits.length) return parse(sql);
  let offset = 0;
  let normalized = '';
  for (const { start, end, value } of edits) {
    normalized += decoder.decode(bytes.subarray(offset, start)) + value;
    offset = end;
  }
  const ast = await parse(normalized + decoder.decode(bytes.subarray(offset)));
  for (const { stmt } of ast.stmts) {
    for (const { ColumnDef: column } of stmt.CreateStmt?.tableElts ?? []) {
      const type = column?.typeName?.names?.[0]?.String;
      if (type && types.has(type.sval)) type.sval = types.get(type.sval);
    }
  }
  return ast;
}
