// HTML escaping does not reject executable URL schemes. Keep external links
// HTTPS-only, while allowing same-origin HTTP on local development servers.
export function safeHref(value) {
  try {
    const u = new URL(String(value), location.origin);
    if (
      u.protocol === "https:" ||
      (u.protocol === "http:" && u.origin === location.origin)
    )
      return u.href;
  } catch {
    // Invalid or unsupported links remain inert.
  }
  return "#";
}
