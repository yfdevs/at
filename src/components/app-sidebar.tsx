import type { ComponentProps } from "react"
import { NavLink, useLocation } from "react-router-dom"

import { navigationGroups, routePath } from "@/config/navigation"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

export function AppSidebar({ ...props }: ComponentProps<typeof Sidebar>) {
  const location = useLocation()

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarContent className="gap-0.5">
        {navigationGroups.map((group) => {
          return (
            <SidebarGroup key={group.title}>
              <SidebarGroupLabel>
                {group.title}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="gap-0.5">
                  {group.items.map((item) => {
                    const ItemIcon = item.icon
                    return (
                      <SidebarMenuItem key={item.title}>
                        <SidebarMenuButton
                          isActive={location.pathname === routePath(item.route)}
                          className="h-8"
                          render={<NavLink to={routePath(item.route)} />}
                          tooltip={item.title}
                        >
                          <ItemIcon className="size-4" />
                          <span>{item.title}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )
        })}
      </SidebarContent>
    </Sidebar>
  )
}
