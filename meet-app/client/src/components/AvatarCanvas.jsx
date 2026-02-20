import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment } from '@react-three/drei';
import { PoseRenderer2D } from '../avatar/PoseRenderer2D.js';
import { AvatarModel3D } from '../avatar/AvatarModel3D.jsx';

const MODE_2D = '2d';
const MODE_3D = '3d';

function ThreeScene({ posePacket, onWordChange }) {
  return (
    <Canvas camera={{ position: [0, 0.8, 3.5], fov: 50 }} style={{ width: '100%', height: '100%' }}>
      <ambientLight intensity={0.7} />
      <directionalLight position={[2, 4, 3]} intensity={1.3} castShadow />
      <Suspense fallback={null}>
        <Environment preset="city" />
        <AvatarModel3D posePacket={posePacket} onWordChange={onWordChange} />
      </Suspense>
      <OrbitControls enablePan={false} minDistance={1.5} maxDistance={7} target={[0, 0.5, 0]} />
    </Canvas>
  );
}

export function AvatarCanvas({ latestPosePacket, displayText = '', compact = false }) {
  const canvasRef   = useRef(null);
  const rendererRef = useRef(null);
  const [mode, setMode] = useState(MODE_2D);
  const [activeWord, setActiveWord] = useState('');

  // ── 2D renderer lifecycle ──────────────────────────────────────────────
  useEffect(() => {
    if (mode !== MODE_2D) return undefined;
    if (!canvasRef.current) return undefined;

    const renderer = new PoseRenderer2D(canvasRef.current);
    rendererRef.current = renderer;
    renderer.start();

    const onResize = () => renderer.resizeCanvas();
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      renderer.stop();
      rendererRef.current = null;
    };
  }, [mode]);

  // ── Forward new pose packets to 2D renderer ────────────────────────────
  useEffect(() => {
    if (mode === MODE_2D && latestPosePacket && rendererRef.current) {
      rendererRef.current.queuePoseSequence(latestPosePacket);
    }
  }, [latestPosePacket, mode]);

  // ── Reset active word when a new packet arrives ──────────────────────
  useEffect(() => {
    setActiveWord('');
  }, [latestPosePacket]);

  const toggleMode = useCallback(() => {
    setMode((prev) => (prev === MODE_2D ? MODE_3D : MODE_2D));
  }, []);

  const toggleBtn = (
    <button
      type="button"
      onClick={toggleMode}
      title={mode === MODE_2D ? 'Switch to 3D avatar' : 'Switch to 2D skeleton'}
      style={{
        position: 'absolute',
        top: 8,
        right: 8,
        zIndex: 10,
        background: 'rgba(0,0,0,0.6)',
        color: '#fff',
        border: '1px solid rgba(255,255,255,0.3)',
        borderRadius: 6,
        padding: '3px 10px',
        fontSize: 11,
        fontWeight: 600,
        cursor: 'pointer',
        backdropFilter: 'blur(4px)',
        letterSpacing: '0.5px',
      }}
    >
      {mode === MODE_2D ? '3D' : '2D'}
    </button>
  );

  // In 3D mode show the word currently being animated; fall back to full text
  const captionText = (mode === MODE_3D && activeWord) ? activeWord : displayText;
  const caption = captionText
    ? (
      <div
        className="avatar-caption"
        style={{
          position: 'absolute',
          bottom: 6,
          left: 0,
          right: 0,
          textAlign: 'center',
          pointerEvents: 'none',
        }}
      >
        {captionText}
      </div>
    )
    : null;

  const inner = (
    <div className="avatar-tile-content avatar-tile-content--with-caption"
         style={{ position: 'relative', width: '100%', height: '100%' }}>
      {toggleBtn}

      {/* 2D canvas — kept in DOM so the renderer can resize without remounting */}
      <canvas
        ref={canvasRef}
        className={compact ? 'avatar-canvas avatar-canvas-compact' : 'avatar-canvas'}
        style={{ display: mode === MODE_2D ? 'block' : 'none', width: '100%', height: '100%' }}
      />

      {/* 3D scene — only mounted in 3D mode */}
      {mode === MODE_3D && <ThreeScene posePacket={latestPosePacket} onWordChange={setActiveWord} />}

      {caption}
    </div>
  );

  if (compact) {
    return inner;
  }

  return (
    <section className="panel avatar-panel">
      <h2>Sign Avatar</h2>
      {inner}
    </section>
  );
}

