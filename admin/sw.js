// In2Skin dashboard service worker (Tony Nov 19, 2026): shows the
// pop-up when a booking, payment, or caller message lands, and keeps
// the counter on the dashboard icon. No fetch handling — the dashboard
// still loads from the network exactly as before.
self.addEventListener("push", function (event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }
  var title = data.title || "In2Skin";
  var body = data.body || "Something new at the studio.";
  var url = data.url || "/admin/dashboard.html";
  event.waitUntil(
    (async function () {
      try {
        if (typeof data.badge === "number" && "setAppBadge" in self.navigator) {
          if (data.badge > 0) await self.navigator.setAppBadge(data.badge);
          else await self.navigator.clearAppBadge();
        }
      } catch (e) {
        // The badge is best-effort; the pop-up is what matters.
      }
      await self.registration.showNotification(title, {
        body: body,
        icon: "/apple-touch-icon.png",
        tag: "in2skin-alert",
        data: { url: url },
      });
    })()
  );
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var url =
    (event.notification.data && event.notification.data.url) ||
    "/admin/dashboard.html";
  event.waitUntil(
    (async function () {
      var all = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (var i = 0; i < all.length; i++) {
        if (all[i].url.indexOf("/admin/dashboard.html") !== -1) {
          await all[i].focus();
          return;
        }
      }
      await self.clients.openWindow(url);
    })()
  );
});
