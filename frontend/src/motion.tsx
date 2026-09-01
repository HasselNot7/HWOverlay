import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import type { OverlayScrollbars } from "overlayscrollbars";
import { toast } from "@heroui/react";

/** framer-motion 变体：动效跟组件放一起（学 Now Playing，不集中到 variants.ts）。
 * 统一"进比出慢、出比进轻"的手感，时长压在 0.1~0.3s。 */

/** 依赖型配置行的显隐：开关打开才展开的子选项，用 height+scaleY+opacity 三段 spring
 * 挤压式抽出，避免生硬跳变。origin-top 让它从上往下长。 */
const rowVariants = {
  initial: { height: 0, opacity: 0, scaleY: 0.95, y: -8 },
  animate: {
    height: "auto", opacity: 1, scaleY: 1, y: 0,
    transition: {
      type: "spring", stiffness: 200, damping: 28, mass: 1.1,
      opacity: { type: "spring", stiffness: 180, damping: 30 },
    },
  },
  exit: {
    height: 0, opacity: 0, scaleY: 0.95, y: -8,
    transition: { type: "spring", stiffness: 180, damping: 32, mass: 1 },
  },
} as const;

export function AnimatedRow({ show, children }: { show: boolean; children: React.ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          className="overflow-hidden origin-top"
          variants={rowVariants} initial="initial" animate="animate" exit="exit">
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** 列表项进场：淡入 + 轻微上移，配合 staggerChildren 做逐条浮现。 */
export const listItem = {
  hidden: { opacity: 0, y: 6 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 320, damping: 30 } },
} as const;

const iconVariants = {
  initial: { scale: 1.2, opacity: 0 },
  animate: { scale: 1, opacity: 1, transition: { duration: 0.15 } },
  exit: { scale: 0.4, opacity: 0, transition: { duration: 0.12 } },
} as const;

/** 复制按钮：点一下把文本写进剪贴板，图标 copy→check 互换（NP CopyButton 同款）。
 * 用于 OBS 浏览器源 URL 这类"手选容易错"的地方。 */
export function CopyButton({ text, label = "复制", size = 15 }: {
  text: string; label?: string; size?: number;
}) {
  const [copied, setCopied] = useState(false);
  const doCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("已复制", { description: text, timeout: 1600 });
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.danger("复制失败", { description: "浏览器拒绝了剪贴板权限，请手动选中复制", timeout: 6000 });
    }
  };
  return (
    <button
      type="button" onClick={doCopy} title={copied ? "已复制" : label}
      className="inline-grid size-7 shrink-0 cursor-pointer place-items-center rounded-md text-muted transition-colors hover:bg-white/[0.06] hover:text-foreground">
      <AnimatePresence mode="wait" initial={false}>
        {copied
          ? <motion.span key="check" variants={iconVariants} initial="initial" animate="animate" exit="exit" className="text-success"><Check size={size} /></motion.span>
          : <motion.span key="copy" variants={iconVariants} initial="initial" animate="animate" exit="exit"><Copy size={size} /></motion.span>}
      </AnimatePresence>
    </button>
  );
}

/** 主内容滚动区：OverlayScrollbars 深色胶囊滑块 + 上下边缘 mask 渐隐（仅在可滚方向淡出）。
 * Now Playing 的 DefaultLayout 同款手法，比原生滚动条精致一档。 */
export function ScrollArea({ scrollKey, children }: {
  scrollKey: string;         // 变化即滚回顶部（切视图）
  children: React.ReactNode;
}) {
  const ref = useRef<React.ElementRef<typeof OverlayScrollbarsComponent>>(null);
  const [mask, setMask] = useState<string>("");
  useEffect(() => {
    const inst = ref.current?.osInstance() as OverlayScrollbars | undefined;
    const viewport = inst?.elements().viewport;
    if (!viewport) return;
    const update = () => {
      const { scrollTop, scrollHeight, clientHeight } = viewport;
      const topFade = scrollTop > 4 ? "transparent 0, black 40px" : "transparent 0, black 0";
      const bottomFade = scrollHeight - scrollTop - clientHeight > 4
        ? ", black calc(100% - 40px), transparent 100%" : "";
      setMask(`linear-gradient(to bottom, ${topFade}${bottomFade})`);
    };
    update();
    viewport.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(viewport);
    return () => { viewport.removeEventListener("scroll", update); ro.disconnect(); };
  }, []);
  useEffect(() => {
    const inst = ref.current?.osInstance() as OverlayScrollbars | undefined;
    const vp = inst?.elements().viewport;
    if (vp) vp.scrollTop = 0;
  }, [scrollKey]);
  return (
    <OverlayScrollbarsComponent
      ref={ref}
      className="h-full"
      options={{ overflow: { x: "hidden", y: "scroll" }, scrollbars: { autoHide: "leave", autoHideDelay: 400, theme: "os-theme-dark" } }}
      style={{ maskImage: mask || undefined, WebkitMaskImage: mask || undefined }}>
      {children}
    </OverlayScrollbarsComponent>
  );
}
