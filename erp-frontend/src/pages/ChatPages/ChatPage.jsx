import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { MessagesSquare, Send, Hash, Ship, Users, Loader2, Pencil, Trash2, Check, X, UserPlus, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import toast from "react-hot-toast";
import { useChatStore } from "@/store/chatStore";
import { useAuthStore } from "@/store/authStore";
import * as chatService from "@/services/chatService";
import { onSocket, emitSocket } from "@/lib/socket";

const channelIcon = (type) =>
  type === "shipment" ? <Ship className="w-4 h-4" /> : type === "department" ? <Users className="w-4 h-4" /> :
  type === "direct" ? <MessageCircle className="w-4 h-4" /> : <Hash className="w-4 h-4" />;

const uuid = () =>
  crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const EDIT_WINDOW_MS = 15 * 60 * 1000;

const channelLabel = (c) => (c.type === "direct" ? "Direct message" : c.name || c.type);

/**
 * Internal Chat (CRM_MASTER §5.14) — inter-department communication with edit,
 * soft-delete, typing indicators and 1:1 direct messages. REST loads truth; the
 * socket layer pushes live updates (ADR-007).
 */
const ChatPage = () => {
  const location = useLocation();
  const { channels, activeChannelId, messages, loading, fetchChannels, openChannel, addIncoming, editMessage, deleteMessage, startDirect } = useChatStore();
  const userId = useAuthStore((s) => s.user?.id);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState("");
  const [typingNames, setTypingNames] = useState([]);
  const [dmOpen, setDmOpen] = useState(false);
  const scrollRef = useRef(null);
  const typingTimers = useRef({});

  useEffect(() => { fetchChannels(); }, [fetchChannels]);

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
    if (activeChannelId) emitSocket("room:join", { type: "channel", id: activeChannelId });
    setTypingNames([]);
    setEditingId(null);
  }, [activeChannelId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, typingNames]);

  const active = channels.find((c) => c.id === activeChannelId);
  const readOnly = active?.readOnly; // set by backend for cancelled/closed shipments

  const onDraftChange = (e) => {
    setDraft(e.target.value);
    if (activeChannelId) emitSocket("chat:typing", { channelId: activeChannelId });
  };

  const send = async (e) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body || !activeChannelId) return;
    setSending(true);
    setDraft("");
    try {
      const res = await chatService.sendMessage(activeChannelId, { clientMessageId: uuid(), body });
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
    <div className="flex flex-col h-[calc(100vh-7rem)]">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10 text-primary"><MessagesSquare className="w-5 h-5" /></div>
          <div>
            <h1 className="text-xl leading-none font-semibold">Chat</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Department, shipment, direct & general channels</p>
          </div>
        </div>
        <Button size="sm" variant="outline" className="gap-2" onClick={() => setDmOpen(true)}><UserPlus className="w-4 h-4" /> New DM</Button>
      </div>

      <div className="flex-1 grid grid-cols-1 md:grid-cols-[16rem_1fr] gap-4 min-h-0">
        {/* Channel list */}
        <div className="border rounded-xl bg-white dark:bg-zinc-900 shadow-sm overflow-y-auto">
          {channels.length === 0 && <p className="p-4 text-sm text-muted-foreground">No channels yet.</p>}
          {channels.map((c) => (
            <button key={c.id} onClick={() => openChannel(c.id)}
              className={`w-full flex items-center gap-2 px-3 py-2.5 text-sm border-b text-left transition-colors ${c.id === activeChannelId ? "bg-primary/10 text-primary" : "hover:bg-muted"}`}>
              {channelIcon(c.type)}
              <span className="flex-1 truncate">{channelLabel(c)}</span>
              {c.unread > 0 && <Badge className="h-5 min-w-5 px-1.5 text-[10px]">{c.unread}</Badge>}
            </button>
          ))}
        </div>

        {/* Messages */}
        <div className="border rounded-xl bg-white dark:bg-zinc-900 shadow-sm flex flex-col min-h-0">
          <div className="px-4 py-3 border-b flex items-center gap-2">
            {active && channelIcon(active.type)}
            <span className="font-medium text-sm">{active ? channelLabel(active) : "Select a channel"}</span>
            {readOnly && <Badge variant="outline" className="text-[10px] text-muted-foreground">read-only</Badge>}
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
            {loading && <div className="flex justify-center py-6 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>}
            {!loading && messages.length === 0 && <p className="text-center text-sm text-muted-foreground py-6">No messages yet — say hello.</p>}
            {messages.map((m) => {
              const mine = m.senderId === userId;
              const editable = mine && !m.deletedAt && Date.now() - new Date(m.createdAt).getTime() < EDIT_WINDOW_MS;
              return (
                <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"} group`}>
                  <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${mine ? "bg-primary text-white" : "bg-muted"}`}>
                    {!mine && <p className="text-[11px] font-semibold opacity-70 mb-0.5">{m.senderName}</p>}
                    {editingId === m.id ? (
                      <div className="flex items-center gap-1">
                        <Input value={editDraft} onChange={(e) => setEditDraft(e.target.value)} autoFocus
                          className="h-7 text-sm text-foreground"
                          onKeyDown={(e) => { if (e.key === "Enter") saveEdit(m.id); if (e.key === "Escape") setEditingId(null); }} />
                        <button onClick={() => saveEdit(m.id)} className="p-1"><Check className="w-3.5 h-3.5" /></button>
                        <button onClick={() => setEditingId(null)} className="p-1"><X className="w-3.5 h-3.5" /></button>
                      </div>
                    ) : (
                      <p className="whitespace-pre-wrap break-words">
                        {m.deletedAt ? <em className="opacity-60">(deleted)</em> : m.body}
                        {m.editedAt && !m.deletedAt && <span className="text-[9px] opacity-60"> (edited)</span>}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`text-[10px] ${mine ? "text-white/70" : "text-muted-foreground"}`}>{new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                      {editable && editingId !== m.id && (
                        <span className="opacity-0 group-hover:opacity-100 transition flex items-center gap-1">
                          <button onClick={() => { setEditingId(m.id); setEditDraft(m.body); }} title="Edit"><Pencil className="w-3 h-3" /></button>
                          <button onClick={() => remove(m.id)} title="Delete"><Trash2 className="w-3 h-3" /></button>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {typingNames.length > 0 && (
              <p className="text-[11px] text-muted-foreground italic">{typingNames.join(", ")} {typingNames.length === 1 ? "is" : "are"} typing…</p>
            )}
          </div>

          <form onSubmit={send} className="p-3 border-t flex items-center gap-2">
            <Input value={draft} onChange={onDraftChange}
              placeholder={!active ? "Select a channel" : readOnly ? "This channel is read-only" : "Type a message…"}
              disabled={!active || sending || readOnly} />
            <Button type="submit" size="icon" disabled={!active || sending || readOnly || !draft.trim()}>
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </form>
        </div>
      </div>

      {dmOpen && <NewDmDialog onClose={() => setDmOpen(false)} onStart={async (uid) => { await startDirect(uid); setDmOpen(false); }} />}
    </div>
  );
};

const NewDmDialog = ({ onClose, onStart }) => {
  const [colleagues, setColleagues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    chatService.listColleagues()
      .then((res) => setColleagues(res.data ?? []))
      .catch((err) => toast.error(err?.message || "Failed to load colleagues"))
      .finally(() => setLoading(false));
  }, []);

  const filtered = colleagues.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Start a direct message</DialogTitle></DialogHeader>
        <Input placeholder="Search colleagues…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <div className="max-h-72 overflow-y-auto -mx-1 mt-2">
          {loading && <div className="flex justify-center py-6 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>}
          {!loading && filtered.map((c) => (
            <button key={c.id} onClick={() => onStart(c.id)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md hover:bg-muted text-sm text-left">
              <span>{c.name}</span>
              <Badge variant="secondary" className="text-[10px]">{c.role}</Badge>
            </button>
          ))}
          {!loading && filtered.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No colleagues found.</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ChatPage;
