// API Client untuk komunikasi dengan Python Microservices

// Load config (will work in both Node.js and browser context)
let API_CONFIG;
if (typeof require !== 'undefined') {
  try {
    API_CONFIG = require('../../config/api-config.js');
  } catch (e) {
    // Fallback if require fails
    API_CONFIG = {
      CHATBOT: { BASE_URL: 'http://localhost:5000' },
      DETECTION: { BASE_URL: 'http://localhost:5001' },
      TIMEOUT: 30000
    };
  }
} else {
  // Inline config for browser
  API_CONFIG = {
    CHATBOT: { BASE_URL: 'http://localhost:5000' },
    DETECTION: { BASE_URL: 'http://localhost:5001' },
    TIMEOUT: 30000
  };
}

/**
 * Generic API request function
 */
async function apiRequest(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_CONFIG.TIMEOUT);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`HTTP Error ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    clearTimeout(timeout);

    if (error.name === 'AbortError') {
      throw new Error('Request timeout. Server tidak merespon.');
    }

    throw error;
  }
}

/**
 * Chatbot API - Mode Chat
 */
async function sendChatMessage(message) {
  const url = `${API_CONFIG.CHATBOT.BASE_URL}/api/chat`;
  return await apiRequest(url, {
    method: 'POST',
    body: JSON.stringify({ message })
  });
}

/**
 * Chatbot API - Mode Parameter
 */
async function analyzeParameters(params) {
  const url = `${API_CONFIG.CHATBOT.BASE_URL}/api/analyze`;
  return await apiRequest(url, {
    method: 'POST',
    body: JSON.stringify(params)
  });
}

/**
 * Detection API - Upload Image
 */
async function detectDisease(imageFile) {
  const url = `${API_CONFIG.DETECTION.BASE_URL}/api/detect`;

  const formData = new FormData();
  formData.append('image', imageFile);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_CONFIG.TIMEOUT);

  try {
    const response = await fetch(url, {
      method: 'POST',
      body: formData,
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`HTTP Error ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    clearTimeout(timeout);

    if (error.name === 'AbortError') {
      throw new Error('Request timeout. Server tidak merespon.');
    }

    throw error;
  }
}

// Export functions for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    sendChatMessage,
    analyzeParameters,
    detectDisease
  };
}
