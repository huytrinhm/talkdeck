import type { Page } from "@playwright/test";
/** Installed before app load; neither browser recognizer nor physical audio can run. */
export async function installSpeechSafety(page: Page, rawMedia = false) {
  await page.context().addInitScript(
    ({ rawMedia }) => {
      class Recognition {
        continuous = true;
        interimResults = true;
        lang = "en-US";
        onstart: (() => void) | null = null;
        onresult: ((event: unknown) => void) | null = null;
        onerror: ((event: unknown) => void) | null = null;
        onend: (() => void) | null = null;
        start() {
          (window as any).__safeRecognition = this;
          queueMicrotask(() => this.onstart?.());
        }
        abort() {}
      }
      Object.defineProperty(window, "SpeechRecognition", {
        value: Recognition,
        writable: false,
        configurable: false,
      });
      Object.defineProperty(window, "webkitSpeechRecognition", {
        value: Recognition,
        writable: false,
        configurable: false,
      });
      const media = async () => {
        if (!rawMedia)
          throw new DOMException(
            "Physical microphone blocked",
            "NotAllowedError",
          );
        const w = window as any;
        w.__rawMediaCalls = (w.__rawMediaCalls ?? 0) + 1;
        if (w.__denyRawMedia)
          throw new DOMException("Fixture denied", "NotAllowedError");
        const audio = new AudioContext(),
          source = audio.createOscillator(),
          destination = audio.createMediaStreamDestination();
        source.connect(destination);
        source.start();
        await audio.resume();
        const track = destination.stream.getAudioTracks()[0],
          stop = track.stop.bind(track);
        let stopped = false;
        track.stop = () => {
          if (stopped) return;
          stopped = true;
          source.stop();
          void audio.close();
          stop();
        };
        w.__rawMediaStream = destination.stream;
        return destination.stream;
      };
      if (navigator.mediaDevices)
        Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
          value: media,
          writable: false,
          configurable: false,
        });
      else
        Object.defineProperty(navigator, "mediaDevices", {
          value: { getUserMedia: media },
        });
    },
    { rawMedia },
  );
}
export async function configurePhoneFixture(
  page: Page,
  mode: "raw-audio" | "transcript" = "transcript",
) {
  await page.evaluate(async (mode) => {
    const url =
      performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .find((name) => name.includes("/src/services/phoneVoice.ts")) ??
      "/src/services/phoneVoice.ts";
    const { phoneVoice } = await import(/* @vite-ignore */ url);
    let receive = (event: unknown) => {
      void event;
    };
    phoneVoice.configure({
      available: true,
      mode,
      attachStream: async (stream: MediaStream) => {
        (window as any).__attachedRawStream = stream;
      },
      detachStream: () => {},
      subscribe: (fn: any) => {
        receive = fn;
        return () => {};
      },
      createPairing: async () => ({
        code: "TEST-ONLY-CODE",
        qrUrl: "https://talkdeck.example/pair/test-fixture",
        expiresAt: Date.now() + 60000,
      }),
      join: async () => {},
      disconnect: () => {},
      setActive: () => {},
      setMuted: () => {},
      reportCapture: () => {},
      sendSpeech: (speech: any) => {
        (window as any).__sentSpeech = speech;
      },
    });
    (window as any).__phoneFixture = {
      emit: (event: any) => receive(event),
      controller: phoneVoice,
    };
  }, mode);
}
