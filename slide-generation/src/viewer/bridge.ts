import { acknowledgmentSchema, incomingSchema, type OutboundMessage, type ViewerAcknowledgment } from './protocol.js';
export interface ViewerBridge {
  send(message: OutboundMessage): void;
  dispose(): void;
}
/** srcdoc is supplied by createViewerDocument on the trusted backend. */
export function mountViewer(iframe: HTMLIFrameElement, channel: string, srcdoc: string,
  onAcknowledgment: (ack: ViewerAcknowledgment) => void): ViewerBridge {
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(channel)) throw new Error('Invalid viewer channel');
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.setAttribute('referrerpolicy', 'no-referrer');
  iframe.setAttribute('title', 'Slide presentation');
  const owner = iframe.ownerDocument.defaultView;
  if (!owner) throw new Error('Iframe has no owner window');
  let disposed = false;
  const receive = (event: MessageEvent) => {
    if (disposed || event.source !== iframe.contentWindow || event.origin !== 'null') return;
    const parsed = acknowledgmentSchema.safeParse(event.data);
    if (!parsed.success || parsed.data.channel !== channel) return;
    onAcknowledgment(parsed.data);
  };
  owner.addEventListener('message', receive);
  iframe.srcdoc = srcdoc;
  return {
    send(message) {
      if (disposed) throw new Error('Viewer bridge is disposed');
      const parsed = incomingSchema.parse({ ...message, version: 1, channel });
      if (!iframe.contentWindow) throw new Error('Viewer is not mounted');
      // Opaque sandbox origins cannot be named as a targetOrigin; sender+channel checks are mandatory.
      iframe.contentWindow.postMessage(parsed, '*');
    },
    dispose() { disposed = true; owner.removeEventListener('message', receive); iframe.removeAttribute('srcdoc'); },
  };
}
