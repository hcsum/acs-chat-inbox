import { describe, expect, it } from "vitest";
import type { ChatMessage, ChatMessageReceivedEvent } from "@azure/communication-chat";
import {
  formatRelativeTime,
  getInitials,
  getMessagePreview,
  getThreadTitle,
  isFromUser,
  stripHtml,
} from "./utils.js";

function historyMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "1",
    type: "text",
    sequenceId: "1",
    version: "1",
    createdOn: new Date("2026-01-01T00:00:00Z"),
    content: { message: "hello" },
    ...overrides,
  };
}

describe("stripHtml", () => {
  it("returns an empty string for no input", () => {
    expect(stripHtml()).toBe("");
    expect(stripHtml("")).toBe("");
  });

  it("drops tags and collapses the whitespace they leave behind", () => {
    expect(stripHtml("<p>hello</p><p>world</p>")).toBe("hello world");
  });

  it("decodes the named entities it knows and blanks the ones it does not", () => {
    expect(stripHtml("a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39;")).toBe(
      `a & b <c> "d" 'e'`,
    );
    expect(stripHtml("a&hellip;b")).toBe("a b");
  });

  it("does not leave markup behind for a preview to render", () => {
    expect(stripHtml('<img src=x onerror="alert(1)">hi')).toBe("hi");
  });
});

describe("getMessagePreview", () => {
  it("is empty without a message", () => {
    expect(getMessagePreview()).toBe("");
  });

  it("reads history messages from content.message", () => {
    expect(getMessagePreview(historyMessage({ content: { message: "<b>hi</b>" } }))).toBe(
      "hi",
    );
  });

  it("reads realtime events from message", () => {
    const event = { id: "2", message: "<i>yo</i>" } as ChatMessageReceivedEvent;
    expect(getMessagePreview(event)).toBe("yo");
  });

  it("falls back to Attachment when there is no text on either shape", () => {
    expect(
      getMessagePreview(
        historyMessage({
          content: { message: "", attachments: [{ id: "a" }] },
        } as Partial<ChatMessage>),
      ),
    ).toBe("Attachment");

    const event = {
      id: "3",
      message: "",
      attachments: [{ id: "a" }],
    } as unknown as ChatMessageReceivedEvent;
    expect(getMessagePreview(event)).toBe("Attachment");
  });

  it("is empty for a message with neither text nor attachments", () => {
    expect(getMessagePreview(historyMessage({ content: { message: "" } }))).toBe("");
  });
});

describe("isFromUser", () => {
  const sender = { kind: "communicationUser", communicationUserId: "me" } as const;

  it("matches only the signed-in communication user", () => {
    expect(isFromUser(historyMessage({ sender }), "me")).toBe(true);
    expect(isFromUser(historyMessage({ sender }), "someone-else")).toBe(false);
    expect(isFromUser(undefined, "me")).toBe(false);
  });

  it("ignores non-user senders such as bots or phone numbers", () => {
    const bot = { kind: "microsoftBot", botId: "me" } as unknown as ChatMessage["sender"];
    expect(isFromUser(historyMessage({ sender: bot }), "me")).toBe(false);
  });
});

describe("getThreadTitle", () => {
  it("prefers the explicit title", () => {
    expect(
      getThreadTitle({
        id: "t",
        title: "Support",
        participants: [{ acsUserId: "u", displayName: "Ada" }],
      }),
    ).toBe("Support");
  });

  it("falls back to the first participant, then to Unknown", () => {
    expect(
      getThreadTitle({ id: "t", participants: [{ acsUserId: "u", displayName: "Ada" }] }),
    ).toBe("Ada");
    expect(getThreadTitle({ id: "t" })).toBe("Unknown");
    expect(getThreadTitle({ id: "t", participants: [{ acsUserId: "u" }] })).toBe("Unknown");
  });
});

describe("getInitials", () => {
  it("takes the first letter of the first two words, uppercased", () => {
    expect(getInitials("ada lovelace")).toBe("AL");
    expect(getInitials("Grace Brewster Murray Hopper")).toBe("GB");
    expect(getInitials("  spaced   out  ")).toBe("SO");
    expect(getInitials("")).toBe("");
  });
});

describe("formatRelativeTime", () => {
  const now = new Date("2026-01-10T12:00:00Z").getTime();
  const ago = (ms: number) => new Date(now - ms);

  it("counts in minutes, hours and days up to a week", () => {
    expect(formatRelativeTime(ago(30_000), now)).toBe("now");
    expect(formatRelativeTime(ago(5 * 60_000), now)).toBe("5m");
    expect(formatRelativeTime(ago(3 * 3_600_000), now)).toBe("3h");
    expect(formatRelativeTime(ago(2 * 86_400_000), now)).toBe("2d");
  });

  it("switches to a date once a week has passed", () => {
    const old = ago(8 * 86_400_000);
    expect(formatRelativeTime(old, now)).toBe(old.toLocaleDateString());
  });
});
