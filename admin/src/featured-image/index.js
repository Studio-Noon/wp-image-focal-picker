import { useState, useEffect, useRef } from "@wordpress/element";
import { Button } from "@wordpress/components";
import { __ } from "@wordpress/i18n";
import { useSelect, subscribe, select, dispatch } from "@wordpress/data";
import { addFilter } from "@wordpress/hooks";

import FocalPointModal from "../focal-modal";
import { FaceSuggest, FocalPicker } from "../faces";
import "./editor.scss";

const DEFAULT_FOCUS = { x: 0.5, y: 0.5 };
const META_KEY = "noon_focal_point";

const isFocus = (value) =>
  value && typeof value.x === "number" && typeof value.y === "number";

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

    const [focalPoint, setFocalPoint] = useState(savedFocus);
    const [isModalOpen, setModalOpen] = useState(false);
    const [faces, setFaces] = useState([]);
    const latest = useRef({
      focalPoint: savedFocus,
      saved: savedFocus,
      id: featuredImageId,
    });

    // Reset the picker when the image (or its stored point) changes.
    useEffect(() => {
      setFocalPoint(savedFocus);
      setFaces([]);
      latest.current.saved = savedFocus;
      latest.current.id = featuredImageId;
    }, [featuredImageId, savedFocus.x, savedFocus.y]);

    useEffect(() => {
      latest.current.focalPoint = focalPoint;
    }, [focalPoint]);

    // Persist the point once per successful (non-auto) post save.
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

        const { focalPoint: current, saved, id } = latest.current;

        if (!id || (current.x === saved.x && current.y === saved.y)) {
          return;
        }

        latest.current.saved = current;

        // Saving through the entity store keeps getMedia() in sync.
        dispatch("core").saveEntityRecord("postType", "attachment", {
          id,
          meta: { [META_KEY]: current },
        });
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
        <FaceSuggest
          src={imageMeta.source_url}
          width={imageMeta.media_details?.width}
          height={imageMeta.media_details?.height}
          onFaces={setFaces}
          faces={faces}
          onSuggest={setFocalPoint}
        />
        <Button
          variant="secondary"
          size="small"
          onClick={() => setModalOpen(true)}
          style={{ marginTop: 8 }}
        >
          {__("Edit full screen", "focal-point-images-smart-crop")}
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
      </div>
    );
  };
}

addFilter(
  "editor.PostFeaturedImage",
  "focal-point-images-smart-crop/featured-image-display",
  withFocalPointPicker,
);
