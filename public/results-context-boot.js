/* Minimal synchronous navigation gate; no identity or permissions are inferred.
   Runs before page paint so an admin-to-results transition never flashes a
   participant/public toolbar while Firebase finishes restoring its session. */
(() => {
  const from = new URLSearchParams(location.search).get('from');
  if (['admin', 'operations', 'jury', 'dashboard'].includes(from)) {
    document.documentElement.classList.add('esoria-context-pending');
  }
})();
