// services/repo.js — índice, descargas (con progreso) y verificación SHA-256
import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';

function fetchWithTimeout(url, ms = 4000, opts = {}) {
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), ms);
  return fetch(url, { ...opts, signal: ac.signal }).finally(() => clearTimeout(id));
}

export async function fetchIndex(baseUrl = 'http://PQS/') {
  const url = new URL('index.json', baseUrl.endsWith('/') ? baseUrl : baseUrl + '/').toString();
  const res = await fetchWithTimeout(url, 4000);
  if (!res.ok) throw new Error(`Repo index failed ${res.status}`);
  const data = await res.json();
  const items = (data?.items || []).map((it) => ({
    name: it.name,
    url: new URL(it.url, baseUrl).toString(),
    sha256: it.sha256 || null
  }));
  return { items };
}

export async function downloadTo(fileUrl, outDir) {
  const res = await fetchWithTimeout(fileUrl, 30_000);
  if (!res.ok) throw new Error(`Download failed ${res.status}`);
  await fsp.mkdir(outDir, { recursive: true });
  const filename = decodeURIComponent(new URL(fileUrl).pathname.split('/').pop());
  const outPath = path.join(outDir, filename);
  const fh = await fsp.open(outPath, 'w');
  const ws = fh.createWriteStream();
  Readable.fromWeb(res.body).pipe(ws);
  await finished(ws);
  await fh.close();
  return outPath;
}

export async function downloadToWithProgress(fileUrl, outDir, onProgress) {
  const res = await fetchWithTimeout(fileUrl, 30_000);
  if (!res.ok) throw new Error(`Download failed ${res.status}`);

  await fsp.mkdir(outDir, { recursive: true });
  const filename = decodeURIComponent(new URL(fileUrl).pathname.split('/').pop());
  const outPath = path.join(outDir, filename);

  const total = Number(res.headers.get('content-length') || 0);
  let received = 0;

  const fh = await fsp.open(outPath, 'w');
  const ws = fh.createWriteStream();

  const rs = Readable.fromWeb(res.body);
  rs.on('data', (chunk) => {
    received += chunk.length || 0;
    if (onProgress) {
      const percent = total ? Math.floor((received / total) * 100) : null;
      onProgress({ received, total, percent, filename });
    }
  });

  rs.pipe(ws);
  await finished(ws);
  await fh.close();
  if (onProgress) onProgress({ received, total, percent: 100, filename });

  return outPath;
}

export async function downloadToPathWithProgress(fileUrl, destPath, onProgress) {
  const res = await fetchWithTimeout(fileUrl, 30_000);
  if (!res.ok) throw new Error(`Download failed ${res.status}`);

  // Crear dir solo si NO es raíz (E:\)
  const dir = path.win32.dirname(destPath);
  const isRoot = /^[A-Za-z]:\\$/.test(dir);
  if (!isRoot) {
    await fsp.mkdir(dir, { recursive: true });
  } else {
    // root: asegurate que existe / es accesible (si no, tirará al abrir el archivo)
    try { await fsp.access(dir); } catch { /* ignoramos: si no existe, fallará al abrir */ }
  }

  const total = Number(res.headers.get('content-length') || 0);
  let received = 0;

  const fh = await fsp.open(destPath, 'w');        // crea/abre el archivo directamente en E:\filename
  const ws = fh.createWriteStream();
  const rs = Readable.fromWeb(res.body);
  const hasher = createHash('sha256');

  rs.on('data', (chunk) => {
    const len = chunk.length || 0;
    received += len;
    hasher.update(chunk);
    if (onProgress) {
      const percent = total ? Math.floor((received / total) * 100) : null;
      onProgress({ received, total, percent, filename: path.basename(destPath) });
    }
  });

  rs.pipe(ws);
  await finished(ws);
  await fh.close();

  const digest = hasher.digest('hex').toUpperCase();
  if (onProgress) onProgress({ received, total, percent: 100, filename: path.basename(destPath) });

  return { outPath: destPath, digest };
}


export async function verifySha256(filePath, expected) {
  const hash = createHash('sha256');
  const fh = await fsp.open(filePath, 'r');
  await new Promise((resolve, reject) => {
    const rs = fh.createReadStream();
    rs.on('data', (chunk) => hash.update(chunk));
    rs.on('error', reject);
    rs.on('end', resolve);
  });
  await fh.close();
  const digest = hash.digest('hex').toUpperCase();
  const exp = String(expected || '').trim().toUpperCase();
  return { ok: !!exp && digest === exp, digest };
}

// También dejo default para máxima compat
export default { fetchIndex, downloadTo, downloadToWithProgress, downloadToPathWithProgress, verifySha256 };
