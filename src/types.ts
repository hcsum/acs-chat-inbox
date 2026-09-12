import type { ChatMessage, ChatMessageReceivedEvent } from "@azure/communication-chat";

/** A message as it reaches the inbox: either fetched from history or pushed over realtime. */
export type AcsInboxMessage = ChatMessage | ChatMessageReceivedEvent;

export type AcsThreadParticipant = {
  /** The participant's ACS user id (`communicationUserId`). */
  acsUserId: string;
  displayName?: string;
  avatarUrl?: string;
};

/**
 * The minimum a thread needs to be listed. Consumers keep their own thread type
 * and map it into this shape; anything extra stays on their side.
 */
export type AcsThread = {
  id: string;
  title?: string;
  participants?: AcsThreadParticipant[];
};

/** Unread messages and the latest message the inbox knows about for one thread. */
export type AcsThreadState = {
  unreadCount: number;
  unreadMessages: AcsInboxMessage[];
  latestMessage?: AcsInboxMessage;
  latestMessagePreview: string;
  latestMessageFromMe: boolean;
};

/** State passed to `renderThreadItem` so a custom item can render without recomputing. */
export type AcsThreadItemState = AcsThreadState & {
  selected: boolean;
};

export type AcsChatInboxClassNames = {
  root?: string;
  sidebar?: string;
  sidebarHeader?: string;
  threadList?: string;
  threadItem?: string;
  activeThreadItem?: string;
  chat?: string;
  chatBody?: string;
  back?: string;
  empty?: string;
};
