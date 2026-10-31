import type { ButtonHTMLAttributes } from "react";

/** Icon-only draft-line control: never smaller than 44x44 CSS px, never shrunk by the flex row. */
export const DRAFT_LINE_BUTTON_CLASS = "flex h-11 w-11 min-h-[44px] min-w-[44px] shrink-0 items-center justify-center";

export default function DraftLineButton({ className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...props} className={`${DRAFT_LINE_BUTTON_CLASS} ${className}`} />;
}
