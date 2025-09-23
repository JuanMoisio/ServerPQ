// services/ventoy-probe.js — chequeos simples post-instalación
import { promises as fsp } from 'node:fs';
import path from 'node:path';
export async function probe(letter, expectedLabel = 'VENTOY') {
    const root = letter.endsWith(':') ? `${letter}\\` : `${letter}:\\`;
    let labelOk = false;
    try {
        // Rough label check: Windows no expone fácil label sin WMI, así que probamos el directorio y archivo típico de Ventoy
        const vdir = path.win32.join(root, 'ventoy');
        const vjson = path.win32.join(vdir, 'ventoy.json');
        const hasVdir = await fsp.stat(vdir).then(() => true).catch(() => false);
        const hasVjson = await fsp.stat(vjson).then(() => true).catch(() => false);
        return { root, labelOk, hasVdir, hasVjson };
    }
    catch {
        return { root, labelOk: false, hasVdir: false, hasVjson: false };
    }
}
export default { probe };
