import { Menu } from "@base-ui/react/menu";

import { cn } from "@/lib/utils";

function DropdownMenu({ ...props }: Menu.Root.Props) {
  return <Menu.Root data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuTrigger({ ...props }: Menu.Trigger.Props) {
  return <Menu.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

function DropdownMenuContent({
  className,
  sideOffset = 6,
  side = "bottom",
  align = "end",
  alignOffset = 0,
  children,
  ...props
}: Menu.Popup.Props &
  Pick<Menu.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">) {
  return (
    <Menu.Portal>
      <Menu.Positioner
        align={align}
        alignOffset={alignOffset}
        className="isolate z-50 outline-hidden"
        sideOffset={sideOffset}
        side={side}
      >
        <Menu.Popup
          data-slot="dropdown-menu-content"
          className={cn(
            "z-50 min-w-44 origin-(--transform-origin) rounded-lg border bg-popover p-1 text-popover-foreground shadow-md outline-hidden transition-[scale,opacity] duration-100 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0",
            className
          )}
          {...props}
        >
          {children}
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  );
}

function DropdownMenuItem({
  className,
  closeOnClick = true,
  ...props
}: Menu.Item.Props) {
  return (
    <Menu.Item
      data-slot="dropdown-menu-item"
      closeOnClick={closeOnClick}
      className={cn(
        "relative flex h-8 cursor-default select-none items-center gap-2 rounded-md px-2 text-sm outline-hidden transition-colors data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-accent data-highlighted:text-accent-foreground [&_svg]:size-4 [&_svg]:shrink-0",
        className
      )}
      {...props}
    />
  );
}

function DropdownMenuSeparator({ className, ...props }: Menu.Separator.Props) {
  return (
    <Menu.Separator
      data-slot="dropdown-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
};
