import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";

import { buttonVariants } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  defaultRoute,
  isAppRoute,
  platformForPath,
  platformNavigation,
  routePath,
} from "@/config/navigation";
import { cn } from "@/lib/utils";

function ensureTitlebarPlatformNavHost() {
  const titlebar = document.querySelector<HTMLElement>(".cet-titlebar");

  if (!titlebar) {
    return null;
  }

  const existingHost = titlebar.querySelector<HTMLElement>("[data-app-titlebar-platform-nav-host]");

  if (existingHost) {
    return existingHost;
  }

  const host = document.createElement("div");
  host.dataset.appTitlebarPlatformNavHost = "true";
  host.className = "app-titlebar-platform-nav-host";
  titlebar.append(host);

  return host;
}

export function AppTitlebarPlatformNav() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const currentPath = location.pathname.replace(/^\/+/, "");
  const activeRoute = isAppRoute(currentPath) ? currentPath : defaultRoute;
  const activePlatform = platformForPath(activeRoute);

  useEffect(() => {
    let disposed = false;
    let observer: MutationObserver | null = null;

    const mountHost = () => {
      const nextHost = ensureTitlebarPlatformNavHost();

      if (!nextHost) {
        return false;
      }

      if (!disposed) {
        setHost(nextHost);
      }

      return true;
    };

    if (!mountHost()) {
      observer = new MutationObserver(() => {
        if (mountHost()) {
          observer?.disconnect();
          observer = null;
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    return () => {
      disposed = true;
      observer?.disconnect();
    };
  }, []);

  if (!host) {
    return null;
  }

  return createPortal(
    <>
      <nav className="app-titlebar-platform-switcher" aria-label="平台切换">
        {platformNavigation.map((platform) => {
          const active = activePlatform.id === platform.id;

          return (
            <Tooltip key={platform.id}>
              <TooltipTrigger
                type="button"
                aria-label={`打开${platform.title}`}
                aria-pressed={active}
                className={cn(
                  buttonVariants({ size: "icon-xs", variant: active ? "secondary" : "ghost" }),
                  "app-titlebar-platform-button",
                  active && "app-titlebar-platform-button-active",
                )}
                onClick={() => navigate(routePath(platform.serviceRoute))}
              >
                <img
                  src={platform.logoSrc}
                  alt=""
                  aria-hidden="true"
                  draggable={false}
                  className="size-5 object-contain"
                />
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={8}>
                {platform.title}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </nav>
    </>,
    host,
  );
}
