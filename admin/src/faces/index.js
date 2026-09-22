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
import { detectFaces, faceDetectionAvailable } from "./detect";
import { suggestFocus } from "./suggest";
import { facesMessage, facesSelectionMessage } from "./messages";
import "./faces.scss";

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
      const faces = await detectFaces(src);
      onFaces(faces);
      const point = suggestFocus(faces, width, height, previewSizes());
      if (point) {
        onSuggest(point);
      }
      setMessage(facesMessage(faces));
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
 * Core's FocalPointPicker with the detected faces outlined on the image.
 * Core owns the picker's DOM, so the overlay is a sibling sized to the media
 * element; pointer events pass through it, so dragging works as before.
 *
 * @param {Object} props        FocalPointPicker props, plus:
 * @param {Array}  props.faces  Faces from detectFaces(), or empty.
 * @param {Function} props.onFacesChange Called when a detected face is removed.
 */
export function FocalPicker({ faces = [], onFacesChange, ...pickerProps }) {
  const ref = useRef();
  const [rect, setRect] = useState(null);

  useLayoutEffect(() => {
    const host = ref.current;
    if (!host || !faces.length) {
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

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <FocalPointPicker {...pickerProps} />
      {faces.length > 0 && rect && (
        <div className="noon-focal-faces" style={rect}>
          {faces.map((face, i) => (
            <span
              key={i}
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
                    onFacesChange(faces.filter((face, index) => index !== i));
                  }}
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
