/* 只读扫描源文件；仅重写本目录的静态清单。不连接数据库、不启动服务。 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const ts = createRequire(path.join(root, 'package.json'))('typescript');
const active = ['public-portal', 'mall', 'supplier-portal-next', 'web', 'expert-portal', 'bid-portal', 'assistant', 'bigscreen'];
const rel = f => path.relative(root, f).split(path.sep).join('/');
const hashes = {};
function read(f) { const t = fs.readFileSync(f, 'utf8'); hashes[rel(f)] = crypto.createHash('sha256').update(t).digest('hex'); return t; }
function files(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]).sort(); }
function csv(name, headers, rows) { fs.writeFileSync(path.join(__dirname, name), '\ufeff' + [headers, ...rows].map(r => r.map(v => '"' + String(v ?? '').replaceAll('"', '""') + '"').join(',')).join('\r\n') + '\r\n'); }
function decorators(n) { return (ts.canHaveDecorators(n) ? ts.getDecorators(n) : [])?.map(d => { const e = d.expression; return { name: ts.isCallExpression(e) ? e.expression.getText() : e.getText(), args: ts.isCallExpression(e) ? [...e.arguments] : [] }; }) || []; }
function value(n) { if (!n) return ''; if (ts.isStringLiteralLike(n)) return n.text; if (ts.isArrayLiteralExpression(n)) return n.elements.map(value); return n.getText(); }
function attr(ds, k) { return ds.find(d => d.name === k); }
function annotation(ds) { return ds.filter(d => ['Public', 'OptionalAuth', 'AnyRole', 'Roles', 'UseGuards'].includes(d.name)).map(d => '@' + d.name + '(' + d.args.map(a => a.getText()).join(', ') + ')').join('; '); }
const api = [];
const controllers = files(path.join(root, 'apps/api/src')).filter(f => f.endsWith('.controller.ts'));
for (const f of controllers) {
  const sf = ts.createSourceFile(f, read(f), ts.ScriptTarget.Latest, true);
  for (const cls of sf.statements.filter(ts.isClassDeclaration)) {
    const cd = decorators(cls), c = attr(cd, 'Controller'); if (!c) continue;
    let prefix = value(c.args[0]); if (!Array.isArray(prefix)) prefix = [prefix];
    for (const m of cls.members.filter(ts.isMethodDeclaration)) {
      const md = decorators(m), routes = md.filter(d => /^(Get|Post|Put|Patch|Delete|Head|Options|All)$/.test(d.name));
      let summary = ''; const op = attr(md, 'ApiOperation');
      if (op?.args[0] && ts.isObjectLiteralExpression(op.args[0])) summary = value(op.args[0].properties.find(p => p.name?.getText() === 'summary')?.initializer);
      for (const r of routes) {
        let suffix = value(r.args[0]); if (!Array.isArray(suffix)) suffix = [suffix];
        for (const p of prefix) for (const s of suffix) api.push([r.name.toUpperCase(), ('/api/' + p + '/' + s).replace(/\/{2,}/g, '/').replace(/\/$/, ''), cls.name?.getText(), m.name.getText(), summary, annotation(cd), annotation(md), rel(f), sf.getLineAndCharacterOfPosition(m.getStart()).line + 1]);
      }
    }
  }
}
csv('01-API接口清单.csv', ['HTTP方法', '含全局前缀的路由', '控制器', '方法名', 'Swagger摘要', '类级鉴权注解', '方法级鉴权注解', '源码路径', '行号'], api);
const schemaPath = path.join(root, 'apps/api/prisma/schema.prisma'), schema = read(schemaPath);
const models = [], fields = [], enums = [];
for (const m of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
  const [, name, body] = m, table = body.match(/@@map\("([^"]+)"\)/)?.[1] || name;
  const start = schema.slice(0, m.index).split('\n').length;
  const lines = body.split('\n'); let count = 0;
  for (let i = 0; i < lines.length; i++) { const raw = lines[i].trim(); if (!raw || raw.startsWith('//') || raw.startsWith('@@')) continue; const match = raw.match(/^(\w+)\s+(\S+)(.*)$/); if (!match) continue; count++; const [,field,type,tail] = match; const split = tail.indexOf('//'); fields.push([name, table, field, type, (split < 0 ? tail : tail.slice(0, split)).trim(), split < 0 ? '' : tail.slice(split + 2).trim(), 'apps/api/prisma/schema.prisma', start + i]); }
  models.push([name, table, count, [...body.matchAll(/^\s*(@@.+)$/gm)].map(a => a[1]).join(' | '), 'apps/api/prisma/schema.prisma', start]);
}
for (const m of schema.matchAll(/^enum\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) for (const line of m[2].split('\n')) { const a = line.trim(); if (a && !a.startsWith('//') && !a.startsWith('@@')) enums.push([m[1], a.split(/\s+/)[0], a.includes('//') ? a.slice(a.indexOf('//') + 2).trim() : '']); }
csv('02-数据库模型清单.csv', ['Prisma模型', '数据库映射表名', '声明字段数含关系字段', '模型约束与映射', '源码路径', '行号'], models);
csv('03-数据库字段清单.csv', ['Prisma模型', '表名', '字段名', 'Prisma类型', '属性或关系定义', '源码行内说明', '源码路径', '行号'], fields);
csv('04-数据库枚举清单.csv', ['枚举', '枚举值', '源码说明'], enums);
const pages = [], routeCounts = {};
for (const app of active) {
  const dir = path.join(root, 'apps', app, 'src/app'); routeCounts[app] = { pages: 0, handlers: 0 };
  for (const f of files(dir).filter(f => /\/(page\.tsx|route\.ts)$/.test(f))) {
    const t = read(f), isPage = f.endsWith('page.tsx');
    routeCounts[app][isPage ? 'pages' : 'handlers']++;
    const parts = path.relative(dir, path.dirname(f)).split(path.sep).filter(p => p && p !== '.' && !/^\(.+\)$/.test(p));
    const redirects = [...t.matchAll(/(?:redirect|permanentRedirect)\(([^;\n]+)\)/g)].map(m => m[1]).join(' | ');
    const exports = [...t.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g)].map(m => m[1]).join('/');
    pages.push([app, '/' + parts.join('/'), isPage ? '页面声明' : 'Route Handler', exports, redirects, rel(f)]);
  }
}
csv('05-前端路由清单.csv', ['应用', '去除路由组后的路径', '声明类型', 'Handler方法', '静态可见重定向表达式', '源码路径'], pages);
const migrations = files(path.join(root, 'apps/api/prisma/migrations')).filter(f => f.endsWith('/migration.sql'));
const manifest = { baselineCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), generatedAt: new Date().toISOString(), basis: '生成时工作区静态快照；包含未提交代码。计数不是运行验证。', counts: { controllerFiles: controllers.length, httpRouteDeclarations: api.length, prismaModels: models.length, prismaFieldsIncludingRelations: fields.length, prismaEnums: new Set(enums.map(r => r[0])).size, migrationSqlFiles: migrations.length, activeFrontendApplications: active.length, routes: routeCounts }, sourceSha256: hashes };
fs.writeFileSync(path.join(__dirname, '代码清单快照.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest.counts, null, 2));
