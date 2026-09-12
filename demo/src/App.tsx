import { useEffect, useMemo, useRef, useState } from "react";
import { AcsThreadList } from "../../src/AcsThreadList";
import { useAcsChatInbox } from "../../src/useAcsChatInbox";
import type { AcsThread } from "../../src/types";
import { stripHtml } from "../../src/utils";
import { MockChatClient, type MockThreadSeed } from "./mockChatClient";

const ME = "8:acs:me";

const THREADS: AcsThread[] = [
  {
    id: "thread-1",
    participants: [{ acsUserId: "8:acs:ada", displayName: "Ada Lovelace" }],
  },
  {
    id: "thread-2",
    title: "Deploy war room",
    participants: [
      { acsUserId: "8:acs:grace", displayName: "Grace Hopper" },
      { acsUserId: "8:acs:alan", displayName: "Alan Turing" },
    ],
  },
  {
    id: "thread-3",
    participants: [{ acsUserId: "8:acs:katherine", displayName: "Katherine Johnson" }],
  },
  {
    id: "thread-4",
    title: "Design review",
    participants: [{ acsUserId: "8:acs:radia", displayName: "Radia Perlman" }],
  },
  {
    id: "thread-5",
    participants: [{ acsUserId: "8:acs:barbara", displayName: "Barbara Liskov" }],
  },
];

// `readMinutesAgo` is the user's own read receipt: anything newer from someone
// else counts as unread, which is how the real hook derives the badges.
const SEEDS: MockThreadSeed[] = [
  {
    threadId: "thread-1",
    readMinutesAgo: 40,
    messages: [
      {
        id: "1",
        minutesAgo: 90,
        from: "8:acs:ada",
        text: "Did the analytical engine build pass?",
      },
      { id: "2", minutesAgo: 60, from: ME, text: "Green on the second run." },
      {
        id: "3",
        minutesAgo: 12,
        from: "8:acs:ada",
        text: "Nice. I'll cut the release note.",
      },
      {
        id: "4",
        minutesAgo: 4,
        from: "8:acs:ada",
        text: "Sent — take a look when you can.",
      },
    ],
  },
  {
    threadId: "thread-2",
    messages: [
      { id: "5", minutesAgo: 200, from: "8:acs:grace", text: "Rolling to canary now." },
      {
        id: "6",
        minutesAgo: 150,
        from: "8:acs:alan",
        // An `html` message: the preview strips the markup instead of rendering it.
        type: "html",
        text: "<p>Error rate is <strong>flat</strong> &mdash; looks clean.</p>",
      },
      { id: "7", minutesAgo: 30, from: "8:acs:grace", text: "Promoting to 100%." },
    ],
  },
  {
    threadId: "thread-3",
    readMinutesAgo: 1,
    messages: [
      { id: "8", minutesAgo: 1500, from: "8:acs:katherine", text: "Numbers check out." },
      { id: "9", minutesAgo: 1440, from: ME, text: "Thanks for double-running them." },
    ],
  },
  {
    threadId: "thread-4",
    readMinutesAgo: 5,
    messages: [
      {
        id: "10",
        minutesAgo: 4300,
        from: "8:acs:radia",
        text: "Spanning tree diagram is in the deck, last slide.",
      },
    ],
  },
  { threadId: "thread-5", messages: [] },
];

const NAMES: Record<string, string> = {
  [ME]: "You",
  ...Object.fromEntries(
    THREADS.flatMap((thread) =>
      (thread.participants ?? []).map((p) => [p.acsUserId, p.displayName ?? p.acsUserId]),
    ),
  ),
};

const SENDERS = [
  "8:acs:ada",
  "8:acs:grace",
  "8:acs:katherine",
  "8:acs:radia",
  "8:acs:barbara",
];
const LINES = [
  "Any update on this?",
  "Pushed a fix, mind reviewing?",
  "Standup moved to 10.",
  "That worked, thanks!",
  "Logs look odd around 14:02.",
];

type BadgeShape = "count" | "dot" | "square" | "outline";

export function App() {
  const client = useMemo(() => new MockChatClient(ME, SEEDS, NAMES), []);
  const chatClient = useMemo(() => client.asChatClient(), [client]);

  const [selectedThreadId, setSelectedThreadId] = useState<string>();
  const [accent, setAccent] = useState("#2563eb");
  const [sidebarWidth, setSidebarWidth] = useState(20);
  const [radius, setRadius] = useState(0.5);
  const [badge, setBadge] = useState<BadgeShape>("count");
  const [tick, setTick] = useState(0);
  // Mirrors what AcsChatInbox does internally, since the demo wires the two
  // panes together itself.
  const [dismissedThreadId, setDismissedThreadId] = useState<string>();
  const [draft, setDraft] = useState("");
  const nextLine = useRef(0);
  const messagesRef = useRef<HTMLDivElement>(null);

  const { getThreadState, totalUnreadCount, loading } = useAcsChatInbox({
    chatClient,
    acsUserId: ME,
    threads: THREADS,
    selectedThreadId,
  });

  // Redraw the fake chat pane whenever a message lands.
  useEffect(() => {
    const listener = () => setTick((value) => value + 1);
    client.on("chatMessageReceived", listener);
    return () => client.off("chatMessageReceived", listener);
  }, [client]);

  const simulateIncoming = (thread: AcsThread) => {
    const sender = thread.participants?.[0]?.acsUserId ?? SENDERS[0];
    const line = LINES[nextLine.current++ % LINES.length];
    client.send(thread.id, sender, line);
  };

  // The two branches are worth seeing separately: a message in a background
  // thread raises the badge, one in the open thread must not.
  const incomingElsewhere = () => {
    const candidates = THREADS.filter((thread) => thread.id !== selectedThreadId);
    simulateIncoming(candidates[Math.floor(Math.random() * candidates.length)]);
  };

  const incomingHere = () => {
    const thread = THREADS.find((candidate) => candidate.id === selectedThreadId);
    if (thread) simulateIncoming(thread);
  };

  const send = () => {
    if (!selectedThreadId || !draft.trim()) return;
    client.send(selectedThreadId, ME, draft.trim());
    setDraft("");
  };

  // `styles.css` sets these on `.acs-inbox` itself, so the header badge cannot
  // inherit them — both elements get the same object. Only the accent needs
  // restating: the badge rule carries its own fallbacks for everything else.
  const themeVars = {
    "--acs-inbox-accent": accent,
    "--acs-inbox-selected-bg": `${accent}14`,
    "--acs-inbox-sidebar-width": `${sidebarWidth}rem`,
    "--acs-inbox-radius": `${radius}rem`,
  } as React.CSSProperties;

  const chatPaneActive =
    selectedThreadId !== undefined && selectedThreadId !== dismissedThreadId;
  const history = selectedThreadId ? client.history(selectedThreadId) : [];
  const historyLength = history.length;

  // Keep the newest message in view, on arrival and when switching threads.
  useEffect(() => {
    const pane = messagesRef.current;
    if (pane) pane.scrollTop = pane.scrollHeight;
  }, [selectedThreadId, historyLength]);
  void tick;

  return (
    <div className="demo" style={themeVars} data-badge={badge}>
      <header className="demo-bar">
        <strong>acs-chat-inbox</strong>
        <span className="demo-total">
          {totalUnreadCount > 0 ? (
            <>
              {/* Same slot as the list's badges, so the control below restyles
                  every badge at once — which is the point of the attribute. */}
              <span data-slot="unread-badge" className="acs-inbox-unread-badge">
                {totalUnreadCount}
              </span>
              unread
            </>
          ) : (
            "All read"
          )}
        </span>
      </header>

      <p className="demo-note">
        Not connected to ACS. Message history, read receipts and realtime events come from{" "}
        <code>demo/src/mockChatClient.ts</code>. The left pane is <code>AcsThreadList</code>{" "}
        rendering state from <code>useAcsChatInbox</code>. The right pane is demo code in
        place of <code>ChatComposite</code>, which needs a live endpoint and token.
      </p>

      <div className="demo-controls">
        <button type="button" onClick={incomingElsewhere}>
          Incoming → other thread
        </button>
        <button type="button" onClick={incomingHere} disabled={!selectedThreadId}>
          Incoming → open thread
        </button>
        <label>
          Accent
          <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} />
        </label>
        <label>
          Sidebar
          <span className="demo-value">{sidebarWidth}rem</span>
          <input
            type="range"
            min={14}
            max={30}
            step={0.5}
            value={sidebarWidth}
            onChange={(e) => setSidebarWidth(Number(e.target.value))}
          />
        </label>
        <label>
          Badge
          <select value={badge} onChange={(e) => setBadge(e.target.value as BadgeShape)}>
            <option value="count">count</option>
            <option value="dot">dot</option>
            <option value="square">square</option>
            <option value="outline">outline</option>
          </select>
        </label>
        <label>
          Radius
          <span className="demo-value">{radius}rem</span>
          <input
            type="range"
            min={0}
            max={1.5}
            step={0.05}
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
          />
        </label>
      </div>

      <div
        className="acs-inbox demo-inbox"
        data-slot="acs-chat-inbox"
        data-pane={chatPaneActive ? "chat" : "list"}
        style={themeVars}
      >
        <AcsThreadList
          threads={THREADS}
          selectedThreadId={selectedThreadId}
          onThreadSelect={(thread) => {
            setDismissedThreadId(undefined);
            setSelectedThreadId(thread.id);
          }}
          getThreadState={getThreadState}
          loading={loading}
        />

        <div
          data-slot="chat-pane"
          data-state={selectedThreadId ? "ready" : "empty"}
          className="acs-inbox-chat demo-chat"
        >
          {selectedThreadId ? (
            <>
              <button
                type="button"
                data-slot="chat-back"
                className="acs-inbox-back"
                onClick={() => setDismissedThreadId(selectedThreadId)}
              >
                ← Chats
              </button>
              <div className="demo-messages" ref={messagesRef}>
                {history.length === 0 && (
                  <div className="acs-inbox-empty">No messages yet</div>
                )}
                {history.map((message) => (
                  <div
                    key={message.id}
                    className="demo-message"
                    data-own={
                      message.sender?.kind === "communicationUser" &&
                      message.sender.communicationUserId === ME
                    }
                  >
                    <span className="demo-message-sender">{message.senderDisplayName}</span>
                    <span className="demo-message-body">
                      {message.type === "html"
                        ? stripHtml(message.content?.message)
                        : message.content?.message}
                    </span>
                  </div>
                ))}
              </div>
              <form
                className="demo-composer"
                onSubmit={(event) => {
                  event.preventDefault();
                  send();
                }}
              >
                <input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Type a message"
                />
                <button type="submit">Send</button>
              </form>
            </>
          ) : (
            <div className="acs-inbox-empty">No chat selected</div>
          )}
        </div>
      </div>
    </div>
  );
}
