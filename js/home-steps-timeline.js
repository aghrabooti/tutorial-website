/* Scroll-linked progress for the homepage's three-step timeline. */
(function () {
    var timeline = document.querySelector("[data-home-steps]");
    if (!timeline) return;

    var rail = timeline.querySelector(".home-steps__rail");
    var items = Array.prototype.slice.call(timeline.querySelectorAll(".home-steps__item"));
    if (!rail || !items.length) return;

    var frameId = 0;
    var clamp = function (value, min, max) {
        return Math.min(max, Math.max(min, value));
    };

    function updateProgress() {
        frameId = 0;
        var timelineRect = timeline.getBoundingClientRect();
        var nodes = items.map(function (item) {
            return item.querySelector(".home-steps__node");
        });
        if (!nodes[0] || !nodes[nodes.length - 1]) return;

        var firstRect = nodes[0].getBoundingClientRect();
        var lastRect = nodes[nodes.length - 1].getBoundingClientRect();
        var firstCenter = firstRect.top + firstRect.height / 2;
        var lastCenter = lastRect.top + lastRect.height / 2;

        /* Keep the rail exactly between the centers of the first and last nodes. */
        timeline.style.setProperty("--home-steps-rail-top", Math.max(0, firstCenter - timelineRect.top) + "px");
        timeline.style.setProperty("--home-steps-rail-bottom", Math.max(0, timelineRect.bottom - lastCenter) + "px");

        var triggerPoint = window.innerHeight * 0.52;
        var totalTrack = lastCenter - firstCenter;
        var progress = totalTrack > 0 ? clamp((triggerPoint - firstCenter) / totalTrack, 0, 1) : 1;
        timeline.style.setProperty("--home-steps-progress", (progress * 100).toFixed(2) + "%");

        items.forEach(function (item, index) {
            var node = nodes[index];
            if (!node) return;
            var rect = node.getBoundingClientRect();
            var center = rect.top + rect.height / 2;
            item.classList.toggle("is-active", center <= triggerPoint);
        });
    }

    function scheduleUpdate() {
        if (frameId) return;
        frameId = window.requestAnimationFrame(updateProgress);
    }

    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate, { passive: true });

    if ("ResizeObserver" in window) {
        var resizeObserver = new ResizeObserver(scheduleUpdate);
        resizeObserver.observe(timeline);
    }

    updateProgress();
})();
