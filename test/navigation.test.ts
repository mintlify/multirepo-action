import { describe, expect, it } from 'vitest'
import type { Source } from '../src/config.js'
import { assemble, prefixNavigation, type JsonObject } from '../src/navigation.js'

const source = (repo: string, destination: string, name?: string): Source => ({ repo, destination, path: '.', rewriteLinks: true, exclude: [], name })

describe('prefixNavigation', () => {
  it('prefixes pages, roots, and specs but not endpoints or urls', () => {
    const nav = {
      groups: [
        {
          group: 'API',
          root: 'overview',
          openapi: '/openapi.json',
          pages: ['intro', 'GET /users', 'specs/v2.yaml POST /users', { group: 'Nested', asyncapi: { source: 'events.yaml' }, pages: ['nested/page'] }, 'https://example.com'],
        },
      ],
    }
    expect(prefixNavigation(nav, 'api')).toEqual({
      groups: [
        {
          group: 'API',
          root: 'api/overview',
          openapi: '/api/openapi.json',
          pages: ['api/intro', 'GET /users', 'api/specs/v2.yaml POST /users', { group: 'Nested', asyncapi: { source: 'api/events.yaml' }, pages: ['api/nested/page'] }, 'https://example.com'],
        },
      ],
    })
  })
})

describe('assemble', () => {
  const api = { name: 'API', navigation: { anchors: [{ anchor: 'Reference', pages: ['ref'] }], global: { anchors: [] } }, variables: { version: '2', plan: 'pro' }, redirects: [{ source: '/old', destination: '/new' }] }
  const sdk = { name: 'SDKs', navigation: { groups: [{ group: 'JS', pages: ['js'] }] } }

  it('replaces sourceRef entries with the matching container', () => {
    const base: JsonObject = { name: 'Acme', navigation: { anchors: [{ anchor: 'Home', pages: ['index'] }, { sourceRef: 'acme/api-docs' }] } }
    const result = assemble(base, [{ source: source('acme/api-docs', 'api'), docs: api }])
    expect(result.navigation).toEqual({ anchors: [{ anchor: 'Home', pages: ['index'] }, { anchor: 'Reference', pages: ['api/ref'] }] })
  })

  it('uses groups for a sourceRef inside pages', () => {
    const base: JsonObject = { navigation: { tabs: [{ tab: 'SDKs', pages: [{ sourceRef: 'sdk' }] }] } }
    const result = assemble(base, [{ source: source('acme/sdk', 'sdks'), docs: sdk }])
    expect(result.navigation).toEqual({ tabs: [{ tab: 'SDKs', pages: [{ group: 'JS', pages: ['sdks/js'] }] }] })
  })

  it('appends unreferenced sources to the top-level container', () => {
    const base: JsonObject = { navigation: { tabs: [{ tab: 'Home', pages: ['index'] }] } }
    const result = assemble(base, [{ source: source('acme/sdk', 'sdks', 'Libraries'), docs: sdk }])
    expect(result.navigation).toEqual({ tabs: [{ tab: 'Home', pages: ['index'] }, { tab: 'Libraries', groups: [{ group: 'JS', pages: ['sdks/js'] }] }] })
  })

  it('merges variables with base precedence and prefixes redirects', () => {
    const base: JsonObject = { navigation: { anchors: [{ sourceRef: 'acme/api' }] }, variables: { version: '1' } }
    const result = assemble(base, [{ source: source('acme/api', 'api'), docs: api }])
    expect(result.variables).toEqual({ version: '1', plan: 'pro' })
    expect(result.redirects).toEqual([{ source: '/api/old', destination: '/api/new' }])
  })

  it('matches a sourceRef by destination, so one repository can provide several doc sets', () => {
    const ops = { name: 'Ops', navigation: { groups: [{ group: 'Runbooks', pages: ['runbook'] }] } }
    const base: JsonObject = {
      navigation: {
        products: [
          { product: 'API', icon: 'server', groups: [{ sourceRef: 'api' }] },
          { product: 'Operations', icon: 'wrench', groups: [{ sourceRef: '/api-ops/' }] },
        ],
      },
    }
    const result = assemble(base, [
      { source: source('acme/api', 'api'), docs: sdk },
      { source: source('acme/api', 'api-ops'), docs: ops },
    ])
    expect(result.navigation).toEqual({
      products: [
        { product: 'API', icon: 'server', groups: [{ group: 'JS', pages: ['api/js'] }] },
        { product: 'Operations', icon: 'wrench', groups: [{ group: 'Runbooks', pages: ['api-ops/runbook'] }] },
      ],
    })
  })

  it('prefers a destination over a repository with the same name', () => {
    const other = { navigation: { groups: [{ group: 'Other', pages: ['other'] }] } }
    const base: JsonObject = {
      navigation: {
        tabs: [
          { tab: 'SDK', groups: [{ sourceRef: 'sdk' }] },
          { tab: 'Libraries', groups: [{ sourceRef: 'libraries' }] },
        ],
      },
    }
    const result = assemble(base, [
      { source: source('acme/sdk', 'libraries'), docs: other },
      { source: source('acme/js', 'sdk'), docs: sdk },
    ])
    expect(result.navigation).toEqual({
      tabs: [
        { tab: 'SDK', groups: [{ group: 'JS', pages: ['sdk/js'] }] },
        { tab: 'Libraries', groups: [{ group: 'Other', pages: ['libraries/other'] }] },
      ],
    })
  })

  it('asks for a destination when a repository sourceRef matches several doc sets', () => {
    const base: JsonObject = { navigation: { groups: [{ sourceRef: 'acme/api' }] } }
    const children = [
      { source: source('acme/api', 'api'), docs: sdk },
      { source: source('acme/api', 'api-ops'), docs: sdk },
    ]
    expect(() => assemble(base, children)).toThrow(/matches more than one source \(api, api-ops\)\. Use a destination/)
  })

  it.each([
    [{ navigation: { pages: [{ sourceRef: 'acme/missing' }] } }, /does not match/],
    [{ navigation: { tabs: [{ sourceRef: 'acme/sdk' }] } }, /has no "tabs"/],
    [{ navigation: { pages: ['index'] } }, /Add a sourceRef/],
  ])('fails on %j', (base, error) => {
    expect(() => assemble(base as JsonObject, [{ source: source('acme/sdk', 'sdks'), docs: sdk }])).toThrow(error)
  })

  it('detects cycles', () => {
    const a = { navigation: { groups: [{ sourceRef: 'acme/b' }] } }
    const b = { navigation: { groups: [{ sourceRef: 'acme/a' }] } }
    const base: JsonObject = { navigation: { groups: [{ sourceRef: 'acme/a' }] } }
    expect(() => assemble(base, [{ source: source('acme/a', 'a'), docs: a }, { source: source('acme/b', 'b'), docs: b }])).toThrow(/cycle/)
  })
})
