/* Plann3r project page interactions */
(function () {
  "use strict";

  // Smooth-scroll for in-page anchor buttons.
  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener("click", function (e) {
      var id = a.getAttribute("href");
      if (id.length < 2) return;
      var el = document.querySelector(id);
      if (!el) return;
      e.preventDefault();
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  // Lazily play demo videos only while on screen (saves bandwidth/CPU).
  var demoVideos = Array.prototype.slice.call(
    document.querySelectorAll("video.lazy-loop")
  );
  if ("IntersectionObserver" in window && demoVideos.length) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          var v = entry.target;
          if (entry.isIntersecting) {
            var p = v.play();
            if (p && p.catch) p.catch(function () {});
          } else {
            v.pause();
          }
        });
      },
      { threshold: 0.25 }
    );
    demoVideos.forEach(function (v) {
      io.observe(v);
    });
  } else {
    demoVideos.forEach(function (v) {
      var p = v.play();
      if (p && p.catch) p.catch(function () {});
    });
  }

  // Chapter buttons seek their card's video and mark the chapter being played.
  document.querySelectorAll(".video-chapters").forEach(function (chapters) {
    var card = chapters.closest(".video-card");
    var video = card && card.querySelector("video");
    if (!video) return;
    var buttons = Array.prototype.slice.call(chapters.querySelectorAll(".chapter-btn"));
    buttons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        video.currentTime = parseFloat(btn.dataset.time);
        var p = video.play();
        if (p && p.catch) p.catch(function () {});
      });
    });
    video.addEventListener("timeupdate", function () {
      var current = null;
      buttons.forEach(function (btn) {
        if (video.currentTime >= parseFloat(btn.dataset.time)) current = btn;
      });
      buttons.forEach(function (btn) {
        btn.classList.toggle("is-active", btn === current);
      });
    });
  });

  // Copy-to-clipboard for the BibTeX block.
  var copyBtn = document.getElementById("copy-bibtex");
  if (copyBtn) {
    copyBtn.addEventListener("click", function () {
      var txt = document.getElementById("bibtex-text");
      if (!txt) return;
      navigator.clipboard.writeText(txt.textContent.trim()).then(function () {
        var prev = copyBtn.textContent;
        copyBtn.textContent = "Copied!";
        setTimeout(function () {
          copyBtn.textContent = prev;
        }, 1500);
      });
    });
  }

  // ---------------------------------------------------------------
  // Topomap demo scaffold.
  // Wired up once the .npz bundle is provided. The user moves along the
  // reference topomap and inspects the predicted geodesic costs at each
  // node (query selection is not exposed). Renders into #demo-app.
  // ---------------------------------------------------------------
  window.Plann3rDemo = {
    mount: function (containerId, dataUrl) {
      // Placeholder. Implementation arrives with the demo data bundle.
      // eslint-disable-next-line no-console
      console.log("[Plann3rDemo] awaiting data bundle:", containerId, dataUrl);
    },
  };
})();
