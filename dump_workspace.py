#!/usr/bin/env python3
"""
Workspace dump script for gesture_nmf project.
Serializes all project materials (code, config, documentation) to JSON.
"""

import json
import os
from pathlib import Path
from typing import Any, Dict, List


class WorkspaceDumper:
    """Dumps all workspace materials to a structured format."""

    def __init__(self, workspace_root: str = "."):
        self.workspace_root = Path(workspace_root)
        self.dump = {
            "metadata": {},
            "config": {},
            "source_code": {},
            "tests": {},
            "documentation": {},
            "outputs": {},
            "directory_structure": {},
        }

    def dump_metadata(self) -> None:
        """Extract project metadata from pyproject.toml and README."""
        pyproject_path = self.workspace_root / "pyproject.toml"
        if pyproject_path.exists():
            with open(pyproject_path, "r") as f:
                self.dump["metadata"]["pyproject"] = f.read()

        readme_path = self.workspace_root / "README.md"
        if readme_path.exists():
            with open(readme_path, "r") as f:
                self.dump["metadata"]["readme"] = f.read()

    def dump_config(self) -> None:
        """Extract configuration files."""
        config_files = ["requirements.txt", "pyproject.toml"]
        for config_file in config_files:
            config_path = self.workspace_root / config_file
            if config_path.exists():
                with open(config_path, "r") as f:
                    self.dump["config"][config_file] = f.read()

    def dump_python_files(
        self, directory: str, target_key: str, exclude_pycache: bool = True
    ) -> None:
        """Recursively dump Python files from a directory."""
        dir_path = self.workspace_root / directory
        if not dir_path.exists():
            return

        for py_file in sorted(dir_path.rglob("*.py")):
            if exclude_pycache and "__pycache__" in py_file.parts:
                continue

            relative_path = str(py_file.relative_to(self.workspace_root))
            try:
                with open(py_file, "r", encoding="utf-8") as f:
                    content = f.read()
                self.dump[target_key][relative_path] = {
                    "path": relative_path,
                    "size": len(content),
                    "content": content,
                }
            except Exception as e:
                self.dump[target_key][relative_path] = {
                    "path": relative_path,
                    "error": str(e),
                }

    def dump_directory_structure(self) -> None:
        """Create a hierarchical representation of the directory structure."""

        def build_tree(path: Path, max_depth: int = 5, current_depth: int = 0) -> Dict:
            if current_depth >= max_depth:
                return {}

            tree = {}
            try:
                for item in sorted(path.iterdir()):
                    if item.name.startswith("."):
                        continue
                    if item.name == "__pycache__":
                        continue

                    if item.is_dir():
                        tree[item.name] = {
                            "type": "directory",
                            "contents": build_tree(item, max_depth, current_depth + 1),
                        }
                    else:
                        tree[item.name] = {
                            "type": "file",
                            "size": item.stat().st_size,
                        }
            except PermissionError:
                pass

            return tree

        self.dump["directory_structure"] = build_tree(self.workspace_root)

    def dump_outputs(self) -> None:
        """Dump contents of outputs directory."""
        outputs_dir = self.workspace_root / "outputs"
        if outputs_dir.exists():
            for file_path in outputs_dir.rglob("*"):
                if file_path.is_file():
                    relative_path = str(file_path.relative_to(self.workspace_root))
                    try:
                        if file_path.suffix in [".json", ".txt", ".md", ".csv"]:
                            with open(file_path, "r", encoding="utf-8") as f:
                                content = f.read()
                            self.dump["outputs"][relative_path] = {
                                "type": file_path.suffix,
                                "content": content,
                            }
                        else:
                            self.dump["outputs"][relative_path] = {
                                "type": file_path.suffix,
                                "size": file_path.stat().st_size,
                                "note": "Binary or large file - not included",
                            }
                    except Exception as e:
                        self.dump["outputs"][relative_path] = {"error": str(e)}

    def dump_tests(self) -> None:
        """Extract test files."""
        self.dump_python_files("tests", "tests")

    def dump_all(self) -> Dict[str, Any]:
        """Execute all dump operations."""
        print("Dumping workspace metadata...")
        self.dump_metadata()

        print("Dumping configuration files...")
        self.dump_config()

        print("Dumping source code...")
        self.dump_python_files("gesture_nmf", "source_code")

        print("Dumping tests...")
        self.dump_tests()

        print("Dumping outputs...")
        self.dump_outputs()

        print("Building directory structure...")
        self.dump_directory_structure()

        return self.dump

    def save_json(self, output_path: str = "workspace_dump.json") -> None:
        """Save dump to JSON file."""
        output_file = self.workspace_root / output_path
        print(f"Saving to {output_file}...")
        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(self.dump, f, indent=2, ensure_ascii=False)
        print(f"✓ Dump saved to {output_file}")
        print(f"  File size: {output_file.stat().st_size / 1024:.1f} KB")

    def save_text(self, output_path: str = "workspace_dump.txt") -> None:
        """Save dump to human-readable text file."""
        output_file = self.workspace_root / output_path
        print(f"Saving text dump to {output_file}...")

        with open(output_file, "w", encoding="utf-8") as f:
            f.write("=" * 80 + "\n")
            f.write("WORKSPACE DUMP\n")
            f.write("=" * 80 + "\n\n")

            # Metadata
            if self.dump["metadata"]:
                f.write("METADATA\n")
                f.write("-" * 80 + "\n")
                for key, content in self.dump["metadata"].items():
                    f.write(f"\n{key.upper()}:\n")
                    f.write(content + "\n")

            # Config
            if self.dump["config"]:
                f.write("\n" + "=" * 80 + "\n")
                f.write("CONFIGURATION\n")
                f.write("-" * 80 + "\n")
                for config_name, content in self.dump["config"].items():
                    f.write(f"\n{config_name}:\n")
                    f.write(content + "\n")

            # Source code
            if self.dump["source_code"]:
                f.write("\n" + "=" * 80 + "\n")
                f.write("SOURCE CODE\n")
                f.write("-" * 80 + "\n")
                for file_path, file_info in sorted(self.dump["source_code"].items()):
                    f.write(f"\n\n{'#' * 80}\n")
                    f.write(f"# FILE: {file_path}\n")
                    f.write(f"{'#' * 80}\n")
                    if "content" in file_info:
                        f.write(file_info["content"])
                    else:
                        f.write(f"Error: {file_info.get('error', 'Unknown error')}\n")

            # Tests
            if self.dump["tests"]:
                f.write("\n" + "=" * 80 + "\n")
                f.write("TESTS\n")
                f.write("-" * 80 + "\n")
                for file_path, file_info in sorted(self.dump["tests"].items()):
                    f.write(f"\n\n{'#' * 80}\n")
                    f.write(f"# FILE: {file_path}\n")
                    f.write(f"{'#' * 80}\n")
                    if "content" in file_info:
                        f.write(file_info["content"])
                    else:
                        f.write(f"Error: {file_info.get('error', 'Unknown error')}\n")

        print(f"✓ Text dump saved to {output_file}")
        print(f"  File size: {output_file.stat().st_size / 1024:.1f} KB")


def main():
    """Main entry point."""
    import argparse

    parser = argparse.ArgumentParser(
        description="Dump workspace materials to JSON or text format"
    )
    parser.add_argument(
        "--workspace",
        "-w",
        default=".",
        help="Path to workspace root (default: current directory)",
    )
    parser.add_argument(
        "--format",
        "-f",
        choices=["json", "text", "both"],
        default="both",
        help="Output format (default: both)",
    )
    parser.add_argument(
        "--output-json",
        "-oj",
        default="workspace_dump.json",
        help="Output JSON file path",
    )
    parser.add_argument(
        "--output-text",
        "-ot",
        default="workspace_dump.txt",
        help="Output text file path",
    )

    args = parser.parse_args()

    dumper = WorkspaceDumper(args.workspace)
    dumper.dump_all()

    if args.format in ["json", "both"]:
        dumper.save_json(args.output_json)

    if args.format in ["text", "both"]:
        dumper.save_text(args.output_text)

    print("\n✓ Workspace dump complete!")


if __name__ == "__main__":
    main()
