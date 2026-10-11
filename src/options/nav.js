// Marks the sidebar link for the section currently in view.
(function () {
  const links = [...document.querySelectorAll(".sidebar nav a[href^='#']")];
  const sections = links.map((link) => document.getElementById(link.hash.slice(1))).filter(Boolean);
  if (!sections.length || typeof IntersectionObserver !== "function") return;

  const visible = new Set();
  const mark = () => {
    const current = sections.find((section) => visible.has(section)) || sections[0];
    for (const link of links) link.setAttribute("aria-current", String(link.hash === `#${current.id}`));
  };
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) entry.isIntersecting ? visible.add(entry.target) : visible.delete(entry.target);
    mark();
  }, { rootMargin: "-20% 0px -60% 0px" });
  sections.forEach((section) => observer.observe(section));
  mark();
})();
