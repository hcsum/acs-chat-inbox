# Contributing

Thanks for looking. This is a small package with a deliberately small scope, so
the most useful thing to read first is the "Scope" section of
[`AGENTS.md`](./AGENTS.md) — it says what the package will and will not grow
into, and why.

## Getting set up

```sh
git clone https://github.com/hcsum/acs-chat-inbox.git
cd acs-chat-inbox
npm install
npm run demo     # Vite playground at http://localhost:5173, no Azure account needed
```

The demo imports the library straight from `src/`, so a change shows up on
save. It runs against an in-memory `ChatClient` stand-in
(`demo/src/mockChatClient.ts`), which means the real unread and preview logic is
exercised without an ACS resource.

## The loop

```sh
npm run build          # tsup -> dist (ESM + CJS + .d.ts)
npm run typecheck      # tsc --noEmit
npm run lint           # eslint (use lint:fix for the mechanical ones)
npm run format         # prettier --write .
npm test               # vitest
npm run test:watch     # vitest in watch mode
npm run check:exports  # publint + attw against the packed tarball
```

CI runs all of these, plus a Node 20/22/24 × React 18/19 matrix, because the
peer range claims to support all six combinations.

## Changesets

Any change that reaches npm needs a changeset:

```sh
npm run changeset
```

Choose the bump, write the line the way a user of the package would read it,
and commit the generated `.changeset/*.md` alongside your change. On merge to
`main`, CI opens a **"Version Packages"** pull request; merging that one
publishes to npm and cuts the GitHub release.

CI-only, docs-only, and demo-only changes need no changeset.

## Things worth knowing before you patch

- **Zero runtime dependencies, on purpose.** Everything external is a peer
  dependency. `date-fns` and `dompurify` were both avoided by writing a few
  lines in `src/utils.ts`; keep that bar.
- **`credential` and `userId` must be referentially stable** in consuming code.
  A fresh object each render rebuilds the chat adapter.
- The tests use a fake `ChatClient` that pages the way the SDK does. If you
  touch `useAcsChatInbox`, the unread arithmetic is the part to cover.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/) — `feat:`, `fix:`,
`docs:`, `chore:`, `refactor:`, `test:`. The changelog comes from changesets
rather than from commits, so this is for readability, not for tooling.
