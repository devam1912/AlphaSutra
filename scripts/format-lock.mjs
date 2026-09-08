import { readFileSync, writeFileSync } from 'node:fs';

// One package per line keeps generated lockfile changes reviewable alongside source changes.
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const { packages, ...metadata } = lock;
const entries = Object.entries(packages).map(
  ([name, value]) => `    ${JSON.stringify(name)}: ${JSON.stringify(value)}`,
);
const header = JSON.stringify(metadata, null, 2).slice(0, -2);
writeFileSync('package-lock.json', `${header},\n  "packages": {\n${entries.join(',\n')}\n  }\n}\n`);
