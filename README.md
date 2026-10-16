# Mintlify Multirepo Action

Combine docs from any number of child repositories into one Mintlify docs repository, and merge their navigation into a single `docs.json`. Mintlify deploys the parent repository like any other docs site.

```text
acme/api        docs/   ─┐
acme/sdk-js     docs/   ─┼─▶  acme/docs   api/  sdks/js/  docs.json  ─▶  Mintlify
acme/platform   .       ─┘
```

## How it works

1. Each child repository is shallow, sparse-cloned in parallel. Only the configured `path` is downloaded.
2. Each child's content is copied to its `destination` folder in the parent. The child's `snippets/` folder goes to `snippets/<destination>/`.
3. Root-relative links, images, and snippet imports in `.md` and `.mdx` files are rewritten to include the destination, for example `/guides/start` becomes `/api/guides/start`.
4. The parent's `docs.base.json` is turned into `docs.json` with every child's navigation merged in, page paths prefixed, variables merged, and redirects prefixed.
5. Changes are committed and opened as a pull request, pushed directly, or left in the working tree. In `push` mode, if the branch moved during the sync, the commit is rebased and pushed again.

If any source fails to fetch or merge, the action fails before touching the parent repository.

## Setup

### 1. Add a base config

Move your parent repository's `docs.json` to `docs.base.json`. Put `sourceRef` entries where each child's navigation should go. This is the same syntax as Mintlify multi-repo projects.

```json
{
  "$schema": "https://mintlify.com/docs.json",
  "theme": "mint",
  "name": "Acme",
  "colors": { "primary": "#16A34A" },
  "navigation": {
    "tabs": [
      { "tab": "Guides", "pages": ["index", "quickstart"] },
      { "tab": "API", "pages": [{ "sourceRef": "acme/api" }] }
    ]
  }
}
```

A `sourceRef` is replaced with the child's navigation array of the same kind. For example, a `sourceRef` in `tabs` is replaced with the child's `navigation.tabs`. A `sourceRef` in `pages` uses the child's `pages`, or its `groups` if it has no `pages`.

A `sourceRef` can name a source by its repository (`acme/api`) or by its `destination` (`api`). Use the destination when one repository provides more than one doc set, since the repository name would match all of them. If a value matches both a destination and a repository, the destination wins.

```json
"products": [
  { "product": "API", "icon": "server", "groups": [{ "sourceRef": "api" }] },
  { "product": "Operations", "icon": "wrench", "groups": [{ "sourceRef": "api-ops" }] }
]
```

Placing children with `sourceRef` lets the parent set each product's or tab's name, icon, and description.

Sources without a `sourceRef` are appended to the base's top-level `products`, `tabs`, `anchors`, or `dropdowns`, named after the source's `name` or the child's `docs.json` `name`.

### 2. Add the multirepo config

`.github/mintlify-multirepo.yml` in the parent repository:

```yaml
base: docs.base.json   # default
output: docs.json      # default
sources:
  - repo: acme/api
    path: docs               # folder with docs.json in the child, default "."
    destination: api         # folder in the parent, also the URL prefix
    name: API reference      # optional, used when appending navigation
  - repo: acme/sdk-js
    ref: v2                  # branch, tag, or full commit SHA, default is the repository default branch
    path: docs
    destination: sdks/js
    exclude: [README.md, "drafts/**"]
  - repo: acme/legacy
    destination: legacy
    rewriteLinks: false      # copy content without rewriting links
```

A repository can be listed more than once with a different `path` and `destination` for each doc set it holds. Reference those doc sets by destination in `sourceRef`.

Each child needs its own `docs.json` with a `navigation` object, so a child can still be previewed on its own with `mint dev`. The child's top-level settings, like theme and colors, are ignored. Only `navigation`, `variables`, and `redirects` are merged.

Dotfiles, `node_modules`, symlinks, and the child's `docs.json` are never copied.

### 3. Add the workflow

`.github/workflows/aggregate-docs.yml` in the parent repository:

```yaml
name: Aggregate docs

on:
  workflow_dispatch:
  schedule:
    - cron: "0 * * * *"
  repository_dispatch:
    types: [docs-updated]

concurrency:
  group: mintlify-multirepo
  cancel-in-progress: true

permissions:
  contents: write
  pull-requests: write

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/create-github-app-token@v3
        id: app
        with:
          app-id: ${{ vars.DOCS_APP_ID }}
          private-key: ${{ secrets.DOCS_APP_PRIVATE_KEY }}
          owner: ${{ github.repository_owner }}
      - uses: actions/checkout@v7
      - uses: mintlify/multirepo-action@v1
        with:
          token: ${{ steps.app.outputs.token }}
          mode: pull-request
```

Every run does a full sync, so runs can be canceled, retried, or triggered by many children at once without drifting. The `concurrency` group collapses bursts of triggers into one run.

### 4. Optional: trigger from child repositories

To sync as soon as a child changes, add this to each child repository. `DOCS_DISPATCH_TOKEN` needs `contents: write` on the parent repository.

```yaml
name: Notify docs repository

on:
  push:
    branches: [main]
    paths: ["docs/**"]

jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - env:
          GH_TOKEN: ${{ secrets.DOCS_DISPATCH_TOKEN }}
        run: gh api repos/acme/docs/dispatches -f event_type=docs-updated
```

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `config` | `.github/mintlify-multirepo.yml` | Path to the config file, relative to `working-directory` |
| `token` | `github.token` | Token used to clone child repositories |
| `github-token` | `github.token` | Token used to open pull requests in the parent repository |
| `mode` | `pull-request` | `pull-request`, `push`, or `none` |
| `branch` | `mintlify-multirepo/sync` | Branch for the sync pull request |
| `base-branch` | Current branch | Branch to push to, or the pull request base |
| `commit-message` | `docs: sync from child repositories` | Commit message and pull request title |
| `concurrency` | `8` | Number of child repositories fetched in parallel |
| `working-directory` | `.` | Root of the docs in the parent repository |

## Outputs

| Output | Description |
| --- | --- |
| `changed` | `true` if the sync changed any files |
| `commit-sha` | SHA of the sync commit |
| `pull-request-number` | Number of the sync pull request |
| `pull-request-url` | URL of the sync pull request |

## Tokens

- **Public child repositories**: the default `github.token` works.
- **Private child repositories**: use a GitHub App installation token, as in the example above, or a fine-grained PAT with `contents: read` on every child. An App token is recommended for many repositories because it isn't tied to a person.
- **Pull requests**: with `github.token`, enable **Settings → Actions → General → Allow GitHub Actions to create and approve pull requests**. Pull requests opened with `github.token` don't trigger other workflows. Pass an App token as `github-token` if you need CI to run on them.
- **GitHub Enterprise Server**: child repositories are cloned from `GITHUB_SERVER_URL`.

## Files written to the parent repository

- One folder per `destination`, replaced on every run
- `snippets/<destination>/` for each child's snippets
- `docs.json`, generated from `docs.base.json`
- `.mintlify-multirepo.json`, a manifest of synced commits. When a source is removed from the config, its folders are deleted on the next run.

Don't edit synced folders or `docs.json` by hand, because the next run overwrites them. Edit the child repositories and `docs.base.json` instead.

## Migrating from v0

v1 is a rewrite. `v0.x` tags keep working, so nothing changes until you update the version.

| v0 | v1 |
| --- | --- |
| `repos` input with `owner`, `repo`, `ref`, `subdirectory` | `sources` in `.github/mintlify-multirepo.yml` with `repo: owner/repo`, `ref`, `path`, `destination` |
| Subrepo copied to a folder named after the repo | Copied to `destination`, which you choose |
| `docs.json` in the target branch is merged in place | `docs.base.json` is the source of truth and `docs.json` is generated |
| `target-branch`, always pushes | `mode: pull-request` (default), `push`, or `none`, with `base-branch` |
| `subdirectory` input | `working-directory` input |
| `force` input | Removed. Every run is a full sync, so force-pushing isn't needed |
| Navigation merged into `groups` only | `sourceRef` placement, or appended to `products`, `tabs`, `anchors`, or `dropdowns` |

v1 also rewrites links, images, and snippet imports in child pages, copies each child's snippets, merges variables and redirects, and fetches children in parallel.

To migrate:

1. Rename `docs.json` to `docs.base.json` and remove the navigation that came from subrepos. Add a `sourceRef` for each subrepo where its navigation should go.
2. Move your `repos` list into `.github/mintlify-multirepo.yml` as `sources`. Set `destination` to the repo name to keep v0's URLs.
3. Replace the action inputs: drop `repos`, `target-branch`, `subdirectory`, and `force`. Use `mode: push` with `base-branch: <target-branch>` to keep pushing directly.

## Development

```sh
pnpm install
pnpm type
pnpm test
pnpm build   # commit dist/ with your changes
```

Releases: publish a GitHub release tagged `vX.Y.Z`. The release workflow moves the `vX` tag to it.
