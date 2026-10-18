(function () {
  var root = document.documentElement;
  var query = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  function theme() {
    return root.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }

  function paint() {
    var current = theme();
    var buttons = document.querySelectorAll("[data-theme-set]");
    for (var i = 0; i < buttons.length; i++) {
      var on = buttons[i].getAttribute("data-theme-set") === current;
      buttons[i].setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  function saved() {
    try {
      var value = localStorage.getItem("theme");
      if (value === "dark" || value === "light") return value;
    } catch (error) {}
    return "";
  }

  function systemDark() {
    return !!(query && query.matches);
  }

  function use(next) {
    if (next === "dark") root.setAttribute("data-theme", "dark");
    else root.removeAttribute("data-theme");
    paint();
  }

  document.addEventListener("click", function (event) {
    var button = event.target.closest ? event.target.closest("[data-theme-set]") : null;
    if (!button) return;
    var next = button.getAttribute("data-theme-set") === "dark" ? "dark" : "light";
    try {
      localStorage.setItem("theme", next);
    } catch (error) {}
    use(next);
  });

  if (saved()) paint();
  else use(systemDark() ? "dark" : "light");

  if (query) {
    var onChange = function () {
      if (!saved()) use(systemDark() ? "dark" : "light");
    };
    if (query.addEventListener) query.addEventListener("change", onChange);
    else if (query.addListener) query.addListener(onChange);
  }
})();
