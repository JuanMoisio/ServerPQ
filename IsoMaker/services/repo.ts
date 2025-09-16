import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export async function getRepoIndex(): Promise<Array<{name:string; size:number; sha256?:string}>> {
  // TODO: pedir al server (PQ_REPO_URL). Por ahora, demo fija:
  return [{ name: "demo.iso", size: 123_456_789 }];
}

export async function downloadToTemp(name: string): Promise<string> {
  // TODO: descargar desde PQ_REPO_URL. Por ahora devolver ruta temporal fake.
  return path.join(process.cwd(), "tmp", name);
}

export async function verifySha256(_p: string): Promise<boolean> {
  // TODO: verificar contra SHA256SUMS
  return true;
}
