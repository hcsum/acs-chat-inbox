import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ChatClient,
  ChatMessage,
  ChatMessageReceivedEvent,
} from "@azure/communication-chat";
import type { AcsInboxMessage, AcsThread, AcsThreadState } from "./types.js";
import { getMessagePreview, isFromUser } from "./utils.js";

export type UseAcsChatInboxArgs = {
  /** A connected `ChatClient`. While undefined the hook stays idle. */
  chatClient?: ChatClient;
  /** ACS user id of the signed-in user, used to tell own messages from others'. */
  acsUserId?: string;
  /** The threads to track. Fully controlled: the hook never fetches the list itself. */
  threads: AcsThread[];
  /** Selecting a thread marks it read. */
  selectedThreadId?: string;
  /**
   * Size of the one page of history fetched per thread. Unread counts start from
   * that page, so a thread with more than this many unread messages reports the
   * page size; realtime messages are counted on top of it. The whole thread is
   * deliberately not paged through — that would be one request per page per thread
   * on first render.
   */
  messagePageSize?: number;
  /**
   * Call `startRealtimeNotifications()` on the client. Turn off when the app
   * already starts them, so the inbox only attaches its listener.
   */
  startRealtimeNotifications?: boolean;
  /** Called when a message arrives in a thread other than the selected one. */
  onUnreadMessage?: (threadId: string, message: ChatMessageReceivedEvent) => void;
};

export type UseAcsChatInboxResult = {
  threadStates: Map<string, AcsThreadState>;
  getThreadState: (threadId: string) => AcsThreadState;
  totalUnreadCount: number;
  markThreadRead: (threadId: string) => void;
  /** True until the first batch of thread states has been loaded. */
  loading: boolean;
  error?: Error;
};

const EMPTY_STATE: AcsThreadState = {
  unreadCount: 0,
  unreadMessages: [],
  latestMessage: undefined,
  latestMessagePreview: "",
  latestMessageFromMe: false,
};

/**
 * Read receipts are one per participant, so a single page covers any thread a
 * person is actually reading.
 */
const RECEIPT_PAGE_SIZE = 100;

/**
 * The slice of the SDK's `PagedAsyncIterableIterator` used here, written out so
 * `@azure/core-paging` does not become a dependency.
 */
type PagedList<T> = {
  byPage: (settings?: { maxPageSize?: number }) => AsyncIterableIterator<T[]>;
};

/**
 * Iterating a paged list with `for await` walks every page — back to the start of
 * the thread. Only the first page is wanted, and page size comes from the list
 * call's own options (the SDK ignores `byPage`'s `maxPageSize`).
 */
async function firstPage<T>(list: PagedList<T>): Promise<T[]> {
  const page = await list.byPage().next();
  return page.done ? [] : page.value;
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

function toState(
  latestMessage: AcsInboxMessage | undefined,
  unreadMessages: AcsInboxMessage[],
  acsUserId: string,
): AcsThreadState {
  return {
    unreadCount: unreadMessages.length,
    unreadMessages,
    latestMessage,
    latestMessagePreview: getMessagePreview(latestMessage),
    latestMessageFromMe: isFromUser(latestMessage, acsUserId),
  };
}

function pickLatest(
  a: AcsInboxMessage | undefined,
  b: AcsInboxMessage | undefined,
): AcsInboxMessage | undefined {
  if (!a) return b;
  if (!b) return a;
  return b.createdOn > a.createdOn ? b : a;
}

/**
 * Folds a just-fetched state into whatever is already in the map. Realtime
 * messages and `markThreadRead` calls both land while the fetch is in flight, so
 * the fetch merges instead of overwriting: unread is the union of both sides
 * deduped by message id, minus anything read since, and the latest message is
 * whichever of the two is newer.
 */
function mergeStates(
  fetched: AcsThreadState,
  live: AcsThreadState | undefined,
  readAt: number | undefined,
  acsUserId: string,
): AcsThreadState {
  const unreadMessages: AcsInboxMessage[] = [];
  const seen = new Set<string>();
  const candidates = live
    ? [...fetched.unreadMessages, ...live.unreadMessages]
    : fetched.unreadMessages;

  for (const message of candidates) {
    if (seen.has(message.id)) continue;
    if (readAt !== undefined && message.createdOn.getTime() <= readAt) continue;
    seen.add(message.id);
    unreadMessages.push(message);
  }

  return toState(
    pickLatest(fetched.latestMessage, live?.latestMessage),
    unreadMessages,
    acsUserId,
  );
}

async function fetchThreadState(
  threadId: string,
  chatClient: ChatClient,
  acsUserId: string,
  messagePageSize: number,
): Promise<AcsThreadState> {
  const threadClient = chatClient.getChatThreadClient(threadId);
  const [messages, receipts] = await Promise.all([
    firstPage(threadClient.listMessages({ maxPageSize: messagePageSize })),
    firstPage(threadClient.listReadReceipts({ maxPageSize: RECEIPT_PAGE_SIZE })),
  ]);

  // A user can have several receipts and the order they come back in is not part
  // of the API, so the newest one is the one that says what has been read.
  let ownReadOn: Date | undefined;
  for (const receipt of receipts) {
    if (receipt.sender.kind !== "communicationUser") continue;
    if (receipt.sender.communicationUserId !== acsUserId) continue;
    if (!ownReadOn || receipt.readOn > ownReadOn) ownReadOn = receipt.readOn;
  }

  // Deleted messages still come back, with their content stripped: they would
  // otherwise show up as a blank preview and count as unread.
  const history: ChatMessage[] = messages.filter(
    (message) =>
      message.deletedOn === undefined &&
      (message.type === "html" || message.type === "text"),
  );

  // Messages come back newest first. Anything from another participant after the
  // user's own read receipt is unread; with no receipt at all, all of them are.
  const unreadMessages = history.filter(
    (message) =>
      !isFromUser(message, acsUserId) &&
      message.sender?.kind === "communicationUser" &&
      (!ownReadOn || message.createdOn > ownReadOn),
  );

  return toState(history[0], unreadMessages, acsUserId);
}

/**
 * Tracks unread counts and latest-message previews for a list of ACS chat
 * threads, and keeps them current over realtime notifications.
 */
export function useAcsChatInbox({
  chatClient,
  acsUserId,
  threads,
  selectedThreadId,
  messagePageSize = 10,
  startRealtimeNotifications = true,
  onUnreadMessage,
}: UseAcsChatInboxArgs): UseAcsChatInboxResult {
  const [threadStates, setThreadStates] = useState<Map<string, AcsThreadState>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | undefined>();

  // Read inside the realtime listener, which is attached once per client.
  const selectedThreadIdRef = useRef(selectedThreadId);
  const onUnreadMessageRef = useRef(onUnreadMessage);
  const acsUserIdRef = useRef(acsUserId);
  // Which threads the list currently holds, so a message for a thread that is
  // not listed never creates state (and so never a badge for it).
  const trackedThreadIdsRef = useRef<Set<string>>(new Set());
  // When each thread was last marked read, so a fetch that was already in flight
  // does not bring its unread messages back.
  const readAtRef = useRef<Map<string, number>>(new Map());

  // Written in an effect, not during render: concurrent React may render without
  // committing, and a ref write there would be kept.
  useEffect(() => {
    selectedThreadIdRef.current = selectedThreadId;
    onUnreadMessageRef.current = onUnreadMessage;
    acsUserIdRef.current = acsUserId;
  });

  const threadIdsKey = threads.map((thread) => thread.id).join(",");
  const threadIds = useMemo(
    () => new Set(threads.map((thread) => thread.id)),
    // `threads` is a new array on most renders; its ids are what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [threadIdsKey],
  );

  // Drop state for threads that left the list: it would otherwise keep counting
  // towards `totalUnreadCount` forever.
  useEffect(() => {
    trackedThreadIdsRef.current = threadIds;
    setThreadStates((previous) => {
      let changed = false;
      const next = new Map(previous);
      for (const id of previous.keys()) {
        if (threadIds.has(id)) continue;
        next.delete(id);
        readAtRef.current.delete(id);
        changed = true;
      }
      return changed ? next : previous;
    });
  }, [threadIds]);

  // Load state for threads that appeared since the last render.
  useEffect(() => {
    if (!chatClient || !acsUserId) return;
    const missingIds = threads
      .map((thread) => thread.id)
      .filter((id) => !threadStates.has(id));
    if (missingIds.length === 0) return;

    let cancelled = false;
    // The fetch is the external system this effect synchronizes with, and
    // `loading` is its in-flight flag; there is no render pass to hoist it to.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    // One unreachable thread — deleted, or one the user was removed from — must
    // not take the whole list's previews down with it.
    void Promise.allSettled(
      missingIds.map((id) => fetchThreadState(id, chatClient, acsUserId, messagePageSize)),
    )
      .then((results) => {
        if (cancelled) return;
        const fetched: [string, AcsThreadState][] = [];
        const failures: unknown[] = [];
        results.forEach((result, index) => {
          const id = missingIds[index];
          if (id === undefined) return;
          if (result.status === "fulfilled") fetched.push([id, result.value]);
          else failures.push(result.reason);
        });

        if (fetched.length > 0) {
          setThreadStates((previous) => {
            const next = new Map(previous);
            for (const [id, state] of fetched) {
              if (!trackedThreadIdsRef.current.has(id)) continue;
              next.set(
                id,
                mergeStates(state, previous.get(id), readAtRef.current.get(id), acsUserId),
              );
            }
            return next;
          });
        }
        setError(failures.length > 0 ? toError(failures[0]) : undefined);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // `threadStates` is intentionally omitted: it is written by this effect, and
    // re-running on its own write would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatClient, acsUserId, threadIdsKey, messagePageSize]);

  // Attach the realtime listener once per client.
  useEffect(() => {
    if (!chatClient) return;
    let disposed = false;

    const handleMessageReceived = (event: ChatMessageReceivedEvent): void => {
      if (event.sender?.kind !== "communicationUser") return;
      const currentUserId = acsUserIdRef.current;
      if (!currentUserId) return;
      if (!trackedThreadIdsRef.current.has(event.threadId)) return;

      const ownMessage = event.sender.communicationUserId === currentUserId;
      const inSelectedThread = selectedThreadIdRef.current === event.threadId;
      const counts = !ownMessage && !inSelectedThread;

      setThreadStates((previous) => {
        const next = new Map(previous);
        const current = next.get(event.threadId) ?? EMPTY_STATE;
        // ACS can redeliver a message; keep the unread list free of duplicates.
        const alreadySeen = current.unreadMessages.some(
          (message) => message.id === event.id,
        );
        const unreadMessages =
          counts && !alreadySeen
            ? [...current.unreadMessages, event]
            : current.unreadMessages;
        next.set(event.threadId, toState(event, unreadMessages, currentUserId));
        return next;
      });

      if (counts) onUnreadMessageRef.current?.(event.threadId, event);
    };

    const start = async (): Promise<void> => {
      if (startRealtimeNotifications) await chatClient.startRealtimeNotifications();
      if (disposed) return;
      chatClient.on("chatMessageReceived", handleMessageReceived);
    };

    start().catch((cause: unknown) => {
      setError(toError(cause));
    });

    return () => {
      disposed = true;
      chatClient.off("chatMessageReceived", handleMessageReceived);
      // Only stop what this hook started; when the app owns the connection it
      // passes `startRealtimeNotifications: false`.
      if (startRealtimeNotifications) {
        void chatClient.stopRealtimeNotifications().catch(() => {
          // The client is being let go either way; nothing useful to report.
        });
      }
    };
  }, [chatClient, startRealtimeNotifications]);

  const markThreadRead = useCallback((threadId: string) => {
    readAtRef.current.set(threadId, Date.now());
    setThreadStates((previous) => {
      const current = previous.get(threadId);
      if (!current || current.unreadMessages.length === 0) return previous;
      const next = new Map(previous);
      next.set(threadId, { ...current, unreadCount: 0, unreadMessages: [] });
      return next;
    });
  }, []);

  // Selecting a thread reads it. Read state belongs to the thread, not to this
  // render, so it is written where the selection changes rather than derived.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (selectedThreadId) markThreadRead(selectedThreadId);
  }, [selectedThreadId, markThreadRead, threadStates.size]);

  const getThreadState = useCallback(
    (threadId: string) => threadStates.get(threadId) ?? EMPTY_STATE,
    [threadStates],
  );

  const totalUnreadCount = useMemo(() => {
    let total = 0;
    for (const state of threadStates.values()) total += state.unreadCount;
    return total;
  }, [threadStates]);

  return { threadStates, getThreadState, totalUnreadCount, markThreadRead, loading, error };
}
