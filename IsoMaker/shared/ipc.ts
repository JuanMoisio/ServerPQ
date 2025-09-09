export type DriveInfo = {
device: string; // p.ej. /dev/disk4 o \\?\PhysicalDrive2
description: string;
size: number; // bytes
isSystem?: boolean;
isReadOnly?: boolean;
};

export type ListDrivesResult = DriveInfo[];

export type FlashParams = {
imagePath: string; // ruta local (ya descargada)
device: string; // destino
};

export type RepoItem = {
name: string; // archivo.iso
size?: number;
sha256?: string;
};

export type Api = {
listDrives(): Promise<ListDrivesResult>;
unmount(device: string): Promise<void>;
flash(params: FlashParams): Promise<void>;
getRepoIndex(): Promise<RepoItem[]>;
downloadToTemp(name: string): Promise<string>; // retorna ruta local
verifySha256(localPath: string): Promise<boolean>;
ventoyInstall(device: string): Promise<void>;
ventoyCopyIso(deviceMountPoint: string, localIsoPath: string): Promise<void>;
};