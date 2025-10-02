# Image Versioning & Rollbacks

## Strategy

- Use immutable image tags based on the git commit SHA for all runtime images.
- Keep a convenience tag (`:main`) updated, but never deploy with it.

## Build & Push

- CI builds and pushes two tags for each image:
  - SHA: `ghcr.io/goldfish-inc/oceanid/<image>:${GITHUB_SHA}`
  - main: `ghcr.io/goldfish-inc/oceanid/<image>:main`

## Deploy

- Pulumi ESC stores the exact images to deploy:
  - `adapterImage`: `ghcr.io/goldfish-inc/oceanid/ls-triton-adapter:${SHA}`
  - `sinkImage`: `ghcr.io/goldfish-inc/oceanid/annotations-sink:${SHA}`
- Apply: `pulumi -C cluster up`

## Why not `:main`

- Kubernetes with `imagePullPolicy: IfNotPresent` caches the last `:main` locally.
- Overwriting `:main` doesn’t invalidate the cache; Pods can start old images.
- SHA tags change on every build; Pods pull the correct content.

## Rollbacks

- Set ESC `adapterImage` / `sinkImage` to a prior SHA and `pulumi -C cluster up`.
- Rollbacks are deterministic and auditable.

## Private GHCR

- Images live under `ghcr.io/goldfish-inc/oceanid`.
- The cluster uses an `apps/ghcr-creds` imagePullSecret created from Pulumi config:
  - `ghcrUsername` and `ghcrToken` (PAT with `read:packages`).

## Optional Automation

- Add a deploy workflow to update ESC with the new SHA and run Pulumi automatically.
- Or switch to Flux ImageUpdateAutomation (ImageRepository + ImagePolicy) for Kustomize/Helm-managed manifests.

