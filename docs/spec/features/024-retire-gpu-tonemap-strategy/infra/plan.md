---
title: Retire the GPU Tonemap Strategy — infra slice
service: infra
last_updated: 2026-08-25
status: Approved
---

# PLAN: Retire the GPU Tonemap Strategy — `infra` (`infra/plan.md`)

## Scope

You remove the host-side half of `017`: the GPU compose overlay, the render-node branch repeated in
the three `bin/` wrappers, the `USE_GPU` variable in every place it is declared or passed, and the
Vulkan loader and Mesa drivers from the `worker` image's `base` stage. After this slice, `bin/dev`,
`bin/prod` and `bin/build` produce the **same** `docker compose` invocation on every host, and
nothing about a GPU is detected, asked, passed or installed.

You are not touching any TypeScript. The worker's own probe module and the `vulkanAvailable`
parameter belong to the `ffmpeg` and `worker` slices, which run in parallel with you and share no
file with this one.

Writes are confined to `bin/`, `docker-compose.yaml`, `docker-compose.dev.yaml`,
`docker-compose.gpu.yaml`, `.env.example`, `services/worker/Dockerfile` and this directory.
`README.md` and the `CLAUDE.md` files are `[docs]` tasks even where they describe your changes.

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `docker-compose.gpu.yaml` | **Deleted** | The entire overlay — it exists only to map `/dev/dri` into `worker`. |
| `bin/dev` | Modified | Delete the `if [ -d /dev/dri ] && [ "${USE_GPU}" != "false" ]` block (`:23-25`) and the GPU sentences in the header comment (`:3-6`). `COMPOSE_FILES` becomes a plain assignment. |
| `bin/prod` | Modified | Same block (`:24-26`) and the same header sentences (`:4-7`). |
| `bin/build` | Modified | Same block (`:36-38`) and the same header sentences (`:3-5`). Keep the `BUILDABLE` argument handling untouched. |
| `docker-compose.yaml` | Modified | Remove `- USE_GPU=${USE_GPU}` from the `worker` service's environment (`:201`). |
| `docker-compose.dev.yaml` | Modified | The header comment (`:8`) cites `docker-compose.gpu.yaml (USE_GPU)` as the analogous overlay mechanism. Reword to describe the bind-mount overlay on its own — the file it points at will not exist. |
| `.env.example` | Modified | Delete the `USE_GPU` tri-state block and its `#USE_GPU=false` line entirely. This is also what keeps the name out of a freshly generated `.env` (REQ-6). |
| `services/worker/Dockerfile` | Modified | Drop `vulkan-loader`, `mesa-vulkan-intel` and `mesa-vulkan-ati` from the `base` stage `apk add` (`:15`), and delete the eight-line comment block above it that explains the Vulkan stack (`:6-14`). `ffmpeg`, `mkvtoolnix` and `libc6-compat` stay. |
| `bin/install` | **Unchanged** | Named here so it is not searched for in vain: `017` already removed the GPU question, and the variable only reaches a generated `.env` because the script copies `.env.example`. Deleting the block there is the whole fix. |

## Existing code to reuse

- `bin/dev:18-20`, `bin/prod:19-21` — the `USE_TRAEFIK` branch. It is the pattern the GPU branch was
  built to imitate, and it is **not** going anywhere. Keep its shape intact; the `SERVICES`
  construction and the `set -a; . ./.env; set +a` sourcing above it are untouched by this slice.
- `docker-compose.dev.yaml` — the surviving example of the overlay mechanism. After you delete
  `docker-compose.gpu.yaml`, this is the only overlay in the repo and the reference for anyone who
  needs one later, which is why its header comment has to stand on its own rather than point at a
  deleted file.
- `services/worker/Dockerfile`'s four-stage `base`/`dev`/`builder`/`runner` shape
  (`015-reproducible-image-builds`) is untouched. You edit one `apk add` line inside `base`.

## Steps

1. Delete `docker-compose.gpu.yaml`.
2. `bin/dev`, `bin/prod`, `bin/build`: delete the three `/dev/dri` blocks and collapse
   `COMPOSE_FILES` to a single assignment. Rewrite each header comment so it describes what the
   script does now — Article VI applies to comments, but these files are legacy Spanish and
   `docs/constitution.md` § Article XI says not to translate wholesale while editing for another
   reason. Remove the GPU sentences; leave the surrounding Spanish alone.
3. `docker-compose.yaml`: remove the `USE_GPU` environment entry from `worker`.
4. `docker-compose.dev.yaml`: reword the header comment's cross-reference.
5. `.env.example`: delete the `USE_GPU` block.
6. `services/worker/Dockerfile`: drop the three packages and the comment block above the `apk add`.

## Contract obligations

`../spec.md` § GraphQL Contract Delta is **None**, and `infra` has no GraphQL surface at all.

The obligation you do carry is a behavioural one the spec states as REQ-6: a `USE_GPU` line left
over in a developer's **existing** `.env` must be completely inert. Removing the branches is what
achieves that — do not replace them with a warning, a deprecation notice or a compatibility shim.
`bin/dev` still sources the whole `.env`, so the variable will still be defined in the shell; that
is fine and expected, as long as nothing reads it.

## Tests

**Nothing in this slice is owed a test, and there is no harness that could carry one** — this
repository has no test framework for `bin/` scripts, no compose linting, and no image assertions.
Introducing one for a deletion would be its own feature.

The failure mode is loud rather than silent: a leftover `-f docker-compose.gpu.yaml` after the file
is deleted makes `docker compose` fail immediately with a missing-file error, and a broken `apk add`
fails the image build. Neither can produce a container that runs and quietly does the wrong thing.

The one thing that *could* pass while being wrong is the image: a running container built from the
old layers still has the Vulkan drivers, so the removal looks done when it is not. That is covered
by rebuilding before verifying, in § Done when.

## Done when

The rebuild must come first — verifying against a cached image is the one way this slice reports a
false pass:

```bash
bin/build worker && bin/dev
```

Expected: `worker` reaches a running state. Then confirm the drivers are actually gone and no device
is mapped, on **this** host, which does have a render node:

```bash
bin/cli worker sh -c 'apk info -e vulkan-loader mesa-vulkan-intel mesa-vulkan-ati; ls /dev/dri'
```

Expected: no package listed, and `/dev/dri` absent inside the container — that absence is REQ-5
holding, and it is what `017` could not deliver.

Then the removal check across your own territory (part of AC-3):

```bash
grep -rniE 'vulkan|USE_GPU|dev/dri' bin docker-compose.yaml docker-compose.dev.yaml .env.example services/worker/Dockerfile
```

Expected: no hit. And confirm `bin/build` still accepts its optional service argument, which the
edited `COMPOSE_FILES` block sits next to:

```bash
bin/build web
```
