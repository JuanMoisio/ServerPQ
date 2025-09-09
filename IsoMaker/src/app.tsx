import { useEffect, useState } from 'react';
if (!selected) return;
setBusy(true);
setLog('Instalando Ventoy…');
try {
await window.api.ventoyInstall(selected);
setLog('Ventoy instalado.');
} catch (e: any) {
setLog('Error: ' + e.message);
} finally { setBusy(false); }
}

async function doFlash() {
if (!selected || !iso) return;
setBusy(true);
setLog('Descargando ISO…');
try {
const local = await window.api.downloadToTemp(iso);
setLog('Verificando hash…');
await window.api.verifySha256(local);
setLog('Flasheando con verificación…');
await window.api.flash({ imagePath: local, device: selected });
setLog('✅ Listo');
} catch (e: any) {
setLog('Error: ' + e.message);
} finally { setBusy(false); }
}

return (
<div style={{ fontFamily: 'ui-sans-serif, system-ui', padding: 24 }}>
<h1>PQ‑USB Creator</h1>
<ol>
<li>
<h3>1) Seleccionar pendrive</h3>
<select disabled={busy} value={selected} onChange={(e) => setSelected(e.target.value)}>
<option value="">– Elegir –</option>
{drives.map((d) => (
<option key={d.device} value={d.device}>{d.description} — {d.device}</option>
))}
</select>
<button disabled={!selected || busy} onClick={() => window.api.unmount(selected)}>Desmontar</button>
</li>
<li>
<h3>2) Elegir modo</h3>
<button disabled={!selected || busy} onClick={doVentoy}>Instalar Ventoy (multi‑ISO)</button>
<span style={{ margin: '0 8px' }}>o</span>
<select disabled={busy} value={iso} onChange={(e) => setIso(e.target.value)}>
<option value="">– Elegir ISO del repo –</option>
{repo.map((r) => (
<option key={r.name} value={r.name}>{r.name}</option>
))}
</select>
<button disabled={!selected || !iso || busy} onClick={doFlash}>Flashear directo</button>
</li>
<li>
<h3>3) Progreso / Log</h3>
<pre style={{ background: '#111', color: '#0f0', padding: 12, minHeight: 120 }}>{log}</pre>
</li>
</ol>
</div>
);
}