// Chatbot Page Logic

let currentMode = 'chat';

// Switch between chat and parameter mode
function switchMode(mode) {
  currentMode = mode;

  const chatMode = document.getElementById('chatMode');
  const paramMode = document.getElementById('paramMode');
  const chatTab = document.getElementById('chatTab');
  const paramTab = document.getElementById('paramTab');

  if (mode === 'chat') {
    chatMode.classList.add('active');
    paramMode.classList.remove('active');
    chatTab.classList.add('active');
    paramTab.classList.remove('active');
  } else {
    chatMode.classList.remove('active');
    paramMode.classList.add('active');
    chatTab.classList.remove('active');
    paramTab.classList.add('active');
  }
}

// Handle Enter key in chat input
function handleEnter(event) {
  if (event.key === 'Enter') {
    sendMessage();
  }
}

// Send chat message
async function sendMessage() {
  const input = document.getElementById('chatInput');
  const message = input.value.trim();

  if (!message) return;

  const chatArea = document.getElementById('chatArea');

  // Add user message
  addMessage(message, 'user');
  input.value = '';

  // Add loading message
  const loadingMsg = addMessage('⏳ Mengetik...', 'bot');

  try {
    // Call API
    const response = await sendChatMessage(message);

    // Remove loading message
    chatArea.removeChild(loadingMsg);

    // Add bot response
    const botResponse = response.response || response.message || JSON.stringify(response);
    addMessage(botResponse, 'bot');
  } catch (error) {
    // Remove loading message
    chatArea.removeChild(loadingMsg);

    // Show error
    addMessage(`⚠️ Error: ${error.message}`, 'bot');
  }

  // Scroll to bottom
  chatArea.scrollTop = chatArea.scrollHeight;
}

// Add message to chat area
function addMessage(text, sender) {
  const chatArea = document.getElementById('chatArea');

  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${sender}-message`;

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.innerHTML = text;

  messageDiv.appendChild(bubble);
  chatArea.appendChild(messageDiv);

  return messageDiv;
}

// Analyze parameters
async function analyzeParameters() {
  const gejala = document.getElementById('gejalaInput').value.trim() || 'Tidak ada gejala khusus';
  const suhu = parseFloat(document.getElementById('suhuInput').value);
  const kelembapan = parseInt(document.getElementById('kelembapanInput').value);
  const ph = parseFloat(document.getElementById('phInput').value);

  const resultCard = document.getElementById('resultCard');
  const resultContent = document.getElementById('resultContent');

  // Show loading
  resultCard.style.display = 'block';
  resultContent.innerHTML = '⏳ Menganalisis data...';

  try {
    // Call API
    const response = await analyzeParameters({
      gejala,
      suhu,
      kelembapan,
      ph
    });

    // Display result
    const analysis = response.analysis || 'Tidak ada analisis';
    const recommendations = response.recommendations || [];

    let resultHTML = `
      <strong>📊 Hasil Analisis Kondisi Sawah</strong><br><br>

      <strong>Parameter Input:</strong><br>
      • Gejala: ${gejala}<br>
      • Suhu: ${suhu} °C<br>
      • Kelembapan: ${kelembapan}%<br>
      • pH Tanah: ${ph}<br><br>

      <strong>🔍 Analisis:</strong><br>
      ${analysis}<br><br>

      <strong>💡 Rekomendasi:</strong><br>
    `;

    if (Array.isArray(recommendations) && recommendations.length > 0) {
      recommendations.forEach(rec => {
        resultHTML += `• ${rec}<br>`;
      });
    } else {
      resultHTML += 'Tidak ada rekomendasi khusus<br>';
    }

    resultHTML += '<br><i>✅ Analisis dari API berhasil</i>';
    resultContent.innerHTML = resultHTML;
  } catch (error) {
    resultContent.innerHTML = `
      <strong>⚠️ Error saat menganalisis</strong><br><br>
      ${error.message}<br><br>
      <i>Silakan coba lagi atau periksa koneksi API</i>
    `;
  }
}
