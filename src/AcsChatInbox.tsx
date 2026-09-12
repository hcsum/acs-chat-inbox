import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  CommunicationTokenCredential,
  CommunicationUserIdentifier,
} from "@azure/communication-common";
import type { ChatClient } from "@azure/communication-chat";
import type { ChatAdapter, ChatCompositeProps } from "@azure/communication-react";
import {
  ChatComposite,
  useAzureCommunicationChatAdapter,
} from "@azure/communication-react";
import { AcsThreadList } from "./AcsThreadList.js";
import { useAcsChatInbox } from "./useAcsChatInbox.js";
import type { AcsChatInboxClassNames, AcsThread, AcsThreadItemState } from "./types.js";
import { cx } from "./utils.js";

export type AcsChatInboxProps = {
  /** ACS resource endpoint, e.g. `https://<resource>.communication.azure.com`. */
  endpoint: string;
  userId: CommunicationUserIdentifier;
  displayName: string;
  credential: CommunicationTokenCredential;
  /**
   * A connected `ChatClient`, used for unread counts and realtime previews.
   * Without it the thread list renders, but stays without previews or badges.
   */
  chatClient?: ChatClient;

  threads: AcsThread[];
  selectedThreadId?: string;
  onThreadSelect: (thread: AcsThread) => void;
  loadingThreads?: boolean;

  /** Passed through to `ChatComposite`. */
  chatOptions?: ChatCompositeProps["options"];
  /** Runs once the adapter for the selected thread exists. */
  onChatAdapterChange?: (adapter: ChatAdapter | undefined) => void;

  sidebarTitle?: ReactNode;
  /**
   * Below the narrow breakpoint only one pane is on screen, so the chat pane
   * carries a control back to the list. Set false to render your own.
   */
  showBackButton?: boolean;
  backLabel?: ReactNode;
  /** Called when the back control is used. The selection itself is untouched. */
  onBack?: () => void;
  renderThreadItem?: (thread: AcsThread, state: AcsThreadItemState) => ReactNode;
  renderEmpty?: () => ReactNode;
  /** Shown on the chat side while no thread is selected. */
  renderNoThreadSelected?: () => ReactNode;
  formatTime?: (date: Date) => string;
  classNames?: AcsChatInboxClassNames;
};

/**
 * A thread list beside `ChatComposite`, wired together: selecting a thread
 * swaps the composite's adapter and marks the thread read.
 */
export function AcsChatInbox({
  endpoint,
  userId,
  displayName,
  credential,
  chatClient,
  threads,
  selectedThreadId,
  onThreadSelect,
  loadingThreads = false,
  chatOptions,
  onChatAdapterChange,
  sidebarTitle,
  showBackButton = true,
  backLabel = "← Chats",
  onBack,
  renderThreadItem,
  renderEmpty,
  renderNoThreadSelected,
  formatTime,
  classNames,
}: AcsChatInboxProps): ReactNode {
  // Going back is a layout concern, not a selection one: `selectedThreadId` is
  // the consumer's, so the narrow layout remembers which thread it stepped out
  // of instead of asking them to clear it.
  const [dismissedThreadId, setDismissedThreadId] = useState<string | undefined>();
  const chatPaneActive =
    selectedThreadId !== undefined && selectedThreadId !== dismissedThreadId;

  const handleThreadSelect = useCallback(
    (thread: AcsThread) => {
      // Also covers re-picking the thread the user just backed out of.
      setDismissedThreadId(undefined);
      onThreadSelect(thread);
    },
    [onThreadSelect],
  );

  const handleBack = useCallback(() => {
    setDismissedThreadId(selectedThreadId);
    onBack?.();
  }, [selectedThreadId, onBack]);

  const { getThreadState } = useAcsChatInbox({
    chatClient,
    acsUserId: userId.communicationUserId,
    threads,
    selectedThreadId,
  });

  const adapter = useAzureCommunicationChatAdapter({
    endpoint,
    userId,
    displayName,
    credential,
    threadId: selectedThreadId,
  });

  // ACS's hook bails out when `threadId` is missing: it neither clears its state
  // nor disposes the adapter it already built, so after a deselect `adapter` is
  // still the previous thread's. Gate on the selection rather than on the hook.
  const activeAdapter = selectedThreadId ? adapter : undefined;

  // A consumer passing an inline arrow would otherwise fire this on every render,
  // and looping if it sets state.
  const onChatAdapterChangeRef = useRef(onChatAdapterChange);
  useEffect(() => {
    onChatAdapterChangeRef.current = onChatAdapterChange;
  });

  useEffect(() => {
    onChatAdapterChangeRef.current?.(activeAdapter);
  }, [activeAdapter]);

  return (
    <div
      data-slot="acs-chat-inbox"
      // Which pane the narrow layout shows. Always "chat" once a thread is
      // open, including while the adapter is still building.
      data-pane={chatPaneActive ? "chat" : "list"}
      className={cx("acs-inbox", classNames?.root)}
    >
      <AcsThreadList
        threads={threads}
        selectedThreadId={selectedThreadId}
        onThreadSelect={handleThreadSelect}
        getThreadState={getThreadState}
        loading={loadingThreads}
        renderThreadItem={renderThreadItem}
        renderEmpty={renderEmpty}
        formatTime={formatTime}
        classNames={classNames}
        {...(sidebarTitle !== undefined ? { title: sidebarTitle } : {})}
      />

      <div
        data-slot="chat-pane"
        data-state={activeAdapter ? "ready" : selectedThreadId ? "loading" : "empty"}
        className={cx("acs-inbox-chat", classNames?.chat)}
      >
        {showBackButton && chatPaneActive && (
          <button
            type="button"
            data-slot="chat-back"
            onClick={handleBack}
            className={cx("acs-inbox-back", classNames?.back)}
          >
            {backLabel}
          </button>
        )}

        <div
          data-slot="chat-body"
          className={cx("acs-inbox-chat-body", classNames?.chatBody)}
        >
          {activeAdapter ? (
            <ChatComposite adapter={activeAdapter} options={chatOptions} />
          ) : (
            (renderNoThreadSelected?.() ?? (
              <div
                data-slot="chat-pane-empty"
                className={cx("acs-inbox-empty", classNames?.empty)}
              >
                {selectedThreadId ? "Loading chat…" : "No chat selected"}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
