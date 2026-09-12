import type { ChatMessageReceivedEvent } from "@azure/communication-chat";
import type { AcsInboxMessage, AcsThread } from "./types.js";

export function cx(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(" ");
}

/**
 * Both message shapes carry their text in a different place: history messages
 * nest it under `content.message`, realtime events put it on `message`.
 */
export function getMessagePreview(message?: AcsInboxMessage): string {
  if (!message) return "";

  if ("content" in message) {
    const text = stripHtml(message.content?.message);
    if (text) return text;
    return message.content?.attachments?.length ? "Attachment" : "";
  }

  const event = message as ChatMessageReceivedEvent;
  const text = stripHtml(event.message);
  if (text) return text;
  return event.attachments?.length ? "Attachment" : "";
}

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

/**
 * Messages of type `html` carry markup. The preview is rendered as plain text,
 * so the tags are dropped here rather than trusted to `dangerouslySetInnerHTML`.
 */
export function stripHtml(html?: string): string {
  if (!html) return "";
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z]+;|&#\d+;/gi, (entity) => HTML_ENTITIES[entity.toLowerCase()] ?? " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isFromUser(message: AcsInboxMessage | undefined, acsUserId: string): boolean {
  return (
    message?.sender?.kind === "communicationUser" &&
    message.sender.communicationUserId === acsUserId
  );
}

export function getThreadTitle(thread: AcsThread): string {
  if (thread.title) return thread.title;
  const participant = thread.participants?.[0];
  return participant?.displayName ?? "Unknown";
}

export function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/**
 * A dependency-free relative time. Consumers who want their own wording or
 * locale pass `formatTime` instead.
 */
export function formatRelativeTime(date: Date, now = Date.now()): string {
  const elapsed = now - date.getTime();
  if (elapsed < MINUTE) return "now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;
  if (elapsed < WEEK) return `${Math.floor(elapsed / DAY)}d`;
  return date.toLocaleDateString();
}

export function getMessageTime(message?: AcsInboxMessage): Date | undefined {
  return message?.createdOn;
}
