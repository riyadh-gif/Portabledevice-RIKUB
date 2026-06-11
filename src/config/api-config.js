// API Configuration for Python Microservices
const API_CONFIG = {
  // Chatbot Service
  CHATBOT: {
    BASE_URL: 'http://localhost:5000',
    ENDPOINTS: {
      CHAT: '/api/chat',
      ANALYZE: '/api/analyze'
    }
  },

  // Detection Service
  DETECTION: {
    BASE_URL: 'http://localhost:5001',
    ENDPOINTS: {
      DETECT: '/api/detect'
    }
  },

  // Maps Service (if needed)
  MAPS: {
    BASE_URL: 'http://localhost:5003',
    ENDPOINTS: {
      GET_DATA: '/api/maps/data'
    }
  },

  // Request timeout in milliseconds
  TIMEOUT: 30000
};

// Export for use in renderer scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = API_CONFIG;
}
