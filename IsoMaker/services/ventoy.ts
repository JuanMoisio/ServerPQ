import path from 'node:path';
import { run, isMac, isWin } from './util.js';

const base = path.resolve(process.resourcesPath, 'vendor', 'ventoy');

export async function ventoyInstall(device: string) {
if (isMac) {
// device: /dev/diskX
const script = path.join(base, 'mac', 'Ventoy2Disk.sh');
await run('sudo', ['sh', script, '-i', device]);
} else if (isWin) {
// device: \\?\PhysicalDriveN (etcher-sdk lo devuelve así)
const exe = path.join(base, 'win', 'Ventoy2Disk.exe');
await run(exe, ['VTOYCLI', '/I', device]);
} else {
throw new Error('Plataforma no soportada aún');
}
}

export async function ventoyCopyIso(_mountPoint: string, _localIsoPath: string) {
// En Ventoy, una vez instalado, el pendrive expone una partición exFAT (VENTOY) donde simplemente copiamos.
// La copia la hace el renderer vía diálogo (por permisos), o implementamos aquí con fs.copyFile si está montado.
return;
}