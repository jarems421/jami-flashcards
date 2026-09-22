import Link from "next/link";

/**
 * The ways in, for a student who does not want the thing Jami suggested.
 *
 * Four doors rather than four widgets. Each says what is behind it in the
 * student's own terms -- cards due, notebooks, real exam questions, their own
 * folders -- and carries no counts, because a number on a door turns a choice
 * into a comparison, and the choice here is about what someone feels like
 * doing.
 *
 * A door is only shown when it leads somewhere real. Past papers needs a
 * folder with a course behind it, and offering it to a student who has none
 * would be a door onto a wall.
 */

export type StudyDoor = {
  label: string;
  detail: string;
  href: string;
  /** 24x24 path data, drawn as a stroke so the set reads as one family. */
  icon: string;
};

function DoorIcon({ path }: { path: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-5 w-5"
    >
      <path d={path} />
    </svg>
  );
}

export default function StudyDoors({ doors }: { doors: StudyDoor[] }) {
  if (doors.length === 0) return null;
  return (
    /*
      Two across even on the narrowest phone. One column turned four doors into
      a third of a screen of scrolling before the page ended, which is the
      "compact secondary navigation" this row is supposed to be.
    */
    <div
      className={`grid grid-cols-2 gap-3 ${
        doors.length >= 4 ? "lg:grid-cols-4" : "lg:grid-cols-3"
      }`}
    >
      {doors.map((door) => (
        <Link
          key={door.href}
          href={door.href}
          className="app-subtle-panel group flex min-h-[5.5rem] flex-col justify-between gap-2.5 rounded-xl p-3.5 transition duration-fast hover:-translate-y-[2px] hover:border-[var(--color-border-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] sm:min-h-[6.5rem] sm:gap-3 sm:p-5"
        >
          <span className="flex items-center justify-between text-text-muted transition duration-fast group-hover:text-warm-accent">
            <DoorIcon path={door.icon} />
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="h-3.5 w-3.5 opacity-0 transition duration-fast group-hover:translate-x-0.5 group-hover:opacity-100"
            >
              <path d="M3.5 8h9" />
              <path d="m8.5 3 4.5 5-4.5 5" />
            </svg>
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-text-primary">{door.label}</span>
            <span className="mt-1 block text-xs leading-5 text-text-muted">{door.detail}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}
