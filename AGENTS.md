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

demo/                  Vite playground, not published (`files` is `["dist"]`)
demo/src/mockChatClient.ts  in-memory stand-in for `ChatClient`
```

## Things that are easy to get wrong

- **`credential` and `userId` must be referentially stable** in consuming code.
  A fresh object each render rebuilds the chat adapter. The README says so;
  keep saying so.
- `useAzureCommunicationChatAdapter` takes `Partial<args>` and returns
  `undefined` when `threadId` is missing. That is why the unselected state needs
  no conditional hook — don't "fix" it by splitting out a child component.
- The thread-state effect in `useAcsChatInbox` omits `threadStates` from its
  deps on purpose (it writes that state; including it loops). There is an
  eslint-disable comment saying so.
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
npm run typecheck   # tsc --noEmit
npm run build       # tsup -> dist (ESM + CJS + d.ts + styles.css)
npm run demo        # installs demo deps, then vite on :5173
```

The demo runs `AcsThreadList` and `useAcsChatInbox` against a mock `ChatClient`
(`demo/src/mockChatClient.ts`) that implements only what the hook calls:
`getChatThreadClient().listMessages()`, `listReadReceipts()`,
`startRealtimeNotifications()`, and `on/off("chatMessageReceived")`. Unread
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
- Publish: needs an npm account with 2FA, then `npm publish --access public`.
  There is no CI and no test suite yet.

## Git

Everything so far is one initial commit on `main`; there is no remote. Don't
commit automatically — ask.
