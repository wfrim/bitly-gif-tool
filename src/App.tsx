import { useState, useRef, useCallback, useEffect } from 'react'
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'
import './App.css'

type Stage = 'idle' | 'ready' | 'converting' | 'done' | 'error'

const ffmpeg = new FFmpeg()

export default function App() {
  const [stage, setStage] = useState<Stage>('idle')
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [videoURL, setVideoURL] = useState<string | null>(null)
  const [gifURL, setGifURL] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [fps, setFps] = useState(10)
  const [width, setWidth] = useState(640)
  const [speed, setSpeed] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [filename, setFilename] = useState('recording')
  const [isDragging, setIsDragging] = useState(false)
  const [loadingMessage, setLoadingMessage] = useState('')
  const [convertStage, setConvertStage] = useState<'loading-engine' | 'reading-file' | 'pass1' | 'pass2'>('loading-engine')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const currentPassRef = useRef<1 | 2>(1)
  const progressHandlerRef = useRef<((e: { progress: number; time: number }) => void) | null>(null)

  const LOADING_MESSAGES = [
    'Bit by bit, your GIF is taking shape...',
    'Shortening your video, Bitly style...',
    'Trimming the long stuff...',
    'Redirecting your frames...',
    'Clicking frames into place...',
    'Going the short route...',
    'Making it snappy...',
    'Encoding, frame by frame...',
    'Less video, more GIF...',
    'Generating your bitly-sized GIF...',
    'Shrinking it down, one frame at a time...',
    'Every pixel counts...',
  ]

  useEffect(() => {
    if (stage !== 'converting') return
    setLoadingMessage(LOADING_MESSAGES[0])
    let i = 1
    const interval = setInterval(() => {
      setLoadingMessage(LOADING_MESSAGES[i % LOADING_MESSAGES.length])
      i++
    }, 2000)
    return () => clearInterval(interval)
  }, [stage])

  const loadFile = (file: File) => {
    if (!file.type.startsWith('video/')) {
      setError('Please upload a video file (MP4, MOV, etc.)')
      return
    }
    const url = URL.createObjectURL(file)
    setVideoFile(file)
    setVideoURL(url)
    setGifURL(null)
    setStage('ready')
    if (file.size > 150 * 1024 * 1024) {
      setError(`Large file (${(file.size / 1024 / 1024).toFixed(0)}MB) — conversion will work but may take a few minutes. Try lower FPS or width to speed it up.`)
    } else {
      setError(null)
    }
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) loadFile(file)
  }, [])

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) loadFile(file)
  }

  const convert = async () => {
    if (!videoFile) return
    setStage('converting')
    setProgress(0)
    setError(null)
    currentPassRef.current = 1

    try {
      setConvertStage('loading-engine')
      if (!ffmpeg.loaded) {
        const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm'
        await ffmpeg.load({
          coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
          wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        })
      }

      // Remove previous listener using stored ref so we don't stack on reconvert
      if (progressHandlerRef.current) {
        ffmpeg.off('progress', progressHandlerRef.current)
      }
      progressHandlerRef.current = ({ progress: p }) => {
        const clamped = Math.min(1, Math.max(0, p))
        const pct = currentPassRef.current === 1
          ? Math.round(clamped * 45)
          : 45 + Math.round(clamped * 55)
        setProgress(Math.min(100, Math.max(0, pct)))
      }
      ffmpeg.on('progress', progressHandlerRef.current)

      setConvertStage('reading-file')
      const ext = videoFile.name.split('.').pop() || 'mp4'
      const inputName = `input.${ext}`
      await ffmpeg.writeFile(inputName, await fetchFile(videoFile))

      // Two-pass palette GIF for best quality / smallest size
      const speedFilter = speed !== 1 ? `setpts=PTS/${speed},` : ''

      setConvertStage('pass1')
      currentPassRef.current = 1
      await ffmpeg.exec([
        '-i', inputName,
        '-vf', `${speedFilter}fps=${fps},scale=${width}:-1:flags=lanczos,palettegen`,
        'palette.png',
      ])

      setConvertStage('pass2')
      currentPassRef.current = 2
      await ffmpeg.exec([
        '-i', inputName,
        '-i', 'palette.png',
        '-filter_complex', `${speedFilter}fps=${fps},scale=${width}:-1:flags=lanczos[x];[x][1:v]paletteuse`,
        'output.gif',
      ])

      const data = await ffmpeg.readFile('output.gif')
      const blob = new Blob([data instanceof Uint8Array ? data.slice() : data as string], { type: 'image/gif' })
      setGifURL(URL.createObjectURL(blob))
      setStage('done')
    } catch (err) {
      console.error(err)
      setError('Conversion failed. Try a shorter clip or lower the FPS/width settings.')
      setStage('error')
    }
  }

  const reset = () => {
    setStage('idle')
    setVideoFile(null)
    setVideoURL(null)
    setGifURL(null)
    setError(null)
    setProgress(0)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-logo">
          <span>🎬</span>
          <div>
            <h1>GIF Maker</h1>
            <p>for Bitly PMs</p>
          </div>
        </div>
      </header>

      <main className="app-main">
        {stage === 'idle' && (
          <div
            className={`dropzone ${isDragging ? 'dragging' : ''}`}
            onDrop={onDrop}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              onChange={onFileChange}
              style={{ display: 'none' }}
            />
            <span className="drop-icon">📁</span>
            <p className="drop-primary">Drop your screen recording here</p>
            <p className="drop-secondary">or click to browse · MP4, MOV supported</p>
            <img src={`${import.meta.env.BASE_URL}chauncey.png`} alt="Chauncey" className="chauncey-float" />
          </div>
        )}

        {(stage === 'ready' || stage === 'error') && videoURL && (
          <div className="workspace">
            <div className="panel">
              <h2>Your recording</h2>
              <video src={videoURL} controls className="video-preview" />
            </div>

            <div className="panel">
              <h2>GIF Settings</h2>

              <div className="control-group">
                <div className="control-label">
                  <span>Playback speed</span>
                  <span className="control-value">{speed}x</span>
                </div>
                <div className="speed-options">
                  {[1, 1.5, 2, 3].map((s) => (
                    <button
                      key={s}
                      className={`speed-btn ${speed === s ? 'active' : ''}`}
                      onClick={() => setSpeed(s)}
                    >{s}x</button>
                  ))}
                </div>
              </div>

              <div className="control-group">
                <div className="control-label">
                  <span>Frame rate</span>
                  <span className="control-value">{fps} fps</span>
                </div>
                <input
                  type="range" min={5} max={20} step={1}
                  value={fps} onChange={(e) => setFps(Number(e.target.value))}
                />
                <div className="range-hints">
                  <span>Smaller file</span>
                  <span>Smoother</span>
                </div>
              </div>

              <div className="control-group">
                <div className="control-label">
                  <span>Width</span>
                  <span className="control-value">{width}px</span>
                </div>
                <input
                  type="range" min={320} max={960} step={80}
                  value={width} onChange={(e) => setWidth(Number(e.target.value))}
                />
                <div className="range-hints">
                  <span>Smaller file</span>
                  <span>Higher res</span>
                </div>
              </div>

              <p className="tip">Tip: 1x speed · 10 fps · 640px is a good balance for Slack.</p>

              {error && <p className="error-msg">{error}</p>}

              <div className="button-row">
                <button className="btn-secondary" onClick={reset}>← New file</button>
                <button className="btn-primary" onClick={convert}>Convert to GIF →</button>
              </div>
            </div>
          </div>
        )}

        {stage === 'converting' && (
          <div className="converting">
            <img src={`${import.meta.env.BASE_URL}chauncey.png`} alt="Chauncey" className="chauncey-spin" />
            <p className="converting-label">
              {convertStage === 'loading-engine' && 'Loading engine...'}
              {convertStage === 'reading-file' && 'Reading file...'}
              {convertStage === 'pass1' && `${progress}% — Generating palette`}
              {convertStage === 'pass2' && `${progress}% — Encoding GIF`}
            </p>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <p className="converting-pun">{loadingMessage}</p>
            <p className="converting-sub">Runs entirely in your browser — your video never leaves your computer.</p>
          </div>
        )}

        {stage === 'done' && gifURL && (
          <div className="result">
            <div className="workspace">
              <div className="panel">
                <h2>Your GIF</h2>
                <img src={gifURL} alt="Converted GIF" className="gif-preview" />
                <div className="chauncey-done-wrap">
                  <img src={`${import.meta.env.BASE_URL}chauncey.png`} alt="Chauncey" className="chauncey-pop" />
                  <p className="chauncey-done-msg">Looking good! 🎉</p>
                </div>
              </div>

              <div className="panel">
                <h2>Adjust &amp; Reconvert</h2>

                <div className="control-group">
                  <div className="control-label">
                    <span>Playback speed</span>
                    <span className="control-value">{speed}x</span>
                  </div>
                  <div className="speed-options">
                    {[1, 1.5, 2, 3].map((s) => (
                      <button
                        key={s}
                        className={`speed-btn ${speed === s ? 'active' : ''}`}
                        onClick={() => setSpeed(s)}
                      >{s}x</button>
                    ))}
                  </div>
                </div>

                <div className="control-group">
                  <div className="control-label">
                    <span>Frame rate</span>
                    <span className="control-value">{fps} fps</span>
                  </div>
                  <input
                    type="range" min={5} max={20} step={1}
                    value={fps} onChange={(e) => setFps(Number(e.target.value))}
                  />
                  <div className="range-hints">
                    <span>Smaller file</span>
                    <span>Smoother</span>
                  </div>
                </div>

                <div className="control-group">
                  <div className="control-label">
                    <span>Width</span>
                    <span className="control-value">{width}px</span>
                  </div>
                  <input
                    type="range" min={320} max={960} step={80}
                    value={width} onChange={(e) => setWidth(Number(e.target.value))}
                  />
                  <div className="range-hints">
                    <span>Smaller file</span>
                    <span>Higher res</span>
                  </div>
                </div>

                <p className="tip">Tip: 10 fps + 640px is a good balance for Slack.</p>

                <div className="button-col">
                  <div className="filename-row">
                    <input
                      className="filename-input"
                      type="text"
                      value={filename}
                      onChange={(e) => setFilename(e.target.value.replace(/\.gif$/i, ''))}
                      spellCheck={false}
                    />
                    <span className="filename-ext">.gif</span>
                  </div>
                  <a className="btn-primary" href={gifURL} download={`${filename || 'recording'}.gif`}>⬇ Download GIF</a>
                  <button className="btn-secondary btn-full" onClick={convert}>↺ Reconvert with new settings</button>
                  <button className="btn-ghost" onClick={reset}>← New file</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
