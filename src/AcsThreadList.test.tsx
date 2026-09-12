import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@azure/communication-chat";
import { AcsThreadList } from "./AcsThreadList.js";
import type { AcsThread, AcsThreadState } from "./types.js";

// Vitest runs without globals, so testing-library's auto-cleanup never registers.
afterEach(cleanup);

const EMPTY: AcsThreadState = {
  unreadCount: 0,
  unreadMessages: [],
  latestMessagePreview: "",
  latestMessageFromMe: false,
};

function message(text: string, createdOn = new Date("2026-01-01T00:00:00Z")): ChatMessage {
  return { id: "1", type: "text", createdOn, content: { message: text } } as ChatMessage;
}

function state(overrides: Partial<AcsThreadState>): AcsThreadState {
  return { ...EMPTY, ...overrides };
}

const threads: AcsThread[] = [
  { id: "a", title: "Ada Lovelace" },
  { id: "b", participants: [{ acsUserId: "u", displayName: "Grace Hopper" }] },
];

function renderList(props: Partial<React.ComponentProps<typeof AcsThreadList>> = {}) {
  const onThreadSelect = vi.fn();
  const result = render(
    <AcsThreadList
      threads={threads}
      onThreadSelect={onThreadSelect}
      getThreadState={() => EMPTY}
      {...props}
    />,
  );
  return { ...result, onThreadSelect };
}

describe("AcsThreadList", () => {
  it("titles each thread, falling back to the first participant", () => {
    renderList();
    expect(screen.getByText("Ada Lovelace")).toBeDefined();
    expect(screen.getByText("Grace Hopper")).toBeDefined();
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("hands the whole thread back on click", () => {
    const { onThreadSelect } = renderList();
    fireEvent.click(screen.getByText("Ada Lovelace"));
    expect(onThreadSelect).toHaveBeenCalledWith(threads[0]);
  });

  it("marks the selected thread and hides its unread badge", () => {
    renderList({
      selectedThreadId: "a",
      getThreadState: () => state({ unreadCount: 3 }),
    });
    const [first, second] = screen.getAllByRole("button");
    expect(first?.dataset.state).toBe("selected");
    expect(first?.dataset.unread).toBe("false");
    expect(within(first!).queryByText("3")).toBeNull();
    expect(second?.dataset.unread).toBe("true");
    expect(within(second!).getByText("3")).toBeDefined();
  });

  it("prefixes a preview of the user's own message", () => {
    renderList({
      getThreadState: () =>
        state({
          latestMessage: message("on my way"),
          latestMessagePreview: "on my way",
          latestMessageFromMe: true,
        }),
    });
    expect(screen.getAllByText(/^You:$/)).toHaveLength(2);
  });

  it("says so when a thread has no messages", () => {
    renderList();
    expect(screen.getAllByText("No messages yet")).toHaveLength(2);
  });

  it("formats the time of the latest message with the supplied formatter", () => {
    renderList({
      formatTime: () => "yesterday",
      getThreadState: () => state({ latestMessage: message("hi") }),
    });
    expect(screen.getAllByText("yesterday")).toHaveLength(2);
  });

  it("shows an empty state only when it is not loading", () => {
    const { rerender } = render(
      <AcsThreadList threads={[]} onThreadSelect={vi.fn()} getThreadState={() => EMPTY} />,
    );
    expect(screen.getByText("No chats yet")).toBeDefined();

    rerender(
      <AcsThreadList
        threads={[]}
        loading
        onThreadSelect={vi.fn()}
        getThreadState={() => EMPTY}
      />,
    );
    expect(screen.queryByText("No chats yet")).toBeNull();
  });

  it("lets a consumer replace the header, the empty state and the item", () => {
    const { container } = render(
      <AcsThreadList
        threads={[]}
        title={null}
        onThreadSelect={vi.fn()}
        getThreadState={() => EMPTY}
        renderEmpty={() => <p>nothing here</p>}
      />,
    );
    expect(container.querySelector('[data-slot="thread-list-header"]')).toBeNull();
    expect(screen.getByText("nothing here")).toBeDefined();

    render(
      <AcsThreadList
        threads={threads}
        selectedThreadId="a"
        onThreadSelect={vi.fn()}
        getThreadState={() => state({ unreadCount: 2 })}
        renderThreadItem={(thread, itemState) => (
          <span>{`${thread.id}:${itemState.unreadCount}:${String(itemState.selected)}`}</span>
        )}
      />,
    );
    expect(screen.getByText("a:2:true")).toBeDefined();
    expect(screen.getByText("b:2:false")).toBeDefined();
  });

  it("applies consumer class names alongside its own", () => {
    const { container } = renderList({
      selectedThreadId: "a",
      classNames: {
        sidebar: "my-sidebar",
        threadItem: "my-item",
        activeThreadItem: "my-item-active",
      },
    });
    expect(container.querySelector(".acs-inbox-sidebar.my-sidebar")).toBeDefined();
    const selected = container.querySelector('[data-state="selected"]');
    expect(selected?.className).toContain("my-item");
    expect(selected?.className).toContain("my-item-active");
  });
});
