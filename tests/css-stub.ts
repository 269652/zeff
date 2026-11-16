// Component files import their stylesheets (katex.min.css); Node can't load CSS — a test that draws such a component loads this first.
const ext = (require as unknown as { extensions: Record<string, (m: { exports: unknown }) => void> }).extensions;
ext[".css"] ??= (m) => void (m.exports = {});
