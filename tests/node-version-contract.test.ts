/**
 * `@types/node` describes the Node this repository's tooling runs on — the
 * scripts, the tests, the build — and that Node is named in `.nvmrc` and in
 * every workflow's `node-version`. Types for a newer major than the one we run
 * let code type-check against APIs that do not exist at runtime.
 *
 * `.github/dependabot.yml` therefore ignores `@types/node` majors. An ignore
 * on its own would hold the types back indefinitely, long after we had moved
 * to a newer Node. This suite stops that: raising `.nvmrc` or a workflow's
 * `node-version` fails here until `@types/node` moves with it, so the types
 * follow the runtime and never decide it.
 *
 * `engines.node` is deliberately not compared. It is the floor consumers may
 * run, not the version we build and test on.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOWS = join(REPO_ROOT, '.github', 'workflows');

const major = (spec: string): number => {
  const m = /(\d+)/.exec(spec);
  if (!m) throw new Error(`no major version in ${JSON.stringify(spec)}`);
  return Number(m[1]);
};

describe('Node version contract', () => {
  const nvmrc = major(readFileSync(join(REPO_ROOT, '.nvmrc'), 'utf8'));

  it('@types/node tracks the major in .nvmrc', () => {
    const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
    expect(major(manifest.devDependencies['@types/node'])).toBe(nvmrc);
  });

  it('every workflow runs the major in .nvmrc', () => {
    const found = readdirSync(WORKFLOWS)
      .filter((f) => /\.ya?ml$/.test(f))
      .flatMap((f) =>
        [...readFileSync(join(WORKFLOWS, f), 'utf8').matchAll(/node-version:\s*['"]?([^'"\s]+)/g)].map(
          (m) => `${f}: ${major(m[1])}`,
        ),
      );
    expect(found.length).toBeGreaterThan(0);
    expect(found.filter((entry) => !entry.endsWith(`: ${nvmrc}`))).toEqual([]);
  });
});
