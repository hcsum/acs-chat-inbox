# AGENTS.md

Notes for whoever (person or agent) picks this up next.

## What this is

`acs-chat-inbox` — a published-to-npm React package that gives Azure
Communication Services chat the piece it doesn't ship: a thread list beside
`ChatComposite`, with unread counts and latest-message previews.

Not published yet. The name is free on npm as of 2026-09-12.

## Where it came from

Extracted from the chat feature in `~/Codes/lyfly-frontend`, which built this
shell by hand:

- `src/app/chat/ChatThreadList.tsx` — the list markup and preview logic
- `src/app/chat/ChatComponent.tsx` — the `ChatComposite` wrapper
- `src/stores/chatStore.ts` — unread / latest-message computation (the valuable part)
- `src/hooks/useInitChat.ts`, `src/hooks/useChatThreadsQuery.ts` — thread loading

The package is a generic rewrite of those, not a copy. lyfly still has its own
copy and has **not** been switched over to the package.

## Scope — decided deliberately, don't drift

In scope: thread list, selection wired to `ChatComposite`, unread counts,
latest-message preview, attachment upload passthrough via `chatOptions`, and
the one-pane-at-a-time narrow layout with its back control.

The back control is in scope for a specific reason, not as a general licence to
add UI: the narrow layout is the package's own CSS hiding the sidebar, and
`AcsChatInbox` renders `ChatComposite` itself, so without it a consumer has no
seam to put one in and the mobile layout is a dead end. It is the exit from a
trap the package sets, not a product opinion. A drawer, hamburger, or swipe
gesture would be a product opinion — those stay out.

Out of scope, on purpose (each is an opinion about the product, not about ACS):

- fetching / paginating / creating / archiving threads — `threads` is fully controlled
- user picker or "new chat" flow — the button goes in `sidebarTitle`, which is
  a `ReactNode` in a flex header for exactly that; creating the thread needs an
  identity directory the package does not have, and `threads` is controlled, so
  anything the package created it would have to hand straight back
- auth, token refresh, server actions
- calling, presence, profile panes
- a fixed visual system (no Tailwind, no shadcn, no design tokens beyond CSS vars)

Zero runtime dependencies. Everything external is a peer dependency. Keep it
that way — `date-fns` and `dompurify` were both deliberately avoided by writing
a ~20-line `formatRelativeTime` and `stripHtml` in `src/utils.ts`.

## Layout

```
src/index.ts           public surface
src/types.ts           AcsThread, AcsThreadState, classNames map
src/useAcsChatInbox.ts the whole data layer; usable headless
src/AcsThreadList.tsx  controlled list; usable without the chat pane
src/AcsChatInbox.tsx   the two-pane component
src/utils.ts           cx, stripHtml, preview, relative time
src/styles.css         default skin, all values as CSS variables

src/*.test.ts(x)       vitest; excluded from the build by tsup's explicit entry

demo/                  Vite playground, not published (`files` is `["dist"]`)
demo/src/mockChatClient.ts  in-memory stand-in for `ChatClient`

.changeset/            pending release notes, one file per change
.github/workflows/     ci.yml, release.yml, pages.yml
```

## Things that are easy to get wrong

- **`credential` and `userId` must be referentially stable** in consuming code.
  A fresh object each render rebuilds the chat adapter. The README says so;
  keep saying so.
- `useAzureCommunicationChatAdapter` takes `Partial<args>`, so the unselected
  state needs no conditional hook — don't "fix" it by splitting out a child
  component. But it does **not** return `undefined` once `threadId` goes away:
  with a field missing its effect just returns, leaving the adapter it already
  built in place (checked against 1.34.0). `AcsChatInbox` therefore gates on the
  selection itself (`activeAdapter`), and everything downstream uses that.
- The thread-state effect in `useAcsChatInbox` omits `threadStates` from its
  deps on purpose (it writes that state; including it loops). There is an
  eslint-disable comment saying so. Two more disables cover
  `react-hooks/set-state-in-effect` (eslint-plugin-react-hooks 7's compiler
  rule): `setLoading(true)` beside the fetch it flags, and `markThreadRead` on
  selection. Both are effects synchronizing with something outside React, which
  is what that rule's exception is for — read the comments before "fixing" them.
- History is read **one page deep** (`firstPage`), not with `for await`: the
  SDK's iterator pages all the way back to the start of a thread, so a plain
  `for await` is dozens of serial requests on first render. Page size comes from
  the list call's options — the SDK ignores `byPage`'s own `maxPageSize`.
- The fetch merges into the map instead of overwriting it (`mergeStates`):
  realtime messages and `markThreadRead` both land while it is in flight.
- Realtime events use a different `type` vocabulary from the REST enum:
  `"Text"` / `"RichText/Html"`, not `"text"` / `"html"`. Nothing filters on the
  realtime path today; if that changes, don't copy the lowercase comparison.
- Previews render as plain text. lyfly used `dangerouslySetInnerHTML` for
  `html`-type messages; the package strips tags instead. Don't reintroduce it.
- Styles: three layers — CSS variables, `data-slot` / `data-state` attributes,
  then `classNames` + `renderThreadItem`. New DOM needs a `data-slot`.
- Variables are defined on `.acs-inbox`, deliberately, not on `:root`. The cost
  is that any class used outside the inbox reads undefined variables and loses
  those values silently. `.acs-inbox-unread-badge` is the only class documented
  for outside use (the headless top-bar badge), so it repeats its defaults as
  `var()` fallbacks. Anything else that becomes usable standalone needs the
  same treatment.
- The narrow layout is a **container** query (`@container acs-inbox`), not a
  media query, so it follows the inbox's width rather than the window's. That
  needs `container-type: inline-size` on `.acs-inbox`; don't drop it. A
  container query cannot style its own container, which is why the narrow rules
  set `flex` on `.acs-inbox-sidebar` instead of the sidebar-width variable on
  the root.
- Which pane shows is `data-pane` on the root, not `:has()` on the chat pane's
  `data-state`. The earlier `:has()` version matched only `ready` and `empty`,
  so both panes were visible during the adapter's `loading` window.
- Back does **not** clear `selectedThreadId` — that prop is the consumer's.
  `AcsChatInbox` keeps a `dismissedThreadId` instead, cleared on every select so
  re-picking the thread you just backed out of reopens it.

## Verification

```sh
npm run typecheck      # tsc --noEmit
npm run lint           # eslint (flat config, type-checked rules + react-hooks)
npm run format:check   # prettier
npm test               # vitest: utils, the hook's unread arithmetic, the list
npm run build          # tsup -> dist (ESM + CJS + d.ts + styles.css)
npm run check:exports  # publint + attw against the packed tarball
npm run demo           # installs demo deps, then vite on :5173
npm --prefix demo run typecheck   # the demo has its own tsc; root typecheck misses it
```

CI (`.github/workflows/ci.yml`) runs all of those plus a Node 22/24 ×
React 18/19 matrix. Node 20 is not in it: it went end-of-life in April 2026 and
jsdom 30 requires `^22.22 || ^24.15`. The published package has no Node
requirement of its own — `engines` stays `>=20` for consumers.

`check:exports` is not optional ceremony: it caught the original `exports` map
handing `dist/index.d.ts` to CJS consumers, which made the package masquerade as
ESM under `node16` resolution. Types are now split per condition
(`import` -> `.d.ts`, `require` -> `.d.cts`). `.attw.json` excludes the
`./styles.css` entrypoint — a stylesheet has no Node resolution to get right.

`npm run build` ends in `scripts/postbuild.mjs`, which writes `dist/styles.d.css.ts`
and prepends `"use client"` to the two bundles. The directive cannot be a tsup
`banner`: `treeshake: true` runs the output through rollup afterwards, and rollup
drops module-level directives. The script shifts each sourcemap by one line to
match.

The demo deliberately has no `@azure/communication-chat` of its own — it reads the
root's copy. Two copies means two declarations of `ChatClient`, and its private
fields make them incompatible, so `mockChatClient.asChatClient()` stops typechecking.

The demo runs `AcsThreadList` and `useAcsChatInbox` against a mock `ChatClient`
(`demo/src/mockChatClient.ts`) that implements only what the hook calls:
`getChatThreadClient().listMessages()`, `listReadReceipts()` — both paged the
way the SDK pages, since the hook reads only the first page —
`start`/`stopRealtimeNotifications()`, and `on/off("chatMessageReceived")`. Unread
counts, read-receipt handling and previews run against that mock rather than
being stubbed out, so they can be checked without an ACS resource. It imports
from `../../src` directly, skipping `AcsChatInbox` and therefore
`@azure/communication-react`; the right pane is demo code in place of
`ChatComposite`, which needs live credentials and remains untested.

Dev deps pin React 18 types because `@azure/communication-react` declares a
peer of `@types/react` `<19`. The package itself supports React 18 and 19 — that
was checked by packing a tarball and typechecking a React 19 consumer against
it. Redo that check if the public types change:

```sh
npm pack --pack-destination /tmp
# then in a scratch project on React 19: install the tarball and `tsc --noEmit`
```

Never validated against a live ACS resource — no endpoint or token available at
the time of writing. The demo covers unread counts, read receipts and realtime
updates against the mock; `ChatComposite` wiring and the real ACS SDK's
behaviour (paging, redelivery, token refresh) are still unproven.

## Open next steps

- `npm link` into `~/Codes/lyfly-frontend` and replace its hand-rolled shell;
  that is both the real-runtime test and the proof the API is general enough.
- Decide whether thread-list pagination belongs here. lyfly has infinite scroll;
  v0.1 deliberately left it out. If it comes back, it should be an `onEndReached`
  callback, not a data-fetching concern inside the package.
- Validate against a live ACS resource. Everything so far runs against the fake
  `ChatClient`; `ChatComposite` wiring has never been exercised for real.

## Releasing

Automated; nothing is published by hand.

1. A change that reaches npm carries a changeset (`npm run changeset`),
   committed with the change. CI-only, docs-only and demo-only changes do not.
2. Merging to `main` runs `release.yml`, which collects pending changesets into
   a **"Version Packages"** pull request: version bump + `CHANGELOG.md`.
3. Merging that PR publishes to npm and cuts the GitHub release. The changelog
   comes from `@changesets/changelog-github`, so entries link their PR and
   author.

Publishing uses **npm trusted publishing (OIDC)**: no `NPM_TOKEN` exists
anywhere in the repo. The job mints a short-lived credential from its own
GitHub OIDC token, and npm generates the provenance attestation by itself —
which is why `publishConfig` carries no `provenance` flag; setting it would
only break a manual publish, which has no OIDC token to sign with. It needs
npm >= 11.5.1, hence the `npm install -g npm@latest` step before `npm ci`. Two
consequences: the publishing workflow's filename is part of the trust
configuration on npmjs.com — renaming `release.yml` breaks publishing until the
setting is updated — and a local `npm publish` is not part of the process.

`pages.yml` deploys `demo/` to <https://hcsum.github.io/acs-chat-inbox/> on
every push to `main`, building with `DEMO_BASE=/acs-chat-inbox/` so the asset
URLs carry the repo prefix.

## Git

Don't commit automatically — ask.
