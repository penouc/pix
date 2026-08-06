import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import type { SessionSummary } from '@pi-desktop/protocol';

import { companionClient, loadSavedCode, loadSavedHost } from './lib/client';
import { useCompanionStore } from './stores/companion-store';

type Screen = 'connect' | 'sessions' | 'chat';

export function App() {
  const [screen, setScreen] = useState<Screen>('connect');
  const connected = useCompanionStore((s) => s.connected);
  const setConnected = useCompanionStore((s) => s.setConnected);
  const applyEvent = useCompanionStore((s) => s.applyEvent);
  const loadSessions = useCompanionStore((s) => s.loadSessions);
  const clearSession = useCompanionStore((s) => s.clearSession);

  useEffect(() => {
    const offEvent = companionClient.onEvent(applyEvent);
    const offStatus = companionClient.onStatus(setConnected);
    return () => {
      offEvent();
      offStatus();
    };
  }, [applyEvent, setConnected]);

  useEffect(() => {
    if (connected) {
      void loadSessions()
        .then(() => setScreen('sessions'))
        .catch(() => undefined);
    }
  }, [connected, loadSessions]);

  if (screen === 'connect' || !connected) {
    return (
      <div className="app">
        <ConnectScreen
          onConnected={() => {
            setScreen('sessions');
          }}
        />
      </div>
    );
  }

  if (screen === 'chat') {
    return (
      <div className="app">
        <ChatScreen
          onBack={() => {
            clearSession();
            setScreen('sessions');
            void loadSessions();
          }}
        />
      </div>
    );
  }

  return (
    <div className="app">
      <SessionsScreen
        onOpen={() => setScreen('chat')}
        onDisconnect={() => {
          companionClient.disconnect();
          clearSession();
          setScreen('connect');
        }}
      />
    </div>
  );
}

function ConnectScreen({ onConnected }: { onConnected: () => void }) {
  const [host, setHost] = useState(loadSavedHost);
  const [code, setCode] = useState(loadSavedCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setStoreError = useCompanionStore((s) => s.setError);

  async function connect(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await companionClient.connect(host.trim(), code.trim());
      setStoreError(null);
      onConnected();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <div className="brand">PiX</div>
      <p className="lede">
        Pair with the desktop companion host to follow runs, send follow-ups, and approve tools from
        your phone.
      </p>
      <form onSubmit={(e) => void connect(e)}>
        <div className="field">
          <label htmlFor="host">Host</label>
          <input
            id="host"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="192.168.1.10:7847"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>
        <div className="field">
          <label htmlFor="code">Pairing code</label>
          <input
            id="code"
            className="code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="••••••"
          />
        </div>
        {error ? <p className="error">{error}</p> : null}
        <div style={{ height: 12 }} />
        <button className="btn btn-primary" type="submit" disabled={busy || code.length < 4}>
          {busy ? 'Connecting…' : 'Connect'}
        </button>
      </form>
    </div>
  );
}

function SessionsScreen({
  onOpen,
  onDisconnect,
}: {
  onOpen: () => void;
  onDisconnect: () => void;
}) {
  const sessions = useCompanionStore((s) => s.sessions);
  const loadSessions = useCompanionStore((s) => s.loadSessions);
  const openSession = useCompanionStore((s) => s.openSession);
  const connected = useCompanionStore((s) => s.connected);
  const [busyId, setBusyId] = useState<string | null>(null);

  const sorted = useMemo(
    () => [...sessions].sort((a, b) => b.updatedAt - a.updatedAt),
    [sessions],
  );

  async function open(session: SessionSummary) {
    setBusyId(session.id);
    try {
      await openSession(session.id);
      onOpen();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="screen">
      <div className="topbar">
        <span className={`dot ${connected ? 'on' : ''}`} />
        <h1>Sessions</h1>
        <button className="btn btn-ghost" type="button" onClick={() => void loadSessions()}>
          Refresh
        </button>
        <button className="btn btn-ghost" type="button" onClick={onDisconnect}>
          Disconnect
        </button>
      </div>
      <div className="list">
        {sorted.length === 0 ? (
          <div className="empty">No sessions yet. Start one on the desktop.</div>
        ) : (
          sorted.map((session) => (
            <button
              key={session.id}
              type="button"
              className="session-card"
              disabled={busyId === session.id}
              onClick={() => void open(session)}
            >
              <strong>{session.title || 'Untitled task'}</strong>
              <span>{formatRelative(session.updatedAt)}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function ChatScreen({ onBack }: { onBack: () => void }) {
  const thread = useCompanionStore((s) => s.thread);
  const sessions = useCompanionStore((s) => s.sessions);
  const activeSessionId = useCompanionStore((s) => s.activeSessionId);
  const approval = useCompanionStore((s) => s.approval);
  const status = useCompanionStore((s) => s.status);
  const error = useCompanionStore((s) => s.error);
  const sendMessage = useCompanionStore((s) => s.sendMessage);
  const resolveApproval = useCompanionStore((s) => s.resolveApproval);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const items = thread();

  const title =
    sessions.find((s) => s.id === activeSessionId)?.title ??
    (activeSessionId ? 'Task' : 'Chat');

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [items.length, approval?.requestId, status]);

  async function onSend() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setDraft('');
    try {
      await sendMessage(text);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="screen">
      <div className="topbar">
        <button className="btn btn-ghost" type="button" onClick={onBack}>
          Back
        </button>
        <h1>{title}</h1>
        <span className={`dot ${status === 'idle' ? '' : 'on'}`} />
      </div>

      <div className="thread" ref={scroller}>
        {items.length === 0 ? <div className="empty">No messages yet.</div> : null}
        {items.map((item) => {
          if (item.kind === 'message') {
            return (
              <div key={`m-${item.data.id}`} className={`bubble ${item.data.role}`}>
                {item.data.content}
                {item.data.streaming ? '▍' : ''}
              </div>
            );
          }
          if (item.kind === 'thinking') {
            return (
              <div key={`th-${item.data.id}`} className="thinking">
                {item.data.content}
                {item.data.streaming ? '…' : ''}
              </div>
            );
          }
          return (
            <div key={`t-${item.data.id}`} className="tool">
              <div className="name">
                {item.data.toolName} · {item.data.status}
              </div>
              <div className="meta">{item.data.inputSummary}</div>
              {item.data.outputSummary ? (
                <div className="meta">{item.data.outputSummary}</div>
              ) : null}
            </div>
          );
        })}
      </div>

      {error ? <p className="error">{error}</p> : null}

      {approval ? (
        <div className="approval">
          <div className="approval-card">
            <h2>Approval · {approval.riskLevel}</h2>
            <p>
              {approval.toolName}: {approval.summary}
              {approval.command ? `\n$ ${approval.command}` : ''}
            </p>
            <div className="approval-actions">
              <button
                className="btn btn-ok"
                type="button"
                onClick={() => void resolveApproval('allow-once')}
              >
                Allow once
              </button>
              <button
                className="btn btn-danger"
                type="button"
                onClick={() => void resolveApproval('deny')}
              >
                Deny
              </button>
              <button
                className="btn btn-ok"
                type="button"
                onClick={() => void resolveApproval('allow-session')}
              >
                Allow session
              </button>
              <button
                className="btn btn-ok"
                type="button"
                onClick={() => void resolveApproval('allow-project')}
              >
                Allow project
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="composer">
          <textarea
            value={draft}
            rows={1}
            placeholder={status === 'running' ? 'Follow up…' : 'Message…'}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void onSend();
              }
            }}
          />
          <button
            className="send"
            type="button"
            disabled={!draft.trim() || sending}
            onClick={() => void onSend()}
          >
            ↑
          </button>
        </div>
      )}
    </div>
  );
}

function formatRelative(ts: number): string {
  const delta = Date.now() - ts;
  const minutes = Math.round(delta / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
