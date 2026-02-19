import { useEffect, useRef } from 'react';
import { PoseRenderer2D } from '../avatar/PoseRenderer2D.js';

export function AvatarCanvas({ latestPosePacket, compact = false }) {
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) {
      return undefined;
    }

    const renderer = new PoseRenderer2D(canvasRef.current);
    rendererRef.current = renderer;
    renderer.start();

    const resizeHandler = () => renderer.resizeCanvas();
    window.addEventListener('resize', resizeHandler);

    return () => {
      window.removeEventListener('resize', resizeHandler);
      renderer.stop();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!latestPosePacket || !rendererRef.current) {
      return;
    }
    rendererRef.current.queuePoseSequence(latestPosePacket);
  }, [latestPosePacket]);

  if (compact) {
    return (
      <div className="avatar-tile-content">
        <canvas ref={canvasRef} className="avatar-canvas avatar-canvas-compact" />
      </div>
    );
  }

  return (
    <section className="panel avatar-panel">
      <h2>Sign Avatar (2D)</h2>
      <canvas ref={canvasRef} className="avatar-canvas" />
    </section>
  );
}
