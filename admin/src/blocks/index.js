/**
 * Focal point for the Image and Media & Text blocks, from a toolbar button.
 *
 * The image's own focal point lives on the attachment (the same meta the
 * media library, image editor and featured-image panel edit), so it applies
 * wherever the image is used. A block can also carry its own `focalPoint`
 * that applies to that block only (honoured by the Glide crops at render).
 *
 * - The image has no focal point yet (or it's still 50% / 50%): a change in
 *   the block is saved silently to the image. The block keeps no copy.
 * - The image already has one: the first change asks whether to update the
 *   image everywhere or just this block; later drags follow that choice.
 * - The block already has its own point: changes stay on the block.
 */
import { createHigherOrderComponent } from "@wordpress/compose";
import { addFilter } from "@wordpress/hooks";
import { BlockControls } from "@wordpress/block-editor";
import {
  Button,
  Dropdown,
  FocalPointPicker,
  ToolbarButton,
  ToolbarGroup,
} from "@wordpress/components";
import { useEffect, useRef, useState } from "@wordpress/element";
import { __ } from "@wordpress/i18n";

import { CENTRE, fetchMedia, onFocalSaved, readFocal, saveFocal } from "../focal/data";

const SAVE_DELAY = 400;

/**
 * Where each supported block keeps its attachment and URL, and whether the
 * media is an image (Media & Text also accepts video).
 */
const BLOCKS = {
  "core/image": {
    id: (attributes) => attributes.id,
    url: (attributes) => attributes.url,
    isImage: () => true,
  },
  "core/media-text": {
    id: (attributes) => attributes.mediaId,
    url: (attributes) => attributes.mediaUrl,
    isImage: (attributes) => attributes.mediaType === "image",
  },
};

// "Not set yet": no point, or still the untouched centre (50% / 50%).
const isUnset = (point) => !point || (point.x === 0.5 && point.y === 0.5);

const noteStyle = { margin: "12px 0 8px", color: "#757575", fontSize: "12px" };
const rowStyle = { display: "flex", flexWrap: "wrap", gap: "8px" };

/**
 * The image's focal point from the media library, kept in sync when it's
 * changed anywhere else (media library, image editor, auto-detection after
 * an upload). Returns [point, setPoint] so a change can show straight away.
 */
const useLibraryFocalPoint = (id) => {
  const [point, setPoint] = useState(null);

  useEffect(() => {
    setPoint(null);

    if (!id) {
      return;
    }

    let live = true;

    fetchMedia(id)
      .then((media) => live && setPoint(readFocal(media).point))
      .catch(() => {});

    const unsubscribe = onFocalSaved((detail) => {
      if (live) {
        setPoint(detail.point);
      }
    }, id);

    return () => {
      live = false;
      unsubscribe();
    };
  }, [id]);

  return [point, setPoint];
};

/**
 * Show the focal point on the <img> in the editor canvas (an iframe), so a
 * change is visible straight away. Only has an effect once the image is
 * cropped (object-fit: cover), same as on the site.
 */
const FocalPointPreview = ({ clientId, focalPoint }) => {
  useEffect(() => {
    const canvas = document.querySelector('iframe[name="editor-canvas"]');
    const doc = canvas?.contentDocument ?? document;
    const img = doc.querySelector(`[data-block="${clientId}"] img`);

    if (img) {
      img.style.objectPosition = focalPoint
        ? `${focalPoint.x * 100}% ${focalPoint.y * 100}%`
        : "";
    }
  }, [clientId, focalPoint]);

  return null;
};

const FocalPointIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="6.5" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    <path
      d="M12 1.5V5M12 19v3.5M1.5 12H5M19 12h3.5"
      stroke="currentColor"
      strokeWidth="1.5"
    />
  </svg>
);

function FocalPointPanel({ id, url, focalPoint, libraryPoint, setLibraryPoint, setAttributes }) {
  const hasOverride = !!focalPoint;
  const [choice, setChoice] = useState(null); // 'image' | 'block' | null
  const [pending, setPending] = useState(null); // change awaiting a choice
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const timer = useRef(null);
  const queued = useRef(null);

  const flush = () => {
    clearTimeout(timer.current);
    timer.current = null;

    if (!queued.current || !id) {
      return Promise.resolve();
    }

    const point = queued.current;
    queued.current = null;
    setSaving(true);

    return saveFocal(id, { point, source: "manual" })
      .then(() =>
        setNote(__("Saved as the image’s focal point.", "focal-point-images-smart-crop")),
      )
      .catch(() =>
        setNote(__("Could not save to the image.", "focal-point-images-smart-crop")),
      )
      .finally(() => setSaving(false));
  };

  // Save any queued change when the dropdown closes.
  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const saveToImage = (point) => {
    setLibraryPoint(point); // update the preview straight away
    queued.current = point;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY);
  };

  const onChange = (point) => {
    if (hasOverride || choice === "block") {
      setAttributes({ focalPoint: point });
      return;
    }

    if (!id || choice === "image" || isUnset(libraryPoint)) {
      if (id) {
        saveToImage(point);
      } else {
        // External image: there's no library item to save to.
        setAttributes({ focalPoint: point });
      }
      return;
    }

    // The image already has its own point: ask before changing it.
    setPending(point);
  };

  const decide = (next) => {
    setChoice(next);

    if (next === "block") {
      setAttributes({ focalPoint: pending });
      setNote(__("Custom focal point for this block only.", "focal-point-images-smart-crop"));
    } else {
      saveToImage(pending);
    }

    setPending(null);
  };

  const shown = pending || focalPoint || libraryPoint || CENTRE;

  return (
    <div style={{ padding: "16px", minWidth: "260px", maxWidth: "320px" }}>
      <FocalPointPicker url={url} value={shown} onChange={onChange} />

      {pending ? (
        <div
          role="alertdialog"
          aria-label={__("Apply focal point change", "focal-point-images-smart-crop")}
        >
          <p style={{ ...noteStyle, color: "#1e1e1e" }}>
            {__(
              "This image already has a focal point. Update it everywhere the image is used, or just on this block?",
              "focal-point-images-smart-crop",
            )}
          </p>
          <div style={rowStyle}>
            <Button variant="primary" size="small" onClick={() => decide("image")}>
              {__("Update image", "focal-point-images-smart-crop")}
            </Button>
            <Button variant="secondary" size="small" onClick={() => decide("block")}>
              {__("Just this block", "focal-point-images-smart-crop")}
            </Button>
            <Button variant="tertiary" size="small" onClick={() => setPending(null)}>
              {__("Cancel", "focal-point-images-smart-crop")}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p style={noteStyle} aria-live="polite">
            {note ||
              (hasOverride
                ? __("Custom focal point for this block only.", "focal-point-images-smart-crop")
                : isUnset(libraryPoint)
                  ? __(
                      "Drag to set the image’s focal point. It’s saved to the image and used everywhere.",
                      "focal-point-images-smart-crop",
                    )
                  : __(
                      "Using the image’s focal point from the Media Library.",
                      "focal-point-images-smart-crop",
                    ))}
          </p>
          {hasOverride && (
            <div style={rowStyle}>
              <Button
                variant="secondary"
                size="small"
                onClick={() => {
                  setChoice(null);
                  setNote("");
                  setAttributes({ focalPoint: undefined });
                }}
              >
                {__("Use image’s focal point", "focal-point-images-smart-crop")}
              </Button>
              {!!id && (
                <Button
                  variant="tertiary"
                  size="small"
                  isBusy={saving}
                  disabled={saving}
                  onClick={() => {
                    const point = focalPoint;
                    // Now the image's own point: follow it rather than keep a
                    // duplicate override.
                    setAttributes({ focalPoint: undefined });
                    setChoice("image");
                    saveToImage(point);
                    flush();
                  }}
                >
                  {__("Save to image", "focal-point-images-smart-crop")}
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function BlockFocalPoint({ name, attributes, setAttributes, clientId }) {
  const block = BLOCKS[name];
  const id = block.id(attributes);
  const url = block.url(attributes);
  const { focalPoint } = attributes;
  const [libraryPoint, setLibraryPoint] = useLibraryFocalPoint(id);

  if (!url || !block.isImage(attributes)) {
    return null;
  }

  return (
    <>
      {name === "core/image" && (
        <FocalPointPreview clientId={clientId} focalPoint={focalPoint || libraryPoint} />
      )}
      <BlockControls group="block">
        <ToolbarGroup>
          <Dropdown
            renderToggle={({ isOpen, onToggle }) => (
              <ToolbarButton
                icon={<FocalPointIcon />}
                label={__("Focal point", "focal-point-images-smart-crop")}
                onClick={onToggle}
                aria-expanded={isOpen}
              />
            )}
            renderContent={() => (
              <FocalPointPanel
                id={id}
                url={url}
                focalPoint={focalPoint}
                libraryPoint={libraryPoint}
                setLibraryPoint={setLibraryPoint}
                setAttributes={setAttributes}
              />
            )}
          />
        </ToolbarGroup>
      </BlockControls>
    </>
  );
}

// Older WordPress versions don't declare `focalPoint` on these blocks; make
// sure it's an attribute so a block-only point is saved.
addFilter(
  "blocks.registerBlockType",
  "noon-focal/block-focal-point-attribute",
  (settings, name) =>
    BLOCKS[name] && !settings.attributes?.focalPoint
      ? {
          ...settings,
          attributes: { ...settings.attributes, focalPoint: { type: "object" } },
        }
      : settings,
);

addFilter(
  "editor.BlockEdit",
  "noon-focal/block-focal-point",
  createHigherOrderComponent(
    (BlockEdit) => (props) => (
      <>
        {BLOCKS[props.name] && <BlockFocalPoint {...props} />}
        <BlockEdit {...props} />
      </>
    ),
    "withNoonFocalPoint",
  ),
);
