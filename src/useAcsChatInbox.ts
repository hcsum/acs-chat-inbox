import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ChatClient,
  ChatMessage,
  ChatMessageReadReceipt,
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
  /** How many recent messages to scan per thread when computing unread counts. */
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

async function fetchThreadState(
  threadId: string,
  chatClient: ChatClient,
  acsUserId: string,
  messagePageSize: number,
): Promise<AcsThreadState> {
  const threadClient = chatClient.getChatThreadClient(threadId);
  const [messages, receipts] = await Promise.all([
    threadClient.listMessages({ maxPageSize: messagePageSize }),
    threadClient.listReadReceipts(),
  ]);

  let ownReceipt: ChatMessageReadReceipt | undefined;
  for await (const receipt of receipts) {
    if (
      receipt.sender.kind === "communicationUser" &&
      receipt.sender.communicationUserId === acsUserId
    ) {
      ownReceipt = receipt;
      break;
    }
  }

  const allMessages: ChatMessage[] = [];
  for await (const message of messages) {
    if (message.type === "html" || message.type === "text") allMessages.push(message);
  }

  // Messages come back newest first. Anything from another participant after the
  // user's own read receipt is unread; with no receipt at all, all of them are.
  const unreadMessages = allMessages.filter(
    (message) =>
      !isFromUser(message, acsUserId) &&
      message.sender?.kind === "communicationUser" &&
      (!ownReceipt || message.createdOn > ownReceipt.readOn),
  );

  return toState(allMessages[0], unreadMessages, acsUserId);
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
  selectedThreadIdRef.current = selectedThreadId;
  const onUnreadMessageRef = useRef(onUnreadMessage);
  onUnreadMessageRef.current = onUnreadMessage;
  const acsUserIdRef = useRef(acsUserId);
  acsUserIdRef.current = acsUserId;

  const threadIdsKey = threads.map((thread) => thread.id).join(",");

  // Load state for threads that appeared since the last render.
  useEffect(() => {
    if (!chatClient || !acsUserId) return;
    const missingIds = threads
      .map((thread) => thread.id)
      .filter((id) => !threadStates.has(id));
    if (missingIds.length === 0) return;

    let cancelled = false;
    setLoading(true);
    Promise.all(
      missingIds.map(
        async (id) =>
          [id, await fetchThreadState(id, chatClient, acsUserId, messagePageSize)] as const,
      ),
    )
      .then((entries) => {
        if (cancelled) return;
        setThreadStates((previous) => {
          const next = new Map(previous);
          for (const [id, state] of entries) next.set(id, state);
          return next;
        });
        setError(undefined);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause : new Error(String(cause)));
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
          counts && !alreadySeen ? [...current.unreadMessages, event] : current.unreadMessages;
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
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    });

    return () => {
      disposed = true;
      chatClient.off("chatMessageReceived", handleMessageReceived);
    };
  }, [chatClient, startRealtimeNotifications]);

  const markThreadRead = useCallback((threadId: string) => {
    setThreadStates((previous) => {
      const current = previous.get(threadId);
      if (!current || current.unreadMessages.length === 0) return previous;
      const next = new Map(previous);
      next.set(threadId, { ...current, unreadCount: 0, unreadMessages: [] });
      return next;
    });
  }, []);

  // Selecting a thread reads it.
  useEffect(() => {
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
