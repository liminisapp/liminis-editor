// Oxlint JS plugin: the ADR-075 host-boundary guard.
//
// Oxlint has no `no-restricted-syntax`, which is what enforced this under
// ESLint (three esquery selectors in eslint.config.js). This is the same three
// checks as a small ESLint-compatible rule, with the same three messages. See
// docs/decisions/adr-209-oxlint-type-aware-and-typescript-7.md.
//
// Purely syntactic, so it needs no type information. JS plugins are alpha in
// Oxlint and not under semver: tests/adr-075-guard.test.ts is what notices if
// a release stops loading or matching this rule.
//
// Not published: `package.json` `files` is an allowlist (dist, README, LICENSE,
// docs) and this directory is outside it.

const HOST_GLOBALS = new Set(['window', 'globalThis'])

const TAIL =
  'Add the capability to EditorHostServices (src/host/types.ts), give it a safe default (src/host/defaults.ts), and implement it in the host adapter. See ADR-075.'

export const MESSAGES = {
  dotted: `@liminis/editor must not reach into the host via window.api. ${TAIL}`,
  computed: `@liminis/editor must not reach into the host via window["api"]. ${TAIL}`,
  cast: `@liminis/editor must not reach into the host by casting window to expose \`api\`. ${TAIL}`,
}

const isHostIdentifier = (node) =>
  node != null && node.type === 'Identifier' && HOST_GLOBALS.has(node.name)

// `window` / `globalThis` as the operand of a cast: `window as X` (one level) or
// `window as unknown as X` (two levels, the idiomatic spelling). Anchoring on
// the operand, rather than on "is a cast", is what keeps
// `(someService as unknown as { api: Client }).api` unreported.
const isCastOfHost = (node) =>
  node != null &&
  node.type === 'TSAsExpression' &&
  (isHostIdentifier(node.expression) ||
    (node.expression != null &&
      node.expression.type === 'TSAsExpression' &&
      isHostIdentifier(node.expression.expression)))

const isApiKey = (node) =>
  !node.computed
    ? node.property.type === 'Identifier' && node.property.name === 'api'
    : node.property.type === 'Literal' && node.property.value === 'api'

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Forbid reaching the host through window.api / globalThis.api (ADR-075).',
    },
    schema: [],
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (!isApiKey(node)) return
        if (isHostIdentifier(node.object)) {
          context.report({
            node,
            message: node.computed ? MESSAGES.computed : MESSAGES.dotted,
          })
        } else if (isCastOfHost(node.object)) {
          context.report({ node, message: MESSAGES.cast })
        }
      },
    }
  },
}

export default {
  meta: { name: 'adr-075' },
  rules: { 'host-boundary': rule },
}
