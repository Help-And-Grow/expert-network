export default defineAppConfig({
  pages: [
    "pages/index/index",
    "pages/discover/index",
    "pages/expert/index",
    "pages/book/index",
    "pages/reschedule/index",
    "pages/dashboard/index",
    "pages/onboarding/index",
    "pages/profile/index",
    // "pages/consultation/index", // live-pusher/live-player — not available for overseas entities
    // "pages/membership/index", // hidden until WeChat Pay is provisioned
  ],
  tabBar: {
    color: "#8a8f98",
    selectedColor: "#6366f1",
    backgroundColor: "#fcfbf8",
    borderStyle: "white",
    list: [
      {
        pagePath: "pages/index/index",
        text: "首页",
        iconPath: "assets/tab-home.png",
        selectedIconPath: "assets/tab-home-active.png",
      },
      {
        pagePath: "pages/discover/index",
        text: "找导师",
        iconPath: "assets/tab-discover.png",
        selectedIconPath: "assets/tab-discover-active.png",
      },
      {
        pagePath: "pages/dashboard/index",
        text: "学习",
        iconPath: "assets/tab-bookings.png",
        selectedIconPath: "assets/tab-bookings-active.png",
      },
      {
        pagePath: "pages/profile/index",
        text: "我的",
        iconPath: "assets/tab-profile.png",
        selectedIconPath: "assets/tab-profile-active.png",
      },
    ],
  },
  window: {
    backgroundTextStyle: "light",
    navigationBarBackgroundColor: "#fcfbf8",
    navigationBarTitleText: "Help & Grow 青年导师",
    navigationBarTextStyle: "black",
  },
});
