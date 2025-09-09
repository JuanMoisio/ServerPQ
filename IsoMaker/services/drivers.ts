import * as sdk from 'etcher-sdk';

export async function listDrives() {
const adapter = new sdk.scanner.adapters.BlockDeviceAdapter();
const drives = await adapter.list();
return drives
.filter((d) => !d.isSystem && !d.isReadOnly && d.isRemovable)
.map((d) => ({ device: d.device, description: d.description ?? '', size: d.size ?? 0 }));
}

export async function unmount(device: string) {
// etcher-sdk desmonta automáticamente al escribir, pero exponemos helper por si hace falta
// En macOS podríamos hacer: diskutil unmountDisk <device>
// En Windows: no es necesario para flash raw; Ventoy se encarga al reinstalar.
return;
}