import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as THREE from 'three/src/Three.Core.js'
import { WebGLRenderer } from 'three/src/renderers/WebGLRenderer.js'
import PanoramaCapturePanel, { type PanoramaFrame } from './PanoramaCapturePanel'
import styles from './CanvasImageTools.module.css'
import {
  studioLightVector,
  studioLightPosition,
  wrapStudioAngle,
  hasPanoramaFrame,
  studioCaptureSize,
} from '@/utils/canvasStudioControls'

interface SceneHandle {
  renderer: WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  light: THREE.DirectionalLight
  marker: THREE.Mesh
  sightline: THREE.Line
  rim: THREE.DirectionalLight
}

export default function CanvasToolScene({
  mode,
  url,
  values,
  onChange,
  onCapture,
  capturePanelTarget,
  disabled = false,
  onBusyChange,
  compact = false,
}: {
  mode: 'angle' | 'light' | 'panorama'
  url: string
  values: Record<string, unknown>
  onChange: (values: Record<string, unknown>) => void
  onCapture?: (blob: Blob, view?: Record<string, unknown>) => Promise<void>
  capturePanelTarget?: HTMLElement | null
  disabled?: boolean
  compact?: boolean
  onBusyChange?: (busy: boolean) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const handle = useRef<SceneHandle | null>(null)
  const current = useRef(values)
  current.current = values
  const [guide, setGuide] = useState('none')
  const [frames, setFrames] = useState<PanoramaFrame[]>([])
  const [captureProgress, setCaptureProgress] = useState<{ done: number; total: number } | null>(null)
  const frameUrls = useRef<string[]>([])
  useEffect(() => () => frameUrls.current.forEach((url) => URL.revokeObjectURL(url)), [])
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const [capturing, setCapturing] = useState(false)
  useEffect(() => {
    onBusyChange?.(capturing)
  }, [capturing, onBusyChange])
  const [captureError, setCaptureError] = useState('')
  const [qualityNote, setQualityNote] = useState('')
  const [expanded, setExpanded] = useState(false)
  const captureLock = useRef(false)
  const [captureWidth, captureHeight] = studioCaptureSize(values)
  const changeRef = useRef(onChange)
  changeRef.current = onChange
  const disabledRef = useRef(disabled)
  disabledRef.current = disabled || capturing
  const drag = useRef<{ x: number; y: number; values: Record<string, unknown> } | null>(null)

  const draw = (override?: Record<string, unknown>) => {
    const state = handle.current
    if (!state) return
    const v = override || current.current
    const viewport = state.renderer.getSize(new THREE.Vector2())
    state.renderer.setViewport(0, 0, viewport.x, viewport.y)
    const yaw = THREE.MathUtils.degToRad(Number(v.horizontal_angle ?? v.yaw ?? 0))
    const pitch = THREE.MathUtils.degToRad(Number(v.vertical_angle ?? v.pitch ?? 0))
    if (mode === 'panorama') {
      const [captureWidth, captureHeight] = studioCaptureSize(v)
      const aspect = viewport.x / viewport.y
      state.renderer.setScissorTest(false)
      state.renderer.clear()
      state.renderer.setViewport(0, 0, viewport.x, viewport.y)
      state.renderer.setScissor(0, 0, viewport.x, viewport.y)
      state.renderer.setScissorTest(true)
      const guideElement = host.current?.querySelector<HTMLElement>('[data-capture-frame]')
      if (guideElement) {
        const hostWidth = host.current?.clientWidth || viewport.x
        const hostHeight = host.current?.clientHeight || viewport.y
        const frameAspect = captureWidth / captureHeight
        const frameWidth = Math.min(hostWidth, hostHeight * frameAspect)
        guideElement.style.width = `${frameWidth}px`
        guideElement.style.height = `${frameWidth / frameAspect}px`
      }
      state.camera.aspect = aspect
      state.camera.position.set(0, 0, 0)
      state.camera.fov = Math.max(30, Math.min(110, Number(v.fov ?? 75)))
      state.camera.lookAt(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch))
    } else if (mode === 'angle') {
      state.camera.position.set(4, 3, 5)
      state.camera.lookAt(0, 0, 0)
      const distance = 3 - Number(v.zoom ?? 5) * 0.12
      state.marker.position.set(
        Math.sin(yaw) * Math.cos(pitch) * distance,
        Math.sin(pitch) * distance,
        Math.cos(yaw) * Math.cos(pitch) * distance,
      )
      state.marker.lookAt(0, 0, 0)
      const positions = state.sightline.geometry.getAttribute('position')
      positions.setXYZ(1, state.marker.position.x, state.marker.position.y, state.marker.position.z)
      positions.needsUpdate = true
      state.sightline.geometry.computeBoundingSphere()
    } else {
      const distance = 6 - Number(v.zoom ?? 5) * 0.32
      state.camera.position.set(
        Math.sin(yaw) * Math.cos(pitch) * distance,
        Math.sin(pitch) * distance,
        Math.cos(yaw) * Math.cos(pitch) * distance,
      )
      state.camera.lookAt(0, 0, 0)
    }
    if (mode === 'light') {
      state.camera.position.set(0, 1.6, 4.5)
      state.camera.lookAt(0, 0, 0)
      const fallback = studioLightPosition(v.key_light)
      const direction = studioLightVector(
        Number(v.light_azimuth ?? fallback.light_azimuth),
        Number(v.light_elevation ?? fallback.light_elevation),
      )
      state.light.position.set(...direction).multiplyScalar(4)
      state.marker.position.set(...direction).multiplyScalar(2)
      const positions = state.sightline.geometry.getAttribute('position')
      positions.setXYZ(1, ...(state.marker.position.toArray() as [number, number, number]))
      positions.needsUpdate = true
      state.sightline.geometry.computeBoundingSphere()
      state.light.color.set(/^#[0-9a-f]{6}$/i.test(String(v.color)) ? String(v.color) : '#ffffff')
      state.light.intensity = Number(v.brightness ?? 50) / 20
      state.rim.intensity = v.rim_light === true ? 2 : 0
    }
    state.camera.updateProjectionMatrix()
    state.renderer.render(state.scene, state.camera)
    state.renderer.setScissorTest(false)
  }
  const drawRef = useRef(draw)
  drawRef.current = draw

  useEffect(() => {
    const container = host.current
    if (!container) return
    setError('')
    setReady(false)
    setQualityNote('')
    let renderer: WebGLRenderer
    try {
      renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: mode === 'panorama' })
    } catch {
      setError('当前设备无法启动 3D 预览，请使用右侧参数调整。')
      return
    }
    let disposed = false
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(mode === 'panorama' ? '#f7f8fa' : '#edf2f2')
    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100)
    const light = new THREE.DirectionalLight('#ffffff', 2.5)
    const rim = new THREE.DirectionalLight('#b9d9ff', 0)
    rim.position.set(-2, 1, -3)
    const markerGeometry = mode === 'angle' ? new THREE.ConeGeometry(0.22, 0.45, 4) : new THREE.SphereGeometry(0.1)
    if (mode === 'angle') markerGeometry.rotateX(Math.PI / 2)
    const marker = new THREE.Mesh(
      markerGeometry,
      new THREE.MeshBasicMaterial({ color: mode === 'angle' ? '#3889df' : '#ffbf45' }),
    )
    const sightline = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, 3)]),
      new THREE.LineBasicMaterial({ color: '#3889df', transparent: true, opacity: 0.6 }),
    )
    marker.visible = mode !== 'panorama'
    sightline.visible = mode !== 'panorama'
    scene.add(new THREE.AmbientLight('#ffffff', 0.45), light, rim, marker, sightline)
    if (mode === 'light') {
      scene.add(
        new THREE.Mesh(
          new THREE.SphereGeometry(1, 48, 32),
          new THREE.MeshStandardMaterial({ color: '#d9dfdf', roughness: 0.5 }),
        ),
        marker,
      )
      const orbit = new THREE.Mesh(
        new THREE.RingGeometry(1.98, 2.01, 96),
        new THREE.MeshBasicMaterial({ color: '#a4bab5', side: THREE.DoubleSide, transparent: true, opacity: 0.7 }),
      )
      orbit.rotation.x = Math.PI / 2
      scene.add(orbit)
      marker.renderOrder = 2
      ;(marker.material as THREE.MeshBasicMaterial).depthTest = false
    } else if (mode === 'angle') {
      const grid = new THREE.GridHelper(6, 12, '#a8bdb9', '#d1ddda')
      grid.position.y = -1.15
      scene.add(grid, new THREE.AxesHelper(1.8), marker, sightline)
    }
    handle.current = { renderer, scene, camera, light, marker, sightline, rim }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    container.appendChild(renderer.domElement)
    const resize = () => {
      const width = container.clientWidth || 480
      const height = container.clientHeight || 280
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      drawRef.current()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    const wheel = (event: WheelEvent) => {
      if (disabledRef.current || (mode === 'light' && current.current.mode !== 'manual')) return
      event.preventDefault()
      const key = mode === 'panorama' ? 'fov' : mode === 'angle' ? 'zoom' : 'brightness'
      const value = Number(current.current[key] ?? (mode === 'panorama' ? 65 : mode === 'angle' ? 5 : 50))
      const delta = Math.sign(event.deltaY) * (mode === 'panorama' ? 3 : mode === 'angle' ? -0.5 : -5)
      const min = mode === 'panorama' ? 30 : 0
      const max = mode === 'panorama' ? 110 : mode === 'angle' ? 10 : 100
      changeRef.current({ ...current.current, [key]: Math.max(min, Math.min(max, value + delta)) })
    }
    container.addEventListener('wheel', wheel, { passive: false })
    resize()
    if (mode !== 'light')
      new THREE.TextureLoader().load(
        url,
        (texture) => {
          if (disposed) {
            texture.dispose()
            return
          }
          texture.colorSpace = THREE.SRGBColorSpace
          if (mode === 'panorama') texture.wrapS = THREE.RepeatWrapping
          const image = texture.image as { width: number; height: number }
          if (mode === 'panorama' && Math.abs(image.width / image.height - 2) > 0.08) {
            texture.dispose()
            setError('全景浏览需要 2:1 等距柱状全景图，请先使用“全景生成”。')
            return
          }
          if (mode === 'panorama') {
            try {
              const probe = document.createElement('canvas')
              probe.width = 64
              probe.height = 32
              const context = probe.getContext('2d')
              if (context) {
                context.drawImage(texture.image, 0, 0, 64, 32)
                if (hasPanoramaFrame(context.getImageData(0, 0, 64, 32).data, 64, 32))
                  setQualityNote(
                    '检测到明显黑角或透明边，可能是鱼眼或带边框的图片。建议重新生成无黑边的等距柱状全景；仅满足 2:1 比例不能保证正确投影。',
                  )
              }
            } catch {
              /* 无像素读取权限时保留浏览，不把检测失败当成内容错误。 */
            }
          }
          const geometry =
            mode === 'panorama'
              ? new THREE.SphereGeometry(50, 64, 40)
              : new THREE.PlaneGeometry(2 * Math.min(1.5, image.width / image.height), 2)
          if (mode === 'panorama') geometry.scale(-1, 1, 1)
          const proxy = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }))
          if (mode === 'angle') proxy.lookAt(camera.position)
          scene.add(proxy)
          setReady(true)
          drawRef.current()
        },
        undefined,
        () => {
          if (!disposed) setError('图片加载失败，请重新打开或检查素材是否可用。')
        },
      )
    else setReady(true)
    const contextLost = (event: Event) => {
      event.preventDefault()
      setReady(false)
      setError('3D 预览已中断，请关闭后重新打开。')
    }
    renderer.domElement.addEventListener('webglcontextlost', contextLost)
    return () => {
      disposed = true
      observer.disconnect()
      container.removeEventListener('wheel', wheel)
      renderer.domElement.removeEventListener('webglcontextlost', contextLost)
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh
        mesh.geometry?.dispose()
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const material of materials)
          if (material) {
            ;(material as THREE.MeshBasicMaterial).map?.dispose()
            material.dispose()
          }
      })
      renderer.dispose()
      renderer.domElement.remove()
      handle.current = null
    }
  }, [mode, url])
  useEffect(() => {
    drawRef.current()
  }, [values, guide])
  useEffect(() => {
    if (!expanded) return
    const exit = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        setExpanded(false)
      }
    }
    window.addEventListener('keydown', exit, true)
    return () => window.removeEventListener('keydown', exit, true)
  }, [expanded])

  const captureFrames = async (count: number) => {
    if (captureLock.current) return
    captureLock.current = true
    setCapturing(true)
    setCaptureProgress({ done: 0, total: count })
    setCaptureError('')
    const original = current.current
    const state = handle.current
    if (!state) {
      captureLock.current = false
      setCapturing(false)
      return
    }
    const size = state.renderer.getSize(new THREE.Vector2())
    const ratio = state.renderer.getPixelRatio()
    const pending: typeof frames = []
    try {
      const [width, height] = studioCaptureSize(original)
      state.renderer.setPixelRatio(1)
      state.renderer.setSize(width, height, false)
      for (let index = 0; index < count; index++) {
        const view =
          count === 1
            ? { ...original }
            : {
                ...original,
                yaw: wrapStudioAngle(Number(original.yaw || 0) + (index % 4) * 90),
                pitch: count === 12 ? [-35, 0, 35][Math.floor(index / 4)] : 0,
                fov: 75,
              }
        drawRef.current(view)
        const blob = await new Promise<Blob>((resolve, reject) =>
          state.renderer.domElement.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error('取景导出失败'))),
            'image/png',
          ),
        )
        const url = URL.createObjectURL(blob)
        pending.push({ blob, url, view, selected: true, saved: false })
        setCaptureProgress({ done: index + 1, total: count })
      }
      frameUrls.current.push(...pending.map((frame) => frame.url))
      setFrames((old) => [...old, ...pending])
    } catch (err) {
      pending.forEach((frame) => URL.revokeObjectURL(frame.url))
      setCaptureError(err instanceof Error ? err.message : '取景失败')
    } finally {
      current.current = original
      state.renderer.setPixelRatio(ratio)
      state.renderer.setSize(size.x, size.y, false)
      drawRef.current()
      captureLock.current = false
      setCapturing(false)
      setCaptureProgress(null)
    }
  }

  const capturePanel = mode === 'panorama' && onCapture && (
    <PanoramaCapturePanel
      ready={ready}
      error={error}
      disabled={disabled}
      capturing={capturing}
      progress={captureProgress}
      frames={frames}
      setFrames={setFrames}
      captureFrames={captureFrames}
      captureLock={captureLock}
      setCapturing={setCapturing}
      setCaptureError={setCaptureError}
      onCapture={onCapture}
    />
  )

  return (
    <div className={`${styles.sceneShell} ${expanded ? styles.sceneExpanded : ''}`}>
      <div className={styles.sceneToolbar} hidden={compact}>
        <span>{mode === 'panorama' ? '360° 场景取景' : mode === 'light' ? '360° 环绕布光' : '三维相机控制'}</span>
        <div className={styles.presets}>
          {mode === 'panorama' && (
            <select
              aria-label="取景画幅"
              disabled={disabled || capturing}
              value={`${captureWidth}x${captureHeight}`}
              onChange={(event) => {
                const [capture_width, capture_height] = event.target.value.split('x').map(Number)
                onChange({ ...values, capture_width, capture_height })
              }}
            >
              <option value="1920x1080">16:9 · 1920×1080</option>
              <option value="1080x1920">9:16 · 1080×1920</option>
              <option value="1536x1536">1:1 · 1536×1536</option>
            </select>
          )}
          {mode === 'panorama' && (
            <>
              <select
                aria-label="构图视角"
                disabled={disabled || capturing}
                value=""
                onChange={(event) => {
                  const [pitch, fov] = event.target.value.split(',').map(Number)
                  onChange({ ...values, pitch, fov })
                }}
              >
                <option value="" disabled>
                  构图视角
                </option>
                <option value="0,75">平视</option>
                <option value="30,75">仰视</option>
                <option value="-30,75">俯视</option>
                <option value="0,100">广角</option>
                <option value="0,45">特写</option>
              </select>
              <select aria-label="构图参考线" value={guide} onChange={(event) => setGuide(event.target.value)}>
                <option value="none">无参考线</option>
                <option value="thirds">九宫格</option>
                <option value="cross">中心十字</option>
                <option value="safe">安全框</option>
              </select>
            </>
          )}
          <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
            {expanded ? '退出大屏' : '大屏预览'}
          </button>
        </div>
      </div>
      <div
        ref={host}
        className={`${styles.scene} ${mode === 'panorama' ? styles.panoramaScene : ''}`}
        tabIndex={0}
        role="application"
        aria-label={
          mode === 'panorama'
            ? '全景取景预览，拖动调整视角'
            : mode === 'light'
              ? '灯位方向示意，拖动调整灯位'
              : '相机角度示意，拖动调整视角'
        }
        onKeyDown={(event) => {
          if (
            disabledRef.current ||
            !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) ||
            (mode === 'light' && values.mode !== 'manual')
          )
            return
          event.preventDefault()
          event.stopPropagation()
          const horizontal = mode === 'light' ? 'light_azimuth' : mode === 'panorama' ? 'yaw' : 'horizontal_angle'
          const vertical = mode === 'light' ? 'light_elevation' : mode === 'panorama' ? 'pitch' : 'vertical_angle'
          const next = { ...values }
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
            next[horizontal] = wrapStudioAngle(Number(values[horizontal] || 0) + (event.key === 'ArrowLeft' ? -5 : 5))
          else
            next[vertical] = Math.max(
              mode === 'angle' ? -30 : -85,
              Math.min(mode === 'angle' ? 60 : 85, Number(values[vertical] || 0) + (event.key === 'ArrowUp' ? 5 : -5)),
            )
          onChange(next)
        }}
        onPointerDown={(event) => {
          if (disabledRef.current || (mode === 'light' && values.mode !== 'manual')) return
          event.currentTarget.setPointerCapture(event.pointerId)
          drag.current = { x: event.clientX, y: event.clientY, values: { ...values } }
        }}
        onPointerUp={() => {
          drag.current = null
        }}
        onPointerCancel={() => {
          drag.current = null
        }}
        onPointerMove={(event) => {
          const start = drag.current
          if (!start || disabledRef.current) return
          const dx = event.clientX - start.x
          const dy = event.clientY - start.y
          if (mode === 'light') {
            onChange({
              ...current.current,
              light_azimuth: wrapStudioAngle(Number(start.values.light_azimuth || 0) + dx * 0.8),
              light_elevation: Math.max(-89, Math.min(89, Number(start.values.light_elevation || 0) - dy * 0.5)),
            })
            return
          }
          const yawKey = mode === 'panorama' ? 'yaw' : 'horizontal_angle'
          const pitchKey = mode === 'panorama' ? 'pitch' : 'vertical_angle'
          onChange({
            ...current.current,
            [yawKey]: (((Number(start.values[yawKey] || 0) + dx * 0.6) % 360) + 360) % 360,
            [pitchKey]: Math.max(
              mode === 'panorama' ? -85 : -30,
              Math.min(mode === 'panorama' ? 85 : 60, Number(start.values[pitchKey] || 0) - dy * 0.4),
            ),
          })
        }}
      >
        {mode === 'panorama' && (
          <div
            aria-hidden="true"
            className={styles.captureFrameOverlay}
            style={{ aspectRatio: `${captureWidth} / ${captureHeight}` }}
            data-capture-frame
          />
        )}
        {mode === 'panorama' && guide !== 'none' && (
          <div
            aria-hidden="true"
            className={styles.compositionGuide}
            style={{ aspectRatio: `${captureWidth} / ${captureHeight}` }}
            data-guide={guide}
          >
            <i />
            <i />
            <i />
            <i />
          </div>
        )}
        {error && (
          <div className={styles.sceneError} role="alert">
            {error}
          </div>
        )}
      </div>
      <p className={styles.hint} hidden={compact}>
        {mode === 'panorama'
          ? '拖动旋转视角，使用参数精确取景。'
          : mode === 'light'
            ? '拖动环绕灯球，滚轮调节亮度；方向键可微调。灯球用于示意光位，实际打光以生成结果为准。'
            : '拖动调整蓝色相机，滚轮改变景别，方向键微调。参考平面不会伪装成真实三维重建。'}
      </p>
      {qualityNote && (
        <p role="status" className={styles.qualityNote}>
          {qualityNote}
        </p>
      )}
      {capturePanel && (capturePanelTarget ? createPortal(capturePanel, capturePanelTarget) : capturePanel)}
      {captureError && (
        <p role="alert" className={styles.error}>
          {captureError}
        </p>
      )}
    </div>
  )
}
