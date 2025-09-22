// services/repo.js — índice simple + descarga con progreso + verificación SHA-256
import { promises as fsp } from 'node:fs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export async function fetchIndex(baseUrl) {
  const url = new URL('/', baseUrl).toString();
  const idxUrl = new URL('index.json', url).toString();
  const r = await fetch(idxUrl, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} al leer ${idxUrl}`);
  return await r.json();
}

export async function verifySha256(filePath, expected) {
  const h = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const s = fs.createReadStream(filePath);
    s.on('data', (c) => h.update(c));
    s.on('error', reject);
    s.on('end', resolve);
  });
  const digest = h.digest('hex').toUpperCase();
  return { ok: expected ? digest === expected.toUpperCase() : true, digest };
}

export async function downloadToWithProgress(fileUrl, outDir, onProgress) {
  await fsp.mkdir(outDir, { recursive: true });
  const filename = decodeURIComponent(new URL(fileUrl).pathname.split('/').pop() || 'file.bin');
  const dest = path.join(outDir, filename);
  const res = await downloadToPathWithProgress(fileUrl, dest, onProgress);
  return res.outPath;
}

export async function downloadToPathWithProgress(fileUrl, destPath, onProgress) {
  const resp = await fetch(fileUrl);
  if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status} al bajar ${fileUrl}`);
  await fsp.mkdir(path.dirname(destPath), { recursive: true });

  const total = Number(resp.headers.get('content-length') || 0);
  let received = 0;

  await new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(destPath);
    resp.body.on('data', (chunk) => {
      received += chunk.length;
      const percent = total ? Math.round((received / total) * 100) : 0;
      onProgress?.({ received, total, percent, filename: path.basename(destPath) });
    });
    resp.body.on('error', reject);
    resp.body.on('end', resolve);
    resp.body.pipe(ws);
  });

  // hash oportuno (por si quieren mostrar)
  let digest = null;
  try {
    const v = await verifySha256(destPath, '');
    digest = v.digest;
  } catch {}

  return { outPath: destPath, digest };
}

export default {
  fetchIndex, verifySha256,
  downloadToWithProgress, downloadToPathWithProgress
};
