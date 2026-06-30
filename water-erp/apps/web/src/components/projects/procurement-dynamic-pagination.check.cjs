const fs = require('node:fs');
const path = require('node:path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const source = fs.readFileSync(
  path.resolve(__dirname, '../../app/(main)/procurements/page.tsx'),
  'utf8',
);

assert(
  /setPagination\(prev => \(\{[\s\S]*pageSize: prev\.pageSize,[\s\S]*total: listRes\.pagination\.total,[\s\S]*totalPages: listRes\.pagination\.totalPages,[\s\S]*\}\)\)/.test(source),
  'expected API pagination response to preserve the dynamically calculated pageSize while merging total/totalPages',
);

assert(
  !source.includes('setPagination(listRes.pagination)'),
  'pagination response must not replace local dynamic pagination state wholesale',
);

assert(
  /setPagination\(prev => \(prev\.pageSize === newPageSize[\s\S]*\? prev[\s\S]*: \{ \.\.\.prev, page: 1, pageSize: newPageSize \}/.test(source),
  'expected dynamic page size changes to update pageSize only when changed and reset to page 1',
);

console.log('procurement-dynamic-pagination-check:ok');
