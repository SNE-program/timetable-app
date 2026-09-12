import React from 'react';

/**
 * 壁纸剪裁。
 *
 * 手机是竖长屏，横图用 background-size:cover 铺满要放大好几倍，
 * 大部分内容被裁掉、剩下的部分糊成一片。所以导入时先让用户自己框选。
 *
 * 画布比例 = 你的屏幕比例，所见即所得：框出来的就是主界面上的效果。
 */
export default function WallpaperCrop(props: {
  src: string;
  onCancel: () => void;
  onDone: (cropped: string, original: string) => void;
}) {
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const imgRef = React.useRef<HTMLImageElement | null>(null);
  const dragRef = React.useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

  const [ready, setReady] = React.useState(false);
  const [frame, setFrame] = React.useState({ w: 0, h: 0 });
  const [zoom, setZoom] = React.useState(1);
  const [pan, setPan] = React.useState({ x: 0, y: 0 });

  const screenW = typeof window !== 'undefined' ? window.innerWidth : 360;
  const screenH = typeof window !== 'undefined' ? window.innerHeight : 780;

  React.useEffect(function () {
    const img = new Image();
    img.onload = function () {
      imgRef.current = img;
      setReady(true);
    };
    img.onerror = function () { setReady(false); };
    img.src = props.src;
  }, [props.src]);

  /* 量出画布实际尺寸 */
  React.useEffect(function () {
    const el = wrapRef.current;
    if (!el) return;
    const update = function () {
      const r = el.getBoundingClientRect();
      if (r.width > 0) setFrame({ w: r.width, h: r.height });
    };
    update();
    window.addEventListener('resize', update);
    return function () { window.removeEventListener('resize', update); };
  }, [ready]);

  const base = React.useMemo(function () {
    const img = imgRef.current;
    if (!img || frame.w === 0) return 1;
    return Math.max(frame.w / img.naturalWidth, frame.h / img.naturalHeight);
  }, [ready, frame.w, frame.h]);

  const clamp = React.useCallback(function (x: number, y: number, z: number) {
    const img = imgRef.current;
    if (!img) return { x: 0, y: 0 };
    const s = base * z;
    const dw = img.naturalWidth * s;
    const dh = img.naturalHeight * s;
    return {
      x: Math.min(0, Math.max(frame.w - dw, x)),
      y: Math.min(0, Math.max(frame.h - dh, y)),
    };
  }, [base, frame.w, frame.h]);

  /* 尺寸就绪后居中 */
  React.useEffect(function () {
    const img = imgRef.current;
    if (!img || frame.w === 0) return;
    const s = base;
    setPan(clamp((frame.w - img.naturalWidth * s) / 2, (frame.h - img.naturalHeight * s) / 2, 1));
    setZoom(1);
  }, [ready, frame.w, frame.h, base, clamp]);

  /* 重绘 */
  React.useEffect(function () {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || frame.w === 0) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = Math.round(frame.w * dpr);
    canvas.height = Math.round(frame.h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, frame.w, frame.h);
    const s = base * zoom;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, pan.x, pan.y, img.naturalWidth * s, img.naturalHeight * s);

    /* 三分线，方便构图 */
    ctx.strokeStyle = 'rgba(255,255,255,.35)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 2; i++) {
      const x = Math.round(frame.w * i / 3) + 0.5;
      const y = Math.round(frame.h * i / 3) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, frame.h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(frame.w, y); ctx.stroke();
    }
  }, [ready, frame.w, frame.h, base, zoom, pan.x, pan.y]);

  function onDown(ev: React.PointerEvent) {
    (ev.target as HTMLElement).setPointerCapture(ev.pointerId);
    dragRef.current = { x: ev.clientX, y: ev.clientY, tx: pan.x, ty: pan.y };
  }
  function onMove(ev: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const next = clamp(d.tx + (ev.clientX - d.x), d.ty + (ev.clientY - d.y), zoom);
    setPan(next);
  }
  function onUp() { dragRef.current = null; }

  function changeZoom(z: number) {
    const img = imgRef.current;
    if (!img) { setZoom(z); return; }
    const cx = frame.w / 2;
    const cy = frame.h / 2;
    const s0 = base * zoom;
    const sx = (cx - pan.x) / s0;
    const sy = (cy - pan.y) / s0;
    const s1 = base * z;
    setZoom(z);
    setPan(clamp(cx - sx * s1, cy - sy * s1, z));
  }

  function confirm() {
    const img = imgRef.current;
    if (!img) return;
    const aspect = frame.w / frame.h;
    const LONG = 1920;
    const outW = aspect >= 1 ? LONG : Math.round(LONG * aspect);
    const outH = aspect >= 1 ? Math.round(LONG / aspect) : LONG;
    const oc = document.createElement('canvas');
    oc.width = outW;
    oc.height = outH;
    const ctx = oc.getContext('2d');
    if (!ctx) return;
    const s = base * zoom;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(
      img,
      -pan.x / s, -pan.y / s, frame.w / s, frame.h / s,
      0, 0, outW, outH
    );
    let out = oc.toDataURL('image/webp', 0.9);
    if (out.indexOf('data:image/webp') !== 0) out = oc.toDataURL('image/jpeg', 0.92);
    props.onDone(out, props.src);
  }

  return (
    <div className="crop-panel">
      <div className="crop-head">
        <button className="btn sm ghost" onClick={props.onCancel}>取消</button>
        <div className="crop-title">剪裁壁纸</div>
        <button className="btn sm primary" onClick={confirm} disabled={!ready}>确定</button>
      </div>

      <div className="crop-stage">
        <div
          className="crop-frame"
          ref={wrapRef}
          style={{ aspectRatio: screenW + ' / ' + screenH }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
          {!ready ? <div className="crop-loading">正在读取图片…</div> : null}
        </div>
      </div>

      <div className="crop-foot">
        <div className="slider-row" style={{ borderBottom: 0 }}>
          <div className="slider-head">
            <span className="small">缩放</span>
            <span className="sv">{zoom.toFixed(1)}×</span>
          </div>
          <input
            className="rng" type="range" min={1} max={4} step={0.05} value={zoom}
            style={{ ['--fill' as string]: ((zoom - 1) / 3 * 100) + '%' } as React.CSSProperties}
            onChange={function (e) { changeZoom(Number(e.target.value)); }}
          />
        </div>
        <div className="panel-desc" style={{ padding: '0 2px 4px' }}>
          拖动图片调整位置，滑块缩放。框内就是主界面上的实际效果（比例按你手机屏幕来）。
        </div>
      </div>
    </div>
  );
}
