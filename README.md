# Mintlify Multirepo Action

This action compiles multiple GitHub repositories containing
mintlify docs into a single repository. This is useful for
those who might have multiple products that belong in separate
repos, but want to keep the docs for each product near the code.

This setup involves two types of repositories:
- **base repository**: The repo in which you are setting up this
  action. The aggregated docs will live in this repo. The base
  repository can also contain its own global pages.
- **subrepositories**: The other repos that will be aggregated
  into the base repo.

Each subrepository must contain a `docs.json` with a valid
[navigation field](https://mintlify.com/docs/settings/navigation#folders)
representing the pages in that repository. All other `docs.json`
settings will be taken from the base repo.

## Inputs

### token (required)

Personal access token (PAT) used to push the aggregated docs to
the target branch

### repos (required)

A stringified yaml array containing objects representing the
mintlify docs repositories to be aggregated. These objects
have the following properties:
- `owner`: **(required)** the owner/org of the subrepo
- `repo`: **(required)** the name of the subrepo
- `ref`: the branch/ref at which to check out the subrepo
- `subdirectory`: path to the directory containing the subrepo's `docs.json`

### target-branch (required)

The branch to which the complete documentation will be pushed

### subdirectory

Path to the directory containing the main `docs.json`

### force

If `true`, will force-push to `target-branch`

## Example

```yaml
name: Aggregate Mintlify Docs

on:
  push:
    branches: main
  schedule:
    - cron: '0 0 * * *'

concurrency:
  group: aggregate-mintlify-docs
  cancel-in-progress: true

jobs:
  aggregate-docs:
    runs-on: ubuntu-latest
    name: Aggregate mintlify docs
    steps:
      - name: Clone repo
        uses: actions/checkout@v4
      - name: Run mintlify action
        uses: mintlify/mintlify-multirepo-action@v0.15
        with:
          token: ${{ secrets.PUSH_TOKEN }}
          target-branch: docs
          subdirectory: ./my-docs
          repos: |
            - owner: mintlify
              repo: docs
            - owner: mintlify
              repo: additional-docs
              ref: v1.0.0
```
