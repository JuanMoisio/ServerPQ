export type DriveInfo = { device: string; description: string };

export async function listDrives(): Promise<DriveInfo[]> {
  // TODO: reemplazar por drivelist / wmic
  return [];
}
export async function unmount(_device: string) {
  return;
}
