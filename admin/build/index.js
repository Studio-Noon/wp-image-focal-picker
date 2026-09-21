(() => {
  "use strict";
  const e = window.wp.element,
    t = window.wp.components,
    a = window.wp.i18n,
    n = window.wp.data,
    o = window.wp.hooks;
  function i(t) {
    let {
      src: n,
      width: o,
      height: i,
      focus: r,
      layout: l = "compact",
      showIntro: c = !0,
    } = t;
    const s = (function () {
      const e = window.noonFocalPreview?.sizes;
      return Array.isArray(e) ? e.filter((e) => e && e.w > 0 && e.h > 0) : [];
    })();
    return n && s.length
      ? (0, e.createElement)(
          "div",
          {
            className: `noon-focal-size-previews noon-focal-size-previews--${l}`,
          },
          c &&
            (0, e.createElement)(
              "p",
              { className: "description" },
              (0, a.__)(
                "How each cropped size will look with this focal point:",
                "focal-point-images-smart-crop",
              ),
            ),
          (0, e.createElement)(
            "div",
            { className: "noon-focal-size-previews__grid" },
            s.map((t) => {
              const a = (function (e, t, a, n, o, i) {
                if (!(e && t && a && n)) return { x: 100 * o, y: 100 * i };
                const r = Math.max(a / e, n / t),
                  l = t * r,
                  c = (e, t, a) => {
                    const n = e - t;
                    if (n <= 0.5) return 50;
                    const o = (e * a - t / 2) / n;
                    return 100 * Math.min(1, Math.max(0, o));
                  };
                return { x: c(e * r, a, o), y: c(l, n, i) };
              })(o, i, t.w, t.h, r.x, r.y);
              return (0, e.createElement)(
                "figure",
                {
                  key: `${t.label}-${t.w}x${t.h}`,
                  className: "noon-focal-size-previews__item",
                  style: { "--r": (t.w / t.h).toFixed(3) },
                },
                (0, e.createElement)(
                  "span",
                  {
                    className: "noon-focal-size-previews__box",
                    style: { aspectRatio: `${t.w} / ${t.h}` },
                  },
                  (0, e.createElement)("img", {
                    src: n,
                    alt: "",
                    draggable: "false",
                    style: { objectPosition: `${a.x}% ${a.y}%` },
                  }),
                ),
                (0, e.createElement)(
                  "figcaption",
                  null,
                  (0, e.createElement)("strong", null, t.label),
                  " ",
                  t.w,
                  "×",
                  t.h,
                ),
              );
            }),
          ),
        )
      : null;
  }
  function r(n) {
    let { src: o, width: r, height: l, value: c, onApply: s, onClose: m } = n;
    const [d, u] = (0, e.useState)(c);
    return (0, e.createElement)(
      t.Modal,
      {
        title: (0, a.__)("Focal point", "focal-point-images-smart-crop"),
        onRequestClose: m,
        isFullScreen: !0,
        className: "noon-focal-modal",
      },
      (0, e.createElement)(
        "div",
        { className: "noon-focal-editor" },
        (0, e.createElement)(
          "div",
          { className: "noon-focal-editor__stage" },
          (0, e.createElement)(t.FocalPointPicker, {
            label: "",
            url: o,
            dimensions: { width: r, height: l },
            value: d,
            onChange: u,
            onDrag: u,
          }),
          (0, e.createElement)(
            "p",
            { className: "description" },
            (0, a.__)(
              "Drag the point to the most important part of the image. The crops on the right follow it live; nothing is generated or saved until you apply.",
              "focal-point-images-smart-crop",
            ),
          ),
        ),
        (0, e.createElement)(
          "div",
          { className: "noon-focal-editor__previews" },
          (0, e.createElement)(i, {
            src: o,
            width: r,
            height: l,
            focus: d,
            layout: "grid",
            showIntro: !1,
          }),
        ),
      ),
      (0, e.createElement)(
        t.Flex,
        { justify: "flex-end", className: "noon-focal-modal__actions" },
        (0, e.createElement)(
          t.FlexItem,
          null,
          (0, e.createElement)(
            t.Button,
            { variant: "tertiary", onClick: m },
            (0, a.__)("Cancel", "focal-point-images-smart-crop"),
          ),
        ),
        (0, e.createElement)(
          t.FlexItem,
          null,
          (0, e.createElement)(
            t.Button,
            { variant: "primary", onClick: () => s(d) },
            (0, a.__)("Apply", "focal-point-images-smart-crop"),
          ),
        ),
      ),
    );
  }
  const l = { x: 0.5, y: 0.5 },
    c = "noon_focal_point";
  (0, o.addFilter)(
    "editor.PostFeaturedImage",
    "focal-point-images-smart-crop/featured-image-display",
    function (o) {
      return (s) => {
        const { featuredImageId: m } = s,
          d = (0, n.useSelect)((e) => (m ? e("core").getMedia(m) : null), [m]),
          u =
            ((g = d?.meta?.[c]),
            g && "number" == typeof g.x && "number" == typeof g.y
              ? d.meta[c]
              : l);
        var g;
        const [h, f] = (0, e.useState)(u),
          [p, w] = (0, e.useState)(!1),
          _ = (0, e.useRef)({ focalPoint: u, saved: u, id: m });
        return (
          (0, e.useEffect)(() => {
            f(u), (_.current.saved = u), (_.current.id = m);
          }, [m, u.x, u.y]),
          (0, e.useEffect)(() => {
            _.current.focalPoint = h;
          }, [h]),
          (0, e.useEffect)(() => {
            let e = !1;
            return (0, n.subscribe)(() => {
              const t = (0, n.select)("core/editor");
              if (t.isSavingPost() && !t.isAutosavingPost())
                return void (e = !0);
              if (!e) return;
              if (((e = !1), !t.didPostSaveRequestSucceed())) return;
              const { focalPoint: a, saved: o, id: i } = _.current;
              !i ||
                (a.x === o.x && a.y === o.y) ||
                ((_.current.saved = a),
                (0, n.dispatch)("core").saveEntityRecord(
                  "postType",
                  "attachment",
                  { id: i, meta: { [c]: a } },
                ));
            });
          }, []),
          d
            ? (0, e.createElement)(
                "div",
                { className: "remove_standard_image" },
                (0, e.createElement)(t.FocalPointPicker, {
                  label: "",
                  url: d.source_url,
                  dimensions: { width: d.width, height: d.height },
                  value: h,
                  onChange: f,
                }),
                (0, e.createElement)(i, {
                  src: d.source_url,
                  width: d.media_details?.width,
                  height: d.media_details?.height,
                  focus: h,
                }),
                (0, e.createElement)(
                  t.Button,
                  {
                    variant: "secondary",
                    size: "small",
                    onClick: () => w(!0),
                    style: { marginTop: 8 },
                  },
                  (0, a.__)(
                    "Edit full screen",
                    "focal-point-images-smart-crop",
                  ),
                ),
                p &&
                  (0, e.createElement)(r, {
                    src: d.source_url,
                    width: d.media_details?.width,
                    height: d.media_details?.height,
                    value: h,
                    onApply: (e) => {
                      f(e), w(!1);
                    },
                    onClose: () => w(!1),
                  }),
                (0, e.createElement)(o, s),
              )
            : (0, e.createElement)(o, s)
        );
      };
    },
  );
  const s = window.wp.compose,
    m = window.wp.blockEditor,
    d = "noon_focal_point",
    u = { x: 0.5, y: 0.5 },
    g = /\.(jpe?g|png|gif|webp|bmp)$/i,
    h = {
      "core/image": { id: (e) => e.id, isImage: () => !0 },
      "core/media-text": {
        id: (e) => e.mediaId,
        isImage: (e) => "image" === e.mediaType,
      },
    };
  function f(o) {
    let { attachmentId: l } = o;
    const c = (0, n.useSelect)((e) => e("core").getMedia(l), [l]),
      { saveEntityRecord: s } = (0, n.useDispatch)("core"),
      m =
        ((h = c?.meta?.[d]),
        h && "number" == typeof h.x && "number" == typeof h.y ? c.meta[d] : u);
    var h;
    const [f, p] = (0, e.useState)(m),
      [w, _] = (0, e.useState)(""),
      [E, y] = (0, e.useState)(!1),
      v = (0, e.useRef)();
    if (
      ((0, e.useEffect)(() => {
        p(m);
      }, [l, m.x, m.y]),
      (0, e.useEffect)(() => {
        var e, t;
        if (((t = m), (e = f).x !== t.x || e.y !== t.y))
          return (
            clearTimeout(v.current),
            (v.current = setTimeout(async () => {
              _("saving");
              try {
                await s(
                  "postType",
                  "attachment",
                  { id: l, meta: { [d]: f } },
                  { throwOnError: !0 },
                ),
                  _("saved");
              } catch (e) {
                _("error");
              }
            }, 600)),
            () => clearTimeout(v.current)
          );
      }, [f.x, f.y]),
      !c)
    )
      return (0, e.createElement)(t.Spinner, null);
    if (!g.test(c.source_url || ""))
      return (0, e.createElement)(
        "p",
        null,
        (0, a.__)(
          "Focal cropping only applies to JPEG, PNG, GIF and WebP images.",
          "focal-point-images-smart-crop",
        ),
      );
    const x = {
      saving: (0, a.__)("Saving…", "focal-point-images-smart-crop"),
      saved: (0, a.__)("Saved to the image.", "focal-point-images-smart-crop"),
      error: (0, a.__)(
        "Could not save the focal point.",
        "focal-point-images-smart-crop",
      ),
    };
    return (0, e.createElement)(
      e.Fragment,
      null,
      (0, e.createElement)(t.FocalPointPicker, {
        label: "",
        url: c.source_url,
        dimensions: {
          width: c.media_details?.width,
          height: c.media_details?.height,
        },
        value: f,
        onChange: p,
      }),
      (0, e.createElement)(
        "p",
        { className: "description", style: { minHeight: "1.5em" } },
        w
          ? x[w]
          : (0, a.__)(
              "Cropped sizes of this image keep this point in view, everywhere it is used.",
              "focal-point-images-smart-crop",
            ),
      ),
      (0, e.createElement)(i, {
        src: c.source_url,
        width: c.media_details?.width,
        height: c.media_details?.height,
        focus: f,
      }),
      (0, e.createElement)(
        t.Button,
        {
          variant: "secondary",
          size: "small",
          onClick: () => y(!0),
          style: { marginTop: 8 },
        },
        (0, a.__)("Edit full screen", "focal-point-images-smart-crop"),
      ),
      E &&
        (0, e.createElement)(r, {
          src: c.source_url,
          width: c.media_details?.width,
          height: c.media_details?.height,
          value: f,
          onApply: (e) => {
            p(e), y(!1);
          },
          onClose: () => y(!1),
        }),
    );
  }
  const p = (0, s.createHigherOrderComponent)(
    (n) => (o) => {
      const i = h[o.name],
        r = i ? i.id(o.attributes) : 0;
      return i && r && i.isImage(o.attributes)
        ? (0, e.createElement)(
            e.Fragment,
            null,
            (0, e.createElement)(n, o),
            (0, e.createElement)(
              m.InspectorControls,
              null,
              (0, e.createElement)(
                t.PanelBody,
                {
                  title: (0, a.__)(
                    "Focal point",
                    "focal-point-images-smart-crop",
                  ),
                  initialOpen: !1,
                },
                (0, e.createElement)(f, { attachmentId: r }),
              ),
            ),
          )
        : (0, e.createElement)(n, o);
    },
    "withFocalPointPanel",
  );
  (0, o.addFilter)(
    "editor.BlockEdit",
    "focal-point-images-smart-crop/block-focal-point",
    p,
  );
})();
