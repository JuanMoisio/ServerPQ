import React, { useEffect, useState } from 'react';

type Drive = { letter: string; volumeLabel?: string; sizeDisplay: number; model?: string; physIndex: number };

declare global {
  interface Window { api: any }
}

export default function App() {
  const [drives, setDrives] = useState<Drive[]>([]);
  const [exePath, setExePath] = useState<string>('');
  const [selected, setSelected] = useState<string>('');
  const [repoUrl, setRepoUrl] = useState<string>(() => localStorage.getItem('repoUrl') || 'http://PQS/');
  const [repo, setRepo] = useState<{ name: string; url: string; sha256?: string }[]>([]);
  const [log, setLog] = useState<string>('');

  // Ventoy
  const [vPercent, setVPercent] = useState<number>(0);
  const [vState, setVState] = useState<'idle' | 'waiting_uac' | 'running' | 'success' | 'failure'>('idle');

  // Download
  const [dRunning, setDRunning] = useState<boolean>(false);
  const [dPercent, setDPercent] = useState<number>(0);
  const [dLabel, setDLabel] = useState<string>('');

  // PQTools
  const [pqSrc, setPqSrc] = useState<string>('');

  const sel = drives.find(d => d.letter === selected);
  const isVentoy = (sel?.volumeLabel || '').toUpperCase() === 'VENTOY';

  // Habilitaciones: solo bloqueamos los botones de Ventoy mientras corre o espera UAC
  const ventoyBusy = vState === 'running' || vState === 'waiting_uac';
  const canVentoy = !!selected && !!exePath && !ventoyBusy;
  const canCopyToUsb = !!selected && !dRunning; // permitimos copiar ISOs aunque Ventoy esté corriendo
  const canInstallPQTools = !!selected && !dRunning; // idem

  // Listeners de progreso
  useEffect(() => {
    const offP = window.api.onVentoyProgress(({ percent, state }) => {
      if (typeof percent === 'number') setVPercent(percent);
      if (state) setVState(state);
      if (state === 'waiting_uac') {
        setLog(l => (l ? l + '\n' : '') + 'Ventoy: esperando confirmación UAC… (revisá ventanas minimizadas)');
      }
    });
    const offD = window.api.onVentoyDone((final: any) => {
      setVState(final.state || 'failure');
      if (typeof final.percent === 'number') setVPercent(final.percent);
      if (final.logTail) setLog((l: string) => (l ? `${l}\n` : '') + final.logTail);
      if (final.timeout) setLog((l: string) => (l ? `${l}\n` : '') + 'Ventoy: timeout de progreso (posible UAC cancelado).');
      // refrescamos drives al terminar
      refresh().catch(() => {});
    });

    const offRP = window.api.onRepoProgress(({ percent, filename }) => {
      setDRunning(true);
      setDPercent(typeof percent === 'number' ? percent : 0);
      if (filename) setDLabel(filename);
    });
    const offRD = window.api.onRepoDone(({ ok, outPath, error }) => {
      setDRunning(false);
      if (ok) setLog((l: string) => (l ? `${l}\n` : '') + `Descarga completa: ${outPath}`);
      else setLog((l: string) => (l ? `${l}\n` : '') + `Descarga fallida: ${error}`);
    });

    return () => { offP(); offD(); offRP(); offRD(); };
  }, []);

  // Carga inicial
  useEffect(() => {
    (async () => {
      try {
        const p = await window.api.ventoyDefaultPath();
        if (p) setExePath(p);
      } catch {}
      try {
        const s = await window.api.pqtoolsDefaultSrc();
        setPqSrc(s || '');
      } catch {}
    })();
    refresh();
    loadRepo();
  }, []);

  // Mientras Ventoy está activo, auto-refresh de drives para detectar etiqueta VENTOY
  useEffect(() => {
    if (ventoyBusy) {
      const id = setInterval(() => { refresh().catch(() => {}); }, 3000);
      return () => clearInterval(id);
    }
  }, [ventoyBusy]);

  async function refresh() {
    try { setDrives(await window.api.listDrives()); }
    catch (e: any) { setLog(String(e?.message || e)); }
  }

  async function loadRepo() {
    try {
      const r = await window.api.repoIndex(repoUrl);
      setRepo(r.items || []);
      localStorage.setItem('repoUrl', repoUrl);
    } catch (e: any) {
      setRepo([]);
      setLog(`Repo error: ${String(e?.message || e)} (URL: ${repoUrl})`);
    }
  }

  async function pickExe() {
    const p = await window.api.ventoyPickExe();
    if (p) setExePath(p);
  }

 async function startVentoy(mode: 'install' | 'update') {
  setLog('');
  setVPercent(0);
  setVState('waiting_uac');

  // 👇 añadimos physIndex del pendrive seleccionado
  const selDrive = drives.find(d => d.letter === selected);
  const physIndex = selDrive?.physIndex;

  try {
    const res = await window.api.ventoyStart({
      exePath,
      mode,
      targetType: 'Drive',
      target: selected,
      flags: { gpt: (mode === 'install') },
      physIndex, // <--- NUEVO
    });
    if (res?.workdir) setLog(l => (l ? l + '\n' : '') + `Ventoy workdir: ${res.workdir}`);
  } catch (e: any) {
    setVState('failure');
    setLog(String(e?.message || e));
  }
}


  async function installLegacy() {
    setLog('');
    try {
      const res = await window.api.ventoyRun({ exePath, mode: 'install', targetType: 'Drive', target: selected, flags: { gpt: true } });
      setLog(l => (l ? l + '\n' : '') + `[legacy] ${res.status} percent=${res.percent ?? 'n/a'}`);
      await refresh();
    } catch (e: any) {
      setLog(String(e?.message || e));
    }
  }

  async function download(item: { name: string; url: string; sha256?: string }) {
    setLog('');
    setDRunning(true);
    setDPercent(0);
    setDLabel(item.name);
    const outDir = 'C:/Temp/isos';
    try {
      const { ok, outPath } = await window.api.repoDownloadStart({ url: item.url, outDir });
      if (ok) {
        const v = await window.api.hashVerify({ filePath: outPath, sha256: item.sha256 || '' });
        setLog((l: string) => (l ? `${l}\n` : '') + `Verificación: SHA256=${v.digest} ${item.sha256 ? `(match=${v.ok})` : '(sin esperado)'}`);
      }
    } catch (e: any) {
      setLog((l: string) => (l ? `${l}\n` : '') + String(e?.message || e));
    } finally {
      setDRunning(false);
    }
  }

  async function copyToUSB(item: { name: string; url: string; sha256?: string }) {
    setLog('');
    setDRunning(true);
    setDPercent(0);
    setDLabel(`${item.name} → ${selected}`);
    try {
      const { ok, outPath, digest, match } = await window.api.repoDownloadStart({
        url: item.url, driveLetter: selected, destName: item.name, sha256: item.sha256 || ''
      });
      if (ok) {
        const ver = item.sha256 ? ` (match=${match})` : ' (sin esperado)';
        setLog((l: string) => (l ? `${l}\n` : '') + `Copiado directo a USB: ${outPath}\nSHA256=${digest}${ver}`);
      }
    } catch (e: any) {
      setLog((l: string) => (l ? `${l}\n` : '') + `Error al copiar directo: ${String(e?.message || e)}`);
    } finally {
      setDRunning(false);
    }
  }

  async function installPQTools() {
    setLog('');
    if (!selected) { setLog('Elegí una unidad USB primero.'); return; }
    try {
      const res = await window.api.pqtoolsInstall({ driveLetter: selected, srcDir: pqSrc || undefined });
      setLog(l => (l ? l + '\n' : '') + `PQTools instalado en ${res.targetDir}` + (res.hasWimlib ? ' (wimlib OK)' : ' (falta wimlib-imagex.exe)'));
    } catch (e: any) {
      setLog(l => (l ? l + '\n' : '') + `Error instalando PQTools: ${String(e?.message || e)}`);
    }
  }

  return (
    <div style={{ padding: 16, fontFamily: 'system-ui' }}>
      <h2>🧪 PQ-USB Creator (DEV)</h2>

      {/* Repo */}
      <section style={{ border: '1px solid #444', borderRadius: 8, padding: 12, marginBottom: 12 }}>
        <h3>Repo</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <input style={{ flex: 1 }} value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder="http://PQS/" />
          <button onClick={loadRepo} disabled={dRunning}>Cargar</button>
        </div>

        {/* Barra de descarga */}
        {dRunning && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 12, opacity: .8, marginBottom: 4 }}>Descargando: {dLabel}</div>
            <div style={{ height: 10, background: '#222', borderRadius: 6, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.max(0, Math.min(100, dPercent))}%`, background: '#2a7', transition: 'width .2s linear' }} />
            </div>
            <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>{dPercent}%</div>
          </div>
        )}

        <table style={{ width:'100%', borderCollapse:'collapse', marginTop: 8 }}>
          <thead><tr><th style={{textAlign:'left'}}>Nombre</th><th>SHA256</th><th>Acciones</th></tr></thead>
          <tbody>
            {repo.map((it) => (
              <tr key={it.name}>
                <td>{it.name}</td>
                <td style={{fontFamily:'monospace', fontSize:12}}>{it.sha256?.slice(0,16)}...</td>
                <td>
                  <button onClick={() => download(it)} disabled={dRunning}>Bajar & verificar</button>
                  <button onClick={() => copyToUSB(it)} disabled={!canCopyToUsb || dRunning} style={{ marginLeft: 8 }}>
                    Copiar directo a {selected || 'USB'}
                  </button>
                </td>
              </tr>
            ))}
            {repo.length === 0 && <tr><td colSpan={3} style={{opacity:.7}}>Sin items</td></tr>}
          </tbody>
        </table>
      </section>

      {/* Ventoy + Drives */}
      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ border: '1px solid #444', borderRadius: 8, padding: 12 }}>
          <h3>1) Pendrives</h3>
          <button onClick={refresh} disabled={dRunning}>Refrescar</button>
          <ul>
            {drives.map((d) => (
              <li key={d.letter}>
                <label>
                  <input
                    type="radio"
                    name="drive"
                    value={d.letter}
                    onChange={() => setSelected(d.letter)}
                    disabled={dRunning}
                  />
                  {d.letter} — {d.volumeLabel || 'sin etiqueta'} — {d.sizeDisplay} GB — {d.model} (Phy #{d.physIndex})
                </label>
              </li>
            ))}
          </ul>
        </div>

        <div style={{ border: '1px solid #444', borderRadius: 8, padding: 12 }}>
          <h3>2) Ventoy</h3>
          <div style={{ display:'flex', gap: 8 }}>
            <input style={{ flex: 1 }} value={exePath} onChange={(e) => setExePath(e.target.value)} placeholder="Ruta a Ventoy2Disk.exe" disabled={ventoyBusy} />
            <button onClick={pickExe} disabled={ventoyBusy}>Buscar EXE</button>
          </div>
          <div style={{ marginTop: 8 }}>
            <button disabled={!canVentoy} onClick={() => startVentoy('install')}>Instalar (GPT)</button>
            <button disabled={!canVentoy} onClick={() => startVentoy('update')} style={{ marginLeft: 8 }}>Actualizar</button>
            <button disabled={!canVentoy} onClick={installLegacy} style={{ marginLeft: 8 }}>Instalar (bloqueante)</button>
          </div>

          <div style={{ fontSize: 12, opacity: .8, marginTop: 6 }}>
            Estado USB {selected || ''}: {selected ? (isVentoy ? 'VENTOY detectado ✅' : 'sin Ventoy (instalar borra el contenido)') : '—'}
          </div>

          {/* Progreso Ventoy */}
          <div style={{ marginTop: 12 }}>
            <div style={{ height: 12, background: '#222', borderRadius: 6, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.max(0, Math.min(100, vPercent))}%`, background: vState==='failure' ? '#b33' : '#3b7', transition: 'width .2s linear' }} />
            </div>
            <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>
              {vState === 'waiting_uac' && 'Esperando confirmación UAC… (revisá ventanas en segundo plano)'}
              {vState === 'running' && `Procesando... ${vPercent ?? 0}%`}
              {vState === 'success' && `Completado 100%`}
              {vState === 'failure' && `Falló`}
              {vState === 'idle' && 'Listo'}
            </div>
          </div>

          <p style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>
            ⚠️ Instalar borra el USB. Verificá la letra.
          </p>
        </div>
      </section>

      {/* PQTools */}
      <section style={{ border: '1px solid #444', borderRadius: 8, padding: 12, marginTop: 16 }}>
        <h3>3) PQTools (capturador portable)</h3>
        <div style={{ fontSize: 12, opacity: .85 }}>
          {pqSrc ? `Fuente de binarios detectada: ${pqSrc}` : 'No se detectó wimlib en vendor/pqtools/win — igual se copiarán los scripts (pedirán wimlib al ejecutar).'}
        </div>
        <div style={{ marginTop: 8 }}>
          <button onClick={installPQTools} disabled={!canInstallPQTools}>
            Instalar capturador en {selected || 'USB'}
          </button>
        </div>
        <p style={{ fontSize: 12, opacity: .7, marginTop: 8 }}>
          Crea <code>PQTools\\pq-capture.cmd</code> en el USB. En cualquier PC: ejecutar como admin → captura C:\\ a <code>Capturas\\HOST-fecha\\install.wim</code>.
        </p>
      </section>

      {/* Logs */}
      <section style={{ marginTop: 16 }}>
        <h3>Logs</h3>
        <textarea readOnly value={log} style={{ width: '100%', height: 200, fontFamily: 'ui-monospace' }} />
      </section>
    </div>
  );
}
