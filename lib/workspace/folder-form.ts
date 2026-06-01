export function getFolderNameValidationError(name: string) {
  return name.trim().length > 0 ? null : "Folder name is required.";
}
