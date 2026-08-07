// API client for the Python AI services. Chat/parameter/detect are all proxied
// same-origin through this backend (chatbot_proxy.py → Jetson Gemma;
// detection_proxy.py → local CV fusion microservice), so the HTTPS kiosk never
// calls plain HTTP directly (avoids mixed-content blocking).

const CHATBOT = '';
const TIMEOUT = 30000;
const DETECT_TIMEOUT = 45000; // CV inference ~1-2s; kept above the backend proxy's 30s
const CHATBOT_TIMEOUT = 300000; // Gemma runs swap-backed on the Jetson (8GB RAM); can take 1.5-3+ min

async function request(url, options = {}, timeout = TIMEOUT, externalSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...options.headers },
    });
    if (!res.ok) throw new Error(`HTTP Error ${res.status}: ${res.statusText}`);
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      // Distinguish a caller-initiated cancel from the internal timeout so the
      // UI can react differently (silent cancel vs. "server still busy" hint).
      if (externalSignal?.aborted) {
        const cancelErr = new Error('Dibatalkan oleh pengguna.');
        cancelErr.name = 'AbortError';
        throw cancelErr;
      }
      const timeoutErr = new Error('Request timeout. Server tidak merespon.');
      timeoutErr.timeout = true;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
  }
}

// The Jetson RAG service returns a rich diagnosis object nested under
// `prediksi` (prediksi.narasi_gemma, prediksi.pencegahan, prediksi.pengendalian,
// ...), not a plain {response}/{analysis} shape. Flatten it into text so
// callers get a readable message instead of a raw JSON dump.
function summarizeDiagnosis(data) {
  const prediksi = data?.prediksi;
  const parts = [];
  if (prediksi?.narasi_gemma) parts.push(prediksi.narasi_gemma);
  const rec = prediksi?.pengendalian;
  if (rec) {
    const bahan = Array.isArray(rec.bahan_aktif) ? rec.bahan_aktif.join(', ') : '';
    const produk = Array.isArray(rec.contoh_produk) ? rec.contoh_produk.join(', ') : '';
    parts.push(
      `🛡️ Pengendalian (${rec.jenis || '-'}): ${bahan}${produk ? ` — contoh: ${produk}` : ''}`,
    );
  }
  return parts.join('\n\n') || 'Tidak ada respons dari sistem.';
}

function diagnosisRecommendations(data) {
  const prediksi = data?.prediksi;
  const recs = [];
  if (prediksi?.pencegahan) recs.push(`Pencegahan: ${prediksi.pencegahan}`);
  const rec = prediksi?.pengendalian;
  if (rec?.bahan_aktif?.length) recs.push(`Bahan aktif: ${rec.bahan_aktif.join(', ')}`);
  if (rec?.contoh_produk?.length) recs.push(`Contoh produk: ${rec.contoh_produk.join(', ')}`);
  if (rec?.catatan) recs.push(rec.catatan);
  return recs;
}

export function sendChatMessage(message, { signal } = {}) {
  return request(
    `${CHATBOT}/api/chat`,
    { method: 'POST', body: JSON.stringify({ query: message }) },
    CHATBOT_TIMEOUT,
    signal,
  ).then((data) => ({ response: summarizeDiagnosis(data), raw: data }));
}

export function analyzeParameters({ gejala, suhu, kelembapan, ph, pH }, { signal } = {}) {
  return request(
    `${CHATBOT}/api/parameter`,
    {
      method: 'POST',
      body: JSON.stringify({
        gejala,
        suhu: String(suhu ?? ''),
        kelembapan: String(kelembapan ?? ''),
        pH: String(pH ?? ph ?? ''),
      }),
    },
    CHATBOT_TIMEOUT,
    signal,
  ).then((data) => ({
    analysis: data?.prediksi?.narasi_gemma || `Prediksi: ${data?.prediksi?.hama || '-'}`,
    recommendations: diagnosisRecommendations(data),
    raw: data,
  }));
}

// Chat session/message history, persisted server-side (Postgres) instead of
// browser localStorage — WebKitGTK inside the pywebview kiosk does not
// reliably keep localStorage across process restarts, so history vanished
// every time the kiosk window was closed and reopened.
export function listChatSessions() {
  return request('/api/chat/sessions?include_messages=true');
}

export function createChatSession() {
  return request('/api/chat/sessions', { method: 'POST' });
}

export function addChatMessage(sessionId, { sender, text, isError = false }) {
  return request(`/api/chat/sessions/${sessionId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ sender, text, is_error: isError }),
  });
}

export async function deleteChatSession(sessionId) {
  const res = await fetch(`/api/chat/sessions/${sessionId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`HTTP Error ${res.status}: ${res.statusText}`);
}

// Recent saved detections (newest first) from the disease_detections table.
export async function listDetections(limit = 50) {
  const res = await fetch(`/api/detections?limit=${limit}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

// Persist a "Perdalam via AI" result onto the detection row AND the LLM chat history.
export async function saveDetectionNarrative(id, prompt, narrative) {
  const res = await fetch(`/api/detections/${id}/narrative`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, narrative }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

// Attach a detection to a GIS spray zone (target_detections). The server auto-updates
// the zone's chamber from its detections. Used by the map's "Deteksi HPT" flow, where a
// polygon_id rides along in the /detection URL. Payload: { disease_name, chamber,
// confidence?, sample_lat?, sample_lng?, image_path? }.
export async function addTargetDetection(polygonId, payload) {
  const res = await fetch(`/polygons/${encodeURIComponent(polygonId)}/detections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

// Runs the rice-disease CV+soil fusion model (Pi, via same-origin /api/detect).
// The backend injects the LIVE soil reading server-side, so the caller only sends
// the image (+ optional lat/lng from camera mode). Returns the model's multi-label
// shape: { classes:[{name,p_img,p_final,gate,present}], present:[names],
// top:{name,p_final}, used_soil, timing_ms }.
export async function detectDisease(imageFile, { lat, lng, source, polygonId, zoneCode } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DETECT_TIMEOUT);
  try {
    const form = new FormData();
    form.append('image', imageFile);
    if (lat != null) form.append('lat', lat);
    if (lng != null) form.append('lng', lng);
    if (source) form.append('source', source); // 'camera' | 'upload' — recorded in the DB
    // GIS "Deteksi HPT" flow: the server links the result to this spray zone (target_detections).
    if (polygonId) form.append('polygon_id', polygonId);
    if (zoneCode) form.append('zone_code', zoneCode);
    const res = await fetch('/api/detect', { method: 'POST', body: form, signal: controller.signal });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.message || `HTTP Error ${res.status}: ${res.statusText}`);
    return data;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Request timeout. Server tidak merespon.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
