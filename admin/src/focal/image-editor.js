import {
  createPortal,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "@wordpress/element";
import { __, _n, sprintf } from "@wordpress/i18n";
import SizePreviews from "../size-previews";
import { detectFaces, pad } from "../faces/detect";
import {
  CENTRE,
  describeDetection,
  faceDetectionAvailable,
  fetchMedia,
  imageDimensions,
  imageSrc,
  mergeDetectedFaces,
  readFocal,
  saveFocal,
  suggestPoint,
} from "./data";

/**
 * Focal point mode for WordPress's "Edit image" screen. The toolbar's
 * "Focal Point" button toggles it, like Crop: the point is drawn on the
 * editor's own preview image (click or drag to move it, arrow keys when
 * focused) and the Detect / Reset / Save controls appear in the settings
 * column, where Crop and Scale show theirs.
 *
 * Faces can be edited by hand: "Add face" then drag a box over a face, or
 * remove one with its ×. Either way the point is re-calculated from the
 * remaining faces with the same crop-aware suggestion as auto-detection.
 *
 * "Show crop previews" toggles live thumbnails of every cropped size
 * (size-previews), remembered per browser.
 */

const PREVIEWS_KEY = "noonFocalEditorPreviews";

const readPreviewsPref = () => {
  try {
    return window.localStorage.getItem(PREVIEWS_KEY) === "1";
  } catch (error) {
    return false;
  }
};

const writePreviewsPref = (on) => {
  try {
    window.localStorage.setItem(PREVIEWS_KEY, on ? "1" : "0");
  } catch (error) {
    // Private mode etc.: the toggle still works for this visit.
  }
};

const clamp = (n) => Math.round(Math.min(1, Math.max(0, n)) * 10000) / 10000;

// Smallest box (fraction of the image) accepted as a hand-drawn face, so a
// stray click doesn't add one.
const MIN_FACE = 0.02;

const boxFromDrag = ({ x0, y0, x1, y1 }) => ({
  x: clamp(Math.min(x0, x1)),
  y: clamp(Math.min(y0, y1)),
  w: clamp(Math.abs(x1 - x0)),
  h: clamp(Math.abs(y1 - y0)),
});
const percent = (n) => `${Math.round(n * 100)}%`;

const hasUnsavedEdits = (postId) => {
  const undo = document.getElementById(`image-undo-${postId}`);
  return !!undo && !undo.disabled;
};

/**
 * Track where the preview <img> is, relative to the overlay host. The host
 * is absolutely positioned to fill .imgedit-tools (made relative while in
 * focal mode, because core resets positioning inside the media modal), so
 * the overlay is placed against the host itself. The image is re-rendered
 * after every edit.
 */
const useImageRect = (wrap, overlayHost, active) => {
  const [rect, setRect] = useState(null);

  useLayoutEffect(() => {
    if (!active) {
      return;
    }

    const img = wrap.querySelector("img");

    if (!img) {
      return;
    }

    const measure = () => {
      const container = overlayHost;
      const outer = container.getBoundingClientRect();
      const inner = img.getBoundingClientRect();

      setRect({
        left:
          inner.left - outer.left - container.clientLeft + container.scrollLeft,
        top: inner.top - outer.top - container.clientTop + container.scrollTop,
        width: inner.width,
        height: inner.height,
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(img);
    observer.observe(wrap);
    img.addEventListener("load", measure);
    window.addEventListener("resize", measure);

    return () => {
      observer.disconnect();
      img.removeEventListener("load", measure);
      window.removeEventListener("resize", measure);
    };
  }, [wrap, overlayHost, active]);

  return rect;
};

const ImageEditorFocal = ({
  postId,
  button,
  wrap,
  overlayHost,
  controlsHost,
  previewsHost,
}) => {
  const [active, setActive] = useState(false);
  const [media, setMedia] = useState(null);
  const [point, setPoint] = useState(CENTRE);
  const [faces, setFaces] = useState([]);
  const [source, setSource] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [adding, setAdding] = useState(false);
  const [showPreviews, setShowPreviews] = useState(readPreviewsPref);
  const [draft, setDraft] = useState(null);
  const dragging = useRef(false);
  const rect = useImageRect(wrap, overlayHost, active);
  const blocked = active && hasUnsavedEdits(postId);

  // Toolbar button toggles the mode; opening Crop closes it.
  useEffect(() => {
    const toggle = () => setActive((current) => !current);
    const cropButton = button.parentElement?.querySelector(".imgedit-crop");
    const closeForCrop = () => setActive(false);

    button.addEventListener("click", toggle);
    cropButton?.addEventListener("click", closeForCrop);

    return () => {
      button.removeEventListener("click", toggle);
      cropButton?.removeEventListener("click", closeForCrop);
    };
  }, [button]);

  useEffect(() => {
    button.setAttribute("aria-expanded", active ? "true" : "false");
    controlsHost.hidden = !active;

    // Give the overlay a positioning box around the preview (core resets
    // positioning inside the media modal). Only while in focal mode, so
    // Crop's selection box is never affected.
    wrap
      .closest(".imgedit-tools")
      ?.classList.toggle("noon-focal-active", active);

    if (!active) {
      return;
    }

    // Crop's selection box would sit on top of the point: close it.
    const cropButton = button.parentElement?.querySelector(".imgedit-crop");
    if (cropButton?.getAttribute("aria-expanded") === "true") {
      cropButton.click();
      setActive(true);
    }

    if (!media) {
      fetchMedia(postId).then((record) => {
        const focal = readFocal(record);
        setMedia(record);
        setPoint(focal.point || CENTRE);
        setFaces(focal.faces);
        setSource(focal.source);
      });
    }
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  // Faces changed by hand: keep them and move the point to their centre
  // (with none left, the point stays where it is).
  const applyFaces = (next, message) => {
    setFaces(next);
    const suggested = suggestPoint(next, media);
    if (suggested) {
      setPoint(suggested);
    }
    setSource("manual");
    setDirty(true);
    setStatus(message);
  };

  const removeFace = (index) =>
    applyFaces(
      faces.filter((face, i) => i !== index),
      __(
        "Face removed; focal point re-calculated. Save to keep it.",
        "focal-point-images-smart-crop"
      )
    );

  // Esc leaves "Add face".
  useEffect(() => {
    if (!adding) {
      return;
    }
    const onEscape = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setAdding(false);
        setDraft(null);
      }
    };
    document.addEventListener("keydown", onEscape, true);
    return () => document.removeEventListener("keydown", onEscape, true);
  }, [adding]);

  const move = (next) => {
    setPoint({ x: clamp(next.x), y: clamp(next.y) });
    setSource("manual");
    setDirty(true);
    setStatus("");
  };

  const pointFromEvent = useCallback(
    (event) => {
      const box = overlayHost.firstElementChild?.getBoundingClientRect();
      if (!box) {
        return null;
      }
      return {
        x: (event.clientX - box.left) / box.width,
        y: (event.clientY - box.top) / box.height,
      };
    },
    [overlayHost]
  );

  const onPointerDown = (event) => {
    const next = pointFromEvent(event);
    if (!next) {
      return;
    }
    event.preventDefault();
    dragging.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);

    if (adding) {
      setDraft({ x0: next.x, y0: next.y, x1: next.x, y1: next.y });
    } else {
      move(next);
    }
  };

  const onPointerMove = (event) => {
    if (!dragging.current) {
      return;
    }
    const next = pointFromEvent(event);
    if (!next) {
      return;
    }

    if (adding) {
      setDraft((current) => current && { ...current, x1: next.x, y1: next.y });
    } else {
      move(next);
    }
  };

  const onPointerUp = () => {
    dragging.current = false;

    if (!adding || !draft) {
      return;
    }

    const raw = boxFromDrag(draft);
    setDraft(null);

    if (raw.w < MIN_FACE || raw.h < MIN_FACE) {
      setStatus(
        __("Drag a larger box over the face.", "focal-point-images-smart-crop")
      );
      return;
    }

    setAdding(false);
    applyFaces(
      [...faces, { ...pad(raw), score: 1, manual: true }],
      __(
        "Face added; focal point re-calculated. Save to keep it.",
        "focal-point-images-smart-crop"
      )
    );
  };

  const onKeyDown = (event) => {
    const step = event.shiftKey ? 0.1 : 0.01;
    const deltas = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = deltas[event.key];

    if (delta) {
      event.preventDefault();
      move({ x: point.x + delta[0], y: point.y + delta[1] });
    }
  };

  const detect = async () => {
    setBusy(true);
    setStatus(__("Detecting faces…", "focal-point-images-smart-crop"));

    try {
      // Keeps faces added by hand; replaces previously detected ones.
      const result = mergeDetectedFaces(
        faces,
        await detectFaces(imageSrc(media))
      );
      setFaces(result.faces);
      const suggested = suggestPoint(result.faces, media);
      if (suggested) {
        setPoint(suggested);
      }
      setSource(result.source);
      setDirty(true);
      setStatus(
        `${describeDetection(result)} ${__(
          "Save to keep this point.",
          "focal-point-images-smart-crop"
        )}`
      );
    } catch (error) {
      setStatus(
        __(
          "Face detection failed for this image.",
          "focal-point-images-smart-crop"
        )
      );
    }

    setBusy(false);
  };

  const save = async () => {
    setBusy(true);
    setStatus(__("Saving…", "focal-point-images-smart-crop"));

    try {
      await saveFocal(postId, { point, faces, source: source || "manual" });
      setDirty(false);
      setStatus(__("Focal point saved.", "focal-point-images-smart-crop"));
    } catch (error) {
      setStatus(
        error?.message ||
          __("Could not save the focal point.", "focal-point-images-smart-crop")
      );
    }

    setBusy(false);
  };

  const overlay =
    active && !blocked && media && rect ? (
      <div
        className={`noon-focal-imgedit__overlay${adding ? " is-adding" : ""}`}
        style={rect}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {faces.map((face, index) => (
          <span
            key={`${face.raw.x}-${face.raw.y}-${index}`}
            className={`noon-focal-imgedit__face${
              face.manual ? " is-manual" : ""
            }`}
            style={{
              left: `${face.raw.x * 100}%`,
              top: `${face.raw.y * 100}%`,
              width: `${face.raw.w * 100}%`,
              height: `${face.raw.h * 100}%`,
            }}
          >
            <button
              type="button"
              className="noon-focal-imgedit__remove"
              aria-label={sprintf(
                /* translators: %d: face number */
                __("Remove face %d", "focal-point-images-smart-crop"),
                index + 1
              )}
              title={__("Remove face", "focal-point-images-smart-crop")}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => removeFace(index)}
            >
              ×
            </button>
          </span>
        ))}
        {draft && (
          <span
            className="noon-focal-imgedit__draft"
            aria-hidden="true"
            style={(() => {
              const box = boxFromDrag(draft);
              return {
                left: `${box.x * 100}%`,
                top: `${box.y * 100}%`,
                width: `${box.w * 100}%`,
                height: `${box.h * 100}%`,
              };
            })()}
          />
        )}
        <button
          type="button"
          className="noon-focal-imgedit__handle"
          style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
          aria-label={sprintf(
            /* translators: 1: horizontal %, 2: vertical % */
            __(
              "Focal point at %1$s across, %2$s down. Use the arrow keys to move it (Shift for bigger steps).",
              "focal-point-images-smart-crop"
            ),
            percent(point.x),
            percent(point.y)
          )}
          onKeyDown={onKeyDown}
        />
      </div>
    ) : null;

  const controls = (
    <>
      <div className="imgedit-group-top">
        <h2>{__("Focal Point", "focal-point-images-smart-crop")}</h2>
      </div>
      {blocked ? (
        <p>
          {__(
            "Save or cancel your image edits first, then set the focal point.",
            "focal-point-images-smart-crop"
          )}
        </p>
      ) : (
        <>
          <p className="noon-focal-imgedit__help">
            {__(
              "Click or drag on the image to set the point the front end keeps in view when cropping.",
              "focal-point-images-smart-crop"
            )}
          </p>
          <p className="noon-focal-imgedit__coords">
            {sprintf(
              /* translators: 1: horizontal %, 2: vertical % */
              __("X %1$s · Y %2$s", "focal-point-images-smart-crop"),
              percent(point.x),
              percent(point.y)
            )}
          </p>
          <div className="noon-focal-imgedit__faces">
            <p>
              {faces.length
                ? sprintf(
                    /* translators: %d: number of faces */
                    _n(
                      "%d face",
                      "%d faces",
                      faces.length,
                      "focal-point-images-smart-crop"
                    ),
                    faces.length
                  )
                : __("No faces marked", "focal-point-images-smart-crop")}
            </p>
            <button
              type="button"
              className="button"
              aria-pressed={adding}
              onClick={() => {
                setAdding((current) => !current);
                setDraft(null);
              }}
              disabled={busy || !media}
            >
              {adding
                ? __("Cancel adding", "focal-point-images-smart-crop")
                : __("Add face", "focal-point-images-smart-crop")}
            </button>
          </div>
          {adding && (
            <p className="noon-focal-imgedit__help" aria-live="polite">
              {__(
                "Drag a box over the face on the image. Press Esc to cancel.",
                "focal-point-images-smart-crop"
              )}
            </p>
          )}
          <div className="noon-focal-imgedit__buttons">
            {faceDetectionAvailable() && (
              <button
                type="button"
                className="button"
                onClick={detect}
                disabled={busy || !media}
              >
                {__("Detect faces", "focal-point-images-smart-crop")}
              </button>
            )}
            <button
              type="button"
              className="button"
              onClick={() => move(CENTRE)}
              disabled={busy || !media}
            >
              {__("Reset to centre", "focal-point-images-smart-crop")}
            </button>
            <button
              type="button"
              className="button button-primary"
              onClick={save}
              disabled={busy || !dirty}
            >
              {__("Save focal point", "focal-point-images-smart-crop")}
            </button>
          </div>
          <p className="noon-focal-imgedit__status" aria-live="polite">
            {status}
          </p>
          <label className="noon-focal-imgedit__previews-toggle">
            <input
              type="checkbox"
              checked={showPreviews}
              onChange={(event) => {
                setShowPreviews(event.target.checked);
                writePreviewsPref(event.target.checked);
              }}
            />
            {__("Show crop previews", "focal-point-images-smart-crop")}
          </label>
        </>
      )}
    </>
  );

  const previewsVisible = active && !blocked && showPreviews && !!media;

  useEffect(() => {
    previewsHost.hidden = !previewsVisible;
  }, [previewsHost, previewsVisible]);

  const previews = previewsVisible ? (
    <SizePreviews
      src={imageSrc(media)}
      {...imageDimensions(media)}
      focus={point}
      faces={faces}
      layout="grid"
      showIntro={false}
    />
  ) : null;

  return (
    <>
      {createPortal(overlay, overlayHost)}
      {createPortal(active ? controls : null, controlsHost)}
      {createPortal(previews, previewsHost)}
    </>
  );
};

export default ImageEditorFocal;
