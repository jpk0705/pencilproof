"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { track } from "@/lib/analytics";

type TrackedLinkProps = ComponentProps<typeof Link> & {
  analyticsCategory?: string;
  analyticsEvent?: string;
};

export default function TrackedLink({
  analyticsCategory,
  analyticsEvent = "cta_clicked",
  onClick,
  ...props
}: TrackedLinkProps) {
  return (
    <Link
      {...props}
      onClick={(event) => {
        track({ event: analyticsEvent, category: analyticsCategory });
        onClick?.(event);
      }}
    />
  );
}
