import { useEffect, useRef, useState, type RefObject } from 'react';
import { mountViewer, type ViewerBridge } from '../../slide-generation/src/viewer/bridge';
import type { IncomingMessage } from '../../slide-generation/src/viewer/protocol';
import type { ProjectConnection } from './api';

export function Viewer({ connection, message, blackout, onPaint, className = '', frameRef }: {
  connection: ProjectConnection; message?: IncomingMessage; blackout: boolean;
  onPaint?: (state: string) => void; className?: string; frameRef?: RefObject<HTMLDivElement | null>;
}) {
  const iframe = useRef<HTMLIFrameElement>(null), bridge = useRef<ViewerBridge>(undefined);
  const ready = useRef(false), latest = useRef(message), sequence = useRef(-1);
  const [error, setError] = useState('');
  const send = (next?: IncomingMessage) => {
    if (!next || next.channel !== connection.session?.channel || !ready.current || next.sequence <= sequence.current) return;
    try { bridge.current?.send(next); sequence.current = next.sequence; }
    catch (error) { setError(String(error)); }
  };
  latest.current = message;
  useEffect(() => {
    if (!iframe.current || !connection.session) return;
    let mounted = true; ready.current = false; sequence.current = -1;
    bridge.current = mountViewer(iframe.current, connection.session.channel, connection.session.viewerDocument, ack => {
      if (!mounted) return;
      if (ack.type === 'ready') {
        ready.current = true;
        void connection.viewer().then(view => { if (mounted) { send(view.message); send(latest.current); } }).catch(error => setError(String(error)));
      }
      if (ack.type === 'painted' || ack.type === 'settled') onPaint?.(`${ack.type === 'painted' ? 'Painted' : 'Settled'} · ${ack.revision?.slice(0, 8)}`);
      if (ack.type === 'refused') setError(`Slide viewer refused this update: ${ack.code}`);
      void connection.acknowledge(ack).catch(error => { if (mounted) setError(`Viewer acknowledgment failed: ${error.message}`); });
    });
    return () => { mounted = false; ready.current = false; bridge.current?.dispose(); };
  }, [connection, connection.session?.channel]);
  useEffect(() => { send(message); }, [message]);
  return <div ref={frameRef} className={`canonical-viewer ${className}`} data-testid="canonical-viewer">
    <iframe ref={iframe} title="Canonical slide" />
    {blackout && <div className="blackout" aria-label="Audience blackout" />}
    {error && <div className="viewer-error" role="alert">{error}</div>}
  </div>;
}
