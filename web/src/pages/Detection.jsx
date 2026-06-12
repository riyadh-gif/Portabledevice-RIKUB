import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ScanSearch, Upload, Camera, RefreshCw, Sprout, Leaf,
  FlaskConical, Droplets, Thermometer, CheckCircle2, AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { detectDisease } from '@/api';

// Soil sensors (NPK + others). Values are simulated until the sensor backend is wired.
const SENSORS = [
  { key: 'N', name: 'Nitrogen (N)', Icon: Leaf, unit: 'mg/kg', value: 42, min: 40, max: 60 },
  { key: 'P', name: 'Fosfor (P)', Icon: FlaskConical, unit: 'mg/kg', value: 17, min: 20, max: 40 },
  { key: 'K', name: 'Kalium (K)', Icon: Sprout, unit: 'mg/kg', value: 135, min: 100, max: 200 },
  { key: 'Na', name: 'Natrium (Na)', Icon: FlaskConical, unit: 'mg/kg', value: 33, min: 0, max: 50 },
  { key: 'pH', name: 'pH Tanah', Icon: Droplets, unit: '', value: 5.8, min: 5.5, max: 7.0 },
  { key: 'hum', name: 'Kelembapan', Icon: Droplets, unit: '%', value: 68, min: 60, max: 80 },
  { key: 'temp', name: 'Suhu Tanah', Icon: Thermometer, unit: '°C', value: 29, min: 22, max: 32 },
];

function statusOf(s) {
  if (s.value < s.min) return { label: 'Rendah', tone: 'low' };
  if (s.value > s.max) return { label: 'Tinggi', tone: 'high' };
  return { label: 'Optimal', tone: 'ok' };
}
const TONE = {
  ok: 'bg-leaf/12 text-forest',
  low: 'bg-harvest/15 text-harvest',
  high: 'bg-destructive/10 text-destructive',
};

export function Detection() {
  const navigate = useNavigate();
  const [mode, setMode] = useState('upload');
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState({ state: 'idle' });
  const [streaming, setStreaming] = useState(false);
  const fileRef = useRef(null);
  const fileObj = useRef(null);

  const issues = SENSORS.map((s) => ({ s, st: statusOf(s) })).filter((x) => x.st.tone !== 'ok');

  function onPick(e) {
    const file = e.target.files[0];
    if (!file) return;
    fileObj.current = file;
    const reader = new FileReader();
    reader.onload = (ev) => { setPreview(ev.target.result); setResult({ state: 'ready' }); };
    reader.readAsDataURL(file);
  }

  async function run() {
    if (!fileObj.current) return;
    setResult({ state: 'loading' });
    try {
      const r = await detectDisease(fileObj.current);
      setResult({
        state: 'ok',
        disease: r.disease || r.prediction || 'Unknown',
        confidence: r.confidence || r.score || 0,
        description: r.description || 'Tidak ada deskripsi',
        treatment: r.treatment || r.recommendation || 'Konsultasikan dengan ahli',
      });
    } catch (err) {
      setResult({ state: 'error', message: err.message });
    }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-background px-[clamp(16px,3vw,40px)] py-5">
      <header className="mb-4 flex items-center justify-between gap-3">
        <Button variant="outline" size="sm" onClick={() => navigate('/menu')}><ArrowLeft className="h-4 w-4" /> Menu</Button>
        <div className="flex items-center gap-2"><ScanSearch className="h-5 w-5 text-harvest" strokeWidth={1.9} /><span className="font-bold tracking-tight text-forest">Deteksi Penyakit Padi</span></div>
        <span className="hidden items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground sm:inline-flex"><span className="h-2 w-2 rounded-full bg-slate-300" /> sensor: simulasi</span>
      </header>

      <div className="mx-auto grid w-full max-w-6xl gap-4 lg:grid-cols-2">
        {/* Image capture */}
        <Card className="flex flex-col gap-4 p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-forest">1 · Citra Daun</h3>
            <div className="flex gap-1.5 rounded-full bg-muted p-1">
              <button onClick={() => setMode('upload')} className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${mode === 'upload' ? 'bg-card text-forest shadow-sm' : 'text-muted-foreground'}`}><Upload className="mr-1 inline h-3.5 w-3.5" />Upload</button>
              <button onClick={() => setMode('camera')} className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${mode === 'camera' ? 'bg-card text-forest shadow-sm' : 'text-muted-foreground'}`}><Camera className="mr-1 inline h-3.5 w-3.5" />Kamera</button>
            </div>
          </div>

          {mode === 'upload' ? (
            <>
              <div className={`grid aspect-video w-full place-items-center overflow-hidden rounded-xl border-2 border-dashed ${preview ? 'border-harvest/40' : 'border-border'} bg-muted/40 text-center text-sm text-muted-foreground`}>
                {preview ? <img src={preview} alt="Preview" className="h-full w-full object-contain" /> : <span>📷<br /><br />Pilih gambar daun padi</span>}
              </div>
              <Button variant="outline" className="w-full" onClick={() => fileRef.current.click()}><Upload className="h-4 w-4" /> Pilih Gambar</Button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPick} />
            </>
          ) : (
            <>
              <div className={`grid aspect-video w-full place-items-center rounded-xl text-center text-sm ${streaming ? 'bg-harvest/10 text-harvest' : 'bg-muted/40 text-muted-foreground'}`}>
                {streaming ? <span>📹 Streaming…<br /><br />🚧 dalam pengembangan</span> : <span>📹<br /><br />Kamera belum aktif</span>}
              </div>
              <Button variant="outline" className="w-full" onClick={() => setStreaming((v) => !v)}><Camera className="h-4 w-4" /> {streaming ? 'Stop' : 'Mulai'} Kamera</Button>
            </>
          )}
        </Card>

        {/* Soil sensors */}
        <Card className="flex flex-col gap-3 p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-forest">2 · Parameter Tanah</h3>
            <Button variant="ghost" size="sm" className="text-leaf"><RefreshCw className="h-4 w-4" /> Baca Sensor</Button>
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {SENSORS.map((s) => {
              const st = statusOf(s);
              return (
                <div key={s.key} className="rounded-xl border border-border bg-background/60 p-3">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground"><s.Icon className="h-3.5 w-3.5" /> {s.name}</div>
                  <div className="mt-1 text-lg font-bold text-foreground">{s.value}<span className="ml-0.5 text-xs font-medium text-muted-foreground">{s.unit}</span></div>
                  <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${TONE[st.tone]}`}>{st.label}</span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Combined diagnosis */}
      <div className="mx-auto mt-4 w-full max-w-6xl">
        <Card className="p-5">
          <h3 className="mb-3 font-bold text-forest">3 · Diagnosis Gabungan</h3>
          <Diagnosis result={result} issues={issues} onRun={run} canRun={!!preview} />
        </Card>
      </div>
    </div>
  );
}

function SoilContext({ issues }) {
  if (issues.length === 0) {
    return <p className="flex items-center gap-2 text-sm text-forest"><CheckCircle2 className="h-4 w-4" /> Parameter tanah optimal — kondisi mendukung tanaman sehat.</p>;
  }
  return (
    <div className="space-y-1.5">
      <p className="flex items-center gap-2 text-sm font-semibold text-harvest"><AlertTriangle className="h-4 w-4" /> Faktor tanah pendukung penyakit:</p>
      <ul className="ml-6 list-disc space-y-1 text-sm text-muted-foreground">
        {issues.map(({ s, st }) => (
          <li key={s.key}><span className="font-medium text-foreground">{s.name} {st.label.toLowerCase()}</span> ({s.value}{s.unit}) — periksa pemupukan/drainase.</li>
        ))}
      </ul>
    </div>
  );
}

function Diagnosis({ result, issues, onRun, canRun }) {
  return (
    <div className="space-y-4">
      {result.state === 'ok' ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-lg font-bold text-foreground">{result.disease}</span>
            <span className="rounded-full bg-harvest/15 px-2.5 py-0.5 text-xs font-semibold text-harvest">{(result.confidence * 100).toFixed(0)}% yakin</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-leaf" style={{ width: `${result.confidence * 100}%` }} /></div>
          <p className="text-sm text-muted-foreground">{result.description}</p>
          <p className="text-sm"><span className="font-semibold text-forest">Rekomendasi:</span> {result.treatment}</p>
        </div>
      ) : result.state === 'loading' ? (
        <p className="text-sm text-forest">⏳ Menganalisis citra + parameter tanah…</p>
      ) : result.state === 'error' ? (
        <p className="text-sm text-destructive">🚧 Model deteksi belum aktif ({result.message}). Diagnosis tanah tetap tersedia di bawah.</p>
      ) : (
        <p className="text-sm text-muted-foreground">Pilih citra daun lalu jalankan deteksi. Hasil citra akan dipadukan dengan parameter tanah.</p>
      )}

      <div className="border-t border-border/70 pt-3"><SoilContext issues={issues} /></div>

      <Button variant="accent" disabled={!canRun} onClick={onRun}><ScanSearch className="h-4 w-4" /> Mulai Deteksi</Button>
    </div>
  );
}
