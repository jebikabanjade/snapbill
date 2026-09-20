import http from 'node:http';
import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

import { transcribeInvoice } from './src/qvac.js';
import { parseInvoice } from './src/parser.js';
import { buildInvoicePdf } from './src/pdf.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, 'public');
const UPLOAD_DIR = join(tmpdir(), 'snapbill');
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const MAX_IMAGE_WIDTH = 800;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function send(res, status, body, contentType = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': contentType });
  res.end(body);
}

async function readRequestBody(req, limitBytes = 25 * 1024 * 1024) {
  return new Promise((res, rej) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) {
        rej(new Error('Request too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => res(Buffer.concat(chunks)));
    req.on('error', rej);
  });
}

function parseMultipart(buffer, boundary) {
  const boundaryBuf = Buffer.from(`--${boundary}`);
  const parts = [];
  let start = buffer.indexOf(boundaryBuf);

  while (start !== -1) {
    start += boundaryBuf.length;
    if (buffer.slice(start, start + 2).toString() === '--') break;
    if (buffer.slice(start, start + 2).toString() === '\r\n') start += 2;

    const headerEnd = buffer.indexOf('\r\n\r\n', start);
    if (headerEnd === -1) break;

    const headerText = buffer.slice(start, headerEnd).toString('utf8');
    const bodyStart = headerEnd + 4;
    const nextBoundary = buffer.indexOf(boundaryBuf, bodyStart);
    if (nextBoundary === -1) break;

    let bodyEnd = nextBoundary;
    if (buffer.slice(bodyEnd - 2, bodyEnd).toString() === '\r\n') bodyEnd -= 2;

    const body = buffer.slice(bodyStart, bodyEnd);
    const nameMatch = /name="([^"]+)"/.exec(headerText);
    const filenameMatch = /filename="([^"]*)"/.exec(headerText);

    parts.push({
      name: nameMatch?.[1] ?? null,
      filename: filenameMatch?.[1] ?? null,
      data: body
    });

    start = nextBoundary;
  }

  return parts;
}

async function handleTranscribe(req, res) {
  const contentType = req.headers['content-type'] ?? '';
  const boundaryMatch = /boundary=(.+)$/.exec(contentType);
  if (!boundaryMatch) return sendJson(res, 400, { error: 'Expected multipart' });

  let body;
  try {
    body = await readRequestBody(req);
  } catch (err) {
    return sendJson(res, 413, { error: err.message });
  }

  const parts = parseMultipart(body, boundaryMatch[1].trim());
  const filePart = parts.find((p) => p.filename);

  if (!filePart) return sendJson(res, 400, { error: 'No image uploaded' });

  if (!existsSync(UPLOAD_DIR)) await mkdir(UPLOAD_DIR, { recursive: true });
  const tempPath = join(UPLOAD_DIR, `upload-${Date.now()}.jpg`);

  const started = Date.now();

  try {
    // Downscale for speed (larger images take the same 2350 tokens but read
    // from disk slower)
    await sharp(filePart.data)
      .resize({
        width: MAX_IMAGE_WIDTH,
        height: MAX_IMAGE_WIDTH,
        fit: 'inside',
        withoutEnlargement: true
      })
      .jpeg({ quality: 85 })
      .toFile(tempPath);

    console.time(`[transcribe] total`);
    const { text, stats } = await transcribeInvoice({ imagePath: tempPath });
    console.timeEnd(`[transcribe] total`);

    const parsed = parseInvoice(text);
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`[transcribe] completed in ${elapsed}s`);

    sendJson(res, 200, { text, parsed, stats });
  } catch (err) {
    console.error('[transcribe] error:', err);
    sendJson(res, 500, {
      error: 'Transcription failed. Try a clearer photo.',
      detail: String(err?.message ?? err)
    });
  } finally {
    unlink(tempPath).catch(() => {});
  }
}

async function handlePdf(req, res) {
  let body;
  try {
    body = await readRequestBody(req, 5 * 1024 * 1024);
  } catch (err) {
    return sendJson(res, 413, { error: err.message });
  }

  let payload;
  try {
    payload = JSON.parse(body.toString('utf8'));
  } catch {
    return sendJson(res, 400, { error: 'Invalid JSON body' });
  }

  const invoice = {
    vendor: payload.vendor ?? null,
    recipient: payload.recipient ?? null,
    invoiceNumber: payload.invoiceNumber ?? null,
    date: payload.date ?? null,
    items: Array.isArray(payload.items) ? payload.items : [],
    total: payload.total ?? null,
    rawText: payload.rawText ?? ''
  };

  try {
    const pdf = await buildInvoicePdf(invoice);
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename=invoice.pdf',
      'Content-Length': pdf.length
    });
    res.end(pdf);
  } catch (err) {
    console.error('[pdf] error:', err);
    sendJson(res, 500, { error: 'PDF generation failed.' });
  }
}

async function handleStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = resolve(join(PUBLIC_DIR, urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    return send(res, 403, 'Forbidden', 'text/plain');
  }

  try {
    const data = await readFile(filePath);
    const type = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
    send(res, 200, data, type);
  } catch {
    send(res, 404, 'Not found', 'text/plain');
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'POST' && url.pathname === '/transcribe') {
      return await handleTranscribe(req, res);
    }
    if (req.method === 'POST' && url.pathname === '/pdf') {
      return await handlePdf(req, res);
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      return await handleStatic(req, res);
    }
    send(res, 405, 'Method not allowed', 'text/plain');
  } catch (err) {
    console.error('[server] error:', err);
    sendJson(res, 500, { error: 'Internal server error' });
  }
});

server.listen(PORT, () => {
  console.log(`SnapBill running at http://localhost:${PORT}`);
  console.log('🔒 Local AI powered by QVAC. Your invoice never leaves this machine.');
  console.log('⏱  First transcription may take 2–3 minutes on CPU-only machines.');
});