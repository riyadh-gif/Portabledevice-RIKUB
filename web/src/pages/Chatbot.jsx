import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, PanelLeft, Plus, Trash2, Send, SlidersHorizontal,
  User, Leaf, Bug, Droplets, ThermometerSun, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { sendChatMessage, analyzeParameters } from '@/api';

const LS_KEY = 'jp-chat-sessions';
const SUGGESTIONS = [
  { Icon: Leaf, text: 'Kenapa daun padi menguning?' },
  { Icon: Bug, text: 'Cara atasi hama wereng?' },
  { Icon: Droplets, text: 'Jadwal pemupukan yang tepat?' },
  { Icon: ThermometerSun, text: 'pH tanah ideal untuk padi?' },
];

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
const newSession = () => ({ id: uid(), title: 'Percakapan baru', messages: [] });

function loadSessions() {
  try {
    const r = JSON.parse(localStorage.getItem(LS_KEY));
    if (Array.isArray(r) && r.length) return r;
  } catch { /* ignore */ }
  return null;
}

function Avatar({ who }) {
  return who === 'user' ? (
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"><User className="h-4 w-4" /></span>
  ) : (
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-leaf/15 text-base">🌾</span>
  );
}

export function Chatbot() {
  const navigate = useNavigate();
  const initial = useMemo(() => loadSessions() || [newSession()], []);
  const [sessions, setSessions] = useState(initial);
  const [activeId, setActiveId] = useState(initial[0].id);
  const [input, setInput] = useState('');
  const [sideOpen, setSideOpen] = useState(true);
  const [showParam, setShowParam] = useState(false);
  const [param, setParam] = useState({ gejala: '', suhu: 28, kelembapan: 70, ph: 6.5 });
  const scrollRef = useRef(null);
  const taRef = useRef(null);

  const active = sessions.find((s) => s.id === activeId) || sessions[0];
  const messages = active.messages;
  const empty = messages.length === 0;

  useEffect(() => { localStorage.setItem(LS_KEY, JSON.stringify(sessions)); }, [sessions]);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages]);

  function setMsgs(fn) {
    setSessions((prev) => prev.map((s) => {
      if (s.id !== activeId) return s;
      const msgs = fn(s.messages);
      const firstUser = msgs.find((m) => m.sender === 'user');
      return { ...s, messages: msgs, title: firstUser ? firstUser.text.slice(0, 36) : 'Percakapan baru' };
    }));
  }

  function newChat() { const s = newSession(); setSessions((p) => [s, ...p]); setActiveId(s.id); }
  function del(id, e) {
    e?.stopPropagation();
    setSessions((p) => {
      const n = p.filter((x) => x.id !== id);
      if (n.length === 0) { const s = newSession(); setActiveId(s.id); return [s]; }
      if (id === activeId) setActiveId(n[0].id);
      return n;
    });
  }

  async function send(text) {
    const msg = (text ?? input).trim();
    if (!msg) return;
    setMsgs((m) => [...m, { sender: 'user', text: msg }, { sender: 'bot', text: '…', pending: true }]);
    setInput('');
    if (taRef.current) taRef.current.style.height = 'auto';
    try {
      const r = await sendChatMessage(msg);
      const reply = r.response || r.message || JSON.stringify(r);
      setMsgs((m) => [...m.filter((x) => !x.pending), { sender: 'bot', text: reply }]);
    } catch (err) {
      setMsgs((m) => [...m.filter((x) => !x.pending), { sender: 'bot', text: `⚠️ ${err.message}` }]);
    }
  }

  async function runParam() {
    const summary = `📊 Analisis parameter — suhu ${param.suhu}°C, kelembapan ${param.kelembapan}%, pH ${param.ph}${param.gejala ? `, gejala: ${param.gejala}` : ''}`;
    setShowParam(false);
    setMsgs((m) => [...m, { sender: 'user', text: summary }, { sender: 'bot', text: '…', pending: true }]);
    try {
      const r = await analyzeParameters({
        gejala: param.gejala.trim() || 'Tidak ada gejala khusus',
        suhu: parseFloat(param.suhu), kelembapan: parseInt(param.kelembapan, 10), ph: parseFloat(param.ph),
      });
      const recs = Array.isArray(r.recommendations) ? r.recommendations : [];
      const text = `🔍 Analisis:\n${r.analysis || 'Tidak ada analisis'}\n\n💡 Rekomendasi:\n${recs.length ? recs.map((x) => `• ${x}`).join('\n') : '• Tidak ada rekomendasi khusus'}`;
      setMsgs((m) => [...m.filter((x) => !x.pending), { sender: 'bot', text }]);
    } catch (err) {
      setMsgs((m) => [...m.filter((x) => !x.pending), { sender: 'bot', text: `⚠️ ${err.message}` }]);
    }
  }

  function onKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }
  function grow(e) {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
  }
  const setP = (k) => (e) => setParam((p) => ({ ...p, [k]: e.target.value }));
  const field = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';

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
                    <button key={i} onClick={() => send(s.text)}
                      className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left text-sm shadow-[0_0_0.5px_rgba(0,0,0,0.14),0_1px_1px_rgba(0,0,0,0.24)] transition-all hover:-translate-y-0.5 hover:border-leaf/40 active:scale-[0.99]">
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
                    <div className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${m.sender === 'user' ? 'bg-leaf text-white' : 'border border-border bg-card text-foreground'} ${m.pending ? 'animate-pulse' : ''}`}>{m.text}</div>
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
                <div className="flex items-end"><Button className="w-full" onClick={runParam}>Analisis</Button></div>
              </div>
            </div>
          )}

          {/* Composer */}
          <div className="mt-3 flex items-end gap-2 rounded-2xl border border-input bg-card p-2 shadow-[0_0_0.5px_rgba(0,0,0,0.14),0_1px_1px_rgba(0,0,0,0.24)] focus-within:ring-2 focus-within:ring-ring">
            <Button variant="ghost" size="icon" className="shrink-0 rounded-full text-leaf" onClick={() => setShowParam((v) => !v)} aria-label="Analisis parameter" title="Analisis parameter"><SlidersHorizontal className="h-4 w-4" /></Button>
            <textarea ref={taRef} rows={1} value={input} onChange={grow} onKeyDown={onKey}
              placeholder="Tanya tentang penyakit, perawatan, atau kondisi sawah…"
              className="max-h-[140px] flex-1 resize-none bg-transparent px-1 py-2 text-sm outline-none" />
            <Button size="icon" className="shrink-0 rounded-full" disabled={!input.trim()} onClick={() => send()}><Send className="h-4 w-4" /></Button>
          </div>
          <p className="mt-1.5 text-center text-[11px] text-muted-foreground/70">Enter kirim · Shift+Enter baris baru · ⚙ Analisis parameter</p>
        </div>
      </div>
    </div>
  );
}
