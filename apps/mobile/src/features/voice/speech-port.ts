/**
 * SpeechPort: one small interface, one real adapter (expo-speech-recognition)
 * and one fake (ADR-029 rule 4). The composer only talks to the port.
 */

export interface SpeechStartOptions {
  lang: string
  onInterim(text: string): void
  onFinal(text: string): void
  onError(message: string): void
  onEnd(): void
}

export interface SpeechPort {
  available(): Promise<boolean>
  requestPermission(): Promise<boolean>
  start(options: SpeechStartOptions): Promise<void>
  stop(): void
  cancel(): void
  /** True when recognition can run without sending audio off the device. */
  onDevice(): boolean
}

export const SPEECH_DISCLOSURE = 'Speech may be processed by Apple or Google when on-device recognition is unavailable.'

/**
 * True when the platform can recognize speech without sending audio off the
 * device. Synchronous native call; false when the module is missing (Expo Go),
 * so the remote-processing disclosure shows.
 */
function supportsOnDevice(): boolean {
  try {
    const m = require('expo-speech-recognition') as { ExpoSpeechRecognitionModule: { supportsOnDeviceRecognition(): boolean } }
    return m.ExpoSpeechRecognitionModule.supportsOnDeviceRecognition()
  } catch {
    return false
  }
}

/**
 * The listeners of the recognition session that is running now. Module-level so
 * every teardown path drops them: `end`, `error` and `cancel` all clear them,
 * and a new `start` clears any leftovers before subscribing (I5 — a leaked
 * `result` listener produced duplicate `onFinal` calls on the next session).
 */
let activeSubs: { remove(): void }[] = []

function clearSubs(): void {
  const subs = activeSubs
  activeSubs = []
  for (const s of subs) {
    s.remove()
  }
}

export const realSpeech: SpeechPort = {
  async available() {
    const { ExpoSpeechRecognitionModule } = await import('expo-speech-recognition')
    try {
      return ExpoSpeechRecognitionModule.isRecognitionAvailable()
    } catch {
      return false
    }
  },
  async requestPermission() {
    const { ExpoSpeechRecognitionModule } = await import('expo-speech-recognition')
    const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync()
    return Boolean(result.granted)
  },
  async start(options) {
    const { ExpoSpeechRecognitionModule } = await import('expo-speech-recognition')
    clearSubs()
    activeSubs = [
      ExpoSpeechRecognitionModule.addListener('result', event => {
        const text = event.results?.[0]?.transcript ?? ''
        if (event.isFinal) {
          options.onFinal(text)
        } else {
          options.onInterim(text)
        }
      }),
      ExpoSpeechRecognitionModule.addListener('error', event => {
        // An error ends the session, and `end` does not always follow it.
        clearSubs()
        options.onError(event.message || event.error || 'Speech recognition failed.')
      }),
      ExpoSpeechRecognitionModule.addListener('end', () => {
        clearSubs()
        options.onEnd()
      })
    ]
    // On-device recognition when the platform supports it, which is what the
    // composer's disclosure and the Info.plist string promise (I6).
    ExpoSpeechRecognitionModule.start({
      lang: options.lang,
      interimResults: true,
      continuous: false,
      requiresOnDeviceRecognition: supportsOnDevice(),
      addsPunctuation: true
    })
  },
  stop() {
    // `stop` asks for the final transcript, so the listeners must stay until
    // `result`/`end` arrive; `end` (or `error`) removes them.
    void import('expo-speech-recognition').then(m => m.ExpoSpeechRecognitionModule.stop())
  },
  cancel() {
    // `cancel` discards the session: drop the listeners now, so nothing fires
    // into a screen that has already unmounted.
    clearSubs()
    void import('expo-speech-recognition').then(m => m.ExpoSpeechRecognitionModule.abort())
  },
  onDevice: supportsOnDevice
}

export function createFakeSpeech(script: { available?: boolean; granted?: boolean; onDevice?: boolean; transcript?: string } = {}): SpeechPort & { active: boolean } {
  let current: SpeechStartOptions | null = null
  const fake = {
    active: false,
    async available() {
      return script.available ?? true
    },
    async requestPermission() {
      return script.granted ?? true
    },
    async start(options: SpeechStartOptions) {
      current = options
      fake.active = true
      options.onInterim((script.transcript ?? 'hello').slice(0, 3))
    },
    stop() {
      if (current) {
        current.onFinal(script.transcript ?? 'hello')
        current.onEnd()
      }
      current = null
      fake.active = false
    },
    cancel() {
      current?.onEnd()
      current = null
      fake.active = false
    },
    onDevice() {
      return script.onDevice ?? true
    }
  }
  return fake
}
