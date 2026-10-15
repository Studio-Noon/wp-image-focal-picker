/**
 * Live thumbnails of every cropped size, positioned as Glide will crop them
 * for the given focal point. Pure CSS (object-fit/object-position on the
 * original): nothing is rendered by Glide, cached or saved while previewing.
 *
 * layout "compact": fixed-width thumbnails for a sidebar.
 * layout "grid":    bounded preview cards with searchable sizes.
 */
import { __, sprintf } from "@wordpress/i18n";
import { useEffect, useRef, useState } from "@wordpress/element";
import {
  Button,
  SearchControl,
  SelectControl,
  __experimentalHStack as HStack,
  __experimentalText as Text,
} from "@wordpress/components";

import { cropPosition, previewSizes } from "../crop-position";
import { faceCoverage, faceBadge } from "../faces";
import { matchesSize, shapeOptions, resultsMessage } from "./filters";
import { openExpandedPreview } from "./expanded";
import "./previews.scss";

export default function SizePreviews({
  src,
  width,
  height,
  focus,
  faces = [],
  layout = "compact",
  showIntro = true,
}) {
  const sizes = previewSizes();
  const [query, setQuery] = useState("");
  const [shape, setShape] = useState("all");
  const dismissPreview = useRef(null);
  useEffect(() => () => dismissPreview.current?.(), [src]);
  const filterable = layout === "grid";
  const visibleSizes = filterable
    ? sizes.filter((size) => matchesSize(size, query, shape))
    : sizes;

  if (!src || !sizes.length) {
    return null;
  }

  return (
    <div
      className={`noon-focal-size-previews noon-focal-size-previews--${layout}`}
    >
      {showIntro && (
        <p className="description">
          {__(
            "How each cropped size will look with this focal point:",
            "focal-point-images-smart-crop",
          )}
        </p>
      )}
      {filterable && (
        <div className="noon-focal-size-previews__filters">
          <div className="noon-focal-size-previews__filter-controls">
            <SearchControl
              __nextHasNoMarginBottom
              __next40pxDefaultSize
              label={__("Find a size", "focal-point-images-smart-crop")}
              hideLabelFromVision={false}
              placeholder={__("Search by name", "focal-point-images-smart-crop")}
              value={query}
              onChange={setQuery}
            />
            <SelectControl
              __nextHasNoMarginBottom
              __next40pxDefaultSize
              label={__("Orientation", "focal-point-images-smart-crop")}
              value={shape}
              options={shapeOptions()}
              onChange={setShape}
            />
          </div>
          <HStack className="noon-focal-size-previews__filter-status">
            <Text variant="muted" role="status">
              {resultsMessage(visibleSizes.length, sizes.length)}
            </Text>
            {(query || shape !== "all") && (
              <Button variant="link" onClick={() => { setQuery(""); setShape("all"); }}>
                {__("Clear filters", "focal-point-images-smart-crop")}
              </Button>
            )}
          </HStack>
        </div>
      )}
      {!visibleSizes.length && (
        <Text as="p" variant="muted">{__("No sizes match. Try another search or clear the filters.", "focal-point-images-smart-crop")}</Text>
      )}
      <div className="noon-focal-size-previews__grid">
        {visibleSizes.map((size) => {
          const pos = cropPosition(
            width,
            height,
            size.w,
            size.h,
            focus.x,
            focus.y,
          );
          const badge = faces.length
            ? faceBadge(faceCoverage(faces, width, height, size, focus))
            : null;
          return (
            <figure
              key={`${size.label}-${size.w}x${size.h}`}
              className="noon-focal-size-previews__item"
            >
              <span
                className="noon-focal-size-previews__box"
                style={{ aspectRatio: `${size.w} / ${size.h}` }}
              >
                <img
                  src={src}
                  alt=""
                  draggable="false"
                  style={{ objectPosition: `${pos.x}% ${pos.y}%` }}
                />
                {badge && (
                  <span
                    className={`noon-focal-face-badge noon-focal-face-badge--${badge.state}`}
                  >
                    {badge.text}
                  </span>
                )}
              </span>
              <figcaption>
                <strong>{size.label}</strong> {size.w}×{size.h}
                <Button
                  variant="link"
                  className="noon-focal-size-previews__expand"
                  aria-haspopup="dialog"
                  aria-label={sprintf(
                    /* translators: %s: image size name. */
                    __("Expand %s preview", "focal-point-images-smart-crop"),
                    size.label,
                  )}
                  onClick={(event) => {
                    dismissPreview.current?.();
                    dismissPreview.current = openExpandedPreview({
                      src,
                      size,
                      position: `${pos.x}% ${pos.y}%`,
                      trigger: event.currentTarget,
                    });
                  }}
                >
                  {__("Expand preview", "focal-point-images-smart-crop")}
                </Button>
              </figcaption>
            </figure>
          );
        })}
      </div>
    </div>
  );
}
