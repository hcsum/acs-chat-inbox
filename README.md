# acs-chat-inbox

[![npm](https://img.shields.io/npm/v/acs-chat-inbox.svg?color=cb3837&logo=npm)](https://www.npmjs.com/package/acs-chat-inbox)
[![CI](https://github.com/hcsum/acs-chat-inbox/actions/workflows/ci.yml/badge.svg)](https://github.com/hcsum/acs-chat-inbox/actions/workflows/ci.yml)
[![bundle size](https://img.shields.io/bundlephobia/minzip/acs-chat-inbox?label=minzipped)](https://bundlephobia.com/package/acs-chat-inbox)
[![types](https://img.shields.io/npm/types/acs-chat-inbox)](https://www.npmjs.com/package/acs-chat-inbox)
[![license](https://img.shields.io/npm/l/acs-chat-inbox.svg)](./LICENSE)

An inbox shell for Azure Communication Services chat: a thread list beside
[`ChatComposite`](https://azure.github.io/communication-ui-library/?path=/docs/composites-chat-basicexample--docs),
with unread counts and latest-message previews.

`@azure/communication-react` ships the chat pane but no thread list, so every app
that needs a WhatsApp-style two-pane inbox rebuilds the same shell. This is that
shell, and nothing else.

**[Live demo](https://hcsum.github.io/acs-chat-inbox/)** — runs against an
in-memory stand-in for `ChatClient`, so no Azure resource is needed to try it.

## Install

```sh
npm install acs-chat-inbox
```

Peer dependencies you already have if you use ACS chat:

```sh
npm install @azure/communication-react @azure/communication-chat @azure/communication-common react react-dom
```

### React 19

This package works with React 19, but `@azure/communication-react` does not
support it: as of 1.34.0 its own peer range is `react: ">=16.8.0 <19.0.0"`, so
installing on React 19 fails peer resolution.

```sh
npm install acs-chat-inbox --legacy-peer-deps
```

That is Microsoft's constraint, not this package's, and `--legacy-peer-deps`
only silences the check — it does not make the composites tested on React 19.
On React 18 nothing extra is needed.

## Usage

```tsx
import { AcsChatInbox, type AcsThread } from "acs-chat-inbox";
import "acs-chat-inbox/styles.css";

function Inbox({ endpoint, token, acsUserId, displayName, threads }) {
  const [selectedThreadId, setSelectedThreadId] = useState<string>();

  const credential = useMemo(() => new AzureCommunicationTokenCredential(token), [token]);
  const userId = useMemo(() => ({ communicationUserId: acsUserId }), [acsUserId]);

  return (
    <AcsChatInbox
      endpoint={endpoint}
      userId={userId}
      credential={credential}
      displayName={displayName}
      chatClient={chatClient}
      threads={threads}
      selectedThreadId={selectedThreadId}
      onThreadSelect={(thread) => setSelectedThreadId(thread.id)}
    />
  );
}
```

`credential` and `userId` must be stable across renders — a new object on every
render rebuilds the chat adapter.

### Threads are yours

The component never fetches the thread list. You pass `threads`, mapped from
whatever your backend returns into the minimum the list needs:

```ts
type AcsThread = {
  id: string;
  title?: string;
  participants?: { acsUserId: string; displayName?: string; avatarUrl?: string }[];
};
```

When `title` is absent the first participant's `displayName` is used.

### Unread counts and previews

Pass a connected `ChatClient` and the inbox computes, per thread, the latest
message preview and the unread count — from `listMessages` plus the user's own
read receipt on first load, then from realtime `chatMessageReceived` events.
Selecting a thread marks it read. Without a `chatClient` the list still renders,
just without badges and previews.

If your app already calls `startRealtimeNotifications()`, use the hook directly
with `startRealtimeNotifications: false` so the inbox only attaches its listener.

## Styling

Three layers, pick the one that fits:

**1. The default skin.** Import `acs-chat-inbox/styles.css` and it looks
reasonable out of the box. Every value is a CSS variable:

```css
.acs-inbox {
  --acs-inbox-sidebar-width: 24rem;
  --acs-inbox-accent: #db2777;
  --acs-inbox-radius: 0.75rem;
}
```

**2. `data-slot` / `data-state` attributes.** Every element is addressable, so
you can skip the stylesheet entirely and write your own:

```css
[data-slot="thread-item"][data-state="selected"] { … }
[data-slot="thread-item"][data-unread="true"] [data-slot="thread-title"] { … }
[data-slot="unread-badge"] { … }
```

| `data-slot`                                                                      | element                                                                      |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `acs-chat-inbox`                                                                 | root, the two-pane container; `data-pane` is `list` / `chat`                 |
| `thread-list`                                                                    | sidebar; `data-state` is `loading` / `empty` / `ready`                       |
| `thread-list-header`                                                             | the "Chats" header                                                           |
| `thread-list-items`                                                              | scrolling list                                                               |
| `thread-item`                                                                    | one thread; `data-state` `selected` / `idle`, `data-unread` `true` / `false` |
| `thread-avatar`, `thread-title`, `thread-preview`, `thread-time`, `unread-badge` | parts of an item                                                             |
| `chat-pane`                                                                      | right pane; `data-state` is `empty` / `loading` / `ready`                    |
| `chat-back`                                                                      | back control, shown only in the narrow layout                                |
| `chat-body`                                                                      | wrapper around `ChatComposite` or the empty state                            |

**3. `classNames` and `renderThreadItem`.** For Tailwind, or to take the item
over completely:

```tsx
<AcsChatInbox
  {...acs}
  classNames={{
    root: "h-[90vh] rounded-xl border",
    sidebar: "bg-muted/30",
    threadItem: "hover:bg-accent",
    activeThreadItem: "border-primary bg-primary/5",
  }}
  renderThreadItem={(thread, state) => (
    <MyThreadItem
      thread={thread}
      selected={state.selected}
      unread={state.unreadCount}
      preview={state.latestMessagePreview}
    />
  )}
  renderEmpty={() => <MyEmptyState />}
/>
```

Message previews are rendered as plain text — `html` messages are stripped of
their markup rather than passed to `dangerouslySetInnerHTML`.

### Narrow layouts

Below `48rem` the inbox shows one pane at a time: the thread list until a thread
is opened, then the chat with a back control above it. Which pane is showing is
`data-pane` on the root.

The breakpoint is a **container** query, so it tracks the inbox's own width
rather than the window's — an inbox in a narrow column on a wide screen
collapses too. Going back is layout-only: it does not clear `selectedThreadId`,
so the thread stays selected and highlighted when the list comes back.

```tsx
<AcsChatInbox
  {...acs}
  backLabel="← Inbox" // default: "← Chats"
  onBack={() => track("inbox:back")}
  showBackButton={false} // to render your own instead
/>
```

`48rem` is fixed — a CSS query cannot read a custom property. To move it,
override the block:

```css
@container acs-inbox (max-width: 60rem) {
  [data-pane="chat"] [data-slot="thread-list"] {
    display: none;
  }
  [data-pane="list"] [data-slot="chat-pane"] {
    display: none;
  }
  [data-slot="chat-back"] {
    display: flex;
  }
}
```

## Headless

`useAcsChatInbox` is the whole data layer, usable without either component —
for an unread badge in a top bar, for instance:

```tsx
const { getThreadState, totalUnreadCount, markThreadRead, loading, error } =
  useAcsChatInbox({ chatClient, acsUserId, threads, selectedThreadId });
```

`AcsThreadList` is likewise usable on its own if you render the chat pane
yourself.

The `acs-inbox-unread-badge` class works outside the inbox, so a top-bar badge
can match the ones in the list:

```tsx
{
  totalUnreadCount > 0 && (
    <span data-slot="unread-badge" className="acs-inbox-unread-badge">
      {totalUnreadCount}
    </span>
  );
}
```

It falls back to the default colours there. The package's variables are defined
on `.acs-inbox`, not on `:root`, so to have a badge outside follow a retheme,
set `--acs-inbox-accent` on a shared ancestor as well.

## Try it

```sh
npm run demo
```

A Vite playground on `:5173`. It renders `AcsThreadList` and `useAcsChatInbox`
against an in-memory `ChatClient`, so unread counts, read receipts and realtime
previews can be seen without an ACS resource. The chat pane is demo code rather
than `ChatComposite`, which needs a live endpoint and token.

## What this package does not do

Deliberately out of scope, because each one is an opinion about your product
rather than about ACS:

- fetching, paginating, creating or archiving threads
- a user picker or "new chat" flow
- auth, token refresh, or server actions
- calling, presence, or profile panes

Bring those; this handles the shell.

### Where your own controls go

`sidebarTitle` takes any node, not just text, and the header is a flex row — so
a "new chat" button sits beside the title without a wrapper of your own:

```tsx
<AcsChatInbox
  {...acs}
  sidebarTitle={
    <>
      Chats
      <button onClick={openUserPicker}>+</button>
    </>
  }
/>
```

Creating the thread stays on your side: call `createChatThread` through your
backend, append the result to `threads`, then point `selectedThreadId` at it.
The inbox picks the new thread up on its own — `useAcsChatInbox` loads state for
any thread in `threads` it has not seen yet.

The same applies to archiving, pagination and search: they are list operations,
and the list is yours.

## Contributing

Issues and pull requests are welcome; read
[CONTRIBUTING.md](./CONTRIBUTING.md) first, and
[AGENTS.md](./AGENTS.md) if you are proposing something new — it says what the
package deliberately will not grow into.

Releases are automated: changes carry a
[changeset](https://github.com/changesets/changesets), merging to `main` opens a
"Version Packages" pull request, and merging that publishes to npm with
[provenance](https://docs.npmjs.com/generating-provenance-statements) and cuts
the GitHub release.

## License

MIT
