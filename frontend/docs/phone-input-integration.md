> Stable checkpoint update: see [integration-readiness.md](integration-readiness.md) and [stable-client-checkpoint.md](stable-client-checkpoint.md) for current verification and phase gates. Earlier counts/approval/public-version statements below are historical P0/b187 evidence, not a claim of current runtime state. Hosting owns activation/publication; main performs no real-device/key/provider testing. Unavailable/empty coach surfaces are hidden from the stable main stage.

# Raw phone microphone — P0 client integration

This iteration replaces the phone-side recognition prototype with **raw audio**. The phone calls getUserMedia only after an explicit Start, attaches a live audio track to its negotiated sendonly RTCRtpSender, and acknowledges capture after attachment. Desktop receives an actual remote MediaStream. No phone recognizer, recording, speaker playback or desktop-microphone fallback is used.

Global App settings → Connections is outside projects and needs no ChatGPT login. Connect phone creates a genuine service offer/QR. The phone consumes the one-use `pairingId.token` fragment into memory, removes it from browser history, confirms joining, and keeps capture off until Start. Source selection, signaling answer, matching peer/control handshake, capture permission and actual audio receipt remain separate facts. No fake QR/code/Connected is generated while capability is unavailable.

## Actual host contract

The host-owned v1 schema is copied in [connections-wire-v1.md](connections-wire-v1.md). Same-origin `/api/connections` advertises actual readiness. Anonymous session bootstrap provides a CSRF token in memory and encrypted HttpOnly visitor cookies; writes require same-origin/JSON/CSRF on the server. Main adds no endpoints, proxy, database, secret binding or external relay.

`ConnectionsClient` implements bounded20second fetch/body requests. `createPhoneSignaling` maps real offer/claim/answer/poll/revoke operations, validates strict22-character ID +43-character token, same-origin QR and expiring SDP responses. Signaling polls at most once per second, is abortable, and never carries audio. Pending offers use actual10minute service expiry; a30second RTC handshake deadline starts only after negotiation can proceed.

`WebRtcPhoneTransport` implements receiver/sender peers with non-trickle ICE and versioned ordered control envelopes. Matching hello, pairing identity and monotonic sequence establish paired state; heartbeat/link failure tears down the local peer. Explicit disconnect sends a control event, stops local media and revokes signaling. Metadata deletion alone is not claimed to terminate a live P2P peer. Session expiry closes the peer. Initial `iceServers:[]` supports same-network/best-effort operation; no universal cross-network connectivity or STUN/TURN is promised.

## Capture and consumer seams

`RawMicrophoneCapture` owns raw tracks and permission. Pending permission is not capture; Stop/disposal/disconnect invalidates late permission or attachment. Mute disables outgoing user audio; Stop/background/page exit releases tracks. Reconnect never automatically reopens the microphone. The browser may retain a hardware indicator while muted; Stop releases the capture track.

`PhoneVoiceController` exposes `getRemoteStream()`, `receivingAudio`, `capturing` and transport mode independently. Valid media received before hello is retained internally and published after Connected. An optional `PhoneAudioProcessorPort` can consume the selected raw stream. **No genuine raw-audio speech processor is configured yet.** The UI therefore says audio received / speech processing not connected. Pairing, saved/verified key or raw transport never proves transcription, generation, GPT-Live or coach readiness. The old transcript-only adapter remains explicitly test/prototype compatibility, never an automatic raw-mic fallback.

## Runtime ownership and verification

Hosting owns encrypted visitor sessions, key storage/verification, temporary R2 SDP/rate-limit metadata and provider checks. Required runtime resources are `CONNECTIONS_METADATA` and server-only `CONNECTIONS_MASTER_SECRET`; main has not configured them. Parent requested bundled approval for these resources, one-hour cookies, ten-minute pairing, no external relay and no stored audio/transcripts. Missing resources keep real capabilities unavailable. Only the older b187 public checkpoint is deployed until hosting says otherwise.

Frontend typecheck/build and106 unit/server tests pass. Two functional development-browser scenarios use actual PeerConnections across isolated visitors with **synthetic AudioContext media and mocked HTTP**, alongside the existing regressions. No physical microphone, real phone, OS permission, provider key or paid/provider call was used. Host reports13 separate mocked backend/CAS/crypto/provider tests. Final browser counts, source identity and independent QA limits are recorded in the batch manifest. Real mobile lifecycle, network reachability and live visitor-service operation remain separate verification.
