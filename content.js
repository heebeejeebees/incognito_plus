const overlay = document.createElement("div");
overlay.style.cssText =
  "position:fixed;top:0;left:0;width:100vw;height:100vh;background:black;z-index:999999;display:none;";
document.body.appendChild(overlay);

window.onblur = () => {
  overlay.style.display = "block";
};

window.onfocus = () => {
  overlay.style.display = "none";
};
