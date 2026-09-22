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
          <label>
            <span>{__("Find a size", "focal-point-images-smart-crop")}</span>
            <input
              type="search"
              value={query}
              placeholder={__("Name or dimensions…", "focal-point-images-smart-crop")}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label>
            <span>{__("Shape", "focal-point-images-smart-crop")}</span>
            <select value={shape} onChange={(event) => setShape(event.target.value)}>
              {shapeOptions().map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <div className="noon-focal-size-previews__filter-status">
            <span role="status">{resultsMessage(visibleSizes.length, sizes.length)}</span>
            {(query || shape !== "all") && (
              <button type="button" className="button-link" onClick={() => { setQuery(""); setShape("all"); }}>
                {__("Clear filters", "focal-point-images-smart-crop")}
              </button>
            )}
          </div>
        </div>
      )}
      {!visibleSizes.length && (
        <p className="description">{__("No sizes match. Try another search or clear the filters.", "focal-point-images-smart-crop")}</p>
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
                style={{ aspectRatio: `${size.w} / ${size.h}`, maxWidth: layout === "grid" ? `${220 * size.w / size.h}px` : undefined }}
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
                <button
                  type="button"
                  className="button-link noon-focal-size-previews__expand"
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
                </button>
              </figcaption>
            </figure>
          );
        })}
      </div>
    </div>
  );
}
