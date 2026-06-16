import type { RepoEnvironmentOption, RepoFileSummary } from "../types";

export interface FileTreeNode {
  id: string;
  name: string;
  path: string;
  kind: "directory" | "file";
  children: FileTreeNode[];
  file?: RepoFileSummary;
}

export function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

export function splitPathSegments(value: string): string[] {
  return normalizePath(value).split("/").filter(Boolean);
}

export function getPathWithinRoot(filePath: string, root: string): string | null {
  const fileSegments = splitPathSegments(filePath);
  const rootSegments = splitPathSegments(root);
  if (!fileSegments.length || !rootSegments.length || fileSegments.length < rootSegments.length) {
    return null;
  }

  for (let start = 0; start <= fileSegments.length - rootSegments.length; start += 1) {
    const matches = rootSegments.every(
      (segment, index) => fileSegments[start + index] === segment
    );
    if (matches) {
      return fileSegments.slice(start + rootSegments.length).join("/");
    }
  }

  return null;
}

export function replaceEnvironmentRoot(
  filePath: string,
  environments: RepoEnvironmentOption[],
  nextEnvironmentId: string
): string | null {
  const currentEnvironment = environments.find(
    (item) => getPathWithinRoot(filePath, item.root) !== null
  );
  const nextEnvironment = environments.find((item) => item.id === nextEnvironmentId);
  if (!currentEnvironment || !nextEnvironment) {
    return null;
  }

  const suffix = getPathWithinRoot(filePath, currentEnvironment.root);
  if (suffix === null) {
    return null;
  }

  return suffix ? `${nextEnvironment.root}/${suffix}` : nextEnvironment.root;
}

export function buildFileTree(
  files: RepoFileSummary[],
  resolveRelativePath: (file: RepoFileSummary) => string | null,
  treeId: string
): FileTreeNode[] {
  const rootNode: FileTreeNode = {
    id: treeId,
    name: treeId.split("/").pop() || treeId,
    path: treeId,
    kind: "directory",
    children: []
  };

  for (const file of files) {
    const relativePath = resolveRelativePath(file);
    if (!relativePath) {
      continue;
    }

    const segments = relativePath.split("/").filter(Boolean);
    let currentNode = rootNode;

    segments.forEach((segment, index) => {
      const isFile = index === segments.length - 1;
      const nextPath = `${currentNode.path}/${segment}`;
      let child = currentNode.children.find(
        (item) => item.name === segment && item.kind === (isFile ? "file" : "directory")
      );

      if (!child) {
        child = {
          id: isFile ? file.path : nextPath,
          name: segment,
          path: isFile ? file.path : nextPath,
          kind: isFile ? "file" : "directory",
          children: [],
          file: isFile ? file : undefined
        };
        currentNode.children.push(child);
        currentNode.children.sort((left, right) => {
          if (left.kind !== right.kind) {
            return left.kind === "directory" ? -1 : 1;
          }
          return left.name.localeCompare(right.name, "zh-CN");
        });
      }

      currentNode = child;
    });
  }

  return rootNode.children;
}

export function nodeContainsPath(node: FileTreeNode, pathValue: string): boolean {
  if (node.kind === "file") {
    return node.path === pathValue;
  }
  return node.children.some((child) => nodeContainsPath(child, pathValue));
}
