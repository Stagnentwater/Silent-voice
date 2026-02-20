import { useEffect, useRef } from 'react';
import { PoseRenderer2D } from '../avatar/PoseRenderer2D.js';

export function AvatarCanvas({ latestPosePacket, displayText = '', compact = false }) {
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
      <div className="avatar-tile-content avatar-tile-content--with-caption">
        <canvas ref={canvasRef} className="avatar-canvas avatar-canvas-compact" />
        {displayText ? <div className="avatar-caption">{displayText}</div> : null}
      </div>
    );
  }

  return (
    <section className="panel avatar-panel">
      <h2>Sign Avatar</h2>
      <div className="avatar-tile-content avatar-tile-content--with-caption">
        <canvas ref={canvasRef} className="avatar-canvas" />
        {displayText ? <div className="avatar-caption">{displayText}</div> : null}
      </div>
    </section>
  );
}
