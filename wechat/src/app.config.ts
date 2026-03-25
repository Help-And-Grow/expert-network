export default defineAppConfig({
  pages: [
    "pages/index/index",
    "pages/discover/index",
    "pages/expert/index",
    "pages/book/index",
    "pages/dashboard/index",
    "pages/onboarding/index",
    "pages/profile/index",
  ],
  tabBar: {
    color: "#999999",
    selectedColor: "#6366f1",
    backgroundColor: "#ffffff",
    borderStyle: "white",
    list: [
      {
        pagePath: "pages/index/index",
        text: "Home",
        iconPath: "assets/tab-home.png",
        selectedIconPath: "assets/tab-home-active.png",
      },
      {
        pagePath: "pages/discover/index",
        text: "Discover",
        iconPath: "assets/tab-discover.png",
        selectedIconPath: "assets/tab-discover-active.png",
      },
      {
        pagePath: "pages/dashboard/index",
        text: "Bookings",
        iconPath: "assets/tab-bookings.png",
        selectedIconPath: "assets/tab-bookings-active.png",
      },
      {
        pagePath: "pages/profile/index",
        text: "Me",
        iconPath: "assets/tab-profile.png",
        selectedIconPath: "assets/tab-profile-active.png",
      },
    ],
  },
  window: {
    backgroundTextStyle: "light",
    navigationBarBackgroundColor: "#ffffff",
    navigationBarTitleText: "Help & Grow",
    navigationBarTextStyle: "black",
  },
});
