// Admin login — legacy redirect.
// Staff sign-in is unified at /staff/login (one page, routes by role). This
// route is kept so existing links/bookmarks resolve. Docs: docs/DESIGN.md.

import { redirect } from "next/navigation";

export default function AdminLoginPage() {
  redirect("/staff/login");
}
