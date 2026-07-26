(function () {
  "use strict";

  var icons = {
    "dot-red": '<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="#ff5454"/></svg>',
    "dot-yellow": '<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="#ffd15a"/></svg>',
    "dot-green": '<svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="#57c84e"/></svg>',
    "menu": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    "caret-down": '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.2 4.2 6 8l3.8-3.8z" fill="currentColor"/></svg>',
    "caret-right": '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4.2 2.2 8 6l-3.8 3.8z" fill="currentColor"/></svg>',
    "photo": '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="2" width="10" height="12" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="6.1" r="1.6" fill="currentColor"/><path d="M5.2 11.5c.4-1.5 1.5-2.3 2.8-2.3s2.4.8 2.8 2.3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
    "passport": '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.2" y="2.2" width="9.6" height="11.6" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="7.2" r="2.4" fill="none" stroke="currentColor" stroke-width="1"/><path d="M5.8 7.2h4.4M8 4.8c.8.8.8 4 0 4.8M8 4.8c-.8.8-.8 4 0 4.8M5.5 11.3h5" stroke="currentColor" stroke-width="1" stroke-linecap="round"/></svg>',
    "id-card": '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3.5" width="12" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="5.7" cy="7.2" r="1.3" fill="currentColor"/><path d="M4.1 10.4c.3-1 1-1.5 1.6-1.5.7 0 1.4.5 1.7 1.5M9 6.5h3M9 9.4h2.4" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>',
    "flag-brazil": '<svg viewBox="0 0 18 14" aria-hidden="true"><rect width="18" height="14" rx="2" fill="#25874b"/><path d="M9 2.1 15 7l-6 4.9L3 7z" fill="#f1cc4b"/><circle cx="9" cy="7" r="2.3" fill="#284d9b"/></svg>',
    "flag-argentina": '<svg viewBox="0 0 18 14" aria-hidden="true"><rect width="18" height="14" rx="2" fill="#79bdf1"/><path d="M0 4.7h18v4.6H0z" fill="#f7f8fa"/><circle cx="9" cy="7" r="1.2" fill="#e5b43f"/></svg>',
    "flag-usa": '<svg viewBox="0 0 18 14" aria-hidden="true"><rect width="18" height="14" rx="2" fill="#f5f6f8"/><path d="M0 1.8h18M0 4.2h18M0 6.6h18M0 9h18M0 11.4h18" stroke="#c94343" stroke-width="1.2"/><rect width="7.4" height="6.6" rx="1.1" fill="#2f5792"/></svg>',
    "flag-usa-alt": '<svg viewBox="0 0 18 14" aria-hidden="true"><rect width="18" height="14" rx="2" fill="#f5f6f8"/><path d="M0 2h18M0 4.6h18M0 7.2h18M0 9.8h18M0 12.4h18" stroke="#d64c4c" stroke-width="1.1"/><rect width="7" height="7.1" rx="1.1" fill="#304f86"/><circle cx="2.2" cy="2.2" r=".35" fill="#fff"/><circle cx="4" cy="3.7" r=".35" fill="#fff"/><circle cx="5.7" cy="2.2" r=".35" fill="#fff"/></svg>',
    "graduation": '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.8 6 8 3.2 14.2 6 8 8.8z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M4.5 7.6v2.5c1.6 1.5 5.4 1.5 7 0V7.6" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M13 6.6v3.7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
    "wedding": '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="5.7" cy="6" r="2" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="10.3" cy="6" r="2" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M2.8 12c.5-1.8 1.8-2.8 3-2.8 1 0 1.7.5 2.2 1.2.5-.7 1.2-1.2 2.2-1.2 1.2 0 2.5 1 3 2.8" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
    "image": '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.2" y="3" width="11.6" height="10" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="5.5" cy="6" r="1.1" fill="currentColor"/><path d="M3.8 11.2 7 8.4l2.2 1.8 1.2-1.1 2 2.1" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    "folder": '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.2 5.1c0-.8.6-1.4 1.4-1.4h3l1.1 1.3h4.7c.8 0 1.4.6 1.4 1.4v5.1c0 .8-.6 1.4-1.4 1.4H3.6c-.8 0-1.4-.6-1.4-1.4z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
    "printer": '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.2 5V2.5h7.6V5M4.2 11H2.8c-.7 0-1.3-.6-1.3-1.3V6.6c0-.8.6-1.4 1.4-1.4h10.2c.8 0 1.4.6 1.4 1.4v3.1c0 .7-.6 1.3-1.3 1.3h-1.4" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/><path d="M4.2 9h7.6v4.5H4.2z" fill="none" stroke="currentColor" stroke-width="1.25"/><circle cx="12.2" cy="7.2" r=".7" fill="currentColor"/></svg>',
    "rocket": '<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M10.1 3.1c1.4-.9 3-.8 4.8-.5.3 1.8.4 3.4-.5 4.8L10 11.8 6.2 8z" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/><path d="M6.4 8.1 3.5 8.8l2.1 1.7M9.9 11.6l-.7 2.9-1.7-2.1M4.2 13.8l2-2" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/><circle cx="11.8" cy="5.6" r="1.2" fill="currentColor"/></svg>',
    "save": '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 2.7h8.3L13 4.4v8.9H3z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M5 2.8v3.4h5.5V2.8M5.2 13v-3.1h5.6V13" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/></svg>'
  };

  function svgNode(name) {
    var parser;
    var parsed;
    var svg;

    if (!icons[name]) {
      return null;
    }

    try {
      parser = new DOMParser();
      parsed = parser.parseFromString(icons[name], "image/svg+xml");
      svg = parsed.documentElement;
      if (!svg || String(svg.nodeName).toLowerCase() !== "svg") {
        return null;
      }
      return document.importNode ? document.importNode(svg, true) : svg.cloneNode(true);
    } catch (error) {
      return null;
    }
  }

  function clearNode(node) {
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }

  function setIcon(target, name) {
    var iconNode;
    var wrapper;

    if (!target || !icons[name]) {
      return;
    }

    if (
      target.classList.contains("traffic-icon") ||
      target.classList.contains("tab-icon") ||
      target.classList.contains("section-caret") ||
      target.classList.contains("hamburger")
    ) {
      clearNode(target);
      iconNode = svgNode(name);
      if (iconNode) {
        target.appendChild(iconNode);
      } else {
        target.innerHTML = icons[name];
      }
      return;
    }

    wrapper = target.querySelector(".btn-icon");
    if (!wrapper) {
      wrapper = document.createElement("span");
      wrapper.className = "btn-icon";
      wrapper.setAttribute("aria-hidden", "true");
      target.insertBefore(wrapper, target.firstChild);
    }

    clearNode(wrapper);
    iconNode = svgNode(name);
    if (iconNode) {
      wrapper.appendChild(iconNode);
    } else {
      wrapper.innerHTML = icons[name];
    }
  }

  function installIcons(root) {
    var scope = root || document;
    var nodes = scope.querySelectorAll("[data-icon]");
    Array.prototype.forEach.call(nodes, function (node) {
      var name = node.getAttribute("data-icon");
      if (!icons[name]) {
        return;
      }
      setIcon(node, name);
    });
  }

  window.IDPhotoIcons = {
    install: installIcons,
    setIcon: setIcon
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      installIcons(document);
    });
  } else {
    installIcons(document);
  }
})();
