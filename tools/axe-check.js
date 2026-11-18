// Runs axe-core (WCAG 2.2 A and AA rules) in the page and returns the
// violations. Used with: node tools/cdp.mjs eval <url> tools/axe-check.js
(async () => {
  if (!window.axe) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/node_modules/axe-core/axe.min.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  const result = await window.axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    exclude: [['.prose']],
  });
  return {
    url: location.href,
    violations: result.violations.map((v) => ({
      id: v.id, impact: v.impact, help: v.help,
      nodes: v.nodes.slice(0, 4).map((n) => ({ target: n.target.join(' '), summary: n.failureSummary.split('\n').slice(0, 2).join(' ') })),
    })),
    passes: result.passes.length,
  };
})()
