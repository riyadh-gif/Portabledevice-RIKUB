import { useNavigate } from 'react-router-dom';
import { MapPinned, Bot, ScanSearch, ArrowRight, Layers, Image as ImageIcon, Cpu } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const ACCENTS = {
  forest: { text: 'text-forest', chip: 'bg-forest/10 text-forest', top: 'border-t-forest' },
  leaf: { text: 'text-leaf', chip: 'bg-leaf/10 text-leaf', top: 'border-t-leaf' },
  harvest: { text: 'text-harvest', chip: 'bg-harvest/15 text-harvest', top: 'border-t-harvest' },
};

const CARDS = [
  {
    to: '/maps', featured: true, accent: 'forest', Icon: MapPinned, tag: 'Monitoring GIS',
    cover: '/data/cover/gis_new.png', objPos: '50% 42%', title: 'SmartGIS', subtitle: 'Peta Interaktif', online: true,
    desc: 'Pantau sawah dengan overlay GIS & citra real-time. Telusuri koordinat, layer lahan, dan titik foto lapangan.',
    stats: [{ Icon: Layers, label: '5 layer' }, { Icon: ImageIcon, label: '12 titik foto' }],
  },
  {
    to: '/chatbot', accent: 'leaf', Icon: Bot, tag: 'Asisten AI',
    cover: '/data/cover/chatbot.jpg', objPos: '72% 26%', title: 'Chatbot AI', subtitle: 'Asisten Cerdas', online: false,
    desc: 'Konsultasi pertanian & analisis parameter sawah.',
    stats: [{ Icon: Cpu, label: 'model offline' }],
  },
  {
    to: '/detection', accent: 'harvest', Icon: ScanSearch, tag: 'Computer Vision',
    cover: '/data/cover/detection.jpg', objPos: '50% 45%', title: 'Deteksi Penyakit', subtitle: 'Klasifikasi Penyakit Daun', online: false,
    desc: 'Identifikasi penyakit padi dari citra daun.',
    stats: [{ Icon: ScanSearch, label: 'terakhir: —' }],
  },
];

function FeatureCard({ card }) {
  const navigate = useNavigate();
  const a = ACCENTS[card.accent];
  const { Icon } = card;

  // --- DESAIN KHUSUS SMARTGIS (Featured) ---
  if (card.featured) {
    return (
      <Card
        role="button"
        tabIndex={0}
        onClick={() => navigate(card.to)}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && navigate(card.to)}
        className={`group relative flex cursor-pointer flex-col overflow-hidden border-t-[3px] ${a.top} p-0 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_12px_32px_rgba(0,0,0,0.1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99] row-span-2`}
      >
        <div className="relative min-h-0 w-full flex-1 overflow-hidden">
          <img src={card.cover} alt={card.title} loading="eager" decoding="async"
            style={{ objectPosition: card.objPos || 'center' }}
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
          <Badge variant="outline" className="absolute right-4 top-4 border-transparent px-3 py-1 text-[10px] font-bold uppercase tracking-[0.15em] backdrop-blur-md shadow-sm bg-slate-900/85 text-white">
            {card.tag}
          </Badge>
          <span className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest shadow-sm backdrop-blur-md text-emerald-700">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            {card.online ? 'online' : 'offline'}
          </span>
        </div>

        <div className="flex shrink-0 flex-col gap-2 p-4">
          <div className="flex items-start gap-3">
            <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl shadow-sm ring-1 ring-inset ${a.chip}`}>
              <Icon className="h-5 w-5" strokeWidth={2} />
            </span>
            <div className="flex flex-col mt-0.5">
              <p className={`text-[10px] font-bold uppercase tracking-[0.2em] leading-none mb-1 ${a.text}`}>{card.subtitle}</p>
              <h2 className="font-black tracking-tight text-slate-900 text-2xl leading-none">{card.title}</h2>
            </div>
          </div>
          
          <p className="text-slate-500 font-medium text-[14px] leading-snug mt-1 max-w-[95%]">
            {card.desc}
          </p>

          <div className="mt-auto flex items-center justify-between border-t border-slate-100 pt-3 mt-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-semibold text-slate-500">
              {card.stats.map((s, i) => (
                <span key={i} className="inline-flex items-center gap-1.5 tracking-wide">
                  <s.Icon className="h-3.5 w-3.5 text-slate-400" /> {s.label}
                </span>
              ))}
            </div>
            <span className={`group/btn inline-flex items-center gap-1.5 text-[13px] font-bold transition-colors ${a.text}`}>
              Buka <ArrowRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover/btn:translate-x-1" />
            </span>
          </div>
        </div>
      </Card>
    );
  }

  // --- DESAIN NORMAL (Chatbot, Deteksi, persis seperti aslinya) ---
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={() => navigate(card.to)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && navigate(card.to)}
      className={`group relative flex cursor-pointer flex-col overflow-hidden border-t-[3px] ${a.top} p-0 transition-all duration-200 hover:-translate-y-1 hover:shadow-[0_8px_24px_rgba(0,0,0,0.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]`}
    >
      <div className="relative min-h-0 w-full flex-1 overflow-hidden">
        <img src={card.cover} alt={card.title} loading="lazy" decoding="async"
          style={{ objectPosition: card.objPos || 'center' }}
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.05]" />
        <Badge variant="outline" className="absolute right-3 top-3 border-transparent bg-white/90 uppercase tracking-wide backdrop-blur-sm">{card.tag}</Badge>
        <span className={`absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 text-xs font-semibold backdrop-blur-sm ${card.online ? 'text-leaf' : 'text-slate-500'}`}>
          <span className={`h-2 w-2 rounded-full ${card.online ? 'bg-leaf' : 'bg-slate-300'}`} />
          {card.online ? 'online' : 'offline'}
        </span>
      </div>

      <div className="flex shrink-0 flex-col gap-2 p-4">
        <div className="flex items-center gap-2">
          <span className={`grid h-9 w-9 place-items-center rounded-xl ${a.chip}`}><Icon className="h-5 w-5" strokeWidth={1.9} /></span>
          <div>
            <h2 className="font-bold leading-none text-forest text-xl">{card.title}</h2>
            <p className={`mt-1 text-sm font-semibold ${a.text}`}>{card.subtitle}</p>
          </div>
        </div>
        <p className="text-muted-foreground line-clamp-2 text-sm leading-snug">{card.desc}</p>

        <div className="mt-auto flex items-center justify-between border-t border-border/70 pt-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium text-muted-foreground">
            {card.stats.map((s, i) => <span key={i} className="inline-flex items-center gap-1.5"><s.Icon className="h-3.5 w-3.5" /> {s.label}</span>)}
          </div>
          <span className={`inline-flex items-center gap-1.5 text-sm font-bold ${a.text}`}>
            Buka <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
          </span>
        </div>
      </div>
    </Card>
  );
}

export function Menu() {
  return (
    <div className="flex h-full flex-col gap-4 bg-background px-[clamp(20px,4vw,48px)] py-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3.5">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white text-3xl shadow-[0_0_0.5px_rgba(0,0,0,0.14),0_1px_1px_rgba(0,0,0,0.24)]">🌾</span>
          <div>
            <h1 className="text-2xl font-bold leading-none text-forest">Jaga Padi</h1>
            <p className="mt-1 text-xs font-semibold uppercase tracking-[1.5px] text-muted-foreground">Smart Rice Field Monitoring</p>
          </div>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-[1.5fr_1fr] md:grid-rows-2">
        {CARDS.map((c) => <FeatureCard key={c.to} card={c} />)}
      </main>

      {/* House-green footer band (espresso-dark bookend) */}
      <footer className="flex shrink-0 items-center justify-center gap-2 py-1 text-[11px] font-medium text-muted-foreground/70">
        <span>v1.0.0</span><span className="opacity-50">•</span><span>RIKUB Kemdintisaintek 2025</span>
      </footer>
    </div>
  );
}
