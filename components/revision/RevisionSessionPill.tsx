import Link from "next/link";
import RevisionEmblem from "@/components/revision/RevisionEmblem";
import { Chevron, pillBase } from "@/components/practice/PaperEntryPills";

/**
 * A way into a Revision Session, beside Exam questions and Practice papers.
 *
 * Warm rather than accented: the accented pill starts practice, and this one
 * is Jami teaching -- the Tutor's colour, so the two read as different kinds
 * of help at a glance.
 */
export default function RevisionSessionPill({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className={`${pillBase} border-warm-border bg-warm-glow pl-3 pr-2.5 text-text-primary hover:border-[var(--color-warm-accent)] hover:bg-[color-mix(in_srgb,var(--color-warm-accent)_18%,transparent)]`}
    >
      <RevisionEmblem className="h-4 w-4 text-warm-accent" />
      Revision session
      <Chevron className="h-3.5 w-3.5 text-text-secondary transition duration-fast group-hover:translate-x-0.5 group-hover:text-text-primary" />
    </Link>
  );
}
