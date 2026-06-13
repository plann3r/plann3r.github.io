/* Interactive Plann3r topomap viewer.
 *
 * Loads a per-scene costmap bundle (base64 uint8, shape [frames, 16, 16] per
 * goal), and for the selected goal lets the user scrub the reference traverse
 * and see the predicted geodesic costmap overlaid on each RGB frame. Low cost
 * (cheap to reach the goal) maps to blue, high cost to red.
 */
(function () {
  "use strict";

  var PATCH_GRID = 16;

  // Turbo colormap polynomial approximation (input and output in [0, 1]).
  function turbo(t) {
    var x = t < 0 ? 0 : t > 1 ? 1 : t;
    var r = 0.1357 + x * (4.6154 + x * (-42.6603 + x * (132.1311 + x * (-152.9424 + x * 59.2864))));
    var g = 0.0914 + x * (2.1942 + x * (4.8430 + x * (-14.1850 + x * (4.2773 + x * 2.8296))));
    var b = 0.1067 + x * (12.6419 + x * (-60.5820 + x * (110.3628 + x * (-89.9031 + x * 27.3482))));
    return [clamp255(r), clamp255(g), clamp255(b)];
  }

  function clamp255(value) {
    var scaled = Math.round(value * 255);
    if (scaled < 0) return 0;
    if (scaled > 255) return 255;
    return scaled;
  }

  function decodeBase64ToBytes(b64) {
    var binary = atob(b64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  function decodeBase64ToFloat32(b64) {
    var bytes = decodeBase64ToBytes(b64);
    return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  }

  function pad5(value) {
    var text = String(value);
    while (text.length < 5) {
      text = "0" + text;
    }
    return text;
  }

  function createViewer(root) {
    var canvas = root.querySelector("#demo-canvas");
    var context = canvas.getContext("2d");
    var strip = root.querySelector("#demo-strip");
    var stripContext = strip.getContext("2d");
    var scenesBar = root.querySelector("#demo-scenes");
    var goalsBar = root.querySelector("#demo-goals");
    var modesBar = root.querySelector("#demo-modes");
    var frameSlider = root.querySelector("#demo-frame");
    var opacitySlider = root.querySelector("#demo-opacity");
    var playButton = root.querySelector("#demo-play");
    var readout = root.querySelector("#demo-readout");
    var loading = root.querySelector("#demo-loading");

    var state = {
      scenes: [],
      sceneIndex: 0,
      framesUrl: "",
      bundle: null,
      goalIndex: 0,
      frame: 0,
      numFrames: 0,
      images: [],
      playing: false,
      lastTick: 0,
      overlayAlpha: 0.6,
      mode: "global",
    };

    state.scenes = window.PLANN3R_DEMO_SCENES || [];
    if (!state.scenes.length) {
      loading.textContent = "Could not load the demo data.";
      return;
    }

    attachControls();
    bindModeButtons();
    buildSceneButtons();
    setScene(0);

    function attachControls() {
      window.addEventListener("resize", function () {
        resizeStrip();
        drawStrip();
      });
      frameSlider.addEventListener("input", function () {
        setFrame(parseInt(frameSlider.value, 10));
      });
      opacitySlider.addEventListener("input", function () {
        state.overlayAlpha = parseInt(opacitySlider.value, 10) / 100;
        render();
      });
      playButton.addEventListener("click", togglePlay);
      strip.addEventListener("pointerdown", onStripPointer);
      strip.addEventListener("pointermove", function (event) {
        if (event.buttons === 1) {
          onStripPointer(event);
        }
      });
    }

    function buildSceneButtons() {
      scenesBar.innerHTML = "";
      if (state.scenes.length < 2) {
        return;
      }
      state.scenes.forEach(function (scene, index) {
        var button = document.createElement("button");
        button.className = "demo-seg-btn";
        button.textContent = scene.label || scene.key;
        button.addEventListener("click", function () {
          setScene(index);
        });
        scenesBar.appendChild(button);
      });
    }

    function setScene(index) {
      state.sceneIndex = index;
      Array.prototype.forEach.call(scenesBar.children, function (child, childIndex) {
        child.classList.toggle("is-active", childIndex === index);
      });

      var scene = state.scenes[index];
      state.bundle = scene.bundle;
      state.framesUrl = scene.frames;
      state.numFrames = scene.bundle.num_frames;
      scene.bundle.goals.forEach(function (goal) {
        if (!goal.values) {
          goal.values = decodeBase64ToFloat32(goal.data_f32_b64);
          goal.costRange = computeCostRange(goal.propagation_costs);
        }
      });

      frameSlider.max = String(state.numFrames - 1);
      state.playing = false;
      playButton.textContent = "Play";
      buildGoalButtons();
      preloadFrames();
      resizeStrip();
      loading.style.display = "none";
      setGoal(0);
    }

    function computeCostRange(costs) {
      if (!costs || !costs.length) {
        return { min: 0, max: 1 };
      }
      var min = Infinity;
      var max = -Infinity;
      for (var i = 0; i < costs.length; i += 1) {
        if (!isFinite(costs[i])) {
          continue;
        }
        if (costs[i] < min) min = costs[i];
        if (costs[i] > max) max = costs[i];
      }
      if (!isFinite(min)) {
        return { min: 0, max: 1 };
      }
      if (max <= min) {
        max = min + 1e-6;
      }
      return { min: min, max: max };
    }

    function buildGoalButtons() {
      goalsBar.innerHTML = "";
      state.bundle.goals.forEach(function (goal, index) {
        var button = document.createElement("button");
        button.className = "demo-seg-btn";
        button.textContent = goal.id === "lastimg" ? "Last frame" : "Frame " + goal.goal_img_idx;
        button.addEventListener("click", function () {
          setGoal(index);
        });
        goalsBar.appendChild(button);
      });
    }

    function bindModeButtons() {
      var buttons = modesBar.querySelectorAll(".demo-seg-btn");
      Array.prototype.forEach.call(buttons, function (button) {
        button.classList.toggle("is-active", button.getAttribute("data-mode") === state.mode);
        button.addEventListener("click", function () {
          state.mode = button.getAttribute("data-mode");
          Array.prototype.forEach.call(buttons, function (other) {
            other.classList.toggle("is-active", other === button);
          });
          render();
        });
      });
    }

    function preloadFrames() {
      state.images = [];
      for (var i = 0; i < state.numFrames; i += 1) {
        var image = new Image();
        image.src = state.framesUrl + "/" + pad5(i) + ".jpg";
        image.onload = render;
        state.images.push(image);
      }
    }

    function setGoal(index) {
      state.goalIndex = index;
      Array.prototype.forEach.call(goalsBar.children, function (child, childIndex) {
        child.classList.toggle("is-active", childIndex === index);
      });
      var goal = state.bundle.goals[index];
      setFrame(Math.min(goal.goal_img_idx, state.numFrames - 1));
      drawStrip();
    }

    function setFrame(frame) {
      state.frame = Math.max(0, Math.min(state.numFrames - 1, frame));
      frameSlider.value = String(state.frame);
      render();
      drawStrip();
    }

    function currentGoal() {
      return state.bundle.goals[state.goalIndex];
    }

    function render() {
      var image = state.images[state.frame];
      context.clearRect(0, 0, canvas.width, canvas.height);
      if (image && image.complete && image.naturalWidth) {
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
      } else {
        context.fillStyle = "#0b0d12";
        context.fillRect(0, 0, canvas.width, canvas.height);
      }

      var goal = currentGoal();
      var patchWidth = canvas.width / PATCH_GRID;
      var patchHeight = canvas.height / PATCH_GRID;
      var cellsPerFrame = PATCH_GRID * PATCH_GRID;
      var base = state.frame * cellsPerFrame;
      var range = normalizationRange(goal, base, cellsPerFrame);
      var span = range.max - range.min;
      if (span <= 0) {
        span = 1e-6;
      }

      context.globalAlpha = state.overlayAlpha;
      for (var py = 0; py < PATCH_GRID; py += 1) {
        for (var px = 0; px < PATCH_GRID; px += 1) {
          var value = goal.values[base + py * PATCH_GRID + px];
          if (!isFinite(value)) {
            continue;
          }
          var color = turbo((value - range.min) / span);
          context.fillStyle = "rgb(" + color[0] + "," + color[1] + "," + color[2] + ")";
          context.fillRect(px * patchWidth, py * patchHeight, patchWidth + 1, patchHeight + 1);
        }
      }
      context.globalAlpha = 1;

      if (state.frame === goal.goal_img_idx && goal.goal_pixel) {
        drawGoalMarker(goal.goal_pixel);
      }
      updateReadout();
    }

    function normalizationRange(goal, base, cellsPerFrame) {
      if (state.mode === "relative") {
        var min = Infinity;
        var max = -Infinity;
        for (var i = 0; i < cellsPerFrame; i += 1) {
          var value = goal.values[base + i];
          if (!isFinite(value)) {
            continue;
          }
          if (value < min) min = value;
          if (value > max) max = value;
        }
        if (!isFinite(min)) {
          return { min: 0, max: 1 };
        }
        return { min: min, max: max };
      }
      return { min: goal.vmin, max: goal.vmax };
    }

    function drawGoalMarker(goalPixel) {
      var scaleX = canvas.width / state.bundle.image.width;
      var scaleY = canvas.height / state.bundle.image.height;
      var cx = goalPixel[0] * scaleX;
      var cy = goalPixel[1] * scaleY;
      context.lineWidth = 3;
      context.strokeStyle = "#ffffff";
      context.beginPath();
      context.arc(cx, cy, 11, 0, Math.PI * 2);
      context.stroke();
      context.fillStyle = "#ff3b3b";
      context.beginPath();
      context.arc(cx, cy, 5, 0, Math.PI * 2);
      context.fill();
    }

    function updateReadout() {
      var goal = currentGoal();
      var cost = goal.propagation_costs ? goal.propagation_costs[state.frame] : null;
      var costText = cost === null || cost === undefined || !isFinite(cost)
        ? "n/a"
        : cost.toFixed(2);
      var atGoal = state.frame === goal.goal_img_idx ? "  (goal frame)" : "";
      readout.textContent =
        "Frame " + state.frame + " / " + (state.numFrames - 1) +
        "   cost to goal: " + costText + atGoal;
    }

    function resizeStrip() {
      var width = strip.parentNode.clientWidth;
      strip.width = Math.max(width, 1);
    }

    function drawStrip() {
      if (!state.bundle) {
        return;
      }
      var goal = currentGoal();
      var width = strip.width;
      var height = strip.height;
      stripContext.clearRect(0, 0, width, height);
      var columnWidth = width / state.numFrames;
      var range = goal.costRange;
      for (var i = 0; i < state.numFrames; i += 1) {
        var cost = goal.propagation_costs ? goal.propagation_costs[i] : 0;
        var t = (cost - range.min) / (range.max - range.min);
        var color = turbo(t);
        stripContext.fillStyle = "rgb(" + color[0] + "," + color[1] + "," + color[2] + ")";
        stripContext.fillRect(i * columnWidth, 0, columnWidth + 1, height);
      }

      var goalX = (goal.goal_img_idx + 0.5) * columnWidth;
      stripContext.fillStyle = "#ffffff";
      stripContext.beginPath();
      stripContext.moveTo(goalX, 0);
      stripContext.lineTo(goalX - 5, -0);
      stripContext.lineTo(goalX, 8);
      stripContext.lineTo(goalX + 5, 0);
      stripContext.closePath();
      stripContext.fill();

      var cursorX = (state.frame + 0.5) * columnWidth;
      stripContext.strokeStyle = "#111";
      stripContext.lineWidth = 2;
      stripContext.strokeRect(state.frame * columnWidth, 1, columnWidth, height - 2);
      stripContext.strokeStyle = "#fff";
      stripContext.lineWidth = 1;
      stripContext.beginPath();
      stripContext.moveTo(cursorX, 0);
      stripContext.lineTo(cursorX, height);
      stripContext.stroke();
    }

    function onStripPointer(event) {
      var rect = strip.getBoundingClientRect();
      var x = event.clientX - rect.left;
      var frame = Math.floor((x / rect.width) * state.numFrames);
      setFrame(frame);
    }

    function togglePlay() {
      state.playing = !state.playing;
      playButton.textContent = state.playing ? "Pause" : "Play";
      if (state.playing) {
        state.lastTick = 0;
        window.requestAnimationFrame(tick);
      }
    }

    function tick(timestamp) {
      if (!state.playing) {
        return;
      }
      if (!state.lastTick) {
        state.lastTick = timestamp;
      }
      if (timestamp - state.lastTick > 120) {
        state.lastTick = timestamp;
        var next = state.frame + 1;
        if (next >= state.numFrames) {
          next = 0;
        }
        setFrame(next);
      }
      window.requestAnimationFrame(tick);
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    var root = document.getElementById("demo-viewer");
    if (root) {
      createViewer(root);
    }
  });
})();
