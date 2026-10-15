import {
  createPortal,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "@wordpress/element";
import { __, sprintf } from "@wordpress/i18n";
import {
  Button,
  Notice,
  __experimentalDivider as Divider,
  __experimentalHStack as HStack,
  __experimentalHeading as Heading,
  __experimentalText as Text,
  __experimentalToggleGroupControl as ToggleGroupControl,
  __experimentalToggleGroupControlOption as ToggleGroupControlOption,
  __experimentalVStack as VStack,
} from "@wordpress/components";
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
 * editor's own preview image and the controls appear in the settings column,
 * where Crop and Scale show theirs, with live crop previews beside it.
 *
 * Three ways to set the point:
 * - Centre: the middle of the image.
 * - Manual: click or drag on the image (arrow keys when the point is focused).
 * - Face detection: the point is calculated from the marked faces, detected
 *   or drawn by hand ("Add face", then drag a box). Removing or adding a face
 *   re-calculates it; selecting one focuses on that face alone.
 *
 * Centre and Manual save with source "manual" and no faces, so automatic
 * detection never overrides them.
 */

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
const isCentre = (point) => point.x === CENTRE.x && point.y === CENTRE.y;

const initialMode = ({ point, faces }) => {
  if (faces.length) {
    return "faces";
  }
  return point && !isCentre(point) ? "manual" : "centre";
};

// Source to save for a set of faces: detected-only faces may be re-detected
// after an edit ('auto'); any drawn by hand pins them ('manual').
const facesSource = (faces) =>
  faces.some((face) => face.manual) ? "manual" : "auto";

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

/**
 * The face's part of the image as a CSS background, for the face list.
 */
const faceThumbStyle = (src, raw) => {
  const w = Math.max(raw.w, 0.0001);
  const h = Math.max(raw.h, 0.0001);

  return {
    backgroundImage: `url("${src}")`,
    backgroundSize: `${100 / w}% ${100 / h}%`,
    backgroundPosition: `${w >= 1 ? 0 : (raw.x / (1 - w)) * 100}% ${
      h >= 1 ? 0 : (raw.y / (1 - h)) * 100
    }%`,
  };
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
  const [mode, setMode] = useState("centre");
  const [point, setPoint] = useState(CENTRE);
  const [faces, setFaces] = useState([]);
  const [source, setSource] = useState("");
  const [selected, setSelected] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState(null);
  const dragging = useRef(false);
  const rect = useImageRect(wrap, overlayHost, active);
  const blocked = active && hasUnsavedEdits(postId);
  const showFaces = mode === "faces";

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
        setMode(initialMode(focal));
      });
    }
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  const stopAdding = () => {
    setAdding(false);
    setDraft(null);
  };

  const changeMode = (next) => {
    if (next === mode) {
      return;
    }

    setMode(next);
    setSelected(null);
    stopAdding();
    setDirty(true);

    if (next === "centre") {
      setPoint(CENTRE);
      setSource("manual");
      setStatus("");
    } else if (next === "manual") {
      setSource("manual");
      setStatus("");
    } else {
      const suggested = suggestPoint(faces, media);
      if (suggested) {
        setPoint(suggested);
      }
      setSource(facesSource(faces));
      setStatus(
        faces.length
          ? ""
          : __(
              "No faces marked yet. Detect faces, or add one by hand.",
              "focal-point-images-smart-crop"
            )
      );
    }
  };

  // Faces changed by hand: keep them and re-calculate the point from them
  // (with none left, the point stays where it is).
  const applyFaces = (next, message) => {
    setFaces(next);
    setSelected(null);
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

  // Selecting a face focuses on it alone; selecting it again goes back to
  // all of them.
  const selectFace = (index) => {
    const next = selected === index ? null : index;
    const suggested = suggestPoint(
      next === null ? faces : [faces[index]],
      media
    );

    setSelected(next);
    if (suggested) {
      setPoint(suggested);
    }
    setSource("manual");
    setDirty(true);
    setStatus("");
  };

  // Esc leaves "Add face".
  useEffect(() => {
    if (!adding) {
      return;
    }
    const onEscape = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        stopAdding();
      }
    };
    document.addEventListener("keydown", onEscape, true);
    return () => document.removeEventListener("keydown", onEscape, true);
  }, [adding]);

  // Moving the point by hand switches to Manual.
  const move = (next) => {
    setPoint({ x: clamp(next.x), y: clamp(next.y) });
    setMode("manual");
    setSelected(null);
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
    stopAdding();
    setStatus(__("Detecting faces…", "focal-point-images-smart-crop"));

    try {
      // Keeps faces added by hand; replaces previously detected ones.
      const result = mergeDetectedFaces(
        faces,
        await detectFaces(imageSrc(media))
      );
      setFaces(result.faces);
      setSelected(null);
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
      await saveFocal(
        postId,
        showFaces
          ? { point, faces, source: source || facesSource(faces) }
          : { point, faces: [], source: "manual" }
      );
      if (!showFaces) {
        setFaces([]);
      }
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
        {showFaces &&
          faces.map((face, index) => (
            <span
              key={`${face.raw.x}-${face.raw.y}-${index}`}
              className={`noon-focal-imgedit__face${
                face.manual ? " is-manual" : ""
              }${selected === index ? " is-selected" : ""}`}
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
                <span className="dashicons dashicons-no-alt" aria-hidden="true" />
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

  const facesPanel = (
    <VStack spacing={3}>
      <Heading level={3} size={15}>
        {__("Face detection", "focal-point-images-smart-crop")}
      </Heading>
      <Text as="p" variant="muted">
        {__(
          "Detected faces are used to calculate the focal point. Remove any faces you do not want included.",
          "focal-point-images-smart-crop"
        )}
      </Text>
      {faceDetectionAvailable() && (
        <Button
          variant="secondary"
          className="noon-focal-imgedit__wide"
          icon="smiley"
          iconPosition="right"
          onClick={detect}
          isBusy={busy}
          disabled={busy || !media}
          __next40pxDefaultSize
        >
          {__("Detect faces", "focal-point-images-smart-crop")}
        </Button>
      )}
      {faces.length > 0 && (
      <ul
        className="noon-focal-imgedit__face-list is-scrollable"
        tabIndex={faces.length > 2 ? 0 : undefined}
        aria-label={__("Marked faces", "focal-point-images-smart-crop")}
      >
        {faces.map((face, index) => (
          <li
            key={`${face.raw.x}-${face.raw.y}-${index}`}
            className={`noon-focal-imgedit__face-item${
              selected === index ? " is-selected" : ""
            }`}
          >
            <button
              type="button"
              className="noon-focal-imgedit__face-select"
              aria-pressed={selected === index}
              onClick={() => selectFace(index)}
            >
              <span
                className="noon-focal-imgedit__face-thumb"
                style={media ? faceThumbStyle(imageSrc(media), face.raw) : undefined}
                aria-hidden="true"
              />
              <span className="noon-focal-imgedit__face-label">
                {sprintf(
                  /* translators: %d: face number */
                  __("Face %d", "focal-point-images-smart-crop"),
                  index + 1
                )}
                {face.manual && (
                  <span className="noon-focal-imgedit__face-meta">
                    {__("Added by hand", "focal-point-images-smart-crop")}
                  </span>
                )}
              </span>
            </button>
            <Button
              icon="dismiss"
              isDestructive
              size="small"
              label={sprintf(
                /* translators: %d: face number */
                __("Remove face %d", "focal-point-images-smart-crop"),
                index + 1
              )}
              onClick={() => removeFace(index)}
            />
          </li>
        ))}
      </ul>
      )}
      <ul className="noon-focal-imgedit__face-list">
        <li
          className={`noon-focal-imgedit__face-item is-add${
            adding ? " is-selected" : ""
          }`}
        >
          <button
            type="button"
            className="noon-focal-imgedit__face-select"
            aria-pressed={adding}
            disabled={busy || !media}
            onClick={() => (adding ? stopAdding() : setAdding(true))}
          >
            <span
              className="noon-focal-imgedit__face-thumb is-icon"
              aria-hidden="true"
            >
              <span
                className={`dashicons dashicons-${adding ? "no-alt" : "plus-alt2"}`}
              />
            </span>
            <span className="noon-focal-imgedit__face-label">
              {adding
                ? __("Cancel adding", "focal-point-images-smart-crop")
                : __("Add face", "focal-point-images-smart-crop")}
              <span className="noon-focal-imgedit__face-meta">
                {adding
                  ? __(
                      "Drag a box over the face on the image. Press Esc to cancel.",
                      "focal-point-images-smart-crop"
                    )
                  : __(
                      "Drag a box over the face on the image.",
                      "focal-point-images-smart-crop"
                    )}
              </span>
            </span>
          </button>
        </li>
      </ul>
    </VStack>
  );

  const controls = (
    <VStack spacing={4} className="noon-focal-imgedit__panel">
      <VStack spacing={2}>
        <Heading level={2} size={18}>
          {__("Focal Point", "focal-point-images-smart-crop")}
        </Heading>
        <Text as="p" variant="muted">
          {__(
            "Click on the image, or select a detected face, to set the focal point. It helps keep the most important part in view when cropping.",
            "focal-point-images-smart-crop"
          )}
        </Text>
      </VStack>
      {blocked ? (
        <Notice status="warning" isDismissible={false}>
          {__(
            "Save or cancel your image edits first, then set the focal point.",
            "focal-point-images-smart-crop"
          )}
        </Notice>
      ) : (
        <>
          <ToggleGroupControl
            __nextHasNoMarginBottom
            __next40pxDefaultSize
            isBlock
            label={__("How to set the focal point", "focal-point-images-smart-crop")}
            hideLabelFromVision
            value={mode}
            onChange={changeMode}
          >
            <ToggleGroupControlOption
              value="centre"
              label={__("Centre", "focal-point-images-smart-crop")}
            />
            <ToggleGroupControlOption
              value="manual"
              label={__("Manual", "focal-point-images-smart-crop")}
            />
            <ToggleGroupControlOption
              value="faces"
              label={__("Face detection", "focal-point-images-smart-crop")}
            />
          </ToggleGroupControl>
          <Divider />
          {mode === "centre" && (
            <Text as="p" variant="muted">
              {__(
                "The centre of the image is kept in view. Click on the image to choose a point instead.",
                "focal-point-images-smart-crop"
              )}
            </Text>
          )}
          {mode === "manual" && (
            <Text as="p" variant="muted">
              {__(
                "Click or drag on the image to place the point. When it's focused, the arrow keys nudge it (hold Shift for bigger steps).",
                "focal-point-images-smart-crop"
              )}
            </Text>
          )}
          {mode === "faces" && facesPanel}
          <Divider />
          <HStack justify="space-between" wrap>
            <HStack spacing={2} expanded={false}>
              <span className="noon-focal-imgedit__chip">
                {sprintf(
                  /* translators: %s: horizontal position, e.g. 34% */
                  __("X %s", "focal-point-images-smart-crop"),
                  percent(point.x)
                )}
              </span>
              <span className="noon-focal-imgedit__chip">
                {sprintf(
                  /* translators: %s: vertical position, e.g. 66% */
                  __("Y %s", "focal-point-images-smart-crop"),
                  percent(point.y)
                )}
              </span>
            </HStack>
            <Button
              variant="primary"
              onClick={save}
              disabled={busy || !dirty}
              __next40pxDefaultSize
            >
              {__("Save focal point", "focal-point-images-smart-crop")}
            </Button>
          </HStack>
          {status && (
            <Text as="p" variant="muted" aria-live="polite">
              {status}
            </Text>
          )}
        </>
      )}
    </VStack>
  );

  const previewsVisible = active && !blocked && !!media;

  useEffect(() => {
    previewsHost.hidden = !previewsVisible;
  }, [previewsHost, previewsVisible]);

  const previews = previewsVisible ? (
    <VStack spacing={4}>
      <VStack spacing={2}>
        <Heading level={2} size={18}>
          {__("Crop previews", "focal-point-images-smart-crop")}
        </Heading>
        <Text as="p" variant="muted">
          {__(
            "The focal point will be kept in view in common sizes.",
            "focal-point-images-smart-crop"
          )}
        </Text>
      </VStack>
      <SizePreviews
        src={imageSrc(media)}
        {...imageDimensions(media)}
        focus={point}
        faces={showFaces ? faces : []}
        layout="grid"
        showIntro={false}
      />
    </VStack>
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
