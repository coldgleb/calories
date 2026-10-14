import { useEffect, useRef, useState } from 'preact/hooks'
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url'

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'] as const

interface Detector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>
}

/** Native BarcodeDetector where it supports EAN, otherwise the ZXing WebAssembly ponyfill. */
async function createDetector(): Promise<Detector> {
  const Native = (globalThis as { BarcodeDetector?: any }).BarcodeDetector
  if (Native) {
    try {
      const supported: string[] = await Native.getSupportedFormats()
      if (supported.includes('ean_13')) return new Native({ formats: FORMATS.filter((f) => supported.includes(f)) })
    } catch {
      // fall through to the ponyfill
    }
  }
  const { BarcodeDetector, prepareZXingModule } = await import('barcode-detector/ponyfill')
  prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path),
    },
  })
  return new BarcodeDetector({ formats: [...FORMATS] })
}

export function Scanner(props: { onDetected: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState('')
  const [manual, setManual] = useState('')

  useEffect(() => {
    let stream: MediaStream | undefined
    let stopped = false
    let timer: number | undefined

    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Камера недоступна в этом браузере')
        const detectorPromise = createDetector()
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        })
        if (stopped) return stream.getTracks().forEach((t) => t.stop())
        const video = videoRef.current!
        video.srcObject = stream
        await video.play()
        const detector = await detectorPromise

        const tick = async () => {
          if (stopped) return
          try {
            if (video.readyState >= 2) {
              const [code] = await detector.detect(video)
              if (code?.rawValue && !stopped) {
                stopped = true
                navigator.vibrate?.(60)
                props.onDetected(code.rawValue)
                return
              }
            }
          } catch (e) {
            console.error(e)
          }
          timer = window.setTimeout(tick, 200)
        }
        tick()
      } catch (e) {
        const err = e as DOMException
        setError(
          err.name === 'NotAllowedError'
            ? 'Нет доступа к камере. Разрешите его в настройках браузера или введите код вручную.'
            : err.name === 'NotFoundError'
              ? 'Камера не найдена. Введите код вручную.'
              : `Не удалось запустить камеру: ${err.message}`,
        )
      }
    }

    start()
    return () => {
      stopped = true
      clearTimeout(timer)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  const code = manual.replace(/\D/g, '')

  return (
    <div class="scanner">
      <video ref={videoRef} class="scanner-video" playsInline muted />
      <div class="scanner-frame" aria-hidden="true" />
      <button class="icon-btn scanner-close" onClick={props.onClose} aria-label="Закрыть">
        ✕
      </button>
      <div class="scanner-panel">
        <p class="scanner-hint">{error || 'Наведите камеру на штрихкод'}</p>
        <form
          class="row"
          onSubmit={(e) => {
            e.preventDefault()
            if (code.length >= 8) props.onDetected(code)
          }}
        >
          <input
            class="grow scanner-input"
            inputMode="numeric"
            placeholder="или введите цифры кода"
            value={manual}
            onInput={(e) => setManual(e.currentTarget.value)}
          />
          <button class="btn primary" disabled={code.length < 8}>
            Найти
          </button>
        </form>
      </div>
    </div>
  )
}
