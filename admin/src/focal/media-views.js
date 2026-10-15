/**
 * The focal point UI lives in the "Edit image" view (crop/rotate/scale): a
 * "Focal Point" toolbar button that toggles focal point mode on the preview
 * image. Core has no PHP hook there, so it's added when imageEdit.open() has
 * loaded the panel.
 *
 * Opening an image's details (media grid, any media modal, the attachment
 * edit screen) also re-runs face detection if an image edit has made its
 * automatically detected point stale.
 */
import { createRoot } from "@wordpress/element";
import { __ } from "@wordpress/i18n";

import ImageEditorFocal from "./image-editor";
import { queueDetection } from "./auto";
import { fetchMedia, isImage, readFocal } from "./data";

const roots = new Map();

// Unmount roots whose container a re-render (or closing the editor) removed.
const sweep = () => {
  roots.forEach((root, el) => {
    if (!el.isConnected) {
      root.unmount();
      roots.delete(el);
    }
  });
};

const redetectIfStale = (id) => {
  if (!id) {
    return;
  }

  fetchMedia(id).then((record) => {
    if (isImage(record) && readFocal(record).source === "stale") {
      queueDetection(id);
    }
  });
};

const addToImageEditor = (postId) => {
  const panel = document.getElementById(`imgedit-panel-${postId}`);
  const menu = panel?.querySelector(".imgedit-panel-tools .imgedit-menu");
  const wrap = document.getElementById(`imgedit-crop-${postId}`);
  const settings = panel?.querySelector(".imgedit-settings");

  if (!menu || !wrap || !settings || menu.querySelector(".imgedit-focal")) {
    return;
  }

  sweep();

  // Styled like Crop / Scale (dashicon via :before, see style.scss).
  const button = document.createElement("button");
  button.type = "button";
  button.className = "imgedit-focal button";
  button.textContent = __("Focal Point", "focal-point-images-smart-crop");
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-controls", `noon-focal-imgedit-${postId}`);
  menu.appendChild(button);

  // Fills .imgedit-tools (absolute, inset 0); the overlay inside it is placed
  // over the preview image.
  const overlayHost = document.createElement("div");
  overlayHost.className = "noon-focal-imgedit__host";
  wrap.appendChild(overlayHost);

  const controlsHost = document.createElement("div");
  controlsHost.id = `noon-focal-imgedit-${postId}`;
  controlsHost.className = "imgedit-group noon-focal-imgedit";
  controlsHost.hidden = true;
  settings.prepend(controlsHost);

  // Third item in core's wrapping flex row (image, settings): a sidebar when
  // there's room, a full-width row under the image when there isn't.
  const previewsHost = document.createElement("div");
  previewsHost.className = "noon-focal-imgedit-previews";
  previewsHost.hidden = true;
  settings.after(previewsHost);

  const root = createRoot(document.createElement("div"));
  root.render(
    <ImageEditorFocal
      postId={parseInt(postId, 10)}
      button={button}
      wrap={wrap}
      overlayHost={overlayHost}
      controlsHost={controlsHost}
      previewsHost={previewsHost}
    />,
  );

  roots.set(overlayHost, root);
};

export const watchMediaViews = () => {
  // Attachment details in the media grid and modals.
  const Compat = window.wp?.media?.view?.AttachmentCompat;

  if (Compat) {
    const render = Compat.prototype.render;

    Compat.prototype.render = function (...args) {
      const result = render.apply(this, args);
      if (this.model?.get("type") === "image") {
        redetectIfStale(this.model.id);
      }
      return result;
    };
  }

  // "Edit image" view, in the media modal and on the attachment edit screen.
  const imageEdit = window.imageEdit;

  if (imageEdit?.open) {
    const open = imageEdit.open;

    imageEdit.open = function (postId, ...rest) {
      const request = open.call(this, postId, ...rest);

      window.jQuery?.when(request).done(() => addToImageEditor(postId));

      return request;
    };
  }

  // Attachment edit screen (post.php).
  window.jQuery?.(() => {
    if (document.body.classList.contains("post-type-attachment")) {
      redetectIfStale(parseInt(document.getElementById("post_ID")?.value, 10));
    }
  });
};
