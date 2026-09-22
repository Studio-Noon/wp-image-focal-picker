/**
 * Wording shared by the block-editor pickers and the media-modal dialog.
 * Only depends on i18n, so the media-library script stays light.
 */
import { __, _n, sprintf } from "@wordpress/i18n";

export function facesSelectionMessage(faces) {
  return sprintf(
    /* translators: %d: number of faces remaining after manual selection. */
    _n("%d face selected.", "%d faces selected.", faces.length, "focal-point-images-smart-crop"),
    faces.length,
  );
}

/**
 * Message for a detection result.
 *
 * @param {Array|null} faces
 * @return {string}
 */
export function facesMessage(faces) {
  if (!faces) {
    return "";
  }
  if (!faces.length) {
    return __("No faces found.", "focal-point-images-smart-crop");
  }
  return sprintf(
    /* translators: %d: number of faces */
    _n(
      "%d face found — focal point moved to keep it in every crop.",
      "%d faces found — focal point moved to keep as many as possible in every crop.",
      faces.length,
      "focal-point-images-smart-crop",
    ),
    faces.length,
  );
}

/**
 * Badge text for a crop box, given how it treats the faces.
 *
 * @param {{kept: number, tight: number, cut: number, out: number}} c
 * @return {{text: string, state: string}|null}
 */
export function faceBadge(c) {
  if (c.cut) {
    return {
      state: "cut",
      text: sprintf(
        /* translators: %d: number of faces */
        _n("%d face cut", "%d faces cut", c.cut, "focal-point-images-smart-crop"),
        c.cut,
      ),
    };
  }
  if (c.tight) {
    return {
      state: "tight",
      text: sprintf(
        /* translators: %d: number of faces */
        _n(
          "%d face tight",
          "%d faces tight",
          c.tight,
          "focal-point-images-smart-crop",
        ),
        c.tight,
      ),
    };
  }
  if (c.out) {
    return {
      state: "out",
      text: sprintf(
        /* translators: %d: number of faces */
        _n(
          "%d face out of frame",
          "%d faces out of frame",
          c.out,
          "focal-point-images-smart-crop",
        ),
        c.out,
      ),
    };
  }
  if (c.kept) {
    return {
      state: "kept",
      text: __("Faces in", "focal-point-images-smart-crop"),
    };
  }
  return null;
}
