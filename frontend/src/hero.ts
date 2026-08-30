import { heroui } from "@heroui/react";

/** HeroUI 主题：主色用 Nord 青 #88c0d0，与叠加层同源；底色学参考应用的近黑 zinc。 */
export default heroui({
  themes: {
    dark: {
      colors: {
        background: "#121214",
        foreground: "#eceff4",
        divider: "#232326",
        content1: "#1a1a1d",
        content2: "#232327",
        content3: "#2a2a2f",
        focus: "#88c0d0",
        primary: {
          "50": "#e6f3f6",
          "100": "#c2e2e8",
          "200": "#9ccfdd",
          "300": "#88c0d0",
          "400": "#6aa9bc",
          "500": "#4d8a9f",
          "600": "#3a6a7d",
          "700": "#2d505f",
          "800": "#22404c",
          "900": "#182f38",
          DEFAULT: "#88c0d0",
          foreground: "#121214",
        },
      },
    },
  },
});
