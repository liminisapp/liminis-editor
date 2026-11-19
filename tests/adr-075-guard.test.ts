/**
 * The lint rules this package relies on, proven against the real `oxlint`
 * binary and the real `.oxlintrc.json` (ADR-209).
 *
 * Two things are at stake. The ADR-075 host-boundary guard used to be three
 * `no-restricted-syntax` selectors in ESLint; Oxlint has no such rule, so it is
 * a JS plugin (`lint/adr-075-host-boundary.mjs`), and JS plugins are an alpha
 * API that is not under semver. And the rule *set* was migrated rather than
 * copied, so a spot-check that the rules we depend on still fire is cheap
 * insurance against a silent loss of coverage.
 *
 * Fixtures are written to a temp directory at run time rather than committed:
 * a committed `window.api` fixture would fail `tsc` (tests/ is in the project)
 * and `pnpm lint` itself.
 *
 * Every "must be clean" assertion is paired with a "must report" one in the
 * same run, so a guard that fails to load cannot masquerade as a clean result.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OXLINT = join(ROOT, 'node_modules', 'oxlint', 'bin', 'oxlint');
const PLUGIN = join(ROOT, 'lint', 'adr-075-host-boundary.mjs');

interface Diagnostic {
  message: string;
  code: string;
  severity: string;
  filename: string;
}

// `.oxlintrc.json` is JSONC; the comments here are all whole-line.
function readRealConfig(): any {
  const text = readFileSync(join(ROOT, '.oxlintrc.json'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  return JSON.parse(text);
}

const guardOverride = (config: any) =>
  config.overrides.find((o: { rules: Record<string, unknown> }) => 'adr-075/host-boundary' in o.rules);

/** The real config, retargeted at a temp directory: absolute plugin path, guard override matching every file. */
function configFor(opts: { typeAware: boolean; plugin?: string }): string {
  const config = readRealConfig();
  config.jsPlugins = [opts.plugin ?? PLUGIN];
  guardOverride(config).files = ['**/*'];
  config.ignorePatterns = [];
  config.options = { typeAware: opts.typeAware };
  delete config.$schema;
  return JSON.stringify(config);
}

function runOxlint(cwd: string, configPath: string, args: string[]) {
  const res = spawnSync(process.execPath, [OXLINT, '-c', configPath, '--format', 'json', ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 120_000,
  });
  let diagnostics: Diagnostic[] = [];
  try {
    diagnostics = (JSON.parse(res.stdout) as { diagnostics: Diagnostic[] }).diagnostics;
  } catch {
    // leave empty; callers assert on status/stderr where that matters
  }
  return { status: res.status, output: `${res.stdout}${res.stderr}`, diagnostics };
}

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'adr-075-guard-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function lintSource(name: string, source: string) {
  const file = join(dir, name);
  writeFileSync(file, source);
  const cfg = join(dir, 'guard.oxlintrc.json');
  writeFileSync(cfg, configFor({ typeAware: false }));
  const { diagnostics, status } = runOxlint(dir, cfg, [name]);
  return { status, guard: diagnostics.filter((d) => d.code === 'adr-075(host-boundary)') };
}

const TAIL =
  'Add the capability to EditorHostServices (src/host/types.ts), give it a safe default (src/host/defaults.ts), and implement it in the host adapter. See ADR-075.';
const DOTTED = `@liminis/editor must not reach into the host via window.api. ${TAIL}`;
const COMPUTED = `@liminis/editor must not reach into the host via window["api"]. ${TAIL}`;
const CAST = `@liminis/editor must not reach into the host by casting window to expose \`api\`. ${TAIL}`;

describe('ADR-075 host-boundary guard', () => {
  it('is registered and enabled at error under src/**', () => {
    const config = readRealConfig();
    expect(config.jsPlugins).toContain('./lint/adr-075-host-boundary.mjs');
    const override = guardOverride(config);
    expect(override.files).toEqual(['src/**/*.{ts,tsx}']);
    expect(override.rules['adr-075/host-boundary']).toBe('error');
  });

  it.each([
    ['window.api', 'export const a = window.api'],
    ['window?.api', 'export const a = window?.api'],
    ['globalThis.api', 'export const a = globalThis.api'],
    ['window.api call', 'export const a = window.api.send()'],
  ])('reports the dotted form: %s', (_label, source) => {
    const { guard, status } = lintSource('dotted.ts', source);
    expect(guard.map((d) => d.message)).toEqual([DOTTED]);
    expect(guard[0].severity).toBe('error');
    expect(status).not.toBe(0);
  });

  it.each([
    ["window['api']", "export const a = window['api']"],
    ["window?.['api']", "export const a = window?.['api']"],
    ["globalThis['api']", "export const a = globalThis['api']"],
  ])('reports the computed form: %s', (_label, source) => {
    const { guard } = lintSource('computed.ts', source);
    expect(guard.map((d) => d.message)).toEqual([COMPUTED]);
  });

  it.each([
    ['double cast', 'export const a = (window as unknown as { api: number }).api'],
    ['single cast', 'export const a = (window as { api: number }).api'],
    ['computed cast', "export const a = (window as unknown as { api: number })['api']"],
    ['globalThis cast', 'export const a = (globalThis as unknown as { api: number }).api'],
  ])('reports the cast form: %s', (_label, source) => {
    const { guard } = lintSource('cast.ts', source);
    expect(guard.map((d) => d.message)).toEqual([CAST]);
  });

  it('reports every pattern in one file, and nothing for the near misses beside them', () => {
    const { guard } = lintSource(
      'mixed.ts',
      [
        'declare const svc: object',
        'declare const foo: { api: number }',
        // positive controls: if the plugin did not load, these would vanish
        'export const p1 = window.api',
        "export const p2 = window['api']",
        'export const p3 = (window as unknown as { api: number }).api',
        // near misses
        'export const n1 = (svc as unknown as { api: number }).api',
        'export const n2 = (svc as { api: number }).api',
        'export const n3 = foo.api',
        'export const n4 = window.apiKey',
        'export const n5 = window.location',
        "export const n6 = window['other']",
        'export const n7 = globalThis.api2',
      ].join('\n'),
    );
    expect(guard.map((d) => d.message)).toEqual([DOTTED, COMPUTED, CAST]);
  });

  it('fails loudly, rather than passing quietly, when the plugin path does not resolve', () => {
    writeFileSync(join(dir, 'x.ts'), 'export const a = window.api');
    const cfg = join(dir, 'broken.oxlintrc.json');
    writeFileSync(cfg, configFor({ typeAware: false, plugin: join(dir, 'does-not-exist.mjs') }));
    const { status, output, diagnostics } = runOxlint(dir, cfg, ['x.ts']);
    expect(status).not.toBe(0);
    expect(output).toMatch(/Failed to load JS plugin/);
    expect(diagnostics).toEqual([]);
  });
});

describe('type-aware rules the migration must preserve', () => {
  it('still reports the seeded bugs, with the project messages', () => {
    const project = join(dir, 'probe');
    mkdirSync(project);
    // oxlint finds the tsgolint binary by node resolution from the working directory.
    symlinkSync(join(ROOT, 'node_modules'), join(project, 'node_modules'), 'dir');
    writeFileSync(
      join(project, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { strict: true, target: 'es2022', lib: ['es2022', 'dom'], noEmit: true },
        include: ['*.ts'],
      }),
    );
    writeFileSync(join(project, 'other.ts'), 'export async function fetchThing(): Promise<number> { return 1 }\n');
    writeFileSync(
      join(project, 'probe.ts'),
      [
        "import { fetchThing } from './other'",
        'async function local() {}',
        'export async function run(n: number, maybe: string | undefined, flag: Promise<boolean>) {',
        '  local()', // floating (local)
        '  fetchThing()', // floating (imported)
        '  if (flag) { /* promise in a conditional */ }',
        '  ;[1].forEach(async () => { await local() })', // async callback to forEach
        '  const a = n as number', // unnecessary assertion
        '  const b = (maybe ?? "x")!', // unnecessary non-null assertion
        '  confirm("sure?")', // restricted global
        '  return [a, b]',
        '}',
      ].join('\n'),
    );
    const cfg = join(project, 'probe.oxlintrc.json');
    writeFileSync(cfg, configFor({ typeAware: true }));
    const { diagnostics } = runOxlint(project, cfg, ['--type-aware', '--tsconfig', 'tsconfig.json', 'probe.ts']);
    const byCode = (code: string) => diagnostics.filter((d) => d.code === code);

    expect(byCode('typescript(no-floating-promises)').length).toBeGreaterThanOrEqual(2);
    expect(byCode('typescript(no-floating-promises)')[0].severity).toBe('warning');
    expect(byCode('typescript(no-misused-promises)').length).toBeGreaterThanOrEqual(2); // conditional + forEach
    expect(byCode('typescript(no-misused-promises)')[0].severity).toBe('error');
    expect(byCode('typescript(no-unnecessary-type-assertion)').length).toBeGreaterThanOrEqual(2);
    const confirmFindings = byCode('eslint(no-restricted-globals)');
    expect(confirmFindings).toHaveLength(1);
    expect(confirmFindings[0].message).toContain('Use a dialog component instead of confirm()');
    expect(confirmFindings[0].severity).toBe('warning');
  }, 120_000);
});

describe('toolchain', () => {
  it('runs the installed oxlint binary', () => {
    const out = execFileSync(process.execPath, [OXLINT, '--version'], { encoding: 'utf8' });
    expect(out).toMatch(/\d+\.\d+\.\d+/);
  });
});
