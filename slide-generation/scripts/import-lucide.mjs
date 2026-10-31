// Build-time only: extract literal icon data without importing/evaluating package code.
import { Parser } from 'acorn';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
const packageRoot = resolve(process.argv[2] ?? 'node_modules/lucide-react');
const destination = resolve(process.argv[3] ?? 'assets/icons/lucide.json');
const pkg = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
if (pkg.name !== 'lucide-react') throw new Error('Expected lucide-react package');
const directory = join(packageRoot, 'dist/esm/icons');
function literal(node) {
  if (node.type === 'Literal' && ['string', 'number', 'boolean'].includes(typeof node.value)) return node.value;
  if (node.type === 'ArrayExpression') return node.elements.map(literal);
  if (node.type === 'ObjectExpression') return Object.fromEntries(node.properties.map(p => {
    if (p.type !== 'Property' || p.computed || p.method || p.shorthand || p.kind !== 'init') throw new Error('Non-literal icon data');
    const key = p.key.name ?? p.key.value;
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Unsafe icon key');
    return [key, literal(p.value)];
  }));
  throw new Error(`Unexpected ${node.type}`);
}
const icons = [], aliases = new Map(), sourceDigests = [];
for (const file of (await readdir(directory)).filter(f => f.endsWith('.mjs')).sort()) {
  const source = await readFile(join(directory, file), 'utf8');
  sourceDigests.push([file, createHash('sha256').update(source).digest('hex')]);
  const ast = Parser.parse(source, { sourceType: 'module', ecmaVersion: 'latest' });
  const declaration = ast.body.flatMap(n => n.type === 'VariableDeclaration' ? n.declarations : []).find(d => d.id.name === '__iconData');
  if (declaration) {
    const data = literal(declaration.init);
    icons.push({ name: data.name, size: data.size, node: data.node.map(([tag, attrs]) => [tag, Object.fromEntries(Object.entries(attrs).filter(([key]) => key !== 'key'))]), aliases: [] });
  } else {
    const target = ast.body.find(n => n.type === 'ExportNamedDeclaration' && n.source)?.source.value;
    if (!target) throw new Error(`Missing icon data or alias in ${file}`);
    aliases.set(file.slice(0, -4), target.replace('./', '').replace('.mjs', ''));
  }
}
const byName = new Map(icons.map(i => [i.name, i]));
for (const [name, target] of aliases) {
  let canonical = target, count = 0;
  while (aliases.has(canonical)) { if (++count > aliases.size) throw new Error('Alias cycle'); canonical = aliases.get(canonical); }
  const icon = byName.get(canonical); if (!icon) throw new Error(`Missing alias target ${canonical}`);
  icon.aliases.push(name);
}
icons.sort((a, b) => a.name.localeCompare(b.name));
const catalog = { schemaVersion: 1, catalogVersion: pkg.version, package: pkg.name, sourceDigest: createHash('sha256').update(JSON.stringify(sourceDigests)).digest('hex'), icons };
await writeFile(destination, JSON.stringify(catalog) + '\n');
console.log(JSON.stringify({ version: pkg.version, canonicalIcons: icons.length, aliases: aliases.size, sourceDigest: catalog.sourceDigest }));
