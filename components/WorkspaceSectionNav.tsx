import Link from "next/link";

const items = [
  { href: "/app/workspace", label: "Workspace hub" },
  { href: "/app/workspace/whiteboard", label: "Whiteboard" },
  { href: "/app/workspace/presentations", label: "Presentations" },
];

export default function WorkspaceSectionNav({ currentPath }: { currentPath: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => {
        const active = currentPath === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={active
              ? "rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white"
              : "rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50"
            }
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}