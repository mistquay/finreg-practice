// Runs before first paint so a saved light/dark choice never flashes the other theme.
(function () {
  try {
    var saved = localStorage.getItem("finreg-theme");
    if (saved === "light" || saved === "dark")
      document.documentElement.setAttribute("data-theme", saved);
  } catch (e) {}
})();
