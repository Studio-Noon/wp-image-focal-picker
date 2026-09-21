/**
 * Live thumbnails of every cropped size, positioned as Glide will crop them
 * for the given focal point. Pure CSS (object-fit/object-position on the
 * original): nothing is rendered by Glide, cached or saved while previewing.
 *
 * layout "compact": fixed-width thumbnails for a sidebar.
 * layout "grid":    justified rows filling the container (width ∝ aspect ratio).
 */
import { __ } from "@wordpress/i18n";

import { cropPosition, previewSizes } from "../crop-position";
import "./previews.scss";

export default function SizePreviews({
  src,
  width,
  height,
  focus,
  layout = "compact",
  showIntro = true,
}) {
  const sizes = previewSizes();

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
      <div className="noon-focal-size-previews__grid">
        {sizes.map((size) => {
          const pos = cropPosition(
            width,
            height,
            size.w,
            size.h,
            focus.x,
            focus.y,
          );
          return (
            <figure
              key={`${size.label}-${size.w}x${size.h}`}
              className="noon-focal-size-previews__item"
              style={{ "--r": (size.w / size.h).toFixed(3) }}
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
              </span>
              <figcaption>
                <strong>{size.label}</strong> {size.w}×{size.h}
              </figcaption>
            </figure>
          );
        })}
      </div>
    </div>
  );
}
