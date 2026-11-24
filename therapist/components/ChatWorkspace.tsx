'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { chatPage, chatThreads, markChatRead, sendChat } from '@/lib/actions';
import { dayKey, fmtShortDate, fmtStamp, fmtTime } from '@/lib/format';
import type { ChatMessage, ChatThreadPage, ChatThreadSummary } from '@/lib/types';
import { useChatSocket, type ChatSocketEvent } from '@/lib/use-chat-socket';

const MAX_BODY = 2000;
type Local = ChatMessage & { pending?: boolean; failed?: boolean };

const newClientId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `c${Date.now()}${Math.random().toString(36).slice(2)}`);

/** Adds or replaces messages by id or clientId, keeping chronological order. */
function merge(list: Local[], incoming: Local[]): Local[] {
  const out = [...list];
  for (const m of incoming) {
    const i = out.findIndex((x) => x.id === m.id || (!!m.clientId && x.clientId === m.clientId));
    if (i >= 0) out[i] = m; else out.push(m);
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function ChatWorkspace({ initialThreads, initialPage }: { initialThreads: ChatThreadSummary[]; initialPage: ChatThreadPage | null }) {
  const [threads, setThreads] = useState(initialThreads);
  const [activeId, setActiveId] = useState<string | null>(initialPage?.thread.id ?? null);
  const [page, setPage] = useState<ChatThreadPage | null>(initialPage);
  const [messages, setMessages] = useState<Local[]>(initialPage?.messages ?? []);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [typingUntil, setTypingUntil] = useState(0);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const activeRef = useRef(activeId);
  useEffect(() => { activeRef.current = activeId; }, [activeId]);

  const refreshThreads = useCallback(async () => {
    const res = await chatThreads();
    if (res.ok) setThreads(res.data);
  }, []);

  const markRead = useCallback(async (id: string) => {
    await markChatRead(id);
    setThreads((ts) => ts.map((t) => (t.id === id ? { ...t, unread: 0, urgent: false } : t)));
  }, []);

  const open = useCallback(async (id: string) => {
    setActiveId(id);
    setError('');
    stickToBottom.current = true;
    window.history.replaceState(null, '', `/messages?t=${encodeURIComponent(id)}`);
    const res = await chatPage(id);
    if (!res.ok) { setError(res.error); return; }
    if (activeRef.current !== id) return;
    setPage(res.data);
    setMessages(res.data.messages);
    void markRead(id);
  }, [markRead]);

  const onEvent = useCallback((e: ChatSocketEvent) => {
    if (e.type === 'message') {
      if (e.threadId === activeRef.current) {
        setMessages((ms) => merge(ms, [e.message]));
        if (e.message.from === 'STUDENT') { setTypingUntil(0); void markRead(e.threadId); }
      }
      void refreshThreads();
    } else if (e.type === 'read' && e.threadId === activeRef.current) {
      setPage((p) => (p ? { ...p, thread: { ...p.thread, otherLastReadAt: e.at } } : p));
    } else if (e.type === 'typing' && e.threadId === activeRef.current) {
      setTypingUntil(Date.now() + 4000);
      setNow(Date.now());
    } else if (e.type === 'thread') {
      void refreshThreads();
    }
  }, [markRead, refreshThreads]);

  const onReconnect = useCallback(() => {
    void refreshThreads();
    if (activeRef.current) void open(activeRef.current);
  }, [open, refreshThreads]);

  const { state, send: sendSocket } = useChatSocket(onEvent, onReconnect);

  // Initial page load marks the opened thread as read.
  useEffect(() => { if (initialPage) void markRead(initialPage.thread.id); }, [initialPage, markRead]);

  // Clear the typing hint once it lapses.
  useEffect(() => {
    if (typingUntil <= now) return;
    const t = setTimeout(() => setNow(Date.now()), typingUntil - now + 50);
    return () => clearTimeout(t);
  }, [typingUntil, now]);

  useEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, activeId]);

  async function deliver(m: Local) {
    const res = await sendChat(m.threadId, m.body, m.clientId!);
    if (res.ok) {
      setMessages((ms) => merge(ms, [res.data.message]));
      void refreshThreads();
    } else {
      setMessages((ms) => ms.map((x) => (x.clientId === m.clientId ? { ...x, pending: false, failed: true } : x)));
      setError(res.error);
    }
  }

  function submit() {
    const body = draft.trim();
    if (!body || !activeId) return;
    if (body.length > MAX_BODY) { setError(`Keep messages under ${MAX_BODY} characters.`); return; }
    const local: Local = { id: `local-${newClientId()}`, threadId: activeId, from: 'THERAPIST', body, clientId: newClientId(), createdAt: new Date().toISOString(), pending: true };
    setError('');
    setDraft('');
    stickToBottom.current = true;
    setMessages((ms) => merge(ms, [local]));
    void deliver(local);
  }

  function retry(m: Local) {
    const again = { ...m, pending: true, failed: false };
    setMessages((ms) => merge(ms, [again]));
    void deliver(again);
  }

  async function loadOlder() {
    if (!activeId || !messages.length) return;
    setLoadingOlder(true);
    stickToBottom.current = false;
    const res = await chatPage(activeId, messages[0].createdAt);
    setLoadingOlder(false);
    if (!res.ok) { setError(res.error); return; }
    setMessages((ms) => merge(ms, res.data.messages));
    setPage((p) => (p ? { ...p, hasMore: res.data.hasMore } : p));
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); return; }
    if (activeId) sendSocket({ type: 'typing', threadId: activeId });
  }

  const active = threads.find((t) => t.id === activeId);
  const lastMine = [...messages].reverse().find((m) => m.from === 'THERAPIST' && !m.pending && !m.failed);
  // "Seen" sits under the conversation, so only show it when the newest message is ours.
  const seen = !!(lastMine && messages[messages.length - 1] === lastMine && page?.thread.otherLastReadAt && page.thread.otherLastReadAt >= lastMine.createdAt);
  const typing = typingUntil > now;

  return (
    <div className={`chat ${activeId ? 'has-active' : ''}`}>
      <aside className="chat-list card" aria-label="Conversations">
        <div className="card-head" style={{ marginBottom: 6 }}>
          <h2 className="section-title">Conversations</h2>
          <span className={`live-dot ${state}`} title={state === 'live' ? 'Live' : state === 'connecting' ? 'Connecting' : 'Reconnecting'}>
            {state === 'live' ? 'Live' : state === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
          </span>
        </div>
        {threads.length === 0 ? (
          <p className="sublabel">No conversations yet. Start one from a session or a request with “Message student”.</p>
        ) : (
          <ul className="thread-list">
            {threads.map((t) => (
              <li key={t.id}>
                <button type="button" className="thread" aria-current={t.id === activeId ? 'true' : undefined} onClick={() => void open(t.id)}>
                  <span className="thread-top">
                    <strong>{t.title}</strong>
                    {t.lastMessageAt && <time dateTime={t.lastMessageAt}>{dayKey(t.lastMessageAt) === dayKey(new Date()) ? fmtTime(t.lastMessageAt) : fmtShortDate(t.lastMessageAt)}</time>}
                  </span>
                  <span className="thread-bottom">
                    <span className="thread-preview">
                      {t.lastMessage ? `${t.lastMessage.from === 'THERAPIST' ? 'You: ' : ''}${t.lastMessage.body}` : t.subtitle ?? 'No messages yet'}
                    </span>
                    {t.urgent && <span className="chip alert" style={{ padding: '0 8px' }}>Urgent</span>}
                    {t.unread > 0 && <span className="count-badge" aria-label={`${t.unread} unread`}>{t.unread}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="chat-pane card" aria-label="Conversation">
        {!activeId || !page ? (
          <div className="empty" style={{ margin: 'auto' }}>
            <strong>Select a conversation</strong>
            <p className="sublabel">Messages are private between you and the student, and encrypted at rest.</p>
          </div>
        ) : (
          <>
            <header className="chat-head">
              <button type="button" className="btn ghost small chat-back" onClick={() => { setActiveId(null); window.history.replaceState(null, '', '/messages'); }}>← All</button>
              <div>
                <h2 className="section-title">{page.thread.title}</h2>
                {page.thread.subtitle && <p className="sublabel">{page.thread.subtitle}</p>}
              </div>
            </header>
            {(active?.urgent || messages.some((m) => m.flagged)) && (
              <div className="urgent-banner" role="alert">
                <strong>This student may be at risk.</strong> A message below matched a crisis phrase. Reply now, and follow the counselling cell&apos;s crisis protocol if you can&apos;t reach them. The student was shown emergency helplines.
              </div>
            )}
            <div className="chat-scroll" ref={scroller} onScroll={(e) => {
              const el = e.currentTarget;
              stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
            }}>
              {page.hasMore && (
                <button type="button" className="btn ghost small" style={{ alignSelf: 'center' }} disabled={loadingOlder} onClick={() => void loadOlder()}>
                  {loadingOlder ? 'Loading…' : 'Load earlier messages'}
                </button>
              )}
              {messages.length === 0 && <p className="sublabel" style={{ textAlign: 'center', marginTop: 24 }}>No messages yet. Say hello.</p>}
              {messages.map((m, i) => {
                const prev = messages[i - 1];
                const newDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);
                return (
                  <div key={m.clientId ?? m.id} className="msg-wrap">
                    {newDay && <div className="day-sep">{fmtShortDate(m.createdAt)}</div>}
                    <div className={`msg ${m.from === 'THERAPIST' ? 'mine' : 'theirs'}${m.flagged ? ' flagged' : ''}${m.failed ? ' failed' : ''}`}>
                      <p>{m.body}</p>
                      <span className="msg-meta">
                        {m.pending ? 'Sending…' : m.failed ? (
                          <button type="button" className="link-btn" onClick={() => retry(m)}>Not sent · Retry</button>
                        ) : fmtTime(m.createdAt)}
                        {m.flagged && ' · flagged'}
                      </span>
                    </div>
                  </div>
                );
              })}
              <div className="chat-status" aria-live="polite">
                {typing ? 'Typing…' : seen && lastMine ? `Seen · ${fmtStamp(page.thread.otherLastReadAt!)}` : ''}
              </div>
            </div>
            <form className="composer" onSubmit={(e) => { e.preventDefault(); submit(); }}>
              <label htmlFor="chat-input" className="sr-only">Message</label>
              <textarea
                id="chat-input"
                className="textarea"
                rows={2}
                maxLength={MAX_BODY}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKey}
                placeholder="Write a message. Enter to send, Shift+Enter for a new line."
              />
              <button type="submit" className="btn" disabled={!draft.trim()}>Send</button>
            </form>
            <p className="form-error" role="alert" style={{ padding: '0 14px 8px' }}>{error}</p>
          </>
        )}
      </section>
    </div>
  );
}
