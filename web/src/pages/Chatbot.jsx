import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, PanelLeft, Plus, Trash2, Send, SlidersHorizontal,
  User, Leaf, Bug, Droplets, ThermometerSun, X, Loader2, Square,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  sendChatMessage, analyzeParameters,
  listChatSessions, createChatSession, addChatMessage, deleteChatSession,
} from '@/api';

const SUGGESTIONS = [
  { Icon: Leaf, text: 'Kenapa daun padi menguning?' },
  { Icon: Bug, text: 'Cara atasi hama wereng?' },
  { Icon: Droplets, text: 'Jadwal pemupukan yang tepat?' },
  { Icon: ThermometerSun, text: 'pH tanah ideal untuk padi?' },
];
// Gemma runs swap-backed on an 8GB Jetson: a single answer routinely takes
// 1.5-3 min, so past this point we reassure the user the wait is expected.
const SLOW_HINT_SECONDS = 90;

function fromServer(session) {
  return {
    id: session.id,
    title: session.title,
    messages: (session.messages || []).map((m) => ({
      sender: m.sender,
      text: m.text,
      error: m.is_error,
    })),
  };
}

// Best-effort, optional. The sibling health endpoint may not exist yet, so any
// 404/network failure is treated as "status unknown" rather than an error.
async function checkHealth() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch('/api/chat/health', { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function describeError(err) {
  if (err?.timeout) return '⏱️ Waktu tunggu habis (hingga 3 menit). Model mungkin masih sibuk — coba kirim lagi.';
  const health = await checkHealth();
  if (health && health.reachable === false) {
    return '🔌 Server AI (Jetson) tidak terjangkau saat ini. Periksa koneksi lalu coba lagi.';
  }
  return `⚠️ ${err?.message || 'Terjadi kesalahan.'}`;
}

function Avatar({ who }) {
  return who === 'user' ? (
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"><User className="h-4 w-4" /></span>
  ) : (
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-leaf/15 text-base">🌾</span>
  );
}

function PendingBubble({ elapsed, onCancel }) {
  return (
    <div className="max-w-[80%] rounded-2xl border border-border bg-card px-4 py-2.5 text-sm leading-relaxed text-foreground">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-leaf" />
        <span>Sedang berpikir… {elapsed} detik</span>
        <button onClick={onCancel} className="ml-1 text-xs font-medium text-destructive hover:underline">Batalkan</button>
      </div>
      {elapsed >= SLOW_HINT_SECONDS && (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground/80">
          Masih diproses — model AI berjalan di perangkat dengan memori terbatas, wajar hingga 3 menit. Mohon tunggu.
        </p>
      )}
    </div>
  );
}

export function Chatbot() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [input, setInput] = useState('');
  const [sideOpen, setSideOpen] = useState(true);
  const [showParam, setShowParam] = useState(false);
  const [param, setParam] = useState({ gejala: '', suhu: 28, kelembapan: 70, ph: 6.5 });
  const [sending, setSending] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const scrollRef = useRef(null);
  const taRef = useRef(null);
  const abortRef = useRef(null);
  const pendingSessionIdRef = useRef(null);

  const active = sessions.find((s) => s.id === activeId);
  const messages = active?.messages ?? [];
  const empty = messages.length === 0;

  // Sessions persist server-side (Postgres) rather than browser localStorage:
  // WebKitGTK inside the pywebview kiosk does not reliably keep localStorage
  // across process restarts, so history vanished every time the window closed.
  useEffect(() => {
    (async () => {
      try {
        let list = await listChatSessions();
        if (list.length === 0) list = [await createChatSession()];
        setSessions(list.map(fromServer));
        setActiveId(list[0].id);
      } catch {
        const fallback = { id: `local-${Date.now()}`, title: 'Percakapan baru', messages: [] };
        setSessions([fallback]);
        setActiveId(fallback.id);
      } finally {
        setLoadingSessions(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (sessions.length && !sessions.some((s) => s.id === activeId)) setActiveId(sessions[0].id);
  }, [sessions, activeId]);

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages]);

  useEffect(() => {
    if (!sending) { setElapsed(0); return; }
    setElapsed(0);
    const start = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, [sending]);

  function setMsgsFor(sessionId, fn) {
    setSessions((prev) => prev.map((s) => {
      if (s.id !== sessionId) return s;
      const msgs = fn(s.messages);
      const firstUser = msgs.find((m) => m.sender === 'user');
      const title = s.title === 'Percakapan baru' && firstUser ? firstUser.text.slice(0, 36) : s.title;
      return { ...s, messages: msgs, title };
    }));
  }

  async function newChat() {
    const created = await createChatSession();
    setSessions((p) => [fromServer(created), ...p]);
    setActiveId(created.id);
  }

  async function del(id, e) {
    e?.stopPropagation();
    deleteChatSession(id).catch(() => {});
    const remaining = sessions.filter((x) => x.id !== id);
    if (remaining.length === 0) {
      const created = await createChatSession();
      setSessions([fromServer(created)]);
      setActiveId(created.id);
      return;
    }
    setSessions(remaining);
    if (id === activeId) setActiveId(remaining[0].id);
  }

  function cancel() { abortRef.current?.abort(); }

  async function send(text) {
    if (sending) return;
    const msg = (text ?? input).trim();
    if (!msg) return;
    const sid = activeId;
    const ac = new AbortController();
    abortRef.current = ac;
    pendingSessionIdRef.current = sid;
    setSending(true);
    setMsgsFor(sid, (m) => [...m, { sender: 'user', text: msg }, { sender: 'bot', pending: true }]);
    setInput('');
    if (taRef.current) taRef.current.style.height = 'auto';
    // Persist the question before the (1.5-3 min) Gemma call, so it survives
    // even if the kiosk window is closed/restarted while still waiting.
    addChatMessage(sid, { sender: 'user', text: msg }).catch(() => {});
    try {
      const r = await sendChatMessage(msg, { signal: ac.signal });
      const reply = r.response || r.message || JSON.stringify(r);
      setMsgsFor(sid, (m) => [...m.filter((x) => !x.pending), { sender: 'bot', text: reply }]);
      addChatMessage(sid, { sender: 'bot', text: reply }).catch(() => {});
    } catch (err) {
      const isCancel = err.name === 'AbortError';
      const body = isCancel ? 'Dibatalkan oleh pengguna.' : await describeError(err);
      setMsgsFor(sid, (m) => [...m.filter((x) => !x.pending), { sender: 'bot', text: body, error: !isCancel }]);
      if (!isCancel) addChatMessage(sid, { sender: 'bot', text: body, isError: true }).catch(() => {});
    } finally {
      setSending(false);
      abortRef.current = null;
      pendingSessionIdRef.current = null;
    }
  }

  async function runParam() {
    if (sending) return;
    const sid = activeId;
    const summary = `📊 Analisis parameter — suhu ${param.suhu}°C, kelembapan ${param.kelembapan}%, pH ${param.ph}${param.gejala ? `, gejala: ${param.gejala}` : ''}`;
    const ac = new AbortController();
    abortRef.current = ac;
    pendingSessionIdRef.current = sid;
    setSending(true);
    setShowParam(false);
    setMsgsFor(sid, (m) => [...m, { sender: 'user', text: summary }, { sender: 'bot', pending: true }]);
    addChatMessage(sid, { sender: 'user', text: summary }).catch(() => {});
    try {
      const r = await analyzeParameters({
        gejala: param.gejala.trim() || 'Tidak ada gejala khusus',
        suhu: parseFloat(param.suhu), kelembapan: parseInt(param.kelembapan, 10), ph: parseFloat(param.ph),
      }, { signal: ac.signal });
      const recs = Array.isArray(r.recommendations) ? r.recommendations : [];
      const text = `🔍 Analisis:\n${r.analysis || 'Tidak ada analisis'}\n\n💡 Rekomendasi:\n${recs.length ? recs.map((x) => `• ${x}`).join('\n') : '• Tidak ada rekomendasi khusus'}`;
      setMsgsFor(sid, (m) => [...m.filter((x) => !x.pending), { sender: 'bot', text }]);
      addChatMessage(sid, { sender: 'bot', text }).catch(() => {});
    } catch (err) {
      const isCancel = err.name === 'AbortError';
      const body = isCancel ? 'Dibatalkan oleh pengguna.' : await describeError(err);
      setMsgsFor(sid, (m) => [...m.filter((x) => !x.pending), { sender: 'bot', text: body, error: !isCancel }]);
      if (!isCancel) addChatMessage(sid, { sender: 'bot', text: body, isError: true }).catch(() => {});
    } finally {
      setSending(false);
      abortRef.current = null;
      pendingSessionIdRef.current = null;
    }
  }

  function onKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!sending) send(); } }
  function grow(e) {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
  }
  const setP = (k) => (e) => setParam((p) => ({ ...p, [k]: e.target.value }));
  const field = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';

  if (loadingSessions || !active) {
    return (
      <div className="grid h-full place-items-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-leaf" />
      </div>
    );
  }

  return (
    <div className="flex h-full bg-background">
      {/* Sidebar */}
      {sideOpen && (
        <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-card/60 p-3">
          <Button className="mb-3 w-full justify-start" onClick={newChat}><Plus className="h-4 w-4" /> Chat Baru</Button>
          <div className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Riwayat</div>
          <div className="-mr-1 flex-1 space-y-1 overflow-y-auto pr-1">
            {sessions.map((s) => (
              <button key={s.id} onClick={() => setActiveId(s.id)}
                className={`group flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${s.id === activeId ? 'bg-leaf/12 text-forest' : 'hover:bg-muted text-foreground'}`}>
                <span className="flex-1 truncate">{s.title}</span>
                {s.id === pendingSessionIdRef.current && sending && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-leaf" />}
                <span onClick={(e) => del(s.id, e)} className="opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"><Trash2 className="h-3.5 w-3.5" /></span>
              </button>
            ))}
          </div>
        </aside>
      )}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col px-[clamp(16px,3vw,40px)] py-5">
        <header className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => setSideOpen((v) => !v)} aria-label="Toggle sidebar"><PanelLeft className="h-4 w-4" /></Button>
            <Button variant="outline" size="sm" onClick={() => navigate('/menu')}><ArrowLeft className="h-4 w-4" /> Menu</Button>
          </div>
          <div className="flex items-center gap-2"><span className="text-base">🌾</span><span className="font-bold tracking-tight text-forest">Chatbot AI</span></div>
        </header>

        <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
            {empty ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <span className="mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-leaf/15 text-3xl">🌾</span>
                <h2 className="text-2xl font-bold text-forest">Ada yang bisa saya bantu?</h2>
                <p className="mt-1 text-sm text-muted-foreground">Asisten AI untuk pertanian padi — tanya atau analisis parameter.</p>
                <div className="mt-7 grid w-full max-w-xl grid-cols-1 gap-3 sm:grid-cols-2">
                  {SUGGESTIONS.map((s, i) => (
                    <button key={i} onClick={() => send(s.text)} disabled={sending}
                      className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left text-sm shadow-[0_0_0.5px_rgba(0,0,0,0.14),0_1px_1px_rgba(0,0,0,0.24)] transition-all hover:-translate-y-0.5 hover:border-leaf/40 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50">
                      <s.Icon className="h-4 w-4 shrink-0 text-leaf" /><span className="text-foreground">{s.text}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-5 py-2">
                {messages.map((m, i) => (
                  <div key={i} className={`flex items-start gap-3 ${m.sender === 'user' ? 'flex-row-reverse' : ''}`}>
                    <Avatar who={m.sender} />
                    {m.pending ? (
                      <PendingBubble elapsed={elapsed} onCancel={cancel} />
                    ) : (
                      <div className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${m.sender === 'user' ? 'bg-leaf text-white' : m.error ? 'border border-destructive/40 bg-destructive/5 text-foreground' : 'border border-border bg-card text-foreground'}`}>{m.text}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Parameter tool panel */}
          {showParam && (
            <div className="mt-3 rounded-2xl border border-border bg-card p-4 shadow-[0_0_0.5px_rgba(0,0,0,0.14),0_1px_1px_rgba(0,0,0,0.24)]">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-bold text-forest">📊 Analisis Parameter Sawah</span>
                <button onClick={() => setShowParam(false)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="col-span-2 grid gap-1 text-xs font-medium">🌾 Gejala
                  <input className={field} placeholder="Contoh: Daun menguning, bercak coklat" value={param.gejala} onChange={setP('gejala')} /></label>
                <label className="grid gap-1 text-xs font-medium">🌡️ Suhu (°C)
                  <input className={field} type="number" step="0.5" value={param.suhu} onChange={setP('suhu')} /></label>
                <label className="grid gap-1 text-xs font-medium">💧 Kelembapan (%)
                  <input className={field} type="number" value={param.kelembapan} onChange={setP('kelembapan')} /></label>
                <label className="grid gap-1 text-xs font-medium">⚗️ pH Tanah
                  <input className={field} type="number" step="0.1" value={param.ph} onChange={setP('ph')} /></label>
                <div className="flex items-end"><Button className="w-full" onClick={runParam} disabled={sending}>Analisis</Button></div>
              </div>
            </div>
          )}

          {/* Composer */}
          <div className="mt-3 flex items-end gap-2 rounded-2xl border border-input bg-card p-2 shadow-[0_0_0.5px_rgba(0,0,0,0.14),0_1px_1px_rgba(0,0,0,0.24)] focus-within:ring-2 focus-within:ring-ring">
            <Button variant="ghost" size="icon" className="shrink-0 rounded-full text-leaf" onClick={() => setShowParam((v) => !v)} aria-label="Analisis parameter" title="Analisis parameter"><SlidersHorizontal className="h-4 w-4" /></Button>
            <textarea ref={taRef} rows={1} value={input} onChange={grow} onKeyDown={onKey}
              placeholder={sending ? 'Menunggu jawaban sebelumnya…' : 'Tanya tentang penyakit, perawatan, atau kondisi sawah…'}
              className="max-h-[140px] flex-1 resize-none bg-transparent px-1 py-2 text-sm outline-none" />
            {sending ? (
              <Button size="icon" variant="outline" className="shrink-0 rounded-full border-destructive/40 text-destructive hover:bg-destructive/10" onClick={cancel} aria-label="Batalkan" title="Batalkan permintaan"><Square className="h-4 w-4" /></Button>
            ) : (
              <Button size="icon" className="shrink-0 rounded-full" disabled={!input.trim()} onClick={() => send()} aria-label="Kirim"><Send className="h-4 w-4" /></Button>
            )}
          </div>
          <p className="mt-1.5 text-center text-[11px] text-muted-foreground/70">
            {sending
              ? 'Menunggu jawaban sebelumnya… hanya satu permintaan diproses dalam satu waktu.'
              : 'Enter kirim · Shift+Enter baris baru · ⚙ Analisis parameter'}
          </p>
        </div>
      </div>
    </div>
  );
}
