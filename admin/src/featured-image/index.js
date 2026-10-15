import { useState, useEffect, useRef } from "@wordpress/element";
import { Button } from "@wordpress/components";
import { __ } from "@wordpress/i18n";
import { addFilter } from "@wordpress/hooks";

import FocalPointModal from "../focal-modal";
import { FocalPicker } from "../faces";
import {
  CENTRE,
  fetchMedia,
  imageDimensions,
  onFocalSaved,
  readFocal,
  saveFocal,
} from "../focal/data";
import "./editor.scss";

const SAVE_DELAY = 400;

/**
 * Focal point picker above the featured image panel.
 *
 * A featured image has no per-post focal point: this edits the image's own
 * (the same meta as the media library, image editor and block toolbar), so
 * it's saved straight away (debounced) rather than with the post, and it
 * stays in sync when the point is changed in any of those other places.
 */
function withFocalPointPicker(OriginalComponent) {
  return (props) => {
    const { featuredImageId: id } = props;

    const [media, setMedia] = useState(null);
    const [focalPoint, setFocalPoint] = useState(CENTRE);
    const [faces, setFaces] = useState([]);
    const [isModalOpen, setModalOpen] = useState(false);
    const [status, setStatus] = useState("");
    const timer = useRef(null);
    const queued = useRef(null);

    // Load the image, then follow saves made anywhere else.
    useEffect(() => {
      setMedia(null);

      if (!id) {
        return;
      }

      let live = true;

      const apply = (record) => {
        const focal = readFocal(record);
        setMedia(record);
        setFocalPoint(focal.point || CENTRE);
        setFaces(focal.faces);
      };

      fetchMedia(id)
        .then((record) => live && apply(record))
        .catch(() => {});

      const unsubscribe = onFocalSaved((detail) => {
        // Ignore the echo of our own pending save.
        if (live && detail.media && !queued.current) {
          apply(detail.media);
        }
      }, id);

      return () => {
        live = false;
        unsubscribe();
      };
    }, [id]);

    const flush = () => {
      clearTimeout(timer.current);
      timer.current = null;

      const change = queued.current;
      queued.current = null;

      if (!change || !id) {
        return;
      }

      saveFocal(id, { ...change, source: "manual" })
        .then(() =>
          setStatus(__("Saved to the image.", "focal-point-images-smart-crop")),
        )
        .catch(() =>
          setStatus(__("Could not save the focal point.", "focal-point-images-smart-crop")),
        );
    };

    // Save anything pending when the image changes or the panel goes away.
    useEffect(() => () => flush(), [id]); // eslint-disable-line react-hooks/exhaustive-deps

    const save = (change) => {
      queued.current = { ...(queued.current || {}), ...change };
      setStatus("");
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_DELAY);
    };

    if (!id || !media) {
      return <OriginalComponent {...props} />;
    }

    const { width, height } = imageDimensions(media);

    return (
      <div className="remove_standard_image">
        <FocalPicker
          label=""
          url={media.source_url}
          dimensions={{ width, height }}
          value={focalPoint}
          onChange={(point) => {
            setFocalPoint(point);
            save({ point });
          }}
          faces={faces}
          onFacesChange={(next) => {
            setFaces(next);
            save({ faces: next });
          }}
        />
        <p className="description noon-focal-featured-image__status" aria-live="polite">
          {status ||
            __(
              "The image’s own focal point, used wherever it appears.",
              "focal-point-images-smart-crop",
            )}
        </p>
        <Button variant="secondary" size="small" onClick={() => setModalOpen(true)}>
          {__("Edit focal point", "focal-point-images-smart-crop")}
        </Button>
        {isModalOpen && (
          <FocalPointModal
            src={media.source_url}
            width={width}
            height={height}
            value={focalPoint}
            faces={faces}
            onApply={(point, found) => {
              setFocalPoint(point);
              setFaces(found);
              setModalOpen(false);
              save({ point, faces: found });
              flush();
            }}
            onClose={() => setModalOpen(false)}
          />
        )}
        <OriginalComponent {...props} />
        <hr className="noon-focal-featured-image__divider" />
      </div>
    );
  };
}

addFilter(
  "editor.PostFeaturedImage",
  "focal-point-images-smart-crop/featured-image-display",
  withFocalPointPicker,
);
