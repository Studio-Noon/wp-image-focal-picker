import { useState, useEffect, useRef } from "@wordpress/element";
import { Button } from "@wordpress/components";
import { __ } from "@wordpress/i18n";
import { useSelect, subscribe, select, dispatch } from "@wordpress/data";
import { addFilter } from "@wordpress/hooks";

import FocalPointModal from "../focal-modal";
import { FocalPicker } from "../faces";
import "./editor.scss";

const DEFAULT_FOCUS = { x: 0.5, y: 0.5 };
const META_KEY = "noon_focal_point";
const META_FACES_KEY = "noon_focal_point_faces";

const isFocus = (value) =>
  value && typeof value.x === "number" && typeof value.y === "number";

const facesEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Adds a focal point picker above the featured image panel and saves the
 * chosen point to the attachment's meta when the post is saved.
 */
function withFocalPointPicker(OriginalComponent) {
  return (props) => {
    const { featuredImageId } = props;

    const imageMeta = useSelect(
      (sel) => (featuredImageId ? sel("core").getMedia(featuredImageId) : null),
      [featuredImageId],
    );

    const savedFocus = isFocus(imageMeta?.meta?.[META_KEY])
      ? imageMeta.meta[META_KEY]
      : DEFAULT_FOCUS;

    const savedFaces = Array.isArray(imageMeta?.meta?.[META_FACES_KEY])
      ? imageMeta.meta[META_FACES_KEY]
      : [];

    const [focalPoint, setFocalPoint] = useState(savedFocus);
    const [isModalOpen, setModalOpen] = useState(false);
    const [faces, setFaces] = useState(savedFaces);
    const latest = useRef({
      focalPoint: savedFocus,
      savedFocus,
      faces: savedFaces,
      savedFaces,
      id: featuredImageId,
    });

    // Reset the picker when the image (or its stored point/faces) changes.
    useEffect(() => {
      setFocalPoint(savedFocus);
      setFaces(savedFaces);
      latest.current.savedFocus = savedFocus;
      latest.current.savedFaces = savedFaces;
      latest.current.id = featuredImageId;
    }, [featuredImageId, savedFocus.x, savedFocus.y, JSON.stringify(savedFaces)]);

    useEffect(() => {
      latest.current.focalPoint = focalPoint;
    }, [focalPoint]);

    useEffect(() => {
      latest.current.faces = faces;
    }, [faces]);

    // Persist the point and faces once per successful (non-auto) post save.
    useEffect(() => {
      let wasSaving = false;

      const unsubscribe = subscribe(() => {
        const editor = select("core/editor");
        const isSaving = editor.isSavingPost() && !editor.isAutosavingPost();

        if (isSaving) {
          wasSaving = true;
          return;
        }

        if (!wasSaving) {
          return;
        }
        wasSaving = false;

        if (!editor.didPostSaveRequestSucceed()) {
          return;
        }

        const { focalPoint: current, savedFocus: saved, faces: currentFaces, savedFaces: savedFacesNow, id } = latest.current;

        const focusChanged = !(current.x === saved.x && current.y === saved.y);
        const facesChanged = !facesEqual(currentFaces, savedFacesNow);

        if (!id || (!focusChanged && !facesChanged)) {
          return;
        }

        const meta = {};
        if (focusChanged) {
          latest.current.savedFocus = current;
          meta[META_KEY] = current;
        }
        if (facesChanged) {
          latest.current.savedFaces = currentFaces;
          meta[META_FACES_KEY] = currentFaces;
        }

        // Saving through the entity store keeps getMedia() in sync.
        dispatch("core").saveEntityRecord("postType", "attachment", { id, meta });
      });

      return unsubscribe;
    }, []);

    if (!imageMeta) {
      return <OriginalComponent {...props} />;
    }

    return (
      <div className="remove_standard_image">
        <FocalPicker
          label=""
          url={imageMeta.source_url}
          dimensions={{ width: imageMeta.width, height: imageMeta.height }}
          value={focalPoint}
          onChange={setFocalPoint}
          faces={faces}
          onFacesChange={setFaces}
        />
        <Button
          variant="secondary"
          size="small"
          onClick={() => setModalOpen(true)}
          style={{ marginTop: 8 }}
        >
          {__("Edit focal point", "focal-point-images-smart-crop")}
        </Button>
        {isModalOpen && (
          <FocalPointModal
            src={imageMeta.source_url}
            width={imageMeta.media_details?.width}
            height={imageMeta.media_details?.height}
            value={focalPoint}
            faces={faces}
            onApply={(point, found) => {
              setFocalPoint(point);
              setFaces(found);
              setModalOpen(false);
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
