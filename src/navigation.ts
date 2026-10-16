import { posix } from 'node:path'
import type { Source } from './config.js'

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }
export type JsonObject = { [key: string]: Json }

export type Child = { source: Source; docs: JsonObject }

const isObject = (v: unknown): v is JsonObject => !!v && typeof v === 'object' && !Array.isArray(v)
const isExternal = (p: string) => /^[a-z][a-z\d+.-]*:/i.test(p) || p.startsWith('//') || p.startsWith('#')
const ENDPOINT = /^(?:(\S+\.(?:json|ya?ml))\s+)?(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE|WEBHOOK)\s+\S/i
const LABELS: Record<string, string> = { products: 'product', tabs: 'tab', anchors: 'anchor', dropdowns: 'dropdown', versions: 'version', languages: 'language', menu: 'item', groups: 'group' }

export function prefixPath(p: string, dest: string): string {
  if (isExternal(p)) return p
  const lead = p.startsWith('/') ? '/' : ''
  return lead + posix.join(dest, p.replace(/^\/+/, ''))
}

function prefixPage(p: string, dest: string): string {
  const endpoint = ENDPOINT.exec(p)
  if (!endpoint) return prefixPath(p, dest)
  return endpoint[1] ? p.replace(endpoint[1], prefixPath(endpoint[1], dest)) : p
}

function prefixSpec(spec: Json, dest: string): Json {
  if (typeof spec === 'string') return prefixPath(spec, dest)
  if (Array.isArray(spec)) return spec.map((s) => prefixSpec(s, dest))
  if (isObject(spec) && typeof spec.source === 'string') return { ...spec, source: prefixPath(spec.source, dest) }
  return spec
}

export function prefixNavigation(node: Json, dest: string): Json {
  if (Array.isArray(node)) return node.map((n) => prefixNavigation(n, dest))
  if (!isObject(node)) return node
  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => {
      if (key === 'pages' && Array.isArray(value)) {
        return [key, value.map((p) => (typeof p === 'string' ? prefixPage(p, dest) : prefixNavigation(p, dest)))]
      }
      if (key === 'root' && typeof value === 'string') return [key, prefixPath(value, dest)]
      if (key === 'openapi' || key === 'asyncapi') return [key, prefixSpec(value, dest)]
      return [key, prefixNavigation(value, dest)]
    }),
  )
}

const matchesRepo = (ref: string, repo: string) => {
  const a = ref.toLowerCase().replace(/^\/+|\/+$/g, '')
  const b = repo.toLowerCase()
  return a === b || b.endsWith(`/${a}`)
}

function itemsFor(container: string, nav: JsonObject, repo: string): Json[] {
  const direct = nav[container]
  if (Array.isArray(direct)) return direct
  if (container === 'pages' && Array.isArray(nav.groups)) return nav.groups
  throw new Error(`sourceRef "${repo}" is inside "${container}" but that source's navigation has no "${container}"`)
}

function wrap(container: string, name: string, nav: JsonObject): Json[] {
  const items = nav[container]
  if (Array.isArray(items)) return items
  return [{ [LABELS[container]!]: name, ...nav }]
}

export function assemble(base: JsonObject, children: Child[]): JsonObject {
  const navs = children.map((c) => {
    const { global: _global, ...nav } = isObject(c.docs.navigation) ? c.docs.navigation : {}
    return { child: c, nav: prefixNavigation(nav, c.source.destination) as JsonObject, used: false }
  })

  const resolve = (node: Json, container?: string, stack: string[] = []): Json => {
    if (Array.isArray(node)) {
      return node.flatMap((item) => {
        if (!isObject(item) || typeof item.sourceRef !== 'string') return [resolve(item, undefined, stack)]
        if (!container) throw new Error(`sourceRef "${item.sourceRef}" must be inside a navigation array`)
        const ref = item.sourceRef
        // A destination names one doc set exactly, so it wins over a repository name, which can match several
        const byDestination = navs.filter((n) => n.child.source.destination === ref.replace(/^\/+|\/+$/g, ''))
        const match = byDestination.length ? byDestination : navs.filter((n) => matchesRepo(ref, n.child.source.repo))
        if (match.length > 1) {
          const options = match.map((n) => n.child.source.destination).join(', ')
          throw new Error(`sourceRef "${ref}" matches more than one source (${options}). Use a destination instead, for example { "sourceRef": "${match[0]!.child.source.destination}" }`)
        }
        if (!match.length) throw new Error(`sourceRef "${ref}" does not match any configured source`)
        const target = match[0]!
        const id = target.child.source.destination
        if (stack.includes(id)) throw new Error(`sourceRef cycle: ${[...stack, id].join(' -> ')}`)
        target.used = true
        return resolve(itemsFor(container, target.nav, ref), container, [...stack, id]) as Json[]
      })
    }
    if (!isObject(node)) return node
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, resolve(v, Array.isArray(v) ? k : undefined, stack)]))
  }

  const navigation = resolve(isObject(base.navigation) ? base.navigation : {}) as JsonObject
  const leftover = navs.filter((n) => !n.used)
  if (leftover.length) {
    const container = (['products', 'tabs', 'anchors', 'dropdowns'] as const).find((k) => Array.isArray(navigation[k]))
    if (!container) {
      throw new Error(`Base navigation has no products, tabs, anchors, or dropdowns to append to. Add a sourceRef for: ${leftover.map((n) => n.child.source.repo).join(', ')}`)
    }
    for (const { child, nav } of leftover) {
      const name = child.source.name ?? (typeof child.docs.name === 'string' ? child.docs.name : child.source.repo)
      ;(navigation[container] as Json[]).push(...wrap(container, name, nav))
    }
  }

  const result: JsonObject = { ...base, navigation }

  const variables: JsonObject = {}
  for (const c of children) if (isObject(c.docs.variables)) for (const [k, v] of Object.entries(c.docs.variables)) if (!(k in variables)) variables[k] = v
  if (isObject(base.variables)) Object.assign(variables, base.variables)
  if (Object.keys(variables).length) result.variables = variables

  const redirects = children.flatMap((c) =>
    (Array.isArray(c.docs.redirects) ? c.docs.redirects : []).filter(isObject).map((r) => ({
      ...r,
      ...(typeof r.source === 'string' && { source: prefixPath(r.source, c.source.destination) }),
      ...(typeof r.destination === 'string' && { destination: prefixPath(r.destination, c.source.destination) }),
    })),
  )
  if (redirects.length) result.redirects = [...(Array.isArray(base.redirects) ? base.redirects : []), ...redirects]

  return result
}
