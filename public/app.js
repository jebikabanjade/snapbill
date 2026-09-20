const fileInput = document.getElementById('fileInput');
const dropzone = document.getElementById('dropzone');
const dropLabel = document.getElementById('dropLabel');
const filenameEl = document.getElementById('filename');
const previewEl = document.getElementById('preview');
const transcribeBtn = document.getElementById('transcribe');
const statusEl = document.getElementById('status');
const resultSection = document.getElementById('resultSection');
const outputEl = document.getElementById('output');
const downloadBtn = document.getElementById('download');

const state = {
  file: null,
  parsed: null,
  busy: false
};

dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('dragging');
});
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragging'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragging');
  const file = e.dataTransfer.files?.[0];
  if (file) handleFile(file);
});
fileInput.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (file) handleFile(file);
});

function handleFile(file) {
  if (!file.type.startsWith('image/')) {
    setStatus('Please upload a supported image file.', 'error');
    return;
  }
  state.file = file;
  previewEl.src = URL.createObjectURL(file);
  previewEl.hidden = false;
  filenameEl.textContent = file.name;
  dropLabel.innerHTML = '📄 Replace image';
  transcribeBtn.disabled = false;
  resultSection.hidden = true;
  outputEl.value = '';
  downloadBtn.disabled = true;
  setStatus('Ready. Click Transcribe Invoice to begin.', 'info');
}

transcribeBtn.addEventListener('click', async () => {
  if (state.busy || !state.file) return;
  state.busy = true;
  transcribeBtn.disabled = true;
  outputEl.value = '';
  resultSection.hidden = false;
  downloadBtn.disabled = true;

  setStatus('🔄 Reading image and transcribing (this takes ~2–3 minutes on CPU)...', 'loading');

  try {
    const form = new FormData();
    form.append('image', state.file, state.file.name);

    const res = await fetch('/transcribe', { method: 'POST', body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Server error ${res.status}`);
    }

    const data = await res.json();
    outputEl.value = data.text || '';
    state.parsed = data.parsed || null;
    downloadBtn.disabled = false;

    const elapsed = data?.stats?.timeToFirstToken
      ? ` (${Math.round(data.stats.timeToFirstToken / 1000)}s to first token)`
      : '';
    setStatus(`✓ Transcription complete${elapsed}`, 'success');
  } catch (err) {
    console.error(err);
    setStatus(err.message || 'Transcription failed.', 'error');
  } finally {
    state.busy = false;
    transcribeBtn.disabled = false;
  }
});

downloadBtn.addEventListener('click', async () => {
  if (!state.parsed) return;
  downloadBtn.disabled = true;
  setStatus('Generating PDF...', 'loading');

  try {
    // Re-parse the (possibly edited) text client-side is not possible, so send
    // the raw text and let the server re-derive fields.
    const body = {
      ...state.parsed,
      rawText: outputEl.value
    };

    const res = await fetch('/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) throw new Error('PDF generation failed');

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'invoice.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    setStatus('✓ PDF downloaded', 'success');
  } catch (err) {
    console.error(err);
    setStatus(err.message || 'PDF download failed.', 'error');
  } finally {
    downloadBtn.disabled = false;
  }
});

function setStatus(msg, kind = 'info') {
  statusEl.hidden = false;
  statusEl.textContent = msg;
  statusEl.className = `status ${kind}`;
}