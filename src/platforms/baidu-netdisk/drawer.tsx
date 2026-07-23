import {
  useEffect,
  useState,
  type ReactNode,
} from "react";

import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { platformNavigation } from "@/config/navigation";
import { BaiduNetdiskPanel } from "@/pages/baidu-netdisk/window";
import type { BaiduNetdiskWindowPlatformId } from "@/platforms/baidu-netdisk/service";

const openDrawerEventName = "baidu-netdisk:drawer:open";

export function openBaiduNetdiskDrawer(platformId: BaiduNetdiskWindowPlatformId) {
  window.dispatchEvent(
    new CustomEvent<BaiduNetdiskWindowPlatformId>(openDrawerEventName, {
      detail: platformId,
    }),
  );
}

export function BaiduNetdiskDrawerProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [platformId, setPlatformId] = useState<BaiduNetdiskWindowPlatformId>("wechat-drama");
  const activePlatform =
    platformNavigation.find((platform) => platform.id === platformId) ?? platformNavigation[0];

  useEffect(() => {
    const handleOpen = (event: Event) => {
      const platformEvent = event as CustomEvent<BaiduNetdiskWindowPlatformId>;
      setPlatformId(platformEvent.detail);
      setOpen(true);
    };

    window.addEventListener(openDrawerEventName, handleOpen);
    return () => window.removeEventListener(openDrawerEventName, handleOpen);
  }, []);

  return (
    <>
      {children}
      <Drawer direction="bottom" open={open} onOpenChange={setOpen}>
        <DrawerContent className="h-[88svh] max-h-[calc(100svh-2rem)] w-full overflow-hidden shadow-2xl motion-reduce:transition-none [&>div:first-child]:hidden">
          <DrawerHeader className="relative h-11 shrink-0 flex-row items-center gap-2 border-b px-4 py-0 text-left">
            <img
              src={`${import.meta.env.BASE_URL}百度网盘.svg`}
              alt=""
              className="size-[18px] shrink-0"
            />
            <DrawerTitle className="text-sm">百度网盘</DrawerTitle>
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
              {activePlatform.title}
            </span>
            <DrawerDescription className="sr-only">
              下载百度网盘分享资源
            </DrawerDescription>
            <DrawerClose
              aria-label="关闭百度网盘"
              className="absolute right-2 top-1.5 inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-xl leading-none text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              ×
            </DrawerClose>
          </DrawerHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <BaiduNetdiskPanel platformId={platformId} />
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}
