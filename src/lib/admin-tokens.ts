// Admin design tokens — owner: Mia (task A1)
// These are admin-surface-specific values that sit on top of Nikao's base tokens
// (src/lib/design-tokens.ts). Import this file for admin layout and component sizing.
// Never hardcode these values directly in components — always reference this file.

export const adminLayout = {
  sidebarWidth: "240px",       // Full sidebar width (desktop ≥ 1024px)
  sidebarCollapsedWidth: "0px", // Sidebar hidden below 1024px (collapsible)
  sidebarBreakpoint: "1024px", // Screen width at which sidebar collapses
} as const;

export const adminSpacing = {
  touchTarget: "40px",  // Minimum button/interactive element size on admin (DESIGN.md)
  pagePadding: "1.5rem", // Consistent padding around admin page content
  sectionGap: "1.5rem",  // Gap between sections on a page
} as const;

export const adminComponents = {
  // shadcn/ui component choices for admin (DESIGN.md)
  // Lists   → shadcn Table
  // Edits   → shadcn Dialog
  // Notices → shadcn Sonner (toast notifications)
} as const;

export type AdminLayoutToken = keyof typeof adminLayout;
export type AdminSpacingToken = keyof typeof adminSpacing;
