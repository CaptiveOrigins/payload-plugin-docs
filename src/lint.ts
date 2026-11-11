import type { Resolved } from './types.js'

export type LintHit = { kind: string; text: string }

const RULES: { kind: string; re: RegExp }[] = [
  { kind: 'environment variable', re: /\b[A-Z][A-Z0-9]*_[A-Z0-9_]{2,}\b/g },
  { kind: 'file path', re: /(?:\b(?:src|app|lib|scripts|node_modules)\/[\w./-]+|\b[\w-]+\.(?:ts|tsx|js|mjs|json|env|yml|yaml)\b)/g },
  { kind: 'IP address', re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
  { kind: 'internal host', re: /\b[\w-]+\.(?:internal|local|lan|vercel\.app|mongodb\.net)\b|\blocalhost\b/gi },
  { kind: 'key-like string', re: /\b(?:sk|pk|rk|whsec|ghp|xox[bp])[-_][A-Za-z0-9_-]{12,}\b|\b[A-Za-z0-9]{32,}\b/g },
]

/** Plain text of a rich-text value (Lexical JSON) or a string. */
export function textOf(body: unknown): string {
  if (typeof body === 'string') return body
  const out: string[] = []
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return
    const node = n as { text?: unknown; children?: unknown[]; root?: unknown; url?: unknown; fields?: { url?: unknown } }
    if (typeof node.text === 'string') out.push(node.text)
    if (typeof node.url === 'string') out.push(node.url)
    if (typeof node.fields?.url === 'string') out.push(node.fields.url)
    if (node.root) walk(node.root)
    if (Array.isArray(node.children)) node.children.forEach(walk)
  }
  walk(body)
  return out.join('\n')
}

/** Everything on a page that looks internal. Empty means clean. */
export function lint(o: Resolved, text: string): LintHit[] {
  const hits: LintHit[] = []
  const allowed = (s: string) => o.allow.some((a) => a.toLowerCase() === s.toLowerCase())
  for (const { kind, re } of RULES) for (const m of text.matchAll(re)) if (!allowed(m[0])) hits.push({ kind, text: m[0] })
  const lower = text.toLowerCase()
  for (const t of o.privateTerms) if (t && lower.includes(t.toLowerCase())) hits.push({ kind: 'private term', text: '(a private term)' })
  // Slugs only as whole words written like code (with a hyphen or as `code`), so ordinary words don't trip it.
  for (const s of o.slugs) {
    if (allowed(s)) continue
    const re = new RegExp(`(^|[^\\w-])${s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}(?=$|[^\\w-])`, 'i')
    if ((s.includes('-') || s.includes('_') || /[a-z][A-Z]/.test(s)) && re.test(text)) hits.push({ kind: 'collection or field name', text: s })
    else if (new RegExp('`' + s + '`').test(text)) hits.push({ kind: 'collection or field name', text: s })
  }
  return hits
}
