// API client for the Python AI services (chatbot :5000, detection :5001).

const CHATBOT = 'http://127.0.0.1:5000';
const DETECTION = 'http://127.0.0.1:5001';
const TIMEOUT = 30000;

async function request(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...options.headers },
    });
    if (!res.ok) throw new Error(`HTTP Error ${res.status}: ${res.statusText}`);
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Request timeout. Server tidak merespon.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function sendChatMessage(message) {
  return request(`${CHATBOT}/api/chat`, { method: 'POST', body: JSON.stringify({ message }) });
}

export function analyzeParameters(params) {
  return request(`${CHATBOT}/api/analyze`, { method: 'POST', body: JSON.stringify(params) });
}

export async function detectDisease(imageFile) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const form = new FormData();
    form.append('image', imageFile);
    const res = await fetch(`${DETECTION}/api/detect`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP Error ${res.status}: ${res.statusText}`);
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Request timeout. Server tidak merespon.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
