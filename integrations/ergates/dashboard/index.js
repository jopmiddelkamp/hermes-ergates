// Ergates has no dashboard page: this folder exists for the API router in
// api.py. Registering an empty component keeps the Hermes dashboard from
// reporting the plugin's bundle as missing.
window.__HERMES_PLUGINS__.register("ergates", function ErgatesHasNoPage() {
  return null;
});
