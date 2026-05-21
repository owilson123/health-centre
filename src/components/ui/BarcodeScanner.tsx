'use client'

import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { X, Flashlight } from 'lucide-react'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { NotFoundException } from '@zxing/library'

interface Props {
  onDetect: (code: string) => void
  onClose: () => void
}

export function BarcodeScanner({ onDetect, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const readerRef = useRef<BrowserMultiFormatReader | null>(null)
  const detectedRef = useRef(false)
  const [torch, setTorch] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  useEffect(() => {
    let controls: { stop: () => void } | null = null

    async function startScan() {
      try {
        const reader = new BrowserMultiFormatReader()
        readerRef.current = reader

        controls = await reader.decodeFromConstraints(
          {
            video: {
              facingMode: { ideal: 'environment' },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          },
          videoRef.current!,
          (result, err) => {
            if (result && !detectedRef.current) {
              detectedRef.current = true
              // Haptic feedback on supported devices
              if (navigator.vibrate) navigator.vibrate(80)
              onDetect(result.getText())
            }
            if (err && !(err instanceof NotFoundException)) {
              // Non-critical scan errors (no barcode in frame) — ignore
            }
          }
        )

        // Grab the stream so we can toggle torch later
        if (videoRef.current?.srcObject) {
          streamRef.current = videoRef.current.srcObject as MediaStream
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Camera unavailable'
        if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('notallowed')) {
          setError('Camera permission denied. Please allow camera access in your browser settings.')
        } else {
          setError('Could not access the camera. Try closing other apps using the camera.')
        }
      }
    }

    startScan()

    return () => {
      controls?.stop()
      readerRef.current = null
      streamRef.current = null
    }
  }, [onDetect])

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (track as any).applyConstraints({ advanced: [{ torch: !torch }] })
      setTorch(t => !t)
    } catch {
      // Torch not supported on this device
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black flex flex-col">
      {/* Camera view */}
      <div className="flex-1 relative overflow-hidden">
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover"
          playsInline
          muted
        />

        {/* Vignette overlay — dark edges, transparent center window */}
        {!error && (
          <div className="absolute inset-0 flex items-center justify-center">
            {/* Dark mask with hole */}
            <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
              <defs>
                <mask id="scanMask">
                  <rect width="100%" height="100%" fill="white" />
                  {/* Transparent scanning window (centred, 72% wide, 40% tall) */}
                  <rect x="14%" y="30%" width="72%" height="40%" rx="16" fill="black" />
                </mask>
              </defs>
              <rect width="100%" height="100%" fill="rgba(0,0,0,0.62)" mask="url(#scanMask)" />
            </svg>

            {/* Scanning window frame */}
            <div className="relative" style={{ width: '72%', height: '40%' }}>
              {/* Corner accents */}
              {(['tl','tr','bl','br'] as const).map(corner => (
                <span key={corner} className={`absolute w-7 h-7 ${
                  corner === 'tl' ? 'top-0 left-0 border-t-2 border-l-2 rounded-tl-xl' :
                  corner === 'tr' ? 'top-0 right-0 border-t-2 border-r-2 rounded-tr-xl' :
                  corner === 'bl' ? 'bottom-0 left-0 border-b-2 border-l-2 rounded-bl-xl' :
                                    'bottom-0 right-0 border-b-2 border-r-2 rounded-br-xl'
                } border-indigo-400`} />
              ))}

              {/* Animated scan line */}
              <motion.div
                className="absolute left-2 right-2 h-0.5 bg-gradient-to-r from-transparent via-indigo-400 to-transparent rounded-full shadow-lg"
                style={{ boxShadow: '0 0 8px 2px rgba(99,102,241,0.6)' }}
                animate={{ top: ['10%', '85%', '10%'] }}
                transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
              />
            </div>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center p-8">
            <div className="rounded-2xl bg-[#1a1a1a] border border-white/10 p-6 text-center max-w-sm">
              <p className="text-3xl mb-3">📷</p>
              <p className="text-white font-semibold mb-2">Camera unavailable</p>
              <p className="text-sm text-white/50 leading-relaxed">{error}</p>
            </div>
          </div>
        )}

        {/* Top bar */}
        <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 pt-[max(env(safe-area-inset-top),16px)] pb-4">
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-full bg-black/50 backdrop-blur flex items-center justify-center active:scale-90 transition-transform"
          >
            <X size={18} className="text-white" />
          </button>

          <button
            onClick={toggleTorch}
            className={`w-10 h-10 rounded-full backdrop-blur flex items-center justify-center active:scale-90 transition-all ${
              torch ? 'bg-yellow-400/30 border border-yellow-400/50' : 'bg-black/50'
            }`}
          >
            <Flashlight size={18} className={torch ? 'text-yellow-300' : 'text-white'} />
          </button>
        </div>

        {/* Bottom instruction */}
        {!error && (
          <div className="absolute bottom-8 left-0 right-0 flex justify-center">
            <div className="px-4 py-2 rounded-full bg-black/50 backdrop-blur">
              <p className="text-sm text-white/70">Point at a food barcode</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
