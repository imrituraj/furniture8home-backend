(function () {
  try {
    var saved = localStorage.getItem('f8h_theme');
    if (saved === 'light' || saved === 'dark') document.documentElement.setAttribute('data-theme', saved);
  } catch (e) {
    // Storage blocked — fall back to the system theme
  }
})();
