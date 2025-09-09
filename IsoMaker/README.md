# PQ-USB Creator

## Config
Crea un archivo `.env` basado en `env.example`:
```
PQ_REPO_URL=http://PQS/
```

## Desarrollo
```
pnpm i # o npm/yarn
npm run dev
```
Abre la ventana de Electron con la UI mínima.

## Build
```
npm run build
npm run package
```
Los binarios quedan en `dist/` y empaquetados por plataforma (`dmg`, `nsis`).

## Notas
- **Privilegios**: flashear raw y Ventoy requieren elevación (UAC en Windows, sudo en macOS). El SDK y los comandos lo gestionan.
- **Seguridad**: sólo listamos discos removibles no-sistema. Aun así, confirmaciones dobles en UI antes de escribir.
- **Ventoy**: agrega binarios en `vendor/ventoy` por plataforma antes del build. Revisa licencias.
- **Repo**: ideal servir `index.json` con `{ name, size, sha256, label }` para una UI más rica.



**Resumen:**
return;
}
if (isMac) {
throw new Error('Ventoy no se puede instalar desde macOS. Prepará el USB en Windows y luego solo copiá ISOs.');
}
throw new Error('Plataforma no soportada aún');
}
```

### Detección de un USB con Ventoy ya instalado (multi‑plataforma)
```ts
// Heurística: una partición exFAT montada llamada "Ventoy" y otra FAΤ llamada "VTOYEFI"
import fs from 'node:fs';
import path from 'node:path';

export function ventoyIsPresent(mountRoots: string[]): boolean {
const hasMain = mountRoots.some((p) => /Ventoy$/i.test(p) || fs.existsSync(path.join(p, 'ventoy.json')));
const hasEfi = mountRoots.some((p) => /VTOYEFI$/i.test(p) || fs.existsSync(path.join(p, 'EFI', 'ventoy')));
return hasMain && hasEfi;
}
```

### Copiar una ISO a Ventoy (cuando ya está instalado)
```ts
import fs from 'node:fs';
import path from 'node:path';

export async function ventoyCopyIso(ventoyMountPoint: string, localIsoPath: string) {
await fs.promises.copyFile(localIsoPath, path.join(ventoyMountPoint, path.basename(localIsoPath)));
}
```

### Scripts para traer Ventoy (Windows) y validar


**Windows (PowerShell)**
```powershell
# scripts/fetch-ventoy.ps1
param([string]$Version = $env:VENTOY_WIN_VERSION)
if (-not $Version) { $Version = '1.0.99' }
$zip = "ventoy-$Version-windows.zip"
$dst = "vendor/ventoy/win"
New-Item -ItemType Directory -Force -Path $dst | Out-Null
Invoke-WebRequest "https://downloads.sourceforge.net/project/ventoy/Ventoy-$Version/$zip" -OutFile "$dst/$zip"
Expand-Archive -Path "$dst/$zip" -DestinationPath $dst -Force
if (Test-Path "$dst/altexe") { Copy-Item "$dst/altexe/*" $dst -Force }
Write-Host "Ventoy $Version listo en $dst"
```

### .gitignore (recordatorio)
- `vendor/ventoy/**` (no versionar binarios)
- `*.iso`, artefactos de build (`dist/`, `dist-electron/`, `release/`, etc.)

Con esto quedás: **Windows** instala/actualiza Ventoy y copia ISOs; **macOS** hace flash directo y puede copiar ISOs a USBs Ventoy ya preparados. UX consistente y segura para usuarios no técnicos.

