import { memo } from "react";
import type { ReactNode } from "react";
import type {
  AcsChatInboxClassNames,
  AcsThread,
  AcsThreadItemState,
  AcsThreadState,
} from "./types.js";
import { cx, formatRelativeTime, getInitials, getThreadTitle } from "./utils.js";

export type AcsThreadListProps = {
  threads: AcsThread[];
  selectedThreadId?: string;
  onThreadSelect: (thread: AcsThread) => void;
  /** Per-thread unread and preview state, normally from `useAcsChatInbox`. */
  getThreadState: (threadId: string) => AcsThreadState;
  /** Header text above the list. Pass `null` to drop the header. */
  title?: ReactNode;
  loading?: boolean;
  /** Replaces the whole item, keeping only the list's own wrapper. */
  renderThreadItem?: (thread: AcsThread, state: AcsThreadItemState) => ReactNode;
  renderEmpty?: () => ReactNode;
  /** Overrides the built-in relative time. */
  formatTime?: (date: Date) => string;
  /** Prefix for a preview of the user's own last message, e.g. `"You: "`. */
  ownMessagePrefix?: string;
  classNames?: AcsChatInboxClassNames;
};

export function AcsThreadList({
  threads,
  selectedThreadId,
  onThreadSelect,
  getThreadState,
  title = "Chats",
  loading = false,
  renderThreadItem,
  renderEmpty,
  formatTime = formatRelativeTime,
  ownMessagePrefix = "You: ",
  classNames,
}: AcsThreadListProps): ReactNode {
  const isEmpty = !loading && threads.length === 0;

  return (
    <div
      data-slot="thread-list"
      data-state={loading ? "loading" : isEmpty ? "empty" : "ready"}
      className={cx("acs-inbox-sidebar", classNames?.sidebar)}
    >
      {title !== null && (
        <div
          data-slot="thread-list-header"
          className={cx("acs-inbox-sidebar-header", classNames?.sidebarHeader)}
        >
          {title}
        </div>
      )}

      <div
        data-slot="thread-list-items"
        className={cx("acs-inbox-thread-list", classNames?.threadList)}
      >
        {isEmpty &&
          (renderEmpty?.() ?? (
            <div
              data-slot="thread-list-empty"
              className={cx("acs-inbox-empty", classNames?.empty)}
            >
              No chats yet
            </div>
          ))}

        {threads.map((thread) => (
          <ThreadItem
            key={thread.id}
            thread={thread}
            selected={thread.id === selectedThreadId}
            state={getThreadState(thread.id)}
            onThreadSelect={onThreadSelect}
            formatTime={formatTime}
            ownMessagePrefix={ownMessagePrefix}
            {...(renderThreadItem !== undefined ? { renderThreadItem } : {})}
            {...(classNames !== undefined ? { classNames } : {})}
          />
        ))}
      </div>
    </div>
  );
}

type ThreadItemProps = {
  thread: AcsThread;
  selected: boolean;
  state: AcsThreadState;
  onThreadSelect: (thread: AcsThread) => void;
  formatTime: (date: Date) => string;
  ownMessagePrefix: string;
  renderThreadItem?: (thread: AcsThread, state: AcsThreadItemState) => ReactNode;
  classNames?: AcsChatInboxClassNames;
};

/**
 * One row, memoized: `getThreadState` returns a new map on every realtime
 * message, and without this every thread in the list re-renders for a message
 * that belongs to one of them. Only pays off while the props a consumer passes
 * (`onThreadSelect`, `classNames`, `renderThreadItem`) are referentially stable.
 */
const ThreadItem = memo(function ThreadItem({
  thread,
  selected,
  state,
  onThreadSelect,
  formatTime,
  ownMessagePrefix,
  renderThreadItem,
  classNames,
}: ThreadItemProps): ReactNode {
  const itemState: AcsThreadItemState = { ...state, selected };

  if (renderThreadItem) {
    return <div data-slot="thread-item-wrapper">{renderThreadItem(thread, itemState)}</div>;
  }

  const name = getThreadTitle(thread);
  const avatarUrl = thread.participants?.[0]?.avatarUrl;
  // Unread on the open thread is noise: the user is looking at it.
  const unreadCount = selected ? 0 : state.unreadCount;
  const time = state.latestMessage?.createdOn;

  return (
    <button
      type="button"
      data-slot="thread-item"
      data-state={selected ? "selected" : "idle"}
      data-unread={unreadCount > 0 ? "true" : "false"}
      aria-current={selected}
      onClick={() => onThreadSelect(thread)}
      className={cx(
        "acs-inbox-thread-item",
        classNames?.threadItem,
        selected && "acs-inbox-thread-item--selected",
        selected && classNames?.activeThreadItem,
      )}
    >
      <span data-slot="thread-item-row" className="acs-inbox-thread-item-row">
        <span data-slot="thread-avatar" className="acs-inbox-avatar">
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="acs-inbox-avatar-image" />
          ) : (
            getInitials(name)
          )}
        </span>
        <span data-slot="thread-title" className="acs-inbox-thread-title">
          {name}
        </span>
        {unreadCount > 0 && (
          <span data-slot="unread-badge" className="acs-inbox-unread-badge">
            {unreadCount}
          </span>
        )}
      </span>

      <span data-slot="thread-preview" className="acs-inbox-thread-preview">
        {state.latestMessage ? (
          <>
            {state.latestMessageFromMe && (
              <span data-slot="thread-preview-prefix">{ownMessagePrefix}</span>
            )}
            {state.latestMessagePreview}
          </>
        ) : (
          "No messages yet"
        )}
      </span>

      {time && (
        <span data-slot="thread-time" className="acs-inbox-thread-time">
          {formatTime(time)}
        </span>
      )}
    </button>
  );
});
