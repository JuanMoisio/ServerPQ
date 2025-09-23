import path from "node:path";
export async function getRepoIndex() {
    // TODO: pedir al server (PQ_REPO_URL). Por ahora, demo fija:
    return [{ name: "demo.iso", size: 123456789 }];
}
export async function downloadToTemp(name) {
    // TODO: descargar desde PQ_REPO_URL. Por ahora devolver ruta temporal fake.
    return path.join(process.cwd(), "tmp", name);
}
export async function verifySha256(_p) {
    // TODO: verificar contra SHA256SUMS
    return true;
}
