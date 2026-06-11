// Chatbot page logic.

let currentMode = 'chat';

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

function handleEnter(event) {
  if (event.key === 'Enter') sendMessage();
}

async function sendMessage() {
  const input = document.getElementById('chatInput');
  const message = input.value.trim();
  if (!message) return;

  const chatArea = document.getElementById('chatArea');
  addMessage(message, 'user');
  input.value = '';

  const loadingMsg = addMessage('⏳ Mengetik...', 'bot');
  try {
    const response = await sendChatMessage(message);
    chatArea.removeChild(loadingMsg);
    const botResponse = response.response || response.message || JSON.stringify(response);
    addMessage(botResponse, 'bot');
  } catch (error) {
    chatArea.removeChild(loadingMsg);
    addMessage(`⚠️ Error: ${error.message}`, 'bot');
  }
  chatArea.scrollTop = chatArea.scrollHeight;
}

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

// Renamed from analyzeParameters() to avoid shadowing the API function.
async function runAnalyze() {
  const gejala = document.getElementById('gejalaInput').value.trim() || 'Tidak ada gejala khusus';
  const suhu = parseFloat(document.getElementById('suhuInput').value);
  const kelembapan = parseInt(document.getElementById('kelembapanInput').value, 10);
  const ph = parseFloat(document.getElementById('phInput').value);

  const resultCard = document.getElementById('resultCard');
  const resultContent = document.getElementById('resultContent');
  resultCard.style.display = 'block';
  resultContent.innerHTML = '⏳ Menganalisis data...';

  try {
    const response = await analyzeParametersApi({ gejala, suhu, kelembapan, ph });
    const analysis = response.analysis || 'Tidak ada analisis';
    const recommendations = response.recommendations || [];

    let resultHTML = `
      <strong>📊 Hasil Analisis Kondisi Sawah</strong><br><br>
      <strong>Parameter Input:</strong><br>
      • Gejala: ${gejala}<br>
      • Suhu: ${suhu} °C<br>
      • Kelembapan: ${kelembapan}%<br>
      • pH Tanah: ${ph}<br><br>
      <strong>🔍 Analisis:</strong><br>${analysis}<br><br>
      <strong>💡 Rekomendasi:</strong><br>
    `;
    if (Array.isArray(recommendations) && recommendations.length > 0) {
      recommendations.forEach((rec) => { resultHTML += `• ${rec}<br>`; });
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
