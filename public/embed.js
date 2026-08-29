/**
 * Provenance portfolio embed.
 *
 * Usage on any website, any framework:
 *
 *   <div id="provenance"></div>
 *   <script src="https://YOUR-APP/embed.js" data-slug="your-slug"></script>
 *
 * Design principles, because this runs on someone else's page:
 *
 *  - Ships NO styling by default. It emits semantic markup with stable
 *    `pv-` class names and gets out of the way, so the host site's own CSS
 *    governs appearance. Pass data-styles="basic" for a minimal starter sheet.
 *  - Builds every node with createElement/textContent. Nothing from the API is
 *    ever interpolated as HTML, so a hostile field cannot inject script into
 *    the host page.
 *  - No dependencies, no globals beyond one namespaced object, no cookies, no
 *    tracking. Safe to drop into a page with a strict CSP.
 *  - Fails quietly: a network error leaves whatever was already in the
 *    container, so a broken fetch never blanks a section of someone's site.
 */
(function () {
  "use strict";

  var SCRIPT = document.currentScript;
  if (!SCRIPT) return;

  var config = {
    slug: SCRIPT.getAttribute("data-slug") || "",
    target: SCRIPT.getAttribute("data-target") || "#provenance",
    // Comma-separated section ids to include, in the order given.
    sections: SCRIPT.getAttribute("data-sections") || "",
    limit: parseInt(SCRIPT.getAttribute("data-limit") || "0", 10) || 0,
    styles: SCRIPT.getAttribute("data-styles") || "none",
    heading: SCRIPT.getAttribute("data-headings") !== "false",
    origin: new URL(SCRIPT.src, location.href).origin,
  };

  if (!config.slug) {
    console.warn("[provenance] missing data-slug on the embed script tag");
    return;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    // textContent, never innerHTML — this is the injection boundary.
    if (text != null && text !== "") node.textContent = text;
    return node;
  }

  function link(href, text, className) {
    var a = el("a", className, text);
    a.href = href;
    a.target = "_blank";
    // noopener/noreferrer: these URLs come from the API, not the host site.
    a.rel = "noopener noreferrer";
    return a;
  }

  function renderItem(item) {
    var article = el("article", "pv-item");
    article.setAttribute("data-kind", item.kind);

    // Separators are real text nodes, not a CSS ::before rule: this markup is
    // rendered on sites that apply none of our styles, and without them the
    // meta line reads as "Rolelinkedin2026".
    var meta = el("p", "pv-item-meta");
    var parts = [
      { cls: "pv-kind", text: item.kindLabel },
      { cls: "pv-source", text: item.source },
      { cls: "pv-year", text: item.year ? String(item.year) : "" },
    ].filter(function (p) {
      return p.text;
    });
    parts.forEach(function (part, i) {
      if (i > 0) meta.appendChild(document.createTextNode(" · "));
      meta.appendChild(el("span", part.cls, part.text));
    });
    if (parts.length) article.appendChild(meta);

    article.appendChild(el("h3", "pv-item-title", item.title));
    if (item.role) article.appendChild(el("p", "pv-item-role", item.role));
    if (item.summary) article.appendChild(el("p", "pv-item-summary", item.summary));
    if (item.description && item.description !== item.summary) {
      article.appendChild(el("p", "pv-item-description", item.description));
    }
    if (item.impact) article.appendChild(el("p", "pv-item-impact", item.impact));

    if (item.skills && item.skills.length) {
      var skills = el("ul", "pv-skills");
      item.skills.forEach(function (skill) {
        skills.appendChild(el("li", "pv-skill", skill));
      });
      article.appendChild(skills);
    }

    // The evidence URL is usually also present in `links` as "Source", so
    // de-duplicate by URL — otherwise every item renders "SourceSource".
    var links = [];
    var seen = {};
    function addLink(url, label) {
      if (!url || seen[url]) return;
      seen[url] = true;
      links.push({ url: url, label: label || "Link" });
    }
    addLink(item.url, "Source");
    (item.links || []).forEach(function (l) {
      addLink(l.url, l.label);
    });
    if (links.length) {
      var nav = el("p", "pv-item-links");
      links.forEach(function (l, i) {
        // Same reasoning as the meta line: readable with no stylesheet at all.
        if (i > 0) nav.appendChild(document.createTextNode(" · "));
        nav.appendChild(link(l.url, l.label, "pv-link"));
      });
      article.appendChild(nav);
    }

    return article;
  }

  function renderSections(payload) {
    var wanted = config.sections
      ? config.sections
          .split(",")
          .map(function (s) {
            return s.trim();
          })
          .filter(Boolean)
      : null;

    var sections = payload.sections;
    if (wanted) {
      // Honour the caller's order, not ours.
      sections = wanted
        .map(function (id) {
          return payload.sections.find(function (s) {
            return s.id === id;
          });
        })
        .filter(Boolean);
    }

    var root = el("div", "pv-portfolio");
    root.setAttribute("data-schema-version", payload.schemaVersion);

    sections.forEach(function (section) {
      var items = config.limit ? section.items.slice(0, config.limit) : section.items;
      if (!items.length) return;

      var node = el("section", "pv-section");
      node.setAttribute("data-section", section.id);
      if (config.heading) node.appendChild(el("h2", "pv-section-title", section.title));
      var list = el("div", "pv-items");
      items.forEach(function (item) {
        list.appendChild(renderItem(item));
      });
      node.appendChild(list);
      root.appendChild(node);
    });

    return root;
  }

  var BASIC_CSS =
    ".pv-portfolio{max-width:48rem;margin:0 auto}" +
    ".pv-section{margin:2.5rem 0}" +
    ".pv-section-title{font-size:.75rem;letter-spacing:.16em;text-transform:uppercase;opacity:.6;margin:0 0 1rem}" +
    ".pv-item{padding:1.25rem 0;border-top:1px solid rgba(128,128,128,.25)}" +
    ".pv-item-meta{font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;opacity:.55;margin:0 0 .4rem}" +
    ".pv-item-title{margin:0 0 .35rem;font-size:1.25rem}" +
    ".pv-item-summary{margin:.35rem 0;line-height:1.6}" +
    ".pv-item-description,.pv-item-impact,.pv-item-role{margin:.35rem 0;opacity:.75;font-size:.9rem;line-height:1.55}" +
    ".pv-skills{list-style:none;display:flex;flex-wrap:wrap;gap:.4rem;padding:0;margin:.6rem 0 0}" +
    ".pv-skill{font-size:.7rem;border:1px solid rgba(128,128,128,.35);border-radius:999px;padding:.15rem .6rem}" +
    ".pv-item-links{margin:.6rem 0 0;font-size:.8rem}" +
    ".pv-item-links a{margin-right:.25rem}";

  function injectBasicStyles() {
    if (config.styles !== "basic") return;
    if (document.getElementById("pv-basic-styles")) return;
    var style = el("style");
    style.id = "pv-basic-styles";
    style.textContent = BASIC_CSS;
    document.head.appendChild(style);
  }

  function mount() {
    var container = document.querySelector(config.target);
    if (!container) {
      console.warn('[provenance] no element matched "' + config.target + '"');
      return;
    }

    fetch(config.origin + "/api/portfolio/" + encodeURIComponent(config.slug), {
      headers: { accept: "application/json" },
    })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (payload) {
        injectBasicStyles();
        container.textContent = "";
        container.appendChild(renderSections(payload));
        container.setAttribute("data-pv-state", "loaded");
        // Let the host page react (analytics, layout shift, masonry re-layout).
        container.dispatchEvent(
          new CustomEvent("provenance:loaded", { bubbles: true, detail: { payload: payload } })
        );
      })
      .catch(function (error) {
        // Leave existing content untouched — a failed fetch must not blank a
        // section of someone else's website.
        container.setAttribute("data-pv-state", "error");
        console.warn("[provenance] could not load portfolio:", error.message);
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
