import { useEffect, useRef, useState } from "react";
import { calculateTargetDimensions } from "../../shared/image";
import { LIMITS } from "../../shared/limits";

export interface CropperProps {
  dataUrl: string;
  onConfirm: (processedJpegDataUrl: string) => void;
  onCancel: () => void;
}

interface CropRect {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export function Cropper({ dataUrl, onConfirm, onCancel }: CropperProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const [cropBox, setCropBox] = useState<CropRect | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  // Load image onto canvas
  useEffect(() => {
    const img = new Image();
    img.src = dataUrl;
    img.onload = () => {
      imgRef.current = img;
      setImageLoaded(true);

      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0);
        }
      }
    };

    return () => {
      imgRef.current = null;
    };
  }, [dataUrl]);

  // Redraw image + crop overlay whenever cropBox changes
  useEffect(() => {
    if (!imageLoaded || !imgRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = imgRef.current;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);

    if (cropBox) {
      const x = Math.min(cropBox.startX, cropBox.endX);
      const y = Math.min(cropBox.startY, cropBox.endY);
      const w = Math.abs(cropBox.endX - cropBox.startX);
      const h = Math.abs(cropBox.endY - cropBox.startY);

      if (w > 2 && h > 2) {
        // Semi-transparent darkened overlay outside crop box
        ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
        ctx.fillRect(0, 0, canvas.width, y);
        ctx.fillRect(0, y, x, h);
        ctx.fillRect(x + w, y, canvas.width - (x + w), h);
        ctx.fillRect(0, y + h, canvas.width, canvas.height - (y + h));

        // High-contrast crop rectangle
        const strokeWidth = Math.max(2, Math.round(canvas.width / 400));
        ctx.lineWidth = strokeWidth;
        ctx.strokeStyle = "#2563eb";
        ctx.strokeRect(x, y, w, h);

        // Dashed inner border
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
      }
    }
  }, [cropBox, imageLoaded]);

  function getCanvasCoords(
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>,
  ): { x: number; y: number } | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    let clientX = 0;
    let clientY = 0;

    if ("touches" in e) {
      if (!e.touches[0]) return null;
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    const x = Math.max(0, Math.min(canvas.width, (clientX - rect.left) * scaleX));
    const y = Math.max(0, Math.min(canvas.height, (clientY - rect.top) * scaleY));

    return { x, y };
  }

  function handleStart(
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>,
  ) {
    const coords = getCanvasCoords(e);
    if (!coords) return;
    setIsDragging(true);
    setCropBox({
      startX: coords.x,
      startY: coords.y,
      endX: coords.x,
      endY: coords.y,
    });
  }

  function handleMove(
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>,
  ) {
    if (!isDragging) return;
    const coords = getCanvasCoords(e);
    if (!coords) return;
    setCropBox((prev) => (prev ? { ...prev, endX: coords.x, endY: coords.y } : null));
  }

  function handleEnd() {
    setIsDragging(false);
  }

  /**
   * Resizes to longest edge <= 1280 and exports JPEG at ~0.7 quality (architecture §10.4).
   */
  function handleConfirmCrop(isFull = false) {
    const img = imgRef.current;
    if (!img) return;

    let srcX = 0;
    let srcY = 0;
    let srcW = img.naturalWidth;
    let srcH = img.naturalHeight;

    const hasValidCrop =
      cropBox &&
      Math.abs(cropBox.endX - cropBox.startX) > 10 &&
      Math.abs(cropBox.endY - cropBox.startY) > 10;

    if (!isFull && hasValidCrop && cropBox) {
      srcX = Math.round(Math.min(cropBox.startX, cropBox.endX));
      srcY = Math.round(Math.min(cropBox.startY, cropBox.endY));
      srcW = Math.round(Math.abs(cropBox.endX - cropBox.startX));
      srcH = Math.round(Math.abs(cropBox.endY - cropBox.startY));
    }

    const target = calculateTargetDimensions(
      srcW,
      srcH,
      LIMITS.screenshotLongestEdge,
    );

    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = target.width;
    exportCanvas.height = target.height;

    const ctx = exportCanvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, target.width, target.height);

    const jpegDataUrl = exportCanvas.toDataURL(
      "image/jpeg",
      LIMITS.screenshotJpegQuality,
    );
    onConfirm(jpegDataUrl);
  }

  const hasCropSelection =
    cropBox &&
    Math.abs(cropBox.endX - cropBox.startX) > 10 &&
    Math.abs(cropBox.endY - cropBox.startY) > 10;

  return (
    <div className="cropper-overlay" data-testid="cropper-overlay">
      <div className="cropper-modal">
        <div className="cropper-header">
          <span className="cropper-title">Crop Screenshot</span>
          <span className="cropper-hint">
            Drag to crop a region, or click Full Screen to use the entire tab.
          </span>
        </div>

        <div className="cropper-canvas-wrap">
          <canvas
            ref={canvasRef}
            className="cropper-canvas"
            onMouseDown={handleStart}
            onMouseMove={handleMove}
            onMouseUp={handleEnd}
            onTouchStart={handleStart}
            onTouchMove={handleMove}
            onTouchEnd={handleEnd}
          />
        </div>

        <div className="cropper-actions">
          <button
            type="button"
            className="cropper-btn cancel"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="cropper-btn secondary"
            onClick={() => handleConfirmCrop(true)}
            title="Use the full visible tab screenshot without cropping"
          >
            Full Screen
          </button>
          <button
            type="button"
            className="cropper-btn primary"
            disabled={!hasCropSelection}
            onClick={() => handleConfirmCrop(false)}
            title="Crop to the selected rectangle"
          >
            Use Crop
          </button>
        </div>
      </div>
    </div>
  );
}

