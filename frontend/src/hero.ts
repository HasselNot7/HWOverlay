import { heroui } from "@heroui/theme";

/** HeroUI 主题：主色保持默认蓝（和参考应用同款），暗色底学它的近黑 + 灰阶分层。 */
export default heroui({
  themes: {
    dark: {
      colors: {
        background: "#121212",
        foreground: "#eceef0",
        divider: "#2e2e32",
        content1: "#1b1b1e",
        content2: "#27272a",
        content3: "#323236",
        focus: "#006fee",
      },
    },
  },
});
