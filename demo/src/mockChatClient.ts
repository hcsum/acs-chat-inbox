import type {
  ChatClient,
  ChatMessage,
  ChatMessageReadReceipt,
  ChatMessageReceivedEvent,
} from "@azure/communication-chat";

/**
 * An in-memory stand-in for `ChatClient`, implementing only the surface
 * `useAcsChatInbox` touches: message history, the signed-in user's read
 * receipt, and `chatMessageReceived` notifications.
 *
 * The point is that the demo exercises the real unread / preview logic rather
 * than feeding the list pre-computed state.
 */

export type MockMessage = {
  id: string;
  /** Minutes ago; the demo writes history relative to page load. */
  minutesAgo: number;
  from: string;
  text: string;
  type?: "text" | "html";
};

export type MockThreadSeed = {
  threadId: string;
  /** Minutes ago the user last read this thread. Omit for "never read". */
  readMinutesAgo?: number;
  messages: MockMessage[];
};

type Listener = (event: ChatMessageReceivedEvent) => void;

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60_000);
}

/**
 * The hook reads one page and stops, so the mock has to page like the SDK does:
 * `byPage()` yields arrays, and the page size comes from the list call's options
 * rather than from `byPage` itself.
 */
function paged<T>(items: T[], maxPageSize?: number) {
  const size = maxPageSize && maxPageSize > 0 ? maxPageSize : items.length || 1;
  const pages: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    pages.push(items.slice(index, index + size));
  }

  async function* iterateItems(): AsyncGenerator<T> {
    for (const page of pages) for (const item of page) yield item;
  }
  async function* iteratePages(): AsyncGenerator<T[]> {
    for (const page of pages) yield page;
  }

  const items$ = iterateItems();
  return {
    next: () => items$.next(),
    [Symbol.asyncIterator]() {
      return this;
    },
    byPage: () => iteratePages(),
  };
}

export class MockChatClient {
  private readonly messages = new Map<string, ChatMessage[]>();
  private readonly readOn = new Map<string, Date>();
  private readonly listeners = new Set<Listener>();
  private nextId = 1000;

  constructor(
    private readonly acsUserId: string,
    seeds: MockThreadSeed[],
    /** ACS user id -> display name, so the demo pane shows names not raw ids. */
    private readonly displayNames: Record<string, string> = {},
  ) {
    for (const seed of seeds) {
      // ACS returns history newest first, and the hook relies on that ordering.
      const history = seed.messages
        .map((message) => this.toChatMessage(seed.threadId, message))
        .sort((a, b) => b.createdOn.getTime() - a.createdOn.getTime());
      this.messages.set(seed.threadId, history);
      if (seed.readMinutesAgo !== undefined) {
        this.readOn.set(seed.threadId, minutesAgo(seed.readMinutesAgo));
      }
    }
  }

  private nameOf(acsUserId: string): string {
    return this.displayNames[acsUserId] ?? acsUserId;
  }

  private toChatMessage(threadId: string, message: MockMessage): ChatMessage {
    return {
      id: message.id,
      type: message.type ?? "text",
      sequenceId: message.id,
      version: message.id,
      createdOn: minutesAgo(message.minutesAgo),
      content: { message: message.text },
      sender: { kind: "communicationUser", communicationUserId: message.from },
      senderDisplayName: this.nameOf(message.from),
    } as ChatMessage;
  }

  /** Everything below is what the hook actually calls. */

  getChatThreadClient(threadId: string) {
    return {
      listMessages: (options?: { maxPageSize?: number }) =>
        paged(this.messages.get(threadId) ?? [], options?.maxPageSize),
      listReadReceipts: (options?: { maxPageSize?: number }) => {
        const readOn = this.readOn.get(threadId);
        const receipts: ChatMessageReadReceipt[] = readOn
          ? [
              {
                sender: { kind: "communicationUser", communicationUserId: this.acsUserId },
                chatMessageId: "read-marker",
                readOn,
              } as ChatMessageReadReceipt,
            ]
          : [];
        return paged(receipts, options?.maxPageSize);
      },
    };
  }

  async startRealtimeNotifications(): Promise<void> {}

  async stopRealtimeNotifications(): Promise<void> {}

  on(_event: "chatMessageReceived", listener: Listener): void {
    this.listeners.add(listener);
  }

  off(_event: "chatMessageReceived", listener: Listener): void {
    this.listeners.delete(listener);
  }

  /** Demo-only: push a message into a thread as if it arrived over the wire. */
  send(threadId: string, from: string, text: string): void {
    const id = String(this.nextId++);
    const createdOn = new Date();
    const event = {
      id,
      threadId,
      message: text,
      type: "text",
      createdOn,
      sender: { kind: "communicationUser", communicationUserId: from },
      senderDisplayName: this.nameOf(from),
      recipient: { kind: "communicationUser", communicationUserId: this.acsUserId },
      version: id,
      metadata: {},
    } as unknown as ChatMessageReceivedEvent;

    const history = this.messages.get(threadId) ?? [];
    this.messages.set(threadId, [this.toChatMessage(threadId, { id, minutesAgo: 0, from, text }), ...history]);
    for (const listener of this.listeners) listener(event);
  }

  /** Demo-only: history for the fake chat pane, oldest first. */
  history(threadId: string): ChatMessage[] {
    return [...(this.messages.get(threadId) ?? [])].reverse();
  }

  asChatClient(): ChatClient {
    return this as unknown as ChatClient;
  }
}
