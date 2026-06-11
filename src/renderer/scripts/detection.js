// Detection Page Logic

let currentMode = 'upload';
let selectedImageFile = null;

// Switch between upload and streaming mode
function switchMode(mode) {
  currentMode = mode;

  const uploadMode = document.getElementById('uploadMode');
  const streamMode = document.getElementById('streamMode');
  const uploadTab = document.getElementById('uploadTab');
  const streamTab = document.getElementById('streamTab');

  if (mode === 'upload') {
    uploadMode.classList.add('active');
    streamMode.classList.remove('active');
    uploadTab.classList.add('active');
    streamTab.classList.remove('active');
  } else {
    uploadMode.classList.remove('active');
    streamMode.classList.add('active');
    uploadTab.classList.remove('active');
    streamTab.classList.add('active');
  }
}

// Trigger file input
function selectImage() {
  document.getElementById('fileInput').click();
}

// Handle image selection
function handleImageSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  selectedImageFile = file;

  const reader = new FileReader();
  reader.onload = function(e) {
    const preview = document.getElementById('imagePreview');
    preview.innerHTML = `<img src="${e.target.result}" alt="Preview">`;
    preview.classList.add('loaded');

    // Enable detect button
    const detectButton = document.getElementById('detectButton');
    detectButton.disabled = false;

    // Update result
    const resultContent = document.getElementById('resultContent');
    resultContent.innerHTML = "Gambar berhasil dimuat.<br>Klik tombol 'Mulai Deteksi' untuk menganalisis.";
    resultContent.style.color = '#567666';
  };

  reader.readAsDataURL(file);
}

// Detect disease
async function detectDisease() {
  if (!selectedImageFile) {
    alert('Pilih gambar terlebih dahulu!');
    return;
  }

  const resultContent = document.getElementById('resultContent');
  resultContent.innerHTML = '⏳ Menganalisis gambar...';
  resultContent.style.color = '#567666';

  try {
    // Call API
    const response = await detectDisease(selectedImageFile);

    // Display result
    const disease = response.disease || response.prediction || 'Unknown';
    const confidence = response.confidence || response.score || 0;
    const description = response.description || 'Tidak ada deskripsi';
    const treatment = response.treatment || response.recommendation || 'Konsultasikan dengan ahli';

    resultContent.innerHTML = `
      <strong>✅ Hasil Deteksi</strong><br><br>

      <strong>Penyakit:</strong> ${disease}<br>
      <strong>Confidence:</strong> ${(confidence * 100).toFixed(2)}%<br><br>

      <strong>Deskripsi:</strong><br>
      ${description}<br><br>

      <strong>Rekomendasi Penanganan:</strong><br>
      ${treatment}
    `;
    resultContent.style.color = '#333';
  } catch (error) {
    // Show placeholder (API belum ready)
    resultContent.innerHTML = `
      🚧 <strong>Fitur deteksi sedang dalam pengembangan.</strong><br><br>

      Model AI untuk deteksi penyakit padi akan segera diintegrasikan!<br><br>

      <i>Error: ${error.message}</i>
    `;
    resultContent.style.color = '#D97757';
  }
}

// Start camera
function startCamera() {
  const preview = document.getElementById('cameraPreview');
  preview.innerHTML = '📹<br><br>Streaming...<br><br>🚧 Fitur kamera sedang dalam pengembangan';
  preview.classList.add('active');

  const startButton = document.getElementById('startButton');
  const stopButton = document.getElementById('stopButton');

  startButton.disabled = true;
  stopButton.disabled = false;
}

// Stop camera
function stopCamera() {
  const preview = document.getElementById('cameraPreview');
  preview.innerHTML = '📹<br><br>Kamera Dihentikan<br><br>Klik \'Mulai Streaming\' untuk memulai kembali';
  preview.classList.remove('active');

  const startButton = document.getElementById('startButton');
  const stopButton = document.getElementById('stopButton');

  startButton.disabled = false;
  stopButton.disabled = true;
}
