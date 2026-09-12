# Handover — acs-chat-inbox review backlog

2026-09-12 的全量 review 产出，行号对应改动后的工作树（HEAD 仍是 `a8e05c9`，改动全部未提交）。

## 已经做完的

### 依赖（上一轮）

- devDependencies 从 beta 升到稳定版：`@azure/communication-react` 1.28.0-beta.2 → **1.34.0**，
  `@azure/communication-chat` 1.6.0-beta.7 → **1.6.0**，零 breaking。
- README 新增 `### React 19` 小节：ACS 官方 peer 是 `react: ">=16.8.0 <19.0.0"`，
  React 19 需要 `--legacy-peer-deps`。`package.json` 的 peerDependencies 未改。

### P0 全部七条（这一轮）

1. **取消选中后右侧还显示上一个会话** — `src/AcsChatInbox.tsx`。已核对 1.34.0 的实现：
   `threadId` 缺失时那个 effect 直接 `return`，既不清 state 也不 dispose。
   现在加了 `activeAdapter = selectedThreadId ? adapter : undefined`，`data-state`、
   `ChatComposite`、`onChatAdapterChange` 全部走它。
2. **一个线程失败拖垮所有预览** — `Promise.all` → `Promise.allSettled`，成功的照常写入，
   失败的取第一条进 `error`。
3. **首屏拉完整条历史** — 新增 `firstPage()`，`listMessages` / `listReadReceipts` 都只读第一页。
   注意页大小来自 list 调用的 options，SDK 会忽略 `byPage` 自己的 `maxPageSize`。
   `messagePageSize` 的 JSDoc 一并改对。
4. **加载期间到达的实时消息被覆盖** — 新增 `mergeStates()`：按消息 id 去重取并集，
   `latestMessage` 取两边较新的。
5. **未读数包含列表里没有的线程** — 新增 prune effect，线程离开 `threads` 就删掉它的 state；
   实时 handler 先查 `trackedThreadIdsRef` 再建条目。
6. **只取遇到的第一条自己的回执** — 改成取 `readOn` 最大的那条。
7. **没过滤已删除消息** — `deletedOn` 存在就跳过。

顺带把 4 和 5 之间的一个缺口也堵了：`markThreadRead` 现在记 `readAtRef` 时间戳，
首屏 fetch 回来时会丢掉这个时刻之前的未读，否则「加载中点开会话」会把未读又刷回来。

### P2 里的机械项

- **13 `"use client"`** — 不能用 tsup 的 `banner`：`treeshake: true` 会把产物再过一遍 rollup，
  rollup 直接丢掉 module-level directive（会打印 "Module level directives cause errors when bundled"）。
  改成 build 结束后由 `scripts/postbuild.mjs` 前置，并给 sourcemap 的 `mappings` 补一个 `;` 对齐行号。
  该脚本同时接管了原来 `onSuccess` 里的 `styles.d.css.ts` 拷贝。
- **14 `onChatAdapterChange` 进依赖数组** — 挪进 ref。
- **15 render 阶段写 ref** — `useAcsChatInbox` 里三个 ref 的赋值挪进无依赖 effect。
- **16 缺 `stopRealtimeNotifications()`** — cleanup 里补上，只在 `startRealtimeNotifications` 为真
  （即连接是这个 hook 起的）时调用。
- **17 列表没 memo** — `AcsThreadList` 的行抽成 `ThreadItem` + `memo`。只有消费者传的
  `onThreadSelect` / `classNames` / `renderThreadItem` 引用稳定时才真正生效。

### 连带修的

- `demo/src/mockChatClient.ts` 现在按 SDK 的方式分页（`byPage()` 吐数组，页大小来自 options），
  并补了 `stopRealtimeNotifications()`，否则新的 `firstPage()` 在 demo 里直接崩。
- demo 移除了自己那份 `@azure/communication-chat`（还停在 1.6.0-beta.7）。两份 SDK 就是两个
  `ChatClient` 声明，私有字段让它们互不兼容，`asChatClient()` 过不了 tsc。现在 demo 用根目录那份。

### 验证

`npm run typecheck`、`npm run build`、`npm --prefix demo run typecheck`、
`npm --prefix demo run build` 全过。demo 在浏览器里跑过一遍：预览、未读 badge、
「收到新消息 → 角标 +1」、「点开会话 → 清零」都对，控制台干净。
仍然没有对着真实 ACS 资源验证过。

## 还没做 — P1 功能缺口

### 8. 只订阅了 `chatMessageReceived`

SDK 还提供 `chatMessageEdited`、`chatMessageDeleted`、`readReceiptReceived`、
`realTimeNotificationDisconnected` / `Connected`。当前后果：

- 消息被编辑或撤回后预览不更新；
- 用户在另一台设备读完，这边 badge 不消；
- **断线重连后没有重新拉取**，掉线期间的消息永久不计入未读（最严重的一个）。

重连那条现在有了着力点：prune effect 之外再加一条「清空 `threadStates` 触发重新 fetch」即可。

### 9. 非 communicationUser 的发送者一律不算未读

`src/utils.ts:49-54` 和 `src/useAcsChatInbox.ts` 的 unread 过滤都要求 `kind === "communicationUser"`。
Teams interop 场景下 `microsoftTeamsUser` 发的消息完全不显示未读。

### 10. 从不调用 `sendReadReceipt`

选中只在本地清零，刷页面未读就回来。完整组件路径侥幸没事（ChatComposite 的 adapter 会替你发回执），
但 README 主推的 headless / 只用 `AcsThreadList` 的路径是坏的。
要么发回执，要么在 README 的 Headless 段写清楚这个限制。

### 11. 只把 `options` 透传给 ChatComposite

`src/AcsChatInbox.tsx` 的 `<ChatComposite>` 只收了 `adapter` 和 `options`。
`ChatCompositeProps` 还有 `fluentTheme`、`locale`、`rtl`、`icons`、`onRenderMessage`、
`onFetchAvatarPersonaData` 没暴露。**不包括 `formFactor`** —— 那是 beta-only 的 prop，
1.34.0 稳定版的 `ChatCompositeProps` 上没有。

### 12. 双 signaling 连接，README 该写明

每切一个线程就新建一个 adapter，adapter 内部自带一个 ChatClient 和自己的实时连接，
加上消费者传进来的 `chatClient`，一个页面同时有两条 signaling 连接。
这是 ACS 的设计使然，改不了，但不写明用户会怀疑通知重复。

## 还没做 — 18. 零测试

P0 的 2/3/4/5/6/7 每条都是一个 unit test 就能钉住的，且都不需要真 ACS 资源；
`demo/src/mockChatClient.ts` 的内存版 ChatClient 可以直接复用（现在它也会分页了）。
缺的是决定：加 vitest + `@testing-library/react` 两个 devDep，还是继续零测试。

## 还没做决定的

- peerDependencies 要不要加 `<2.0.0` 上界。现在 `>=1.15.0` 无上界，2.0.0 一发布就自动声称兼容。
- react peer 要不要从 `^18.0.0 || ^19.0.0` 收回 `^18`。这次选择了只在 README 写明，没改 range。
- CI 要不要跑 1.15 和 1.34 双版本 typecheck，验证宽 peer range 的真实兼容面。

## 已经查证过的事实（不用再查一遍）

- `ChatMessage.content.message`、`ChatMessageReceivedEvent.message`、`ChatMessageReadReceipt.readOn`
  这些 shape 跟 SDK typings 完全一致，`ChatMessageType` 的 `"text" | "html"` 也对。
- **实时事件的 `type` 是 `string`，取值是 `"Text"` / `"RichText/Html"`**（大写带斜杠），
  跟 REST 的小写枚举不是一套。现在实时路径没做 type 过滤所以没暴露，将来加过滤别照抄 `utils.ts` 的小写判断。
- `useAzureCommunicationChatAdapter` 在 1.34.0 里实现一字未改，缺字段时只是 `return`（见 P0 第 1 条）。
- `formFactor` 是 beta-only 的 prop，稳定版 `ChatCompositeProps` 上没有。
- `ChatCompositeOptions` 从 beta 到稳定版是收窄的，现在只有 `errorBar` / `topic` / `autoFocus`。
- `listMessages` 返回 `PagedAsyncIterableIterator`：`for await` 会翻完所有分页，
  `byPage(settings)` 的 `settings` 被实现忽略，页大小只认 `listMessages(options)` 里的 `maxPageSize`。
