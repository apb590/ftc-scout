/**
 * sw-client.js - Service Worker Client Module
 * Manages Service Worker registration, checking for updates, and displaying the reload banner.
 */

(function() {
  /**
   * Displays the fixed bottom reload banner when an update is available.
   * @param {Function} onAccept Callback when scouter confirms reload
   */
  function showUpdateBanner(onAccept) {
    const existing = document.getElementById("sw-update-banner");
    if (existing) existing.remove();

    const banner = document.createElement("div");
    banner.id = "sw-update-banner";
    banner.style.cssText = "position:fixed;bottom:0;left:0;right:0;z-index:10000;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;gap:12px;background:linear-gradient(135deg,hsl(260,60%,25%),hsl(230,50%,20%));color:#fff;font-family:'Inter',sans-serif;font-size:0.9rem;box-shadow:0 -4px 20px rgba(0,0,0,0.4);border-top:2px solid hsl(260,70%,60%);animation:slideUp 0.3s ease-out;";
    banner.innerHTML = `
      <span>🔄 <strong>App Update Ready!</strong> Tap to load the latest version.</span>
      <div style="display:flex;gap:8px;flex-shrink:0;">
        <button id="sw-update-dismiss" style="background:transparent;border:1px solid rgba(255,255,255,0.3);color:#fff;padding:6px 14px;border-radius:8px;cursor:pointer;font-size:0.8rem;">Later</button>
        <button id="sw-update-accept" style="background:hsl(260,70%,55%);border:none;color:#fff;padding:6px 14px;border-radius:8px;cursor:pointer;font-weight:600;font-size:0.8rem;">Update Now</button>
      </div>
    `;
    document.body.appendChild(banner);

    document.getElementById("sw-update-accept").addEventListener("click", () => {
      banner.remove();
      if (onAccept) onAccept();
    });
    document.getElementById("sw-update-dismiss").addEventListener("click", () => {
      banner.remove();
    });
  }

  // Register the Service Worker in production/web contexts
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("./sw.js")
        .then((reg) => {
          console.log("[Service Worker] Registered successfully with scope:", reg.scope);

          // Force immediate update check on every load
          reg.update();

          // If an update is already waiting, show banner
          if (reg.waiting) {
            console.log("[Service Worker] New service worker waiting. Prompting user...");
            showUpdateBanner(() => {
              reg.waiting.postMessage({ action: "skipWaiting" });
            });
          }

          // Listen for new service worker installations
          reg.addEventListener("updatefound", () => {
            const newWorker = reg.installing;
            if (newWorker) {
              newWorker.addEventListener("statechange", () => {
                if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
                  console.log("[Service Worker] New update available. Prompting user...");
                  showUpdateBanner(() => {
                    newWorker.postMessage({ action: "skipWaiting" });
                  });
                }
              });
            }
          });
        })
        .catch((err) => {
          console.warn("[Service Worker] Registration failed:", err);
        });

      // Handle controller change (reload the page once to apply the update)
      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!refreshing) {
          refreshing = true;
          console.log("[Service Worker] Controller changed. Reloading page...");
          window.location.reload();
        }
      });
    });
  }

  // Expose globally
  window.showUpdateBanner = showUpdateBanner;
})();
