import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoots = ['server/src', 'client/src'];
const extensions = ['.ts', '.tsx', '.vue'];
const failures = [];
const allowedCycleGroups = new Set([
  [
    'server/src/services/permanent-deletion-service.ts',
    'server/src/services/scanner-service.ts',
    'server/src/services/watcher-service.ts'
  ].sort().join('|')
]);

function collect(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('._') || entry.name === 'dist') return [];
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return collect(target);
    if (!extensions.includes(path.extname(entry.name)) || /\.(?:test|spec)\.tsx?$/.test(entry.name) || entry.name.endsWith('.d.ts')) return [];
    return [target];
  });
}

const files = sourceRoots.flatMap((directory) => collect(path.join(root, directory)));
const fileSet = new Set(files);
const graph = new Map(files.map((file) => [file, []]));

function importsOf(source) {
  const imports = [];
  const staticPattern = /(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  const dynamicPattern = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const pattern of [staticPattern, dynamicPattern]) {
    for (const match of source.matchAll(pattern)) imports.push(match[1]);
  }
  return imports;
}

function resolveImport(sourceFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  const raw = path.resolve(path.dirname(sourceFile), specifier);
  const withoutJs = raw.replace(/\.js$/, '');
  const candidates = [raw, withoutJs, ...extensions.map((extension) => withoutJs + extension), ...extensions.map((extension) => path.join(withoutJs, 'index' + extension))];
  return candidates.find((candidate) => fileSet.has(candidate)) ?? null;
}

function relative(file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function moduleInfo(file, kind) {
  const marker = kind === 'server' ? '/server/src/modules/' : '/client/src/features/';
  const normalized = `/${relative(file)}`;
  const index = normalized.indexOf(marker);
  if (index < 0) return null;
  const rest = normalized.slice(index + marker.length).split('/');
  return { name: rest[0], layer: rest[1] ?? 'index.ts', rest };
}

const serverForbidden = /^(?:express|node:(?:fs|sqlite|child_process)|fs|child_process)$/;
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const sourceServer = moduleInfo(file, 'server');
  const sourceClient = moduleInfo(file, 'client');
  for (const specifier of importsOf(source)) {
    const target = resolveImport(file, specifier);
    if (target) graph.get(file).push(target);
    const targetServer = target && moduleInfo(target, 'server');
    const targetClient = target && moduleInfo(target, 'client');

    if (sourceServer && targetServer && sourceServer.name !== targetServer.name && targetServer.rest.join('/') !== `${targetServer.name}/index.ts`) {
      failures.push(`${relative(file)} bypasses server module entry point: ${specifier}`);
    }
    if (sourceClient && targetClient && sourceClient.name !== targetClient.name && targetClient.rest.join('/') !== `${targetClient.name}/index.ts`) {
      failures.push(`${relative(file)} bypasses client feature entry point: ${specifier}`);
    }

    if (sourceServer) {
      const forbiddenLayers = {
        domain: new Set(['routes', 'application', 'adapters']),
        ports: new Set(['routes', 'application', 'adapters']),
        application: new Set(['routes', 'adapters']),
        adapters: new Set(['routes', 'application'])
      }[sourceServer.layer];
      if (targetServer?.name === sourceServer.name && forbiddenLayers?.has(targetServer.layer)) {
        failures.push(`${relative(file)} has forbidden ${sourceServer.layer} -> ${targetServer.layer} dependency`);
      }
      if (['domain', 'ports', 'application'].includes(sourceServer.layer)) {
        if (serverForbidden.test(specifier) || (target && /\/server\/src\/(?:db|routes|services|config)\//.test(target))) {
          failures.push(`${relative(file)} imports infrastructure from ${sourceServer.layer}: ${specifier}`);
        }
      }
    }

    const sourceRelative = relative(file);
    const targetRelative = target ? relative(target) : '';
    if (/^client\/src\/api\//.test(sourceRelative) && /^client\/src\/(?:views|components|stores|features)\//.test(targetRelative)) {
      failures.push(`${sourceRelative} imports UI or state: ${specifier}`);
    }
    if (/^client\/src\/(?:components|stores|features)\//.test(sourceRelative) && /^client\/src\/views\//.test(targetRelative)) {
      failures.push(`${sourceRelative} imports a route view: ${specifier}`);
    }
  }
}

const visiting = new Set();
const visited = new Set();
function visit(file, chain = []) {
  if (visiting.has(file)) {
    const start = chain.indexOf(file);
    const cycle = chain.slice(start).concat(file);
    const group = [...new Set(cycle.map(relative))].sort().join('|');
    if (!allowedCycleGroups.has(group)) {
      failures.push(`circular import: ${cycle.map(relative).join(' -> ')}`);
    }
    return;
  }
  if (visited.has(file)) return;
  visiting.add(file);
  for (const target of graph.get(file) ?? []) visit(target, [...chain, file]);
  visiting.delete(file);
  visited.add(file);
}
for (const file of files) visit(file);

const ceilings = {
  'server/src/routes/api.ts': 1829,
  'server/src/db/repositories.ts': 27,
  'server/src/services/gallery-service.ts': 2796,
  'client/src/api/gallery.ts': 693,
  'client/src/components/FeedCard.vue': 1853,
  'client/src/components/ReelPlayerCard.vue': 1525
};
for (const [name, ceiling] of Object.entries(ceilings)) {
  const source = fs.readFileSync(path.join(root, name), 'utf8');
  const count = source.split(/\r?\n/).length - (source.endsWith('\n') ? 1 : 0);
  if (count > ceiling) failures.push(`${name} has ${count} lines; legacy ceiling is ${ceiling}`);
}

if (failures.length > 0) {
  console.error(`Architecture check failed (${failures.length}):\n- ${[...new Set(failures)].join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log(`Architecture check passed (${files.length} production source files).`);
}
