import { heroui } from "@heroui/theme";

/** 主题与 Now Playing 完全同款：HeroUI 默认 dark 主题，只把底色钉在 #121212。
 * 其余 token（default-100 #27272a、divider 白 15%、foreground #ECEDEE）全是原生值，不再自造灰阶。 */
export default heroui({
  defaultTheme: "dark",
  defaultExtendTheme: "dark",
  themes: {
    dark: {
      colors: {
        background: "#121212",
      },
    },
  },
});
