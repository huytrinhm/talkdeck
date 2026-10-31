# Connections wire contract v1 — agreed implementation target, not activated

Base: same-origin `/api/connections`. No ChatGPT login. Server owner: hosting. Frontend owner: main UI. Public b187 checkpoint is deployed; this new backend belongs to a later batch.

Resources awaiting user/native approval: one generated server-only session/encryption master secret; transient R2 signaling and rate-limit metadata; encrypted BYOK cookie lifetime1hour. Pairing codes expire after10minutes. No database, stored audio/transcripts, external STUN/TURN, real key test or paid API call. `iceServers: []` means an initial same-network/best-effort connection, not universal cross-network support.

## Common security and errors

JSON responses use `Cache-Control: no-store`. Writes require exact same-origin `Origin`, JSON for POST, a signed/encrypted HttpOnly Secure SameSite=Strict visitor cookie, and `X-CSRF-Token` from session bootstrap. Request bodies are bounded; errors contain only `{error:{code}}` and optional retryAfterSeconds, never supplied key/SDP/provider error text. No request-body logging. R2 conditional writes enforce ownership/single claimant and rate limits; Worker module memory is not a session store. Missing binding/secret keeps capability unavailable and writes fail503 `service_unavailable`.

Codes: `service_unavailable`503; `origin_rejected`403; `session_required`401; `csrf_rejected`403; `invalid_request`400; `invalid_key_format`400; `not_found`404; `pairing_expired`410; `pairing_revoked`410; `pairing_claimed`409; `state_conflict`409; `rate_limited`429; `service_error`503. Do not display raw server error text. Retry only safe/idempotent operations with bounded backoff.

## Capability and visitor bootstrap

GET `/api/connections` ->
```ts
{ version:1,
  session:{ready:boolean,expiresAt?:number},
  phone:{available:boolean,transport:'webrtc',media:'raw-audio',network:'same-network',iceServers:[]},
  key:{available:boolean,configured:boolean,expiresAt?:number} }
```
`available` is true only with valid server secret + reliable metadata/rate-limit binding. It does not mean paired, capturing, provider-key-valid, transcription-ready or coach-ready.

POST `/api/connections/session` with `{}` and exact Origin -> `{csrfToken:string,expiresAt:number}` plus server-only visitor cookie. This bootstrap requires Origin/JSON and pre-session rate limiting; it does not require a prior CSRF token. A valid existing visitor session is reused. Session IDs are not returned or accepted from browser bodies. GET never silently creates/extends a session. One-hour expiry is enforced server-side, independent of browser session restoration.

## Personal key

GET `/api/connections/key` -> `{configured:boolean,expiresAt?:number}`. Requires visitor cookie. No key is returned.

POST `/api/connections/key` with `{key:string}` -> `{configured:true,expiresAt:number,validation:'not-checked'}` plus a separate encrypted HttpOnly key cookie bound to the visitor session. Save acknowledges encrypted session storage, not OpenAI validity/model connectivity. Plaintext is transient request/form state only. Replace uses the same endpoint. No upstream OpenAI call in this operation.

DELETE `/api/connections/key` -> `{configured:false}` and expires key cookie. Clear plaintext UI immediately; remove/replace/account-independent session reset must not share a key with other visitors. The server's random key-version marker invalidates copied older key cookies on remove/replace. A stolen current visitor+key cookie remains a bearer session until removal/expiry; stronger device binding is not claimed.

POST `/api/connections/key/verify` with `{}` -> `{configured:true,validation:'verified',verifiedAt:number,expiresAt:number}` after a server-only GET `https://api.openai.com/v1/models` with the sealed visitor key,10second timeout and redirects rejected. Success requires the documented models-list JSON shape. This verifies credential/model-list access only, never inference/model/credits readiness. Tests mock upstream; no test key is submitted to OpenAI. The user's explicit Check key action triggers this operation after service activation. Controlled errors: `key_required`400, `key_rejected`400, `key_forbidden`400, `provider_rate_limited`429, `provider_unavailable`502. Negative checks clear the stored verified marker. A late result after remove/replace is409 `state_conflict` with no cookie replacement. Save remains 'Save for session / Not verified'; verification is separate.

Key status/capability includes optional `validation:'not-checked'|'verified'` and `verifiedAt`. R2 holds only a random key-version/revocation marker with the visitor session metadata, never the personal key; remove/replace invalidates copied older cookies. Session, CSRF and key cookies are encrypted and bound to that server session marker. Transcription remains a separate future raw-audio consumer; verification does not enable it.

## Pairing (non-trickle ICE)

Desktop creates a recvonly audio transceiver plus control data channel, makes an offer, and waits for ICE gathering completion. No desktop microphone is opened. Browser SDP contains network metadata; it is not an audio recording.

POST `/api/connections/pairings` with `{offer:{type:'offer',sdp:string}}` -> `{pairingId:string,code:string,qrUrl:string,expiresAt:number,sessionExpiresAt:number}`. Requires owner visitor/CSRF. A code is exactly `pairingId.token`:16 random bytes base64url for ID(22characters), a dot, then32 random bytes base64url for token(43characters). It is high entropy, one-use and expires10minutes after creation; a new owner pairing revokes the prior pending pairing. `qrUrl` uses same-origin `/client/#phone?pair=<code>` fragment, never a standard API key. Phone consumes pending material into memory, replaces browser history with `#phone`, obtains its own anonymous session, and asks the user to confirm joining; scanning does not start capture.

POST `/api/connections/pairings/:id/claim` with `{code:string}` -> `{offer:{type:'offer',sdp:string},expiresAt:number,sessionExpiresAt:number}`. Phone visitor/CSRF required. Claim is atomic and bound to one phone visitor. Repeating from the same phone may return the same offer; a second visitor gets409. Expired/revoked offers cannot be claimed. Owner/phone visitor IDs and token hashes never appear in responses.

POST `/api/connections/pairings/:id/answer` with `{answer:{type:'answer',sdp:string}}` -> `{state:'answered',expiresAt:number}`. Only the claimed phone visitor can answer. Complete ICE gathering before submission. The same answer is idempotent; a competing answer is409.

GET `/api/connections/pairings/:id` -> `{state:'offered'|'claimed'|'answered',expiresAt:number,sessionExpiresAt:number,answer?:{type:'answer',sdp:string}}`. Owner or claimed phone only. Only owner receives answer. Poll while signaling, with bounded1second polling and AbortSignal. `answered` does not mean the RTC connection is established or a microphone is active.

DELETE `/api/connections/pairings/:id` -> `{revoked:true}`. Owner or claimed phone only. It revokes pending signaling and triggers metadata cleanup. Frontend `disconnect()` must also close its own RTC peer/control channel and stop sender tracks; deleting metadata alone cannot forcibly stop an already established peer-to-peer connection. After an established control-channel handshake, signaling metadata can be deleted and polling stopped; subsequent disconnect is sent on the control channel plus local peer teardown.

Expiry is enforced on all reads/writes. Cancel clears SDP/token data while retaining a short-lived revocation tombstone against in-flight writes; creating another offer invalidates/deletes the previous one. Expired reads delete the record. A bounded, cursor-based R2 sweep runs opportunistically on session bootstrap; no background scheduler is configured. Thus no exact physical-deletion deadline or automatic R2 TTL is promised without an approved cleanup/lifecycle facility. Store metadata only, never audio/transcripts or personal API keys.

## Raw media and control channel

RTC offer/answer/transport success is separate from permission and capture. Phone may negotiate a sendonly audio transceiver before permission; explicit Start calls getUserMedia then awaits replaceTrack before `reportCapture({capturing:true,permission:'granted'})`. Pause/mute/error/stop/background/disconnect/late-permission cancellation report false. Mute disables outgoing track; Stop/background/disconnect release tracks and require explicit restart.

Desktop exposes actual remote MediaStream separately from speech text. Existing domain speech processors cannot yet consume this stream; pairing success must not imply transcription/AI/coach readiness. No automatic recording, speaker playback or model call. Existing speech/coach ports remain unavailable until a genuine raw-audio consumer is agreed.

Control messages use `{v:1,sessionId:pairingId,sequence:number,type,payload}` with monotonic per-sender sequence, heartbeat and stale-session rejection. Types: `hello`, `heartbeat`, `active`, `mute`, `capture`, `disconnect`. Capture payload is `{capturing,permission}`. Real RTC connection + matching hello establish paired state; actual granted/live track acknowledgement establishes capturing. Neither server `answered` nor active intent establishes capture. Phone owns permission and raw-track lifetime.
