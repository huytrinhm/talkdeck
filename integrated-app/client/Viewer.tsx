import { useEffect, useRef, useState, type RefObject } from 'react';
import { mountViewer, type ViewerBridge } from '../../slide-generation/src/viewer/bridge';
import type { IncomingMessage } from '../../slide-generation/src/viewer/protocol';
import type { ProjectConnection } from './api';
import type { NavigationTarget } from './navigation';

export function Viewer({ connection, message, navigation, blackout, onPaint, className = '', frameRef }: {
  connection: ProjectConnection; message?: IncomingMessage; navigation?: NavigationTarget; blackout: boolean;
  onPaint?: (state: string) => void; className?: string; frameRef?: RefObject<HTMLDivElement | null>;
}) {
  const iframe = useRef<HTMLIFrameElement>(null), bridge = useRef<ViewerBridge>(undefined);
  const ready = useRef(false), sequence = useRef(0), lastKey = useRef(''), displayedSlide = useRef('');
  const latest = useRef({ message, navigation, onPaint }); latest.current = { message, navigation, onPaint };
  // The mounted viewer has its own increasing display sequence. Only genuine server
  // publications are acknowledged, with their original issued sequence restored.
  const issued = useRef(new Map<number, IncomingMessage | undefined>());
  const [error, setError] = useState('');
  const render = () => {
    if (!ready.current) return;
    const { message: server, navigation: target } = latest.current;
    const matches = server?.type === 'publish' && server.slideId === target?.slideId
      && server.build === target.build && server.revision === target.revision;
    const next = target ? (matches ? server : target.preview) : server;
    if (!next || next.channel !== connection.session?.channel) return;
    const local = next === target?.preview;
    const key = `${local ? 'local' : 'server'}:${next.type === 'publish' ? next.publicationId : ''}:${next.sequence}`;
    if (key === lastKey.current) return;
    try {
      const displaySequence = ++sequence.current;
      issued.current.set(displaySequence, local ? undefined : next);
      while (issued.current.size > 256) issued.current.delete(issued.current.keys().next().value!);
      const switching = next.type === 'publish' && next.slideId !== displayedSlide.current;
      bridge.current?.send({ ...next, sequence: displaySequence,
        ...(switching && next.type === 'publish' ? { motion: { ...next.motion, durationMs: 0 } } : {}) });
      if (next.type === 'publish') displayedSlide.current = next.slideId;
      lastKey.current = key; setError('');
    } catch (error) { setError(String(error)); }
  };
  useEffect(() => {
    if (!iframe.current || !connection.session) return;
    let mounted = true; ready.current = false; sequence.current = 0; lastKey.current = ''; displayedSlide.current = ''; issued.current.clear();
    bridge.current = mountViewer(iframe.current, connection.session.channel, connection.session.viewerDocument, ack => {
      if (!mounted) return;
      if (ack.type === 'ready') {
        ready.current = true; render();
        // Startup/reconnect recovery runs independently of already available content.
        void connection.refresh().catch(error => { if (mounted) setError(String(error)); });
      }
      if (ack.type === 'painted' || ack.type === 'settled') latest.current.onPaint?.(`${ack.type === 'painted' ? 'Painted' : 'Settled'} · ${ack.revision?.slice(0, 8)}`);
      if (ack.type === 'refused') setError(`Slide viewer refused this update: ${ack.code}`);
      const original = ack.sequence === undefined ? undefined : issued.current.get(ack.sequence);
      if (ack.type !== 'ready' && !original) return;
      void connection.acknowledge(original ? { ...ack, sequence: original.sequence } : ack)
        .catch(error => { if (mounted) setError(`Viewer acknowledgment failed: ${error.message}`); });
    });
    return () => { mounted = false; ready.current = false; bridge.current?.dispose(); };
  }, [connection, connection.session?.channel]);
  useEffect(render, [message, navigation]);
  return <div ref={frameRef} className={`canonical-viewer ${className}`} data-testid="canonical-viewer">
    <iframe ref={iframe} title="Canonical slide" />
    {blackout && <div className="blackout" aria-label="Audience blackout" />}
    {error && <div className="viewer-error" role="alert">{error}</div>}
  </div>;
}
