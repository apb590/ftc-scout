/**
 * canvas.js - Interactive Starting Position Canvas Map
 * Handles drawing, image theme switching, resizing, and coordinate normalization.
 */
class ScoutingCanvas {
  constructor(canvasElement, onPositionChanged) {
    this.canvas = canvasElement;
    this.ctx = this.canvas.getContext("2d");
    this.onPositionChanged = onPositionChanged; // Callback when coordinates update

    // Normalized coordinates (0.00 to 1.00)
    this.pinX = null;
    this.pinY = null;

    // Field backdrop URL assets
    this.images = {
      default: "https://raw.githubusercontent.com/acmerobotics/MeepMeep/cd0a88ff91a5fd7fa740d0d95dfea60ba14f656c/src/main/resources/background/season-2025-decode/field-2025-official.png",
      light: "https://raw.githubusercontent.com/acmerobotics/MeepMeep/cd0a88ff91a5fd7fa740d0d95dfea60ba14f656c/src/main/resources/background/season-2025-decode/field-2025-juice-light.png"
    };

    this.currentTheme = "default";
    this.imgObjects = {};
    this.imagesLoaded = false;

    // Preload field backdrops
    this.preloadImages();

    // Event listeners
    this.canvas.addEventListener("click", (e) => this.handlePointerDown(e));
    this.canvas.addEventListener("touchstart", (e) => {
      // Prevent screen scrolling when touching canvas
      e.preventDefault();
      this.handlePointerDown(e.touches[0]);
    }, { passive: false });

    // Handle responsiveness
    window.addEventListener("resize", () => this.draw());
  }

  /**
   * Preload default image, loading light as backup
   */
  preloadImages() {
    const imagesToLoad = {
      default: this.images.default,
      light: this.images.light
    };

    let loadedCount = 0;
    const totalCount = Object.keys(imagesToLoad).length;

    for (const [key, url] of Object.entries(imagesToLoad)) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = url;
      img.onload = () => {
        loadedCount++;
        this.imgObjects[key] = img;
        if (key === "default") {
          this.imagesLoaded = true;
          this.draw();
        }
      };
      img.onerror = () => {
        console.error(`[Canvas] Failed to load image: ${key} (${url})`);
        loadedCount++;
        if (key === "default") {
          // Fallback to light theme on default load failure
          this.currentTheme = "light";
          this.imagesLoaded = true;
          this.draw();
        }
      };
    }
  }

  /**
   * Set theme
   */
  setTheme(theme) {
    if (this.images[theme]) {
      this.currentTheme = theme;
      this.draw();
    }
  }

  /**
   * Set dynamic canvas scale (High DPI scaling)
   */
  resizeCanvas() {
    const rect = this.canvas.getBoundingClientRect();
    
    // Set internal resolution based on actual rendering size
    const width = rect.width || 400;
    const height = rect.width || 400; // Force 1:1 aspect ratio square

    this.canvas.width = width;
    this.canvas.height = height;
  }

  /**
   * Evaluates coordinate region matching strict downstream specifications
   * X, Y are normalized (0.0 to 1.0)
   */
  evaluateZone(x, y) {
    if (y < 0.33) {
      return "1 - Flush against goal";
    } else if (y > 0.66) {
      return "5 - Audience near middle of field";
    } else {
      return "3 - Middle";
    }
  }

  /**
   * Handles user tap/click on canvas
   */
  handlePointerDown(pointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    const xPx = pointerEvent.clientX - rect.left;
    const yPx = pointerEvent.clientY - rect.top;

    // Convert to normalized percentage coordinates (0.0 to 1.0)
    const normX = Math.max(0, Math.min(1, xPx / rect.width));
    const normY = Math.max(0, Math.min(1, yPx / rect.height));

    this.setPinPosition(normX, normY);

    // Call state updater callback
    if (this.onPositionChanged) {
      const zoneString = this.evaluateZone(normX, normY);
      this.onPositionChanged(zoneString, normX, normY);
    }
  }

  /**
   * Sets crosshair coordinates programmatically (e.g. on loading drafts)
   */
  setPinPosition(normX, normY) {
    this.pinX = normX;
    this.pinY = normY;
    this.draw();
  }

  /**
   * Clears active starting position crosshair
   */
  clearPin() {
    this.pinX = null;
    this.pinY = null;
    this.draw();
  }

  /**
   * Draw canvas loop: clears screen, renders background, overlays zone indicators and coordinate pin
   */
  draw() {
    this.resizeCanvas();
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Clear canvas
    this.ctx.clearRect(0, 0, w, h);

    // 1. Draw Field Map Backdrop (Rotated 90 degrees clockwise)
    const activeImg = this.imgObjects[this.currentTheme];
    if (this.imagesLoaded && activeImg) {
      this.ctx.save();
      this.ctx.translate(w / 2, h / 2);
      this.ctx.rotate(90 * Math.PI / 180);
      this.ctx.drawImage(activeImg, -w / 2, -h / 2, w, h);
      this.ctx.restore();
    } else {
      // Loading state block
      this.ctx.fillStyle = "#1e293b";
      this.ctx.fillRect(0, 0, w, h);
      this.ctx.fillStyle = "#94a3b8";
      this.ctx.font = "14px Outfit, Inter, sans-serif";
      this.ctx.textAlign = "center";
      this.ctx.textBaseline = "middle";
      this.ctx.fillText("Loading field asset map...", w / 2, h / 2);
    }

    // 2. Draw Subtle Field Boundary Zone Indicators
    this.ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
    this.ctx.lineWidth = 1.5;
    this.ctx.setLineDash([6, 6]);

    // Draw horizontal lines mapping boundary thresholds (0.33 and 0.66)
    this.ctx.beginPath();
    this.ctx.moveTo(0, h * 0.33);
    this.ctx.lineTo(w, h * 0.33);
    this.ctx.moveTo(0, h * 0.66);
    this.ctx.lineTo(w, h * 0.66);
    this.ctx.stroke();
    this.ctx.setLineDash([]); // Reset line dash style

    // Write text overlays in corner areas
    this.ctx.font = "10px Outfit, Inter, sans-serif";
    this.ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
    this.ctx.textAlign = "left";
    this.ctx.fillText("Zone 1: Flush Against Goal", 8, h * 0.05);
    this.ctx.fillText("Zone 3: Middle", 8, h * 0.38);
    this.ctx.fillText("Zone 5: Audience Near Middle", 8, h * 0.71);

    // 3. Draw Selected Coordinate Pin Overlay
    if (this.pinX !== null && this.pinY !== null) {
      const pinXPx = this.pinX * w;
      const pinYPx = this.pinY * h;

      // Glow halo
      const radialGradient = this.ctx.createRadialGradient(
        pinXPx, pinYPx, 2,
        pinXPx, pinYPx, 18
      );
      radialGradient.addColorStop(0, "rgba(59, 130, 246, 0.85)"); // Vibrant blue center
      radialGradient.addColorStop(0.3, "rgba(59, 130, 246, 0.4)");
      radialGradient.addColorStop(1, "rgba(59, 130, 246, 0)"); // Transparent fade out
      
      this.ctx.fillStyle = radialGradient;
      this.ctx.beginPath();
      this.ctx.arc(pinXPx, pinYPx, 18, 0, Math.PI * 2);
      this.ctx.fill();

      // Pin core dot
      this.ctx.fillStyle = "#ffffff";
      this.ctx.strokeStyle = "#2563eb";
      this.ctx.lineWidth = 3;
      
      this.ctx.beginPath();
      this.ctx.arc(pinXPx, pinYPx, 6, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.stroke();

      // Draw crosshairs intersecting the dot
      this.ctx.strokeStyle = "#ffffff";
      this.ctx.lineWidth = 1;
      this.ctx.beginPath();
      
      // Horizontal crosshair snippet
      this.ctx.moveTo(pinXPx - 14, pinYPx);
      this.ctx.lineTo(pinXPx - 8, pinYPx);
      this.ctx.moveTo(pinXPx + 8, pinYPx);
      this.ctx.lineTo(pinXPx + 14, pinYPx);

      // Vertical crosshair snippet
      this.ctx.moveTo(pinXPx, pinYPx - 14);
      this.ctx.lineTo(pinXPx, pinYPx - 8);
      this.ctx.moveTo(pinXPx, pinYPx + 8);
      this.ctx.lineTo(pinXPx, pinYPx + 14);

      this.ctx.stroke();
    }
  }
}

// Export canvas binder class to window scope
window.ScoutingCanvas = ScoutingCanvas;
