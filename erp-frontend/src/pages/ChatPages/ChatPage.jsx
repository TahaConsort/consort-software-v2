import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  MessagesSquare,
  Send,
  Hash,
  Ship,
  Users,
  Pencil,
  Trash2,
  Check,
  X,
  UserPlus,
  MessageCircle,
  Search,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardBody,
  EmptyState,
  IconButton,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalHeader,
  Skeleton,
  Spinner,
  Textarea,
  Tooltip,
} from "@neuctra/ui";
import toast from "react-hot-toast";
import { useChatStore } from "@/store/chatStore";
import { useAuthStore } from "@/store/authStore";
import * as chatService from "@/services/chatService";
import { onSocket, emitSocket } from "@/lib/socket";

/** One 36px baseline across the toolbar, as on the leads and queries screens. */
const ACTION_BTN = "h-9 px-3";
const CHIP = "shrink-0 whitespace-nowrap border text-xs";
const NEUTRAL_CHIP = "border-border bg-muted text-muted-foreground";

const channelIcon = (type) =>
  type === "shipment" ? (
    <Ship className="h-4 w-4" />
  ) : type === "department" ? (
    <Users className="h-4 w-4" />
  ) : type === "direct" ? (
    <MessageCircle className="h-4 w-4" />
  ) : (
    <Hash className="h-4 w-4" />
  );

const uuid = () =>
  crypto?.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const EDIT_WINDOW_MS = 15 * 60 * 1000;

const channelLabel = (c) =>
  c.type === "direct" ? "Direct message" : c.name || c.type;

const fmtTime = (d) =>
  new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * Internal Chat (CRM_MASTER §5.14) — inter-department communication with edit,
 * soft-delete, typing indicators and 1:1 direct messages. REST loads truth; the
 * socket layer pushes live updates (ADR-007).
 */
const ChatPage = () => {
  const location = useLocation();
  const {
    channels,
    activeChannelId,
    messages,
    loading,
    fetchChannels,
    openChannel,
    addIncoming,
    editMessage,
    deleteMessage,
    startDirect,
  } = useChatStore();
  const userId = useAuthStore((s) => s.user?.id);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState("");
  const [typingNames, setTypingNames] = useState([]);
  const [dmOpen, setDmOpen] = useState(false);
  const scrollRef = useRef(null);
  const typingTimers = useRef({});
  const [now, setNow] = useState(() => Date.now());

  // The edit affordance expires on its own after EDIT_WINDOW_MS. A ticking clock in
  // state both keeps Date.now() out of render and makes the button actually vanish
  // when the window closes, rather than at whatever re-render happens next.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  useEffect(() => {
    if (activeChannelId) return;
    const target = location.state?.channelId;
    if (target) openChannel(target);
    else if (channels.length) openChannel(channels[0].id);
  }, [channels, activeChannelId, location.state, openChannel]);

  useEffect(() => {
    const off = onSocket("chat:message", (msg) => addIncoming(msg));
    return () => off();
  }, [addIncoming]);

  // Typing indicator (server broadcasts chat:typing to the channel room).
  useEffect(() => {
    const off = onSocket("chat:typing", (p) => {
      if (p?.channelId !== activeChannelId || p?.userId === userId) return;
      const name = p.userName || "Someone";
      setTypingNames((prev) => (prev.includes(name) ? prev : [...prev, name]));
      clearTimeout(typingTimers.current[name]);
      typingTimers.current[name] = setTimeout(() => {
        setTypingNames((prev) => prev.filter((n) => n !== name));
      }, 3000);
    });
    return () => off();
  }, [activeChannelId, userId]);

  useEffect(() => {
    if (activeChannelId)
      emitSocket("room:join", { type: "channel", id: activeChannelId });
  }, [activeChannelId]);

  // Switching channel clears the per-channel view state. Adjusting it here rather
  // than in an effect means the new channel never paints with the old one’s
  // "typing…" line or a half-finished edit still open.
  const [viewedChannelId, setViewedChannelId] = useState(activeChannelId);
  if (viewedChannelId !== activeChannelId) {
    setViewedChannelId(activeChannelId);
    setTypingNames([]);
    setEditingId(null);
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, typingNames]);

  const active = channels.find((c) => c.id === activeChannelId);
  const readOnly = active?.readOnly; // set by backend for cancelled/closed shipments

  const onDraftChange = (e) => {
    setDraft(e.target.value);
    if (activeChannelId) emitSocket("chat:typing", { channelId: activeChannelId });
  };

  const send = async () => {
    const body = draft.trim();
    if (!body || !activeChannelId || sending || readOnly) return;
    setSending(true);
    setDraft("");
    try {
      const res = await chatService.sendMessage(activeChannelId, {
        clientMessageId: uuid(),
        body,
      });
      addIncoming(res.data);
    } catch (err) {
      toast.error(err?.message || "Failed to send");
      setDraft(body);
    } finally {
      setSending(false);
    }
  };

  const saveEdit = async (id) => {
    const body = editDraft.trim();
    if (!body) return;
    try {
      await editMessage(id, body);
      setEditingId(null);
    } catch (err) {
      toast.error(err?.message || "Could not edit");
    }
  };

  const remove = async (id) => {
    try {
      await deleteMessage(id);
    } catch (err) {
      toast.error(err?.message || "Could not delete");
    }
  };

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
            <MessagesSquare className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold leading-none text-foreground">
              Chat
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Department, shipment, direct and general channels
            </p>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          className={ACTION_BTN}
          onClick={() => setDmOpen(true)}
          iconBefore={<UserPlus className="h-4 w-4" />}
        >
          New DM
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-[16rem_1fr]">
        {/* Channel list */}
        <Card padding="none" className="flex min-h-0 flex-col overflow-hidden">
          <CardBody className="min-h-0 flex-1 overflow-y-auto p-0">
            {channels.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">
                No channels yet.
              </p>
            )}
            {channels.map((c) => {
              const isActive = c.id === activeChannelId;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => openChannel(c.id)}
                  aria-current={isActive ? "true" : undefined}
                  className={`flex w-full items-center gap-2 border-b border-border px-3 py-2.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-foreground hover:bg-accent"
                  }`}
                >
                  {channelIcon(c.type)}
                  <span className="min-w-0 flex-1 truncate">
                    {channelLabel(c)}
                  </span>
                  {c.unread > 0 && (
                    <Badge
                      size="sm"
                      text={String(c.unread)}
                      className="shrink-0"
                    />
                  )}
                </button>
              );
            })}
          </CardBody>
        </Card>

        {/* Messages */}
        <Card padding="none" className="flex min-h-0 flex-col overflow-hidden">
          <CardBody className="flex min-h-0 flex-1 flex-col p-0">
            <div className="flex items-center gap-2 border-b border-border bg-accent px-4 py-3">
              {active && channelIcon(active.type)}
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                {active ? channelLabel(active) : "Select a channel"}
              </span>
              {readOnly && (
                <Badge
                  variant="outline"
                  size="sm"
                  text="read only"
                  className={`${CHIP} ${NEUTRAL_CHIP}`}
                />
              )}
            </div>

            <div
              ref={scrollRef}
              className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4"
            >
              {loading && (
                <div className="space-y-3">
                  {Array.from({ length: 4 }, (_, i) => (
                    <Skeleton key={i} variant="rectangular" height={40} />
                  ))}
                  <span className="sr-only">Loading messages…</span>
                </div>
              )}

              {!loading && messages.length === 0 && (
                <EmptyState
                  size="sm"
                  icon={<MessagesSquare />}
                  title="No messages yet"
                  description="Say hello to get the thread started."
                  className="py-10"
                />
              )}

              {messages.map((m) => {
                const mine = m.senderId === userId;
                const editable =
                  mine &&
                  !m.deletedAt &&
                  now - new Date(m.createdAt).getTime() < EDIT_WINDOW_MS;
                return (
                  <div
                    key={m.id}
                    className={`group flex ${mine ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                        mine
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-foreground"
                      }`}
                    >
                      {!mine && (
                        <p className="mb-0.5 text-[11px] font-semibold opacity-70">
                          {m.senderName}
                        </p>
                      )}

                      {editingId === m.id ? (
                        <div className="flex items-start gap-1">
                          {/* Textarea, not Input: Neuctra's Input takes no onKeyDown,
                              so Enter-to-save and Escape-to-cancel need this one. */}
                          <Textarea
                            value={editDraft}
                            onChange={(e) => setEditDraft(e.target.value)}
                            minRows={1}
                            maxRows={4}
                            containerClassName="min-w-40 flex-1"
                            className="px-2 py-1 text-sm text-foreground"
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                saveEdit(m.id);
                              }
                              if (e.key === "Escape") setEditingId(null);
                            }}
                          />
                          <IconButton
                            variant="ghost"
                            size="xs"
                            aria-label="Save edit"
                            onClick={() => saveEdit(m.id)}
                            icon={<Check className="h-3.5 w-3.5" />}
                          />
                          <IconButton
                            variant="ghost"
                            size="xs"
                            aria-label="Cancel edit"
                            onClick={() => setEditingId(null)}
                            icon={<X className="h-3.5 w-3.5" />}
                          />
                        </div>
                      ) : (
                        <p className="whitespace-pre-wrap wrap-break-word">
                          {m.deletedAt ? (
                            <em className="opacity-60">(deleted)</em>
                          ) : (
                            m.body
                          )}
                          {m.editedAt && !m.deletedAt && (
                            <span className="text-[9px] opacity-60">
                              {" "}
                              (edited)
                            </span>
                          )}
                        </p>
                      )}

                      <div className="mt-0.5 flex items-center gap-2">
                        <span
                          className={`text-[10px] ${mine ? "text-primary-foreground/70" : "text-muted-foreground"}`}
                        >
                          {fmtTime(m.createdAt)}
                        </span>
                        {editable && editingId !== m.id && (
                          <span className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                            <Tooltip content="Edit">
                              <button
                                type="button"
                                aria-label="Edit message"
                                onClick={() => {
                                  setEditingId(m.id);
                                  setEditDraft(m.body);
                                }}
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                            </Tooltip>
                            <Tooltip content="Delete">
                              <button
                                type="button"
                                aria-label="Delete message"
                                onClick={() => remove(m.id)}
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </Tooltip>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {typingNames.length > 0 && (
                <p className="text-[11px] italic text-muted-foreground">
                  {typingNames.join(", ")}{" "}
                  {typingNames.length === 1 ? "is" : "are"} typing…
                </p>
              )}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
              className="flex items-end gap-2 border-t border-border p-3"
            >
              {/* `submitOnEnter` sends on Enter and keeps Shift+Enter for a newline;
                  it is dropped the moment an onKeyDown of our own is passed, because
                  the component spreads the rest of its props after its own handler. */}
              <Textarea
                value={draft}
                onChange={onDraftChange}
                submitOnEnter
                onSubmit={send}
                minRows={1}
                maxRows={4}
                containerClassName="min-w-0 flex-1"
                placeholder={
                  !active
                    ? "Select a channel"
                    : readOnly
                      ? "This channel is read-only"
                      : "Type a message…"
                }
                disabled={!active || sending || readOnly}
              />
              {/* `size="md"` is size-10 (40px), but the Textarea resolves to 44px at
                  minRows={1} — a 20px line over its py-3 — so the two never sat flush.
                  size-11 matches that exactly; it overrides the preset cleanly because
                  IconButton merges the consumer className last through tailwind-merge,
                  and `rounded-lg` from the same preset survives. Paired with items-end
                  on the form, the button stays beside the last line as the box grows
                  instead of drifting to the middle of it. */}
              <IconButton
                type="submit"
                aria-label="Send message"
                className="size-11 shrink-0"
                size="md"
                disabled={!active || sending || readOnly || !draft.trim()}
                icon={
                  sending ? (
                    <Spinner size="xs" label="Sending" />
                  ) : (
                    <Send />
                  )
                }
              />
            </form>
          </CardBody>
        </Card>
      </div>

      {dmOpen && (
        <NewDmModal
          onClose={() => setDmOpen(false)}
          onStart={async (uid) => {
            await startDirect(uid);
            setDmOpen(false);
          }}
        />
      )}
    </div>
  );
};

const NewDmModal = ({ onClose, onStart }) => {
  // null means "not answered yet", which is what drives the skeleton. Deriving it
  // beats a second loading flag that an effect would have to set on the way in.
  const [colleagues, setColleagues] = useState(null);
  const [q, setQ] = useState("");
  const loading = colleagues === null;

  useEffect(() => {
    let alive = true;
    chatService
      .listColleagues()
      .then((res) => {
        if (alive) setColleagues(res.data ?? []);
      })
      .catch((err) => {
        if (!alive) return;
        setColleagues([]);
        toast.error(err?.message || "Failed to load colleagues");
      });
    return () => {
      alive = false;
    };
  }, []);

  const filtered = (colleagues ?? []).filter((c) =>
    c.name.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <Modal isOpen onClose={onClose}>
      <ModalContent maxWidth="max-w-md" onClose={onClose}>
        <ModalHeader title="Start a direct message" onClose={onClose} />
        <ModalBody>
          <Input
            placeholder="Search colleagues…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            prefixIcon={Search}
          />

          <div className="mt-3 max-h-72 overflow-y-auto">
            {loading && (
              <div className="space-y-2 py-2">
                {Array.from({ length: 4 }, (_, i) => (
                  <Skeleton key={i} variant="rectangular" height={32} />
                ))}
                <span className="sr-only">Loading colleagues…</span>
              </div>
            )}

            {!loading &&
              filtered.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onStart(c.id)}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <span className="min-w-0 truncate">{c.name}</span>
                  <Badge
                    variant="soft"
                    size="sm"
                    text={c.role}
                    className={`${CHIP} ${NEUTRAL_CHIP}`}
                  />
                </button>
              ))}

            {!loading && filtered.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No colleagues found.
              </p>
            )}
          </div>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
};

export default ChatPage;
