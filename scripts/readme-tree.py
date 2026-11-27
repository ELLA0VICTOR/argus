"""Regenerates the "Repository structure" tree in README.md from git-tracked files.

Usage (repo root): python scripts/readme-tree.py
Untracked-but-not-ignored files are included too, so new work shows up before it's committed.
"""
import os
import re
import subprocess

SKIP_DIRS = ("mobile/assets/fonts/", "docs/mockups/", "docs/audits/codex-r1/", "docs/audits/devnet-2026-11-27/")
SKIP_FILES = re.compile(r"(package-lock\.json|\.gitignore|\.prettierignore)$")
NOTES = {
    "app/": "web app (React + Vite + Tailwind)",
    "app/src/app/": "vault app: shell, store, pages",
    "app/src/demo/": '"steal my wallet" live demo',
    "app/src/idl/": "program IDL + TS types (scripts/export-idl.mjs)",
    "app/src/landing/": "landing page and product replay",
    "app/src/lib/": "config, formatting, hooks, Sentinel client",
    "docs/": "spec, threat model, audits, design, API contract",
    "docs/audits/": "internal audit rounds + devnet verification",
    "mobile/": "Android app (Expo + Mobile Wallet Adapter)",
    "programs/argus/": "Anchor program",
    "programs/argus/src/": "instructions, state, governance, errors, events",
    "programs/argus/tests/": "148 LiteSVM tests (attack, rollback, fuzz)",
    "scripts/": "IDL export, README tree",
    "sentinel/": "AI guardian service: demo, watcher, call, cancel/freeze",
}


def files():
    out = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard"], capture_output=True, text=True, check=True).stdout
    for p in sorted(set(out.split())):
        if p.startswith(SKIP_DIRS) or SKIP_FILES.search(p) or not os.path.exists(p):
            continue
        yield p


def build():
    tree = {}
    for p in files():
        node = tree
        parts = p.split("/")
        for d in parts[:-1]:
            node = node.setdefault(d + "/", {})
        node[parts[-1]] = None
    lines = ["argus/"]

    def walk(node, prefix, path):
        items = sorted(node.items(), key=lambda kv: (kv[1] is None, kv[0].lower()))
        for i, (name, child) in enumerate(items):
            last = i == len(items) - 1
            line = prefix + ("└── " if last else "├── ") + name
            note = NOTES.get(path + name)
            lines.append(f"{line:<38} # {note}" if note else line)
            if child is not None:
                walk(child, prefix + ("    " if last else "│   "), path + name)

    walk(tree, "", "")
    return "\n".join(lines)


def main():
    readme = open("README.md", encoding="utf-8").read()
    start = readme.index("## Repository structure")
    end = readme.index("## Security")
    section = (
        "## Repository structure\n\n"
        "Build output, dependencies, keys and `.env` files are gitignored. Font files and raw audit-run artifacts are omitted below. "
        "Regenerate this tree with `python scripts/readme-tree.py`.\n\n"
        "```\n" + build() + "\n```\n\n"
    )
    open("README.md", "w", encoding="utf-8", newline="\n").write(readme[:start] + section + readme[end:])
    print("README tree updated")


if __name__ == "__main__":
    main()
