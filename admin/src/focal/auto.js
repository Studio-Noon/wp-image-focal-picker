/**
 * Automatic face detection after every image upload, wherever it happens:
 *
 * - media library grid and every media modal (wp.Uploader's queue);
 * - "Add New Media File" (media-new.php's plupload instance);
 * - block editor uploads (POST /wp/v2/media through apiFetch).
 *
 * Detection runs in the background, one image at a time. It never touches an
 * image whose focal point was set by hand (source 'manual') and skips ones
 * already detected ('auto') unless they've been edited since ('stale', set
 * server-side when the image editor saves). Respects the
 * noon_focal_face_detection filter via faceDetectionAvailable().
 */
import apiFetch from "@wordpress/api-fetch";

import { detectFaces } from "../faces/detect";
import {
  CENTRE,
  faceDetectionAvailable,
  fetchMedia,
  imageSrc,
  isImage,
  mergeDetectedFaces,
  readFocal,
  saveFocal,
  suggestPoint,
} from "./data";

const queue = [];
const pending = new Set();
let running = false;

const shouldDetect = (source) => source === "" || source === "stale";

const detectAndSave = async (id) => {
  const media = await fetchMedia(id);

  if (!isImage(media) || !shouldDetect(readFocal(media).source)) {
    return;
  }

  const found = await detectFaces(imageSrc(media));

  // Re-check: someone may have set the point by hand while detecting.
  const latest = readFocal(await fetchMedia(id));
  if (!shouldDetect(latest.source)) {
    return;
  }

  // Keep any faces added by hand (e.g. re-detecting after an image edit).
  const { faces, source } = mergeDetectedFaces(latest.faces, found);

  await saveFocal(id, {
    point: suggestPoint(faces, media) || latest.point || CENTRE,
    faces,
    source,
  });
};

const drain = async () => {
  if (running) {
    return;
  }

  running = true;

  while (queue.length) {
    const id = queue.shift();

    try {
      await detectAndSave(id);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn(`Focal point detection failed for media ${id}.`, error);
    }

    pending.delete(id);
  }

  running = false;
};

export const queueDetection = (id) => {
  const mediaId = parseInt(id, 10);

  if (!mediaId || pending.has(mediaId) || !faceDetectionAvailable()) {
    return;
  }

  pending.add(mediaId);
  queue.push(mediaId);
  drain();
};

// Media library grid and media modals.
const watchUploaderQueue = () => {
  const uploadQueue = window.wp?.Uploader?.queue;

  if (!uploadQueue) {
    return;
  }

  uploadQueue.on("add", (attachment) => {
    const onUploaded = () => {
      if (attachment.get("uploading")) {
        return;
      }

      attachment.off("change:uploading", onUploaded);

      if (attachment.get("id") && attachment.get("type") === "image") {
        queueDetection(attachment.get("id"));
      }
    };

    attachment.on("change:uploading", onUploaded);
  });
};

// media-new.php: the response body is the new attachment's ID.
const watchMediaNew = () => {
  const uploader = window.uploader;

  if (!uploader?.bind || !document.body.classList.contains("media-new-php")) {
    return;
  }

  uploader.bind("FileUploaded", (up, file, response) =>
    queueDetection(response?.response),
  );
};

// Block editor uploads (and anything else creating media over REST).
const CREATE_MEDIA = /\/wp\/v2\/media\/?(\?|$)/;

let middlewareAdded = false;

export const watchUploads = () => {
  if (middlewareAdded) {
    return;
  }
  middlewareAdded = true;

  apiFetch.use((options, next) => {
    const result = next(options);
    const target = options.path || options.url || "";

    if (
      (options.method || "GET").toUpperCase() === "POST" &&
      CREATE_MEDIA.test(target)
    ) {
      Promise.resolve(result)
        .then((media) => {
          if (media?.id && isImage(media)) {
            queueDetection(media.id);
          }
        })
        .catch(() => {});
    }

    return result;
  });

  watchUploaderQueue();

  // media-new.php's uploader is created on DOM ready by handlers.js.
  window.jQuery?.(() => setTimeout(watchMediaNew));
};
