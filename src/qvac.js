import {
  loadModel,
  completion,
  OCR_0_6B_MULTIMODAL_Q4_K_M,
  MMPROJ_OCR_0_6B_MULTIMODAL_F16
} from '@qvac/sdk';

// Must be set before QVAC worker starts.
process.env.QVAC_CONFIG_PATH =
  process.env.QVAC_CONFIG_PATH || './qvac.config.json';

let modelId = null;
let loadingPromise = null;

export async function ensureModelLoaded(onProgress) {
  if (modelId) return modelId;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    onProgress?.('Loading local OCR model...');

    const id = await loadModel({
      modelSrc: OCR_0_6B_MULTIMODAL_Q4_K_M,
      modelConfig: {
        ctx_size: 4096,
        projectionModelSrc: MMPROJ_OCR_0_6B_MULTIMODAL_F16,
        load_mode: 'none'
      }
    });

    modelId = id;
    return modelId;
  })();

  try {
    return await loadingPromise;
  } catch (err) {
    loadingPromise = null;
    throw err;
  }
}

const TRANSCRIBE_PROMPT =
  'Transcribe all text from this invoice image exactly as written. ' +
  'Preserve line breaks and numbers. ' +
  'Output only the transcribed text, no explanations or formatting.';

export async function transcribeInvoice({ imagePath }) {
  const id = await ensureModelLoaded();

  const run = completion({
    modelId: id,
    stream: false,
    history: [
      {
        role: 'user',
        content: TRANSCRIBE_PROMPT,
        attachments: [{ path: imagePath }]
      }
    ]
  });

  const final = await run.final;
  const text = final?.contentText ?? final?.raw?.fullText ?? '';
  return { text: String(text).trim(), stats: final?.stats ?? null };
}