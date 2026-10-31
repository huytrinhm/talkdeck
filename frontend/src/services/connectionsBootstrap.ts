import { ConnectionsClient } from "./connectionsClient";
import { createPhoneSignaling } from "./phoneSignaling";
import { WebRtcPhoneTransport } from "./phonePeer";
import { phoneVoice } from "./phoneVoice";
import { personalApiKey } from "./personalApiKey";
let generation = 0;
const client = new ConnectionsClient();
/** No service is enabled by a fixture or inferred from a saved key. */
export async function initializeConnections(role: "receiver" | "sender") {
  const current = ++generation,
    capabilities = await client.capabilities();
  if (current !== generation) return;
  phoneVoice.configure(
    new WebRtcPhoneTransport({
      role,
      signaling: createPhoneSignaling(client, capabilities.phone.available),
      iceServers: capabilities.phone.iceServers,
    }),
  );
  await personalApiKey.configure(client.keyPort(capabilities.key.available));
}
