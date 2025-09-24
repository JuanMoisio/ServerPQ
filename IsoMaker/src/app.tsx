import React, { useEffect, useState } from 'react';

type Drive = { letter: string; volumeLabel?: string; sizeDisplay: number; model?: string; physIndex: number };
declare global { interface Window { api: any } }

export function App() {
  const [drives, setDrives]   = useState<Drive[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [log, setLog]         = useState<string>('');
  const [exePath, setExePath] = useState<string>('');
  const [captureLabel, setCaptureLabel] = useState<string>('');

  useEffect(() => {
    refresh();
    (async () => {
      try { const p = await window.api.ventoyDefaultPath(); if (p) setExePath(p); } catch {}
    })();
  }, []);

  async function refresh() {
    try { setDrives(await window.api.listDrives()); }
    catch (e:any) { setLog(String(e?.message || e)); }
  }

  async function fullInstall() {
    if (!selected) return alert('Elegí un USB');
    setLog(`→ Preparando ${selected}: Ventoy (GPT) + WinPE + PQTools`);

    // 1) Lanza Ventoy GUI elevado (requiere confirmar UAC y Start en la GUI)
    try {
      const r = await window.api.ventoyStart({ exePath, mode: 'install', target: selected, flags: { gpt: true } });
      setLog(l => (l?l+'\n':'') + `Ventoy lanzado (launcher PID ${r?.launcherPid ?? 'n/a'}). Confirmá el UAC y Start en la GUI.`);
    } catch (e:any) {
      setLog(l => (l?l+'\n':'') + `Ventoy ERROR: ${e?.message || e}`);
      return;
    }

    // 2) WinPE pack
    try {
      const r = await window.api.winpeInstallPack({ driveLetter: selected });
      setLog(l => (l?l+'\n':'') + `WinPE OK → ISO: ${r.isoDst} | Scripts: ${r.scriptsDir}` + (r.copied?.wimlib ? ' | wimlib OK' : ''));
    } catch (e:any) {
      setLog(l => (l?l+'\n':'') + `WinPE ERROR: ${e?.message || e}`);
    }

    // 3) PQTools
    try {
      const src = await window.api.pqtoolsDefaultSrc();
      const r = await window.api.pqtoolsInstall({ driveLetter: selected, srcDir: src || undefined, defaultLabel: captureLabel || undefined });
      setLog(l => (l?l+'\n':'') + `PQTools OK → ${r.targetDir} (wimlib=${r.hasWimlib ? 'OK':'faltante'})`);
    } catch (e:any) {
      setLog(l => (l?l+'\n':'') + `PQTools ERROR: ${e?.message || e}`);
    }

    // 4) Probe rápido Ventoy (opcional)
    try {
      const pr = await window.api.ventoyProbe(selected, 'VENTOY');
      setLog(l => (l?l+'\n':'') + `Verificación Ventoy:\n  - \\ventoy\\: ${pr.hasVdir?'sí':'no'}\n  - \\ventoy\\ventoy.json: ${pr.hasVjson?'sí':'no'}`);
    } catch {}

    setLog(l => (l?l+'\n':'') + `✅ USB ${selected} listo: Ventoy + WinPE + PQTools.`);
    refresh();
  }

  return (
    <div style={{ padding: 16, fontFamily: 'system-ui' }}>
      <h2>PQ-USB Creator</h2>

      <section style={{ border:'1px solid #444', borderRadius:8, padding:12 }}>
        <div style={{ marginBottom:8 }}>
          <button onClick={refresh}>Refrescar USB</button>
        </div>
        <ul>
          {drives.map(d => (
            <li key={d.letter}>
              <label>
                <input type="radio" name="drive" value={d.letter} onChange={()=>setSelected(d.letter)} />
                {d.letter} — {d.volumeLabel || 'sin etiqueta'} — {d.sizeDisplay} GB — {d.model} (Phy #{d.physIndex})
              </label>
            </li>
          ))}
        </ul>
      </section>

      <section style={{ border:'1px solid #444', borderRadius:8, padding:12, marginTop:12 }}>
        <h3>Instalar todo</h3>
        <div style={{ display:'flex', gap:8 }}>
          <input style={{ flex:1 }} value={exePath} onChange={e=>setExePath(e.target.value)} placeholder="Ruta a Ventoy2Disk.exe" />
          <button onClick={async ()=>{ const p = await window.api.ventoyPickExe(); if (p) setExePath(p); }}>Buscar EXE</button>
        </div>
        <div style={{ display:'flex', gap:8, marginTop:8 }}>
          <input style={{ flex:1 }} value={captureLabel} onChange={e=>setCaptureLabel(e.target.value)} placeholder="Nombre para la imagen (opcional)" />
          <div style={{ width:120, display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, opacity:.8 }}>[label opcional]</div>
        </div>
        <button onClick={fullInstall} disabled={!selected} style={{ marginTop:8 }}>
          🚀 Instalar TODO en {selected || 'USB'}
        </button>
        <p style={{ fontSize:12, opacity:.7, marginTop:6 }}>Nota: Ventoy requiere confirmar UAC y presionar <b>Start</b> en su GUI.</p>
      </section>

      <section style={{ marginTop: 16 }}>
        <h3>Logs</h3>
        <textarea readOnly value={log} style={{ width:'100%', height:240, fontFamily:'ui-monospace' }} />
      </section>
    </div>
  );
}

export default App;
