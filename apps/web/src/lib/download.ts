import type { FileDownload } from '../engine/protocol';

/** Offer an in-memory file as a download (blob: URL, nothing leaves the browser). */
export function saveFile(file: FileDownload): void {
  const url = URL.createObjectURL(new Blob([file.data], { type: file.mimeType }));
  const a = document.createElement('a');
  a.href = url;
  a.download = file.fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser time to start the download before releasing the blob.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
