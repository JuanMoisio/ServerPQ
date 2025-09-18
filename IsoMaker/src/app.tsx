import React, { useEffect, useState } from 'react';

type Drive = {
  letter: string;
  volumeLabel?: string;
  sizeDisplay: number;
  model?: string;
  physIndex: number;
};

declare global {
  interface Window {
    api: {
      // drives
      listDrives: () => Promise<Drive[]>;
      // ventoy progress
      ventoyStart: (payload: any) => Promise<{ workdir: string }>;
      ventoyRun: (payload: any) => Promise<{ status: string; percent?: number }>;
      ventoyDefaultPath: () => Promise<string>;
      ventoyPickExe: () => Promise<string>;
      onVentoyProgress: (cb: (data: { percent?: number; state?: string }) => void) => () => void;
      onVentoyDone: (
        cb: (data: { state?: string; percent?: number; logTail?: string; workdir?: string }) => void
      ) => () => void;
      // repo + hash + download progress
      repoIndex: (baseUrl: string) => Promise<{ items: { name: string; url: string; sha256?: string }[] }>;
      repoDownloadStart: (payload: {
        url: string;
        outDir?: string;
        driveLetter?: string;
        destName?: string;
        sha256?: string;
      }) => Promise<{ ok: boolean; outPath?: string; digest?: string; match?: boolean }>;
      hashVerify: (payload: { filePath: string; sha256: string }) => Promise<{ ok: boolean; digest: string }>;
      onRepoProgress: (
        cb: (data: { percent?: number; filename?: string; received?: number; total?: number; target?: 'usb' | 'local' }) => void
      ) => () => void;
      onRepoDone: (cb: (data: { ok: boolean; outPath?: string; error?: string }) => void) => () => void;
    };
  }
}

export default function App() {
  // Estado base
  const [drives, setDrives] = useState<Drive[]>([]);
  const [exePath, setExePath] = useState<string>('');
  const [selected, setSelected] = useState<string>('');
  const [repoUrl, setRepoUrl] = useState<string>(() => localStorage.getItem('repoUrl') || 'http://PQS/');
  const [repo, setRepo] = useState<{ name: string; url: string; sha256?: string }[]>([]);
  const [log, setLog] = useState<string>('');

  // Ventoy
  const [vRunning, setVRunning] = useState<boolean>(false);
  const [vPercent, setVPercent] = useState<number>(0);
  const [vState, setVState] = useState<'idle' | 'running' | 'success' | 'failure'>('idle');

  // Descarga (repo)
  const [dRunning, setDRunning] = useState<boolean>(false);
  const [dPercent, setDPercent] = useState<number>(0);
  const [dLabel, setDLabel] = useState<string>('');

  // Derivados
  const sel = drives.find((d) => d.letter === selected);
  const isVentoy = (sel?.volumeLabel || '').toUpperCase() === 'VENTOY';

  const canVentoy = !!selected && !!exePath && !vRunning && !dRunning;
  const canCopyToUsb = !!selected && isVentoy && !vRunning && !dRunning;

  // Listeners (una sola vez)
  useEffect(() => {
    const offProgress = window.api.onVentoyProgress(({ percent, state }) => {
      if (typeof percent === 'number') setVPercent(percent);
      if (state) setVState(state as any);
    });
    const offDone = window.api.onVentoyDone((final) => {
      setVRunning(false);
      setVState((final.state as any) || 'failure');
      if (typeof final.percent === 'number') setVPercent(final.percent);
      if (final.workdir) setLog((l) => (l ? l + '\n' : '') + `Ventoy workdir: ${final.workdir}`);
      if (final.logTail) setLog((l) => (l ? `${l}\n` : '') + final.logTail);
      if (final.state === 'success') {
        // refrescar para que aparezca etiqueta VENTOY y habilite la copia
        refresh();
      }
    });

    const offRepoProg = window.api.onRepoProgress(({ percent, filename }) => {
      setDRunning(true);
      setDPercent(typeof percent === 'number' ? percent : 0);
      if (filename) setDLabel(filename);
    });
    const offRepoDone = window.api.onRepoDone(({ ok, outPath, error }) => {
      setDRunning(false);
      if (ok) setLog((l) => (l ? `${l}\n` : '') + `Descarga completa: ${outPath}`);
      else setLog((l) => (l ? `${l}\n` : '') + `Descarga fallida: ${error}`);
    });

    return () => {
      offProgress();
      offDone();
      offRepoProg();
      offRepoDone();
    };
  }, []);

  // Bootstrap
  useEffect(() => {
    (async () => {
      try {
        const p = await window.api.ventoyDefaultPath();
        if (p) setExePath(p);
      } catch {}
    })();
    refresh();
    loadRepo();
  }, []);

  // Acciones
  async function refresh() {
    try {
      setDrives(await window.api.listDrives());
    } catch (e: any) {
      setLog(String(e?.message || e));
    }
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
    setVRunning(true);
    setVPercent(0);
    setVState('running');
    try {
      const res = await window.api.ventoyStart({
        exePath,
        mode,
        targetType: 'Drive',
        target: selected,
        flags: { gpt: mode === 'install' },
      });
      if (res?.workdir) {
        setLog((l) => (l ? l + '\n' : '') + `Ventoy workdir: ${res.workdir}`);
      }
    } catch (e: any) {
      setVRunning(false);
      setVState('failure');
      setLog(String(e?.message || e));
    }
  }

  // Opción “bloqueante” por si el progreso en vivo no anda
  async function installLegacy() {
    setLog('');
    setVRunning(true);
    try {
      const res = await window.api.ventoyRun({
        exePath,
        mode: 'install',
        targetType: 'Drive',
        target: selected,
        flags: { gpt: true },
      });
      setLog((l) => (l ? l + '\n' : '') + `[legacy] ${res.status} percent=${res.percent ?? 'n/a'}`);
      if (res.status === 'success') refresh();
    } catch (e: any) {
      setLog(String(e?.message || e));
    } finally {
      setVRunning(false);
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
        const v = await window.api.hashVerify({ filePath: outPath!, sha256: item.sha256 || '' });
        setLog(
          (l) =>
            (l ? `${l}\n` : '') +
            `Verificación: SHA256=${v.digest} ${item.sha256 ? `(match=${v.ok})` : '(sin esperado)'}`
        );
      }
    } catch (e: any) {
      setLog((l) => (l ? `${l}\n` : '') + String(e?.message || e));
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
        url: item.url,
        driveLetter: selected, // descarga directa al USB
        destName: item.name, // nombre final en el USB
        sha256: item.sha256 || '', // verificación si está disponible
      });
      if (ok) {
        const ver = item.sha256 ? ` (match=${match})` : ' (sin esperado)';
        setLog(
          (l) => (l ? `${l}\n` : '') + `Copiado directo a USB: ${outPath}\nSHA256=${digest}${ver}`
        );
      }
    } catch (e: any) {
      setLog((l) => (l ? `${l}\n` : '') + `Error al copiar directo: ${String(e?.message || e)}`);
    } finally {
      setDRunning(false);
    }
  }

  // UI
  return (
    <div style={{ padding: 16, fontFamily: 'system-ui' }}>
      <h2>🧪 PQ-USB Creator (DEV)</h2>

      {/* Repo */}
      <section style={{ border: '1px solid #444', borderRadius: 8, padding: 12, marginBottom: 12 }}>
        <h3>Repo</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            style={{ flex: 1 }}
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="http://PQS/"
          />
          <button onClick={loadRepo}>Cargar</button>
        </div>

        {/* Barra de descarga */}
        {dRunning && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4 }}>Descargando: {dLabel}</div>
            <div style={{ height: 10, background: '#222', borderRadius: 6, overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${Math.max(0, Math.min(100, dPercent))}%`,
                  background: '#2a7',
                  transition: 'width .2s linear',
                }}
              />
            </div>
            <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>{dPercent}%</div>
          </div>
        )}

        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Nombre</th>
              <th>SHA256</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {repo.map((it) => (
              <tr key={it.name}>
                <td>{it.name}</td>
                <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{it.sha256?.slice(0, 16)}...</td>
                <td>
                  <button onClick={() => download(it)} disabled={vRunning || dRunning}>
                    Bajar & verificar
                  </button>
                  <button
                    onClick={() => copyToUSB(it)}
                    disabled={!canCopyToUsb}
                    style={{ marginLeft: 8 }}
                  >
                    Copiar directo a {selected || 'USB'}
                  </button>
                  {!isVentoy && selected && (
                    <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.7 }}>
                      (instalá Ventoy primero)
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {repo.length === 0 && (
              <tr>
                <td colSpan={3} style={{ opacity: 0.7 }}>
                  Sin items
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {/* Ventoy + Drives */}
      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ border: '1px solid #444', borderRadius: 8, padding: 12 }}>
          <h3>1) Pendrives</h3>
          <button onClick={refresh} disabled={vRunning || dRunning}>
            Refrescar
          </button>
          <ul>
            {drives.map((d) => (
              <li key={d.letter}>
                <label>
                  <input
                    type="radio"
                    name="drive"
                    value={d.letter}
                    onChange={() => setSelected(d.letter)}
                    disabled={vRunning || dRunning}
                  />
                  {d.letter} — {d.volumeLabel || 'sin etiqueta'} — {d.sizeDisplay} GB — {d.model} (Phy #
                  {d.physIndex})
                </label>
              </li>
            ))}
          </ul>
        </div>

        <div style={{ border: '1px solid #444', borderRadius: 8, padding: 12 }}>
          <h3>2) Ventoy</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              style={{ flex: 1 }}
              value={exePath}
              onChange={(e) => setExePath(e.target.value)}
              placeholder="Ruta a Ventoy2Disk.exe"
              disabled={vRunning || dRunning}
            />
            <button onClick={pickExe} disabled={vRunning || dRunning}>
              Buscar EXE
            </button>
          </div>

          <div style={{ marginTop: 8 }}>
            <button disabled={!canVentoy} onClick={() => startVentoy('install')}>
              Instalar (GPT)
            </button>
            <button
              disabled={!canVentoy}
              onClick={() => startVentoy('update')}
              style={{ marginLeft: 8 }}
            >
              Actualizar
            </button>
            <button disabled={!canVentoy} onClick={installLegacy} style={{ marginLeft: 8 }}>
              Instalar (bloqueante)
            </button>
          </div>

          {/* Estado USB seleccionado */}
          <div style={{ fontSize: 12, opacity: 0.8, marginTop: 6 }}>
            Estado USB {selected || ''}:{' '}
            {selected ? (isVentoy ? 'VENTOY detectado ✅' : 'sin Ventoy (instalar borrará el contenido)') : '—'}
          </div>

          {/* Progreso Ventoy */}
          <div style={{ marginTop: 12 }}>
            <div style={{ height: 12, background: '#222', borderRadius: 6, overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${Math.max(0, Math.min(100, vPercent))}%`,
                  background: vState === 'failure' ? '#b33' : '#3b7',
                  transition: 'width .2s linear',
                }}
              />
            </div>
            <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>
              {vState === 'running'
                ? `Procesando... ${vPercent ?? 0}%`
                : vState === 'success'
                ? `Completado 100%`
                : vState === 'failure'
                ? `Falló`
                : 'Listo'}
            </div>

          </div>

          <p style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>
            ⚠️ Instalar borra el USB. Verificá la letra.
          </p>
        </div>
      </section>

      {/* Logs */}
      <section style={{ marginTop: 16 }}>
        <h3>Logs</h3>
        <textarea
          readOnly
          value={log}
          style={{ width: '100%', height: 200, fontFamily: 'ui-monospace' }}
        />
      </section>
    </div>
  );
}
