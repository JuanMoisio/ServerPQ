import fs from 'node:fs';
import path from 'node:path';
import { sha256File } from './util.js';
import https from 'node:https';
import http from 'node:http';

const REPO_URL = process.env.PQ_REPO_URL || 'http://PQS/';

export async function getRepoIndex() {
// MVP: scrappear listado simple (autoindex). Recomendación: servir un index.json en el server.
// Aquí retornamos nombres básicos; en siguiente iteración, consumir /index.json.
return [
// Ejemplo fijo; implementar fetch real más adelante
{ name: 'ubuntu-24.04.1-live-server-amd64.iso' },
];
}

export async function downloadToTemp(name: string): Promise<string> {
const url = new URL(name, REPO_URL).toString();
const tmp = path.join(process.env.TMPDIR || process.cwd(), name);
await new Promise<void>((resolve, reject) => {
const client = url.startsWith('https') ? https : http;
const file = fs.createWriteStream(tmp);
client.get(url, (res) => {
if (res.statusCode && res.statusCode >= 400) return reject(new Error('HTTP ' + res.statusCode));
res.pipe(file);
file.on('finish', () => file.close(() => resolve()));
}).on('error', reject);
});
return tmp;
}

export async function verifySha256(localPath: string): Promise<boolean> {
// MVP: si en el servidor publicás SHA256SUMS, podés traerlo y comparar.
// Aquí asumimos que el nombre aparece en SHA256SUMS; implementar real en próxima iteración.
const _hash = await sha256File(localPath);
return true; // devuelve true por ahora
}