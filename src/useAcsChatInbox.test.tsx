import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ChatClient,
  ChatMessage,
  ChatMessageReadReceipt,
  ChatMessageReceivedEvent,
} from "@azure/communication-chat";
import type { AcsThread } from "./types.js";
import { useAcsChatInbox } from "./useAcsChatInbox.js";

const ME = "me";
const THEM = "them";

type Listener = (event: ChatMessageReceivedEvent) => void;

type SeedMessage = {
  id: string;
  minutesAgo: number;
  from: string;
  text?: string;
  type?: ChatMessage["type"];
  deleted?: boolean;
};

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60_000);
}

/**
 * The SDK's paged lists yield arrays from `byPage()`, and the page size comes
 * from the list call's options rather than from `byPage` itself. The hook reads
 * one page and stops, so the fake has to page the same way.
 */
function paged<T>(items: T[], maxPageSize?: number) {
  const size = maxPageSize && maxPageSize > 0 ? maxPageSize : items.length || 1;
  const pages: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    pages.push(items.slice(index, index + size));
  }
  async function* iteratePages(): AsyncGenerator<T[]> {
    for (const page of pages) yield page;
  }
  return { byPage: () => iteratePages() };
}

/** Only the surface `useAcsChatInbox` touches. */
class FakeChatClient {
  private readonly messages = new Map<string, ChatMessage[]>();
  private readonly readOn = new Map<string, Date>();
  private readonly listeners = new Set<Listener>();
  /** Threads that answer with a rejection, standing in for one the user lost access to. */
  readonly unreachable = new Set<string>();
  startCalls = 0;
  stopCalls = 0;

  seed(threadId: string, messages: SeedMessage[], readMinutesAgo?: number): this {
    this.messages.set(
      threadId,
      messages
        .map((message) => this.toChatMessage(message))
        .sort((a, b) => b.createdOn.getTime() - a.createdOn.getTime()),
    );
    if (readMinutesAgo !== undefined) this.readOn.set(threadId, minutesAgo(readMinutesAgo));
    return this;
  }

  private toChatMessage(message: SeedMessage): ChatMessage {
    return {
      id: message.id,
      type: message.type ?? "text",
      sequenceId: message.id,
      version: message.id,
      createdOn: minutesAgo(message.minutesAgo),
      deletedOn: message.deleted ? minutesAgo(message.minutesAgo) : undefined,
      content: { message: message.text ?? `message ${message.id}` },
      sender: { kind: "communicationUser", communicationUserId: message.from },
    };
  }

  getChatThreadClient(threadId: string) {
    if (this.unreachable.has(threadId)) {
      throw new Error(`thread ${threadId} is gone`);
    }
    return {
      listMessages: (options?: { maxPageSize?: number }) =>
        paged(this.messages.get(threadId) ?? [], options?.maxPageSize),
      listReadReceipts: (options?: { maxPageSize?: number }) => {
        const readOn = this.readOn.get(threadId);
        const receipts = readOn
          ? [
              {
                sender: { kind: "communicationUser", communicationUserId: ME },
                chatMessageId: "read-marker",
                readOn,
              } as ChatMessageReadReceipt,
            ]
          : [];
        return paged(receipts, options?.maxPageSize);
      },
    };
  }

  async startRealtimeNotifications(): Promise<void> {
    this.startCalls += 1;
  }

  async stopRealtimeNotifications(): Promise<void> {
    this.stopCalls += 1;
  }

  on(_event: "chatMessageReceived", listener: Listener): void {
    this.listeners.add(listener);
  }

  off(_event: "chatMessageReceived", listener: Listener): void {
    this.listeners.delete(listener);
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  /** Deliver a message as if it arrived over the wire. */
  deliver(event: Partial<ChatMessageReceivedEvent> & { threadId: string }): void {
    const full = {
      id: event.id ?? String(Date.now()),
      threadId: event.threadId,
      message: event.message ?? "incoming",
      type: "text",
      createdOn: event.createdOn ?? new Date(),
      sender: event.sender ?? { kind: "communicationUser", communicationUserId: THEM },
      version: "1",
    } as ChatMessageReceivedEvent;
    for (const listener of [...this.listeners]) listener(full);
  }

  asChatClient(): ChatClient {
    return this as unknown as ChatClient;
  }
}

const threads = (...ids: string[]): AcsThread[] => ids.map((id) => ({ id }));

describe("useAcsChatInbox", () => {
  let client: FakeChatClient;

  beforeEach(() => {
    client = new FakeChatClient();
  });

  function render(args: Partial<Parameters<typeof useAcsChatInbox>[0]> = {}) {
    return renderHook((props: Partial<Parameters<typeof useAcsChatInbox>[0]>) =>
      useAcsChatInbox({
        chatClient: client.asChatClient(),
        acsUserId: ME,
        threads: threads("a"),
        ...args,
        ...props,
      }),
    );
  }

  it("stays idle without a client", () => {
    const { result } = renderHook(() => useAcsChatInbox({ threads: threads("a") }));
    expect(result.current.loading).toBe(false);
    expect(result.current.threadStates.size).toBe(0);
    expect(result.current.getThreadState("a").unreadCount).toBe(0);
  });

  it("counts messages from others that arrived after the user's read receipt", async () => {
    client.seed(
      "a",
      [
        { id: "1", minutesAgo: 30, from: THEM, text: "old" },
        { id: "2", minutesAgo: 5, from: THEM, text: "new" },
        { id: "3", minutesAgo: 2, from: THEM, text: "<b>newer</b>", type: "html" },
      ],
      10,
    );
    const { result } = render();

    await waitFor(() => expect(result.current.loading).toBe(false));
    const state = result.current.getThreadState("a");
    expect(state.unreadCount).toBe(2);
    expect(state.latestMessagePreview).toBe("newer");
    expect(state.latestMessageFromMe).toBe(false);
    expect(result.current.totalUnreadCount).toBe(2);
  });

  it("counts the whole page when the thread was never read", async () => {
    client.seed("a", [
      { id: "1", minutesAgo: 30, from: THEM },
      { id: "2", minutesAgo: 5, from: THEM },
    ]);
    const { result } = render();

    await waitFor(() => expect(result.current.getThreadState("a").unreadCount).toBe(2));
  });

  it("never counts the user's own messages, and marks the latest as theirs", async () => {
    client.seed("a", [
      { id: "1", minutesAgo: 30, from: THEM },
      { id: "2", minutesAgo: 1, from: ME, text: "mine" },
    ]);
    const { result } = render();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.getThreadState("a").unreadCount).toBe(1);
    expect(result.current.getThreadState("a").latestMessageFromMe).toBe(true);
    expect(result.current.getThreadState("a").latestMessagePreview).toBe("mine");
  });

  it("ignores deleted messages and types it cannot preview", async () => {
    client.seed("a", [
      { id: "1", minutesAgo: 10, from: THEM, text: "kept" },
      { id: "2", minutesAgo: 5, from: THEM, text: "gone", deleted: true },
      {
        id: "3",
        minutesAgo: 1,
        from: THEM,
        type: "participantAdded",
      },
    ]);
    const { result } = render();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.getThreadState("a").unreadCount).toBe(1);
    expect(result.current.getThreadState("a").latestMessagePreview).toBe("kept");
  });

  it("reads the selected thread and leaves the others alone", async () => {
    client.seed("a", [{ id: "1", minutesAgo: 5, from: THEM }]);
    client.seed("b", [{ id: "2", minutesAgo: 5, from: THEM }]);
    const { result } = render({ threads: threads("a", "b"), selectedThreadId: "a" });

    await waitFor(() => expect(result.current.totalUnreadCount).toBe(1));
    expect(result.current.getThreadState("a").unreadCount).toBe(0);
    expect(result.current.getThreadState("b").unreadCount).toBe(1);
    // The preview survives being read; only the unread list is cleared.
    expect(result.current.getThreadState("a").latestMessage).toBeDefined();
  });

  it("counts a realtime message for an unselected thread and reports it once", async () => {
    client.seed("a", [], 1);
    client.seed("b", [], 1);
    const onUnreadMessage = vi.fn();
    const { result } = render({
      threads: threads("a", "b"),
      selectedThreadId: "a",
      onUnreadMessage,
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => client.deliver({ threadId: "b", id: "99", message: "ping" }));

    expect(result.current.getThreadState("b").unreadCount).toBe(1);
    expect(result.current.getThreadState("b").latestMessagePreview).toBe("ping");
    expect(onUnreadMessage).toHaveBeenCalledTimes(1);
    expect(onUnreadMessage.mock.calls[0]?.[0]).toBe("b");

    // ACS can redeliver; the same id must not count twice.
    act(() => client.deliver({ threadId: "b", id: "99", message: "ping" }));
    expect(result.current.getThreadState("b").unreadCount).toBe(1);
  });

  it("does not count realtime messages in the selected thread or from the user", async () => {
    client.seed("a", [], 1);
    const onUnreadMessage = vi.fn();
    const { result } = render({ selectedThreadId: "a", onUnreadMessage });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => client.deliver({ threadId: "a", id: "10" }));
    act(() =>
      client.deliver({
        threadId: "a",
        id: "11",
        sender: { kind: "communicationUser", communicationUserId: ME },
      }),
    );

    expect(result.current.getThreadState("a").unreadCount).toBe(0);
    expect(onUnreadMessage).not.toHaveBeenCalled();
    // Both still move the preview forward.
    expect(result.current.getThreadState("a").latestMessageFromMe).toBe(true);
  });

  it("ignores messages for threads the list does not hold", async () => {
    client.seed("a", [], 1);
    const { result } = render();
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => client.deliver({ threadId: "not-listed", id: "12" }));

    expect(result.current.threadStates.has("not-listed")).toBe(false);
    expect(result.current.totalUnreadCount).toBe(0);
  });

  it("drops state for threads that leave the list", async () => {
    client.seed("a", [{ id: "1", minutesAgo: 5, from: THEM }]);
    client.seed("b", [{ id: "2", minutesAgo: 5, from: THEM }]);
    const { result, rerender } = render({ threads: threads("a", "b") });
    await waitFor(() => expect(result.current.totalUnreadCount).toBe(2));

    rerender({ threads: threads("a") });

    expect(result.current.threadStates.has("b")).toBe(false);
    expect(result.current.totalUnreadCount).toBe(1);
  });

  it("markThreadRead clears unread without touching the preview", async () => {
    client.seed("a", [{ id: "1", minutesAgo: 5, from: THEM, text: "hi" }]);
    const { result } = render();
    await waitFor(() => expect(result.current.totalUnreadCount).toBe(1));

    act(() => result.current.markThreadRead("a"));

    expect(result.current.totalUnreadCount).toBe(0);
    expect(result.current.getThreadState("a").latestMessagePreview).toBe("hi");
  });

  it("keeps the rest of the list when one thread cannot be read", async () => {
    client.seed("a", [{ id: "1", minutesAgo: 5, from: THEM }]);
    client.unreachable.add("b");
    const { result } = render({ threads: threads("a", "b") });

    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(result.current.getThreadState("a").unreadCount).toBe(1);
    expect(result.current.threadStates.has("b")).toBe(false);
  });

  it("starts and stops realtime notifications with the client it is given", async () => {
    client.seed("a", [], 1);
    const { result, unmount } = render();
    await waitFor(() => expect(client.startCalls).toBe(1));
    expect(client.listenerCount).toBe(1);
    expect(result.current.error).toBeUndefined();

    unmount();
    expect(client.listenerCount).toBe(0);
    expect(client.stopCalls).toBe(1);
  });

  it("only attaches its listener when the app owns the connection", async () => {
    client.seed("a", [], 1);
    const { unmount } = render({ startRealtimeNotifications: false });
    await waitFor(() => expect(client.listenerCount).toBe(1));
    expect(client.startCalls).toBe(0);

    unmount();
    expect(client.stopCalls).toBe(0);
  });
});
