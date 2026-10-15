/**
 * "Suggest from faces" for the block-editor pickers: a button that detects
 * faces in the image and moves the focal point to where every cropped size
 * keeps as many of them as possible, plus a picker wrapper that outlines the
 * faces it found.
 */
import { Button, FocalPointPicker } from "@wordpress/components";
import { useState, useRef, useEffect, useLayoutEffect } from "@wordpress/element";
import { __ } from "@wordpress/i18n";

import { previewSizes } from "../crop-position";
import { detectFaces, faceDetectionAvailable, pad } from "./detect";
import { suggestFocus } from "./suggest";
import { facesMessage, facesSelectionMessage } from "./messages";
import { describeDetection, mergeDetectedFaces } from "../focal/data";
import "./faces.scss";

// Default size for a manually-added face: a square this fraction of the
// image's shorter side, converted to the width/height-relative fractions
// detected faces use.
const MANUAL_FACE_SIZE = 0.18;

export { faceCoverage } from "./geometry";
export { facesMessage, faceBadge } from "./messages";

/**
 * @param {Object}   props
 * @param {string}   props.src       Image URL.
 * @param {number}   props.width     Original width.
 * @param {number}   props.height    Original height.
 * @param {Function} props.onFaces   Receives the detected faces (may be empty).
 * @param {Function} props.onSuggest Receives the suggested focal point.
 */
export function FaceSuggest({ src, width, height, faces, onFaces, onSuggest }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const previousFaces = useRef(faces);

  useEffect(() => {
    if (faces && previousFaces.current && faces.length < previousFaces.current.length) {
      setMessage(facesSelectionMessage(faces));
    }
    previousFaces.current = faces;
  }, [faces]);

  if (!faceDetectionAvailable()) {
    return null;
  }

  const run = async () => {
    setBusy(true);
    setMessage(__("Looking for faces…", "focal-point-images-smart-crop"));
    try {
      // Faces added by hand are kept; earlier detections are replaced.
      const result = mergeDetectedFaces(faces, await detectFaces(src));
      onFaces(result.faces);
      const point = suggestFocus(result.faces, width, height, previewSizes());
      if (point) {
        onSuggest(point);
      }
      setMessage(
        result.manual ? describeDetection(result) : facesMessage(result.faces),
      );
    } catch (e) {
      setMessage(
        __("Face detection failed.", "focal-point-images-smart-crop") +
          (e?.message ? ` ${e.message}` : ""),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="noon-focal-face-suggest">
      <Button
        variant="secondary"
        size="small"
        isBusy={busy}
        disabled={busy}
        onClick={run}
      >
        {__("Suggest from faces", "focal-point-images-smart-crop")}
      </Button>
      {message && (
        <span className="description" aria-live="polite">
          {message}
        </span>
      )}
    </div>
  );
}

/**
 * Toggle for "click the image to add a face" mode. Rendered separately from
 * FocalPicker so callers can place it anywhere (e.g. alongside other actions),
 * while FocalPicker itself owns the click-to-place handling.
 *
 * @param {Object}   props
 * @param {boolean}  props.adding   Whether add-face mode is active.
 * @param {Function} props.onToggle Receives the new adding state.
 */
export function AddFaceButton({ adding, onToggle }) {
  return (
    <Button
      variant={adding ? "primary" : "secondary"}
      size="small"
      isPressed={adding}
      onClick={() => onToggle(!adding)}
    >
      {adding
        ? __("Click the image to place a face…", "focal-point-images-smart-crop")
        : __("Add face", "focal-point-images-smart-crop")}
    </Button>
  );
}

/**
 * Core's FocalPointPicker with the detected faces outlined on the image, and
 * (when `adding` is on) a click-to-place handler that adds a new face where
 * the image is clicked instead of moving the focal point. Core owns the
 * picker's DOM, so both the face outlines and the add overlay are siblings
 * sized to the media element; pointer events pass through the former, so
 * dragging works as before, and the latter only exists while adding.
 *
 * @param {Object} props        FocalPointPicker props, plus:
 * @param {Array}  props.faces  Faces from detectFaces(), or empty.
 * @param {Function} props.onFacesChange Called when a face is removed or added.
 * @param {boolean}  props.adding Whether a click on the image adds a face.
 */
export function FocalPicker({ faces = [], onFacesChange, adding = false, ...pickerProps }) {
  const ref = useRef();
  const [rect, setRect] = useState(null);

  useLayoutEffect(() => {
    const host = ref.current;
    if (!host) {
      return;
    }

    const measure = () => {
      const media = host.querySelector(".components-focal-point-picker__media");
      if (!media) {
        setRect(null);
        return;
      }
      const a = host.getBoundingClientRect();
      const b = media.getBoundingClientRect();
      setRect({
        left: b.left - a.left,
        top: b.top - a.top,
        width: b.width,
        height: b.height,
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    const media = host.querySelector(".components-focal-point-picker__media");
    if (media) {
      observer.observe(media);
    }
    return () => observer.disconnect();
  }, [faces, pickerProps.url]);

  // Places a default-sized face box centred on a click, the same shape
  // detectFaces() produces (padded box + raw + score), so it behaves
  // identically to a detected one (coverage scoring, removal, …), then
  // re-suggests the focal point so the new face is accounted for too.
  const addFaceAt = (fractionX, fractionY) => {
    const { width: imgW, height: imgH } = pickerProps.dimensions || {};
    if (!imgW || !imgH || !onFacesChange) {
      return;
    }
    const side = MANUAL_FACE_SIZE * Math.min(imgW, imgH);
    const rawW = Math.min(1, side / imgW);
    const rawH = Math.min(1, side / imgH);
    const raw = {
      x: Math.min(Math.max(fractionX - rawW / 2, 0), 1 - rawW),
      y: Math.min(Math.max(fractionY - rawH / 2, 0), 1 - rawH),
      w: rawW,
      h: rawH,
    };
    updateFaces([...faces, { ...pad(raw), score: 1, manual: true }]);
  };

  // Faces changed by hand: store them and re-suggest the point. With none
  // left the point stays where it is.
  const updateFaces = (next) => {
    onFacesChange(next);
    const { width: imgW, height: imgH } = pickerProps.dimensions || {};
    const point = suggestFocus(next, imgW, imgH, previewSizes());
    if (point && pickerProps.onChange) {
      pickerProps.onChange(point);
    }
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <FocalPointPicker {...pickerProps} />
      {faces.length > 0 && rect && (
        <div className="noon-focal-faces" style={rect}>
          {faces.map((face, i) => (
            <span
              key={i}
              className={face.manual ? "noon-focal-faces__manual" : undefined}
              style={{
                left: `${face.raw.x * 100}%`,
                top: `${face.raw.y * 100}%`,
                width: `${face.raw.w * 100}%`,
                height: `${face.raw.h * 100}%`,
              }}
            >
              {onFacesChange && (
                <button
                  type="button"
                  className="noon-focal-faces__remove"
                  aria-label={`${__("Remove detected face", "focal-point-images-smart-crop")} ${i + 1}`}
                  title={__("Remove detected face", "focal-point-images-smart-crop")}
                  onPointerDown={(event) => event.stopPropagation()}
                  onMouseDown={(event) => event.stopPropagation()}
                  onTouchStart={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    updateFaces(faces.filter((face, index) => index !== i));
                  }}
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {adding && rect && (
        <div
          className="noon-focal-add-overlay"
          style={rect}
          role="button"
          tabIndex={-1}
          aria-label={__("Click to place a face", "focal-point-images-smart-crop")}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const box = event.currentTarget.getBoundingClientRect();
            addFaceAt(
              (event.clientX - box.left) / box.width,
              (event.clientY - box.top) / box.height,
            );
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        />
      )}
    </div>
  );
}
