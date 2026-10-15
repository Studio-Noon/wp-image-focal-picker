/**
 * Reading and saving an attachment's focal point over REST (meta registered
 * in the admin class), plus the shared rules every picker uses:
 *
 * - suggestPoint(): the crop-aware suggestion (faces/suggest.js) for the
 *   image's registered sizes, falling back to the faces' weighted centre;
 * - mergeDetectedFaces(): a fresh detection never drops faces added by hand;
 * - a "saved" event so every open picker (media library, image editor,
 *   block toolbar, in separate bundles) updates when one of them saves.
 */
import apiFetch from "@wordpress/api-fetch";
import { __, _n, sprintf } from "@wordpress/i18n";

import { previewSizes } from "../crop-position";
import { faceDetectionAvailable } from "../faces/detect";
import { faceCentroid, suggestFocus } from "../faces/suggest";

export const CENTRE = { x: 0.5, y: 0.5 };
export const FOCAL_SAVED_EVENT = "noon-focal-saved";

const FIELDS = "id,mime_type,source_url,media_details,meta";

export { faceDetectionAvailable };

export const fetchMedia = (id) =>
  apiFetch({ path: `/wp/v2/media/${id}?context=edit&_fields=${FIELDS}` });

export const isImage = (media) => !!media?.mime_type?.startsWith("image/");

/**
 * A mid-sized rendition for previews and detection. Coordinates are
 * fractions, so any size of the same image gives the same answer.
 */
export const imageSrc = (media) => {
  const sizes = media?.media_details?.sizes || {};

  return (
    sizes.large?.source_url ||
    sizes.medium_large?.source_url ||
    media?.source_url
  );
};

export const imageDimensions = (media) => ({
  width: media?.media_details?.width || 0,
  height: media?.media_details?.height || 0,
});

export const readFocal = (media) => {
  const meta = media?.meta || {};
  const point = meta.noon_focal_point;

  return {
    point:
      point && typeof point.x === "number" && typeof point.y === "number"
        ? point
        : null,
    faces: Array.isArray(meta.noon_focal_point_faces)
      ? meta.noon_focal_point_faces
      : [],
    source: meta.noon_focal_point_source || "",
  };
};

/**
 * Focal point for a set of faces: the spot that keeps them whole across the
 * registered crop sizes, or their weighted centre without sizes. Null when
 * there are no faces.
 */
export const suggestPoint = (faces, media) => {
  if (!faces.length) {
    return null;
  }

  const { width, height } = imageDimensions(media);

  return (
    suggestFocus(faces, width, height, previewSizes()) || faceCentroid(faces)
  );
};

// Overlap (intersection over union) of two raw face boxes.
const overlap = (a, b) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);

  if (w <= 0 || h <= 0) {
    return 0;
  }

  const inter = w * h;
  return inter / (a.w * a.h + b.w * b.h - inter);
};

/**
 * Combine a fresh detection with the faces already marked. Faces added by
 * hand are always kept; previously detected ones are replaced by the new
 * results, minus any that land on a hand-added face (no double counting).
 *
 * @return {{faces: Array, manual: number, detected: number, source: string}}
 *         `source` is 'manual' while hand-added faces remain (so automatic
 *         detection never overwrites them), otherwise 'auto'.
 */
export const mergeDetectedFaces = (existing, found) => {
  const manual = (existing || []).filter((face) => face.manual);
  const detected = found.filter(
    (face) => !manual.some((kept) => overlap(kept.raw, face.raw) >= 0.4),
  );

  return {
    faces: [...manual, ...detected],
    manual: manual.length,
    detected: detected.length,
    source: manual.length ? "manual" : "auto",
  };
};

/**
 * Status line after detecting, e.g. "Found 2 faces; kept 1 added by hand."
 */
export const describeDetection = ({ manual, detected }) => {
  const found = detected
    ? sprintf(
        /* translators: %d: number of faces */
        _n("Found %d face", "Found %d faces", detected, "focal-point-images-smart-crop"),
        detected,
      )
    : __("No new faces found", "focal-point-images-smart-crop");

  return manual
    ? sprintf(
        /* translators: 1: e.g. "Found 2 faces", 2: number of hand-added faces */
        _n(
          "%1$s; kept %2$d added by hand.",
          "%1$s; kept %2$d added by hand.",
          manual,
          "focal-point-images-smart-crop",
        ),
        found,
        manual,
      )
    : `${found}.`;
};

/**
 * Tell every open picker that an image's focal point changed.
 */
export const announceFocalSaved = (id, media) =>
  window.dispatchEvent(
    new CustomEvent(FOCAL_SAVED_EVENT, {
      detail: { id, media, point: readFocal(media).point },
    }),
  );

/**
 * Save any of point / faces / source (omitted keys are left as they are).
 */
export const saveFocal = async (id, { point, faces, source }) => {
  const meta = {};

  if (point !== undefined) {
    meta.noon_focal_point = point;
  }
  if (faces !== undefined) {
    meta.noon_focal_point_faces = faces;
  }
  if (source !== undefined) {
    meta.noon_focal_point_source = source;
  }

  const media = await apiFetch({
    path: `/wp/v2/media/${id}?context=edit&_fields=${FIELDS}`,
    method: "POST",
    data: { meta },
  });

  announceFocalSaved(id, media);

  return media;
};

/**
 * Subscribe to saves of one image (or all, without an id).
 */
export const onFocalSaved = (listener, id = null) => {
  const handle = (event) => {
    if (id === null || event.detail?.id === id) {
      listener(event.detail);
    }
  };

  window.addEventListener(FOCAL_SAVED_EVENT, handle);
  return () => window.removeEventListener(FOCAL_SAVED_EVENT, handle);
};
