import * as sdk from 'etcher-sdk';
import type { FlashParams } from '../shared/ipc.js';

export async function flash({ imagePath, device }: FlashParams) {
const source = new sdk.sourceDestination.File(imagePath);
const destination = new sdk.sourceDestination.BlockDevice(device, { write: true, direct: true });

const pipeline = new sdk.multiWrite.MultiDestination({ source, destinations: [destination] });

await pipeline.write({
check: true, // verificación
transform: [],
});
}