// Builds the appropriate DOM element for an icon — <img> for a URL, text span
// for an emoji. Keeps all icon-rendering logic in one place so UI components
// don't duplicate the check.

/**
 * @param {string} icon      Emoji fallback string.
 * @param {string|null} iconUrl  Optional URL to a PNG icon.
 * @param {string} className CSS class applied to the element.
 * @returns {HTMLElement}
 */
export function makeIcon(icon, iconUrl, className) {
  if (iconUrl) {
    const img = document.createElement('img');
    img.className = className;
    img.src       = iconUrl;
    img.alt       = icon;          // emoji as alt text
    img.draggable = false;
    return img;
  }
  const span = document.createElement('span');
  span.className   = className;
  span.textContent = icon;
  return span;
}
