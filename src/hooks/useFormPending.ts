import { useTransition } from "react";

export function useFormPending() {
  const [isPending, startTransition] = useTransition();
  return { isPending, startTransition };
}
