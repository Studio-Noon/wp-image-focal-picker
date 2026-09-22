/**
 * Adds a "Focal point" panel to the Image and Media & Text blocks' sidebar.
 *
 * The point is stored on the attachment (the same meta the media modal and
 * featured-image panel edit), so it applies wherever that image is used. It
 * is saved straight away, debounced, rather than with the post: a focal-point
 * change on its own does not dirty the post, so there would be nothing to save.
 */
import { createHigherOrderComponent } from "@wordpress/compose";
import { addFilter } from "@wordpress/hooks";
import { InspectorControls } from "@wordpress/block-editor";
import { PanelBody, Spinner, Button } from "@wordpress/components";
import { useSelect, useDispatch } from "@wordpress/data";
import { useState, useEffect, useRef } from "@wordpress/element";
import { __ } from "@wordpress/i18n";

import SizePreviews from "../size-previews";
import FocalPointModal from "../focal-modal";
import { FaceSuggest, FocalPicker } from "../faces";

const META_KEY = "noon_focal_point";
const DEFAULT_FOCUS = { x: 0.5, y: 0.5 };
const SAVE_DELAY = 600;
const RASTER = /\.(jpe?g|png|gif|webp|bmp)$/i;

/**
 * Where each supported block keeps its attachment id, and how to tell the
 * media is an image (Media & Text also accepts video).
 */
const BLOCKS = {
  "core/image": {
    id: (attributes) => attributes.id,
    isImage: () => true,
  },
  "core/media-text": {
    id: (attributes) => attributes.mediaId,
    isImage: (attributes) => attributes.mediaType === "image",
  },
};

const isFocus = (value) =>
  value && typeof value.x === "number" && typeof value.y === "number";

const sameFocus = (a, b) => a.x === b.x && a.y === b.y;

function AttachmentFocalPoint({ attachmentId }) {
  const media = useSelect((select) => select("core").getMedia(attachmentId), [
    attachmentId,
  ]);
  const { saveEntityRecord } = useDispatch("core");

  const saved = isFocus(media?.meta?.[META_KEY])
    ? media.meta[META_KEY]
    : DEFAULT_FOCUS;

  const [focalPoint, setFocalPoint] = useState(saved);
  const [status, setStatus] = useState("");
  const [isModalOpen, setModalOpen] = useState(false);
  const [faces, setFaces] = useState([]);
  const timer = useRef();

  // Follow the stored point when the attachment changes or is edited elsewhere.
  useEffect(() => {
    setFocalPoint(saved);
  }, [attachmentId, saved.x, saved.y]);

  useEffect(() => {
    setFaces([]);
  }, [attachmentId]);

  // Persist a short while after the last drag.
  useEffect(() => {
    if (sameFocus(focalPoint, saved)) {
      return;
    }

    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setStatus("saving");
      try {
        await saveEntityRecord(
          "postType",
          "attachment",
          {
            id: attachmentId,
            meta: { [META_KEY]: focalPoint },
          },
          { throwOnError: true },
        );
        setStatus("saved");
      } catch (e) {
        setStatus("error");
      }
    }, SAVE_DELAY);

    return () => clearTimeout(timer.current);
  }, [focalPoint.x, focalPoint.y]);

  if (!media) {
    return <Spinner />;
  }

  if (!RASTER.test(media.source_url || "")) {
    return (
      <p>
        {__(
          "Focal cropping only applies to JPEG, PNG, GIF and WebP images.",
          "focal-point-images-smart-crop",
        )}
      </p>
    );
  }

  const messages = {
    saving: __("Saving…", "focal-point-images-smart-crop"),
    saved: __("Saved to the image.", "focal-point-images-smart-crop"),
    error: __(
      "Could not save the focal point.",
      "focal-point-images-smart-crop",
    ),
  };

  return (
    <>
      <FocalPicker
        label=""
        url={media.source_url}
        dimensions={{
          width: media.media_details?.width,
          height: media.media_details?.height,
        }}
        value={focalPoint}
        onChange={setFocalPoint}
        faces={faces}
        onFacesChange={setFaces}
      />
      <FaceSuggest
        src={media.source_url}
        width={media.media_details?.width}
        height={media.media_details?.height}
        onFaces={setFaces}
        faces={faces}
        onSuggest={setFocalPoint}
      />
      <p className="description" style={{ minHeight: "1.5em" }}>
        {status
          ? messages[status]
          : __(
              "Cropped sizes of this image keep this point in view, everywhere it is used.",
              "focal-point-images-smart-crop",
            )}
      </p>
      <SizePreviews
        src={media.source_url}
        width={media.media_details?.width}
        height={media.media_details?.height}
        focus={focalPoint}
        faces={faces}
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
          src={media.source_url}
          width={media.media_details?.width}
          height={media.media_details?.height}
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
    </>
  );
}

const withFocalPointPanel = createHigherOrderComponent((BlockEdit) => {
  return (props) => {
    const config = BLOCKS[props.name];
    const attachmentId = config ? config.id(props.attributes) : 0;

    if (!config || !attachmentId || !config.isImage(props.attributes)) {
      return <BlockEdit {...props} />;
    }

    return (
      <>
        <BlockEdit {...props} />
        <InspectorControls>
          <PanelBody
            title={__("Focal point", "focal-point-images-smart-crop")}
            initialOpen={false}
          >
            <AttachmentFocalPoint attachmentId={attachmentId} />
          </PanelBody>
        </InspectorControls>
      </>
    );
  };
}, "withFocalPointPanel");

addFilter(
  "editor.BlockEdit",
  "focal-point-images-smart-crop/block-focal-point",
  withFocalPointPanel,
);
