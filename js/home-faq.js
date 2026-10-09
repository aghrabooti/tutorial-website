// Keep the homepage FAQ exclusive: opening one disclosure closes the others.
// The matching `name` attribute also provides native exclusive behavior in browsers that support it.
(function () {
    "use strict";

    var items = Array.prototype.slice.call(
        document.querySelectorAll(".home-faq__item")
    );

    if (!items.length) return;

    items.forEach(function (item) {
        item.addEventListener("toggle", function () {
            if (!item.open) return;

            items.forEach(function (other) {
                if (other !== item && other.open) {
                    other.open = false;
                }
            });
        });
    });
})();
