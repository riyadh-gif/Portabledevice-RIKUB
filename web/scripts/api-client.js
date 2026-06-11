// API client for the Python microservices. Browser context (pywebview/WebKitGTK).
// Backend stays separate: chatbot :5000, detection :5001.

const API_CONFIG = {
  CHATBOT: { BASE_URL: 'http://127.0.0.1:5000' },
  DETECTION: { BASE_URL: 'http://127.0.0.1:5001' },
  TIMEOUT: 30000,
};

async function apiRequest(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_CONFIG.TIMEOUT);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...options.headers },
    });
    if (!response.ok) {
      throw new Error(`HTTP Error ${response.status}: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Request timeout. Server tidak merespon.');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function sendChatMessage(message) {
  return apiRequest(`${API_CONFIG.CHATBOT.BASE_URL}/api/chat`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
}

async function analyzeParametersApi(params) {
  return apiRequest(`${API_CONFIG.CHATBOT.BASE_URL}/api/analyze`, {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

// FormData request: do NOT set Content-Type, the browser sets multipart boundary.
async function detectDiseaseApi(imageFile) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_CONFIG.TIMEOUT);
  try {
    const formData = new FormData();
    formData.append('image', imageFile);
    const response = await fetch(`${API_CONFIG.DETECTION.BASE_URL}/api/detect`, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP Error ${response.status}: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Request timeout. Server tidak merespon.');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
